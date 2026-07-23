param(
    [switch]$SkipLicenses,
    [switch]$SkipEmulator
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Tooling = Join-Path $Root ".tooling"
$Downloads = Join-Path $Tooling "downloads"
$JdkRoot = Join-Path $Tooling "jdk"
$SdkRoot = Join-Path $Tooling "android-sdk"
$AvdRoot = Join-Path $Tooling "avd"

New-Item -ItemType Directory -Force $Downloads, $JdkRoot, $SdkRoot | Out-Null

function Download-IfMissing([string]$Url, [string]$Target) {
    if (-not (Test-Path -LiteralPath $Target)) {
        Write-Host "Downloading $Url"
        Invoke-WebRequest -Uri $Url -OutFile $Target
    }
}

$JdkHome = Get-ChildItem -LiteralPath $JdkRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $JdkHome) {
    $JdkArchive = Join-Path $Downloads "temurin-jdk17.zip"
    Download-IfMissing "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" $JdkArchive
    Expand-Archive -LiteralPath $JdkArchive -DestinationPath $JdkRoot -Force
    $JdkHome = Get-ChildItem -LiteralPath $JdkRoot -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $JdkHome) { throw "JDK 17 extraction failed" }

$SdkManager = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path -LiteralPath $SdkManager)) {
    $SdkArchive = Join-Path $Downloads "android-commandline-tools.zip"
    Download-IfMissing "https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip" $SdkArchive
    $ExpectedSha1 = "16B3F45DDB3D85EA6BBE6A1C0B47146DAF0DB450"
    $ActualSha1 = (Get-FileHash -LiteralPath $SdkArchive -Algorithm SHA1).Hash
    if ($ActualSha1 -ne $ExpectedSha1) { throw "Android command-line tools checksum mismatch" }
    $Extracted = Join-Path $Tooling "cmdline-tools-extracted"
    if (Test-Path -LiteralPath $Extracted) { Remove-Item -LiteralPath $Extracted -Recurse -Force }
    Expand-Archive -LiteralPath $SdkArchive -DestinationPath $Extracted -Force
    $Latest = Join-Path $SdkRoot "cmdline-tools\latest"
    New-Item -ItemType Directory -Force (Split-Path -Parent $Latest) | Out-Null
    Move-Item -LiteralPath (Join-Path $Extracted "cmdline-tools") -Destination $Latest
    Remove-Item -LiteralPath $Extracted -Recurse -Force
}

$env:JAVA_HOME = $JdkHome
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_AVD_HOME = $AvdRoot
$env:PATH = "$JdkHome\bin;$SdkRoot\platform-tools;$env:PATH"

if (-not $SkipLicenses) {
    1..100 | ForEach-Object { "y" } | & $SdkManager --sdk_root=$SdkRoot --licenses | Out-Host
}
$Packages = @("platforms;android-36", "build-tools;36.0.0", "platform-tools")
if (-not $SkipEmulator) {
    $Packages += @("emulator", "system-images;android-34;google_apis;x86_64")
}
& $SdkManager --sdk_root=$SdkRoot $Packages
if ($LASTEXITCODE -ne 0) { throw "Android SDK package installation failed" }

if (-not $SkipEmulator) {
    $AvdManager = Join-Path $SdkRoot "cmdline-tools\latest\bin\avdmanager.bat"
    $AvdName = "jianwei_api34"
    New-Item -ItemType Directory -Force $AvdRoot | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $AvdRoot "$AvdName.ini"))) {
        "no" | & $AvdManager create avd --force --name $AvdName `
            --package "system-images;android-34;google_apis;x86_64" --device "pixel_6"
        if ($LASTEXITCODE -ne 0) { throw "Android API 34 AVD creation failed" }
    }
}

$EscapedSdk = $SdkRoot.Replace("\", "\\").Replace(":", "\:")
$LocalProperties = Join-Path $Root "android\local.properties"
$ApiLine = "jianwei.apiUrl=http://10.0.2.2:8787/"
if (Test-Path -LiteralPath $LocalProperties) {
    $ExistingApi = Get-Content -LiteralPath $LocalProperties | Where-Object { $_ -like "jianwei.apiUrl=*" } | Select-Object -First 1
    if ($ExistingApi) { $ApiLine = $ExistingApi }
}
Set-Content -LiteralPath $LocalProperties -Encoding ascii -Value @("sdk.dir=$EscapedSdk", $ApiLine)

Write-Host "JAVA_HOME=$JdkHome"
Write-Host "ANDROID_SDK_ROOT=$SdkRoot"
Write-Host "Android toolchain is ready."
