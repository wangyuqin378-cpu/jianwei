import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCalibration, calibrationRow, calibrationPrefix, assertCalibrationRequest,
  scoreCalibration } from "./byok-review-calibration.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../evaluation/byok-review-calibration-v1.json", import.meta.url)));
const clone = () => structuredClone(fixture);
const review = (candidateIndex, accepted) => ({ candidateIndex, reason: "独立判断", decision: accepted ? "accept" : "reject",
  generalKnowledge: true, noKnownError: true, photoMatches: true, scopeSupported: true, notDuplicate: true,
  surprise: accepted ? 4 : 1, aha: 4, retellability: 4, imageConnection: 4 });

test("v14.1 keeps valid model choices and repairs only inconsistent summaries", () => {
  const row = fixture.cases[0];
  const answer = { reviews: row.candidates.map((_, i) => ({ ...review(i, i === 2), claimScope: "category" })), winnerIndex: 0 };
  answer.reviews[2].decision = "reject";
  const score = value => scoreCalibration(row, JSON.stringify(value), { selectionFallback: true });
  assert.equal(score(answer).winnerIndex, 2);
  answer.winnerIndex = null;
  assert.equal(score(answer).winnerIndex, 2);
  answer.reviews[0].surprise = 3;
  answer.winnerIndex = 0;
  assert.equal(score(answer).winnerIndex, 0, "do not replace a valid editorial choice with another higher score");
  for (const key of ["generalKnowledge", "noKnownError", "photoMatches", "scopeSupported", "notDuplicate"]) {
    const rejected = structuredClone(answer); rejected.reviews[0][key] = false; rejected.reviews[2][key] = false;
    assert.equal(score(rejected).winnerIndex, null);
  }
  for (const invalid of [true, -1, 3, "0", undefined]) assert.equal(score({ ...answer, winnerIndex: invalid }).valid, false);
  answer.reviews[1].photoMatches = 1;
  assert.equal(score(answer).valid, false, "non-winning malformed fields remain fatal");
});

test("v14 selects only eligible scores, independent of order, with no redundant decisions", () => {
  const row = fixture.cases[0];
  const answer = { reviews: row.candidates.map((_, i) => {
    const r = { ...review(i, i === 2), claimScope: "category" }; delete r.decision; return r;
  }) };
  const score = value => scoreCalibration(row, JSON.stringify(value), { derivedSelection: true });
  assert.equal(score(answer).winnerIndex, 2);
  assert.ok(score(answer).decisions.every(r => r.correct));
  answer.reviews.reverse();
  assert.equal(score(answer).winnerIndex, 2);
  const eligible = answer.reviews.find(r => r.candidateIndex === 2);
  for (const [key, value] of Object.entries({ generalKnowledge: false, noKnownError: false,
    photoMatches: false, scopeSupported: false, notDuplicate: false,
    surprise: 2, aha: 3, retellability: 3, imageConnection: 2 })) {
    const failed = structuredClone(answer); failed.reviews.find(r => r.candidateIndex === 2)[key] = value;
    assert.equal(score(failed).winnerIndex, null);
    assert.equal(score(failed).winnerCorrect, false);
  }
  for (const patch of [{ decision: "accept" }, { photoMatches: 1 }, { aha: true },
    { claimScope: "other" }, { candidateIndex: 0 }, { connection: "sameKind" }]) {
    const malformed = structuredClone(answer); Object.assign(malformed.reviews[0], patch);
    assert.equal(score(malformed).valid, false);
  }
  const missing = structuredClone(answer); delete missing.reviews[0].claimScope;
  assert.equal(score(missing).valid, false);
  assert.equal(score({ ...answer, winnerIndex: 2 }).valid, false);
  const first = answer.reviews.find(r => r.candidateIndex === 0);
  Object.assign(first, eligible, { candidateIndex: 0 });
  assert.equal(score(answer).winnerIndex, 0, "stable original order breaks ties");
  eligible.surprise = 5;
  assert.equal(score(answer).winnerIndex, 2);
});

test("fixed 4 photos / 12 candidates validate; positive positions vary", () => {
  assert.equal(validateCalibration(fixture), fixture);
  assert.equal(fixture.cases.flatMap(c => c.candidates).length, 12);
  assert.equal(new Set(fixture.cases.flatMap(c => c.oracle.filter(o => o.expected === "accept").map(o => o.candidateIndex))).size, 3);
});
test("reject malformed, duplicate or escaping fixture inputs before any HTTP", () => {
  const changes = [
    f => f.cases.push(f.cases[0]), f => f.cases[0].fileName = "../web-001.jpg",
    f => f.cases[0].sha256 = "no", f => f.cases[0].candidates.push(f.cases[0].candidates[0]),
    f => f.cases[0].candidates[0].sources = ["https://example.com"],
    f => f.cases[0].candidates[0].body = "https://example.com/" + "来源".repeat(20),
    f => f.cases[0].candidates[0].subjectIndex = true,
    f => f.cases[0].candidates[0].body = "字".repeat(101),
    f => f.cases[0].oracle[1].candidateIndex = 0,
  ];
  for (const change of changes) { const f = clone(); change(f); assert.throws(() => validateCalibration(f)); }
});
test("only exact approved image bytes are associated with a case", () => {
  const row = fixture.cases[0];
  assert.equal(calibrationRow(fixture, row), row);
  assert.throws(() => calibrationRow(fixture, { ...row, sha256: "0".repeat(64) }));
  assert.throws(() => calibrationRow(fixture, { ...row, fileName: "web-060.jpg" }));
});
test("explicit allowlist projection excludes every oracle field; never mocks reviewer", () => {
  for (const row of fixture.cases) {
    for (const stage of [0, 1]) {
      const content = calibrationPrefix({ ...row, oracle: [{ reason: "PRIVATE_ORACLE", sources: ["https://private.example"] }] }, stage);
      assert.ok(!/PRIVATE_ORACLE|private\.example|expected|reason|oracle|sha256|web-\d/.test(content));
      const parsed = JSON.parse(content);
      if (stage === 0) assert.deepEqual(Object.keys(parsed).sort(), ["sensitiveFlags", "subjects"]);
      else assert.deepEqual(parsed.candidates, row.candidates);
    }
    assert.throws(() => calibrationPrefix(row, 2));
  }
});
test("no answer leakage, missing candidates, unexpected model or extra live stage", () => {
  const row = fixture.cases[0];
  const payload = { model: "qwen3-vl-plus-2025-12-19", messages: [{ role: "user", content: JSON.stringify(row.candidates) }] };
  assert.doesNotThrow(() => assertCalibrationRequest(row, payload, 2));
  for (const text of [row.oracle[0].reason, row.oracle[0].sources[0], row.fileName, row.sha256, '"oracle"']) {
    assert.throws(() => assertCalibrationRequest(row, { ...payload,
      messages: [...payload.messages, { content: text }] }, 2));
  }
  assert.throws(() => assertCalibrationRequest(row, { ...payload, messages: [{ content: "JSON" }] }, 2));
  assert.throws(() => assertCalibrationRequest(row, { ...payload, model: "other-model" }, 2));
  assert.throws(() => assertCalibrationRequest(row, payload, 3));
});
test("score frozen labels, not just winner; schema failures never count as correct rejections", () => {
  const row = fixture.cases[0];
  const good = { reviews: row.candidates.map((_, i) => review(i, i === 2)), winnerIndex: 2 };
  let result = scoreCalibration(row, JSON.stringify(good));
  assert.equal(result.winnerCorrect, true);
  assert.ok(result.decisions.every(r => r.correct));
  good.reviews[0] = review(0, true);
  result = scoreCalibration(row, JSON.stringify(good));
  assert.equal(result.winnerCorrect, true);
  assert.equal(result.decisions[0].correct, false);
  for (const bad of ["not json", JSON.stringify({ ...good, winnerIndex: 1 }),
    JSON.stringify({ ...good, reviews: [good.reviews[0], good.reviews[0], good.reviews[2]] }),
    JSON.stringify({ ...good, winnerIndex: null })]) assert.equal(scoreCalibration(row, bad).valid, false);
});
test("scope-aware revisions cannot silently use the old review schema", () => {
  const row = fixture.cases[0];
  const answer = { reviews: row.candidates.map((_, i) => review(i, i === 2)), winnerIndex: 2 };
  assert.equal(scoreCalibration(row, JSON.stringify(answer), { requireScope: true }).valid, false);
  for (const r of answer.reviews) r.claimScope = "category";
  assert.equal(scoreCalibration(row, JSON.stringify(answer), { requireScope: true }).valid, true);
  answer.reviews[0].claimScope = "other";
  assert.equal(scoreCalibration(row, JSON.stringify(answer), { requireScope: true }).valid, false);
});

test("connection contract binds the photo anchor and cannot bypass factual or subtype gates", () => {
  const f = validateCalibration(JSON.parse(readFileSync(new URL("../../evaluation/byok-review-connections-v1.json", import.meta.url))));
  const row = f.cases[0];
  const answer = { reviews: row.candidates.map((_, i) => ({ ...review(i, i === 0),
    claimScope: "category", photoObject: row.subject.displayName,
    knowledgeObject: "压合式无针订书机", connection: "relatedKind" })), winnerIndex: 0 };
  const score = value => scoreCalibration(row, JSON.stringify(value), { requireScope: true, requireConnection: true });
  assert.equal(score(answer).valid, true);
  for (const field of ["photoObject", "knowledgeObject", "connection"]) {
    const missing = structuredClone(answer); delete missing.reviews[0][field];
    assert.equal(score(missing).valid, false);
  }
  for (const patch of [{ photoObject: "镜头" }, { knowledgeObject: " " }, { connection: "unknown" },
    { connection: "unrelated" }, { claimScope: "picturedItem" }, { noKnownError: false }, { photoMatches: false }]) {
    const invalid = structuredClone(answer); Object.assign(invalid.reviews[0], patch);
    assert.equal(score(invalid).valid, false);
  }
});

test("split photo review never sees titles and text selection requires independent visual proof", () => {
  const row = fixture.cases[0];
  const photoRequest = { model: "qwen3-vl-plus-2025-12-19", messages: [{ content: "JSON 只识图 相机镜头" }] };
  assert.doesNotThrow(() => assertCalibrationRequest(row, photoRequest, 2, { separatePhoto: true }));
  assert.throws(() => assertCalibrationRequest(row, { ...photoRequest,
    messages: [{ content: JSON.stringify(row.candidates) }] }, 2, { separatePhoto: true }));
  const textRequest = { ...photoRequest, messages: [{ content: JSON.stringify(row.candidates) }] };
  assert.doesNotThrow(() => assertCalibrationRequest(row, textRequest, 3, { separatePhoto: true }));
  assert.throws(() => assertCalibrationRequest(row, { ...textRequest,
    messages: [{ content: [{ type: "text", text: JSON.stringify(row.candidates) }] }] }, 3, { separatePhoto: true }));
  const reviews = row.candidates.map((_, i) => {
    const r = { ...review(i, i === 2), claimScope: "category", photoObject: row.subject.displayName,
      knowledgeObject: "镜头镀膜", connection: "sameKind" };
    delete r.photoMatches; return r;
  });
  const raw = JSON.stringify({ reviews, winnerIndex: 2 });
  const proof = { objects: [{ objectIndex: 0,
    photoObject: row.subject.displayName, visible: true, observations: "圆筒状物件" }] };
  const score = photoResponse => scoreCalibration(row, raw, { requireScope: true, requireConnection: true,
    separatePhoto: true, photoResponse });
  assert.equal(score(JSON.stringify(proof)).valid, true);
  assert.equal(score(undefined).valid, false);
  proof.objects[0].visible = false;
  assert.equal(score(JSON.stringify(proof)).valid, false);
});

test("all-reject fixtures reward no winner only", () => {
  const original = validateCalibration(JSON.parse(readFileSync(new URL("../../evaluation/byok-review-original-v11.json", import.meta.url))));
  for (const row of original.cases) {
    const answer = { reviews: row.candidates.map((_, i) => review(i, false)), winnerIndex: null };
    assert.equal(scoreCalibration(row, JSON.stringify(answer)).winnerCorrect, true);
    answer.reviews[0] = review(0, true); answer.winnerIndex = 0;
    assert.equal(scoreCalibration(row, JSON.stringify(answer)).winnerCorrect, false);
  }
});
