import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const credentialFile = requiredPath("--credentials-file");
const preflightFile = requiredPath("--preflight");
const outputFile = requiredPath("--output");
const credentials = parseBailianCredentialsCsv(await readFile(credentialFile, "utf8"));
const preflight = JSON.parse(await readFile(preflightFile, "utf8"));
const catalog = JSON.parse(await readFile(path.join(root, "knowledge", "catalog.json"), "utf8"));

if (preflight.sourcePhotoCount !== 29 || preflight.photos?.length !== 29) {
  throw new Error(`Expected the authorized 29-photo batch, got ${preflight.sourcePhotoCount ?? "unknown"}`);
}

const evaluationManifest = {
  "R0002116.JPG": { status: "selected", reason: "街道绿化与树木支撑的代表图" },
  "R0002117.JPG": { status: "near_duplicate", reason: "与 R0002116 同一绿化场景" },
  "R0002118.JPG": { status: "near_duplicate", reason: "与 R0002116 同一绿化场景" },
  "R0002119.JPG": { status: "scene_redundant", reason: "同批已有更清楚的街景代表图" },
  "R0002120.JPG": { status: "exact_duplicate", reason: "当前 App 哈希已与 R0002119 相同" },
  "R0002121.JPG": { status: "scene_redundant", reason: "同一街区连续拍摄" },
  "R0002122.JPG": { status: "selected", reason: "交通信号灯、斑马线和城市道路代表图" },
  "R0002123.JPG": { status: "scene_redundant", reason: "与 R0002122 同类街景且知识锚点更弱" },
  "R0002124.JPG": { status: "privacy_rejected", reason: "电脑屏幕内容可见" },
  "R0002125.JPG": { status: "privacy_rejected", reason: "电脑屏幕内容可见" },
  "R0002126.JPG": { status: "privacy_rejected", reason: "电脑屏幕内容可见" },
  "R0002127.JPG": { status: "privacy_rejected", reason: "电脑屏幕文字占主体" },
  "R0002128.JPG": { status: "privacy_rejected", reason: "电脑屏幕与人物工作场景" },
  "R0002129.JPG": { status: "privacy_rejected", reason: "端侧检测到人脸" },
  "R0002130.JPG": { status: "quality_rejected", reason: "端侧清晰度分数低于 0.35" },
  "R0002131.JPG": { status: "privacy_rejected", reason: "端侧检测到人脸" },
  "R0002132.JPG": { status: "privacy_rejected", reason: "端侧检测到人脸且与 R0002131 哈希相同" },
  "R0002133.JPG": { status: "privacy_rejected", reason: "端侧检测到人脸" },
  "R0002134.JPG": { status: "selected", reason: "吊顶风管、送风口与室内设备代表图" },
  "R0002135.JPG": { status: "selected", reason: "大型吊灯、格栅吊顶与漫射采光代表图" },
  "R0002136.JPG": { status: "selected", reason: "牛仔布纹理清晰且无人物身份信息" },
  "R0002137.JPG": { status: "quality_rejected", reason: "空桌面且端侧清晰度分数低于 0.35" },
  "R0002138.JPG": { status: "selected", reason: "室内植物墙与龟背竹叶片代表图" },
  "R0002139.JPG": { status: "privacy_rejected", reason: "人物占据主要场景" },
  "R0002140.JPG": { status: "privacy_rejected", reason: "端侧检测到人脸" },
  "R0002141.JPG": { status: "privacy_rejected", reason: "人物工作场景且知识锚点弱" },
  "R0002142.JPG": { status: "near_duplicate", reason: "与 R0002138 为同一植物墙" },
  "R0002143.JPG": { status: "privacy_rejected", reason: "端侧分类识别到人物" },
  "R0002144.JPG": { status: "privacy_rejected", reason: "纸袋上可读出具体门店地址" }
};

const selectedPhotos = preflight.photos.filter((photo) => evaluationManifest[photo.fileName]?.status === "selected");
if (selectedPhotos.length !== 6 || selectedPhotos.some((photo) => !photo.currentAppEligible)) {
  throw new Error("Selected representative set is inconsistent with the local preflight");
}

const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
const results = [];
for (const photo of selectedPhotos) {
  const jpeg = await readFile(photo.sanitizedFile);
  if (jpeg.length < 32 || jpeg.length > 3 * 1024 * 1024 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error(`Sanitized image invariant failed: ${photo.fileName}`);
  }
  const imageURL = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const detection = validateDetection(await qwenJSON([
    {
      role: "user",
      content: [
        { type: "text", text: productionDetectionPrompt(photo.labels) },
        { type: "image_url", image_url: { url: imageURL } }
      ]
    }
  ], 0));
  const topic = matchTopic(detection, catalog.topics);
  const options = topic ? approvedFactOptions(topic, catalog.sources) : [];
  let productionCard = null;
  if (options.length > 0 && detection.confidence >= 0.6 && detection.sensitiveFlags.length === 0) {
    const editorial = validateEditorial(
      await qwenJSON([{ role: "user", content: editorialPrompt(options) }], 0.35),
      options
    );
    const selected = options.find((option) => option.factId === editorial.factId);
    productionCard = {
      status: "publishable_reviewed_catalog",
      topicId: topic.topicId,
      objectName: topic.displayName,
      confidence: detection.confidence,
      factId: selected.factId,
      title: editorial.title,
      body: selected.fact,
      sources: selected.sources
    };
  }
  const exploration = validateExploration(await qwenJSON([
    {
      role: "user",
      content: [
        { type: "text", text: explorationPrompt() },
        { type: "image_url", image_url: { url: imageURL } }
      ]
    }
  ], 0.55));
  results.push({
    fileName: photo.fileName,
    selectionReason: evaluationManifest[photo.fileName].reason,
    localPreflight: {
      qualityScore: photo.qualityScore,
      labels: photo.labels,
      sensitiveFlags: photo.sensitiveFlags
    },
    productionPipeline: {
      detection,
      catalogMatch: topic?.topicId ?? null,
      status: productionCard ? productionCard.status : "catalog_miss_no_card",
      card: productionCard
    },
    exploratoryCandidates: exploration.candidates.map((candidate, index) => ({
      candidateId: `${photo.fileName.replace(".JPG", "")}-${index + 1}`,
      observableSubject: exploration.observableSubject,
      confidence: exploration.confidence,
      ...candidate,
      status: "unverified_candidate_not_publishable"
    }))
  });
  process.stdout.write(`${photo.fileName} production=${productionCard ? productionCard.title : "NO_CARD"} exploration=${exploration.candidates[0].title}\n`);
}

const rankingPool = results.flatMap((result) => result.exploratoryCandidates.map((candidate) => ({
  candidateId: candidate.candidateId,
  fileName: result.fileName,
  title: candidate.title,
  body: candidate.body,
  whyInteresting: candidate.whyInteresting,
  evidenceLevel: candidate.evidenceLevel
})));
const ranking = validateRanking(await qwenJSON(
  [{ role: "user", content: rankingPrompt(rankingPool) }],
  0.2
), new Set(rankingPool.map((candidate) => candidate.candidateId)));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  model: "qwen3.7-flash-2026-07-15",
  policy: "authorized-real-photo-batch-evaluation-v1",
  sourcePhotoCount: preflight.sourcePhotoCount,
  counts: Object.values(evaluationManifest).reduce((counts, entry) => {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    return counts;
  }, {}),
  privacyAudit: {
    localAnalyzerEligibleCount: preflight.photos.filter((photo) => photo.currentAppEligible).length,
    evaluationSelectedCount: selectedPhotos.length,
    knownLocalFalseNegatives: [
      "R0002124.JPG-R0002128.JPG: oblique laptop screens were not marked sensitive",
      "R0002143.JPG: classifier returned people/adult but current exact person label rule did not block it",
      "R0002144.JPG: visible address text was not recognized by local OCR"
    ]
  },
  dedupAudit: {
    currentAppExactDuplicates: preflight.photos.filter((photo) => photo.exactDuplicateOf).map((photo) => ({
      fileName: photo.fileName,
      duplicateOf: photo.exactDuplicateOf
    })),
    evaluationNearDuplicateClusters: Object.values(
      preflight.photos.filter((photo) => photo.nearDuplicateCluster).reduce((groups, photo) => {
        groups[photo.nearDuplicateCluster] ??= [];
        groups[photo.nearDuplicateCluster].push(photo.fileName);
        return groups;
      }, {})
    )
  },
  manifest: Object.entries(evaluationManifest).map(([fileName, decision]) => ({ fileName, ...decision })),
  results,
  exploratoryRanking: ranking,
  usage
};

await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`PHOTO_BATCH_EVAL=PASS photos=29 representatives=${selectedPhotos.length} reviewedCards=${results.filter((result) => result.productionPipeline.card).length} qwenCalls=${usage.calls} inputTokens=${usage.inputTokens} outputTokens=${usage.outputTokens}\n`);

async function qwenJSON(messages, temperature) {
  const response = await fetch(`${credentials.openAiCompatible.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      "content-type": "application/json",
      "X-DashScope-DataInspection": "{\"input\":\"cip\",\"output\":\"cip\"}"
    },
    body: JSON.stringify({
      model: "qwen3.7-flash-2026-07-15",
      messages,
      enable_thinking: false,
      response_format: { type: "json_object" },
      temperature
    }),
    redirect: "error",
    signal: AbortSignal.timeout(45_000)
  });
  const envelope = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof envelope.error?.message === "string"
      ? envelope.error.message.replaceAll(credentials.apiKey, "[redacted]").slice(0, 300)
      : "unavailable";
    throw new Error(`Qwen request failed HTTP ${response.status}: ${message}`);
  }
  usage.calls += 1;
  usage.inputTokens += Number(envelope.usage?.prompt_tokens ?? 0);
  usage.outputTokens += Number(envelope.usage?.completion_tokens ?? 0);
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Qwen response has no content");
  return JSON.parse(content);
}

function productionDetectionPrompt(labels) {
  return [
    "先检查图片是否含人脸/自拍、身份证件、银行卡、票据、文档、截图或高文字密度内容；命中时写入 sensitiveFlags。不要识别人、关系、情绪、健康或位置。",
    `端侧候选标签：${labels.length ? labels.join("、") : "无"}。`,
    "只识别最适合讲日常知识的单个完整物件。若外壳被拆开、内部零件裸露，但接口、容量标记、结构组合等证据足以指向一个常见成品，应优先识别完整物件（例如拆开的 U 盘），不要退化成泛称的电路板或零件；证据不足时仍按可见部件识别。严格只返回一个 json 对象，不得新增、删除或改名字段。canonicalTopicId 使用简短英文 snake_case；displayName 使用中文；confidence 是 0 到 1 的数字；alternatives 是最多 5 个中文字符串；sensitiveFlags 只能从 face,selfie,identity_document,bank_card,receipt,document,high_text_density,screenshot 中选择。",
    "boundingBox 必须严格为 null，或严格为 {\"x\":0.1,\"y\":0.1,\"width\":0.8,\"height\":0.8} 这种对象；四个字段都必须是 0 到 1 的数字。",
    "完整 json 形状：{\"canonicalTopicId\":\"bicycle\",\"displayName\":\"自行车\",\"confidence\":0.95,\"boundingBox\":null,\"alternatives\":[\"单车\"],\"sensitiveFlags\":[]}"
  ].join("\n");
}

function explorationPrompt() {
  return [
    "你是极其挑剔的照片冷知识选题编辑。只根据图片中清楚可见的物件或设计细节，提出 3 个值得进一步查证的知识候选。目标是具体的‘原来如此’，不是看图说话。",
    "优先反常识、隐藏机制、设计取舍、材料或制造原因。拒绝百科定义、空泛常识、拍摄建议、人生感悟、地点猜测和品牌介绍。若物种或型号不能确定，使用上位概念并明确不确定性。",
    "不要识别人、读取屏幕或文字、推断位置、关系、情绪、健康或个人信息。不要把未经核验的流行说法写成定论；争议性解释标为 uncertain。",
    "严格只返回一个 json 对象：{\"observableSubject\":\"图中可见对象\",\"confidence\":0.86,\"candidates\":[{\"title\":\"8到22字标题\",\"body\":\"35到90字的待核验知识陈述\",\"whyInteresting\":\"为什么它比常识更值得展示\",\"evidenceLevel\":\"strong\",\"verificationQueries\":[\"最多2个适合查权威来源的中文或英文检索词\"]}]}。",
    "candidates 必须恰好 3 条；evidenceLevel 只能是 strong、medium、uncertain；不得返回来源链接或其他字段。"
  ].join("\n");
}

function editorialPrompt(options) {
  const compact = options.map(({ factId, objectName, fact }) => ({ factId, objectName, fact }));
  return [
    "你是一个极其挑剔的日常冷知识编辑。读者会在自己的照片旁看到卡片；目标不是介绍物件，而是让人产生一次具体的‘原来如此’。",
    "先在候选事实中选择最有趣的一条。优先级依次是：反常识或反转；照片中可见细节背后的原因；设计取舍或隐藏分工；能纠正常见误解。百科定义、空泛常识、只报年代、专利摘要口吻都排在后面。",
    "正文将由程序原样使用所选事实，你只写标题。title 为 8 到 22 个汉字，且只能使用所选事实已有的对象、部件、用途和效果。",
    "严格只返回 json：{\"factId\":\"候选 ID\",\"title\":\"标题\"}，不得返回其他字段。",
    JSON.stringify(compact)
  ].join("\n");
}

function rankingPrompt(pool) {
  return [
    "你是照片冷知识主编。请从候选中选出最值得用户今天看到的 3 条，按有趣程度排序。只评价候选文案，不补充新事实。",
    "优先反直觉、能与照片可见细节建立强联系、读完可复述；降低百科定义、未经证实的推测和对象识别不稳的候选。",
    "严格只返回 json：{\"rankedIds\":[\"候选ID1\",\"候选ID2\",\"候选ID3\"],\"winnerReason\":\"不超过80字\"}。",
    JSON.stringify(pool)
  ].join("\n");
}

function matchTopic(entity, topics) {
  const exact = topics.find((topic) => topic.topicId === entity.canonicalTopicId);
  if (exact) return exact;
  const labels = new Set([entity.canonicalTopicId, entity.displayName, ...entity.alternatives].map(normalize));
  return topics.find((topic) => [topic.topicId, topic.displayName, ...topic.synonyms].some((value) => labels.has(normalize(value)))) ?? null;
}

function approvedFactOptions(topic, sources) {
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  return topic.facts.filter((fact) =>
    fact.riskLevel === "general" && fact.reviewStatus === "approved" &&
    (fact.review || fact.aiReview?.decision === "approved") && fact.sourceIds.every((id) => sourcesById.has(id))
  ).map((fact) => ({
    factId: fact.factId,
    objectName: topic.displayName,
    fact: fact.factText,
    sources: fact.sourceIds.map((id) => {
      const source = sourcesById.get(id);
      return { sourceId: id, title: source.title, publisher: source.publisher, url: source.url };
    })
  }));
}

function validateDetection(value) {
  exactKeys(value, ["alternatives", "boundingBox", "canonicalTopicId", "confidence", "displayName", "sensitiveFlags"], "detection");
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(value.canonicalTopicId) || typeof value.displayName !== "string" ||
      !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      !Array.isArray(value.alternatives) || value.alternatives.length > 5 ||
      !Array.isArray(value.sensitiveFlags)) throw new Error("Invalid detection value");
  return value;
}

function validateEditorial(value, options) {
  exactKeys(value, ["factId", "title"], "editorial");
  if (!options.some((option) => option.factId === value.factId) || typeof value.title !== "string") {
    throw new Error("Editorial output is not grounded");
  }
  const length = Array.from(value.title.trim()).length;
  if (length < 8 || length > 22) throw new Error("Editorial title length failed");
  return { factId: value.factId, title: value.title.trim() };
}

function validateExploration(value) {
  exactKeys(value, ["candidates", "confidence", "observableSubject"], "exploration");
  if (typeof value.observableSubject !== "string" || !Number.isFinite(value.confidence) ||
      value.confidence < 0 || value.confidence > 1 || !Array.isArray(value.candidates) || value.candidates.length !== 3) {
    throw new Error("Invalid exploration envelope");
  }
  for (const candidate of value.candidates) {
    exactKeys(candidate, ["body", "evidenceLevel", "title", "verificationQueries", "whyInteresting"], "exploration candidate");
    const titleLength = Array.from(candidate.title ?? "").length;
    const bodyLength = Array.from(candidate.body ?? "").length;
    if (titleLength < 8 || titleLength > 22 || bodyLength < 35 || bodyLength > 120 ||
        typeof candidate.whyInteresting !== "string" || !["strong", "medium", "uncertain"].includes(candidate.evidenceLevel) ||
        !Array.isArray(candidate.verificationQueries) || candidate.verificationQueries.length < 1 || candidate.verificationQueries.length > 2) {
      throw new Error(`Invalid exploration candidate lengths title=${titleLength} body=${bodyLength} evidence=${candidate.evidenceLevel} queries=${candidate.verificationQueries?.length ?? "invalid"}`);
    }
  }
  return value;
}

function validateRanking(value, allowed) {
  exactKeys(value, ["rankedIds", "winnerReason"], "ranking");
  if (!Array.isArray(value.rankedIds) || value.rankedIds.length !== 3 || new Set(value.rankedIds).size !== 3 ||
      value.rankedIds.some((id) => !allowed.has(id)) || typeof value.winnerReason !== "string" ||
      Array.from(value.winnerReason).length > 200) throw new Error("Invalid ranking");
  return value;
}

function exactKeys(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`Invalid ${context} JSON shape`);
  }
}

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/[\s_\-/]+/g, "");
}

function requiredPath(flag) {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`${flag} is required`);
  return path.resolve(args[index + 1]);
}
