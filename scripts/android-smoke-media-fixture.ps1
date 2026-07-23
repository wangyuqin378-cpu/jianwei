function New-AndroidSmokeImageUri {
    param([string]$Adb, [string]$Serial)
    $name = "jianwei-smoke-$([guid]::NewGuid().ToString('N')).png"
    $path = "/sdcard/Pictures/$name"
    & $Adb -s $Serial shell screencap -p $path | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not capture the Android smoke image." }
    & $Adb -s $Serial shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$path" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not scan the Android smoke image." }
    Start-Sleep -Seconds 2
    $rows = (& $Adb -s $Serial shell content query --uri content://media/external/images/media --projection _id:_display_name) -join "`n"
    $row = $rows -split "`n" | Where-Object { $_ -like "*$name*" } | Select-Object -Last 1
    if ($row -notmatch '_id=(\d+)') {
        & $Adb -s $Serial shell rm -f $path | Out-Null
        throw "Could not create a real MediaStore fixture for Android smoke."
    }
    return "content://media/external/images/media/$($Matches[1])"
}

function Remove-AndroidSmokeImageUri {
    param([string]$Adb, [string]$Serial, [string]$Uri)
    if ($Uri -match '/(\d+)$') {
        & $Adb -s $Serial shell content delete --uri $Uri --where "_id=$($Matches[1])" | Out-Null
    }
}
