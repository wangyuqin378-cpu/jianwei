import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Test-only HTTP interception. No real image, provider or Cloudflare request
// can leave this process. These synthetic rows are not release evidence.
const fixture = `
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { appendFileSync } from "node:fs";
let photoIndex = 0;
let devices = 0;
globalThis.fetch = async url => {
  if (String(url).endsWith("/health/ready")) return Response.json({release:{workerVersion:"fixture-only",policyVersion:"fixture",models:{recognition:"fixture"}}});
  if (new URL(url).hostname !== "example.edu") throw new Error("Unexpected egress");
  return new Response("fixture source");
};
https.request = (url, options, callback) => {
  if (new URL(url).hostname !== "gateway.test") throw new Error("Unexpected egress");
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.end = encoded => queueMicrotask(() => {
    const body = JSON.parse(encoded);
    const route = new URL(url).pathname;
    appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify({route,headers:options.headers,body}) + "\\n");
    let payload;
    if (route === "/v1/devices/register") payload = {deviceId:"device-" + devices++,deviceToken:"fixture-token"};
    else if (route === "/v1/photo-insights") {
      const index = photoIndex++;
      payload = index % 3 === 2 ? {candidateId:body.candidateId,status:"no_insight",reason:"fixture"} : {
        candidateId:body.candidateId,status:"ready",
        scores:{surprise:4,aha:4,retellability:4,imageConnection:4,qualityScore:0.8},
        card:{cardId:"card-" + index,topicId:"topic_" + index,detectedObjectName:"物件",title:"fixture",body:"fixture",sources:[{url:"https://example.edu/" + index}]}
      };
    } else if (route === "/v1/daily-winner") {
      payload = {cardId:body.cards.at(-1).cardId,selectionMethod:process.env.FIXTURE_WINNER_METHOD || "ai"};
      if (payload.selectionMethod === "missing") delete payload.selectionMethod;
    } else throw new Error("Unexpected route");
    const res = new EventEmitter(); res.statusCode = 200;
    callback(res); res.emit("data", Buffer.from(JSON.stringify(payload))); res.emit("end");
  });
  return req;
};
syncBuiltinESMExports();
`;

function setup(t, method = "ai") {
  const root = mkdtempSync(path.join(tmpdir(), "jianwei-product-eval-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const photos = Array.from({ length: 60 }, (_, i) => {
    const photoBytes = Buffer.from([0xff, 0xd8, 0xff, i, 0xd9]);
    const jpeg = path.join(root, `fixture-${i}.jpg`);
    writeFileSync(jpeg, photoBytes);
    return { fileName: `photo-${i}.jpg`, expectedTopicId: `topic_${i % 30}`, expectedDisplayName: "物件", category: "fixture",
      currentAppEligible: true, sanitizedFile: jpeg, labels: [], faceCount: 0, sensitiveFlags: [] };
  });
  const dataset = path.join(root, "dataset.json"), preflight = path.join(root, "preflight.json");
  const preload = path.join(root, "fixture.mjs"), output = path.join(root, "output.json"), calls = path.join(root, "calls.jsonl");
  writeFileSync(dataset, JSON.stringify({ count: 60, topicCount: 30, photos }));
  writeFileSync(preflight, JSON.stringify({ photos }));
  writeFileSync(preload, fixture);
  const invoke = () => spawnSync(process.execPath, ["--import", preload,
    new URL("./run-product-photo-insight-eval.mjs", import.meta.url).pathname,
    "--base-url", "https://gateway.test", "--dataset", dataset, "--preflight", preflight,
    "--output", output, "--run-id", "fixture-run"], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, JIANWEI_EVALUATION_KEY: "fixture-evaluation-key", FIXTURE_CALLS: calls, FIXTURE_WINNER_METHOD: method }
  });
  return { invoke, output, photos, preflight, calls: () => {
    try { return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  } };
}

test("all 60 photos and seven selections use evaluation auth and preserve actual winners", t => {
  const run = setup(t), result = run.invoke();
  assert.equal(result.status, 0, result.stderr);
  const calls = run.calls();
  const paid = calls.filter(c => c.route !== "/v1/devices/register");
  assert.equal(paid.filter(c => c.route === "/v1/photo-insights").length, 60);
  assert.equal(paid.filter(c => c.route === "/v1/daily-winner").length, 7);
  assert.ok(paid.every(c => c.headers["x-jianwei-evaluation-key"] === "fixture-evaluation-key"));
  const output = JSON.parse(readFileSync(run.output));
  assert.equal(output.dailyGroups.length, 7);
  assert.ok(output.dailyGroups.every(g => g.selectionMethod === "ai" && g.winnerCardId === g.qualifiedCardIds.at(-1)));
  assert.equal(output.metrics.fallbackDailySelections, 0);
});

test("saved winner checkpoints prevent another model request when finalization resumes", t => {
  const run = setup(t), first = run.invoke();
  assert.equal(first.status, 0, first.stderr);
  const checkpoint = JSON.parse(readFileSync(run.output + ".checkpoint.json"));
  assert.equal(Object.keys(checkpoint.dailySelections ?? {}).length, 7);
  const previousCallCount = run.calls().length;
  rmSync(run.output); // Simulate interrupted final report writing in this disposable fixture only.
  const second = run.invoke();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(run.calls().length, previousCallCount);
});

test("fallback is retained in the report but fails formal AI-selection acceptance", t => {
  const run = setup(t, "fallback"), result = run.invoke();
  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(readFileSync(run.output));
  assert.equal(output.metrics.fallbackDailySelections, 7);
  assert.ok(output.dailyGroups.every(g => g.selectionMethod === "fallback"));
});

test("an old endpoint without selection provenance cannot pass a new release run", t => {
  const run = setup(t, "missing"), result = run.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /selection method/i);
});

test("a completed experiment refuses a second run before any provider request", t => {
  const run = setup(t), first = run.invoke();
  assert.equal(first.status, 0, first.stderr);
  const callCount = run.calls().length;
  const second = run.invoke();
  assert.equal(second.status, 1);
  assert.match(second.stderr, /output already exists/);
  assert.equal(run.calls().length, callCount);
});

test("changing candidates in a saved winner checkpoint fails before another comparison", t => {
  const run = setup(t), first = run.invoke();
  assert.equal(first.status, 0, first.stderr);
  rmSync(run.output);
  const checkpointFile = run.output + ".checkpoint.json";
  const checkpoint = JSON.parse(readFileSync(checkpointFile));
  checkpoint.results[0].card.body = "changed fixture";
  writeFileSync(checkpointFile, JSON.stringify(checkpoint));
  const callCount = run.calls().length;
  const second = run.invoke();
  assert.equal(second.status, 1);
  assert.match(second.stderr, /different candidates/);
  assert.equal(run.calls().length, callCount);
});

test("report binds actual sanitized JPEG bytes even when metadata has no image hash", t => {
  const run = setup(t), result = run.invoke();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(readFileSync(run.output));
  const identities = run.photos.map(photo => ({ fileName: photo.fileName,
    sanitizedSha256: createHash("sha256").update(readFileSync(photo.sanitizedFile)).digest("hex") }));
  assert.deepEqual(output.results.map(row => ({fileName:row.fileName,sanitizedSha256:row.sanitizedSha256})), identities);
  assert.equal(output.photoInputSha256, createHash("sha256").update(JSON.stringify(identities)).digest("hex"));
  assert.equal(output.preflightSha256, createHash("sha256").update(readFileSync(run.preflight)).digest("hex"));
});

test("a changed image or preflight cannot resume previously paid results", t => {
  for (const change of ["image", "preflight"]) {
    const run = setup(t), first = run.invoke();
    assert.equal(first.status, 0, first.stderr);
    rmSync(run.output);
    if (change === "image") writeFileSync(run.photos[0].sanitizedFile, Buffer.from([0xff,0xd8,0xff,255,0xd9]));
    else {
      const preflight = JSON.parse(readFileSync(run.preflight));
      preflight.photos[0].labels = ["changed label"];
      writeFileSync(run.preflight, JSON.stringify(preflight));
    }
    const callCount = run.calls().length;
    const second = run.invoke();
    assert.equal(second.status, 1);
    assert.match(second.stderr, /photo inputs or preflight/i);
    assert.equal(run.calls().length, callCount);
  }
});

test("sixty filenames cannot conceal duplicate JPEG bytes or an unsafe preflight", t => {
  for (const change of ["duplicate", "sensitive", "face"]) {
    const run = setup(t);
    if (change === "duplicate") writeFileSync(run.photos[1].sanitizedFile, readFileSync(run.photos[0].sanitizedFile));
    else {
      const preflight = JSON.parse(readFileSync(run.preflight));
      if (change === "face") preflight.photos[0].faceCount = 1;
      else preflight.photos[0].sensitiveFlags = ["document"];
      writeFileSync(run.preflight, JSON.stringify(preflight));
    }
    const result = run.invoke();
    assert.equal(result.status, 1);
    assert.equal(run.calls().length, 0);
  }
});
