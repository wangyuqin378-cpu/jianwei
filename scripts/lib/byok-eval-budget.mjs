import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Beijing on-demand list prices checked 2026-09-07. No free quota assumed.
// Reserve the full context at the highest tier before HTTP, then settle usage.
// https://help.aliyun.com/zh/model-studio/qwen3-7-flash
// https://help.aliyun.com/zh/model-studio/qwen3-vl-plus
export const POLICY = "byok-no-tools-beijing-20260907-v5";
const models = {
  // Experimental alias only; not an App model upgrade. Beijing flat rates:
  // https://help.aliyun.com/zh/model-studio/qwen3-8-flash
  "qwen3.8-flash": { context: 1_000_000, input: 0.8, output: 2.7 },
  "qwen3.7-flash-2026-07-15": { context: 1_000_000, input: 1.2, output: 4.8 },
  "qwen3-vl-plus-2025-12-19": { context: 262_144, input: 3, output: 30 },
  "qwen3.7-plus-2026-05-26": { context: 1_000_000, input: 6, output: 24 },
};
export const TOTAL_MICRO_CNY = 10_000_000;
// SAME authorized 10 CNY, now shared through this sole evaluation ledger.
// The unused other allocation is zero: no separate paid evaluation may run
// against the old 1 CNY. Isolated cloud inference/ledger rechecked before v5.
// Plus needs a conservative full-context reservation, not 6 CNY actual per call.
// Keep the original ledger filename so earlier paid calls can never disappear.
export const BYOK_PARTITION_MICRO_CNY = 10_000_000;
export const OTHER_PARTITION_MICRO_CNY = TOTAL_MICRO_CNY - BYOK_PARTITION_MICRO_CNY;

function outputContract(payload, headers = {}) {
  const rate = models[payload.model];
  // Qwen3.7 supports bounded thinking and JSON mode. max_tokens bounds only
  // the final answer; thinking_budget is ADDITIONAL, billed output.
  // https://help.aliyun.com/zh/model-studio/deep-thinking
  // https://help.aliyun.com/zh/model-studio/qwen-structured-output
  const thinking = ["qwen3.7-flash-2026-07-15", "qwen3.7-plus-2026-05-26"].includes(payload.model) &&
    payload.enable_thinking === true && payload.thinking_budget === 4096;
  const keys = ["model", "messages", "enable_thinking", "response_format", "temperature", "max_tokens"];
  if (thinking) keys.push("thinking_budget");
  if (!rate || Object.keys(payload).sort().join() !==
      keys.sort().join() || (!thinking && payload.enable_thinking !== false) || payload.max_tokens !== 2048 ||
      JSON.stringify(payload.response_format) !== '{"type":"json_object"}' ||
      !Array.isArray(payload.messages) || !payload.messages.length ||
      Object.keys(headers).some(k => k.toLowerCase() === "x-dashscope-datainspection")) {
    throw new Error("Unbudgeted model, tool, moderation, or output contract");
  }
  return { finalTokenLimit: 2048, reasoningTokenLimit: thinking ? 4096 : 0 };
}

export function quote(payload, headers = {}) {
  const contract = outputContract(payload, headers);
  const rate = models[payload.model];
  return Math.ceil(rate.context * rate.input + (contract.finalTokenLimit + contract.reasoningTokenLimit) * rate.output);
}

export class ByokEvalBudget {
  constructor(file) {
    this.file = file;
    this.state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {
      policy: POLICY, totalMicroCNY: TOTAL_MICRO_CNY,
      partitionMicroCNY: BYOK_PARTITION_MICRO_CNY,
      otherPartitionMicroCNY: OTHER_PARTITION_MICRO_CNY, records: [],
    };
    const s = this.state;
    const legacyPartitions = {
      "byok-no-tools-beijing-20260907-v1": 3_000_000,
      "byok-no-tools-beijing-20260907-v2": 8_000_000,
      "byok-no-tools-beijing-20260907-v3": 8_000_000,
      "byok-no-tools-beijing-20260907-v4": 9_000_000,
    };
    if (Object.hasOwn(legacyPartitions, s.policy) && s.totalMicroCNY === TOTAL_MICRO_CNY &&
        s.partitionMicroCNY === legacyPartitions[s.policy] && Array.isArray(s.records) &&
        (s.otherPartitionMicroCNY === undefined ||
          s.otherPartitionMicroCNY === TOTAL_MICRO_CNY - legacyPartitions[s.policy])) {
      // No new authorization, lower rate, released unknown usage, or rewritten
      // old reservation. The unused OTHER allocation decreases by the same sum.
      s.allocationHistory = [...(s.allocationHistory ?? []), {
        previousPolicy: s.policy, fromMicroCNY: s.partitionMicroCNY,
        toMicroCNY: BYOK_PARTITION_MICRO_CNY, at: new Date().toISOString(),
      }];
      s.previousPartitionMicroCNY ??= s.partitionMicroCNY;
      s.policy = POLICY;
      s.partitionMicroCNY = BYOK_PARTITION_MICRO_CNY;
      s.otherPartitionMicroCNY = OTHER_PARTITION_MICRO_CNY;
    }
    if (s.policy !== POLICY || s.totalMicroCNY !== TOTAL_MICRO_CNY ||
        s.partitionMicroCNY !== BYOK_PARTITION_MICRO_CNY ||
        s.otherPartitionMicroCNY !== OTHER_PARTITION_MICRO_CNY || !Array.isArray(s.records) ||
      s.records.some(r => !models[r.model] || !Number.isSafeInteger(r.costMicroCNY) || r.costMicroCNY < 0 ||
        (r.finalTokenLimit !== undefined && r.finalTokenLimit !== 2048) ||
        (r.reasoningTokenLimit !== undefined && r.reasoningTokenLimit !== 0 &&
          !(["qwen3.7-flash-2026-07-15", "qwen3.7-plus-2026-05-26"].includes(r.model) && r.reasoningTokenLimit === 4096)))) {
      throw new Error("Budget ledger policy mismatch");
    }
    this.save();
  }
  save() {
    // The caller holds an exclusive lock across the entire run. A partial write
    // fails closed on the next read; no crash recovery releases reservations.
    writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }
  get heldMicroCNY() { return this.state.records.reduce((s, r) => s + r.costMicroCNY, 0); }
  reserve(payload, headers, run, requestHash) {
    const costMicroCNY = quote(payload, headers);
    if (this.state.halted || this.heldMicroCNY + costMicroCNY > this.state.partitionMicroCNY) {
      throw new Error("Cumulative BYOK evaluation partition exhausted or halted");
    }
    const row = { id: randomUUID(), run, requestHash, model: payload.model,
      ...outputContract(payload, headers),
      state: "reserved", costMicroCNY, reservedMicroCNY: costMicroCNY, at: new Date().toISOString() };
    this.state.records.push(row);
    this.save();
    return row.id;
  }
  recordProviderResponse(id, response, envelope, secrets = []) {
    const row = this.state.records.find(r => r.id === id);
    if (!row || row.state !== "reserved") throw new Error("Unknown or already settled reservation");
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
      throw new Error("Invalid provider response status");
    }
    const safeID = value => typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value) && !/^(?:sk[-_]|bearer)/i.test(value) &&
      !secrets.some(secret => typeof secret === "string" && secret.length && value.includes(secret)) ? value : undefined;
    // Keep each observed field separate: a completion ID is not necessarily the
    // audit Request ID. Never substitute our reservation ID or invent a value.
    const observed = {
      status: response.status,
      headerRequestId: safeID(response.headers.get("x-request-id")),
      bodyRequestId: safeID(envelope?.request_id),
      completionId: safeID(envelope?.id),
    };
    const previous = row.providerResponse ?? {};
    const next = { ...previous };
    for (const [key, value] of Object.entries(observed)) {
      if (value === undefined) continue;
      if (previous[key] !== undefined && previous[key] !== value) throw new Error("Conflicting provider response metadata");
      next[key] = value;
    }
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      row.providerResponse = next;
      // Persist headers before reading the body: an interrupted response or a
      // runner crash must not erase the only available supplier lookup ID.
      this.save();
    }
    return { ...next };
  }
  recordTransportFailure(id, reason = "transport_failure") {
    if (!["transport_failure", "provider_timeout"].includes(reason)) throw new Error("Unknown transport termination");
    const row = this.state.records.find(r => r.id === id);
    if (!row) throw new Error("Unknown reservation");
    // Called only after this caller's request has terminated, never on a stale
    // lock/process guess. Do not overwrite already-settled billing or free money.
    if (row.state !== "reserved") return false;
    row.state = "unknown_usage";
    row.terminationReason = reason;
    row.terminatedAt = new Date().toISOString();
    this.save();
    return true;
  }
  settle(id, response) {
    const row = this.state.records.find(r => r.id === id);
    if (!row || row.state !== "reserved") throw new Error("Unknown or already settled reservation");
    const u = response?.usage;
    const rate = models[row.model];
    const finalLimit = row.finalTokenLimit ?? 2048;
    const thinkingLimit = row.reasoningTokenLimit ?? 0;
    const reasoning = u?.completion_tokens_details?.reasoning_tokens;
    if (!u || !Number.isSafeInteger(u.prompt_tokens) || u.prompt_tokens < 0 ||
        !Number.isSafeInteger(u.completion_tokens) || u.completion_tokens < 0 ||
        u.total_tokens !== u.prompt_tokens + u.completion_tokens ||
        (response.model && response.model !== row.model)) {
      // Unknown usage can still have been billed; retain the full reservation.
      row.state = "unknown_usage";
    } else if (u.prompt_tokens > rate.context || u.completion_tokens > finalLimit + thinkingLimit) {
      row.state = "contract_violation";
      this.state.halted = true;
    } else if (thinkingLimit && (!Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > u.completion_tokens)) {
      row.state = "unknown_usage"; // Cannot prove the separate limits; retain all.
    } else if (thinkingLimit && (reasoning > thinkingLimit || u.completion_tokens - reasoning > finalLimit)) {
      row.state = "contract_violation";
      this.state.halted = true;
    } else {
      row.state = "settled";
      row.usage = u;
      row.costMicroCNY = Math.ceil(u.prompt_tokens * rate.input + u.completion_tokens * rate.output);
    }
    this.save();
  }
}

// Shared by the photo evaluator and the text-only experiment. Recording a
// response is NOT settlement: HTTP errors and unreadable bodies keep the full
// reservation, even if an error envelope contains a usage-shaped object.
export async function readBudgetedByokResponse(budget, reservation, response, secrets = []) {
  budget.recordProviderResponse(reservation, response, undefined, secrets);
  const data = await response.arrayBuffer();
  if (data.byteLength > 256 * 1024) throw new Error("Response too large");
  let envelope;
  try { envelope = JSON.parse(Buffer.from(data).toString("utf8")); } catch { /* full reserve retained */ }
  budget.recordProviderResponse(reservation, response, envelope, secrets);
  budget.settle(reservation, response.ok ? envelope : undefined);
  return { data, envelope };
}
