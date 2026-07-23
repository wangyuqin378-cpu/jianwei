param(
    [string]$ApkPath = "",
    [switch]$SkipPrivateDatabaseChecks
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "android-ui-hierarchy.ps1")
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $root ".tooling\android-sdk\platform-tools\adb.exe"
$apk = if ($ApkPath) { (Resolve-Path -LiteralPath $ApkPath).Path } else {
    Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
}
$resultDirectory = Join-Path $root ".tooling\widget-smoke-results"
$packageName = "cn.jianwei.app"
$activity = "$packageName/.MainActivity"
$providerName = "$packageName/$packageName.widget.DailyWidgetReceiver"
$launcherPackage = "com.google.android.apps.nexuslauncher"
$utf8 = [Text.Encoding]::UTF8
$addWidgetText = $utf8.GetString([Convert]::FromBase64String("5re75Yqg5qGM6Z2i57uE5Lu2"))
$descriptionText = $utf8.GetString([Convert]::FromBase64String("5LuO5L2g55qE54Wn54mH6YeM5Y+R546w5pel5bi45Ya355+l6K+G"))
$appNameText = $utf8.GetString([Convert]::FromBase64String("6KeB5b6u"))
$seededCardTitleText = $utf8.GetString([Convert]::FromBase64String("5omr5bia"))
$emptyWidgetText = $utf8.GetString([Convert]::FromBase64String("5omT5byAIEFwcCDpgInmi6nnhafniYfvvIzlh4blpIfnrKzkuIDlvKDnn6Xor4bljaHjgII="))
$widgetSizeText = $utf8.GetString([Convert]::FromBase64String("MiDDlyAy"))

foreach ($required in @($adb, $apk)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing widget smoke dependency: $required" }
}

$serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
    ($_ -split '\s+')[0]
} | Select-Object -First 1)
if (-not $serial) { throw "No running Android emulator was found." }

$api = (& $adb -s $serial shell getprop ro.build.version.sdk).Trim()
$size = (& $adb -s $serial shell wm size | Select-String '1080x2400')
if ($api -ne "34" -or -not $size) {
    throw "The deterministic widget smoke gate requires the jianwei API 34 AVD at 1080x2400; api=$api."
}

New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null

function Invoke-AdbChecked {
    param([string[]]$Arguments)
    & $adb -s $serial @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb command failed: $($Arguments -join ' ')" }
}

function Save-Ui {
    param([string]$Name)
    $remote = "/sdcard/jianwei-widget-$Name.xml"
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

function Get-ClickableNode {
    param($Node)
    while ($Node -and $Node.Name -eq "node" -and $Node.clickable -ne "true") { $Node = $Node.ParentNode }
    if (-not $Node -or $Node.Name -ne "node") { throw "Expected UI text has no clickable ancestor." }
    return $Node
}

function Tap-Text {
    param([xml]$Document, [string]$Text)
    $target = Get-ClickableNode (Find-TextNode $Document $Text)
    if ($target.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') {
        throw "Invalid UI bounds: $($target.bounds)"
    }
    Invoke-AdbChecked @(
        "shell", "input", "tap",
        [string](([int]$Matches[1] + [int]$Matches[3]) / 2),
        [string](([int]$Matches[2] + [int]$Matches[4]) / 2)
    )
}

function Get-BoundWidgetCount {
    $dump = (& $adb -s $serial shell dumpsys appwidget) -join "`n"
    $widgetsSection = ($dump -split '(?m)^\s*Hosts:\s*$')[0] -split '(?m)^\s*Widgets:\s*$' | Select-Object -Last 1
    $blocks = [regex]::Matches($widgetsSection, '(?ms)^\s+\[\d+\] id=\d+.*?(?=^\s+\[\d+\] id=|\z)')
    return @($blocks | Where-Object {
        $_.Value.Contains("pkg:$launcherPackage") -and $_.Value.Contains($providerName)
    }).Count
}

$appSmoke = Join-Path $PSScriptRoot "run-android-app-smoke-windows.ps1"
& $appSmoke -ApkPath $apk -SkipPrivateDatabaseChecks:$SkipPrivateDatabaseChecks -PrepareWidgetFixture:(-not $SkipPrivateDatabaseChecks)
if ($LASTEXITCODE -ne 0) { throw "The prerequisite app smoke gate failed." }

Invoke-AdbChecked @("shell", "am", "force-stop", $packageName)
Invoke-AdbChecked @("shell", "am", "start", "-W", "-n", $activity)
Start-Sleep -Seconds 2
$appHome = Save-Ui "app-home"
$before = Get-BoundWidgetCount
Tap-Text $appHome $addWidgetText
Start-Sleep -Seconds 2

$pinSheet = Save-Ui "pin-sheet"
foreach ($expected in @($appNameText, $descriptionText, $widgetSizeText, "Add to home screen")) {
    [void](Find-TextNode $pinSheet $expected)
}
Tap-Text $pinSheet "Add to home screen"
Start-Sleep -Seconds 3
Invoke-AdbChecked @("shell", "input", "keyevent", "HOME")
Start-Sleep -Seconds 2

$after = Get-BoundWidgetCount
if ($after -le $before) {
    throw "Launcher widget binding count did not increase: before=$before after=$after"
}

$launcher = Save-Ui "launcher"
$launcherXml = $launcher.OuterXml
$expectedWidgetText = if ($SkipPrivateDatabaseChecks) { $emptyWidgetText } else { $seededCardTitleText }
if (-not $launcherXml.Contains($appNameText) -or -not $launcherXml.Contains($expectedWidgetText)) {
    throw "Launcher did not render the widget state produced by the prerequisite app smoke."
}

$appWidgetDump = (& $adb -s $serial shell dumpsys appwidget) -join "`n"
Set-Content -Encoding UTF8 -LiteralPath (Join-Path $resultDirectory "appwidget.txt") -Value $appWidgetDump
$crash = (& $adb -s $serial logcat -d -b crash) -join "`n"
if (-not [string]::IsNullOrWhiteSpace($crash)) {
    throw "Android crash buffer is not empty:`n$crash"
}

$widgetStateEvidence = if ($SkipPrivateDatabaseChecks) { "emptyState=1" } else { "cachedCard=1" }
Write-Host "WIDGET_SMOKE_GATE=GO preview=1 bound=1 rendered=1 $widgetStateEvidence before=$before after=$after crashes=0 api=$api"
Write-Host "RESULTS=$resultDirectory"
