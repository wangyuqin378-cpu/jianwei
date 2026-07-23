import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { factReviewDigest, sha256Text } from "./lib/fact-review.mjs";

if (process.argv.includes("--self-test")) {
  const catalog = fixtureCatalog();
  const original = JSON.stringify(catalog);
  const queue = buildReviewQueue(catalog, fixtureEvidence(), sha256Text(original));
  if (queue.metrics.reviewableTopics !== 1 || queue.metrics.reviewableFacts !== 2) {
    throw new Error("Review queue self-test did not isolate facts that can advance a complete topic");
  }
  if (queue.metrics.incompleteTopics !== 1 || queue.metrics.incompleteFacts !== 1) {
    throw new Error("Review queue self-test did not separate incomplete topics");
  }
  if (queue.reviewableTopics[0].facts[0].riskLevel !== "health") {
    throw new Error("Review queue self-test did not prioritize risky facts");
  }
  if (queue.reviewableTopics[0].facts.some((fact) => fact.factId === "already-reviewed")) {
    throw new Error("Review queue self-test included an already attested fact");
  }
  if (!queue.reviewableTopics[0].facts.every((fact) => fact.sources.every((source) => source.reachable === true))) {
    throw new Error("Review queue self-test did not attach matching reachability evidence");
  }
  const infrastructureQueue = buildReviewQueue(catalog, {
    ...fixtureEvidence(),
    infrastructureFailure: true
  }, sha256Text(original));
  if (infrastructureQueue.sourceReachability.attached ||
      infrastructureQueue.reviewableTopics.some((topic) => topic.facts.some((fact) =>
        fact.sources.some((source) => source.reachable !== null)))) {
    throw new Error("Review queue self-test trusted a systemic network-failure attempt as source evidence");
  }
  if (!/^[a-f0-9]{64}$/.test(queue.catalogSha256) ||
      !queue.reviewableTopics[0].facts.every((fact) => /^[a-f0-9]{64}$/.test(fact.factSha256))) {
    throw new Error("Review queue self-test did not bind the catalog and facts to SHA-256 digests");
  }
  if (JSON.stringify(catalog) !== original) throw new Error("Review queue generation mutated the catalog");
  process.stdout.write("KNOWLEDGE_REVIEW_QUEUE_SELF_TEST=GO synthetic=1 releaseEvidence=0 mutation=0 riskyFirst=1 statusApprovedStillQueued=1 snapshotPinned=1\n");
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"));
const evidencePath = path.resolve(process.cwd(), String(args.get("--source-evidence") ?? ".tooling/knowledge-source-results/all-sources.json"));
const outputDirectory = path.resolve(process.cwd(), String(args.get("--output") ?? ".tooling/knowledge-review-queue"));
const catalogText = await readFile(catalogPath, "utf8");
const catalog = JSON.parse(catalogText);
const evidence = await readOptionalJson(evidencePath);
const queue = buildReviewQueue(catalog, evidence, sha256Text(catalogText));

if (!args.has("--write")) {
  process.stdout.write(summary("PREVIEW", queue, 0));
  process.exit(0);
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "review-queue.json"), `${JSON.stringify(queue, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "review-queue.md"), renderMarkdown(queue), "utf8");
process.stdout.write(summary("GO", queue, 1));

export function buildReviewQueue(catalog, evidence = null, catalogSha256 = sha256Text(JSON.stringify(catalog))) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.sources) || !Array.isArray(catalog.topics)) {
    throw new Error("Knowledge catalog is invalid");
  }
  const sourceById = new Map();
  for (const source of catalog.sources) {
    if (!source?.sourceId || sourceById.has(source.sourceId)) throw new Error("Catalog source IDs must be unique");
    sourceById.set(source.sourceId, source);
  }
  const evidenceMatches = evidence?.catalogVersion === catalog.version &&
    evidence?.infrastructureFailure !== true &&
    Array.isArray(evidence?.results);
  const liveBySourceId = new Map(evidenceMatches ? evidence.results.map((result) => [result.sourceId, result]) : []);
  const reviewableTopics = [];
  const incompleteTopics = [];
  let attestedFacts = 0;

  for (const topic of catalog.topics) {
    if (!topic?.topicId || !Array.isArray(topic.facts)) throw new Error(`Catalog topic is invalid: ${topic?.topicId ?? "<missing>"}`);
    const pendingFacts = [];
    for (const fact of topic.facts) {
      if (fact.review) {
        attestedFacts += 1;
        continue;
      }
      const sources = fact.sourceIds.map((sourceId) => {
        const source = sourceById.get(sourceId);
        if (!source) throw new Error(`Fact references missing source: ${fact.factId}/${sourceId}`);
        const live = liveBySourceId.get(sourceId);
        return {
          sourceId,
          title: source.title,
          publisher: source.publisher,
          authority: source.authority,
          url: source.url,
          reachable: live?.ok === true ? true : live?.ok === false ? false : null,
          ...(live?.status ? { httpStatus: live.status } : {})
        };
      });
      pendingFacts.push({
        factId: fact.factId,
        factSha256: factReviewDigest(topic.topicId, fact),
        factText: fact.factText,
        riskLevel: fact.riskLevel,
        currentReviewStatus: fact.reviewStatus,
        requiredAuthoritativeSources: fact.riskLevel === "general" ? 0 : 2,
        sources
      });
    }
    pendingFacts.sort(compareFacts);
    const item = {
      topicId: topic.topicId,
      displayName: topic.displayName,
      category: topic.category,
      factCount: topic.facts.length,
      pendingReviewCount: pendingFacts.length,
      facts: pendingFacts
    };
    if (topic.facts.length >= 3 && topic.facts.length <= 5) reviewableTopics.push(item);
    else incompleteTopics.push({ ...item, minimumAdditionalFacts: Math.max(0, 3 - topic.facts.length) });
  }

  reviewableTopics.sort(compareTopics);
  incompleteTopics.sort(compareTopics);
  const reviewableFacts = reviewableTopics.reduce((total, topic) => total + topic.pendingReviewCount, 0);
  const incompleteFacts = incompleteTopics.reduce((total, topic) => total + topic.pendingReviewCount, 0);
  return {
    schemaVersion: 2,
    evidenceKind: "human_semantic_review_work_queue",
    catalogVersion: catalog.version,
    catalogSha256,
    generatedAt: new Date().toISOString(),
    sourceReachability: {
      attached: evidenceMatches,
      checkedAt: evidenceMatches ? evidence.checkedAt ?? null : null,
      scope: evidenceMatches ? evidence.sourceScope ?? null : null,
      disclaimer: "Reachability does not prove that a source supports a fact. A human must open and compare every source."
    },
    policy: {
      grantsApproval: false,
      humanReviewRequired: true,
      templateCommand: "node scripts/create-knowledge-review-batch.mjs --output <pending-json> --write",
      applyCommand: "node scripts/apply-knowledge-review-batch.mjs --manifest <completed-json> --reviewer <human-id> --confirm-human-review --write"
    },
    metrics: {
      totalTopics: catalog.topics.length,
      reviewableTopics: reviewableTopics.length,
      incompleteTopics: incompleteTopics.length,
      reviewableFacts,
      incompleteFacts,
      pendingFacts: reviewableFacts + incompleteFacts,
      attestedFacts
    },
    reviewableTopics,
    incompleteTopics
  };
}

function renderMarkdown(queue) {
  const lines = [
    "# 见微知识人工审核队列",
    "",
    `目录版本：\`${queue.catalogVersion}\``,
    `目录 SHA-256：\`${queue.catalogSha256}\``,
    `生成时间：${queue.generatedAt}`,
    "",
    "> 来源可访问不代表来源支持事实。审核人必须打开每个来源，逐句核对中文事实，且不得把本文件当作批准记录。",
    "",
    `优先可审核主题：${queue.metrics.reviewableTopics}；待审核事实：${queue.metrics.reviewableFacts}。`,
    `结构未完成主题：${queue.metrics.incompleteTopics}；其中已有事实：${queue.metrics.incompleteFacts}。`,
    ""
  ];
  for (const topic of queue.reviewableTopics) {
    lines.push(`## ${topic.displayName} (${topic.topicId})`, "");
    for (const fact of topic.facts) {
      lines.push(`### ${fact.factId} · ${fact.riskLevel}`, "", fact.factText, "");
      lines.push(`事实 SHA-256：\`${fact.factSha256}\``, "");
      for (const source of fact.sources) {
        const live = source.reachable === true ? "可访问" : source.reachable === false ? "不可访问" : "未验证";
        lines.push(`- [ ] [${source.title}](${source.url}) — ${source.publisher} / ${source.authority} / ${live}`);
      }
      lines.push(
        "- [ ] 来源直接支持数字、因果和适用范围",
        "- [ ] 无诊断、绝对安全或个人结论",
        `- [ ] ${fact.riskLevel === "general" ? "一般事实来源充分" : "至少两个独立权威来源均已核对"}`,
        "",
        "决定必须写入版本与 SHA-256 固定的批次模板；本页不能直接批准事实。",
        ""
      );
    }
  }
  lines.push("## 结构未完成主题", "");
  for (const topic of queue.incompleteTopics) {
    lines.push(`- ${topic.displayName} (${topic.topicId})：现有 ${topic.factCount} 条，至少还缺 ${topic.minimumAdditionalFacts} 条；暂不优先审核。`);
  }
  return `${lines.join("\n")}\n`;
}

function compareFacts(left, right) {
  const riskOrder = { health: 0, safety: 1, general: 2 };
  return (riskOrder[left.riskLevel] ?? 9) - (riskOrder[right.riskLevel] ?? 9) || left.factId.localeCompare(right.factId);
}

function compareTopics(left, right) {
  const leftRisk = Math.min(...left.facts.map((fact) => ({ health: 0, safety: 1, general: 2 }[fact.riskLevel] ?? 9), 9));
  const rightRisk = Math.min(...right.facts.map((fact) => ({ health: 0, safety: 1, general: 2 }[fact.riskLevel] ?? 9), 9));
  return leftRisk - rightRisk || left.topicId.localeCompare(right.topicId);
}

function summary(status, queue, wrote) {
  return `KNOWLEDGE_REVIEW_QUEUE=${status} catalog=${queue.catalogVersion} reviewableTopics=${queue.metrics.reviewableTopics} reviewableFacts=${queue.metrics.reviewableFacts} incompleteTopics=${queue.metrics.incompleteTopics} pendingFacts=${queue.metrics.pendingFacts} attestedFacts=${queue.metrics.attestedFacts} sourceEvidence=${queue.sourceReachability.attached ? 1 : 0} grantsApproval=0 wrote=${wrote}\n`;
}

function parseArgs(values) {
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

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function fixtureCatalog() {
  return {
    version: "fixture-review-1",
    sources: [
      { sourceId: "official-a", title: "Official A", publisher: "A", authority: "official", url: "https://example.org/a" },
      { sourceId: "official-b", title: "Official B", publisher: "B", authority: "official", url: "https://example.org/b" }
    ],
    topics: [
      {
        topicId: "complete",
        displayName: "Complete",
        category: "home",
        facts: [
          { factId: "approved-without-attestation", factText: "Approved status alone must remain in the human review queue for verification.", riskLevel: "general", reviewStatus: "approved", sourceIds: ["official-a"] },
          { factId: "health-first", factText: "Risky facts must be ordered before general facts and retain two sources.", riskLevel: "health", reviewStatus: "draft", sourceIds: ["official-a", "official-b"] },
          { factId: "already-reviewed", factText: "This fixture fact already has an accountable human attestation and is excluded.", riskLevel: "general", reviewStatus: "approved", sourceIds: ["official-a"], review: { reviewerId: "human-1", reviewedAt: "2026-01-01T00:00:00.000Z", sourceCheckedAt: "2026-01-01T00:00:00.000Z" } }
        ]
      },
      {
        topicId: "incomplete",
        displayName: "Incomplete",
        category: "home",
        facts: [
          { factId: "incomplete-one", factText: "This topic needs more facts before semantic review can make the topic ready.", riskLevel: "general", reviewStatus: "draft", sourceIds: ["official-a"] }
        ]
      }
    ]
  };
}

function fixtureEvidence() {
  return {
    catalogVersion: "fixture-review-1",
    sourceScope: "all_editorial_sources",
    checkedAt: "2026-01-01T00:00:00.000Z",
    results: [
      { sourceId: "official-a", ok: true, status: 200 },
      { sourceId: "official-b", ok: true, status: 200 }
    ]
  };
}
