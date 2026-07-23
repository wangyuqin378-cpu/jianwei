param(
    [string]$ApkPath = "",
    [switch]$SkipPrivateDatabaseChecks,
    [switch]$PrepareWidgetFixture
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "android-ui-hierarchy.ps1")
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $root ".tooling\android-sdk\platform-tools\adb.exe"
$apk = if ($ApkPath) { (Resolve-Path -LiteralPath $ApkPath).Path } else {
    Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
}
$resultDirectory = Join-Path $root ".tooling\app-smoke-results"
$packageName = "cn.jianwei.app"
$activity = "$packageName/.MainActivity"
$utf8 = [Text.Encoding]::UTF8
$onboardingText = $utf8.GetString([Convert]::FromBase64String("6K6p5pel5bi454Wn54mH6YeN5paw5byA5Y+j"))
$continueText = $utf8.GetString([Convert]::FromBase64String("57un57ut"))
$automaticText = $utf8.GetString([Convert]::FromBase64String("6Ieq5Yqo5Y+R546w77yI5o6o6I2Q77yJ"))
$deniedText = $utf8.GetString([Convert]::FromBase64String("54Wn54mH5p2D6ZmQ77ya5LuF5omL5Yqo6YCJ5oup"))
$deniedEmptyTitleText = $utf8.GetString([Convert]::FromBase64String("5YWI6YCJ5oup5LiA5byg54Wn54mH"))
$deniedFallbackText = $utf8.GetString([Convert]::FromBase64String("5rKh5pyJ55u45YaM6K6/6Zeu5p2D6ZmQ77yM5Zug5q2k5LiN5Lya6Ieq5Yqo5omr5o+P77yb5L2g5LuN5Y+v6YCJ5oup5oiW5YiG5Lqr54Wn54mH"))
$automaticScanStartedText = $utf8.GetString([Convert]::FromBase64String("5bey5byA5aeL5omr5o+P6L+RIDkwIOWkqeeFp+eJhw=="))
$fullText = $utf8.GetString([Convert]::FromBase64String("54Wn54mH5p2D6ZmQ77ya5YWo6YOo54Wn54mH"))
$partialText = $utf8.GetString([Convert]::FromBase64String("54Wn54mH5p2D6ZmQ77ya6YOo5YiG54Wn54mH"))
$shareTitleText = $utf8.GetString([Convert]::FromBase64String("5a+85YWl5YiG5Lqr55qE5Zu+54mH77yf"))
$shareActionText = $utf8.GetString([Convert]::FromBase64String("5a+85YWl5bm25YiG5p6Q"))
$exportMetricsText = $utf8.GetString([Convert]::FromBase64String("5a+85Ye65YaF5rWL5oql5ZGK"))
$trackItemText = $utf8.GetString([Convert]::FromBase64String("6K6+572u54mp5ZOB5o+Q6YaS"))
$confirmReminderText = $utf8.GetString([Convert]::FromBase64String("56Gu6K6k5bm25byA5ZCv5o+Q6YaS"))
$startDateText = $utf8.GetString([Convert]::FromBase64String("5ZCv55So5pel5pyf"))
$reminderPeriodText = $utf8.GetString([Convert]::FromBase64String("5o+Q6YaS5ZGo5pyf"))
$broomText = $utf8.GetString([Convert]::FromBase64String("5omr5bia"))
$oneHundredTwentyDaysText = $utf8.GetString([Convert]::FromBase64String("MTIwIOWkqQ=="))
$reminderActiveText = $utf8.GetString([Convert]::FromBase64String("54mp5ZOB5o+Q6YaS5bey5byA5ZCv"))
$updateReminderText = $utf8.GetString([Convert]::FromBase64String("5pu05paw54mp5ZOB5o+Q6YaS"))
$cancelReminderText = $utf8.GetString([Convert]::FromBase64String("5Y+W5raI54mp5ZOB5o+Q6YaS"))
$confirmCancelText = $utf8.GetString([Convert]::FromBase64String("56Gu6K6k5Y+W5raI"))
$saveReminderText = $utf8.GetString([Convert]::FromBase64String("5L+d5a2Y5o+Q6YaS"))
$deleteCloudText = $utf8.GetString([Convert]::FromBase64String("5Yig6Zmk5LqR56uv5pWw5o2u"))
$confirmDeleteCloudText = $utf8.GetString([Convert]::FromBase64String("56Gu6K6k5Yig6Zmk5LqR56uv5pWw5o2u77yf"))
$confirmDeleteActionText = $utf8.GetString([Convert]::FromBase64String("56Gu6K6k5Yig6Zmk"))
$permanentDeleteText = $utf8.GetString([Convert]::FromBase64String("5rC45LmF5Yig6Zmk5b2T5YmN5Yy/5ZCN6K6+5aSH"))
$cancelText = $utf8.GetString([Convert]::FromBase64String("5Y+W5raI"))
$pauseAnalysisText = $utf8.GetString([Convert]::FromBase64String("5pqC5YGc5YiG5p6Q"))
$saveKnowledgeCardText = $utf8.GetString([Convert]::FromBase64String("5pS26JeP6L+Z5byg55+l6K+G5Y2h"))
$savedKnowledgeCardText = $utf8.GetString([Convert]::FromBase64String("5bey5pS26JePIMK3IOeCueWHu+WPlua2iA=="))
$savedOneText = $utf8.GetString([Convert]::FromBase64String("5pS26JePIDE="))
$savedZeroText = $utf8.GetString([Convert]::FromBase64String("5pS26JePIDA="))
$noSavedCardsText = $utf8.GetString([Convert]::FromBase64String("6L+Y5rKh5pyJ5pS26JeP"))
$dailyCardsText = $utf8.GetString([Convert]::FromBase64String("5q+P5pel5Y2h54mH"))
$managePrivacyText = $utf8.GetString([Convert]::FromBase64String("566h55CG6ZqQ56eB5LiO5pWw5o2u"))

foreach ($required in @($adb, $apk)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing app smoke dependency: $required. Build the debug APK and start the Android 14 AVD first."
    }
}

$serial = (& $adb devices | Select-String '^emulator-\d+\s+device$' | ForEach-Object {
    ($_ -split '\s+')[0]
} | Select-Object -First 1)
if (-not $serial) { throw "No running Android emulator was found." }

$api = (& $adb -s $serial shell getprop ro.build.version.sdk).Trim()
$size = (& $adb -s $serial shell wm size | Select-String '1080x2400')
if ($api -ne "34" -or -not $size) {
    throw "The deterministic smoke gate requires the jianwei API 34 AVD at 1080x2400; api=$api."
}

New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null

function Invoke-AdbChecked {
    param([string[]]$Arguments)
    & $adb -s $serial @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb command failed: $($Arguments -join ' ')" }
}

function Start-App {
    Invoke-AdbChecked @("shell", "am", "force-stop", $packageName)
    Invoke-AdbChecked @("shell", "am", "start", "-W", "-n", $activity)
    Start-Sleep -Seconds 2
}

function Save-Ui {
    param([string]$Name)
    $remote = "/sdcard/jianwei-$Name.xml"
    $local = Join-Path $resultDirectory "$Name.xml"
    return Save-AndroidUiHierarchy -Adb $adb -Serial $serial -RemotePath $remote -LocalPath $local
}

function Wait-UiText {
    param(
        [string]$Name,
        [string]$Expected,
        [string]$State,
        [int]$TimeoutSeconds = 10,
        [switch]$ReturnNullOnTimeout
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $attempt = 0
    do {
        Start-Sleep -Milliseconds 500
        $xml = Save-Ui "$Name-$attempt"
        if ($xml.Contains($Expected)) { return $xml }
        $attempt += 1
    } while ((Get-Date) -lt $deadline)
    if ($ReturnNullOnTimeout) { return $null }
    throw "$State UI did not reach expected text within ${TimeoutSeconds}s: $Expected"
}

function Assert-UiText {
    param([string]$Xml, [string]$Expected, [string]$State)
    if (-not $Xml.Contains($Expected)) {
        throw "$State UI did not contain expected text: $Expected"
    }
}

function Tap-UiText {
    param([string]$Xml, [string]$Expected, [string]$State)
    [xml]$document = $Xml
    $node = $document.SelectSingleNode("//node[@text=`"$Expected`"]")
    if (-not $node) { throw "$State UI did not contain tappable text: $Expected" }
    while ($node -and $node.Name -eq "node" -and $node.clickable -ne "true") { $node = $node.ParentNode }
    if (-not $node -or $node.Name -ne "node") { throw "$State text has no clickable ancestor: $Expected" }
    if ($node.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw "$State has invalid bounds: $($node.bounds)" }
    $x = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
    $y = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
    Invoke-AdbChecked @("shell", "input", "tap", [string]$x, [string]$y)
}

function Tap-UiResource {
    param([string]$Xml, [string]$ResourceSuffix, [string]$State)
    [xml]$document = $Xml
    $node = $document.SelectSingleNode("//node[contains(@resource-id, '$ResourceSuffix')]")
    if (-not $node) { throw "$State UI did not contain tappable resource: $ResourceSuffix" }
    while ($node -and $node.Name -eq "node" -and $node.clickable -ne "true") { $node = $node.ParentNode }
    if (-not $node -or $node.Name -ne "node") { throw "$State resource has no clickable ancestor: $ResourceSuffix" }
    if ($node.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw "$State has invalid bounds: $($node.bounds)" }
    $x = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
    $y = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
    Invoke-AdbChecked @("shell", "input", "tap", [string]$x, [string]$y)
}

function ConvertTo-SqlChar {
    param([string]$Value)
    $codePoints = $Value.ToCharArray() | ForEach-Object { [int]$_ }
    if ($codePoints.Count -eq 0) { return "char()" }
    $expressions = for ($offset = 0; $offset -lt $codePoints.Count; $offset += 80) {
        $last = [Math]::Min($offset + 79, $codePoints.Count - 1)
        "char($($codePoints[$offset..$last] -join ','))"
    }
    return "($($expressions -join '||'))"
}

function Invoke-AppSqlite {
    param([string]$Database, [string]$Sql)
    # Keep the remote shell argument single-quoted and construct all text with
    # SQLite char(...), so fixture values cannot escape into shell or SQL syntax.
    $quotedSql = "'$Sql'"
    $output = (& $adb -s $serial shell run-as $packageName /system/bin/sqlite3 $Database $quotedSql 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "App sqlite command failed for ${Database}:`n$output" }
    return $output.Trim()
}

function Read-AppPrivateText {
    param([string]$Path)
    $output = (& $adb -s $serial shell run-as $packageName cat $Path 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Unable to read app-private evidence file: $Path`n$output" }
    return $output
}

function Find-UiTextWithScroll {
    param(
        [string]$Name,
        [string]$Expected,
        [string]$State,
        [int]$MaximumSwipes = 5
    )
    foreach ($attempt in 0..$MaximumSwipes) {
        $xml = Save-Ui "$Name-$attempt"
        if ($xml.Contains($Expected)) { return $xml }
        if ($attempt -lt $MaximumSwipes) {
            Invoke-AdbChecked @("shell", "input", "swipe", "540", "2050", "540", "450", "450")
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$State UI did not contain expected text after ${MaximumSwipes} swipes: $Expected"
}

function Find-PrivacyAction {
    param(
        [string]$Name,
        [string]$Expected,
        [string]$State,
        [int]$MaximumSwipes = 8
    )
    foreach ($attempt in 0..$MaximumSwipes) {
        $xml = Save-Ui "$Name-$attempt"
        if ($xml.Contains($Expected)) { return $xml }
        if ($xml.Contains($managePrivacyText)) {
            Tap-UiText $xml $managePrivacyText "$State privacy controls"
            Start-Sleep -Milliseconds 500
            $xml = Save-Ui "$Name-expanded-$attempt"
            if ($xml.Contains($Expected)) { return $xml }
        }
        if ($attempt -lt $MaximumSwipes) {
            Invoke-AdbChecked @("shell", "input", "swipe", "540", "2050", "540", "450", "450")
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$State UI did not contain expected privacy action after ${MaximumSwipes} swipes: $Expected"
}

function Advance-Onboarding {
    param(
        [string]$CurrentXml,
        [string]$CurrentMarker,
        [string]$TargetText,
        [string]$State
    )
    $latest = $CurrentXml
    foreach ($attempt in 0..1) {
        if (-not $latest.Contains($CurrentMarker)) {
            throw "$State changed to an unexpected screen before activation."
        }
        Tap-UiText $latest $continueText $State
        $next = Wait-UiText "$State-$attempt" $TargetText $State 6 -ReturnNullOnTimeout
        if ($next) { return $next }
        # Only retry when a fresh tree proves the first activation was lost and
        # the app is still on exactly the same onboarding step.
        $latest = Save-Ui "$State-retry-$attempt"
        if ($latest.Contains($TargetText)) { return $latest }
    }
    throw "$State did not advance after two confirmed activation attempts."
}

function New-SmokeImageUri {
    $name = "jianwei-smoke-$([guid]::NewGuid().ToString('N')).png"
    $path = "/sdcard/Pictures/$name"
    Invoke-AdbChecked @("shell", "screencap", "-p", $path)
    Invoke-AdbChecked @("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file://$path")
    Start-Sleep -Seconds 2
    $rows = (& $adb -s $serial shell content query --uri content://media/external/images/media --projection _id:_display_name) -join "`n"
    $row = $rows -split "`n" | Where-Object { $_ -like "*$name*" } | Select-Object -Last 1
    if ($row -notmatch '_id=(\d+)') {
        & $adb -s $serial shell rm -f $path | Out-Null
        throw "Could not create a real MediaStore fixture for share smoke."
    }
    return "content://media/external/images/media/$($Matches[1])"
}

function Remove-SmokeImageUri {
    param([string]$Uri)
    if ($Uri -match '/(\d+)$') {
        & $adb -s $serial shell content delete --uri $Uri --where "_id=$($Matches[1])" | Out-Null
    }
}

# The reference AVD is disposable. Remove any previous build first because
# debug and local R8 smoke APKs intentionally use different test signatures.
& $adb -s $serial uninstall $packageName | Out-Null
Invoke-AdbChecked @("install", $apk)
Invoke-AdbChecked @("shell", "pm", "clear", $packageName)
Invoke-AdbChecked @("logcat", "-c")
Start-App

$consentEvidence = "preConsentAnalysisWork=notChecked deniedAnalysisWork=notChecked deniedFallback=1"
if (-not $SkipPrivateDatabaseChecks) {
    $analysisWorkNames = @(
        "jianwei-initial-analysis",
        "jianwei-imported-analysis",
        "jianwei-photo-access-reconciliation",
        "jianwei-daily-card-sync",
        "jianwei-daily-analysis-pipeline"
    ) | ForEach-Object { ConvertTo-SqlChar $_ }
    $automaticWorkNames = @(
        "jianwei-initial-analysis",
        "jianwei-photo-access-reconciliation",
        "jianwei-daily-card-sync",
        "jianwei-daily-analysis-pipeline"
    ) | ForEach-Object { ConvertTo-SqlChar $_ }
    $reconciliationWorkName = ConvertTo-SqlChar "jianwei-photo-access-reconciliation"
    $scanWorkerClassMarker = ConvertTo-SqlChar "ScanWorker"
    $partialInputHexMarker = ConvertTo-SqlChar "5041525449414C"
    $preConsentAnalysisWorkSql = "SELECT count(*) FROM WorkName WHERE name IN ($($analysisWorkNames -join ','));"
    $activeAutomaticWorkSql = "SELECT count(*) FROM WorkSpec INNER JOIN WorkName ON WorkName.work_spec_id = WorkSpec.id WHERE WorkName.name IN ($($automaticWorkNames -join ',')) AND WorkSpec.state IN (0,1,4);"
    $partialReconciliationSql = "SELECT count(*) FROM WorkSpec INNER JOIN WorkName ON WorkName.work_spec_id = WorkSpec.id WHERE WorkName.name = $reconciliationWorkName AND instr(WorkSpec.worker_class_name, $scanWorkerClassMarker) > 0 AND instr(hex(WorkSpec.input), $partialInputHexMarker) > 0;"
    $preConsentAnalysisWork = Invoke-AppSqlite "no_backup/androidx.work.workdb" $preConsentAnalysisWorkSql
    if ($preConsentAnalysisWork -ne "0") {
        throw "App scheduled analysis work before onboarding consent: count=$preConsentAnalysisWork"
    }
    $consentEvidence = "preConsentAnalysisWork=0 deniedAnalysisWork=pending deniedFallback=1"
}

$onboarding = Save-Ui "onboarding"
Assert-UiText $onboarding $onboardingText "onboarding"

$onboardingStepTwo = Advance-Onboarding $onboarding "1 / 3" "2 / 3" "onboarding-step-2"
$onboardingStepThree = Advance-Onboarding $onboardingStepTwo "2 / 3" $automaticText "onboarding-step-3"
Tap-UiText $onboardingStepThree $automaticText "automatic discovery"
$permissionDialog = Wait-UiText "permission-dialog" "Allow all" "permission dialog"
Assert-UiText $permissionDialog "Allow all" "permission dialog"
Assert-UiText $permissionDialog "Select photos and videos" "permission dialog"
Assert-UiText $permissionDialog "permission_deny_button" "permission dialog"

Invoke-AdbChecked @("shell", "input", "tap", "540", "1540")
Start-Sleep -Seconds 2
$denied = Save-Ui "denied"
Assert-UiText $denied $deniedText "denied"
Assert-UiText $denied $deniedEmptyTitleText "denied fallback"
Assert-UiText $denied $deniedFallbackText "denied fallback"
if ($denied.Contains($automaticScanStartedText)) {
    throw "Denied permission UI falsely claimed automatic scanning started."
}
if (-not $SkipPrivateDatabaseChecks) {
    $deniedAnalysisWork = Invoke-AppSqlite "no_backup/androidx.work.workdb" $preConsentAnalysisWorkSql
    if ($deniedAnalysisWork -ne "0") {
        throw "App scheduled analysis work after photo access was denied: count=$deniedAnalysisWork"
    }
    $consentEvidence = "preConsentAnalysisWork=0 deniedAnalysisWork=0 deniedFallback=1"
}

# The Beta report stays on-device until the user explicitly exports it. Prove
# the production UI reaches the system chooser instead of silently uploading.
$privacyCenter = Find-PrivacyAction "beta-metrics-export" $exportMetricsText "beta metrics export"
Tap-UiText $privacyCenter $exportMetricsText "beta metrics export"
$exportChooser = Wait-UiText "beta-metrics-chooser" "local_beta_device_metrics" "beta metrics chooser"
if (
    -not $exportChooser.Contains('package="com.android.intentresolver"') -and
    -not $exportChooser.Contains('package="com.google.android.intentresolver"')
) {
    throw "Beta metrics export was not rendered by the Android system chooser."
}
foreach ($requiredReportField in @('schemaVersion', 'evidenceKind', 'evidenceId', 'appVersion', 'apkSha256')) {
    Assert-UiText $exportChooser $requiredReportField "beta metrics report"
}
foreach ($forbiddenReportField in @('mediaStoreId', 'installationId', 'deviceToken', 'localId', 'labels', 'latitude', 'longitude')) {
    if ($exportChooser.Contains($forbiddenReportField)) {
        throw "Beta metrics report exposed forbidden field: $forbiddenReportField"
    }
}
$activities = (& $adb -s $serial shell dumpsys activity activities) -join "`n"
if ($activities -notmatch '(?:com\.google\.android\.intentresolver|com\.android\.intentresolver)/[^\s]*ChooserActivity') {
    throw "Beta metrics export did not open the Android system chooser."
}
Invoke-AdbChecked @("shell", "input", "keyevent", "BACK")
Start-Sleep -Milliseconds 500

# A destructive cloud delete must stop at a separate confirmation checkpoint.
# Cancel it here so the rest of the smoke retains its anonymous test state.
$cloudDeleteScreen = Find-PrivacyAction "cloud-delete-action" $deleteCloudText "cloud delete action"
Tap-UiText $cloudDeleteScreen $deleteCloudText "cloud delete action"
$cloudDeleteDialog = Wait-UiText "cloud-delete-confirmation" $confirmDeleteCloudText "cloud delete confirmation"
Assert-UiText $cloudDeleteDialog $permanentDeleteText "cloud delete confirmation"
Tap-UiText $cloudDeleteDialog $cancelText "cloud delete confirmation"
Start-Sleep -Milliseconds 500

Invoke-AdbChecked @("shell", "pm", "grant", $packageName, "android.permission.READ_MEDIA_IMAGES")
Start-App
$full = Save-Ui "full"
Assert-UiText $full $fullText "full"
if (-not $SkipPrivateDatabaseChecks) {
    $fullAccessAnalysisWork = Invoke-AppSqlite "no_backup/androidx.work.workdb" $activeAutomaticWorkSql
    if ([int]$fullAccessAnalysisWork -lt 1) {
        throw "Full photo access did not create automatic discovery work."
    }
    $fullAccessPreferences = Read-AppPrivateText "shared_prefs/analysis_scheduler.xml"
    if (-not $fullAccessPreferences.Contains('<string name="photo_access">FULL</string>')) {
        throw "Full photo access was not persisted for the daily pipeline."
    }
}

Invoke-AdbChecked @("shell", "pm", "revoke", $packageName, "android.permission.READ_MEDIA_IMAGES")
Invoke-AdbChecked @("shell", "pm", "revoke", $packageName, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
Start-App
$revoked = Save-Ui "revoked"
Assert-UiText $revoked $deniedText "revoked"
Assert-UiText $revoked $deniedEmptyTitleText "revoked fallback"
if (-not $SkipPrivateDatabaseChecks) {
    $revokedAnalysisWork = Invoke-AppSqlite "no_backup/androidx.work.workdb" $activeAutomaticWorkSql
    if ($revokedAnalysisWork -ne "0") {
        throw "Automatic discovery work remained active after photo access was revoked: count=$revokedAnalysisWork"
    }
    $revokedAccessPreferences = Read-AppPrivateText "shared_prefs/analysis_scheduler.xml"
    if (-not $revokedAccessPreferences.Contains('<string name="photo_access">PICKER_ONLY</string>')) {
        throw "Revoked photo access did not narrow the persisted daily-pipeline scope."
    }
    $consentEvidence = "$consentEvidence revokedAutoWork=0"
}

Invoke-AdbChecked @("shell", "pm", "grant", $packageName, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
Start-App
$partial = Save-Ui "partial"
Assert-UiText $partial $partialText "partial"
if (-not $SkipPrivateDatabaseChecks) {
    $partialAccessPreferences = Read-AppPrivateText "shared_prefs/analysis_scheduler.xml"
    if (-not $partialAccessPreferences.Contains('<string name="photo_access">PARTIAL</string>')) {
        throw "Partial photo access did not replace the persisted full-access scope."
    }
    $partialReconciliation = Invoke-AppSqlite "no_backup/androidx.work.workdb" $partialReconciliationSql
    if ([int]$partialReconciliation -lt 1) {
        throw "Partial access did not enqueue a dedicated PARTIAL reconciliation scan."
    }
    $consentEvidence = "$consentEvidence partialScope=1 partialReconciliation=1"
}

$smokeImageUri = New-SmokeImageUri
try {
    Invoke-AdbChecked @(
        "shell", "am", "start", "-W",
        "-a", "android.intent.action.SEND",
        "-t", "image/png",
        "-f", "0x00000001",
        "--eu", "android.intent.extra.STREAM", $smokeImageUri,
        "-n", "$packageName/.ShareReceiverActivity"
    )
    Start-Sleep -Seconds 1
    $shareConfirmation = Save-Ui "share-confirmation"
    Assert-UiText $shareConfirmation $shareTitleText "share confirmation"
    Assert-UiText $shareConfirmation $shareActionText "share confirmation"
    Invoke-AdbChecked @("shell", "input", "keyevent", "BACK")
    Start-Sleep -Milliseconds 500
} finally {
    Remove-SmokeImageUri $smokeImageUri
}

# Prove that item tracking is an explicit, fail-closed flow. Seed only the
# disposable Debug app's local Room database, then operate the real UI. A
# non-debuggable Release APK cannot and must not expose run-as access; its R8
# runtime gate opts out of this block and reuses the Debug evidence instead.
$reminderEvidence = "reminderPrivateDbChecks=0"
$collectionEvidence = "collectionPrivateDbChecks=0"
if (-not $SkipPrivateDatabaseChecks) {
Invoke-AdbChecked @("shell", "am", "force-stop", $packageName)
$cardId = "smoke-card-$([guid]::NewGuid().ToString('N'))"
$sourceJson = '[{"sourceId":"smoke-source","title":"reference","url":"https://example.com/source","publisher":"reference","authority":"reference"}]'
$today = (Get-Date).ToString("yyyy-MM-dd")
$createdAtMillis = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$cardValues = @(
    (ConvertTo-SqlChar $cardId),
    (ConvertTo-SqlChar "smoke-candidate"),
    (ConvertTo-SqlChar ""),
    (ConvertTo-SqlChar "broom"),
    (ConvertTo-SqlChar "smoke-fact"),
    (ConvertTo-SqlChar $broomText),
    (ConvertTo-SqlChar "A broom fixture used to verify explicit reminder consent."),
    (ConvertTo-SqlChar "Local disposable emulator fixture"),
    "0.92",
    (ConvertTo-SqlChar $sourceJson),
    (ConvertTo-SqlChar "scheduled"),
    (ConvertTo-SqlChar $today),
    [string]$createdAtMillis
)
$insertCardSql = "INSERT OR REPLACE INTO knowledge_cards (cardId,candidateToken,photoUri,topicId,factId,title,body,personalContext,confidence,sources,status,scheduledDate,createdAtMillis) VALUES ($($cardValues -join ','));"
Invoke-AppSqlite "databases/jianwei.db" $insertCardSql | Out-Null

Start-App
$cardScreen = Wait-UiText "reminder-card" $broomText "reminder card"
if ($cardScreen.Contains("permission_deny_button")) {
    throw "Notification permission was requested before the user opened item tracking."
}
$saveActions = Find-UiTextWithScroll "save-card" $saveKnowledgeCardText "save knowledge card action"
Tap-UiText $saveActions $saveKnowledgeCardText "save knowledge card action"
$savedState = Wait-UiText "saved-card" $savedKnowledgeCardText "saved knowledge card state"
$savedCount = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM saved_cards WHERE cardId=$(ConvertTo-SqlChar $cardId) AND isSaved=1 AND feedbackSignaled=1;"
$saveOutboxCount = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM pending_feedback WHERE cardId=$(ConvertTo-SqlChar $cardId) AND action=$(ConvertTo-SqlChar 'SAVE');"
$saveAffinity = Invoke-AppSqlite "databases/jianwei.db" "SELECT printf('%.2f', weight) FROM topic_affinities WHERE topicId=$(ConvertTo-SqlChar 'broom');"
if ($savedCount -ne "1" -or $saveOutboxCount -ne "1" -or $saveAffinity -ne "0.50") {
    throw "Saving a card was not an atomic local collection/preference operation: saved=$savedCount outbox=$saveOutboxCount affinity=$saveAffinity"
}

# A process restart must preserve the collection. Removing and re-saving the card
# changes local visibility without duplicating the one-time SAVE preference signal.
Start-App
$savedTab = Wait-UiText "saved-tab-count" $savedOneText "saved collection count"
Tap-UiText $savedTab $savedOneText "saved collection tab"
$savedCollection = Wait-UiText "saved-collection-card" $savedKnowledgeCardText "saved collection card"
Assert-UiText $savedCollection $broomText "saved collection card"
Tap-UiText $savedCollection $savedKnowledgeCardText "remove saved knowledge card"
$emptyCollection = Wait-UiText "empty-saved-collection" $noSavedCardsText "empty saved collection"
Assert-UiText $emptyCollection $savedZeroText "empty saved collection count"
$unsavedCount = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM saved_cards WHERE cardId=$(ConvertTo-SqlChar $cardId) AND isSaved=0 AND feedbackSignaled=1;"
if ($unsavedCount -ne "1") { throw "Removing a saved card lost its one-time feedback tombstone." }
Tap-UiText $emptyCollection $dailyCardsText "daily cards tab"
$resaveActions = Find-UiTextWithScroll "resave-card" $saveKnowledgeCardText "resave knowledge card action"
Tap-UiText $resaveActions $saveKnowledgeCardText "resave knowledge card action"
$resavedCount = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM saved_cards WHERE cardId=$(ConvertTo-SqlChar $cardId) AND isSaved=1 AND feedbackSignaled=1;"
$resaveOutboxCount = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM pending_feedback WHERE cardId=$(ConvertTo-SqlChar $cardId) AND action=$(ConvertTo-SqlChar 'SAVE');"
$resaveAffinity = Invoke-AppSqlite "databases/jianwei.db" "SELECT printf('%.2f', weight) FROM topic_affinities WHERE topicId=$(ConvertTo-SqlChar 'broom');"
if ($resavedCount -ne "1" -or $resaveOutboxCount -ne "1" -or $resaveAffinity -ne "0.50") {
    throw "Re-saving duplicated the one-time SAVE signal: saved=$resavedCount outbox=$resaveOutboxCount affinity=$resaveAffinity"
}
$collectionEvidence = "collectionVisible=1 collectionRestart=1 collectionRemove=1 collectionResaveIdempotent=1"

$cardActions = Find-UiTextWithScroll "reminder-action" $trackItemText "item reminder action"
Tap-UiText $cardActions $trackItemText "item reminder action"
$reminderDialog = Wait-UiText "reminder-dialog" $confirmReminderText "item reminder dialog"
Assert-UiText $reminderDialog $broomText "item reminder dialog"
Assert-UiText $reminderDialog $startDateText "item reminder dialog"
Assert-UiText $reminderDialog $reminderPeriodText "item reminder dialog"
Tap-UiText $reminderDialog $oneHundredTwentyDaysText "item reminder dialog"
$expectedDueDate = (Get-Date).Date.AddDays(120).ToString("yyyy-MM-dd")
$updatedReminderDialog = Wait-UiText "reminder-120-days" $expectedDueDate "item reminder due date"
Tap-UiText $updatedReminderDialog $confirmReminderText "item reminder confirmation"

$notificationPermission = Wait-UiText "notification-permission" "permission_deny_button" "notification permission"
if (
    -not $notificationPermission.Contains('package="com.android.permissioncontroller"') -and
    -not $notificationPermission.Contains('package="com.google.android.permissioncontroller"')
) {
    throw "Notification permission was not rendered by the Android permission controller."
}
Tap-UiResource $notificationPermission "permission_deny_button" "notification permission"
Start-Sleep -Seconds 1
$workerClass = "cn.jianwei.app.ItemReminderWorker"
$workerCountSql = "SELECT count(*) FROM WorkSpec WHERE worker_class_name=$(ConvertTo-SqlChar $workerClass) AND state IN (0,1,4);"
$workerCount = Invoke-AppSqlite "no_backup/androidx.work.workdb" $workerCountSql
if ($workerCount -ne "0") {
    throw "Notification denial created item reminder work unexpectedly: count=$workerCount"
}

# With permission explicitly enabled, the same flow must succeed even though
# no backend is running: WorkManager is the local source of truth and Room
# keeps an outbox entry for later authenticated synchronization.
Invoke-AdbChecked @("shell", "pm", "grant", $packageName, "android.permission.POST_NOTIFICATIONS")
Start-App
$grantedCardActions = Find-UiTextWithScroll "reminder-granted-action" $trackItemText "granted item reminder action"
Tap-UiText $grantedCardActions $trackItemText "granted item reminder action"
$grantedReminderDialog = Wait-UiText "reminder-granted-dialog" $confirmReminderText "granted item reminder dialog"
Tap-UiText $grantedReminderDialog $confirmReminderText "granted item reminder confirmation"

$deadline = (Get-Date).AddSeconds(10)
do {
    Start-Sleep -Milliseconds 500
    $workerCount = Invoke-AppSqlite "no_backup/androidx.work.workdb" $workerCountSql
    $outboxCountSql = "SELECT count(*) FROM local_tracked_items WHERE cardId=$(ConvertTo-SqlChar $cardId) AND reminderDays=90 AND syncAction=$(ConvertTo-SqlChar 'UPSERT');"
    $outboxCount = Invoke-AppSqlite "databases/jianwei.db" $outboxCountSql
} while (($workerCount -ne "1" -or $outboxCount -ne "1") -and (Get-Date) -lt $deadline)
if ($workerCount -ne "1") {
    throw "Explicitly granted reminder did not create exactly one local WorkManager task: count=$workerCount"
}
if ($outboxCount -ne "1") {
    throw "Offline reminder did not retain exactly one cloud-sync outbox entry: count=$outboxCount"
}

$activeReminder = Wait-UiText "reminder-active" $reminderActiveText "active item reminder"
$updateActions = Find-UiTextWithScroll "reminder-update-action" $updateReminderText "item reminder update"
Tap-UiText $updateActions $updateReminderText "item reminder update"
$updateDialog = Wait-UiText "reminder-update-dialog" $saveReminderText "item reminder update dialog"
Assert-UiText $updateDialog $today "item reminder update dialog"
Tap-UiText $updateDialog $oneHundredTwentyDaysText "item reminder update dialog"
$updatedDueDate = (Get-Date).Date.AddDays(120).ToString("yyyy-MM-dd")
$updatedDialog = Wait-UiText "reminder-updated-due-date" $updatedDueDate "updated item reminder due date"
Tap-UiText $updatedDialog $saveReminderText "item reminder update confirmation"

$deadline = (Get-Date).AddSeconds(10)
do {
    Start-Sleep -Milliseconds 500
    $workerCount = Invoke-AppSqlite "no_backup/androidx.work.workdb" $workerCountSql
    $updatedOutboxSql = "SELECT count(*) FROM local_tracked_items WHERE cardId=$(ConvertTo-SqlChar $cardId) AND reminderDays=120 AND syncAction=$(ConvertTo-SqlChar 'UPSERT');"
    $updatedOutboxCount = Invoke-AppSqlite "databases/jianwei.db" $updatedOutboxSql
} while (($workerCount -ne "1" -or $updatedOutboxCount -ne "1") -and (Get-Date) -lt $deadline)
if ($workerCount -ne "1" -or $updatedOutboxCount -ne "1") {
    throw "Reminder update did not replace local work and outbox state: work=$workerCount outbox=$updatedOutboxCount"
}

Start-App
$cancelActions = Find-UiTextWithScroll "reminder-cancel-action" $cancelReminderText "item reminder cancellation"
Tap-UiText $cancelActions $cancelReminderText "item reminder cancellation"
$cancelDialog = Wait-UiText "reminder-cancel-dialog" $confirmCancelText "item reminder cancellation dialog"
Tap-UiText $cancelDialog $confirmCancelText "item reminder cancellation confirmation"
$deadline = (Get-Date).AddSeconds(10)
do {
    Start-Sleep -Milliseconds 500
    $workerCount = Invoke-AppSqlite "no_backup/androidx.work.workdb" $workerCountSql
    $deleteOutboxSql = "SELECT count(*) FROM local_tracked_items WHERE cardId=$(ConvertTo-SqlChar $cardId) AND syncAction=$(ConvertTo-SqlChar 'DELETE');"
    $deleteOutboxCount = Invoke-AppSqlite "databases/jianwei.db" $deleteOutboxSql
} while (($workerCount -ne "0" -or $deleteOutboxCount -ne "1") -and (Get-Date) -lt $deadline)
if ($workerCount -ne "0" -or $deleteOutboxCount -ne "1") {
    throw "Reminder cancellation did not cancel local work and queue cloud deletion: work=$workerCount outbox=$deleteOutboxCount"
}
$cancelledScreen = Wait-UiText "reminder-cancelled" $trackItemText "cancelled item reminder"
if ($cancelledScreen.Contains($reminderActiveText)) {
    throw "Cancelled reminder remained visible as active."
}

# Re-arm one reminder, pause all analysis, and remove only the disposable Debug
# identity file. Cloud deletion therefore has no remote target and must still wait
# until tagged reminder work is gone before atomically clearing local cards/outboxes.
$rearmActions = Find-UiTextWithScroll "reminder-rearm-action" $trackItemText "item reminder rearm"
Tap-UiText $rearmActions $trackItemText "item reminder rearm"
$rearmDialog = Wait-UiText "reminder-rearm-dialog" $confirmReminderText "item reminder rearm dialog"
Tap-UiText $rearmDialog $confirmReminderText "item reminder rearm confirmation"
$deadline = (Get-Date).AddSeconds(10)
do {
    Start-Sleep -Milliseconds 500
    $workerCount = Invoke-AppSqlite "no_backup/androidx.work.workdb" $workerCountSql
    $rearmOutboxSql = "SELECT count(*) FROM local_tracked_items WHERE cardId=$(ConvertTo-SqlChar $cardId) AND syncAction=$(ConvertTo-SqlChar 'UPSERT');"
    $rearmOutboxCount = Invoke-AppSqlite "databases/jianwei.db" $rearmOutboxSql
} while (($workerCount -ne "1" -or $rearmOutboxCount -ne "1") -and (Get-Date) -lt $deadline)
if ($workerCount -ne "1" -or $rearmOutboxCount -ne "1") {
    throw "Reminder rearm did not create one work item and outbox row: work=$workerCount outbox=$rearmOutboxCount"
}

$pauseScreen = Find-PrivacyAction "cloud-delete-pause" $pauseAnalysisText "pause before cloud delete"
Tap-UiText $pauseScreen $pauseAnalysisText "pause before cloud delete"
Start-Sleep -Milliseconds 500
$workerCount = Invoke-AppSqlite "no_backup/androidx.work.workdb" $workerCountSql
if ($workerCount -ne "1") {
    throw "Pausing analysis unexpectedly removed the explicit item reminder before cloud deletion: count=$workerCount"
}

Invoke-AdbChecked @("shell", "am", "force-stop", $packageName)
Invoke-AdbChecked @("shell", "run-as", $packageName, "rm", "-f", "files/datastore/anonymous_device.preferences_pb")
Start-App
$deleteForCleanup = Find-PrivacyAction "cloud-delete-cleanup-action" $deleteCloudText "cloud delete cleanup action"
Tap-UiText $deleteForCleanup $deleteCloudText "cloud delete cleanup action"
$deleteForCleanupDialog = Wait-UiText "cloud-delete-cleanup-confirmation" $confirmDeleteActionText "cloud delete cleanup confirmation"
Tap-UiText $deleteForCleanupDialog $confirmDeleteActionText "cloud delete cleanup confirmation"
$deadline = (Get-Date).AddSeconds(10)
do {
    Start-Sleep -Milliseconds 500
    $workerCount = Invoke-AppSqlite "no_backup/androidx.work.workdb" $workerCountSql
    $remainingCards = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM knowledge_cards;"
    $remainingSaved = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM saved_cards;"
    $remainingFeedback = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM pending_feedback;"
    $remainingTracked = Invoke-AppSqlite "databases/jianwei.db" "SELECT count(*) FROM local_tracked_items;"
} while (($workerCount -ne "0" -or $remainingCards -ne "0" -or $remainingSaved -ne "0" -or $remainingFeedback -ne "0" -or $remainingTracked -ne "0") -and (Get-Date) -lt $deadline)
if ($workerCount -ne "0" -or $remainingCards -ne "0" -or $remainingSaved -ne "0" -or $remainingFeedback -ne "0" -or $remainingTracked -ne "0") {
    throw "Cloud deletion did not await reminder cancellation and atomically clear local cloud state: work=$workerCount cards=$remainingCards saved=$remainingSaved feedback=$remainingFeedback tracked=$remainingTracked"
}

# The widget smoke owns its fixture contract. Recreate only the disposable card
# after the destructive-delete assertions have proved that Room was empty.
if ($PrepareWidgetFixture) {
    Invoke-AdbChecked @("shell", "am", "force-stop", $packageName)
    Invoke-AppSqlite "databases/jianwei.db" $insertCardSql | Out-Null
}
$reminderEvidence = "reminderConsent=1 reminderPermissionDeferred=1 reminderDeniedNoWork=1 reminderOfflineLocal=1 reminderSyncOutbox=1 reminderVisibleState=1 reminderUpdate=1 reminderCancel=1 cloudDeleteReminderCancel=1 cloudDeleteLocalAtomic=1"
}

$crash = (& $adb -s $serial logcat -d -b crash) -join "`n"
if (-not [string]::IsNullOrWhiteSpace($crash)) {
    throw "Android crash buffer is not empty:`n$crash"
}

Write-Host "APP_SMOKE_GATE=GO onboarding=1 denied=1 full=1 partial=1 $consentEvidence shareConsent=1 betaMetricsExport=1 cloudDeleteConfirmation=1 $collectionEvidence $reminderEvidence crashes=0 api=$api"
Write-Host "RESULTS=$resultDirectory"
