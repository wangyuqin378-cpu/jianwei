import { randomBytes } from "node:crypto";
import { readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import process from "node:process";
import { applyReviewBatch } from "./lib/review-batch.mjs";
import { factReviewDigest, parseFlagArgs, requiredString, sha256Text } from "./lib/fact-review.mjs";
import {
  assertFailClosedInitialState,
  assertLoopbackPeer,
  createReviewSession,
  prepareControlledRoots,
  preflightReviewSession,
  resolveControlledOutput,
  resumeReviewSession,
  startReviewWorkbench
} from "./lib/review-workbench.mjs";

if (process.argv.includes("--self-test")) {
  await runSelfTest();
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const roots = await prepareControlledRoots(process.cwd());
const catalogPath = path.join(roots.workspaceRoot, "knowledge", "catalog.json");
const queuePath = path.join(roots.workspaceRoot, ".tooling", "knowledge-review-queue", "review-queue.json");
const catalogText = await readFile(catalogPath, "utf8");
const queue = JSON.parse(await readFile(queuePath, "utf8"));
let loaded;

if (args.has("--preflight")) {
  const batch = preflightReviewSession({
    catalogText,
    queue,
    limit: integerArgument(args, "--limit", 20, 1, 50),
    topicId: typeof args.get("--topic") === "string" ? String(args.get("--topic")).trim() : null
  });
  process.stdout.write(`KNOWLEDGE_REVIEW_WORKBENCH_PREFLIGHT=GO catalog=${batch.catalogVersion} decisions=${batch.decisions.length} allPending=1 grantsApproval=0\n`);
  process.exit(0);
}

if (args.has("--resume")) {
  loaded = await resumeReviewSession({
    sessionRoot: roots.sessionRoot,
    sessionId: requiredString(args, "--resume"),
    catalogText,
    queue,
    outputRoot: roots.outputRoot
  });
} else {
  if (!args.has("--confirm-human-review-session")) {
    throw new Error("--confirm-human-review-session is required; this workbench is only for an accountable human reviewer");
  }
  const outputPath = await resolveControlledOutput(roots.outputRoot, path.resolve(process.cwd(), requiredString(args, "--output")));
  loaded = await createReviewSession({
    catalogText,
    queue,
    reviewerId: requiredString(args, "--reviewer"),
    nextCatalogVersion: requiredString(args, "--next-version"),
    outputFileName: path.basename(outputPath),
    limit: integerArgument(args, "--limit", 20, 1, 50),
    topicId: typeof args.get("--topic") === "string" ? String(args.get("--topic")).trim() : null,
    sessionRoot: roots.sessionRoot
  });
}

const port = integerArgument(args, "--port", 8791, 1024, 65535);
const workbench = await startReviewWorkbench({
  ...loaded,
  outputRoot: roots.outputRoot,
  catalogText,
  port
});
process.stdout.write([
  `KNOWLEDGE_REVIEW_WORKBENCH=GO loopback=127.0.0.1 port=${new URL(workbench.origin).port} session=${workbench.sessionId} catalog=${loaded.state.batch.catalogVersion} decisions=${loaded.state.batch.decisions.length} grantsApproval=0`,
  "Open this one-time local URL in your browser:",
  workbench.bootstrapUrl,
  `Resume after stopping: node scripts/knowledge-review-workbench.mjs --resume ${workbench.sessionId} --port ${port}`,
  "The workbench writes a completed decision batch only. It never applies the batch to the knowledge catalog."
].join("\n") + "\n");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await workbench.close();
    process.exit(0);
  });
}

function integerArgument(args, name, fallback, minimum, maximum) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

async function runSelfTest() {
  const workspace = path.join(process.cwd(), ".tooling", `review-workbench-self-test-${randomBytes(6).toString("hex")}`);
  const originalCatalog = fixtureCatalog();
  const catalogText = `${JSON.stringify(originalCatalog, null, 2)}\n`;
  const queue = fixtureQueue(originalCatalog, catalogText);
  let workbench;
  let symlinkRejected = false;
  try {
    const roots = await prepareControlledRoots(workspace);
    await expectFailure(() => resolveControlledOutput(roots.outputRoot, path.join(workspace, "escaped.json")));
    await expectFailure(() => createReviewSession({
      catalogText,
      queue,
      reviewerId: "qwen-reviewer",
      nextCatalogVersion: "fixture-2",
      outputFileName: "fixture-review.json",
      limit: 2,
      sessionRoot: roots.sessionRoot
    }));
    await expectFailure(async () => {
      const unsafe = fixturePendingBatch(originalCatalog, catalogText);
      unsafe.decisions[0].checkedSourceIds = ["official-a"];
      assertFailClosedInitialState(unsafe);
    });
    await expectFailure(async () => assertLoopbackPeer("10.0.0.8"));

    const tampered = await createReviewSession({
      catalogText,
      queue,
      reviewerId: "human-reviewer-1",
      nextCatalogVersion: "fixture-tampered-2",
      outputFileName: "tampered-review.json",
      limit: 2,
      sessionRoot: roots.sessionRoot,
      sessionId: "b".repeat(32)
    });
    const tamperedRevision = (await readdir(tampered.sessionDirectory)).find((name) => name.startsWith("state-"));
    const tamperedPath = path.join(tampered.sessionDirectory, tamperedRevision);
    await writeFile(tamperedPath, `${await readFile(tamperedPath, "utf8")} `, "utf8");
    await expectFailure(() => resumeReviewSession({
      sessionRoot: roots.sessionRoot,
      sessionId: "b".repeat(32),
      catalogText,
      queue,
      outputRoot: roots.outputRoot
    }));

    const linkRoot = path.join(workspace, "linked-output");
    try {
      await symlink(roots.outputRoot, linkRoot, process.platform === "win32" ? "junction" : "dir");
      await expectFailure(() => resolveControlledOutput(linkRoot, path.join(linkRoot, "linked.json")));
      symlinkRejected = true;
    } catch (error) {
      if (!/[Ee](?:PERM|ACCES)|privilege|operation not permitted/i.test(`${error?.code ?? ""} ${error?.message ?? ""}`)) throw error;
    }

    const created = await createReviewSession({
      catalogText,
      queue,
      reviewerId: "human-reviewer-1",
      nextCatalogVersion: "fixture-2",
      outputFileName: "fixture-review.json",
      limit: 2,
      sessionRoot: roots.sessionRoot,
      now: new Date("2026-01-01T00:00:00.000Z"),
      sessionId: "a".repeat(32)
    });
    workbench = await startReviewWorkbench({
      ...created,
      outputRoot: roots.outputRoot,
      catalogText,
      port: 0
    });
    if (workbench.server.address().address !== "127.0.0.1") throw new Error("Self-test server did not bind to loopback");

    const wrongHost = await call(workbench.origin, "/", { headers: { host: "attacker.invalid" } });
    if (wrongHost.status !== 421) throw new Error("Workbench accepted an untrusted Host header");
    const bootstrap = await call(workbench.origin, new URL(workbench.bootstrapUrl).pathname + new URL(workbench.bootstrapUrl).search);
    if (bootstrap.status !== 303 || !bootstrap.headers["set-cookie"]?.[0]) throw new Error("Workbench bootstrap failed");
    const cookie = bootstrap.headers["set-cookie"][0].split(";", 1)[0];
    const bootstrapReplay = await call(workbench.origin, new URL(workbench.bootstrapUrl).pathname + new URL(workbench.bootstrapUrl).search);
    if (bootstrapReplay.status !== 403) throw new Error("Workbench bootstrap token was reusable");
    const stateResponse = await call(workbench.origin, "/api/state", { headers: { cookie } });
    if (stateResponse.status !== 200) throw new Error("Workbench state endpoint failed");
    const initial = JSON.parse(stateResponse.body);
    if (initial.decisions.some((decision) => decision.decision !== "pending" || decision.checkedSourceIds.length || decision.semanticSupportConfirmed || decision.unsupportedClaimsChecked)) {
      throw new Error("Workbench initial state pre-confirmed human checks");
    }
    const csrfFailure = await call(workbench.origin, "/api/save", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ csrfToken: initial.csrfToken, revisionSha256: initial.revisionSha256, decisions: initial.decisions })
    });
    if (csrfFailure.status !== 403) throw new Error("Workbench accepted a mutation without a same-origin Origin header");

    const completed = structuredClone(initial.decisions);
    completed[0] = {
      ...completed[0],
      decision: "approve",
      checkedSourceIds: ["official-a"],
      semanticSupportConfirmed: true,
      unsupportedClaimsChecked: true,
      notes: "Source text checked directly by the accountable reviewer."
    };
    completed[1] = {
      ...completed[1],
      decision: "reject",
      checkedSourceIds: ["official-b"],
      semanticSupportConfirmed: false,
      unsupportedClaimsChecked: true,
      notes: "The source does not support the full scope of this claim."
    };
    const saved = await apiMutation(workbench.origin, "/api/save", cookie, initial, completed);
    if (saved.status !== 200) throw new Error(`Workbench valid save failed: ${saved.body}`);
    const current = JSON.parse(saved.body);
    const stale = await apiMutation(workbench.origin, "/api/save", cookie, initial, completed);
    if (stale.status !== 409) throw new Error("Workbench accepted a stale concurrent revision");
    const noCheckpoint = await call(workbench.origin, "/api/finalize", {
      method: "POST",
      headers: { cookie, origin: workbench.origin, "content-type": "application/json" },
      body: JSON.stringify({ csrfToken: current.csrfToken, revisionSha256: current.revisionSha256, decisions: current.decisions, humanCheckpoint: false })
    });
    if (noCheckpoint.status !== 422) throw new Error("Workbench finalized without the explicit human checkpoint");
    const finalized = await call(workbench.origin, "/api/finalize", {
      method: "POST",
      headers: { cookie, origin: workbench.origin, "content-type": "application/json" },
      body: JSON.stringify({ csrfToken: current.csrfToken, revisionSha256: current.revisionSha256, decisions: current.decisions, humanCheckpoint: true })
    });
    if (finalized.status !== 200) throw new Error(`Workbench finalization failed: ${finalized.body}`);
    const batchText = await readFile(path.join(roots.outputRoot, "fixture-review.json"), "utf8");
    const batch = JSON.parse(batchText);
    const applied = applyReviewBatch({ catalogText, batch, reviewerId: "human-reviewer-1", now: new Date("2026-01-02T00:00:00.000Z") });
    if (applied.metrics.approved !== 1 || applied.metrics.rejected !== 1 || JSON.stringify(originalCatalog) !== JSON.stringify(fixtureCatalog())) {
      throw new Error("Workbench output was not apply-compatible or mutated the source catalog");
    }
    process.stdout.write(`KNOWLEDGE_REVIEW_WORKBENCH_SELF_TEST=GO synthetic=1 releaseEvidence=0 loopbackOnly=1 hostRejected=1 csrfRejected=1 oneTimeBootstrap=1 pathEscapeRejected=1 symlinkRejected=${symlinkRejected ? 1 : 0} aiReviewerRejected=1 preconfirmedRejected=1 revisionDigestRejected=1 staleRevisionRejected=1 humanCheckpoint=1 atomicFinalOutput=1 autoApply=0\n`);
  } finally {
    if (workbench) await workbench.close();
    const resolved = path.resolve(workspace);
    const expectedRoot = path.resolve(process.cwd(), ".tooling");
    if (resolved.startsWith(`${expectedRoot}${path.sep}`)) await rm(resolved, { recursive: true, force: true });
  }
}

async function apiMutation(origin, pathname, cookie, state, decisions) {
  return call(origin, pathname, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ csrfToken: state.csrfToken, revisionSha256: state.revisionSha256, decisions })
  });
}

function call(origin, pathname, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, origin);
    const request = httpRequest(url, { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function expectFailure(operation) {
  let failed = false;
  try {
    await operation();
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("Review workbench self-test expected a fail-closed rejection");
}

function fixtureCatalog() {
  return {
    version: "fixture-1",
    sources: [
      { sourceId: "official-a", title: "Official A", publisher: "A", authority: "official", url: "https://example.org/a" },
      { sourceId: "official-b", title: "Official B", publisher: "B", authority: "professional", url: "https://example.org/b" }
    ],
    topics: [{
      topicId: "fixture",
      displayName: "Fixture topic",
      category: "home",
      facts: [
        { factId: "approve-me", topicId: "fixture", factText: "This fixture fact has a source-supported card body for review.", sourceIds: ["official-a"], riskLevel: "general", reviewStatus: "draft" },
        { factId: "reject-me", topicId: "fixture", factText: "This fixture claim deliberately needs a documented human rejection.", sourceIds: ["official-b"], riskLevel: "general", reviewStatus: "draft" }
      ]
    }]
  };
}

function fixtureQueue(catalog, catalogText) {
  return {
    schemaVersion: 2,
    evidenceKind: "human_semantic_review_work_queue",
    catalogVersion: catalog.version,
    catalogSha256: sha256Text(catalogText),
    generatedAt: "2026-01-01T00:00:00.000Z",
    policy: { grantsApproval: false, humanReviewRequired: true },
    reviewableTopics: catalog.topics.map((topic) => ({
      topicId: topic.topicId,
      displayName: topic.displayName,
      category: topic.category,
      facts: topic.facts.map((fact) => ({
        factId: fact.factId,
        factSha256: factReviewDigest(topic.topicId, fact),
        factText: fact.factText,
        riskLevel: fact.riskLevel,
        requiredAuthoritativeSources: 0,
        sources: fact.sourceIds.map((sourceId) => {
          const source = catalog.sources.find((candidate) => candidate.sourceId === sourceId);
          return { ...source, reachable: true };
        })
      }))
    }))
  };
}

function fixturePendingBatch(catalog, catalogText) {
  return {
    schemaVersion: 1,
    evidenceKind: "human_semantic_review_decision_batch",
    catalogVersion: catalog.version,
    catalogSha256: sha256Text(catalogText),
    nextCatalogVersion: "fixture-2",
    createdFromQueueAt: "2026-01-01T00:00:00.000Z",
    decisions: catalog.topics[0].facts.map((fact) => ({
      factId: fact.factId,
      factSha256: factReviewDigest("fixture", fact),
      decision: "pending",
      checkedSourceIds: [],
      semanticSupportConfirmed: false,
      unsupportedClaimsChecked: false,
      notes: ""
    }))
  };
}
