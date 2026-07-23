param(
    [string]$UnsignedApkPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $root ".tooling\android-sdk"
$jdk = Get-ChildItem -LiteralPath (Join-Path $root ".tooling\jdk") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
    Select-Object -First 1 -ExpandProperty FullName
$adb = Join-Path $sdk "platform-tools\adb.exe"
$apksigner = Get-ChildItem -LiteralPath (Join-Path $sdk "build-tools") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat") } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1 |
    ForEach-Object { Join-Path $_.FullName "apksigner.bat" }
$keytool = if ($jdk) { Join-Path $jdk "bin\keytool.exe" } else { "" }
$unsigned = if ($UnsignedApkPath) { (Resolve-Path -LiteralPath $UnsignedApkPath).Path } else {
    Join-Path $root "android\app\build\outputs\apk\release\app-release-unsigned.apk"
}
$resultDirectory = Join-Path $root ".tooling\release-smoke-results"
$keystore = Join-Path $resultDirectory "local-r8-smoke.jks"
$signed = Join-Path $resultDirectory "jianwei-r8-smoke.apk"
$password = "local-r8-smoke-only"
$packageName = "cn.jianwei.app"
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$sdk\platform-tools;$env:PATH"

if (-not $jdk) { throw "Missing JDK 17. Run scripts\bootstrap-android-windows.cmd first." }
if (-not $apksigner) { throw "Missing Android build-tools apksigner. Run scripts\bootstrap-android-windows.cmd first." }
foreach ($required in @($adb, $apksigner, $keytool, $unsigned)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing release smoke dependency: $required" }
}
$serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
    ($_ -split '\s+')[0]
} | Select-Object -First 1)
if (-not $serial) { throw "No running Android emulator was found." }
if ((& $adb -s $serial shell getprop ro.build.version.sdk).Trim() -ne "34") {
    throw "The release runtime gate requires the API 34 AVD."
}

New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
if (-not (Test-Path -LiteralPath $keystore)) {
    & $keytool -genkeypair -noprompt -keystore $keystore -storepass $password -keypass $password `
        -alias local-r8-smoke -keyalg RSA -keysize 2048 -validity 3650 `
        -dname "CN=Jianwei Local R8 Smoke,OU=Test Only,O=Jianwei,C=CN" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the local test-only R8 signing key." }
}

& $apksigner sign --ks $keystore --ks-key-alias local-r8-smoke `
    --ks-pass "pass:$password" --key-pass "pass:$password" --out $signed $unsigned
if ($LASTEXITCODE -ne 0) { throw "Failed to sign the R8 smoke APK." }
$verification = (& $apksigner verify --verbose --print-certs $signed) -join "`n"
if ($LASTEXITCODE -ne 0 -or -not $verification.Contains("Verified using v2 scheme (APK Signature Scheme v2): true")) {
    throw "The local R8 smoke APK did not pass v2 signature verification."
}
Set-Content -Encoding UTF8 -LiteralPath (Join-Path $resultDirectory "apksigner.txt") -Value $verification

& $adb -s $serial uninstall $packageName | Out-Null
try {
    & (Join-Path $PSScriptRoot "run-android-widget-smoke-windows.ps1") -ApkPath $signed -SkipPrivateDatabaseChecks
    if ($LASTEXITCODE -ne 0) { throw "The R8 widget/app smoke gate failed." }
    $packageUidLine = ((& $adb -s $serial shell cmd package list packages -U $packageName) -join "`n").Trim()
    if ($packageUidLine -notmatch 'uid:(\d+)') {
        throw "The Release runtime log audit could not resolve the installed package UID."
    }
    $packageUid = $Matches[1]
    $runtimeLog = (& $adb -s $serial logcat -d "--uid=$packageUid") -join "`n"
    $forbiddenRuntimeLogPatterns = [ordered]@{
        bearer = '(?i)\bBearer\s+[A-Za-z0-9._~-]{8,}'
        authorization = '(?i)\bauthorization\s*[:=]'
        deviceToken = '(?i)\bdeviceToken\b'
        installationSecret = '(?i)\binstallationSecret\b'
        evaluationLease = '(?i)x-jianwei-evaluation-lease'
        functionCredential = '(?i)x-fc-access-key|x-fc-security-token'
        cloudSecret = '(?i)DASHSCOPE_API_KEY|OSS_ACCESS_KEY_SECRET'
        mediaUri = '(?i)content://media/'
        analysisInstance = '(?i)/v1/analysis-jobs/[0-9a-f-]{36}'
        privateImportPath = '(?i)jianwei[_-]imports|imported[_-]photos'
    }
    foreach ($entry in $forbiddenRuntimeLogPatterns.GetEnumerator()) {
        if ($runtimeLog -match $entry.Value) {
            throw "Release runtime log privacy audit found forbidden category: $($entry.Key)"
        }
    }
    $hash = (Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash
    Write-Host "RELEASE_RUNTIME_GATE=GO r8=1 v2=1 app=1 widget=1 releaseLogPrivacy=1 formalSigning=0 api=34 sha256=$hash"
    Write-Host "RESULTS=$resultDirectory"
} finally {
    & $adb -s $serial uninstall $packageName | Out-Null
}
