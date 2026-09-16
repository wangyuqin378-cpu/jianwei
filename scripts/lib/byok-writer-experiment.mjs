import { quote } from "./byok-eval-budget.mjs";

export function validateWriterModel(model) {
  if (model !== undefined && model !== "qwen3.8-flash") {
    throw new Error("Only the budgeted experimental writer is allowed");
  }
  return model;
}

export function validateWriterThinking(budget, writerModel) {
  if (budget !== undefined && (budget !== 4096 || writerModel !== undefined)) {
    throw new Error("Only default Plus with 4096 thinking tokens; do not change two variables");
  }
  return budget;
}

// The production App stays unchanged. A thinking experiment compiles an
// explicitly marked timeout-only source copy, so it can measure quality even
// when slower than the App's 30s deadline. Never count it as App latency proof.
export function writerExperimentSource(source, thinkingBudget) {
  validateWriterThinking(thinkingBudget);
  if (thinkingBudget === undefined) return source;
  const original = "request.timeoutInterval = 30";
  if (source.split(original).length !== 2) throw new Error("Unexpected App timeout contract");
  return source.replace(original, "request.timeoutInterval = 120");
}

// Offline evaluation transport only. Never override detection or review, add
// tools, change prompts, or pretend this is the App's default model selection.
export function writerExperimentPayload(payload, headers, stage, writerModel, thinkingBudget) {
  validateWriterModel(writerModel);
  validateWriterThinking(thinkingBudget, writerModel);
  quote(payload, headers);
  if (!writerModel && thinkingBudget === undefined) return payload;
  const stages = ["qwen3.7-flash-2026-07-15", "qwen3.7-plus-2026-05-26", "qwen3-vl-plus-2025-12-19"];
  if (payload.model !== stages[stage]) throw new Error("Unexpected writer experiment stage/model");
  if (stage !== 1) return payload;
  if (payload.enable_thinking !== false || payload.messages.length !== 1 ||
      payload.messages[0].role !== "user" || typeof payload.messages[0].content !== "string") {
    throw new Error("Writer experiment must remain a non-thinking text-only request");
  }
  const result = thinkingBudget === undefined ? { ...payload, model: writerModel } :
    { ...payload, enable_thinking: true, thinking_budget: thinkingBudget };
  quote(result, headers);
  return result;
}

export function replayPrefixLength({ prefix, detection, calibration, writerModel, thinkingBudget }) {
  validateWriterThinking(thinkingBudget, writerModel);
  if ((prefix && detection) || (calibration && (prefix || detection || writerModel || thinkingBudget)) ||
      (prefix && (writerModel || thinkingBudget))) {
    throw new Error("Do not mix reviewer fixtures or two replay scopes with writer experiments");
  }
  return prefix ? 2 : detection ? 1 : 0;
}

export function completedReplayChoice(call) {
  // Older result files lack this evidence. A successful HTTP status or settled
  // usage cannot establish that the model completed its answer normally.
  if (call?.status !== 200 || call.finishReason !== "stop" || typeof call.content !== "string" ||
      !call.reservation || call.replayed || call.syntheticFixtureInput) {
    throw new Error("Replay requires an original successful call with recorded finishReason=stop");
  }
  return { finish_reason: call.finishReason, message: { content: call.content } };
}
