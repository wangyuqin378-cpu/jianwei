import type { Env } from "./index.js";

// CNY micro-units, NOT index.ts's historical estimated_cost_microunits.
// Reviewed against the Beijing snapshot price pages on 2026-09-06. Do not
// silently add floating aliases or apply these rates to another region.
export const EVALUATION_PRICE_POLICY = "beijing-token-search-2026-09-06-v1";
// The Responses request schema explicitly ignores undocumented parameters.
// max_tool_calls is NOT documented by this provider, so neither one search
// nor two model passes is a defensible upper bound. Never unlock this with
// an environment switch or a larger allowance; a bounded provider contract
// and corresponding implementation are required first.
// https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses
export const EVALUATION_RESEARCH_CAPABILITY: { bounded: boolean; reasonCode: string } = {
  bounded: false,
  reasonCode: "evaluation_research_unbounded"
};
const BUDGET_ID = "isolated-evaluation";
const MODELS: Record<string, { context: number; inputRateTenths: number; outputRateTenths: number }> = {
  "qwen3.7-flash-2026-07-15": { context: 1_000_000, inputRateTenths: 12, outputRateTenths: 48 },
  "qwen3.7-plus-2026-05-26": { context: 1_000_000, inputRateTenths: 60, outputRateTenths: 240 },
  "qwen3-vl-plus-2025-09-23": { context: 262_144, inputRateTenths: 30, outputRateTenths: 300 }
};

export class EvaluationBudgetError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface EvaluationQuote {
  model: string;
  endpoint: "chat" | "responses";
  maxInput: number;
  maxOutput: number;
  maxSearches: number;
  auxiliaryReserve: number;
  reservedMicroCny: number;
}

function configurationError(): never {
  throw new EvaluationBudgetError(503, "evaluation_budget_unconfigured", "评测费用保护尚未配置完成");
}

function positiveInteger(raw: string | undefined): number {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return configurationError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return configurationError();
  return value;
}

export function evaluationBudgetConfig(env: Env): { limit: number; auxiliaryReserve: number } {
  if (env.EVALUATION_ONLY !== "true" || env.EVALUATION_PRICE_POLICY !== EVALUATION_PRICE_POLICY ||
      !/^(?:dashscope\.aliyuncs\.com|ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com)$/.test(env.DASHSCOPE_HOST ?? "") ||
      env.QWEN_FLASH_MODEL !== "qwen3.7-flash-2026-07-15" ||
      env.QWEN_PLUS_MODEL !== "qwen3.7-plus-2026-05-26" ||
      env.QWEN_SEARCH_MODEL !== "qwen3.7-plus-2026-05-26" ||
      env.QWEN_VERIFICATION_MODEL !== "qwen3-vl-plus-2025-09-23") return configurationError();
  const limit = positiveInteger(env.EVALUATION_BUDGET_MICRO_CNY);
  // Guardrails/custom account policies have independent billing. This is an
  // operator-verified per-call ceiling, not an invented price or a default of
  // zero. It is NEVER refunded from model usage. See docs before enabling.
  const auxiliaryReserve = positiveInteger(env.EVALUATION_AUXILIARY_RESERVE_MICRO_CNY);
  if (auxiliaryReserve > limit) return configurationError();
  return { limit, auxiliaryReserve };
}

function tokenSearchCost(model: string, input: number, output: number, searches: number): number {
  const rates = MODELS[model];
  if (!rates) return configurationError();
  // Highest published tier even for a small call: conservative estimate,
  // no assumed free quota, cache discount or invoice reconciliation.
  return Math.ceil((input * rates.inputRateTenths + output * rates.outputRateTenths) / 10) + searches * 4_000;
}

export function evaluationQuote(env: Env, model: string, endpoint: "chat" | "responses", init: RequestInit): EvaluationQuote {
  const config = evaluationBudgetConfig(env);
  const rates = MODELS[model];
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(String(init.body)) as Record<string, unknown>; } catch { return configurationError(); }
  const search = endpoint === "responses";
  if (search) throw new EvaluationBudgetError(503, EVALUATION_RESEARCH_CAPABILITY.reasonCode,
    "联网检索的调用费用上界尚未核实，未发起搜索；增加预算不能解除此限制");
  // Audit the actual outgoing envelope, not just a caller-provided estimate.
  const allowed = ["model", "messages", "enable_thinking", "thinking_budget", "response_format", "temperature", "max_tokens"];
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return configurationError();
  const thinking = payload.enable_thinking === true && model === "qwen3.7-plus-2026-05-26" && payload.thinking_budget === 1024;
  const nonThinking = payload.enable_thinking === false && payload.thinking_budget === undefined;
  if (!rates || !payload || Array.isArray(payload) || payload.model !== model || (!thinking && !nonThinking) ||
      init.method !== "POST" || init.redirect !== "manual" || Object.keys(payload).some(key => !allowed.includes(key)) ||
      payload.max_tokens !== 2048 || !Array.isArray(payload.messages)) return configurationError();
  // Qwen max_tokens bounds the answer only. Reserve the reasoning allowance
  // separately; never retroactively change prior reservations or usage.
  const maxInput = rates.context;
  const maxOutput = 2048 + (thinking ? 1024 : 0);
  const maxSearches = 0;
  const reservedMicroCny = tokenSearchCost(model, maxInput, maxOutput, maxSearches) + config.auxiliaryReserve;
  if (!Number.isSafeInteger(reservedMicroCny)) return configurationError();
  return { model, endpoint, maxInput, maxOutput, maxSearches, auxiliaryReserve: config.auxiliaryReserve, reservedMicroCny };
}

export async function reserveEvaluationCost(env: Env, id: string, quote: EvaluationQuote): Promise<void> {
  const { limit, auxiliaryReserve } = evaluationBudgetConfig(env);
  const results = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO evaluation_budget (id, limit_micro_cny, price_policy, auxiliary_reserve_micro_cny) VALUES (?, ?, ?, ?)")
      .bind(BUDGET_ID, limit, EVALUATION_PRICE_POLICY, auxiliaryReserve),
    env.DB.prepare(
      "INSERT INTO evaluation_cost_reservations (id, budget_id, model, endpoint, reserved_micro_cny, auxiliary_reserve_micro_cny, created_at) " +
      "SELECT ?, id, ?, ?, ?, ?, ? FROM evaluation_budget WHERE id = ? AND limit_micro_cny = ? AND price_policy = ? AND auxiliary_reserve_micro_cny = ? AND blocked_reason IS NULL " +
      "AND COALESCE((SELECT SUM(COALESCE(settled_micro_cny, reserved_micro_cny)) FROM evaluation_cost_reservations WHERE budget_id = ?), 0) + ? <= limit_micro_cny"
    ).bind(id, quote.model, quote.endpoint, quote.reservedMicroCny, quote.auxiliaryReserve, new Date().toISOString(),
      BUDGET_ID, limit, EVALUATION_PRICE_POLICY, auxiliaryReserve, BUDGET_ID, quote.reservedMicroCny)
  ]);
  if (results[1]?.meta?.changes !== 1) {
    throw new EvaluationBudgetError(429, "evaluation_budget_unavailable", "评测剩余额度不足，或已锁定的费用配置发生变化");
  }
}

export async function settleEvaluationCost(
  env: Env, id: string, quote: EvaluationQuote,
  usage: { input: number | null; output: number | null; searches: number | null } | "not_dispatched"
): Promise<void> {
  let cost: number;
  if (usage === "not_dispatched") {
    cost = 0; // Only a proven pre-fetch failure can release everything.
  } else {
    if ([usage.input, usage.output, usage.searches].some(value => value === null || !Number.isSafeInteger(value) || value < 0)) return;
    const input = usage.input!; const output = usage.output!; const searches = usage.searches!;
    if (input > quote.maxInput || output > quote.maxOutput || searches > quote.maxSearches) {
      // A provider-contract/price assumption failed. Do not silently release
      // any hold, and stop future dispatches pending manual reconciliation.
      await env.DB.prepare("UPDATE evaluation_budget SET blocked_reason = 'usage_exceeds_envelope' WHERE id = ?").bind(BUDGET_ID).run();
      throw new EvaluationBudgetError(503, "evaluation_budget_reconciliation_required", "评测用量超出预留假设，已停止后续调用");
    }
    cost = tokenSearchCost(quote.model, input, output, searches) + quote.auxiliaryReserve;
  }
  await env.DB.prepare(
    "UPDATE evaluation_cost_reservations SET settled_micro_cny = ?, settled_at = ? WHERE id = ? AND settled_micro_cny IS NULL AND ? <= reserved_micro_cny"
  ).bind(cost, new Date().toISOString(), id, cost).run();
}

export async function evaluationBudgetReady(env: Env): Promise<boolean> {
  try {
    const { limit, auxiliaryReserve } = evaluationBudgetConfig(env);
    const recognition = MODELS[env.QWEN_FLASH_MODEL]!;
    const nextPhotoReserve = tokenSearchCost(env.QWEN_FLASH_MODEL, recognition.context, 2048, 0) + auxiliaryReserve;
    if (nextPhotoReserve > limit) return false;
    const row = await env.DB.prepare(
      "SELECT limit_micro_cny, price_policy, auxiliary_reserve_micro_cny, blocked_reason, " +
      "COALESCE((SELECT SUM(COALESCE(settled_micro_cny, reserved_micro_cny)) FROM evaluation_cost_reservations WHERE budget_id = ?), 0) AS committed FROM evaluation_budget WHERE id = ?"
    ).bind(BUDGET_ID, BUDGET_ID).first<{ limit_micro_cny: number; price_policy: string; auxiliary_reserve_micro_cny: number; blocked_reason: string | null; committed: number }>();
    return !row || (row.limit_micro_cny === limit && row.price_policy === EVALUATION_PRICE_POLICY &&
      row.auxiliary_reserve_micro_cny === auxiliaryReserve && !row.blocked_reason && row.committed + nextPhotoReserve <= limit);
  } catch { return false; }
}
