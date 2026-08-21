param(
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$postgresRoot = Join-Path $root ".tooling\postgresql-17.10\pgsql"
$bin = Join-Path $postgresRoot "bin"
$initdb = Join-Path $bin "initdb.exe"
$pgCtl = Join-Path $bin "pg_ctl.exe"
$createdb = Join-Path $bin "createdb.exe"
$psql = Join-Path $bin "psql.exe"
$toolRoot = [IO.Path]::GetFullPath((Join-Path $root ".tooling\postgres-integration"))
$dataDirectory = [IO.Path]::GetFullPath((Join-Path $toolRoot "data"))
$resultDirectory = Join-Path $root ".tooling\postgres-integration-results"
$logPath = Join-Path $resultDirectory "postgres.log"
$resultPath = Join-Path $resultDirectory "result.txt"
$testReportPath = Join-Path $resultDirectory "postgres-vitest.json"
$backend = Join-Path $root "backend"
$tsx = Join-Path $backend "node_modules\.bin\tsx.cmd"
$tsc = Join-Path $backend "node_modules\.bin\tsc.cmd"
$vitest = Join-Path $backend "node_modules\.bin\vitest.cmd"
$started = $false

foreach ($required in @($initdb, $pgCtl, $createdb, $psql, $tsx, $tsc, $vitest, (Join-Path $backend "package.json"), (Join-Path $root "scripts\run-backend-e2e.mjs"))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing PostgreSQL integration dependency: $required" }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $bundledNodeDirectory = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
    if (-not (Test-Path -LiteralPath (Join-Path $bundledNodeDirectory "node.exe"))) {
        throw "Node.js is required for the PostgreSQL integration gate."
    }
    $env:PATH = "$bundledNodeDirectory;$env:PATH"
}
$node = (Get-Command node -ErrorAction Stop).Source

if ($Port -eq 0) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $Port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
}
if ($Port -lt 1024 -or $Port -gt 65535) { throw "Port must be between 1024 and 65535." }

$expectedPrefix = $toolRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $dataDirectory.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset a PostgreSQL data directory outside the project tooling root: $dataDirectory"
}
if (Test-Path -LiteralPath $dataDirectory) {
    Remove-Item -LiteralPath $dataDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $dataDirectory, $resultDirectory | Out-Null

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Executable $($Arguments -join ' ')" }
}

try {
    Invoke-Checked $initdb @("--pgdata=$dataDirectory", "--username=jianwei", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--locale=C")
    Invoke-Checked $pgCtl @("-D", $dataDirectory, "-l", $logPath, "-o", "-p $Port -h 127.0.0.1", "-w", "start")
    $started = $true
    Invoke-Checked $createdb @("-h", "127.0.0.1", "-p", [string]$Port, "-U", "jianwei", "jianwei")

    $databaseUrl = "postgres://jianwei@127.0.0.1:$Port/jianwei"
    $previousDatabaseUrl = $env:DATABASE_URL
    $previousIntegrationFlag = $env:RUN_POSTGRES_INTEGRATION
    $env:DATABASE_URL = $databaseUrl
    $env:RUN_POSTGRES_INTEGRATION = "1"
    try {
        Push-Location $backend
        try {
            Invoke-Checked $tsc @("-p", "tsconfig.json")
            Invoke-Checked $tsx @("src/migrate.ts")
            Invoke-Checked $tsx @("src/migrate.ts")
            Invoke-Checked $vitest @(
                "run", "src/postgres.integration.test.ts", "--coverage.enabled=false",
                "--reporter=json", "--outputFile=$testReportPath"
            )
        } finally {
            Pop-Location
        }
        $previousBackendE2E = $env:BACKEND_E2E_DATABASE_URL
        $env:BACKEND_E2E_DATABASE_URL = $databaseUrl
        try {
            Invoke-Checked $node @((Join-Path $root "scripts\run-backend-e2e.mjs"))
        } finally {
            if ($null -eq $previousBackendE2E) {
                Remove-Item Env:BACKEND_E2E_DATABASE_URL -ErrorAction SilentlyContinue
            } else {
                $env:BACKEND_E2E_DATABASE_URL = $previousBackendE2E
            }
        }
    } finally {
        $env:DATABASE_URL = $previousDatabaseUrl
        $env:RUN_POSTGRES_INTEGRATION = $previousIntegrationFlag
    }

    $schemaCount = (& $psql -h 127.0.0.1 -p $Port -U jianwei -d jianwei -Atc "SELECT count(*) FROM schema_migrations").Trim()
    if ($LASTEXITCODE -ne 0 -or $schemaCount -ne "15") { throw "Expected fifteen applied PostgreSQL migrations, found: $schemaCount" }
    if (-not (Test-Path -LiteralPath $testReportPath)) { throw "PostgreSQL Vitest evidence report is missing." }
    $testEvidence = Get-Content -Raw -LiteralPath $testReportPath | ConvertFrom-Json
    $tests = [int]$testEvidence.numTotalTests
    $failedTests = [int]$testEvidence.numFailedTests
    $pendingTests = [int]$testEvidence.numPendingTests
    if ($tests -lt 17 -or $failedTests -ne 0 -or $pendingTests -ne 0) {
        throw "PostgreSQL test evidence failed: tests=$tests failed=$failedTests pending=$pendingTests"
    }
    $version = (& $psql -h 127.0.0.1 -p $Port -U jianwei -d jianwei -Atc "SHOW server_version").Trim()
    $result = @(
        "POSTGRES_INTEGRATION_GATE=GO server=$version migrations=15 migrateRuns=3 appStartupMigration=1 tests=$tests tcpE2E=1 independentPools=4 concurrentAttempts=32 globalLimit=5 costReservationMicroCny=14 oneTimeUpload=1 leaseRecovery=1 preferencePersistence=1 feedbackContributionRollback=1 privateDeletionTransaction=1 registrationCreatedProof=1 boundedEvaluationLease=1 backendReleaseStamp=1 cardScheduleConcurrency=1 detectedObjectMigration=1 objectBoundsMigration=1 feedbackContributionMigration=1"
        "PORT=$Port"
        "DATA=$dataDirectory"
        "LOG=$logPath"
    )
    $result | Set-Content -Encoding ASCII -LiteralPath $resultPath
    $result | ForEach-Object { Write-Host $_ }
    Write-Host "RESULTS=$resultPath"
} finally {
    if ($started) {
        & $pgCtl -D $dataDirectory -m fast -w stop | Out-Null
    }
}
