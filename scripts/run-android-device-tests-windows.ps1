param(
    [switch]$KeepEmulator,
    [switch]$WipeData
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $root ".tooling\android-sdk"
$jdk = Get-ChildItem -LiteralPath (Join-Path $root ".tooling\jdk") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
    Select-Object -First 1 -ExpandProperty FullName
$localGradle = Get-ChildItem -LiteralPath (Join-Path $root ".tooling\gradle") -Recurse -Filter gradle.bat -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\bin\\gradle\.bat$' } |
    Select-Object -First 1 -ExpandProperty FullName
$gradle = if ($localGradle) { $localGradle } else { Join-Path $root "android\gradlew.bat" }
$gradleHome = if ($localGradle) {
    Join-Path $root ".tooling\gradle-home-verification"
} else {
    Join-Path $root ".tooling\gradle-home"
}
$avdHome = Join-Path $root ".tooling\avd"
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emulator = Join-Path $sdk "emulator\emulator.exe"
$emulatorCheck = Join-Path $sdk "emulator\emulator-check.exe"
$avdName = "jianwei_api34"
$startedEmulator = $false

if (-not $jdk) { throw "Missing JDK 17. Run scripts\bootstrap-android-windows.cmd first." }
foreach ($required in @($adb, $emulator, $emulatorCheck, $gradle, (Join-Path $jdk "bin\java.exe"))) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing Android test dependency: $required. Run scripts\bootstrap-android-windows.ps1 first."
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $avdHome "$avdName.ini"))) {
    throw "Missing AVD $avdName. Install system-images;android-34;google_apis;x86_64 and create the AVD first."
}

$env:JAVA_HOME = $jdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_AVD_HOME = $avdHome
$env:GRADLE_USER_HOME = $gradleHome

& $emulatorCheck accel
if ($LASTEXITCODE -ne 0) {
    throw "Android VM acceleration is unavailable. Enable WHPX or install the official AEHD driver, then retry."
}

& $adb start-server | Out-Null
$serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
    ($_ -split '\s+')[0]
} | Select-Object -First 1)

if (-not $serial) {
    # Codex and a few other Windows launchers can inject both `Path` and `PATH`
    # into the native environment block. Start-Process treats environment keys
    # case-insensitively and otherwise fails before the emulator is launched.
    $processEnvironment = [Environment]::GetEnvironmentVariables()
    if ($processEnvironment.Contains("Path") -and $processEnvironment.Contains("PATH")) {
        $pathSegments = @($processEnvironment["Path"], $processEnvironment["PATH"]) |
            Where-Object { $_ } |
            ForEach-Object { $_ -split ";" } |
            Where-Object { $_ } |
            Select-Object -Unique
        [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
        [Environment]::SetEnvironmentVariable("Path", ($pathSegments -join ";"), "Process")
    }
    $logDirectory = Join-Path $root ".tooling\emulator-logs"
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $arguments = @(
        "-avd", $avdName,
        "-no-window", "-no-audio", "-no-boot-anim",
        "-gpu", "swiftshader_indirect",
        "-no-snapshot", "-memory", "2048", "-cores", "4"
    )
    if ($WipeData) { $arguments += "-wipe-data" }
    Start-Process -FilePath $emulator `
        -ArgumentList $arguments `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDirectory "device-test-stdout.log") `
        -RedirectStandardError (Join-Path $logDirectory "device-test-stderr.log") | Out-Null
    $startedEmulator = $true
}

try {
    $deadline = (Get-Date).AddMinutes(3)
    do {
        $serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
            ($_ -split '\s+')[0]
        } | Select-Object -First 1)
        $booted = if ($serial) { (& $adb -s $serial shell getprop sys.boot_completed 2>$null).Trim() } else { "" }
        if ($booted -eq "1") { break }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    if ($booted -ne "1") { throw "Android emulator did not finish booting within 3 minutes." }

    Push-Location (Join-Path $root "android")
    try {
        & $gradle :data:connectedDebugAndroidTest :app:connectedDebugAndroidTest --no-daemon --max-workers=1
        if ($LASTEXITCODE -ne 0) { throw "Android device tests failed." }
    } finally {
        Pop-Location
    }

    $reports = @("data", "app") | ForEach-Object {
        $directory = Join-Path $root "android\$_\build\outputs\androidTest-results\connected\debug"
        Get-ChildItem $directory -Filter "TEST-*.xml" -ErrorAction SilentlyContinue
    }
    if ($reports.Count -lt 2) { throw "Android device test XML reports were not generated for both data and app modules." }
    $tests = 0
    $failures = 0
    $errors = 0
    $skipped = 0
    foreach ($report in $reports) {
        [xml]$result = Get-Content -LiteralPath $report.FullName
        $tests += [int]$result.testsuite.tests
        $failures += [int]$result.testsuite.failures
        $errors += [int]$result.testsuite.errors
        $skipped += [int]$result.testsuite.skipped
    }
    if ($tests -lt 40 -or $failures -ne 0 -or $errors -ne 0 -or $skipped -ne 0) {
        throw "Device evidence gate failed: tests=$tests failures=$failures errors=$errors skipped=$skipped"
    }
    Write-Host "DEVICE_TEST_GATE=GO tests=$tests failures=$failures errors=$errors skipped=$skipped api=$(& $adb -s $serial shell getprop ro.build.version.sdk)"
    Write-Host "REPORTS=$($reports.FullName -join ';')"
} finally {
    if ($startedEmulator -and -not $KeepEmulator -and $serial) {
        & $adb -s $serial emu kill | Out-Null
    }
}
