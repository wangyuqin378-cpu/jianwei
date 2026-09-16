import assert from "node:assert/strict";
import test from "node:test";
import { evidenceClaims, evidenceReviewResponseFormat, interpretEvidenceReview, interpretStructuredEvidenceReview } from "./evidence-review.js";

const fact = { objectName: "合成物件", title: "合成标题的结论", body: "有证据的半句，却多说了另一部分。[ref_3]" };
const sources = [{ sourceId: "search-3", title: "Synthetic source", evidenceSnippet: "Synthetic original evidence for protocol testing, not a publishable fact." }];
const accepted = () => ({ checks: evidenceClaims(fact).map(claim => ({ id: claim.id, sourceId: "search-3", quote: "Synthetic original evidence", reason: "synthetic control", supported: true })) });

test("required named slots cannot omit the title or final clause even when a model says stop", () => {
  const format = evidenceReviewResponseFormat(fact);
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
  const checks = format.json_schema.schema.properties.checks;
  assert.deepEqual(checks.required, ["title:0", "body:0", "body:1"]);
  assert.deepEqual(Object.keys(checks.properties), checks.required);
  assert.equal(checks.additionalProperties, false);
  assert.ok(Object.values(checks.properties).every(x => x.required.includes("supported") && x.additionalProperties === false));

  const raw = { checks: Object.fromEntries(accepted().checks.map(({ id, ...check }) => [id, check])) };
  assert.equal(interpretStructuredEvidenceReview(raw, fact, sources)?.accepted, true);
  raw.checks["body:1"]!.supported = false;
  assert.equal(interpretStructuredEvidenceReview(raw, fact, sources)?.accepted, false);
  delete raw.checks["body:1"];
  assert.equal(interpretStructuredEvidenceReview(raw, fact, sources), null);
});

test("a structured decoder still rejects missing fields, extra slots and legacy arrays", () => {
  const good = () => Object.fromEntries(accepted().checks.map(({ id, ...check }) => [id, check]));
  const missingField = good() as Record<string, Record<string, unknown>>;
  delete missingField["body:1"]!.supported;
  for (const raw of [
    accepted(), { checks: missingField }, { checks: { ...good(), "body:99": good()["body:1"] } },
    { checks: { ...good(), "body:1": null } }, { checks: good(), accepted: true },
    { checks: { ...good(), "body:1": { ...good()["body:1"], id: "body:0" } } }
  ]) assert.equal(interpretStructuredEvidenceReview(raw, fact, sources), null);
});

test("clause audit includes the title and the last extra body claim, without citation markers", () => {
  assert.deepEqual(evidenceClaims(fact), [
    { id: "title:0", field: "title", text: "合成标题的结论" },
    { id: "body:0", field: "body", text: "有证据的半句" },
    { id: "body:1", field: "body", text: "却多说了另一部分" }
  ]);
});

test("unsupported tail or title defeats otherwise supported prose, even with overall accepted=true", () => {
  for (const index of [0, 2]) {
    const raw = { ...accepted(), accepted: true };
    raw.checks[index]!.supported = false;
    const result = interpretEvidenceReview(raw, fact, sources);
    assert.equal(result?.accepted, false);
    assert.ok(result?.reason.includes(evidenceClaims(fact)[index]!.text));
  }
});

test("a complete grounded clause review can still pass", () => {
  assert.equal(interpretEvidenceReview(accepted(), fact, sources)?.accepted, true);
});

test("omitted, duplicated, unknown, or boolean-only clause reviews are incomplete", () => {
  const checks = accepted().checks;
  for (const raw of [
    { accepted: true, reason: "majority is correct" }, { checks: checks.slice(0, 2) },
    { checks: [checks[0], checks[0], checks[2]] },
    { checks: [...checks.slice(0, 2), { ...checks[2], id: "body:99" }] },
    { checks: [...checks, checks[0]] }, { checks: [null, ...checks.slice(1)] }
  ]) assert.equal(interpretEvidenceReview(raw, fact, sources), null);
});

test("invented, translated, empty, or wrong-source quotes cannot certify support", () => {
  for (const patch of [
    { quote: "Invented evidence" }, { quote: "合成翻译不是原文" }, { quote: "" },
    { quote: "Source" }, { sourceId: "search-1" }, { sourceId: null },
    { supported: "true" }, { reason: " " }, { quote: undefined }
  ]) {
    const raw = accepted();
    const checks = [Object.assign({}, raw.checks[0], patch), ...raw.checks.slice(1)];
    assert.equal(interpretEvidenceReview({ checks }, fact, sources), null);
  }
});

test("whitespace normalization accepts source line breaks, not invented words", () => {
  const raw = accepted();
  raw.checks[0]!.quote = "Synthetic\noriginal   evidence";
  assert.equal(interpretEvidenceReview(raw, fact, sources)?.accepted, true);
});

test("typographic and straight quotation marks are equivalent, but changed words are not", () => {
  const source = [{ ...sources[0]!, evidenceSnippet: "You'll notice the ‘synthetic original’ evidence. They’ll call it “a sample”." }];
  for (const quote of ["You’ll notice the 'synthetic original' evidence.", 'They\'ll call it "a sample".']) {
    const raw = accepted();
    raw.checks.forEach(x => { x.quote = quote; });
    assert.equal(interpretEvidenceReview(raw, fact, source)?.accepted, true);
    raw.checks[0]!.quote = quote.replace(/notice|call/, "invent");
    assert.equal(interpretEvidenceReview(raw, fact, source), null);
  }
});

test("ellipsis may omit text but cannot invent, reorder or mix sources", () => {
  for (const [quote, valid] of [
    ["Synthetic original ... protocol testing", true],
    ["protocol testing ... Synthetic original", false],
    ["Synthetic original … invented omitted text", false],
    ["...", false]
  ] as const) {
    const raw = accepted();
    raw.checks[0]!.quote = quote;
    assert.equal(interpretEvidenceReview(raw, fact, sources)?.accepted ?? false, valid);
  }
});

test("an explicit unsupported claim may have no supporting quote", () => {
  const checks = accepted().checks.map((x, i) => i ? x : { ...x, supported: false, quote: "", sourceId: null });
  assert.equal(interpretEvidenceReview({ checks }, fact, sources)?.accepted, false);
});

test("a complete explicit rejection is decisive even if a supported sibling has a bad quote", () => {
  const raw = accepted();
  raw.checks[0]!.supported = false;
  raw.checks[1]!.quote = "invented quote";
  assert.equal(interpretEvidenceReview(raw, fact, sources)?.accepted, false);
  // Still require a complete, well-formed review: no success by missing data.
  raw.checks.pop();
  assert.equal(interpretEvidenceReview(raw, fact, sources), null);
});
