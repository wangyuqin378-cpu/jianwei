import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function catalogCardSha256(card) {
  const { contentSha256, ...payload } = card;
  return sha256(JSON.stringify(canonical(payload)));
}

// Keep the reviewer's exact source-bearing input and the verifier in sync.
export function blindCardInput(result) {
  const card = result.card;
  return {
    cardId: card.cardId, photoObjectExpected: result.expectedDisplayName,
    detectedObjectName: card.detectedObjectName, title: card.title, body: card.body,
    ...(card.catalogFact ? { photoRequirement: card.photoRequirement } : {}),
    sources: card.sources.map(source => ({ title: source.title, url: source.url, authority: source.authority,
      evidenceSnippet: source.evidenceSnippet, evidenceKind: source.evidenceKind ?? "pipeline-extracted-evidence" }))
  };
}

export function uniqueByID(items, key, label) {
  if (!Array.isArray(items)) throw new Error(`Missing ${label}`);
  const map = new Map();
  for (const item of items) {
    if (typeof item?.[key] !== "string" || !item[key] || map.has(item[key])) throw new Error(`Missing or duplicate ${label} ID`);
    map.set(item[key], item);
  }
  return map;
}

function httpsURL(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Source must use credential-free HTTPS");
  return value;
}

export function buildCatalogCard(topic, fact, sourceById, evidenceById) {
  if (fact.topicId !== topic.topicId || !fact.cardTitle?.trim() || !fact.cardBody?.trim() ||
      !fact.factText?.trim() || fact.reviewStatus !== "approved" || fact.riskLevel !== "general") {
    throw new Error(`Fact is not eligible for general catalog review: ${fact.factId}`);
  }
  if (!Array.isArray(fact.sourceIds) || !fact.sourceIds.length || new Set(fact.sourceIds).size !== fact.sourceIds.length) {
    throw new Error(`Missing or duplicate source IDs for ${fact.factId}`);
  }
  const sources = fact.sourceIds.map(sourceId => {
    const source = sourceById.get(sourceId);
    const evidence = evidenceById.get(sourceId);
    if (!source || !evidence) throw new Error(`Missing retrieved source evidence ${sourceId} for ${fact.factId}`);
    const text = evidence.evidenceSnippet;
    if (evidence.url !== source.url || evidence.evidenceKind !== "retrieved-source-text" ||
        typeof text !== "string" || !text.trim() || text.length > 12000 ||
        evidence.textSha256 !== sha256(text) || !Number.isFinite(Date.parse(evidence.retrievedAt))) {
      throw new Error(`Invalid or changed source evidence ${sourceId} for ${fact.factId}`);
    }
    // A hash proves byte identity, not truth. Explicitly reject the legacy
    // self-evidence shortcut; source support still needs independent review.
    if ([fact.factText, fact.cardBody].some(value => value.trim() === text.trim())) {
      throw new Error(`Fact summary cannot substitute for source text: ${fact.factId}`);
    }
    return {
      sourceId, title: source.title, sourceURL: httpsURL(source.url), url: httpsURL(evidence.finalURL ?? source.url),
      authority: source.authority, evidenceKind: "retrieved-source-text", evidenceSnippet: text,
      retrievedAt: evidence.retrievedAt, textSha256: evidence.textSha256
    };
  });
  const needsPhotoEvidence = ["visible_subtype", "visible_feature", "visible_state"].includes(fact.photoApplicability);
  if (needsPhotoEvidence && !fact.photoObjectName?.trim()) throw new Error(`Missing photo requirement for ${fact.factId}`);
  const card = {
    cardId: `catalog:${fact.factId}`, factId: fact.factId, topicId: topic.topicId,
    objectName: topic.displayName, detectedObjectName: topic.displayName,
    title: fact.cardTitle, body: fact.cardBody,
    photoRequirement: needsPhotoEvidence ? fact.photoObjectName : null,
    catalogFact: { factText: fact.factText, photoApplicability: fact.photoApplicability ?? null,
      photoObjectName: fact.photoObjectName ?? null },
    sources
  };
  return { ...card, contentSha256: catalogCardSha256(card) };
}

export function assertBoundCatalogCard(card) {
  if (!card?.catalogFact || !Array.isArray(card.sources) || !card.sources.length ||
      card.contentSha256 !== catalogCardSha256(card)) throw new Error("Missing or changed source-bound catalog payload");
  const topic = { topicId: card.topicId, displayName: card.objectName };
  const fact = { factId: card.factId, topicId: card.topicId, cardTitle: card.title, cardBody: card.body,
    ...card.catalogFact, sourceIds: card.sources.map(source => source.sourceId), reviewStatus: "approved", riskLevel: "general" };
  const sources = card.sources.map(source => ({ ...source, url: source.sourceURL }));
  const evidence = card.sources.map(source => ({ ...source, url: source.sourceURL, finalURL: source.url }));
  const rebuilt = buildCatalogCard(topic, fact, uniqueByID(sources, "sourceId", "sources"), uniqueByID(evidence, "sourceId", "evidence"));
  if (rebuilt.contentSha256 !== card.contentSha256) throw new Error("Catalog payload is not reproducible");
}

export function buildReviewedSeedPlan(catalog, stability) {
  if (stability.schemaVersion !== 3 || stability.evidenceKind !== "source-bound-three-provider-catalog-stability" ||
      !Array.isArray(stability.stableFactIds) || !stability.stableFactIds.length ||
      new Set(stability.stableFactIds).size !== stability.stableFactIds.length) {
    throw new Error("Legacy or unbound stability report cannot seed facts; rebuild actual-source evaluations and independent reviews");
  }
  const sourceById = uniqueByID(catalog.sources, "sourceId", "sources");
  const allFacts = catalog.topics.flatMap(topic => topic.facts.map(fact => ({ ...fact, topic })));
  const factById = uniqueByID(allFacts, "factId", "facts");
  const stableById = uniqueByID(stability.cards, "factId", "stable facts");
  const topics = new Set();
  return stability.stableFactIds.map(factId => {
    const fact = factById.get(factId);
    const stable = stableById.get(factId);
    if (!fact || !stable || stable.stable !== true) throw new Error(`Missing stable approved fact: ${factId}`);
    assertBoundCatalogCard(stable.reviewedCard);
    const evidence = stable.reviewedCard.sources.map(source => ({ ...source, url: source.sourceURL, finalURL: source.url }));
    const current = buildCatalogCard(fact.topic, fact, sourceById, uniqueByID(evidence, "sourceId", "reviewed sources"));
    if (current.contentSha256 !== stable.reviewedCard.contentSha256 || current.contentSha256 !== stable.contentSha256) {
      throw new Error(`Catalog changed since review: ${factId}`);
    }
    if (!Array.isArray(stable.trials) || stable.trials.length !== 3) throw new Error(`Missing three reviewed rounds: ${factId}`);
    const rounds = new Set();
    for (const trial of stable.trials) {
      if (![1, 2, 3].includes(trial.round) || rounds.has(trial.round) || trial.passed !== true || trial.hardIssues !== 0 ||
          JSON.stringify([...(trial.providers ?? [])].sort()) !== JSON.stringify(["deepseek", "gpt", "kimi"])) {
        throw new Error(`Invalid independent review trial: ${factId}`);
      }
      rounds.add(trial.round);
      for (const [key, minimum] of Object.entries({ surprise: 3, aha: 4, retellability: 4, imageConnection: 3 })) {
        const score = trial.medians?.[key];
        if (!Number.isFinite(score) || score < minimum || score > 5) throw new Error(`Missing or invalid ${key} score: ${factId}`);
      }
    }
    if (topics.has(fact.topicId)) throw new Error(`Multiple facts would overwrite topic ${fact.topicId}; choose one explicitly`);
    topics.add(fact.topicId);
    return {
      topicKey: fact.topicId, factId, objectName: current.objectName, photoRequirement: current.photoRequirement,
      title: current.title, body: current.body, sources: current.sources,
      scores: Object.fromEntries(["surprise", "aha", "retellability", "imageConnection"].map(key =>
        [key, Math.min(...stable.trials.map(trial => trial.medians[key]))])),
      evidenceSummary: fact.factText,
      aliases: [...new Set([fact.topicId, fact.topic.displayName, ...(fact.topic.synonyms ?? [])])]
    };
  });
}
