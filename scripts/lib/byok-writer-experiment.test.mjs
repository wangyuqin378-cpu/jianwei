import { test } from "node:test";
import assert from "node:assert/strict";
import { writerExperimentPayload, writerExperimentSource, replayPrefixLength, completedReplayChoice,
  validateWriterModel, validateWriterThinking } from "./byok-writer-experiment.mjs";
import { quote } from "./byok-eval-budget.mjs";

const writer = { model: "qwen3.7-plus-2026-05-26", messages: [{ role: "user", content: "unchanged JSON prompt" }],
  enable_thinking: false, temperature: .3, max_tokens: 2048, response_format: { type: "json_object" } };

test("paid replay preserves completion evidence and rejects unfinished or unverifiable old responses", () => {
  const original = { status: 200, finishReason: "stop", reservation: "original-reservation", content: '{"candidates":[]}' };
  assert.deepEqual(completedReplayChoice(original), {
    finish_reason: "stop", message: { content: original.content },
  });
  for (const patch of [{ finishReason: undefined }, { finishReason: null }, { finishReason: "length" },
    { finishReason: "tool_calls" }, { status: 400 }, { reservation: undefined }, { replayed: true },
    { syntheticFixtureInput: true }, { content: null }]) {
    assert.throws(() => completedReplayChoice({ ...original, ...patch }), /recorded finishReason=stop/);
  }
  assert.throws(() => completedReplayChoice(undefined));
  assert.equal(original.finishReason, "stop");
});

test("writer experiment changes only the paid writer model, not App prompt/detection/review", () => {
  const actual = writerExperimentPayload(writer, {}, 1, "qwen3.8-flash");
  assert.deepEqual(actual, { ...writer, model: "qwen3.8-flash" });
  assert.equal(writer.model, "qwen3.7-plus-2026-05-26");
  assert.equal(quote(actual), 805_530);
  for (const [stage, model] of [[0, "qwen3.7-flash-2026-07-15"], [2, "qwen3-vl-plus-2025-12-19"]]) {
    const payload = { ...writer, model };
    assert.equal(writerExperimentPayload(payload, {}, stage, "qwen3.8-flash"), payload);
  }
  assert.equal(writerExperimentPayload(writer, {}, 1), writer);
});

test("writer experiment cannot enable tools/moderation, accept arbitrary models, or override visual calls", () => {
  assert.throws(() => validateWriterModel("qwen3.8-max"));
  for (const patch of [{ tools: [] }, { enable_search: true }, { enable_thinking: true },
    { messages: [{ role: "user", content: [{ type: "image_url" }] }] }, { model: "qwen3-vl-plus-2025-12-19" }]) {
    assert.throws(() => writerExperimentPayload({ ...writer, ...patch }, {}, 1, "qwen3.8-flash"));
  }
  assert.throws(() => writerExperimentPayload(writer, { "x-dashscope-datainspection": "cip" }, 1, "qwen3.8-flash"));
  assert.throws(() => writerExperimentPayload(writer, {}, 3, "qwen3.8-flash"));
});

test("writer comparison freezes only detection; old reviewer comparison still freezes two stages", () => {
  assert.equal(replayPrefixLength({ detection: "original", writerModel: "qwen3.8-flash" }), 1);
  assert.equal(replayPrefixLength({ prefix: "original" }), 2);
  assert.equal(replayPrefixLength({}), 0);
  for (const args of [{ prefix: "a", detection: "b" }, { calibration: "a", detection: "b" },
    { calibration: "a", writerModel: "qwen3.8-flash" }, { prefix: "a", writerModel: "qwen3.8-flash" },
    { prefix: "a", thinkingBudget: 4096 }, { calibration: "a", thinkingBudget: 4096 }]) assert.throws(() => replayPrefixLength(args));
});

test("bounded writer thinking keeps model/prompt/visual calls unchanged and disallows combined experiments", () => {
  const actual = writerExperimentPayload(writer, {}, 1, undefined, 4096);
  assert.deepEqual(actual, { ...writer, enable_thinking: true, thinking_budget: 4096 });
  assert.equal(actual.messages, writer.messages);
  assert.equal(writer.enable_thinking, false);
  assert.equal(quote(actual), 6_147_456);
  for (const [stage, model] of [[0, "qwen3.7-flash-2026-07-15"], [2, "qwen3-vl-plus-2025-12-19"]]) {
    const p = { ...writer, model };
    assert.equal(writerExperimentPayload(p, {}, stage, undefined, 4096), p);
  }
  for (const budget of [0, 2048, 8192, "4096", NaN]) assert.throws(() => validateWriterThinking(budget));
  assert.throws(() => writerExperimentPayload(writer, {}, 1, "qwen3.8-flash", 4096));
  for (const patch of [{ messages: [{ role: "user", content: [{ type: "image_url" }] }] },
    { enable_search: true }, { tools: [] }, { model: "qwen3-vl-plus-2025-12-19" }]) {
    assert.throws(() => writerExperimentPayload({ ...writer, ...patch }, {}, 1, undefined, 4096));
  }
  assert.throws(() => writerExperimentPayload(writer, { "x-dashscope-datainspection": "cip" }, 1, undefined, 4096));
  assert.equal(replayPrefixLength({ detection: "original", thinkingBudget: 4096 }), 1);
});

test("experimental compilation changes only one timeout literal, fails if production shape drifts", () => {
  const source = "unchanged prompt\n request.timeoutInterval = 30\n unchanged parser";
  assert.equal(writerExperimentSource(source), source);
  assert.equal(writerExperimentSource(source, 4096), source.replace("= 30", "= 120"));
  assert.throws(() => writerExperimentSource("missing", 4096));
  assert.throws(() => writerExperimentSource(source + source, 4096));
  assert.throws(() => writerExperimentSource(source, 8192));
});
