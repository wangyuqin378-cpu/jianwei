#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
BACKEND="$ROOT/backend"
TOOL_ROOT="$ROOT/.tooling/postgres-integration-macos"
DATA_DIR="$TOOL_ROOT/data"
RESULT_DIR="$ROOT/.tooling/postgres-integration-results-macos"
LOG_PATH="$RESULT_DIR/postgres.log"
RESULT_PATH="$RESULT_DIR/result.txt"
TEST_REPORT_PATH="$RESULT_DIR/postgres-vitest.json"
AUDIT_PATH="$RESULT_DIR/audit.json"
PORT="${1:-0}"
STARTED=0

if [[ -n "${POSTGRES_17_BIN:-}" ]]; then
  PG_BIN="$POSTGRES_17_BIN"
elif command -v brew >/dev/null 2>&1; then
  PG_BIN="$(brew --prefix postgresql@17)/bin"
else
  print -u2 "PostgreSQL 17 is required. Set POSTGRES_17_BIN or install postgresql@17."
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi

for required in \
  "$PG_BIN/initdb" "$PG_BIN/pg_ctl" "$PG_BIN/createdb" "$PG_BIN/psql" \
  "$NODE" "$BACKEND/node_modules/.bin/tsx" "$BACKEND/node_modules/.bin/tsc" \
  "$BACKEND/node_modules/.bin/vitest" "$ROOT/scripts/run-backend-e2e.mjs"; do
  if [[ ! -x "$required" && ! -f "$required" ]]; then
    print -u2 "Missing PostgreSQL integration dependency: $required"
    exit 1
  fi
done

if [[ "$PORT" == "0" ]]; then
  PORT="$("$NODE" -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
fi
if [[ ! "$PORT" =~ '^[0-9]+$' ]] || (( PORT < 1024 || PORT > 65535 )); then
  print -u2 "Port must be between 1024 and 65535."
  exit 1
fi

case "$DATA_DIR" in
  "$TOOL_ROOT"/*) ;;
  *)
    print -u2 "Refusing to reset a PostgreSQL data directory outside the project tooling root: $DATA_DIR"
    exit 1
    ;;
esac

cleanup() {
  if (( STARTED == 1 )); then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR" "$RESULT_DIR"
"$PG_BIN/initdb" --pgdata="$DATA_DIR" --username=jianwei --auth-local=trust \
  --auth-host=trust --encoding=UTF8 --locale=C >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_PATH" -o "-p $PORT -h 127.0.0.1" -w start >/dev/null
STARTED=1
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U jianwei jianwei

DATABASE_URL="postgres://jianwei@127.0.0.1:$PORT/jianwei"
(
  cd "$BACKEND"
  DATABASE_URL="$DATABASE_URL" "$BACKEND/node_modules/.bin/tsc" -p tsconfig.json
  DATABASE_URL="$DATABASE_URL" "$BACKEND/node_modules/.bin/tsx" src/migrate.ts
  DATABASE_URL="$DATABASE_URL" "$BACKEND/node_modules/.bin/tsx" src/migrate.ts
  DATABASE_URL="$DATABASE_URL" RUN_POSTGRES_INTEGRATION=1 \
    "$BACKEND/node_modules/.bin/vitest" run src/postgres.integration.test.ts \
      --coverage.enabled=false --reporter=json --outputFile="$TEST_REPORT_PATH"
)

BACKEND_E2E_DATABASE_URL="$DATABASE_URL" "$NODE" "$ROOT/scripts/run-backend-e2e.mjs"

SCHEMA_COUNT="$("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U jianwei -d jianwei -Atc "SELECT count(*) FROM schema_migrations")"
if [[ "$SCHEMA_COUNT" != "15" ]]; then
  print -u2 "Expected fifteen applied PostgreSQL migrations, found: $SCHEMA_COUNT"
  exit 1
fi

TEST_SUMMARY="$("$NODE" -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const total = Number(value.numTotalTests);
const failed = Number(value.numFailedTests);
const pending = Number(value.numPendingTests);
if (total < 17 || failed !== 0 || pending !== 0) process.exit(1);
process.stdout.write(`${total} ${failed} ${pending}`);
' "$TEST_REPORT_PATH")"
TESTS="${TEST_SUMMARY%% *}"
VERSION="$("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U jianwei -d jianwei -Atc "SHOW server_version")"

"$PG_BIN/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null
STARTED=0
if "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
  print -u2 "PostgreSQL integration server is still running after stop."
  exit 1
fi

"$NODE" -e '
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const [auditPath, testPath, tcpPath, serverVersion, testCount] = process.argv.slice(1);
const test = JSON.parse(fs.readFileSync(testPath, "utf8"));
const tcp = JSON.parse(fs.readFileSync(tcpPath, "utf8"));
if (test.success !== true || test.numTotalTests < 17 || test.numFailedTests !== 0 || test.numPendingTests !== 0) {
  throw new Error("PostgreSQL test report is not successful");
}
if (tcp.gate !== "GO" || tcp.repositoryMode !== "postgres" || tcp.checks?.objectFilesRemaining !== 0) {
  throw new Error("PostgreSQL TCP E2E evidence is not successful");
}
const sha256 = (path) => createHash("sha256").update(fs.readFileSync(path)).digest("hex");
const audit = {
  schemaVersion: 1,
  evidenceKind: "local_postgres_integration",
  generatedAt: new Date().toISOString(),
  releaseEvidence: false,
  gate: "GO",
  postgres: {
    serverVersion,
    migrations: 15,
    migrationRuns: 3,
    tests: Number(testCount),
    detectedObjectMigration: true,
    objectBoundsMigration: true,
    feedbackContributionMigration: true,
    processStopped: true
  },
  tcpE2E: tcp.checks,
  artifacts: {
    postgresVitestSha256: sha256(testPath),
    backendTcpE2ESha256: sha256(tcpPath)
  }
};
fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
' "$AUDIT_PATH" "$TEST_REPORT_PATH" "$ROOT/.tooling/backend-e2e-postgres/result.json" "$VERSION" "$TESTS"

SUMMARY="POSTGRES_INTEGRATION_GATE=GO server=$VERSION migrations=15 migrateRuns=3 appStartupMigration=1 tests=$TESTS tcpE2E=1 independentPools=4 concurrentAttempts=32 globalLimit=5 costReservationMicroCny=14 oneTimeUpload=1 leaseRecovery=1 preferencePersistence=1 feedbackContributionRollback=1 privateDeletionTransaction=1 registrationCreatedProof=1 boundedEvaluationLease=1 backendReleaseStamp=1 cardScheduleConcurrency=1 detectedObjectMigration=1 objectBoundsMigration=1 feedbackContributionMigration=1 processStopped=1"
{
  print "$SUMMARY"
  print "PORT=$PORT"
  print "DATA=$DATA_DIR"
  print "LOG=$LOG_PATH"
  print "AUDIT=$AUDIT_PATH"
} > "$RESULT_PATH"

print "$SUMMARY"
print "RESULTS=$RESULT_PATH"
