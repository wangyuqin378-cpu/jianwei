import { createHash } from "node:crypto";

export const REVIEW_BATCH_SCHEMA_VERSION = 1;
export const REVIEW_BATCH_KIND = "human_semantic_review_decision_batch";

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function factReviewDigest(topicId, fact) {
  return sha256Text(JSON.stringify([
    "jianwei-fact-review-v1",
    topicId,
    fact.factId,
    fact.factText,
    fact.riskLevel,
    fact.reviewStatus,
    fact.sourceIds
  ]));
}

export function assertAccountableReviewerId(reviewerId) {
  if (!/^[\p{L}\p{N}._@-]{3,128}$/u.test(reviewerId) ||
      /(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|autobot|robot|language[-_. ]?model)/i.test(reviewerId) ||
      /^(?:ai|bot)$/i.test(reviewerId)) {
    throw new Error("reviewerId must identify an accountable human reviewer, not a model or automation");
  }
}

export function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return host !== "[::1]" && host !== "::1";
  } catch {
    return false;
  }
}

export function parseFlagArgs(values) {
  const output = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const next = values[index + 1];
    if (!next || next.startsWith("--")) output.set(key, true);
    else {
      output.set(key, next);
      index += 1;
    }
  }
  return output;
}

export function requiredString(args, name) {
  const value = args.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields are invalid; expected ${wanted.join(", ")}`);
  }
}
