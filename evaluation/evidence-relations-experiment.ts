// Isolated research candidate. No product code imports this module.
// Keep a condition and its consequence together; allow a complete statement
// to cite more than one source without treating either as sufficient alone.
import { buildEvidenceReviewPrompt as originalPrompt } from "../cloudflare/gateway/src/evidence-review.js";

type Candidate = Parameters<typeof originalPrompt>[0];
type Source = Parameters<typeof originalPrompt>[1][number];

export function evidenceClaims(fact: Pick<Candidate, "title" | "body">) {
  return (["title", "body"] as const).flatMap(field => fact[field]
    .replace(/\[ref_\d+\]/g, "")
    .split(/[。！？；!?;\n]+/u)
    .map(text => text.trim()).filter(Boolean)
    .map((text, index) => ({ id: `${field}:${index}`, field, text })));
}

export function evidenceReviewResponseFormat(fact: Candidate) {
  const check = {
    type: "object", additionalProperties: false,
    properties: {
      evidence: { type: "array", items: {
        type: "object", additionalProperties: false,
        properties: { sourceId: { type: "string" }, quote: { type: "string" } },
        required: ["sourceId", "quote"]
      } },
      reason: { type: "string" }, supported: { type: "boolean" }
    },
    required: ["evidence", "reason", "supported"]
  };
  const ids = evidenceClaims(fact).map(claim => claim.id);
  return { type: "json_schema", json_schema: {
    name: "photo_evidence_relations_experiment", strict: true,
    schema: {
      type: "object", additionalProperties: false, required: ["checks"],
      properties: { checks: {
        type: "object", additionalProperties: false, required: ids,
        properties: Object.fromEntries(ids.map(id => [id, check]))
      } }
    }
  } };
}

export function buildEvidenceReviewPrompt(fact: Candidate, sources: Source[]): string {
  const original = originalPrompt(fact, sources).split("\n").filter(line =>
    !line.startsWith("CLAIMS_JSON:") && !line.startsWith("每个id恰好") && !line.startsWith("严格 JSON 对象："));
  return [
    ...original,
    "以下每条检查项保留逗号连接的完整意思。条件与结果必须一起成立：找到一个条件的介绍，再找到另一个条件下的结果，不算支持这条因果。标题和正文都不能交换条件、扩大程度或补出原文没有的联系。",
    "一句话包含多个独立事实时，可引用多个来源分别支持；但它们之间新增的因果、比较、范围或时序仍需原文明示。任一子断言或关系没有依据，整条supported=false，不按多数票放行。",
    `CLAIMS_JSON:${JSON.stringify(evidenceClaims(fact))}`,
    "每个id恰好返回一次。evidence是本检查项引用的原文列表，可有0到4项。每项填写sourceId及短的连续原文quote；不翻译、不改词、不从记忆复述。需要省略时用省略号，但每段文字必须原顺序逐字存在。",
    "先摘原文，再用reason解释整个检查项每个断言及相互关系的依据或缺口，最后填写supported。无证据可返回空evidence及supported=false；supported=true必须有可核对的引用。",
    '严格 JSON 对象：{"checks":{"title:0":{"evidence":[{"sourceId":"search-1","quote":"连续原文"}],"reason":"说明依据或缺口","supported":true}}}。所有Schema检查项都必须完整填写。'
  ].join("\n");
}

const normalize = (text: string) => text.normalize("NFKC")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

function quoteAppears(quote: string, source: string): boolean {
  const fragments = normalize(quote).split(/\.{3,}|…+/u).map(normalize).filter(Boolean);
  if (!fragments.length || fragments.length > 4 || fragments.some(fragment => fragment.length < 8)) return false;
  let offset = 0;
  const text = normalize(source);
  for (const fragment of fragments) {
    const index = text.indexOf(fragment, offset);
    if (index < 0) return false;
    offset = index + fragment.length;
  }
  return true;
}

export function interpretStructuredEvidenceReview(raw: Record<string, unknown>, fact: Candidate, sources: Source[]) {
  if (Object.keys(raw).length !== 1 || !raw.checks || typeof raw.checks !== "object" || Array.isArray(raw.checks)) return null;
  const entries = Object.entries(raw.checks);
  const claims = evidenceClaims(fact);
  if (!claims.length || entries.length !== claims.length) return null;
  const unsupported: string[] = [];
  let invalidQuote = false;
  for (const [id, value] of entries) {
    const claim = claims.find(claim => claim.id === id);
    if (!claim || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const check = value as Record<string, unknown>;
    if (Object.keys(check).length !== 3 || !Object.keys(check).every(key => ["evidence", "reason", "supported"].includes(key)) ||
        !Array.isArray(check.evidence) || check.evidence.length > 4 || typeof check.reason !== "string" || !check.reason.trim() ||
        typeof check.supported !== "boolean") return null;
    if (check.supported && !check.evidence.length) invalidQuote = true;
    for (const entry of check.evidence) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length !== 2 ||
          typeof entry.sourceId !== "string" || typeof entry.quote !== "string") return null;
      const source = sources.find(source => source.sourceId === entry.sourceId);
      if (check.supported && (!source?.evidenceSnippet || !quoteAppears(entry.quote, source.evidenceSnippet))) invalidQuote = true;
    }
    if (!check.supported) unsupported.push(`${claim.text}：${check.reason.trim()}`);
  }
  if (unsupported.length) return { accepted: false, reason: unsupported.join("；").slice(0, 120) };
  if (invalidQuote) return null;
  return { accepted: true, reason: "完整语句及其关系通过原文审核" };
}
