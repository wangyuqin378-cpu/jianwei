param([switch]$Release)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$JdkHome = Get-ChildItem -LiteralPath (Join-Path $Root ".tooling\jdk") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $JdkHome) { throw "Run scripts\bootstrap-android-windows.ps1 first" }

$SdkRoot = Join-Path $Root ".tooling\android-sdk"
$env:JAVA_HOME = $JdkHome
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:GRADLE_USER_HOME = Join-Path $Root ".tooling\gradle-home"
$env:PATH = "$JdkHome\bin;$SdkRoot\platform-tools;$env:PATH"

Push-Location (Join-Path $Root "android")
try {
    if ($Release -and -not (Test-Path -LiteralPath "keystore.properties")) {
        throw "Copy keystore.properties.example to keystore.properties and configure a private Beta keystore first"
    }
    if ($Release) {
        $localProperties = Get-Content -LiteralPath "local.properties" -ErrorAction Stop
        $releaseApi = $localProperties | Where-Object { $_ -match '^jianwei\.releaseApiUrl=' } | Select-Object -Last 1
        $releaseApiValue = if ($releaseApi) { ($releaseApi -split '=', 2)[1].Trim() } else { "" }
        if ($releaseApiValue -notmatch '^https://[^/]+(?:/.*)?$') {
            throw "Formal Release requires jianwei.releaseApiUrl with an explicit HTTPS URL in android/local.properties"
        }
    }
    $AssembleTask = if ($Release) { "assembleRelease" } else { "assembleDebug" }
    & .\gradlew.bat :domain:test :data:testDebugUnitTest :app:testDebugUnitTest lintDebug $AssembleTask --no-daemon --max-workers=1
    if ($LASTEXITCODE -ne 0) { throw "Android verification failed" }
} finally {
    Pop-Location
}
