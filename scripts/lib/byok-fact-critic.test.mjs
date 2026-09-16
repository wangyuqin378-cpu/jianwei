import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factCriticInput, factCriticPayload, parseFactCritic } from "./byok-fact-critic.mjs";
import { quote } from "./byok-eval-budget.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../evaluation/byok-review-calibration-v1.json", import.meta.url)));
const input = factCriticInput({ candidates: fixture.cases[0].candidates });
const valid = () => ({ checks: input.map(c => ({ candidateIndex: c.candidateIndex,
  problematicClaim: null, reason: "合成响应，不代表真实判断。", verdict: "plausible" })) });

test("projects only bounded original candidate text; rejects appended metadata", () => {
  assert.deepEqual(Object.keys(input[0]), ["candidateIndex", "title", "body"]);
  for (const bad of [{ candidates: [] }, { candidates: [...fixture.cases[0].candidates, fixture.cases[0].candidates[0]] },
    { candidates: fixture.cases[0].candidates, oracle: "leak" },
    { candidates: [{ ...fixture.cases[0].candidates[0], sources: [] }] },
    { candidates: [{ ...fixture.cases[0].candidates[0], subjectIndex: true }] }]) {
    assert.throws(() => factCriticInput(bad));
  }
});
test("text-only experiment uses the existing no-tool budget contract", () => {
  const p = factCriticPayload(input);
  assert.equal(quote(p), 1_209_831);
  assert.ok(p.messages.every(m => typeof m.content === "string"));
  const wire = JSON.stringify(p);
  assert.ok(!/base64|image_url|oracle|fileName|enable_search|tools/.test(wire));
  for (const row of fixture.cases) for (const o of row.oracle) {
    assert.ok(!wire.includes(o.reason));
    for (const source of o.sources) assert.ok(!wire.includes(source));
  }
});
test("thinking comparison keeps original model, prompt and input byte-identical", () => {
  const before = factCriticPayload(input);
  const after = factCriticPayload(input, { thinking: true });
  assert.deepEqual(after, { ...before, enable_thinking: true, thinking_budget: 4096 });
  assert.equal(quote(after), 1_229_492);
  assert.throws(() => factCriticPayload(input, { thinking: "true" }));
});
test("new model trial changes only model, not candidates or rules; no arbitrary provider", () => {
  const baseline = factCriticPayload(input);
  const newer = factCriticPayload(input, { model: "qwen3.8-flash" });
  assert.deepEqual(newer, { ...baseline, model: "qwen3.8-flash" });
  assert.equal(quote(newer), 805_530);
  for (const config of [{ model: "qwen3.8-max" }, { model: "qwen3.8-flash", thinking: true }]) {
    assert.throws(() => factCriticPayload(input, config));
  }
});
test("requires exact coverage and literal original criticism; allows honest uncertainty", () => {
  const good = valid();
  good.checks[0] = { ...good.checks[0], verdict: "uncertain", problematicClaim: input[0].title };
  assert.equal(parseFactCritic(good, input).length, 3);
  const changes = [
    v => v.checks.pop(), v => v.checks[1].candidateIndex = 0,
    v => v.checks[0].candidateIndex = true, v => v.checks[0].verdict = "verified",
    v => v.checks[0].problematicClaim = "作者并没有说过的话",
    v => v.checks[0].reason = "", v => v.checks[0].source = "https://example.com",
    v => { v.checks[0].verdict = "incorrect"; v.checks[0].problematicClaim = null; },
  ];
  for (const change of changes) { const v = valid(); change(v); assert.throws(() => parseFactCritic(v, input)); }
});
