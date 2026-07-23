import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { access, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyReviewBatch } from "./review-batch.mjs";
import {
  assertAccountableReviewerId,
  assertExactKeys,
  isPublicHttpsUrl,
  sha256Text
} from "./fact-review.mjs";
import { assertFailClosedReviewTemplate, createReviewTemplate } from "./review-template.mjs";

const SESSION_KIND = "local_human_review_workbench_session";
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,96}\.json$/;
const SESSION_ID = /^[a-f0-9]{32}$/;
const VERSION = /^[A-Za-z0-9._-]{3,100}$/;
const DECISION_KEYS = [
  "factId",
  "factSha256",
  "decision",
  "checkedSourceIds",
  "semanticSupportConfirmed",
  "unsupportedClaimsChecked",
  "notes"
];
const CLIENT_JS = await readFile(new URL("./review-workbench-client.mjs", import.meta.url), "utf8");
const WORKBENCH_ENHANCEMENT_CSS = `.summary #status[data-tone="danger"]{color:var(--red)}.review-tools{display:flex;align-items:end;flex-wrap:wrap;gap:10px;margin-top:10px;padding-top:14px;border-top:1px solid var(--line)}.review-tools label{display:grid;gap:3px;color:var(--muted);font-size:13px}.review-tools select{width:auto;min-width:138px;padding:7px 30px 7px 10px}.fact-badges{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:7px}.readiness-badge{border-radius:999px;padding:2px 9px;font-size:12px;font-weight:700}.readiness-badge.open{color:var(--amber);background:#fff3df}.readiness-badge.ready{color:var(--green);background:#e8f4ec}.risk-guidance{margin:14px 0;padding:10px 12px;border-left:3px solid var(--amber);background:#fff8e9;color:#754712}.decision-validation{margin-top:16px;padding:12px 14px;border-radius:12px}.decision-validation strong{display:block}.decision-validation ul{margin:5px 0 0;padding-left:20px}.decision-validation.open{background:#fff3df;color:#754712}.decision-validation.ready{background:#e8f4ec;color:var(--green)}.fact[hidden]{display:none}button.danger{border-color:var(--red);color:var(--red)}button.compact{padding:7px 13px}.summary button.compact{justify-self:start;margin-top:8px}@media(max-width:700px){.review-tools{align-items:stretch}.review-tools label,.review-tools select,.review-tools button{width:100%}}`;

export async function prepareControlledRoots(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const outputRoot = path.join(root, ".tooling", "knowledge-review-batches");
  const sessionRoot = path.join(root, ".tooling", "knowledge-review-workbench");
  await mkdir(outputRoot, { recursive: true });
  await mkdir(sessionRoot, { recursive: true });
  await assertOrdinaryDirectory(outputRoot);
  await assertOrdinaryDirectory(sessionRoot);
  return { workspaceRoot: root, outputRoot, sessionRoot };
}

export async function resolveControlledOutput(outputRoot, value, { allowExisting = false } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error("--output is required");
  const requested = path.resolve(value);
  const root = path.resolve(outputRoot);
  await assertOrdinaryDirectory(root);
  if (!samePath(path.dirname(requested), root) || !OUTPUT_NAME.test(path.basename(requested))) {
    throw new Error("Review output must be a simple JSON filename directly under .tooling/knowledge-review-batches");
  }
  if (!allowExisting) {
    try {
      await access(requested);
      throw new Error("Review output already exists and will not be overwritten");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return requested;
}

export async function createReviewSession({
  catalogText,
  queue,
  reviewerId,
  nextCatalogVersion,
  outputFileName,
  limit = 20,
  topicId = null,
  sessionRoot,
  now = new Date(),
  sessionId = randomBytes(16).toString("hex")
}) {
  assertAccountableReviewerId(reviewerId);
  if (!VERSION.test(nextCatalogVersion ?? "") || nextCatalogVersion === queue?.catalogVersion ||
      nextCatalogVersion === "REPLACE_WITH_NEW_VERSION") {
    throw new Error("--next-version must be a new valid catalog version");
  }
  if (!OUTPUT_NAME.test(outputFileName ?? "")) throw new Error("Review output filename is invalid");
  if (!SESSION_ID.test(sessionId)) throw new Error("Review session ID is invalid");
  if (!Number.isFinite(now.getTime())) throw new Error("Review session timestamp is invalid");
  const batch = preflightReviewSession({ catalogText, queue, limit, topicId });
  batch.nextCatalogVersion = nextCatalogVersion;
  const items = selectedReviewItems(queue, batch);
  const state = {
    schemaVersion: 1,
    evidenceKind: SESSION_KIND,
    sessionId,
    reviewerId,
    outputFileName,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    selection: { limit, topicId },
    revision: 0,
    finalizedAt: null,
    outputSha256: null,
    batch,
    items
  };
  await assertOrdinaryDirectory(sessionRoot);
  const sessionDirectory = path.join(path.resolve(sessionRoot), sessionId);
  if (!samePath(path.dirname(sessionDirectory), path.resolve(sessionRoot))) throw new Error("Review session path escaped its root");
  await mkdir(sessionDirectory, { recursive: false });
  await writeRevision(sessionDirectory, state);
  return { state, sessionDirectory };
}

export function preflightReviewSession({ catalogText, queue, limit = 20, topicId = null }) {
  assertCatalogQueueSnapshot(catalogText, queue);
  const batch = createReviewTemplate(queue, { limit, topicId });
  assertFailClosedReviewTemplate(batch);
  return batch;
}

export async function resumeReviewSession({ sessionRoot, sessionId, catalogText, queue, outputRoot }) {
  if (!SESSION_ID.test(sessionId ?? "")) throw new Error("--resume must be a 32-character lowercase hex session ID");
  await assertOrdinaryDirectory(sessionRoot);
  const sessionDirectory = path.join(path.resolve(sessionRoot), sessionId);
  if (!samePath(path.dirname(sessionDirectory), path.resolve(sessionRoot))) throw new Error("Review session path escaped its root");
  await assertOrdinaryDirectory(sessionDirectory);
  let state = await readLatestRevision(sessionDirectory);
  assertSessionState(state, catalogText, queue);
  const outputPath = await resolveControlledOutput(outputRoot, path.join(outputRoot, state.outputFileName), { allowExisting: true });
  try {
    const outputText = await readFile(outputPath, "utf8");
    const outputSha256 = sha256Text(outputText);
    const expectedText = `${JSON.stringify(state.batch, null, 2)}\n`;
    if (outputSha256 !== sha256Text(expectedText)) {
      throw new Error("Existing final output does not match the persisted review session");
    }
    if (!state.finalizedAt || state.outputSha256 !== outputSha256) {
      state = {
        ...state,
        revision: state.revision + 1,
        updatedAt: new Date().toISOString(),
        finalizedAt: state.finalizedAt ?? new Date().toISOString(),
        outputSha256
      };
      await writeRevision(sessionDirectory, state);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (state.finalizedAt || state.outputSha256) throw new Error("Finalized review session is missing its output batch");
  }
  return { state, sessionDirectory };
}

export async function updateReviewDecisions({ state, sessionDirectory, expectedSha256, decisions, now = new Date() }) {
  if (state.finalizedAt) throw conflict("Review session is already finalized");
  if (expectedSha256 !== batchDigest(state.batch)) throw conflict("Review state is stale; reload before saving");
  const nextDecisions = validateDecisionUpdate(state, decisions);
  const next = {
    ...state,
    updatedAt: now.toISOString(),
    revision: state.revision + 1,
    batch: { ...state.batch, decisions: nextDecisions }
  };
  await writeRevision(sessionDirectory, next);
  return next;
}

export async function finalizeReviewSession({ state, sessionDirectory, outputRoot, catalogText, now = new Date() }) {
  if (state.finalizedAt) throw conflict("Review session is already finalized");
  applyReviewBatch({ catalogText, batch: state.batch, reviewerId: state.reviewerId, now });
  const outputPath = await resolveControlledOutput(outputRoot, path.join(outputRoot, state.outputFileName), { allowExisting: true });
  const outputText = `${JSON.stringify(state.batch, null, 2)}\n`;
  try {
    await writeFile(outputPath, outputText, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST" || await readFile(outputPath, "utf8") !== outputText) throw error;
  }
  const outputSha256 = sha256Text(outputText);
  const next = {
    ...state,
    updatedAt: now.toISOString(),
    revision: state.revision + 1,
    finalizedAt: now.toISOString(),
    outputSha256
  };
  await writeRevision(sessionDirectory, next);
  return { state: next, outputPath, outputSha256 };
}

export async function startReviewWorkbench({ state: initialState, sessionDirectory, outputRoot, catalogText, port = 8791 }) {
  let state = initialState;
  let origin = null;
  let mutationChain = Promise.resolve();
  let bootstrapAvailable = true;
  const accessToken = randomBytes(32).toString("base64url");
  const cookieToken = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");

  const server = createServer(async (request, response) => {
    try {
      assertLoopbackPeer(request.socket.remoteAddress);
      if (!origin || request.headers.host !== origin.slice("http://".length)) return sendText(response, 421, "Misdirected request");
      const url = new URL(request.url ?? "/", origin);
      if (url.origin !== origin) return sendText(response, 421, "Misdirected request");

      if (request.method === "GET" && url.pathname === "/bootstrap") {
        if (!bootstrapAvailable || !safeEqual(url.searchParams.get("access"), accessToken)) return sendText(response, 403, "Forbidden");
        bootstrapAvailable = false;
        response.writeHead(303, {
          "cache-control": "no-store",
          "location": "/",
          "referrer-policy": "no-referrer",
          "set-cookie": `jianwei_review=${cookieToken}; HttpOnly; SameSite=Lax; Path=/`
        });
        return response.end();
      }

      if (!authorizedCookie(request.headers.cookie, cookieToken)) return sendText(response, 401, "Unauthorized");
      if (request.method === "GET" && url.pathname === "/") return send(response, 200, "text/html; charset=utf-8", HTML);
      if (request.method === "GET" && url.pathname === "/app.css") return send(response, 200, "text/css; charset=utf-8", `${CSS}${WORKBENCH_ENHANCEMENT_CSS}`);
      if (request.method === "GET" && url.pathname === "/app.js") return send(response, 200, "text/javascript; charset=utf-8", CLIENT_JS);
      if (request.method === "GET" && url.pathname === "/api/state") {
        return sendJson(response, 200, publicState(state, csrfToken));
      }

      if (request.method === "POST" && (url.pathname === "/api/save" || url.pathname === "/api/finalize")) {
        assertMutationRequest(request, origin);
        const body = await readJsonBody(request);
        const finalizing = url.pathname === "/api/finalize";
        assertExactKeys(body, finalizing
          ? ["csrfToken", "revisionSha256", "decisions", "humanCheckpoint"]
          : ["csrfToken", "revisionSha256", "decisions"], "review workbench request");
        if (!safeEqual(body.csrfToken, csrfToken)) throw forbidden("CSRF token is invalid");
        if (finalizing && body.humanCheckpoint !== true) throw new Error("Explicit human finalization checkpoint is required");
        const operation = mutationChain.then(async () => {
          state = await updateReviewDecisions({
            state,
            sessionDirectory,
            expectedSha256: body.revisionSha256,
            decisions: body.decisions
          });
          if (!finalizing) return { status: 200, value: publicState(state, csrfToken) };
          const finalized = await finalizeReviewSession({ state, sessionDirectory, outputRoot, catalogText });
          state = finalized.state;
          return {
            status: 200,
            value: {
              ...publicState(state, csrfToken),
              applyCommand: applyCommand(state),
              message: "审核批次已写出，但尚未应用到知识目录。请在终端执行人工确认命令。"
            }
          };
        });
        mutationChain = operation.then(() => undefined, () => undefined);
        const result = await operation;
        return sendJson(response, result.status, result.value);
      }

      response.setHeader("allow", "GET, POST");
      return sendText(response, 404, "Not found");
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 422;
      return sendJson(response, status, { error: error?.message ?? "Request failed" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    server.close();
    throw new Error("Review workbench failed to bind exclusively to IPv4 loopback");
  }
  origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    bootstrapUrl: `${origin}/bootstrap?access=${encodeURIComponent(accessToken)}`,
    sessionId: state.sessionId,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export function batchDigest(batch) {
  return sha256Text(JSON.stringify(batch));
}

export function applyCommand(state) {
  return `node scripts/apply-knowledge-review-batch.mjs --manifest .tooling/knowledge-review-batches/${state.outputFileName} --reviewer ${state.reviewerId} --confirm-human-review --write`;
}

export function assertLoopbackPeer(value) {
  if (value !== "127.0.0.1" && value !== "::ffff:127.0.0.1") throw forbidden("Review workbench accepts loopback clients only");
}

export function assertFailClosedInitialState(batch) {
  assertFailClosedReviewTemplate(batch);
}

async function assertOrdinaryDirectory(directory) {
  const resolved = path.resolve(directory);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Controlled path must be an ordinary directory: ${resolved}`);
  const actual = await realpath(resolved);
  if (!samePath(actual, resolved)) throw new Error(`Controlled directory cannot resolve through a symlink or junction: ${resolved}`);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function assertCatalogQueueSnapshot(catalogText, queue) {
  if (sha256Text(catalogText) !== queue?.catalogSha256) throw new Error("Review queue does not match the current catalog SHA-256");
  const catalog = JSON.parse(catalogText);
  if (catalog?.version !== queue.catalogVersion || queue?.policy?.grantsApproval !== false) {
    throw new Error("Review queue does not match the current catalog version or authority policy");
  }
}

function selectedReviewItems(queue, batch) {
  const byFactId = new Map();
  for (const topic of queue.reviewableTopics) {
    for (const fact of topic.facts) {
      if (byFactId.has(fact.factId)) throw new Error(`Review queue contains duplicate fact ID: ${fact.factId}`);
      byFactId.set(fact.factId, {
        topicId: topic.topicId,
        topicName: topic.displayName,
        category: topic.category,
        factId: fact.factId,
        factText: fact.factText,
        riskLevel: fact.riskLevel,
        requiredAuthoritativeSources: fact.requiredAuthoritativeSources,
        sources: fact.sources.map((source) => {
          if (!isPublicHttpsUrl(source.url)) throw new Error(`Review source is not public HTTPS: ${source.sourceId}`);
          return {
            sourceId: source.sourceId,
            title: source.title,
            publisher: source.publisher,
            authority: source.authority,
            url: source.url,
            reachable: source.reachable
          };
        })
      });
    }
  }
  return batch.decisions.map((decision) => {
    const item = byFactId.get(decision.factId);
    if (!item) throw new Error(`Review batch fact is absent from queue: ${decision.factId}`);
    return item;
  });
}

function assertSessionState(state, catalogText, queue) {
  if (state?.schemaVersion !== 1 || state?.evidenceKind !== SESSION_KIND || !SESSION_ID.test(state?.sessionId ?? "")) {
    throw new Error("Persisted review workbench session is invalid");
  }
  assertAccountableReviewerId(state.reviewerId);
  if (!OUTPUT_NAME.test(state.outputFileName ?? "") || !Number.isInteger(state.revision) || state.revision < 0) {
    throw new Error("Persisted review workbench session metadata is invalid");
  }
  if (!VERSION.test(state.batch?.nextCatalogVersion ?? "") || state.batch.nextCatalogVersion === state.batch.catalogVersion ||
      state.batch.nextCatalogVersion === "REPLACE_WITH_NEW_VERSION" ||
      Boolean(state.finalizedAt) !== Boolean(state.outputSha256) ||
      (state.outputSha256 && !/^[a-f0-9]{64}$/.test(state.outputSha256))) {
    throw new Error("Persisted review workbench release boundary is invalid");
  }
  assertCatalogQueueSnapshot(catalogText, queue);
  const expected = createReviewTemplate(queue, state.selection);
  expected.nextCatalogVersion = state.batch.nextCatalogVersion;
  const immutableExpected = { ...expected, decisions: expected.decisions.map(({ decision, checkedSourceIds, semanticSupportConfirmed, unsupportedClaimsChecked, notes, ...item }) => item) };
  const immutableActual = { ...state.batch, decisions: state.batch.decisions.map(({ decision, checkedSourceIds, semanticSupportConfirmed, unsupportedClaimsChecked, notes, ...item }) => item) };
  if (JSON.stringify(immutableActual) !== JSON.stringify(immutableExpected)) throw new Error("Persisted review session no longer matches its pinned queue selection");
  const expectedItems = selectedReviewItems(queue, expected);
  if (JSON.stringify(state.items) !== JSON.stringify(expectedItems)) throw new Error("Persisted review display data was modified");
  validateDecisionUpdate(state, state.batch.decisions);
}

function validateDecisionUpdate(state, decisions) {
  if (!Array.isArray(decisions) || decisions.length !== state.batch.decisions.length) {
    throw new Error("Decision update must preserve the complete review batch");
  }
  return decisions.map((decision, index) => {
    assertExactKeys(decision, DECISION_KEYS, "review decision update");
    const pinned = state.batch.decisions[index];
    const item = state.items[index];
    if (decision.factId !== pinned.factId || decision.factSha256 !== pinned.factSha256 || item.factId !== decision.factId) {
      throw new Error("Decision update changed a pinned fact identity, digest, or order");
    }
    if (!["pending", "approve", "reject"].includes(decision.decision)) throw new Error(`Invalid decision: ${decision.factId}`);
    if (!Array.isArray(decision.checkedSourceIds) || decision.checkedSourceIds.some((value) => typeof value !== "string") ||
        new Set(decision.checkedSourceIds).size !== decision.checkedSourceIds.length) {
      throw new Error(`Checked sources must be a unique string array: ${decision.factId}`);
    }
    const referenced = new Set(item.sources.map((source) => source.sourceId));
    if (decision.checkedSourceIds.some((sourceId) => !referenced.has(sourceId))) {
      throw new Error(`Decision checked an unreferenced source: ${decision.factId}`);
    }
    if (typeof decision.semanticSupportConfirmed !== "boolean" || typeof decision.unsupportedClaimsChecked !== "boolean") {
      throw new Error(`Decision confirmations must be booleans: ${decision.factId}`);
    }
    if (decision.decision === "reject" && decision.semanticSupportConfirmed) {
      throw new Error(`Rejected decision cannot confirm semantic support: ${decision.factId}`);
    }
    if (typeof decision.notes !== "string" || [...decision.notes.trim()].length > 500) {
      throw new Error(`Review notes must be at most 500 characters: ${decision.factId}`);
    }
    return {
      factId: decision.factId,
      factSha256: decision.factSha256,
      decision: decision.decision,
      checkedSourceIds: [...decision.checkedSourceIds],
      semanticSupportConfirmed: decision.semanticSupportConfirmed,
      unsupportedClaimsChecked: decision.unsupportedClaimsChecked,
      notes: decision.notes
    };
  });
}

async function writeRevision(sessionDirectory, state) {
  await assertOrdinaryDirectory(sessionDirectory);
  const text = `${JSON.stringify(state, null, 2)}\n`;
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const name = `state-${String(state.revision).padStart(6, "0")}-${digest}.json`;
  const revisionPath = path.join(sessionDirectory, name);
  try {
    await writeFile(revisionPath, text, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST" || await readFile(revisionPath, "utf8") !== text) throw error;
  }
}

async function readLatestRevision(sessionDirectory) {
  const names = (await readdir(sessionDirectory))
    .filter((name) => /^state-\d{6}-[a-f0-9]{16}\.json$/.test(name))
    .sort();
  if (!names.length) throw new Error("Review session has no persisted revision");
  const name = names.at(-1);
  const text = await readFile(path.join(sessionDirectory, name), "utf8");
  const expectedDigest = /^state-\d{6}-([a-f0-9]{16})\.json$/.exec(name)?.[1];
  const actualDigest = createHash("sha256").update(text).digest("hex").slice(0, 16);
  if (actualDigest !== expectedDigest) throw new Error("Review session revision SHA-256 does not match its filename");
  const state = JSON.parse(text);
  const revision = Number(/^state-(\d{6})-/.exec(name)?.[1]);
  if (state.revision !== revision) throw new Error("Review session revision filename does not match its contents");
  return state;
}

function publicState(state, csrfToken) {
  return {
    sessionId: state.sessionId,
    reviewerId: state.reviewerId,
    outputFileName: state.outputFileName,
    catalogVersion: state.batch.catalogVersion,
    nextCatalogVersion: state.batch.nextCatalogVersion,
    revision: state.revision,
    revisionSha256: batchDigest(state.batch),
    finalized: Boolean(state.finalizedAt),
    outputSha256: state.outputSha256,
    applyCommand: state.finalizedAt ? applyCommand(state) : null,
    csrfToken,
    decisions: state.batch.decisions,
    items: state.items
  };
}

function authorizedCookie(value, expected) {
  if (typeof value !== "string") return false;
  const token = value.split(";").map((part) => part.trim()).find((part) => part.startsWith("jianwei_review="))?.slice("jianwei_review=".length);
  return safeEqual(token, expected);
}

function assertMutationRequest(request, origin) {
  if (request.headers.origin !== origin) throw forbidden("Mutation origin is invalid");
  if (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") {
    throw forbidden("Cross-site mutation is forbidden");
  }
  if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    const error = new Error("Mutation body must be application/json");
    error.statusCode = 415;
    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 128 * 1024) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body is not valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function safeEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function securityHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-type": contentType,
    "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  };
}

function send(response, status, contentType, body) {
  response.writeHead(status, securityHeaders(contentType));
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, "application/json; charset=utf-8", `${JSON.stringify(value)}\n`);
}

function sendText(response, status, value) {
  send(response, status, "text/plain; charset=utf-8", `${value}\n`);
}

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>见微 · 真人知识审核</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <header><p class="eyebrow">见微 / LOCAL REVIEW</p><h1>真人知识审核工作台</h1><p>来源可访问不等于支持事实。逐一打开来源、核对原文，再作决定。</p></header>
  <main>
    <section class="summary" aria-live="polite">
      <div id="meta">正在读取固定快照…</div><div id="progress"></div><div id="status"></div>
      <div class="review-tools">
        <label for="filter">查看<select id="filter"><option value="all">全部</option><option value="open">待处理</option><option value="ready">已就绪</option></select></label>
        <button id="next-open" class="compact" type="button">下一条待处理</button>
        <button id="export-draft" class="compact" type="button" hidden>导出本地恢复草稿</button>
      </div>
      <button id="reload" class="danger compact" type="button" hidden>重新加载服务端版本</button>
    </section>
    <section id="facts" aria-label="待审核事实"></section>
    <section class="finalize">
      <label><input id="checkpoint" type="checkbox"> 我确认这些判断由我本人完成，且没有把 AI 输出当作审核结论。</label>
      <div class="actions"><button id="save" type="button">保存修订</button><button id="finalize" class="primary" type="button">完成批次</button></div>
      <pre id="command" hidden></pre>
    </section>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>`;

const CSS = `:root{color-scheme:light;--ink:#15211b;--muted:#627068;--paper:#f4f1e8;--card:#fffdf7;--line:#d9d5c9;--green:#1c6a45;--amber:#a05d16;--red:#a33b32}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}header,main{width:min(1040px,calc(100% - 32px));margin:auto}header{padding:52px 0 24px}.eyebrow{letter-spacing:.16em;font-size:12px;color:var(--green);font-weight:700}h1{font:700 clamp(32px,6vw,58px)/1.08 Georgia,"Noto Serif SC",serif;margin:8px 0 12px}header>p:last-child{color:var(--muted);max-width:680px}.summary,.finalize,.fact{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 35px rgba(40,50,44,.06)}.summary{padding:18px 22px;margin-bottom:18px;display:grid;gap:4px}.summary #status{color:var(--green);font-weight:650}.fact{padding:24px;margin:0 0 18px}.fact-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start}.topic{color:var(--muted);font-size:13px}.risk{border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:12px}.risk.health,.risk.safety{color:var(--red);border-color:#e8b7b1}.fact-text{font:600 20px/1.55 Georgia,"Noto Serif SC",serif;margin:18px 0}.sources{display:grid;gap:10px;margin:18px 0}.source{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:12px;border:1px solid var(--line);border-radius:12px}.source a{color:var(--green);font-weight:650}.source small{display:block;color:var(--muted)}.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}.review-grid label{display:block}.wide{grid-column:1/-1}select,textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:white;padding:10px;color:var(--ink)}textarea{min-height:84px;resize:vertical}.check{display:flex!important;gap:9px;align-items:flex-start}.finalize{padding:22px;margin:28px 0 70px}.actions{display:flex;gap:12px;margin-top:18px}button{border:1px solid var(--green);background:transparent;color:var(--green);border-radius:999px;padding:10px 18px;font-weight:700;cursor:pointer}button.primary{background:var(--green);color:white}button:disabled{opacity:.45;cursor:not-allowed}pre{white-space:pre-wrap;background:#16231c;color:#e6f2ea;border-radius:12px;padding:14px;margin-top:18px}@media(max-width:700px){.review-grid{grid-template-columns:1fr}.wide{grid-column:auto}.fact{padding:18px}}`;

const JS = `let model=null;let dirty=false;let timer=null;const byId=(id)=>document.getElementById(id);const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};async function load(){const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('无法读取审核会话');model=await response.json();render()}function render(){byId('meta').textContent='目录 '+model.catalogVersion+' → '+model.nextCatalogVersion+' · 审核人 '+model.reviewerId+' · 输出 '+model.outputFileName;const done=model.decisions.filter((item)=>item.decision!=='pending').length;byId('progress').textContent='已决定 '+done+' / '+model.decisions.length+' · 修订 '+model.revision;const root=byId('facts');root.replaceChildren();model.items.forEach((item,index)=>root.appendChild(renderFact(item,model.decisions[index],index)));byId('save').disabled=model.finalized;byId('finalize').disabled=model.finalized;if(model.finalized){byId('status').textContent='批次已完成；尚未应用到知识目录。';byId('command').textContent=model.applyCommand||'';byId('command').hidden=false}updateProgress()}function renderFact(item,decision,index){const card=el('article','fact');const head=el('div','fact-head');const left=el('div');left.append(el('div','topic',item.topicName+' · '+item.factId));head.append(left,el('span','risk '+item.riskLevel,item.riskLevel));card.append(head,el('p','fact-text',item.factText));const sources=el('div','sources');item.sources.forEach((source)=>{const row=el('div','source');const check=document.createElement('input');check.type='checkbox';check.checked=decision.checkedSourceIds.includes(source.sourceId);check.disabled=model.finalized;check.setAttribute('aria-label','确认已人工核对 '+source.title);check.addEventListener('change',()=>{const set=new Set(decision.checkedSourceIds);check.checked?set.add(source.sourceId):set.delete(source.sourceId);decision.checkedSourceIds=[...set];changed()});const body=el('div');const link=el('a',null,source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';body.append(link,el('small',null,source.publisher+' / '+source.authority+' / '+(source.reachable===true?'可访问':source.reachable===false?'不可访问':'未验证')));row.append(check,body);sources.append(row)});card.append(sources);const grid=el('div','review-grid');const decisionLabel=el('label');decisionLabel.append(el('span',null,'决定'));const select=document.createElement('select');[['pending','待决定'],['approve','批准'],['reject','拒绝']].forEach(([value,text])=>{const option=el('option',null,text);option.value=value;option.selected=decision.decision===value;select.append(option)});select.disabled=model.finalized;select.addEventListener('change',()=>{decision.decision=select.value;changed()});decisionLabel.append(select);grid.append(decisionLabel);grid.append(checkLabel('来源直接支持完整表述',decision.semanticSupportConfirmed,model.finalized,(value)=>{decision.semanticSupportConfirmed=value;changed()}));grid.append(checkLabel('已检查数字、因果、范围与不支持结论',decision.unsupportedClaimsChecked,model.finalized,(value)=>{decision.unsupportedClaimsChecked=value;changed()}));const notesLabel=el('label','wide');notesLabel.append(el('span',null,'审核记录（拒绝时至少 10 个字符）'));const notes=document.createElement('textarea');notes.value=decision.notes;notes.maxLength=500;notes.disabled=model.finalized;notes.addEventListener('input',()=>{decision.notes=notes.value;changed()});notesLabel.append(notes);grid.append(notesLabel);card.append(grid);return card}function checkLabel(text,checked,disabled,onChange){const label=el('label','check');const input=document.createElement('input');input.type='checkbox';input.checked=checked;input.disabled=disabled;input.addEventListener('change',()=>onChange(input.checked));label.append(input,el('span',null,text));return label}function changed(){dirty=true;updateProgress();clearTimeout(timer);timer=setTimeout(()=>save(false),700)}function updateProgress(){if(!model)return;const done=model.decisions.filter((item)=>item.decision!=='pending').length;byId('progress').textContent='已决定 '+done+' / '+model.decisions.length+' · 修订 '+model.revision+(dirty?' · 未保存':'');}async function save(show=true){if(!model||model.finalized)return;clearTimeout(timer);const response=await fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csrfToken:model.csrfToken,revisionSha256:model.revisionSha256,decisions:model.decisions})});const value=await response.json();if(!response.ok){byId('status').textContent=value.error||'保存失败';if(response.status===409)await load();throw new Error(value.error||'保存失败')}model=value;dirty=false;if(show)byId('status').textContent='修订已保存到本机不可变记录。';updateProgress()}async function finalize(){if(!byId('checkpoint').checked){byId('status').textContent='请先完成真人审核确认。';return}if(!confirm('完成后会写出批次，但仍需在终端人工应用。继续吗？'))return;clearTimeout(timer);const response=await fetch('/api/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csrfToken:model.csrfToken,revisionSha256:model.revisionSha256,decisions:model.decisions,humanCheckpoint:true})});const value=await response.json();if(!response.ok){byId('status').textContent=value.error||'完成失败';if(response.status===409)await load();return}model=value;dirty=false;render();byId('command').textContent=value.applyCommand;byId('command').hidden=false;byId('status').textContent=value.message}byId('save').addEventListener('click',()=>save(true));byId('finalize').addEventListener('click',finalize);addEventListener('beforeunload',(event)=>{if(dirty){event.preventDefault();event.returnValue=''}});load().catch((error)=>{byId('status').textContent=error.message});`;
