param(
    [string]$ApkPath = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "android-smoke-media-fixture.ps1")
. (Join-Path $PSScriptRoot "android-ui-hierarchy.ps1")
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $root ".tooling\android-sdk\platform-tools\adb.exe"
$apk = if ($ApkPath) { (Resolve-Path -LiteralPath $ApkPath).Path } else {
    Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
}
$resultDirectory = Join-Path $root ".tooling\talkback-smoke-results"
$packageName = "cn.jianwei.app"
$activity = "$packageName/.MainActivity"
$talkBackPackage = "com.google.android.marvin.talkback"
$talkBackComponent = "$talkBackPackage/com.google.android.marvin.talkback.TalkBackService"
$utf8 = [Text.Encoding]::UTF8
$automaticText = $utf8.GetString([Convert]::FromBase64String("6Ieq5Yqo5Y+R546w77yI5o6o6I2Q77yJ"))
$pickerText = $utf8.GetString([Convert]::FromBase64String("5LuF6YCJ5oup54Wn54mH"))
$cancelText = $utf8.GetString([Convert]::FromBase64String("5Y+W5raI"))
$shareActionText = $utf8.GetString([Convert]::FromBase64String("5a+85YWl5bm25YiG5p6Q"))

foreach ($required in @($adb, $apk)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing TalkBack smoke dependency: $required" }
}

$serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
    ($_ -split '\s+')[0]
} | Select-Object -First 1)
if (-not $serial) { throw "No running Android emulator was found." }
if ((& $adb -s $serial shell getprop ro.build.version.sdk).Trim() -ne "34") {
    throw "The TalkBack reference smoke gate requires the API 34 AVD."
}
if (-not ((& $adb -s $serial shell pm list packages $talkBackPackage) -match [regex]::Escape($talkBackPackage))) {
    throw "The API 34 AVD does not contain the reference Google TalkBack package."
}

New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
$originalServices = (& $adb -s $serial shell settings get secure enabled_accessibility_services).Trim()
$originalAccessibility = (& $adb -s $serial shell settings get secure accessibility_enabled).Trim()
$talkBackPackageState = (& $adb -s $serial shell dumpsys package $talkBackPackage) -join "`n"
$notificationWasGranted = $talkBackPackageState -match 'android\.permission\.POST_NOTIFICATIONS: granted=true'

function Invoke-AdbChecked {
    param([string[]]$Arguments)
    & $adb -s $serial @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb command failed: $($Arguments -join ' ')" }
}

function Save-Ui {
    param([string]$Name)
    $remote = "/sdcard/jianwei-talkback-$Name.xml"
    $local = Join-Path $resultDirectory "$Name.xml"
    [xml]$document = Save-AndroidUiHierarchy -Adb $adb -Serial $serial -RemotePath $remote -LocalPath $local
    return ,$document
}

function Assert-Text {
    param([xml]$Document, [string]$Expected)
    if (-not $Document.SelectSingleNode("//node[@text=`"$Expected`"]")) {
        throw "UI did not contain expected text: $Expected"
    }
}

function Wait-UiText {
    param(
        [string]$Name,
        [string]$Expected,
        [int]$TimeoutSeconds = 10
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $attempt = 0
    do {
        Start-Sleep -Milliseconds 500
        $document = Save-Ui "$Name-$attempt"
        if ($document.SelectSingleNode("//node[@text=`"$Expected`"]")) { return ,$document }
        $attempt += 1
    } while ((Get-Date) -lt $deadline)
    throw "UI did not reach expected text within ${TimeoutSeconds}s: $Expected"
}

function Get-FocusedTargetText {
    param([xml]$Document)
    $focused = $Document.SelectSingleNode("//node[@focused='true' and @focusable='true']")
    if (-not $focused) { throw "No keyboard-focusable UI target was focused while TalkBack was bound." }
    $texts = @()
    if ($focused.text) { $texts += [string]$focused.text }
    $texts += @($focused.SelectNodes(".//node[@text!='']") | ForEach-Object { [string]$_.text })
    return ($texts -join " | ")
}

function Restore-SecureSetting {
    param([string]$Name, [string]$Value, [string]$Fallback)
    if ($Value -and $Value -ne "null") {
        & $adb -s $serial shell settings put secure $Name $Value | Out-Null
    } elseif ($Fallback) {
        & $adb -s $serial shell settings put secure $Name $Fallback | Out-Null
    } else {
        & $adb -s $serial shell settings delete secure $Name | Out-Null
    }
}

try {
    Invoke-AdbChecked @("install", "-r", $apk)
    Invoke-AdbChecked @("shell", "pm", "clear", $packageName)
    Invoke-AdbChecked @("logcat", "-c")
    if (-not $notificationWasGranted) {
        Invoke-AdbChecked @("shell", "pm", "grant", $talkBackPackage, "android.permission.POST_NOTIFICATIONS")
    }
    Invoke-AdbChecked @("shell", "settings", "put", "secure", "enabled_accessibility_services", $talkBackComponent)
    Invoke-AdbChecked @("shell", "settings", "put", "secure", "accessibility_enabled", "1")
    Start-Sleep -Seconds 3

    $accessibilityState = (& $adb -s $serial shell dumpsys accessibility) -join "`n"
    if ($accessibilityState -notmatch 'Bound services:\{Service\[label=TalkBack') {
        throw "The Google TalkBack service was not bound."
    }
    if ($accessibilityState -notmatch [regex]::Escape($talkBackComponent)) {
        throw "The Google TalkBack component was not enabled."
    }

    Invoke-AdbChecked @("shell", "am", "start", "-W", "-n", $activity)
    Start-Sleep -Seconds 2
    Invoke-AdbChecked @("shell", "input", "keyevent", "TAB")
    Start-Sleep -Milliseconds 500
    $firstFocus = Get-FocusedTargetText (Save-Ui "onboarding-1-focus")
    Invoke-AdbChecked @("shell", "input", "keyevent", "ENTER")
    $stepTwo = Wait-UiText "onboarding-2" "2 / 3"

    Invoke-AdbChecked @("shell", "input", "keyevent", "TAB")
    Start-Sleep -Milliseconds 500
    $secondFocus = Get-FocusedTargetText (Save-Ui "onboarding-2-focus")
    Invoke-AdbChecked @("shell", "input", "keyevent", "ENTER")
    $stepThree = Wait-UiText "onboarding-3" "3 / 3"
    Assert-Text $stepThree $automaticText
    Assert-Text $stepThree $pickerText

    $smokeImageUri = New-AndroidSmokeImageUri $adb $serial
    try {
        Invoke-AdbChecked @(
            "shell", "am", "start", "-W",
            "-a", "android.intent.action.SEND", "-t", "image/png", "-f", "0x00000001",
            "--eu", "android.intent.extra.STREAM", $smokeImageUri,
            "-n", "$packageName/.ShareReceiverActivity"
        )
        Start-Sleep -Seconds 1
        Invoke-AdbChecked @("shell", "input", "keyevent", "TAB")
        Start-Sleep -Milliseconds 400
        $shareFocusOne = Get-FocusedTargetText (Save-Ui "share-focus-1")
        Invoke-AdbChecked @("shell", "input", "keyevent", "TAB")
        Start-Sleep -Milliseconds 400
        $shareFocusTwo = Get-FocusedTargetText (Save-Ui "share-focus-2")
        if ($shareFocusOne -eq $shareFocusTwo) { throw "Share confirmation focus did not advance." }
        $shareFocusText = "$shareFocusOne | $shareFocusTwo"
        if ($shareFocusText -notmatch [regex]::Escape($cancelText) -or $shareFocusText -notmatch [regex]::Escape($shareActionText)) {
            throw "Share confirmation focus order did not cover both actions."
        }
    } finally {
        Remove-AndroidSmokeImageUri $adb $serial $smokeImageUri
    }

    $crash = (& $adb -s $serial logcat -d -b crash) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($crash)) { throw "Android crash buffer is not empty:`n$crash" }
    Write-Host "TALKBACK_REFERENCE_GATE=GO serviceBound=1 onboardingFocus=2 shareFocus=2 crashes=0 spokenOutput=0 humanAudit=0 api=34"
    Write-Host "RESULTS=$resultDirectory"
} finally {
    Restore-SecureSetting "enabled_accessibility_services" $originalServices ""
    Restore-SecureSetting "accessibility_enabled" $originalAccessibility "0"
    if (-not $notificationWasGranted) {
        & $adb -s $serial shell pm revoke $talkBackPackage android.permission.POST_NOTIFICATIONS | Out-Null
    }
}
