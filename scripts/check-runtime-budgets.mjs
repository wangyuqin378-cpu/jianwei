import { readFile } from "node:fs/promises";

export function assessRuntimeBudgets(input) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const worstCaseCoreMs = input.qwenRequestMs * 3 + input.ossRequestMs * 2 + input.overheadMs;
  const clientMs = input.androidCallSeconds * 1000;
  const functionMs = input.functionTimeoutSeconds * 1000;

  check(input.qwenRequestMs >= 5_000 && input.qwenRequestMs <= 30_000, "Qwen timeout must be 5-30 seconds");
  check(input.ossRequestMs >= 5_000 && input.ossRequestMs <= 30_000, "OSS timeout must be 5-30 seconds");
  check(clientMs >= worstCaseCoreMs + 10_000, "Android call timeout must exceed the core processing envelope by 10 seconds");
  check(functionMs >= clientMs + 20_000, "Function timeout must exceed the Android call timeout by 20 seconds");
  check(input.processingLeaseMs >= functionMs + 20_000, "Processing lease must outlive the Function Compute invocation by 20 seconds");
  check(input.processingLeaseMs <= 300_000, "Processing lease must recover within five minutes");
  check(input.functionTimeoutSeconds <= 300, "Function timeout must stay within the product latency ceiling");

  return {
    status: failures.length === 0 ? "GO" : "NO_GO",
    metrics: {
      qwenRequestMs: input.qwenRequestMs,
      ossRequestMs: input.ossRequestMs,
      worstCaseCoreMs,
      androidCallSeconds: input.androidCallSeconds,
      functionTimeoutSeconds: input.functionTimeoutSeconds,
      processingLeaseMs: input.processingLeaseMs
    },
    blockers: failures
  };
}

function numeric(source, pattern, name) {
  const match = pattern.exec(source);
  if (!match) throw new Error(`Unable to read ${name}`);
  return Number(match[1].replaceAll("_", ""));
}

async function checkedInBudgets() {
  const [qwen, objectStore, analysis, android, manifest] = await Promise.all([
    readFile("backend/src/providers/qwen-providers.ts", "utf8"),
    readFile("backend/src/infrastructure/object-store.ts", "utf8"),
    readFile("backend/src/services/analysis-service.ts", "utf8"),
    readFile("android/data/src/main/kotlin/cn/jianwei/data/di/DataModule.kt", "utf8"),
    readFile("deploy/s.yaml.example", "utf8")
  ]);
  return {
    qwenRequestMs: numeric(qwen, /QWEN_REQUEST_TIMEOUT_MS\s*=\s*([\d_]+)/, "Qwen timeout"),
    ossRequestMs: numeric(objectStore, /OSS_REQUEST_TIMEOUT_MS\s*=\s*([\d_]+)/, "OSS timeout"),
    processingLeaseMs: numeric(analysis, /PROCESSING_LEASE_MS\s*=\s*([\d_]+)/, "processing lease"),
    androidCallSeconds: numeric(android, /API_CALL_TIMEOUT_SECONDS\s*=\s*([\d_]+)L/, "Android call timeout"),
    functionTimeoutSeconds: numeric(manifest, /^\s*timeout:\s*(\d+)\s*$/m, "Function Compute timeout"),
    overheadMs: 15_000
  };
}

const input = await checkedInBudgets();
if (process.argv.includes("--self-test")) {
  const passing = assessRuntimeBudgets(input);
  if (passing.status !== "GO") throw new Error(`Checked-in runtime budget failed: ${passing.blockers.join("; ")}`);
  const cases = [
    ["short client", (value) => { value.androidCallSeconds = 30; }],
    ["short function", (value) => { value.functionTimeoutSeconds = value.androidCallSeconds; }],
    ["short lease", (value) => { value.processingLeaseMs = value.functionTimeoutSeconds * 1000; }],
    ["unbounded Qwen", (value) => { value.qwenRequestMs = 60_000; }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(input);
    mutate(value);
    if (assessRuntimeBudgets(value).status !== "NO_GO") throw new Error(`Runtime budget self-test expected rejection: ${name}`);
  }
  process.stdout.write(`RUNTIME_BUDGET_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${cases.length}\n`);
} else {
  const result = assessRuntimeBudgets(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "GO") process.exitCode = 1;
}
