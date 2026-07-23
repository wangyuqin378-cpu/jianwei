param(
    [string]$ApkPath = "",
    [ValidateRange(1.0, 2.0)]
    [double]$FontScale = 1.5
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "android-smoke-media-fixture.ps1")
. (Join-Path $PSScriptRoot "android-ui-hierarchy.ps1")
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $root ".tooling\android-sdk\platform-tools\adb.exe"
$apk = if ($ApkPath) { (Resolve-Path -LiteralPath $ApkPath).Path } else {
    Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
}
$resultDirectory = Join-Path $root ".tooling\accessibility-smoke-results"
$packageName = "cn.jianwei.app"
$activity = "$packageName/.MainActivity"
$utf8 = [Text.Encoding]::UTF8
$onboardingText = $utf8.GetString([Convert]::FromBase64String("6K6p5pel5bi454Wn54mH6YeN5paw5byA5Y+j"))
$continueText = $utf8.GetString([Convert]::FromBase64String("57un57ut"))
$automaticText = $utf8.GetString([Convert]::FromBase64String("6Ieq5Yqo5Y+R546w77yI5o6o6I2Q77yJ"))
$pickerText = $utf8.GetString([Convert]::FromBase64String("5LuF6YCJ5oup54Wn54mH"))
$dailyTabText = $utf8.GetString([Convert]::FromBase64String("5q+P5pel"))
$dailyCardsText = $utf8.GetString([Convert]::FromBase64String("5q+P5pel5Y2h54mH"))
$pickerOnlyEmptyText = $utf8.GetString([Convert]::FromBase64String("5YWI6YCJ5oup5LiA5byg54Wn54mH"))
$pickerOnlyAccessText = $utf8.GetString([Convert]::FromBase64String("54Wn54mH5p2D6ZmQ77ya5LuF5omL5Yqo6YCJ5oup"))
$shareTitleText = $utf8.GetString([Convert]::FromBase64String("5a+85YWl5YiG5Lqr55qE5Zu+54mH77yf"))
$shareActionText = $utf8.GetString([Convert]::FromBase64String("5a+85YWl5bm25YiG5p6Q"))
$cancelText = $utf8.GetString([Convert]::FromBase64String("5Y+W5raI"))
$fontScaleValue = $FontScale.ToString("0.##", [Globalization.CultureInfo]::InvariantCulture)

foreach ($required in @($adb, $apk)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing accessibility smoke dependency: $required" }
}

$serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
    ($_ -split '\s+')[0]
} | Select-Object -First 1)
if (-not $serial) { throw "No running Android emulator was found." }
if ((& $adb -s $serial shell getprop ro.build.version.sdk).Trim() -ne "34") {
    throw "The accessibility smoke gate requires the API 34 AVD."
}

New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
$originalSize = (& $adb -s $serial shell wm size) -join "`n"
$originalDensity = (& $adb -s $serial shell wm density) -join "`n"
$originalFontScale = (& $adb -s $serial shell settings get system font_scale).Trim()

function Invoke-AdbChecked {
    param([string[]]$Arguments)
    & $adb -s $serial @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb command failed: $($Arguments -join ' ')" }
}

function Save-Ui {
    param([string]$Name)
    $remote = "/sdcard/jianwei-a11y-$Name.xml"
    $local = Join-Path $resultDirectory "$Name.xml"
    [xml]$document = Save-AndroidUiHierarchy -Adb $adb -Serial $serial -RemotePath $remote -LocalPath $local
    return ,$document
}

function Find-TextNode {
    param([xml]$Document, [string]$Expected)
    $node = $Document.SelectSingleNode("//node[@text=`"$Expected`"]")
    if (-not $node) { throw "UI did not contain expected text: $Expected" }
    return $node
}

function Find-ContentDescriptionNode {
    param([xml]$Document, [string]$Expected)
    $node = $Document.SelectSingleNode("//node[@content-desc=`"$Expected`"]")
    if (-not $node) { throw "UI did not contain expected content description: $Expected" }
    return $node
}

function Get-ClickableNode {
    param($Node)
    while ($Node -and $Node.Name -eq "node" -and $Node.clickable -ne "true") { $Node = $Node.ParentNode }
    if (-not $Node -or $Node.Name -ne "node") { throw "Expected UI text has no clickable ancestor." }
    return $Node
}

function Get-Bounds {
    param($Node)
    if ($Node.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw "Invalid UI bounds: $($Node.bounds)" }
    return @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3], [int]$Matches[4])
}

function Assert-VisibleTarget {
    param($Node, [string]$Name)
    $bounds = Get-Bounds $Node
    if ($bounds[0] -lt 0 -or $bounds[1] -lt 0 -or $bounds[2] -gt 720 -or $bounds[3] -gt 1280) {
        throw "$Name target is outside the 720x1280 viewport: $($Node.bounds)"
    }
    # The test forces 360 dpi, so 44 dp is 99 physical pixels.
    $minimumTargetPixels = [int][Math]::Ceiling(44 * 360 / 160)
    if (($bounds[2] - $bounds[0]) -lt $minimumTargetPixels -or ($bounds[3] - $bounds[1]) -lt $minimumTargetPixels) {
        throw "$Name target is smaller than 44dp: $($Node.bounds)"
    }
}

function Tap-Text {
    param([xml]$Document, [string]$Text, [string]$Name)
    $target = Get-ClickableNode (Find-TextNode $Document $Text)
    Assert-VisibleTarget $target $Name
    $bounds = Get-Bounds $target
    Invoke-AdbChecked @("shell", "input", "tap", [string](($bounds[0] + $bounds[2]) / 2), [string](($bounds[1] + $bounds[3]) / 2))
}

function ConvertTo-SqlChar {
    param([string]$Value)
    $codePoints = $Value.ToCharArray() | ForEach-Object { [int]$_ }
    if ($codePoints.Count -eq 0) { return "char()" }
    return "char($($codePoints -join ','))"
}

function Invoke-AppSqlite {
    param([string]$Database, [string]$Sql)
    $output = (& $adb -s $serial shell run-as $packageName /system/bin/sqlite3 $Database "'$Sql'" 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "App sqlite command failed for ${Database}:`n$output" }
    return $output.Trim()
}

try {
    Invoke-AdbChecked @("shell", "wm", "size", "720x1280")
    Invoke-AdbChecked @("shell", "wm", "density", "360")
    Invoke-AdbChecked @("shell", "settings", "put", "system", "font_scale", $fontScaleValue)
    Invoke-AdbChecked @("install", "-r", $apk)
    Invoke-AdbChecked @("shell", "pm", "clear", $packageName)
    Invoke-AdbChecked @("logcat", "-c")
    Invoke-AdbChecked @("shell", "am", "start", "-W", "-n", $activity)
    Start-Sleep -Seconds 2

    $stepOne = Save-Ui "step-1"
    Find-TextNode $stepOne $onboardingText | Out-Null
    Tap-Text $stepOne $continueText "step 1 continue"
    Start-Sleep -Milliseconds 600
    $stepTwo = Save-Ui "step-2"
    Tap-Text $stepTwo $continueText "step 2 continue"
    Start-Sleep -Milliseconds 600
    1..3 | ForEach-Object {
        Invoke-AdbChecked @("shell", "input", "swipe", "360", "1100", "360", "300", "500")
        Start-Sleep -Milliseconds 300
    }
    $stepThree = Save-Ui "step-3"
    $automatic = Get-ClickableNode (Find-TextNode $stepThree $automaticText)
    $picker = Get-ClickableNode (Find-TextNode $stepThree $pickerText)
    Assert-VisibleTarget $automatic "automatic discovery"
    Assert-VisibleTarget $picker "photo picker"

    Tap-Text $stepThree $pickerText "photo picker"
    Start-Sleep -Seconds 1
    $systemPicker = Save-Ui "system-photo-picker"
    $foreignPackages = @($systemPicker.SelectNodes("//node[@package != '$packageName']") | Where-Object { $_.package })
    if ($foreignPackages.Count -eq 0) { throw "Photo picker did not leave the app for a system-owned selection surface." }
    Invoke-AdbChecked @("shell", "input", "keyevent", "BACK")
    Start-Sleep -Seconds 1
    $pickerCancelledHome = Save-Ui "picker-cancelled-home"
    Find-TextNode $pickerCancelledHome $dailyTabText | Out-Null
    Find-ContentDescriptionNode $pickerCancelledHome $dailyCardsText | Out-Null
    Find-TextNode $pickerCancelledHome $pickerOnlyEmptyText | Out-Null
    Find-TextNode $pickerCancelledHome $pickerOnlyAccessText | Out-Null
    $analysisWorkNames = @(
        "jianwei-initial-analysis",
        "jianwei-imported-analysis",
        "jianwei-photo-access-reconciliation",
        "jianwei-daily-card-sync",
        "jianwei-daily-analysis-pipeline"
    ) | ForEach-Object { ConvertTo-SqlChar $_ }
    $pickerCancelAnalysisWork = Invoke-AppSqlite "no_backup/androidx.work.workdb" "SELECT count(*) FROM WorkName WHERE name IN ($($analysisWorkNames -join ','));"
    if ($pickerCancelAnalysisWork -ne "0") {
        throw "Picker-only cancellation unexpectedly scheduled analysis work: count=$pickerCancelAnalysisWork"
    }

    $smokeImageUri = New-AndroidSmokeImageUri $adb $serial
    try {
        Invoke-AdbChecked @(
            "shell", "am", "start", "-W",
            "-a", "android.intent.action.SEND", "-t", "image/png", "-f", "0x00000001",
            "--eu", "android.intent.extra.STREAM", $smokeImageUri,
            "-n", "$packageName/.ShareReceiverActivity"
        )
        Start-Sleep -Seconds 1
        $share = Save-Ui "share-confirmation"
        Find-TextNode $share $shareTitleText | Out-Null
        $shareAction = Get-ClickableNode (Find-TextNode $share $shareActionText)
        $cancel = Get-ClickableNode (Find-TextNode $share $cancelText)
        Assert-VisibleTarget $shareAction "share confirmation"
        Assert-VisibleTarget $cancel "share cancellation"
        Invoke-AdbChecked @("shell", "input", "keyevent", "BACK")
    } finally {
        Remove-AndroidSmokeImageUri $adb $serial $smokeImageUri
    }

    $crash = (& $adb -s $serial logcat -d -b crash) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($crash)) { throw "Android crash buffer is not empty:`n$crash" }
    Write-Host "ACCESSIBILITY_SMOKE_GATE=GO widthDp=320 fontScale=$fontScaleValue onboarding=1 pickerCancelHome=1 pickerCancelAnalysisWork=0 interests=1 shareConsent=1 targets=5 crashes=0 api=34"
    Write-Host "RESULTS=$resultDirectory"
} finally {
    if ($originalSize -match 'Override size: (\d+x\d+)') {
        & $adb -s $serial shell wm size $Matches[1] | Out-Null
    } else {
        & $adb -s $serial shell wm size reset | Out-Null
    }
    if ($originalDensity -match 'Override density: (\d+)') {
        & $adb -s $serial shell wm density $Matches[1] | Out-Null
    } else {
        & $adb -s $serial shell wm density reset | Out-Null
    }
    if ($originalFontScale -and $originalFontScale -ne "null") {
        & $adb -s $serial shell settings put system font_scale $originalFontScale | Out-Null
    } else {
        & $adb -s $serial shell settings delete system font_scale | Out-Null
    }
}
