param([switch]$SkipRelease)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $root ".tooling\android-sdk"
$jdk = Get-ChildItem -LiteralPath (Join-Path $root ".tooling\jdk") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
    Select-Object -First 1 -ExpandProperty FullName
$adb = Join-Path $sdk "platform-tools\adb.exe"
$gradle = Get-ChildItem -LiteralPath (Join-Path $root ".tooling\gradle") -Recurse -Filter gradle.bat -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\bin\\gradle\.bat$' } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $jdk -or -not $gradle -or -not (Test-Path -LiteralPath $adb)) {
    throw "Run scripts\bootstrap-android-windows.cmd before the reference suite."
}

$env:JAVA_HOME = $jdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
# Keep the release/runtime proof isolated from the interactive build cache. On
# Windows, antivirus and a recently stopped Gradle process can briefly retain a
# transform JAR and make an otherwise valid cold Release fail with AccessDenied.
$env:GRADLE_USER_HOME = Join-Path $root ".tooling\gradle-home-verification"
$env:PATH = "$jdk\bin;$sdk\platform-tools;$env:PATH"

$buildTasks = @(':app:assembleDebug', ':app:lintDebug')
if (-not $SkipRelease) {
    $buildTasks += @(':app:assembleRelease', ':app:lintVitalRelease')
}
Push-Location (Join-Path $root "android")
try {
    # App smoke must always install an APK produced from the current checkout.
    # Otherwise a stale debug artifact can make the UI gate look greener than
    # the code under review. -SkipRelease skips only the Release rebuild.
    & $gradle @buildTasks --no-daemon --max-workers=1
    if ($LASTEXITCODE -ne 0) { throw "Android reference build failed: $($buildTasks -join ', ')." }
} finally {
    Pop-Location
}

try {
    # A persisted AVD data partition can retain a package signed by a previous
    # smoke key. Start this evidence run from a clean test-only device so APK
    # installation and permission-state assertions are deterministic.
    & (Join-Path $PSScriptRoot "run-android-device-tests-windows.ps1") -KeepEmulator -WipeData
    & (Join-Path $PSScriptRoot "run-android-app-smoke-windows.ps1")
    & (Join-Path $PSScriptRoot "run-android-widget-smoke-windows.ps1")
    & (Join-Path $PSScriptRoot "run-android-accessibility-smoke-windows.ps1") -FontScale 2.0
    & (Join-Path $PSScriptRoot "run-android-talkback-smoke-windows.ps1")
    # -SkipRelease reuses an already-built unsigned artifact; it never skips
    # the signed R8 runtime proof itself.
    & (Join-Path $PSScriptRoot "run-android-release-smoke-windows.ps1")
    $deviceReports = @("data", "app") | ForEach-Object {
        $directory = Join-Path $root "android\$_\build\outputs\androidTest-results\connected\debug"
        Get-ChildItem $directory -Filter "TEST-*.xml" -ErrorAction SilentlyContinue
    }
    if ($deviceReports.Count -lt 2) { throw "Android reference suite cannot find both device-test XML reports." }
    $deviceTests = 0
    foreach ($deviceReport in $deviceReports) {
        [xml]$deviceResult = Get-Content -LiteralPath $deviceReport.FullName
        $deviceTests += [int]$deviceResult.testsuite.tests
    }
    if ($deviceTests -lt 40) { throw "Android reference suite expected at least 40 device tests, found $deviceTests." }
    $resultDirectory = Join-Path $root ".tooling\android-reference-suite-results"
    New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
    $result = "ANDROID_REFERENCE_SUITE=GO api=34 deviceTests=$deviceTests app=1 widget=1 accessibility=1 talkbackReference=1 r8=1 releaseLogPrivacy=1 formalSigning=0"
    Set-Content -LiteralPath (Join-Path $resultDirectory "result.txt") -Value $result -Encoding ASCII
    Write-Host $result
} finally {
    $serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
        ($_ -split '\s+')[0]
    } | Select-Object -First 1)
    if ($serial) { & $adb -s $serial emu kill | Out-Null }
}
