// Experimental protocol only. Do not switch the production reviewer until
// the fixed real-model support/rejection pilot passes, not merely these tests.
import { buildEvidenceReviewPrompt, evidenceClaims } from "./evidence-review.js";

type Candidate = Parameters<typeof buildEvidenceReviewPrompt>[0];
type Source = Parameters<typeof buildEvidenceReviewPrompt>[1][number];
export interface EvidencePassage {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  text: string;
}

// Slices are exact, contiguous substrings, including original whitespace.
// The full source remains visible in order: a nearby limitation is not hidden.
export function evidencePassages(sources: Source[]): EvidencePassage[] {
  return sources.flatMap((source, sourceIndex) => {
    const text = source.evidenceSnippet ?? "";
    if (text.trim().length < 8) return [];
    const passages: EvidencePassage[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + 480, text.length);
      if (end < text.length) {
        const segment = text.slice(start, end);
        const boundaries = [...segment.matchAll(/[.!?。！？；;\n](?:\s|$)|\s/gu)];
        const last = boundaries.at(-1);
        if (last && last.index >= 240) end = start + last.index + last[0].length;
        // Do not split a surrogate pair when a long unbroken word has no gap.
        if (/[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
        if (text.slice(end).trim().length < 8) end = text.length;
      }
      passages.push({ id: `e${sourceIndex + 1}.${passages.length + 1}`, sourceId: source.sourceId,
        start, end, text: text.slice(start, end) });
      start = end;
    }
    return passages;
  });
}

export function evidenceSelectionResponseFormat(fact: Candidate, sources: Source[]) {
  const ids = evidenceClaims(fact).map(x => x.id);
  const passageIDs = evidencePassages(sources).map(x => x.id);
  const check = {
    type: "object", additionalProperties: false,
    properties: {
      evidenceIds: { type: "array", minItems: 0, maxItems: 4,
        items: { type: "string", enum: passageIDs.length ? passageIDs : ["no-evidence"] } },
      reason: { type: "string" }, supported: { type: "boolean" }
    }, required: ["evidenceIds", "reason", "supported"]
  };
  return { type: "json_schema", json_schema: { name: "photo_evidence_selection", strict: true,
    schema: { type: "object", additionalProperties: false, required: ["checks"],
      properties: { checks: { type: "object", additionalProperties: false, required: ids,
        properties: Object.fromEntries(ids.map(id => [id, check])) } } } } };
}

export function buildEvidenceSelectionPrompt(fact: Candidate, sources: Source[]): string {
  const base = buildEvidenceReviewPrompt(fact, sources);
  const instructions = base.split("\n").filter(line => !line.startsWith("证据：") &&
    !line.startsWith("每个id恰好") && !line.startsWith("严格 JSON 对象："));
  const passages = evidencePassages(sources);
  return [...instructions,
    `证据：${JSON.stringify(sources.map(source => ({ sourceId: source.sourceId, title: source.title,
      passages: passages.filter(p => p.sourceId === source.sourceId).map(({ id, text }) => ({ id, text })) })))}`,
    "每个分句id恰好返回一次。选择最直接相关的连续原文片段ID（evidenceIds），再解释支持或缺口，最后给supported。片段编号只定位原文，不保证原文支持候选；必须阅读上下文和条件。不要抄写、翻译或改写引文。",
    "supported为true时选择同一来源的1至4个片段，不要选择只包含相同名词却不支持结论的片段。无支持时supported=false，evidenceIds可以为空。不得编造编号或重复编号。",
    '严格 JSON 对象：{"checks":{"title:0":{"evidenceIds":["e1.1"],"reason":"不超过60字的证据对应或缺口","supported":true}}}。必须填完每个分句，不另给整体结论。'
  ].join("\n");
}

export function interpretEvidenceSelection(raw: Record<string, unknown>, fact: Candidate, sources: Source[]) {
  if (Object.keys(raw).length !== 1 || !raw.checks || typeof raw.checks !== "object" || Array.isArray(raw.checks)) return null;
  if (new Set(sources.map(x => x.sourceId)).size !== sources.length) return null;
  const claims = evidenceClaims(fact);
  if (!claims.length || Object.keys(raw.checks).length !== claims.length) return null;
  const passages = new Map(evidencePassages(sources).map(p => [p.id, p]));
  const unsupported: string[] = [];
  let invalidBinding = false;
  for (const [id, value] of Object.entries(raw.checks)) {
    const claim = claims.find(x => x.id === id);
    if (!claim || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const check = value as Record<string, unknown>;
    if (Object.keys(check).length !== 3 || !Object.keys(check).every(key => ["evidenceIds", "reason", "supported"].includes(key)) ||
        !Array.isArray(check.evidenceIds) || check.evidenceIds.length > 4 ||
        check.evidenceIds.some(x => typeof x !== "string") || new Set(check.evidenceIds).size !== check.evidenceIds.length ||
        typeof check.reason !== "string" || !check.reason.trim() || typeof check.supported !== "boolean") return null;
    const selected = check.evidenceIds.map(id => passages.get(id));
    const bound = selected.length > 0 && selected.every(p => p && p.sourceId === selected[0]?.sourceId) &&
      selected.every((p, index) => index === 0 || p!.start >= selected[index - 1]!.end);
    // The server selected the text by ID, so do not parse literal punctuation
    // as model-authored ellipses. Selection still does not prove entailment;
    // the reviewer must independently decide every clause's support.
    if (check.supported) {
      if (!bound) invalidBinding = true;
    } else unsupported.push(`${claim.text}：${check.reason.trim()}`);
  }
  if (unsupported.length) return { accepted: false, reason: unsupported.join("；").slice(0, 120) };
  if (invalidBinding) return null;
  return { accepted: true, reason: "标题与正文各分句均已逐项核对原文片段" };
}
