import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function loadTopicBacklog(
  backlogPath = path.join(projectRoot, "knowledge", "topic-backlog.json")
) {
  const backlog = JSON.parse(await readFile(backlogPath, "utf8"));
  if (!Array.isArray(backlog.topics) || backlog.topics.length !== 200) {
    throw new Error("Controlled topic backlog must contain exactly 200 topics");
  }
  const backlogById = new Map();
  for (const topic of backlog.topics) {
    if (!validId(topic.topicId) || backlogById.has(topic.topicId)) {
      throw new Error(`Controlled topic backlog has an invalid or duplicate topic ID: ${topic.topicId ?? "<missing>"}`);
    }
    if (!nonEmpty(topic.displayName) || !nonEmpty(topic.category)) {
      throw new Error(`Controlled topic backlog has incomplete metadata: ${topic.topicId}`);
    }
    backlogById.set(topic.topicId, topic);
  }
  return {
    backlog,
    backlogById
  };
}

export function validateTopicDraft(draft, backlogById) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("Draft must be a JSON object");
  if (draft.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (draft.intakeMode !== undefined && draft.intakeMode !== "extend") {
    throw new Error("intakeMode must be extend when present");
  }
  const extensionMode = draft.intakeMode === "extend";
  const backlogTopic = backlogById.get(draft.topicId);
  if (!backlogTopic) throw new Error(`Topic is not in the 200-topic backlog: ${draft.topicId}`);
  if (draft.displayName !== backlogTopic.displayName || draft.category !== backlogTopic.category) {
    throw new Error("Draft topic name/category must match the controlled backlog");
  }
  if (!Array.isArray(draft.aliases) || draft.aliases.length < 2) {
    throw new Error("Draft requires at least two recognition aliases");
  }
  if (!draft.aliases.every(nonEmpty)) {
    throw new Error("Draft aliases must be non-empty strings");
  }
  const normalizedAliases = draft.aliases.map((alias) => alias.trim());
  if (new Set(normalizedAliases).size !== normalizedAliases.length || !normalizedAliases.includes(draft.displayName)) {
    throw new Error("Draft aliases must be unique and include the controlled display name");
  }
  if (!["human_research", "ai_assisted_draft"].includes(draft.origin)) {
    throw new Error("Invalid draft origin");
  }
  if (!Array.isArray(draft.sources) || draft.sources.length === 0) {
    throw new Error("Draft requires source records");
  }
  const minimumFacts = extensionMode ? 2 : 3;
  const maximumFacts = extensionMode ? 4 : 5;
  if (!Array.isArray(draft.facts) || draft.facts.length < minimumFacts || draft.facts.length > maximumFacts) {
    throw new Error(extensionMode ? "Extension draft must contain 2-4 facts" : "Draft must contain 3-5 facts");
  }

  const sourceById = new Map();
  for (const source of draft.sources) {
    if (!source || typeof source !== "object" || !validId(source.sourceId) || sourceById.has(source.sourceId)) {
      throw new Error("Source IDs must be present and unique");
    }
    if (!nonEmpty(source.title) || !nonEmpty(source.publisher) || !isPublicHttpsUrl(source.url)) {
      throw new Error(`Invalid source: ${source.sourceId}`);
    }
    if (!["reference", "official", "professional"].includes(source.authority)) {
      throw new Error(`Invalid source authority: ${source.sourceId}`);
    }
    sourceById.set(source.sourceId, source);
  }

  const factIds = new Set();
  const referencedSourceIds = new Set();
  for (const fact of draft.facts) {
    if (!fact || typeof fact !== "object" || !validId(fact.factId) || factIds.has(fact.factId)) {
      throw new Error("Fact IDs must be present and unique");
    }
    factIds.add(fact.factId);
    if (fact.topicId !== draft.topicId) throw new Error(`Fact topic mismatch: ${fact.factId}`);
    if (typeof fact.factText !== "string" || fact.factText.trim().length < 20 || fact.factText.length > 240) {
      throw new Error(`Fact text must be 20-240 characters: ${fact.factId}`);
    }
    if (fact.reviewStatus !== "draft" || fact.review !== undefined || fact.aiReview !== undefined) {
      throw new Error(`Draft intake cannot grant approval or human or AI review attestation: ${fact.factId}`);
    }
    if (!["general", "health", "safety"].includes(fact.riskLevel)) {
      throw new Error(`Invalid risk level: ${fact.factId}`);
    }
    if (!Array.isArray(fact.sourceIds) || fact.sourceIds.length === 0 || new Set(fact.sourceIds).size !== fact.sourceIds.length) {
      throw new Error(`Fact has no sources: ${fact.factId}`);
    }
    fact.sourceIds.forEach((sourceId) => referencedSourceIds.add(sourceId));
    const factSources = fact.sourceIds.map((sourceId) => sourceById.get(sourceId));
    if (factSources.some((source) => !source)) {
      throw new Error(`Fact references a missing source: ${fact.factId}`);
    }
    if (fact.riskLevel !== "general") {
      const authoritative = new Set(
        factSources
          .filter((source) => source.authority === "official" || source.authority === "professional")
          .map((source) => source.sourceId)
      );
      if (authoritative.size < 2) {
        throw new Error(`Risky fact requires two authoritative sources: ${fact.factId}`);
      }
    }
  }

  const unusedSources = [...sourceById.keys()].filter((sourceId) => !referencedSourceIds.has(sourceId));
  if (unusedSources.length > 0) throw new Error(`Draft contains unused sources: ${unusedSources.join(", ")}`);

  return draft;
}

export function mergeTopicDraft(catalog, draft) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("Catalog must be a JSON object");
  }
  if (!Array.isArray(catalog.sources) || !Array.isArray(catalog.topics)) {
    throw new Error("Catalog must contain sources and topics arrays");
  }

  const merged = structuredClone(catalog);
  const sourcesById = new Map();
  for (const source of merged.sources) {
    if (!source?.sourceId || sourcesById.has(source.sourceId)) {
      throw new Error(`Production catalog has an invalid or duplicate source ID: ${source?.sourceId ?? "<missing>"}`);
    }
    sourcesById.set(source.sourceId, source);
  }
  for (const source of draft.sources) {
    const existing = sourcesById.get(source.sourceId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(source)) {
      throw new Error(`Source ID conflicts with production catalog: ${source.sourceId}`);
    }
    if (!existing) {
      const sanitizedSource = {
        sourceId: source.sourceId,
        title: source.title.trim(),
        url: source.url,
        publisher: source.publisher.trim(),
        authority: source.authority
      };
      merged.sources.push(sanitizedSource);
      sourcesById.set(source.sourceId, sanitizedSource);
    }
  }

  const topicIds = new Set();
  const allFactIds = new Set();
  for (const item of merged.topics) {
    if (!item?.topicId || topicIds.has(item.topicId) || !Array.isArray(item.facts)) {
      throw new Error(`Production catalog has an invalid or duplicate topic: ${item?.topicId ?? "<missing>"}`);
    }
    topicIds.add(item.topicId);
    for (const fact of item.facts) {
      if (!fact?.factId || allFactIds.has(fact.factId)) {
        throw new Error(`Production catalog has an invalid or duplicate fact ID: ${fact?.factId ?? "<missing>"}`);
      }
      allFactIds.add(fact.factId);
    }
  }
  for (const fact of draft.facts) {
    if (allFactIds.has(fact.factId)) throw new Error(`Fact ID already exists in production catalog: ${fact.factId}`);
  }

  let topic = merged.topics.find((item) => item.topicId === draft.topicId);
  if (!topic) {
    if (draft.intakeMode === "extend") throw new Error(`Extension topic does not exist in production catalog: ${draft.topicId}`);
    topic = {
      topicId: draft.topicId,
      displayName: draft.displayName,
      synonyms: [...new Set(draft.aliases)],
      category: draft.category,
      facts: []
    };
    merged.topics.push(topic);
  } else {
    if (topic.displayName !== draft.displayName || topic.category !== draft.category) {
      throw new Error(`Topic conflicts with production catalog: ${draft.topicId}`);
    }
    if (!Array.isArray(topic.facts)) throw new Error(`Topic has no facts array: ${draft.topicId}`);
    const finalFactCount = topic.facts.length + draft.facts.length;
    if (finalFactCount < 3 || finalFactCount > 5) {
      throw new Error(`Topic must finish with the controlled 3-5 facts: ${draft.topicId}`);
    }
    topic.synonyms = [...new Set([...(topic.synonyms ?? []), ...draft.aliases].map((alias) => alias.trim()))];
  }

  topic.facts.push(...draft.facts.map((fact) => ({
    factId: fact.factId,
    topicId: fact.topicId,
    factText: fact.factText.trim(),
    sourceIds: [...fact.sourceIds],
    riskLevel: fact.riskLevel,
    reviewStatus: "draft"
  })));
  return merged;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validId(value) {
  return nonEmpty(value) && /^[a-z0-9][a-z0-9_-]{1,127}$/.test(value);
}

function isPublicHttpsUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    if (host === "[::1]" || host === "::1") return false;
    return true;
  } catch {
    return false;
  }
}

export function makeValidatorFixture() {
  return {
    schemaVersion: 1,
    topicId: "door_handle",
    displayName: "门把手",
    category: "home",
    aliases: ["door handle", "门把手"],
    origin: "ai_assisted_draft",
    sources: [
      {
        sourceId: "fixture-source",
        title: "Fixture",
        url: "https://example.org/source",
        publisher: "Fixture",
        authority: "reference"
      }
    ],
    facts: Array.from({ length: 3 }, (_, index) => ({
      factId: `door-handle-draft-${index + 1}`,
      topicId: "door_handle",
      factText: `这是一条仅用于验证草稿结构、不会写入知识库或发布给用户的合成占位事实 ${index + 1}。`,
      sourceIds: ["fixture-source"],
      riskLevel: "general",
      reviewStatus: "draft"
    }))
  };
}
