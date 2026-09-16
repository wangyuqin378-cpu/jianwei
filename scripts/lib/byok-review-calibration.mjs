// Offline fixtures stay outside the app bundle. Only the explicit input fields
// below can enter the Swift harness; oracle labels/evidence never enter a model.
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join() === keys.sort().join();
const length = value => typeof value === "string" ? [...value].length : -1;
const fail = () => { throw new Error("Invalid frozen reviewer calibration fixture"); };

export function validateCalibration(value) {
  if (!exact(value, ["version", "scope", "cases"]) || value.version !== 1 ||
      typeof value.scope !== "string" || !Array.isArray(value.cases) || !value.cases.length || value.cases.length > 12) fail();
  const ids = new Set(), files = new Set();
  for (const row of value.cases) {
    if (!exact(row, ["id", "fileName", "sha256", "subject", "candidates", "oracle"]) ||
        !/^[a-z][a-z0-9_-]{0,59}$/.test(row.id) || ids.has(row.id) ||
        !/^web-\d{3}\.jpg$/.test(row.fileName) || files.has(row.fileName) ||
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        !exact(row.subject, ["canonicalTopicId", "displayName"]) ||
        !/^[a-z][a-z0-9_]{1,79}$/.test(row.subject.canonicalTopicId) ||
        length(row.subject.displayName) < 1 || length(row.subject.displayName) > 60 ||
        !Array.isArray(row.candidates) || row.candidates.length < 1 || row.candidates.length > 3 ||
        !Array.isArray(row.oracle) || row.oracle.length !== row.candidates.length) fail();
    ids.add(row.id); files.add(row.fileName);
    const bodies = new Set();
    for (const c of row.candidates) {
      if (!exact(c, ["subjectIndex", "title", "body"]) || c.subjectIndex !== 0 ||
          length(c.title) < 6 || length(c.title) > 30 || length(c.body) < 28 || length(c.body) > 100 ||
          /[\r\n]|https?:|www\.|已联网|联网查证|搜索结果|已核实/i.test(c.title + c.body) ||
          bodies.has(c.body)) fail();
      bodies.add(c.body);
    }
    for (const [i, o] of row.oracle.entries()) {
      if (!exact(o, ["candidateIndex", "expected", "dimension", "reason", "sources"]) ||
          o.candidateIndex !== i || !["accept", "reject"].includes(o.expected) ||
          !["category", "fact", "instance", "banal"].includes(o.dimension) ||
          typeof o.reason !== "string" || !o.reason || !Array.isArray(o.sources) ||
          o.sources.some(s => typeof s !== "string" || !s.startsWith("https://"))) fail();
    }
  }
  return value;
}

export function calibrationRow(fixture, photo) {
  const row = fixture.cases.find(r => r.fileName === photo.fileName && r.sha256 === photo.sha256);
  if (!row) throw new Error("Calibration photo must match the fixed authorized image hash");
  return row;
}

export function calibrationPrefix(row, stage) {
  if (stage === 0) return JSON.stringify({ subjects: [{
    canonicalTopicId: row.subject.canonicalTopicId, displayName: row.subject.displayName,
    confidence: 0.99, boundingBox: null, alternatives: [],
  }], sensitiveFlags: [] });
  if (stage === 1) return JSON.stringify({ candidates: row.candidates.map(c => ({
    subjectIndex: c.subjectIndex, title: c.title, body: c.body,
  })) });
  throw new Error("The reviewer must never receive a synthetic answer");
}

export function assertCalibrationRequest(row, payload, stage, { separatePhoto = false } = {}) {
  const expectedModels = ["qwen3.7-flash-2026-07-15", "qwen3.7-plus-2026-05-26", "qwen3-vl-plus-2025-12-19"];
  if (separatePhoto) expectedModels.push("qwen3-vl-plus-2025-12-19");
  if (payload.model !== expectedModels[stage] || stage >= expectedModels.length) throw new Error("Unexpected calibration stage/model");
  const text = payload.messages.map(m => typeof m.content === "string" ? m.content :
    m.content.filter(p => p.type === "text").map(p => p.text).join("\n")).join("\n");
  const serialized = JSON.stringify(payload);
  if (row.oracle.some(o => text.includes(o.reason) || o.sources.some(s => text.includes(s))) ||
      text.includes(row.fileName) || text.includes(row.sha256) || text.includes('"oracle"')) {
    throw new Error("Calibration answer/evidence leaked into a model request");
  }
  if (separatePhoto && stage === 2 && row.candidates.some(c => text.includes(c.title) || text.includes(c.body))) {
    throw new Error("Independent photo verification must not see knowledge candidates");
  }
  if (separatePhoto && stage === 3 && payload.messages.some(m => typeof m.content !== "string")) {
    throw new Error("Independent text editor must not receive the photo");
  }
  if (stage === (separatePhoto ? 3 : 2) && row.candidates.some(c => !serialized.includes(JSON.stringify(c.title).slice(1, -1)) ||
      !serialized.includes(JSON.stringify(c.body).slice(1, -1)))) {
    throw new Error("Reviewer input must preserve every frozen candidate");
  }
}

export function scoreCalibration(row, raw, { requireScope = false, requireConnection = false, separatePhoto = false, photoResponse, derivedSelection = false, selectionFallback = false } = {}) {
  let answer;
  try { answer = JSON.parse(raw); } catch { return { caseId: row.id, valid: false }; }
  const flags = ["generalKnowledge", "noKnownError", ...(!separatePhoto ? ["photoMatches"] : []), "scopeSupported", "notDuplicate"];
  if (separatePhoto) {
    let proof;
    try { proof = JSON.parse(photoResponse); } catch { return { caseId: row.id, valid: false }; }
    // Current fixtures have one detected subject, even when it yields 3 drafts.
    if (!exact(proof, ["objects"]) || !Array.isArray(proof.objects) || proof.objects.length !== 1 ||
      proof.objects.some(p => {
        const valid = exact(p, ["objectIndex", "photoObject", "visible", "observations"]) &&
          p.objectIndex === 0 && p.photoObject === row.subject.displayName && p.visible === true &&
          length(p.observations?.trim?.()) >= 1 && length(p.observations?.trim?.()) <= 240;
        return !valid;
      })) return { caseId: row.id, valid: false, reason: "calibration_requires_all_fixed_anchors_verified" };
  }
  const scores = { surprise: 3, aha: 4, retellability: 4, imageConnection: 3 };
  if (((derivedSelection || selectionFallback) && (requireConnection || separatePhoto)) ||
      (derivedSelection && selectionFallback) ||
      !exact(answer, derivedSelection ? ["reviews"] : ["reviews", "winnerIndex"]) || !Array.isArray(answer.reviews) ||
      answer.reviews.length !== row.candidates.length) return { caseId: row.id, valid: false };
  const seen = new Set();
  for (const r of answer.reviews) {
    // v6.1 baseline predates claimScope; retain its original result contract.
    const scopeKeys = Object.hasOwn(r, "claimScope") ? ["claimScope"] : [];
    const connectionKeys = Object.hasOwn(r, "connection") ? ["photoObject", "knowledgeObject", "connection"] : [];
    if (!exact(r, ["candidateIndex", "reason", ...(derivedSelection ? [] : ["decision"]), ...scopeKeys, ...connectionKeys, ...flags, ...Object.keys(scores)]) ||
        ((derivedSelection || selectionFallback) && connectionKeys.length !== 0) ||
        (requireConnection && connectionKeys.length === 0) ||
        (connectionKeys.length && (r.photoObject !== row.subject.displayName ||
          length(r.knowledgeObject?.trim?.()) < 1 || length(r.knowledgeObject?.trim?.()) > 60 ||
          !["sameKind", "relatedKind", "unrelated"].includes(r.connection))) ||
        ((requireScope || derivedSelection || selectionFallback) && scopeKeys.length === 0) ||
        (scopeKeys.length && !["category", "picturedItem"].includes(r.claimScope)) ||
        !Number.isInteger(r.candidateIndex) || r.candidateIndex < 0 || r.candidateIndex >= row.candidates.length ||
        seen.has(r.candidateIndex) || (!derivedSelection && !["accept", "reject"].includes(r.decision)) ||
        typeof r.reason !== "string" || !r.reason.trim() || length(r.reason.trim()) > 512 ||
        flags.some(k => typeof r[k] !== "boolean") || Object.keys(scores).some(k =>
          !Number.isInteger(r[k]) || r[k] < 1 || r[k] > 5)) return { caseId: row.id, valid: false };
    seen.add(r.candidateIndex);
  }
  const accepts = r => (derivedSelection || selectionFallback || r.decision === "accept") && r.connection !== "unrelated" &&
    !(r.claimScope === "picturedItem" && r.connection === "relatedKind") && flags.every(k => r[k]) &&
    Object.entries(scores).every(([k, minimum]) => r[k] >= minimum);
  const accepted = answer.reviews.filter(accepts).map(r => r.candidateIndex);
  if (selectionFallback && answer.winnerIndex !== null &&
    (!Number.isInteger(answer.winnerIndex) || answer.winnerIndex < 0 || answer.winnerIndex >= row.candidates.length)) {
    return { caseId: row.id, valid: false };
  }
  if (derivedSelection || (selectionFallback && !accepted.includes(answer.winnerIndex))) {
    const total = r => Object.keys(scores).reduce((sum, k) => sum + r[k], 0);
    answer.winnerIndex = answer.reviews.filter(accepts).sort((a, b) => total(b) - total(a) || a.candidateIndex - b.candidateIndex)[0]?.candidateIndex ?? null;
  }
  if (answer.winnerIndex === null ? accepted.length !== 0 :
      !Number.isInteger(answer.winnerIndex) || !accepted.includes(answer.winnerIndex)) return { caseId: row.id, valid: false };
  return { caseId: row.id, valid: true, winnerIndex: answer.winnerIndex,
    winnerCorrect: row.oracle.some(o => o.expected === "accept")
      ? row.oracle.some(o => o.expected === "accept" && o.candidateIndex === answer.winnerIndex)
      : answer.winnerIndex === null,
    decisions: row.oracle.map(o => {
      const r = answer.reviews.find(r => r.candidateIndex === o.candidateIndex);
      const actual = accepts(r) ? "accept" : "reject";
      return { candidateIndex: o.candidateIndex, dimension: o.dimension, expected: o.expected,
        actual, correct: o.expected === actual, claimScope: r.claimScope,
        ...(r.connection ? { photoObject: r.photoObject, knowledgeObject: r.knowledgeObject, connection: r.connection } : {}),
        flags: Object.fromEntries(flags.map(k => [k, r[k]])), reason: r.reason };
    }) };
}
