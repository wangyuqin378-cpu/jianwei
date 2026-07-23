function Save-AndroidUiHierarchy {
    param(
        [Parameter(Mandatory = $true)][string]$Adb,
        [Parameter(Mandatory = $true)][string]$Serial,
        [Parameter(Mandatory = $true)][string]$RemotePath,
        [Parameter(Mandatory = $true)][string]$LocalPath,
        [ValidateRange(1, 10)][int]$Attempts = 5
    )

    $lastDiagnostic = "uiautomator did not run"
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
            Remove-Item -Force -LiteralPath $LocalPath -ErrorAction SilentlyContinue
            & $Adb -s $Serial shell rm -f $RemotePath 2>&1 | Out-Null

            & $Adb -s $Serial shell uiautomator dump $RemotePath 2>&1 | Out-Null
            $dumpExitCode = $LASTEXITCODE
            if ($dumpExitCode -eq 0) {
                & $Adb -s $Serial pull $RemotePath $LocalPath 2>&1 | Out-Null
                $pullExitCode = $LASTEXITCODE
                if ($pullExitCode -eq 0 -and (Test-Path -LiteralPath $LocalPath)) {
                    $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $LocalPath
                    if ($content -and $content.Contains("<hierarchy")) { return $content }
                    $lastDiagnostic = "dumped hierarchy was empty or malformed"
                } else {
                    $lastDiagnostic = "adb pull failed with exit code $pullExitCode"
                }
            } else {
                $lastDiagnostic = "uiautomator dump failed with exit code $dumpExitCode"
            }

            if ($attempt -lt $Attempts) {
                Start-Sleep -Milliseconds ([Math]::Min(1500, 300 * $attempt))
            }
        }
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    throw "Unable to capture a fresh Android UI hierarchy after $Attempts attempts. Last result: $lastDiagnostic"
}
