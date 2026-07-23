param(
    [Parameter(Mandatory = $true)][string]$RunId,
    [string]$DatasetDirectory = "",
    [string]$OutputPath = "",
    [string]$Serial = "",
    [switch]$Collect,
    [switch]$PurgeDeviceCopy
)

$ErrorActionPreference = "Stop"

if ($RunId -notmatch '^[A-Za-z0-9._-]{3,128}$') { throw "RunId is invalid" }
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $root ".tooling\android-sdk\platform-tools\adb.exe"
if (-not (Test-Path -LiteralPath $adb)) { throw "Run scripts\bootstrap-android-windows.cmd first" }

$deviceLines = & $adb devices
if ($LASTEXITCODE -ne 0) { throw "adb devices failed" }
$devices = @($deviceLines | Select-String '^\S+\s+device$' | ForEach-Object { ($_ -split '\s+')[0] })
if ($Serial) {
    if ($Serial -notin $devices) { throw "Requested Android device is not connected" }
    $selected = $Serial
} else {
    $physical = @($devices | Where-Object { $_ -notmatch '^emulator-' })
    if ($physical.Count -ne 1) { throw "Connect exactly one physical Android device or pass -Serial" }
    $selected = $physical[0]
}

$qemu = (& $adb -s $selected shell getprop ro.kernel.qemu).Trim()
$fingerprint = (& $adb -s $selected shell getprop ro.build.fingerprint).Trim()
if ($qemu -eq "1" -or $fingerprint -match '(?i)generic|sdk_gphone|emulator|goldfish|ranchu|aosp_|google/sdk|unknown/unknown') {
    throw "Authorized image evaluation requires a physical Android device"
}

$packageName = "cn.jianwei.app"
$activity = "$packageName/.evaluation.AuthorizedImageEvaluationActivity"
$packagePath = & $adb -s $selected shell pm path $packageName
if ($LASTEXITCODE -ne 0 -or -not ($packagePath -match '^package:')) {
    throw "Install the current Jianwei Debug APK configured with the real HTTPS Beta endpoint first"
}
$installedPackages = @($packagePath | Where-Object { $_ -match '^package:' } | ForEach-Object { ($_ -replace '^package:', '').Trim() })
if ($installedPackages.Count -ne 1) { throw "Authorized evaluation requires one non-split installed APK" }
$installedDigestOutput = (& $adb -s $selected shell sha256sum $installedPackages[0]).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not hash the installed APK" }
if ($installedDigestOutput -notmatch '^([a-fA-F0-9]{64})\s') { throw "Could not parse the installed APK hash" }
$installedApkSha256 = $Matches[1].ToLowerInvariant()

$remoteRoot = "/sdcard/Android/data/$packageName/files/authorized-evaluation"
$remoteRun = "$remoteRoot/$RunId"
if ($Collect) {
    if ([string]::IsNullOrWhiteSpace($OutputPath)) { throw "OutputPath is required with -Collect" }
    $output = [IO.Path]::GetFullPath($OutputPath)
    if (Test-Path -LiteralPath $output) { throw "OutputPath already exists and will not be overwritten" }
    $outputDirectory = Split-Path -Parent $output
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { throw "OutputPath parent directory does not exist" }
    $remoteResult = "$remoteRun/image-results.json"
    & $adb -s $selected pull $remoteResult $output
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output -PathType Leaf)) {
        throw "The device result is not ready"
    }
    $result = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
    if ($result.evidenceKind -ne "image_pipeline_results" -or $result.runId -ne $RunId) {
        throw "The collected result does not match the requested run"
    }
    if ($result.evaluationApkSha256 -notmatch '^[a-f0-9]{64}$' -or $result.evaluationApkSha256 -ne $installedApkSha256) {
        throw "The collected result does not bind the currently installed APK"
    }
    if ($PurgeDeviceCopy) {
        if (-not $remoteRun.StartsWith("$remoteRoot/", [StringComparison]::Ordinal) -or $remoteRun -eq $remoteRoot) {
            throw "Refusing to purge an unscoped device path"
        }
        & $adb -s $selected shell rm -rf $remoteRun
        if ($LASTEXITCODE -ne 0) { throw "Could not purge the staged device run" }
        foreach ($privateName in @("$RunId.index.json", "$RunId.approval.json", "$RunId.progress.json")) {
            & $adb -s $selected shell run-as $packageName rm "files/authorized-evaluation/$privateName" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Could not purge the private device run state" }
        }
        Write-Host "AUTHORIZED_IMAGE_EVALUATION_COLLECT=GO run=$RunId physicalDevice=1 outputExclusive=1 deviceCopyRetained=0"
    } else {
        Write-Host "AUTHORIZED_IMAGE_EVALUATION_COLLECT=GO run=$RunId physicalDevice=1 outputExclusive=1 deviceCopyRetained=1"
    }
    exit 0
}

if ($PurgeDeviceCopy) { throw "PurgeDeviceCopy is valid only with -Collect after an exclusive result pull" }

if ([string]::IsNullOrWhiteSpace($DatasetDirectory)) { throw "DatasetDirectory is required when staging a run" }
$dataset = (Resolve-Path -LiteralPath $DatasetDirectory).Path
if (-not (Test-Path -LiteralPath $dataset -PathType Container)) { throw "DatasetDirectory is not a directory" }
$labels = Join-Path $dataset "image-labels.json"
$manifest = Join-Path $dataset "image-evaluation-run.json"
$lease = Join-Path $dataset "image-evaluation-lease.json"
$images = Join-Path $dataset "images"
foreach ($required in @($labels, $manifest, $lease, $images)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "DatasetDirectory is missing the labels, run manifest, evaluation lease, or images directory" }
}
$leaseArtifact = Get-Content -LiteralPath $lease -Raw | ConvertFrom-Json
$manifestArtifact = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
if ($leaseArtifact.evidenceKind -ne "authorized_image_evaluation_lease" -or $leaseArtifact.runId -ne $RunId -or
    $leaseArtifact.leaseToken -notmatch '^[A-Za-z0-9_-]{43}$') {
    throw "The evaluation lease does not match this run"
}
if ($manifestArtifact.evidenceKind -ne "authorized_image_pipeline_run" -or $manifestArtifact.runId -ne $RunId -or
    $manifestArtifact.evaluationApkSha256 -notmatch '^[a-f0-9]{64}$' -or
    $manifestArtifact.evaluationApkSha256 -ne $installedApkSha256) {
    throw "The run manifest does not bind the installed APK"
}

& $adb -s $selected shell ls $remoteRun 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw "The device run directory already exists and will not be overwritten" }
& $adb -s $selected shell mkdir -p "$remoteRun/images"
if ($LASTEXITCODE -ne 0) { throw "Could not create the app-private external run directory" }
& $adb -s $selected push $labels "$remoteRun/image-labels.json" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not stage the authorized label artifact" }
& $adb -s $selected push $manifest "$remoteRun/image-evaluation-run.json" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not stage the image evaluation run manifest" }
& $adb -s $selected push $lease "$remoteRun/image-evaluation-lease.json" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not stage the bounded evaluation lease" }
& $adb -s $selected push "$images\." "$remoteRun/images" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not stage the authorized image set" }
& $adb -s $selected shell am start -W -n $activity --es runId $RunId | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not open the on-device human checkpoint" }
Write-Host "AUTHORIZED_IMAGE_EVALUATION_STAGE=GO run=$RunId physicalDevice=1 humanCheckpoint=1 autoUpload=0 resultWritten=0"
