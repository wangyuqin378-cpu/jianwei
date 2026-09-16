import assert from "node:assert/strict";
import test from "node:test";
import {scoreEvidenceBodyPair as score} from "./evidence-body-pair-score.js";

const fact = {objectName: "合成装置", title: "装置有两种速度", body: "转得越慢越难检测"};
const sources = [{sourceId: "s1", title: "Synthetic only", evidenceSnippet: "Only two speeds were tested."}];
const check = (supported: boolean) => ({supported, reason: "Synthetic scoring fixture only",
  evidence: supported ? [{sourceId: "s1", quote: sources[0]!.evidenceSnippet}] : []});
const raw = (title: boolean, body: boolean) => ({checks: {"title:0": check(title), "body:0": check(body)}});

test("rejecting a title does not count as detecting the erroneous body", () => {
  const result = score(raw(false, true), fact, sources, false, [fact.body]);
  assert.equal(result.wholeCardMatched, true);
  assert.equal(result.matched, false);
  assert.equal(score(raw(true, false), fact, sources, false, [fact.body]).matched, true);
});

test("every named body error must be detected, not just one", () => {
  const two = {...fact, body: "第一处错误。第二处错误。"};
  const output = raw(true, false) as {checks: Record<string, ReturnType<typeof check>>};
  output.checks["body:1"] = check(true);
  assert.equal(score(output, two, sources, false, ["第一处错误", "第二处错误"]).matched, false);
  output.checks["body:1"] = check(false);
  assert.equal(score(output, two, sources, false, ["第一处错误", "第二处错误"]).matched, true);
});

test("missing output is invalid, never a successful rejection; controls must be retained", () => {
  assert.equal(score({}, fact, sources, false, [fact.body]).matched, false);
  assert.equal(score({}, fact, sources, false, [fact.body]).valid, false);
  assert.equal(score(raw(true, true), fact, sources, true, []).matched, true);
  assert.equal(score(raw(true, false), fact, sources, true, []).matched, false);
});

test("a typo or a title target fails fixture validation before paid calls", () => {
  assert.throws(() => score({}, fact, sources, false, [fact.title]));
  assert.throws(() => score({}, fact, sources, false, []));
  assert.throws(() => score({}, fact, sources, true, [fact.body]));
});

test("an explicit rejection cannot hide an invalid quote in another supported sentence", () => {
  const output = raw(true, false);
  output.checks["title:0"].evidence[0]!.quote = "Invented quotation absent from the frozen source.";
  const result = score(output, fact, sources, false, [fact.body]);
  // The product parser is fail-closed, but that is not a valid full evidence review.
  assert.equal(result.review?.accepted, false);
  assert.equal(result.valid, false);
  assert.equal(result.matched, false);
});
