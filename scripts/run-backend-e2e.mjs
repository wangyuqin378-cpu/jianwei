import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const toolingRoot = path.join(root, ".tooling");
const databaseUrl = process.env.BACKEND_E2E_DATABASE_URL?.trim() ?? "";
const repositoryMode = databaseUrl ? "postgres" : "memory";
const evidenceRoot = path.join(toolingRoot, databaseUrl ? "backend-e2e-postgres" : "backend-e2e");

if (process.argv.includes("--self-test")) {
  let rejected = 0;
  for (const unsafe of [root, path.resolve(toolingRoot, "..", "outside")]) {
    try {
      assertWithin(toolingRoot, unsafe);
    } catch {
      rejected += 1;
    }
  }
  assert(rejected === 2, "tooling path escape self-test did not fail closed");
  process.stdout.write("BACKEND_TCP_E2E_SELF_TEST=GO synthetic=1 releaseEvidence=0 pathEscapesRejected=2\n");
  process.exit(0);
}

const backendRoot = path.join(root, "backend");
const serverEntry = path.join(backendRoot, "dist", "index.js");
const objectsRoot = path.join(evidenceRoot, "objects");
const serverLogPath = path.join(evidenceRoot, "server.log");
const resultJsonPath = path.join(evidenceRoot, "result.json");
const resultTextPath = path.join(evidenceRoot, "result.txt");
let child;
let serverOutput = "";
let port = null;

try {
  assertWithin(toolingRoot, evidenceRoot);
  await rm(evidenceRoot, { recursive: true, force: true });
  await mkdir(evidenceRoot, { recursive: true });
  await readFile(serverEntry);
  port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverEntry], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnvironment(port, baseUrl, objectsRoot, databaseUrl)
  });
  child.stdout.on("data", captureServerOutput);
  child.stderr.on("data", captureServerOutput);

  const live = await pollJson(`${baseUrl}/health/live`, 15_000);
  assert(live.ok === true, "liveness response is not healthy");
  const ready = await requestJson(`${baseUrl}/health/ready`, { expectedStatus: 200 });
  assert(ready.body.ok === true && ready.body.mode === "local", "readiness response is not local and healthy");
  assert(typeof ready.body.catalogVersion === "string" && ready.body.catalogVersion.length > 0, "catalog version is missing");

  const unauthorized = await requestJson(`${baseUrl}/v1/cards`, { expectedStatus: 401 });
  assert(unauthorized.body?.error?.code === "unauthorized", "unauthenticated cards request did not fail closed");

  const installationId = randomUUID();
  const register = await requestJson(`${baseUrl}/v1/devices/register`, {
    method: "POST",
    expectedStatus: 201,
    json: { installationId }
  });
  assertUuid(register.body.deviceId, "deviceId");
  assert(typeof register.body.deviceToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(register.body.deviceToken), "device token is invalid");
  const expectedInstallationBinding = createHash("sha256")
    .update("jianwei-installation-binding-v1\0", "utf8")
    .update(installationId, "utf8")
    .digest("hex");
  assert(register.body.installationBindingSha256 === expectedInstallationBinding, "registration response crossed the installation boundary");
  const token = register.body.deviceToken;

  const sensitive = await requestJson(`${baseUrl}/v1/analysis-jobs`, {
    method: "POST",
    token,
    expectedStatus: 422,
    json: candidateRequest(randomUUID(), ["face"], ["face"])
  });
  assert(sensitive.body?.error?.code === "sensitive_candidate", "sensitive candidate was not rejected before upload");

  const broomCandidate = randomUUID();
  const broomJob = await createJob(baseUrl, token, broomCandidate, ["broom"]);
  const uploadAck = await uploadJpeg(broomJob.uploadUrl, token, 200);
  assert(
    uploadAck.body.jobId === broomJob.jobId &&
    uploadAck.body.candidateToken === broomCandidate &&
    uploadAck.body.uploadSessionId === broomJob.uploadSessionId &&
    uploadAck.body.status === "uploaded",
    "upload acknowledgement is not bound to the job, candidate, and session"
  );
  const replay = await uploadJpeg(broomJob.uploadUrl, token, 409);
  assert(replay.body?.error?.code === "upload_session_unavailable", "one-time upload session accepted a replay");
  const uploaded = await requestJson(`${baseUrl}/v1/analysis-jobs/${broomJob.jobId}`, { token, expectedStatus: 200 });
  assert(
    uploaded.body.jobId === broomJob.jobId &&
    uploaded.body.candidateToken === broomCandidate &&
    uploaded.body.status === "uploaded",
    "uploaded job snapshot is not bound to the job and candidate"
  );

  const completed = await requestJson(`${baseUrl}/v1/analysis-jobs/${broomJob.jobId}/complete`, {
    method: "POST",
    token,
    expectedStatus: 200
  });
  assert(completed.body.jobId === broomJob.jobId, "completion response job identity drifted");
  assert(completed.body.candidateToken === broomCandidate, "completion response candidate identity drifted");
  assert(completed.body.status === "completed", "broom job did not complete");
  const terminal = await requestJson(`${baseUrl}/v1/analysis-jobs/${broomJob.jobId}`, { token, expectedStatus: 200 });
  assert(
    terminal.body.jobId === broomJob.jobId &&
    terminal.body.candidateToken === broomCandidate &&
    terminal.body.status === "completed",
    "terminal job snapshot is not bound to the job and candidate"
  );
  const card = completed.body.card;
  assertUuid(card?.cardId, "cardId");
  assert(card.candidateToken === broomCandidate, "card candidate token does not match the submitted candidate");
  assert(card.topicId === "broom", "local vision did not normalize broom topic");
  assert(card.detectedObjectName === "扫帚", "card did not retain the reviewed catalog object name");
  assert(
    typeof card.title === "string" && card.title.includes("扫帚") && Array.from(card.title).length <= 30,
    "card did not receive a bounded server-generated title"
  );
  assert(typeof card.body === "string" && card.body.length >= 20, "card fact body is missing");
  assert(Array.isArray(card.sources) && card.sources.length >= 1, "card has no source");
  assert(card.sources.every((source) => /^https:\/\//.test(source.url)), "card contains a non-HTTPS source");
  await waitForNoObjectFiles(objectsRoot);

  const terminalReplay = await requestJson(`${baseUrl}/v1/analysis-jobs`, {
    method: "POST",
    token,
    expectedStatus: 201,
    json: candidateRequest(broomCandidate, ["broom"])
  });
  assert(terminalReplay.body.jobId === broomJob.jobId && terminalReplay.body.status === "completed", "terminal candidate is not idempotent");
  assert(terminalReplay.body.candidateToken === broomCandidate, "terminal candidate identity drifted");
  assert(terminalReplay.body.uploadUrl === "", "terminal candidate unexpectedly received a new upload capability");
  assert(terminalReplay.body.uploadSessionId === null, "terminal candidate retained an active upload session");

  const cards = await requestJson(`${baseUrl}/v1/cards?limit=20`, { token, expectedStatus: 200 });
  assert(cards.body.items?.length === 1 && cards.body.items[0].cardId === card.cardId, "card synchronization did not return the completed card");
  const feedback = await requestJson(`${baseUrl}/v1/cards/${card.cardId}/feedback`, {
    method: "POST",
    token,
    expectedStatus: 201,
    json: { action: "LIKE" }
  });
  assert(feedback.body.action === "LIKE", "feedback acknowledgement is invalid");
  assert(feedback.body.topicAffinities?.[0]?.topicId === "broom", "feedback did not update broom affinity");

  const tracked = await requestJson(`${baseUrl}/v1/items/${card.cardId}/track`, {
    method: "POST",
    token,
    expectedStatus: 201,
    json: { startedOn: "2026-07-18", reminderDays: 90 }
  });
  assertUuid(tracked.body.id, "tracked item id");
  assert(tracked.body.cardId === card.cardId && tracked.body.reminderDays === 90, "tracked item response is invalid");
  await requestJson(`${baseUrl}/v1/items/${card.cardId}/track`, {
    method: "DELETE",
    token,
    expectedStatus: 204
  });
  await requestJson(`${baseUrl}/v1/items/${card.cardId}/track`, {
    method: "DELETE",
    token,
    expectedStatus: 204
  });

  const unknownJob = await createJob(baseUrl, token, randomUUID(), ["unmapped-e2e-object"]);
  await uploadJpeg(unknownJob.uploadUrl, token, 200);
  const needsContent = await requestJson(`${baseUrl}/v1/analysis-jobs/${unknownJob.jobId}/complete`, {
    method: "POST",
    token,
    expectedStatus: 200
  });
  assert(needsContent.body.status === "needs_content" && needsContent.body.card === null, "unknown object produced an unsupported card");
  await waitForNoObjectFiles(objectsRoot);

  await requestJson(`${baseUrl}/v1/device-data`, { method: "DELETE", token, expectedStatus: 204 });
  const afterDelete = await requestJson(`${baseUrl}/v1/cards`, { token, expectedStatus: 401 });
  assert(afterDelete.body?.error?.code === "unauthorized", "deleted device token remained authorized");
  await waitForNoObjectFiles(objectsRoot);

  const evidence = {
    gate: "GO",
    generatedAt: new Date().toISOString(),
    compiledEntrySha256: sha256(await readFile(serverEntry)),
    compiledDistSha256: await sha256Directory(path.dirname(serverEntry)),
    catalogVersion: ready.body.catalogVersion,
    transport: "real-loopback-tcp",
    repositoryMode,
    checks: {
      compiledDist: true,
      health: true,
      auth: true,
      sensitiveRejectBeforeUpload: true,
      oneTimeUpload: true,
      uploadReplayRejected: true,
      analysisComplete: true,
      deterministicServerTitle: true,
      terminalCandidateIdempotent: true,
      cardSync: true,
      feedback: true,
      tracking: true,
      trackingCancellation: true,
      unsupportedObjectNeedsContent: true,
      deviceDataDeletion: true,
      objectFilesRemaining: 0
    }
  };
  const summary = `BACKEND_TCP_E2E_GATE=GO repository=${repositoryMode} compiledDist=1 tcp=1 health=1 auth=1 sensitiveReject=1 upload=1 replay=1 jobStatusBinding=1 complete=1 deterministicTitle=1 idempotent=1 cards=1 feedback=1 track=1 untrack=1 needsContent=1 delete=1 objectsRemaining=0`;
  await writeFile(resultJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(resultTextPath, `${summary}\n`, "utf8");
  process.stdout.write(`${summary}\n`);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await mkdir(evidenceRoot, { recursive: true }).catch(() => undefined);
  await writeFile(resultTextPath, `BACKEND_TCP_E2E_GATE=NO_GO\n${message}\n`, "utf8").catch(() => undefined);
  throw error;
} finally {
  await stopChild(child);
  if (serverOutput) await writeFile(serverLogPath, serverOutput, "utf8").catch(() => undefined);
}

function candidateRequest(candidateToken, localLabels, sensitiveFlags = []) {
  return {
    candidateToken,
    capturedAtBucket: "2026-07-18",
    localLabels,
    qualityScore: 0.95,
    sensitiveFlags,
    contentType: "image/jpeg"
  };
}

async function createJob(baseUrl, token, candidateToken, labels) {
  const response = await requestJson(`${baseUrl}/v1/analysis-jobs`, {
    method: "POST",
    token,
    expectedStatus: 201,
    json: candidateRequest(candidateToken, labels)
  });
  assertUuid(response.body.jobId, "jobId");
  assert(response.body.candidateToken === candidateToken, "new job candidate identity drifted");
  assert(response.body.status === "awaiting_upload", "new job did not await upload");
  assertUuid(response.body.uploadSessionId, "uploadSessionId");
  const upload = new URL(response.body.uploadUrl);
  assert(upload.origin === baseUrl, "upload URL escaped the API origin");
  assert(/^\/v1\/analysis-jobs\/[0-9a-f-]{36}\/image$/i.test(upload.pathname), "upload URL path is invalid");
  assert(upload.pathname === `/v1/analysis-jobs/${response.body.uploadSessionId}/image`, "upload URL is not bound to its session");
  assert(Number.isFinite(Date.parse(response.body.expiresAt)), "upload expiry is invalid");
  return response.body;
}

async function uploadJpeg(uploadUrl, token, expectedStatus) {
  const bytes = Buffer.alloc(128, 0x5a);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return requestJson(uploadUrl, {
    method: "PUT",
    token,
    expectedStatus,
    headers: { "Content-Type": "image/jpeg" },
    body: bytes
  });
}

async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${options.method ?? "GET"} ${new URL(url).pathname} returned non-JSON HTTP ${response.status}`);
    }
  }
  assert(response.status === options.expectedStatus, `${options.method ?? "GET"} ${new URL(url).pathname} expected HTTP ${options.expectedStatus}, received ${response.status} (${parsed?.error?.code ?? "no-error-code"})`);
  return { status: response.status, body: parsed };
}

async function pollJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error(`compiled server exited before becoming healthy (${child?.exitCode})\n${serverOutput}`);
    try {
      const response = await requestJson(url, { expectedStatus: 200 });
      return response.body;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`compiled server did not become healthy: ${lastError instanceof Error ? lastError.message : "timeout"}\n${serverOutput}`);
}

async function waitForNoObjectFiles(directory) {
  const deadline = Date.now() + 5_000;
  do {
    if (await countFiles(directory) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error("analysis object was not deleted after terminal processing");
}

async function countFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (entry.isFile()) count += 1;
    if (entry.isDirectory()) count += await countFiles(path.join(directory, entry.name));
  }
  return count;
}

function serverEnvironment(selectedPort, baseUrl, objectDirectory, selectedDatabaseUrl) {
  const allowed = ["SystemRoot", "WINDIR", "ComSpec", "PATH", "Path", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL"];
  const env = Object.fromEntries(allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
  return {
    ...env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(selectedPort),
    PUBLIC_BASE_URL: baseUrl,
    DATABASE_URL: selectedDatabaseUrl,
    OBJECT_STORE: "local",
    LOCAL_OBJECT_DIR: objectDirectory,
    VISION_PROVIDER: "local",
    ALLOW_UNATTESTED_FACTS: "true",
    OBJECT_TTL_HOURS: "24",
    MAX_JOBS_PER_DEVICE_PER_DAY: "10",
    MAX_JOBS_PER_DEVICE_PER_MONTH: "20",
    MAX_JOBS_GLOBAL_PER_DAY: "10000",
    MAX_JOBS_GLOBAL_PER_MONTH: "20000",
    WORST_CASE_COST_MICRO_CNY_PER_JOB: "1",
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "10000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: "20000"
  };
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const selected = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert(Number.isInteger(selected), "failed to allocate a loopback port");
  return selected;
}

function captureServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-64 * 1024);
}

async function stopChild(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  const exited = new Promise((resolve) => processHandle.once("exit", resolve));
  const timedOut = new Promise((resolve) => setTimeout(() => resolve("timeout"), 3_000));
  if (await Promise.race([exited, timedOut]) === "timeout" && processHandle.exitCode === null) processHandle.kill("SIGKILL");
}

function assertWithin(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`unsafe tooling path: ${target}`);
  }
}

function assertUuid(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), `${label} is not a UUID`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256Directory(directory) {
  const files = await listFiles(directory);
  const digest = createHash("sha256");
  for (const file of files.sort()) {
    digest.update(path.relative(directory, file).replaceAll("\\", "/"));
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function listFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(absolute));
    if (entry.isFile()) output.push(absolute);
  }
  return output;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
