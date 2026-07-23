param(
    [switch]$SelfTest,
    [string]$ApkPath = "",
    [string]$ExpectedSignerSha256 = "",
    [string]$EvidenceRef = "",
    [string]$OutputPath = "",
    [switch]$Write
)

$ErrorActionPreference = "Stop"

function Parse-ApkSignerOutput([string]$Text) {
    $v2 = [regex]::Match($Text, 'Verified using v2 scheme \(APK Signature Scheme v2\):\s*(true|false)', 'IgnoreCase')
    $signers = [regex]::Match($Text, 'Number of signers:\s*(\d+)', 'IgnoreCase')
    $dn = [regex]::Match($Text, 'Signer #1 certificate DN:\s*(.+)', 'IgnoreCase')
    $digest = [regex]::Match($Text, 'Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})', 'IgnoreCase')
    if (-not $v2.Success -or -not $signers.Success -or -not $dn.Success -or -not $digest.Success) {
        throw "apksigner output is incomplete"
    }
    [pscustomobject]@{
        V2 = $v2.Groups[1].Value.ToLowerInvariant() -eq "true"
        Signers = [int]$signers.Groups[1].Value
        DistinguishedName = $dn.Groups[1].Value.Trim()
        CertificateSha256 = $digest.Groups[1].Value.ToLowerInvariant()
    }
}

function Parse-BadgingOutput([string]$Text) {
    $package = [regex]::Match($Text, "package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'", 'IgnoreCase')
    $minimum = [regex]::Match($Text, "sdkVersion:'(\d+)'", 'IgnoreCase')
    $target = [regex]::Match($Text, "targetSdkVersion:'(\d+)'", 'IgnoreCase')
    if (-not $package.Success -or -not $minimum.Success -or -not $target.Success) {
        throw "aapt badging output is incomplete"
    }
    [pscustomobject]@{
        PackageName = $package.Groups[1].Value
        VersionCode = [int]$package.Groups[2].Value
        VersionName = $package.Groups[3].Value
        MinSdk = [int]$minimum.Groups[1].Value
        TargetSdk = [int]$target.Groups[1].Value
    }
}

function Assert-FormalSigner($Signer, [string]$Expected) {
    if (-not $Signer.V2 -or $Signer.Signers -ne 1) { throw "APK must have exactly one v2 signer" }
    if ($Signer.CertificateSha256 -ne $Expected.ToLowerInvariant()) { throw "APK signer certificate does not match the pinned release fingerprint" }
    if ($Signer.DistinguishedName -match '(?i)Android Debug|Test Only|Local R8 Smoke') {
        throw "Debug or test-only signer is not formal release evidence"
    }
}

if ($SelfTest) {
    $signerText = @"
Verified using v2 scheme (APK Signature Scheme v2): true
Number of signers: 1
Signer #1 certificate DN: CN=Jianwei Beta Release, O=Jianwei, C=CN
Signer #1 certificate SHA-256 digest: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
"@
    $badgingText = @"
package: name='cn.jianwei.app' versionCode='1' versionName='0.1.0-beta01'
sdkVersion:'26'
targetSdkVersion:'36'
"@
    $signer = Parse-ApkSignerOutput $signerText
    $badging = Parse-BadgingOutput $badgingText
    Assert-FormalSigner $signer ("a" * 64)
    if ($badging.PackageName -ne "cn.jianwei.app" -or $badging.MinSdk -ne 26 -or $badging.TargetSdk -ne 36) {
        throw "Release APK verifier self-test parsed incorrect manifest values"
    }
    $debugRejected = $false
    try {
        $debug = [pscustomobject]@{ V2 = $true; Signers = 1; DistinguishedName = "CN=Android Debug"; CertificateSha256 = ("a" * 64) }
        Assert-FormalSigner $debug ("a" * 64)
    } catch { $debugRejected = $true }
    $mismatchRejected = $false
    try { Assert-FormalSigner $signer ("b" * 64) } catch { $mismatchRejected = $true }
    if (-not $debugRejected -or -not $mismatchRejected) { throw "Release APK verifier self-test accepted an invalid signer" }
    Write-Host "RELEASE_APK_VERIFIER_SELF_TEST=GO synthetic=1 releaseEvidence=0 v2=1 singleSigner=1 package=1 sdk=1 debugRejected=1 mismatchRejected=1"
    exit 0
}

if ($ExpectedSignerSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "ExpectedSignerSha256 must be the pinned release certificate SHA-256" }
if ([string]::IsNullOrWhiteSpace($EvidenceRef) -or $EvidenceRef.Length -gt 500) { throw "EvidenceRef is required and must be at most 500 characters" }
if ([string]::IsNullOrWhiteSpace($ApkPath)) { throw "ApkPath is required" }

$root = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $root ".tooling\android-sdk"
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdk "build-tools") -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat")) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "aapt.exe"))
    } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
if (-not $buildTools) { throw "Android build-tools with apksigner and aapt are missing" }
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
$aapt = Join-Path $buildTools.FullName "aapt.exe"
$apk = (Resolve-Path -LiteralPath $ApkPath).Path

$configuredJava = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME "bin\java.exe" } else { "" }
if (-not $configuredJava -or -not (Test-Path -LiteralPath $configuredJava)) {
    $localJava = Get-ChildItem -LiteralPath (Join-Path $root ".tooling\jdk") -Recurse -Filter "java.exe" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq "bin" } |
        Select-Object -First 1
    if (-not $localJava) { throw "JDK 17 is required to verify the release APK" }
    $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $localJava.FullName)
}

$verificationLines = & $apksigner verify --verbose --print-certs $apk 2>&1
if ($LASTEXITCODE -ne 0) {
    $summary = (($verificationLines | Select-Object -First 3) -join " ").Trim()
    throw "apksigner verification failed: $summary"
}
$signer = Parse-ApkSignerOutput ($verificationLines -join "`n")
Assert-FormalSigner $signer $ExpectedSignerSha256

$badgingLines = & $aapt dump badging $apk 2>&1
if ($LASTEXITCODE -ne 0) { throw "aapt badging inspection failed" }
$badging = Parse-BadgingOutput ($badgingLines -join "`n")
if ($badging.PackageName -ne "cn.jianwei.app") { throw "Release APK package name is invalid" }
if ($badging.MinSdk -ne 26 -or $badging.TargetSdk -ne 36) { throw "Release APK SDK contract is invalid" }

$artifact = [ordered]@{
    evidenceKind = "verified_release_apk"
    formalSigning = $true
    debugCertificate = $false
    apkSha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    signerCertificateSha256 = $signer.CertificateSha256
    packageName = $badging.PackageName
    versionName = $badging.VersionName
    versionCode = $badging.VersionCode
    verifiedAt = [DateTimeOffset]::UtcNow.ToString(
      "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
      [Globalization.CultureInfo]::InvariantCulture
    )
    evidenceRef = $EvidenceRef
}
$json = $artifact | ConvertTo-Json -Depth 4
if (-not $Write) {
    Write-Host "RELEASE_APK_VERIFICATION_PREVIEW=GO formalSigning=1 debugCertificate=0 v2=1 singleSigner=1 package=1 minSdk=26 targetSdk=36 wrote=0"
    exit 0
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) { throw "OutputPath is required with -Write" }
$output = [IO.Path]::GetFullPath($OutputPath)
$directory = Split-Path -Parent $output
New-Item -ItemType Directory -Force -Path $directory | Out-Null
if (Test-Path -LiteralPath $output) { throw "OutputPath already exists" }
$temporary = "$output.$PID.tmp"
try {
    [IO.File]::WriteAllText($temporary, "$json`n", [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $output
} finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}
Write-Host "RELEASE_APK_VERIFICATION=GO formalSigning=1 debugCertificate=0 v2=1 singleSigner=1 package=1 minSdk=26 targetSdk=36 wrote=1"
