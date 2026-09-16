import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const primaryModel = "qwen3.7-flash-2026-07-15";
const verificationModel = "qwen3-vl-plus-2025-12-19";
const args = process.argv.slice(2);
const credentialFile = requiredPath("--credentials-file");
const datasetFile = requiredPath("--dataset");
const preflightFile = requiredPath("--preflight");
const outputFile = requiredPath("--output");
const reuseFile = optionalPath("--reuse-detections");
const redetectFileNames = new Set((value("--redetect") ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const mustRejectFileNames = new Set((value("--must-reject") ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const mustPublishFileNames = new Set((value("--must-publish") ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const evaluationCandidateFactIds = new Set((value("--include-candidate-fact-ids") ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const editorialMode = value("--editorial-mode") ?? "text-only";
const minimumPublishScore = 70;
if (!new Set(["text-only", "image-aware"]).has(editorialMode)) throw new Error("Invalid editorial mode");

const checkpointFile = `${outputFile}.checkpoint.json`;
const credentials = parseBailianCredentialsCsv(await readFile(credentialFile, "utf8"));
const dataset = JSON.parse(await readFile(datasetFile, "utf8"));
const preflight = JSON.parse(await readFile(preflightFile, "utf8"));
const catalog = JSON.parse(await readFile(path.join(root, "knowledge", "catalog.json"), "utf8"));
const preferredDetectionTopics = catalog.topics
  .filter((topic) => factOptions(topic, catalog.sources).length > 0)
  .map((topic) => `${topic.topicId}=${topic.displayName}`)
  .sort();
const reusable = reuseFile ? JSON.parse(await readFile(reuseFile, "utf8")) : null;
const datasetByName = new Map(dataset.photos.map((photo) => [photo.fileName, photo]));
const reusableByName = new Map((reusable?.results ?? []).map((result) => [result.fileName, result]));
if (dataset.count !== preflight.sourcePhotoCount || dataset.photos.length !== preflight.photos.length) {
  throw new Error("Dataset and preflight counts differ");
}
const datasetNames = new Set(dataset.photos.map((photo) => photo.fileName));
for (const fileName of [...mustRejectFileNames, ...mustPublishFileNames]) {
  if (!datasetNames.has(fileName)) throw new Error(`Assertion photo is absent from dataset: ${fileName}`);
}

const checkpoint = await readOptionalJSON(checkpointFile);
if (checkpoint && checkpoint.editorialMode !== editorialMode) throw new Error("Checkpoint editorial mode differs");
const usage = checkpoint?.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
const results = checkpoint?.results ?? [];
const completedNames = new Set(results.map((result) => result.fileName));
for (const photo of preflight.photos) {
  if (completedNames.has(photo.fileName)) continue;
  const source = datasetByName.get(photo.fileName);
  if (!source) throw new Error(`Missing dataset metadata for ${photo.fileName}`);
  if (!photo.currentAppEligible || photo.exactDuplicateOf) {
    results.push({
      fileName: photo.fileName,
      source,
      localPreflight: summarizePreflight(photo),
      status: "local_rejected",
      rejectionReason: photo.exactDuplicateOf ? `exact_duplicate:${photo.exactDuplicateOf}` : photo.sensitiveFlags.join(","),
      detection: null,
      card: null,
      judge: null
    });
    continue;
  }

  const jpeg = await readFile(photo.sanitizedFile);
  assertJPEG(jpeg, photo.fileName);
  const imageURL = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const reusableResult = redetectFileNames.has(photo.fileName)
    ? null
    : reusableByName.get(photo.fileName);
  const detectionMessages = [{
    role: "user",
    content: [
      { type: "text", text: detectionPrompt(photo.labels, preferredDetectionTopics) },
      { type: "image_url", image_url: { url: imageURL } }
    ]
  }];
  let understanding;
  try {
    understanding = reusableResult
      ? (reusableResult.detection?.sensitiveFlags?.length ? {
          subjects: [],
          sensitiveFlags: reusableResult.detection.sensitiveFlags
        } : {
          subjects: (reusableResult.detectedSubjects?.length
            ? reusableResult.detectedSubjects
            : [reusableResult.detection]
          ).filter(Boolean).map((subject) => ({ ...validateDetection({
            canonicalTopicId: subject.canonicalTopicId,
            displayName: subject.displayName,
            confidence: subject.confidence,
            boundingBox: subject.boundingBox,
            alternatives: subject.alternatives
          }), sensitiveFlags: [] })),
          sensitiveFlags: []
        })
      : await detectWithRetry(detectionMessages);
  } catch (error) {
    results.push({
      fileName: photo.fileName,
      source,
      localPreflight: summarizePreflight(photo),
      status: "analysis_failed",
      detection: null,
      catalogMatch: null,
      usableFactCount: 0,
      noCardReason: "invalid_detection",
      expectedTopicMatch: false,
      editorialDraft: null,
      editorialVerification: null,
      editorialFallback: safeError(error),
      deterministicTitleUsed: false,
      judgeReused: false,
      card: null,
      judge: null,
      score: 0
    });
    await writeCheckpoint();
    process.stdout.write(`${photo.fileName} expected=${source.expectedDisplayName} detected=INVALID card=NO_CARD score=0\n`);
    continue;
  }
  const detections = understanding.subjects.length > 0 ? understanding.subjects : [{
    canonicalTopicId: "unknown_object",
    displayName: "未识别物件",
    confidence: 0,
    boundingBox: null,
    alternatives: [],
    sensitiveFlags: understanding.sensitiveFlags
  }];
  const subjectAttempts = [];
  for (const detection of detections) {
  const topic = matchTopic(detection, catalog.topics);
  const options = topic ? factOptions(topic, catalog.sources).slice(0, 8) : [];
  let card = null;
  let editorialDraft = null;
  let editorialVerification = null;
  let subtypeVerification = null;
  let featureVerification = null;
  let editorialFallback = null;
  let deterministicTitleUsed = false;
  let selectedApplicability = null;
  if (options.length > 0 && detection.confidence >= 0.6 && detection.sensitiveFlags.length === 0) {
    let remainingOptions = options;
    for (let verificationAttempt = 0; verificationAttempt < 3 && remainingOptions.length > 0 && !card; verificationAttempt += 1) {
      editorialDraft = null;
      editorialVerification = null;
      subtypeVerification = null;
      featureVerification = null;
      if (remainingOptions.length === 1 && remainingOptions[0].reviewedTitle && remainingOptions[0].reviewedBody) {
        editorialDraft = {
          factId: remainingOptions[0].factId,
          title: remainingOptions[0].reviewedTitle,
          body: remainingOptions[0].reviewedBody
        };
        deterministicTitleUsed = true;
      } else {
        const prompt = editorialPrompt(remainingOptions, editorialMode);
        const messages = editorialMode === "image-aware"
          ? [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageURL } }] }]
          : [{ role: "user", content: prompt }];
        const firstRaw = await qwenJSON(messages, editorialMode === "image-aware" ? 0.1 : 0.35);
        try {
          editorialDraft = validateEditorial(firstRaw, remainingOptions);
        } catch (error) {
          editorialFallback = safeError(error);
          try {
            const repairRaw = await qwenJSON([...messages, {
              role: "user",
              content: "上次输出未通过事实忠实度或格式校验。重新选择；标题只压缩原事实已有词组，不得添加新部件、用途或因果。严格返回既定 JSON。"
            }], 0);
            editorialDraft = validateEditorial(repairRaw, remainingOptions);
          } catch (repairError) {
            editorialFallback = `${editorialFallback}; repair: ${safeError(repairError)}`;
            try {
              editorialDraft = makeDeterministicEditorialFallback(firstRaw, remainingOptions);
              deterministicTitleUsed = Boolean(editorialDraft);
            } catch (fallbackError) {
              editorialFallback = `${editorialFallback}; fallback: ${safeError(fallbackError)}`;
            }
          }
        }
      }
      if (!editorialDraft) break;
      const selected = remainingOptions.find((option) => option.factId === editorialDraft.factId);
      selectedApplicability = selected.photoApplicability;
      try {
        editorialVerification = validateEditorialVerification(await qwenJSON([
          {
            role: "user",
            content: [
              { type: "text", text: editorialVerificationPrompt(selected, editorialDraft) },
              { type: "image_url", image_url: { url: imageURL } }
            ]
          }
        ], 0, verificationModel), selected.photoApplicability, !selected.reviewedTitle);
      } catch (error) {
        editorialFallback = safeError(error);
      }
      if (editorialVerification?.decision === "accept" && selected.photoApplicability === "visible_subtype") {
        try {
          subtypeVerification = validateSubtypeVerification(await qwenJSON([
            {
              role: "user",
              content: [
                { type: "text", text: subtypeVerificationPrompt(selected.photoObjectName) },
                { type: "image_url", image_url: { url: imageURL } }
              ]
            }
          ], 0, verificationModel));
        } catch (error) {
          editorialFallback = safeError(error);
        }
      }
      if (editorialVerification?.decision === "accept" && selected.photoApplicability === "visible_feature") {
        try {
          featureVerification = validateFeatureVerification(await qwenJSON([
            {
              role: "user",
              content: [
                { type: "text", text: featureVerificationPrompt(editorialDraft.title) },
                { type: "image_url", image_url: { url: imageURL } }
              ]
            }
          ], 0, verificationModel));
        } catch (error) {
          editorialFallback = safeError(error);
        }
      }
      const subtypeAccepted = selected.photoApplicability !== "visible_subtype" ||
        subtypeVerification?.decision === "accept";
      const featureAccepted = selected.photoApplicability !== "visible_feature" ||
        featureVerification?.decision === "accept";
      if (editorialVerification?.decision === "accept" && subtypeAccepted && featureAccepted) {
        card = {
          cardId: photo.fileName.replace(/\.[^.]+$/, ""),
          topicId: topic.topicId,
          objectName: topic.displayName,
          confidence: detection.confidence,
          factId: selected.factId,
          title: editorialDraft.title,
          body: editorialDraft.body,
          sources: selected.sources,
          editorialFallback: null
        };
      } else {
        remainingOptions = remainingOptions.filter((option) => option.factId !== selected.factId);
      }
    }
  }
  // Reuse is intentionally limited to visual detections. Every evaluation run
  // needs a fresh judge result, including no-card samples, or the stability gate
  // can mistake copied historical opinions for independent evidence.
  const judge = validateJudge(await qwenJSON([
      {
        role: "user",
        content: [
          { type: "text", text: judgePrompt(detection, card) },
          { type: "image_url", image_url: { url: imageURL } }
        ]
      }
    ], 0), Boolean(card));
  const noCardReason = card ? null
    : !topic ? "no_catalog_match"
      : options.length === 0 ? "no_usable_facts"
        : detection.confidence < 0.6 ? "low_detection_confidence"
          : detection.sensitiveFlags.length > 0 ? "sensitive_detection"
            : !editorialDraft && editorialFallback ? "editorial_invalid"
              : !editorialDraft ? "editorial_skip"
                : !editorialVerification ? "verification_error"
                  : editorialVerification.decision === "accept" && selectedApplicability === "visible_subtype" && !subtypeVerification ? "subtype_verification_error"
                    : subtypeVerification?.decision === "reject" ? "subtype_verification_rejected"
                      : editorialVerification.decision === "accept" && selectedApplicability === "visible_feature" && !featureVerification ? "feature_verification_error"
                        : featureVerification?.decision === "reject" ? "feature_verification_rejected"
                  : "verification_rejected";
  const subjectAttempt = {
    fileName: photo.fileName,
    source,
    localPreflight: summarizePreflight(photo),
    status: card ? "card_generated" : "no_card",
    detection,
    catalogMatch: topic?.topicId ?? null,
    usableFactCount: options.length,
    noCardReason,
    expectedTopicMatch: topic?.topicId === source.expectedTopicId,
    editorialDraft,
    editorialVerification,
    subtypeVerification,
    featureVerification,
    editorialFallback,
    deterministicTitleUsed,
    judgeReused: false,
    card,
    judge,
    score: card ? scoreJudge(judge) : 0
  };
  subjectAttempts.push(subjectAttempt);
  if (isPublishable(subjectAttempt)) break;
  }
  const result = subjectAttempts.find(isPublishable) ?? [...subjectAttempts]
    .sort((left, right) => right.score - left.score)[0];
  result.detectedSubjects = understanding.subjects;
  result.subjectAttempts = subjectAttempts.map((attempt) => ({
    detection: attempt.detection,
    catalogMatch: attempt.catalogMatch,
    usableFactCount: attempt.usableFactCount,
    noCardReason: attempt.noCardReason,
    card: attempt.card,
    score: attempt.score
  }));
  results.push(result);
  await writeCheckpoint();
  process.stdout.write(`${photo.fileName} expected=${source.expectedDisplayName} detected=${result.detection.displayName} card=${result.card?.title ?? "NO_CARD"} score=${result.score}\n`);
}

const processed = results.filter((result) => result.status !== "local_rejected");
const dailyGroups = [];
for (let index = 0; index < processed.length; index += 3) {
  const photoGroup = processed.slice(index, index + 3);
  if (photoGroup.length < 3) {
    dailyGroups.push({
      photoFileNames: photoGroup.map((result) => result.fileName),
      candidateFileNames: photoGroup.filter(isPublishable).map((result) => result.fileName),
      usedFallbackBatch: false,
      status: "incomplete",
      cardId: null,
      reason: "不足三张，不构成一次每日选择。",
      winnerFileName: null
    });
    continue;
  }
  const group = photoGroup.filter(isPublishable);
  if (group.length === 0) {
    const reasons = Object.entries(Object.groupBy(photoGroup, (result) => result.noCardReason ?? "below_publish_threshold"))
      .map(([reason, items]) => `${reason}:${items.length}`)
      .join(", ");
    dailyGroups.push({
      photoFileNames: photoGroup.map((result) => result.fileName),
      candidateFileNames: [],
      usedFallbackBatch: false,
      status: "no_card",
      cardId: null,
      reason: `三张候选无可发布卡；分阶段原因：${reasons}。`,
      winnerFileName: null
    });
    continue;
  }
  const selection = validateSelection(await qwenJSON([
    { role: "user", content: selectionPrompt(group) }
  ], 0.2), new Set(group.map((result) => result.card.cardId)));
  if (selection.cardId === null) {
    dailyGroups.push({
      photoFileNames: photoGroup.map((result) => result.fileName),
      candidateFileNames: group.map((result) => result.fileName),
      usedFallbackBatch: false,
      status: "quality_rejected",
      ...selection,
      winnerFileName: null
    });
    continue;
  }
  dailyGroups.push({
    photoFileNames: photoGroup.map((result) => result.fileName),
    candidateFileNames: group.map((result) => result.fileName),
    usedFallbackBatch: false,
    status: "ai_selected",
    ...selection,
    winnerFileName: group.find((result) => result.card.cardId === selection.cardId)?.fileName
  });
}

const cards = results.filter((result) => result.card);
const publishableCards = cards.filter(isPublishable);
const mustRejectViolations = cards.filter((result) => mustRejectFileNames.has(result.fileName)).map((result) => result.fileName);
const mustPublishMisses = [...mustPublishFileNames].filter((fileName) => !cards.some((result) => result.fileName === fileName));
const scores = cards.map((result) => result.score);
const winnerResults = dailyGroups.flatMap((group) => {
  const winner = results.find((result) => result.fileName === group.winnerFileName);
  return winner ? [winner] : [];
});
const groundingChecks = results.filter((result) => result.editorialDraft).length;
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  model: primaryModel,
  verificationModel,
  judgeModel: primaryModel,
  judgeCaveat: "primary-model judge; publication grounding is independently rechecked by the stronger verification model, while external model/human review remains required",
  policy: `three-photo-reviewed-fact-discovery-${editorialMode}-v3`,
  dataset: { source: dataset.source, seed: dataset.seed, count: dataset.count, manifest: datasetFile },
  metrics: {
    localEligible: processed.length,
    localRejected: results.length - processed.length,
    analysisFailed: processed.filter((result) => result.status === "analysis_failed").length,
    cardGenerated: cards.length,
    publishableCards: publishableCards.length,
    uninterestingCards: cards.length - publishableCards.length,
    cardImageMatch: cards.filter((result) => result.judge.cardMatchesImage).length,
    groundingChecks,
    deterministicTitlesChecked: results.filter((result) => result.deterministicTitleUsed).length,
    deterministicTitlesPublished: cards.filter((result) => result.deterministicTitleUsed).length,
    groundingRejected: results.filter((result) => result.editorialVerification?.decision === "reject").length,
    groundedPublished: cards.filter((result) => result.editorialVerification?.decision === "accept").length,
    expectedTopicMatches: processed.filter((result) => result.expectedTopicMatch).length,
    matchedTopicsWithoutUsableFacts: processed.filter((result) => result.noCardReason === "no_usable_facts").length,
    editorialSkips: processed.filter((result) => result.noCardReason === "editorial_skip").length,
    noCardReasons: Object.fromEntries(Object.entries(Object.groupBy(
      processed.filter((result) => !result.card),
      (result) => result.noCardReason ?? "unknown"
    )).map(([reason, items]) => [reason, items.length])),
    expectedObjectActuallyVisible: processed.filter((result) => result.judge?.expectedObjectVisible).length,
    meanInterestingnessScore: scores.length ? rounded(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    scoreAtLeast75: scores.filter((score) => score >= 75).length,
    minimumPublishScore,
    dailyWinnerMeetsMinimumScore: winnerResults.filter((result) => result.score >= minimumPublishScore).length,
    hardFailures: cards.filter((result) => !result.judge.detectedObjectMatchesImage || !result.judge.cardMatchesImage).length,
    mustRejectViolations,
    mustPublishMisses,
    dailyPhotoGroups: dailyGroups.filter((group) => group.status !== "incomplete").length,
    incompletePhotoGroups: dailyGroups.filter((group) => group.status === "incomplete").length,
    dailyGroupsWithCard: dailyGroups.filter((group) => group.status !== "incomplete" && group.winnerFileName).length,
    dailyGroupsWithChoice: dailyGroups.filter((group) => group.status !== "incomplete" && group.candidateFileNames.length >= 2).length,
    fallbackDailyGroups: dailyGroups.filter((group) => group.usedFallbackBatch).length,
    dailyPhotosAnalyzed: dailyGroups.reduce((sum, group) => sum + group.photoFileNames.length, 0),
    dailyCoverageRate: dailyGroups.some((group) => group.status !== "incomplete")
      ? rounded(dailyGroups.filter((group) => group.status !== "incomplete" && group.winnerFileName).length /
        dailyGroups.filter((group) => group.status !== "incomplete").length)
      : 0
  },
  usage,
  dailyGroups,
  results
};
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
await writeFile(checkpointFile, `${JSON.stringify({ completed: true, outputFile }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const runPassed = report.metrics.hardFailures === 0 &&
  report.metrics.dailyPhotoGroups > 0 &&
  report.metrics.dailyGroupsWithCard === report.metrics.dailyPhotoGroups &&
  report.metrics.dailyWinnerMeetsMinimumScore === report.metrics.dailyGroupsWithCard &&
  report.metrics.mustRejectViolations.length === 0 && report.metrics.mustPublishMisses.length === 0;
process.stdout.write(`WEB_PHOTO_EVAL=${runPassed ? "PASS" : "FAIL"} mode=${editorialMode} eligible=${processed.length} cards=${cards.length} publishable=${publishableCards.length} imageMatch=${report.metrics.cardImageMatch} mean=${report.metrics.meanInterestingnessScore} calls=${usage.calls}\n`);
if (!runPassed) process.exitCode = 1;

async function qwenJSON(messages, temperature, requestModel = primaryModel) {
  const endpoint = `${credentials.openAiCompatible.replace(/\/$/, "")}/chat/completions`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.apiKey}`,
          "content-type": "application/json",
          "X-DashScope-DataInspection": "{\"input\":\"cip\",\"output\":\"cip\"}"
        },
        body: JSON.stringify({
          model: requestModel,
          messages,
          enable_thinking: false,
          response_format: { type: "json_object" },
          temperature
        }),
        redirect: "error",
        signal: AbortSignal.timeout(45_000)
      });
      const envelope = await response.json().catch(() => ({}));
      if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
        await delay(1_000 * (attempt + 1));
        continue;
      }
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
    } catch (error) {
      if (attempt === 3 || !["TimeoutError", "AbortError"].includes(error?.name)) throw error;
      await delay(1_000 * (attempt + 1));
    }
  }
  throw new Error("unreachable Qwen retry state");
}

async function detectWithRetry(messages) {
  let lastError = new Error("Invalid detection value");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await qwenJSON(messages, 0);
      try {
        return validateUnderstanding(raw);
      } catch (error) {
        throw new Error(`${safeError(error)}; raw=${JSON.stringify(raw).slice(0, 1_200)}`);
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function detectionPrompt(labels, preferredTopics) {
  return [
    "先检查图片是否含人脸/自拍、身份证件、银行卡、票据、文档、截图或高文字密度内容；命中时写入 sensitiveFlags。不要识别人、关系、情绪、健康或位置。",
    `端侧候选标签：${labels.length ? labels.join("、") : "无"}。这些标签可能错误，只能作为观察线索，最终必须以图片中实际可见的形状、结构和用途为准。`,
    "目标不是只找画面最大的主体，而是穷尽这张照片里最适合讲知识的入口。先独立列出所有清楚可辨、能指向具体日常物件或部件的对象，再按‘可确认程度、与照片关系、知识潜力’排序，最多返回 3 个不同对象。背景里过小、被遮挡、只能猜测的对象不要返回。",
    "图片也可能是线描、示意图、商品图或拼图。此时按画出的结构和用途识别具体物件，不要把带中央弹簧、两片夹爪且没有手柄的晾衣夹泛化成钳子；拼图中只有清楚、占据独立格且可准确指认的物件才可返回。",
    `可用知识主题目录如下：${preferredTopics.join("、")}。目录只用于决定已经清楚可见的对象中先尝试谁，绝不能把相似物体硬套成目录项目。明显主体不在目录时仍要如实返回；若另一个清楚对象在目录中，可一并返回。`,
    "若外壳被拆开、内部零件裸露，但接口、容量标记、结构组合等证据足以指向一个常见成品，应优先识别完整物件（例如拆开的 U 盘），不要退化成泛称的电路板或零件；证据不足时仍按可见部件识别。displayName 应写到图片能确认的最具体子类型；无法在两个不同类别间可靠判断时，confidence 必须低于 0.6。canonicalTopicId 使用简短英文 snake_case；displayName 使用中文；confidence 是 0 到 1 的数字；alternatives 是最多 5 个中文同义名称。",
    "boundingBox 必须严格为 null，或严格为 {\"x\":0.1,\"y\":0.1,\"width\":0.8,\"height\":0.8} 这种对象；四个字段都必须是 0 到 1 的数字。",
    "sensitiveFlags 只能从 face,selfie,identity_document,bank_card,receipt,document,high_text_density,screenshot 中选择。命中隐私项时 subjects 必须为空。严格只返回这个 json 形状，不得增删或改名字段：{\"subjects\":[{\"canonicalTopicId\":\"bicycle\",\"displayName\":\"自行车\",\"confidence\":0.95,\"boundingBox\":null,\"alternatives\":[\"单车\"]}],\"sensitiveFlags\":[]}"
  ].join("\n");
}

function editorialPrompt(options, mode) {
  const compact = options.map(({ factId, objectName, reviewedTitle, reviewedBody, fact }) => ({
    factId, objectName, reviewedTitle, reviewedBody, fact
  }));
  return [
    "你是一个极其挑剔的日常冷知识编辑。读者会在自己的照片旁看到卡片；目标不是介绍物件，而是让人产生一次具体的‘原来如此’。",
    mode === "image-aware" ? "你同时看到原照片。先判断照片中真正清楚可见的物件子类型、部件、材料、形状或使用状态，再选择与这些可见证据联系最强的候选事实。不要只按事实文字的戏剧性选择。" : null,
    mode === "image-aware" ? "照片明确显示物件类别时，只能选择该类物件几乎都共有的当前机制，或与眼前物件自然相连的熟悉动作。软件功能、保养建议和特定使用状态，必须在照片里有相应界面、状态或上下文，不能只凭物件类别触发。" : null,
    mode === "image-aware" ? "如果事实只适用于照片中看不出的子类型、部件或内部结构，必须 skip。事实即使写了‘有些’‘一种方案’，也不能把普通同类照片当作入口；只有图片能看出该结构或子类型时才可选。" : null,
    "先在候选事实中选择最有趣的一条。合格的冷知识必须同时具备：一个低熟悉度或违背直觉的发现；紧接着能解释‘原来如此’的机制；与这张照片的明确联系；能在一句话里复述的具体画面。只有正确或实用但像说明书、百科定义、专利摘要的内容不算有趣。带完整 reviewedTitle 和 reviewedBody 的事实已经过表达审核，在同样适用于图片时优先选择。",
    "来历与历史可以由现代物件照片触发：候选若直接讲该物件的前身或演变，并在标题中明确保留‘中世纪、早期、过去’等范围，即使旧结构已不可见也可选择。不要选择仅与行业规范、年代或专利旁枝有关、却不能解释该物件来历与演变的事实。若读者无法从照片主体、可见细节、熟悉动作或直接历史沿革理解为什么推这条，就 skip。",
    "若所选事实有 reviewedTitle，title 必须逐字复制 reviewedTitle，不得改写。reviewedTitle 与 reviewedBody 会成对出现；只有两者都为 null 时才按下面规则写标题。",
    "正文将由程序原样使用所选事实，你只写标题。title 以 8 到 18 个汉字为目标，绝不能超过 22 个汉字；生成后逐字检查，超长必须重写。标题像一个具体发现、疑问或反差。标题里的物件、部件、形状、用途和效果必须在所选事实中明确出现，只能额外添加‘为何’‘原来’‘不代表’‘背后’‘藏着’等连接词。",
    "标题必须保留事实里的适用范围和时间限定。事实写‘原始、早期、过去、快拆、多层、一种方案、有的、许多、可能’时，不得省略成适用于照片中所有同类物件的断言。照片里看不出的内部结构不能被说成照片里这个物件一定具有。",
    "不要为了贴合照片而给可见孔洞、纹路、颜色或形状临时编造用途。除了‘为何、原来、背后、藏着’等连接词，标题里的实义汉字必须能在事实原文中找到，优先抽取事实词组，不用同义改写。事实没有写‘泡沫、空气、减震、省力’等词时，标题也不能加入这些含义。事实写内部敲击再由外壳共振时，不能改成‘靠共振而非敲击’。",
    "factId 与 title 必须逐条对应，绝不能选择一条事实的 factId、却从另一条候选事实拿词或机制写标题。若无法只用所选事实写出准确标题，必须 skip。",
    "不得跨越‘或、和、以及、分号’重新组合属性与名词。原文‘尼龙细丝或塑料单丝’不能写成‘尼龙单丝’；原文的两个阶段、两种材料、两个机制也不能拼成原文没有的新组合。",
    "不得把‘带角度’改成‘有弧度’，不得把‘开锅层’叫成‘黑垢’，也不得提出原事实没有回答的‘是否省力’等问题。不要新增用途、因果、历史、建议或专有名词。",
    "标题不使用‘你知道吗’‘冷知识’‘一种’‘现代’‘该专利’‘关于’开头，也不能照抄事实开头。",
    "发布时严格返回 json：{\"decision\":\"publish\",\"factId\":\"候选 ID\",\"title\":\"标题\"}。跳过时严格返回：{\"decision\":\"skip\",\"factId\":null,\"title\":null}。不得返回其他字段。",
    JSON.stringify(compact)
  ].filter(Boolean).join("\n");
}

function editorialVerificationPrompt(selected, editorial) {
  return [
    "你只做照片知识卡发布前核验，不负责润色，也不能用常识替作者补证据。",
    "给定 fact 已经过独立来源审核；这里不得用你自己的常识反驳、改写或重新裁决 fact 本身是否正确。你的任务只限于检查 title 和 body 是否忠于 fact，以及 fact 所讨论的对象、部件、方向或状态是否在照片中成立。",
    "第一步必须完全忽略 objectName、fact、title 和 body，先只看图片，独立判断清晰可见的主体是什么。第二步才读取候选文字并逐项核对。若图片主体不是 objectName，或只有借助候选文字才能把相似物体解释成 objectName，factAppliesToImage 必须为 false。不要沿用上一步模型的识别结论。",
    "photoApplicability 是照片触发规则：category 表示只要图片主体明确属于该物件类别即可；visible_subtype 表示照片必须能确认事实适用的子类型；visible_feature 表示事实所指部件、纹理或接口必须能从照片确认；visible_state 表示事实所指状态、环境或结果必须在照片中可见；model_checked 表示旧事实尚未预标触发范围，你必须根据事实限定和照片证据从严判断。",
    "该触发规则优先于下面的通用例子。category 且主体就是 objectName 时应通过；model_checked 不能自动通过，若事实只适用于照片无法确认的少见子类型、状态或部件，必须拒绝。直接讲该物件类别来历与演变的历史事实可以由现代物件触发。",
    "titleGrounded 与 bodyGrounded 只比较候选文字和 fact，不得因为照片没有拍到历史年代、内部结构或动作过程而把这两项判为 false。照片是否合适只写入 factAppliesToImage。",
    "先分别核验 title 与 body 的对象、部件、时间、适用范围、否定、因果、用途和效果是否都被 fact 明确支持；再单独核验 fact 是否适用于照片中真正可见的对象或子类型。",
    "titleGrounded 只在标题没有新增事实、没有删掉‘原始、早期、快拆、多层、一种方案、有的、许多、可能’等关键限定、也没有把并列机制改成‘A而非B’时为 true。",
    "bodyGrounded 使用同样标准检查正文；正文为了好懂可以拆句，但不能补写 fact 没有明确支持的结论、比喻、否定、时间顺序或绝对化范围。",
    "factAppliesToImage 判断的是读者能否指着照片里的主体、可见细节或自然联想到的熟悉动作，立刻理解为什么收到这条。只有该类物件几乎都共有的当前机制，才可在未展示动作时通过类别本身触发。软件功能、保养建议和特定状态必须有可见上下文。",
    "照片若清楚显示事实所讨论的部件、接口、拆开状态或配置方向，即使动作尚未发生，也属于可见上下文；不要仅因看不到正在使用就拒绝。若照片已足以确认常见对象或常见子类型，fact 解释的是它正常工作时共有的内部机制，也不要求把内部零件直接拍出来。",
    "若事实只适用于少见结构、特定型号或专利方案，而照片无法确认对应结构或子类型，必须为 false。即使标题保留‘有些’‘一种方案’，普通同类照片也不能作为入口；不要把这条规则错误用于该类物件普遍共有的正常内部机制。",
    "来历与历史本来就是知识卡允许的内容。若 fact 直接讲这个物件类别的前身、用途或演变，而且 title 保留了事实中的年代和范围限定，照片清楚显示该类现代物件即可作为入口，不要求古代结构、人物、图案或年代标识仍在眼前。例如一张普通马克杯可以触发历史上啤酒杯曾印国王肖像的事实；不能因照片杯身没有肖像而拒绝。只有与物件演变无直接关系的行业规范、年代或专利轶事才应为 false。",
    "图片明确显示相反子类型，或事实限定快拆、滚筒、泡沫泵等特定子类型而照片无法确认时，factAppliesToImage 必须为 false。普通台钳照片不能断言是快拆台钳，顶开式洗衣机不能配滚筒翻滚事实。不要因为标题听起来有趣而放宽。",
    "反例一：fact 只讲泵腔和单向阀，title 却说月牙孔混合空气和泡沫，titleGrounded=false。反例二：fact 说内部小锤敲外壳并由外壳共振，title 说靠共振而非敲击，titleGrounded=false。",
    "反例三：fact 写‘尼龙细丝或塑料单丝’，title 写成‘尼龙单丝’，这是跨越‘或’重组材料与结构，titleGrounded=false。也要检查其他‘或、和、以及、分号’两侧的词是否被错误拼接。",
    "imageObject 写第一步独立看到的主体名称；objectMatchesImage 只判断该主体是否与 objectName 是同一种物件。objectIsPrimarySubject 只有在该物件是画面清晰主体、明确焦点或占据显著面积时才为 true；背景里的小零件、布面上一条含糊接缝、只能放大猜测的局部都必须为 false。subtypeMatchesFact 判断照片能否确认 fact 适用的子类型或技术类别，不要求内部零件直接可见；例如清楚的消费级数码相机可与常见拜耳阵列事实匹配，而磁带摄像机、胶片相机或无法判断类型的相机不可。factAppliesToImage 只判断 visible_feature 或 visible_state 所要求的细节是否成立。",
    "decision 只有 accept 或 reject。严格返回 json，不得增加字段：{\"decision\":\"accept\",\"imageObject\":\"图片主体\",\"objectMatchesImage\":true,\"objectIsPrimarySubject\":true,\"subtypeMatchesFact\":true,\"titleGrounded\":true,\"bodyGrounded\":true,\"factAppliesToImage\":true,\"reason\":\"不超过40字\"}。",
    JSON.stringify({ objectName: selected.photoObjectName, photoApplicability: selected.photoApplicability, fact: selected.fact, title: editorial.title, body: editorial.body })
  ].join("\n");
}

function subtypeVerificationPrompt(requiredObject) {
  return [
    "你是第二位独立视觉核验员，只判断照片中是否清楚出现指定的物件子类型；不要评审知识、标题或文案。",
    "先只看图片，再读取 requiredObject。不得因为图片里出现同一大类物件，就推断它满足更具体的子类型。",
    "requiredObject 中每一个可见限定都是 AND 条件；任何一项看不清、数不清或只能靠常识猜测，requiredVisualEvidenceVisible 必须为 false，decision 必须为 reject。",
    "涉及两条嵌套路径、两个中心、两个内端或两个外端时，必须能在图片里分别指出对应的两个端点或路径。一条已经分离的连续螺旋无论绕多少圈，都不能算两条嵌套螺旋。",
    "未分离双盘蚊香通常仍是一整张圆片：中心的S形分界和两个相向内端，表示两条螺旋彼此嵌套；不要因为两条路径尚未掰开、仍贴成整张圆片，就误判为单盘。已经分离的单盘只有一个开放内端，且盘体之间是大块空隙。",
    "imageObject 写你独立看到的主体；reason 只描述照片中的可见证据，不得复述候选要求冒充证据。",
    "严格只返回 json，不得增加字段：{\"decision\":\"accept\",\"imageObject\":\"图片主体\",\"requiredVisualEvidenceVisible\":true,\"reason\":\"不超过40字\"}。",
    JSON.stringify({ requiredObject })
  ].join("\n");
}

function featureVerificationPrompt(requiredFeature) {
  return [
    "你是第二位独立视觉核验员，只判断指定部件或纹理是否在照片像素中清楚可辨；不要评审知识，也不要依据物件常见结构进行推断。",
    "先只看图片，再读取 requiredFeature。只有你能指出该特征在图片中的具体位置，并直接辨认其形状、孔洞、纹理或接口时才可接受。",
    "物件通常具有该特征、隔着反光面隐约猜到、把环境倒影或背景纹理当成部件、必须放大后猜测，都必须拒绝。黑色、反光、磨砂或不透明面板本身不等于其后存在的网孔或纹理清楚可见。",
    "imageObject 写独立看到的主体；visibleEvidence 只写照片里能直接指出的证据，不能复述 requiredFeature 冒充证据。",
    "严格只返回 json，不得增加字段：{\"decision\":\"accept\",\"imageObject\":\"图片主体\",\"requiredVisualEvidenceVisible\":true,\"visibleEvidence\":\"可见位置与形态，不超过40字\",\"reason\":\"不超过40字\"}。",
    JSON.stringify({ requiredFeature })
  ].join("\n");
}

function judgePrompt(detection, card) {
  return [
    "你是照片冷知识的盲测质检员。你看不到图片的搜索词、预期类别或数据集答案，只能按图中真正可见内容和给定卡片评分，不补写知识，不因为模型置信度而迁就。",
    `待核验的模型识别：${detection.displayName}（${detection.canonicalTopicId}）。`,
    `卡片：${card ? JSON.stringify({ title: card.title, body: card.body, objectName: card.objectName }) : "未生成"}。`,
    "expectedObjectVisible 是兼容字段，表示待核验的模型识别对象是否确实是图中清晰主体；detectedObjectMatchesImage 表示该识别是否符合图片；cardMatchesImage 表示卡片对象及知识角度是否自然对应图中可见主体。",
    "产品明确允许由现代物件照片触发该物件的来历与历史：只要标题清楚保留‘中世纪、早期、过去’等范围，内容直接讲该物件的前身或演变，cardMatchesImage 应为 true，imageConnection 通常为 3；不要因为旧结构没有出现在现代照片里就判对象不匹配。与物件演变无关的年代或专利旁枝仍应拒绝。",
    "只有生成卡片时才评分，四项均为 1 到 5 的整数并使用完整量表，不要默认都给4分：surprise=5需明显推翻常见直觉，3是有新意但不反常识，1是显然常识；specificity=5需有独特部件或机制，3是具体但常见，1是百科定义；clarity=5需十秒内一眼读懂且标题正文一致，3需回读，1难懂；imageConnection=5需解释照片中清楚可见细节，3表示照片主体就是该物件、知识讲其历史或内部机制但细节不可见，1只用于对象不匹配或几乎可随意贴到无关图片。未生成时四项都填1。",
    "verdict 只能为 pass、weak、fail。严格只返回 json：{\"expectedObjectVisible\":true,\"detectedObjectMatchesImage\":true,\"cardMatchesImage\":true,\"surprise\":4,\"specificity\":4,\"clarity\":5,\"imageConnection\":4,\"verdict\":\"pass\",\"reason\":\"不超过80字\"}。"
  ].join("\n");
}

function selectionPrompt(results) {
  return [
    "你是日常冷知识主编。候选都已通过事实、照片适配和趣味质量审核；你的任务只是在其中选出今天最值得展示的一条，不能再次否决整组。优先选择反差更具体、机制更清楚、最容易一句话转述的卡片。",
    "必须返回 publish。严格返回 json：{\"decision\":\"publish\",\"cardId\":\"候选 ID\",\"surprise\":4,\"aha\":4,\"retellability\":4,\"naturalness\":4,\"hardIssue\":false,\"reason\":\"不超过 60 字的选择理由\"}，不得返回其他字段。评分只用于解释排序，不再充当发布闸门。",
    JSON.stringify(results.map((result) => ({
      cardId: result.card.cardId,
      objectName: result.card.objectName,
      title: result.card.title,
      body: result.card.body,
      editorialScore: result.score,
      surprise: result.judge.surprise,
      specificity: result.judge.specificity,
      clarity: result.judge.clarity,
      imageConnection: result.judge.imageConnection
    })))
  ].join("\n");
}

function factOptions(topic, sources) {
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  return topic.facts.filter((fact) =>
    fact.riskLevel === "general" && fact.reviewStatus === "approved" &&
    fact.cardQualityStatus === "approved" && typeof fact.cardTitle === "string" && typeof fact.cardBody === "string" &&
    (fact.review || fact.aiReview?.decision === "approved") && fact.sourceIds.every((id) => sourcesById.has(id))
  ).sort((left, right) =>
    Number(right.cardQualityStatus === "approved") - Number(left.cardQualityStatus === "approved") ||
    left.factId.localeCompare(right.factId)
  )
    .map((fact) => ({
      factId: fact.factId,
      objectName: topic.displayName,
      reviewedTitle: fact.cardQualityStatus === "approved" ? fact.cardTitle ?? null : null,
      reviewedBody: fact.cardQualityStatus === "approved" ? fact.cardBody ?? null : null,
      photoApplicability: fact.photoApplicability ?? "model_checked",
      photoObjectName: fact.photoObjectName ?? topic.displayName,
      fact: fact.factText,
      sources: fact.sourceIds.map((id) => {
        const source = sourcesById.get(id);
        return { sourceId: id, title: source.title, publisher: source.publisher, url: source.url };
      })
    }));
}

function fallbackTitle(objectName, factId) {
  const templates = ["上的这个细节不是偶然", "里藏着怎样的设计取舍", "为什么会被设计成这样"];
  const suffix = templates[stableHash(factId) % templates.length];
  return `${Array.from(objectName).slice(0, Math.max(1, 30 - Array.from(suffix).length)).join("")}${suffix}`;
}

function stableHash(value) {
  let hash = 0;
  for (const scalar of value) hash = ((hash >>> 0) * 31 + scalar.codePointAt(0)) >>> 0;
  return hash;
}

function matchTopic(entity, topics) {
  const exact = topics.find((topic) => topic.topicId === entity.canonicalTopicId);
  if (exact) return exact;
  const primary = new Set([entity.displayName, entity.canonicalTopicId].map(normalize));
  const alternatives = new Set(entity.alternatives.map(normalize));
  const ranked = topics.flatMap((topic) => {
    const displayName = normalize(topic.displayName);
    const topicId = normalize(topic.topicId);
    const synonyms = topic.synonyms.map(normalize);
    const score = primary.has(displayName) ? 50
      : primary.has(topicId) ? 45
        : synonyms.some((item) => primary.has(item)) ? 40
          : alternatives.has(displayName) ? 30
            : alternatives.has(topicId) ? 25
              : synonyms.some((item) => alternatives.has(item)) ? 20
                : 0;
    return score > 0 ? [{ topic, score }] : [];
  }).sort((left, right) => right.score - left.score || left.topic.topicId.localeCompare(right.topic.topicId));
  return ranked[0]?.topic ?? null;
}

function validateDetection(value) {
  exactKeys(value, ["alternatives", "boundingBox", "canonicalTopicId", "confidence", "displayName"], "detection");
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(value.canonicalTopicId) || typeof value.displayName !== "string" ||
      !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      !Array.isArray(value.alternatives) || value.alternatives.length > 5) {
    throw new Error("Invalid detection value");
  }
  return value;
}

function validateUnderstanding(value) {
  exactKeys(value, ["sensitiveFlags", "subjects"], "photo understanding");
  if (!Array.isArray(value.subjects) || value.subjects.length > 3 ||
      !Array.isArray(value.sensitiveFlags) || new Set(value.sensitiveFlags).size !== value.sensitiveFlags.length ||
      (value.sensitiveFlags.length > 0 && value.subjects.length > 0)) {
    throw new Error("Invalid photo understanding");
  }
  const allowedFlags = new Set(["face", "selfie", "identity_document", "bank_card", "receipt", "document", "high_text_density", "screenshot"]);
  if (value.sensitiveFlags.some((flag) => !allowedFlags.has(flag))) throw new Error("Invalid sensitive flag");
  const subjects = value.subjects.map(validateDetection);
  const identities = subjects.map((subject) => `${subject.canonicalTopicId}|${subject.displayName}`);
  if (new Set(identities).size !== identities.length) throw new Error("Duplicate knowledge subjects");
  return { subjects: subjects.map((subject) => ({ ...subject, sensitiveFlags: [] })), sensitiveFlags: value.sensitiveFlags };
}

function validateEditorial(value, options) {
  exactKeys(value, ["decision", "factId", "title"], "editorial");
  if (value.decision === "skip") {
    if (value.factId !== null || value.title !== null) throw new Error("Editorial skip must use null fields");
    return null;
  }
  if (value.decision !== "publish") throw new Error("Editorial decision is invalid");
  const selected = options.find((option) => option.factId === value.factId);
  if (!selected || typeof value.title !== "string") throw new Error("Editorial output is not grounded");
  const title = value.title.trim();
  if (selected.reviewedTitle) {
    if (title !== selected.reviewedTitle) throw new Error(`Editorial title changed reviewed copy: ${title}`);
    if (!selected.reviewedBody) throw new Error("Editorial reviewed copy is incomplete");
    return { factId: value.factId, title: selected.reviewedTitle, body: selected.reviewedBody };
  }
  const length = Array.from(title).length;
  if (length < 8 || length > 22) throw new Error(`Editorial title length failed: ${title}`);
  if (["你知道吗", "冷知识", "一种", "现代", "该专利", "关于"].some((prefix) => title.startsWith(prefix))) {
    throw new Error(`Editorial title prefix failed: ${title}`);
  }
  const normalizedTitle = normalizeCopy(title);
  const normalizedBody = normalizeCopy(selected.fact);
  if (normalizedBody.startsWith(normalizedTitle) || normalizedTitle.startsWith(normalizedBody.slice(0, 8))) {
    throw new Error(`Editorial title repeats body: ${title}`);
  }
  const bodyTokens = new Set(selected.fact.match(/[A-Za-z]+(?:-[A-Za-z]+)*|\d+(?:\.\d+)?/g) ?? []);
  const ungrounded = (title.match(/[A-Za-z]+(?:-[A-Za-z]+)*|\d+(?:\.\d+)?/g) ?? []).find((token) => !bodyTokens.has(token));
  if (ungrounded) throw new Error(`Editorial title token is ungrounded: ${ungrounded}`);
  if (title.includes("而非") && !["不是", "并不", "并非", "不负责", "而是", "没有"].some((marker) => selected.fact.includes(marker))) {
    throw new Error(`Editorial unsupported negation: ${title}`);
  }
  if (!editorialScopeIsPreserved(selected.fact, title)) throw new Error(`Editorial scope is not preserved: ${title}`);
  return { factId: value.factId, title, body: selected.fact };
}

function makeDeterministicEditorialFallback(value, options) {
  exactKeys(value, ["decision", "factId", "title"], "editorial fallback");
  if (value.decision !== "publish") throw new Error("Editorial fallback requires a publish decision");
  const selected = options.find((option) => option.factId === value.factId);
  if (!selected) throw new Error("Editorial fallback fact is not reviewed");
  if (!selected.reviewedTitle || !selected.reviewedBody) throw new Error("Editorial fallback requires reviewed copy");
  return { factId: selected.factId, title: selected.reviewedTitle, body: selected.reviewedBody };
}

function chineseContentWordsAreGrounded(output, fact, objectName) {
  const allowedConnectors = new Set([
    "为何", "为什么", "原来", "背后", "藏着", "竟然", "其实", "只", "只是", "还", "却", "也", "更",
    "这", "其中", "了", "的", "与", "和", "而", "而非", "并非", "靠", "来自", "实为", "如今", "可", "能", "会",
    "藏", "着", "实", "为", "来", "自", "只作", "不只是", "更是", "非", "以"
  ]);
  const source = `${objectName}${fact}`;
  const factHasNegation = ["不是", "并不", "并非", "不负责", "而是", "没有"].some((marker) => fact.includes(marker));
  if (output.includes("而非") && !factHasNegation) return false;
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  return Array.from(segmenter.segment(output)).every(({ segment, isWordLike }) =>
    !isWordLike || !/\p{Script=Han}/u.test(segment) || source.includes(segment) || allowedConnectors.has(segment)
  );
}

function editorialScopeIsPreserved(fact, title) {
  const leadingText = Array.from(fact).slice(0, 16).join("");
  const leadingRules = [
    [["原始"], ["原始", "早期", "第一代"]],
    [["过去", "曾经"], ["过去", "曾经", "早期"]],
    [["有些"], ["有些", "一些", "部分", "可能"]],
    [["也有"], ["也有", "有的", "一种", "部分", "路线"]],
    [["若"], ["若", "如果", "提供", "选项"]]
  ];
  if (!leadingRules.every(([factMarkers, titleMarkers]) =>
    !factMarkers.some((marker) => leadingText.includes(marker)) || titleMarkers.some((marker) => title.includes(marker)))) return false;
  if (fact.includes("快拆") && !title.includes("快拆")) return false;
  if ((fact.includes("一种方案") || fact.includes("一种设计")) &&
      !["一种", "方案", "设计", "有的"].some((marker) => title.includes(marker))) return false;
  return true;
}

function validateEditorialVerification(value, photoApplicability, requireModelTitleGrounding = true) {
  exactKeys(value, ["bodyGrounded", "decision", "factAppliesToImage", "imageObject", "objectIsPrimarySubject", "objectMatchesImage", "reason", "subtypeMatchesFact", "titleGrounded"], "editorial verification");
  if (!["accept", "reject"].includes(value.decision) || typeof value.imageObject !== "string" ||
      Array.from(value.imageObject).length < 1 || Array.from(value.imageObject).length > 80 ||
      typeof value.objectMatchesImage !== "boolean" || typeof value.objectIsPrimarySubject !== "boolean" ||
      typeof value.titleGrounded !== "boolean" ||
      typeof value.subtypeMatchesFact !== "boolean" ||
      typeof value.bodyGrounded !== "boolean" || typeof value.factAppliesToImage !== "boolean" ||
      typeof value.reason !== "string" ||
      Array.from(value.reason).length < 1 || Array.from(value.reason).length > 160 ||
      !new Set(["category", "visible_subtype", "visible_feature", "visible_state", "model_checked"]).has(photoApplicability)) {
    throw new Error("Invalid editorial verification");
  }
  const detailPolicyPassed = photoApplicability === "category"
    ? true
    : photoApplicability === "visible_subtype"
      ? value.subtypeMatchesFact
      : photoApplicability === "model_checked"
        ? value.subtypeMatchesFact && value.factAppliesToImage
      : value.factAppliesToImage;
  const imagePolicyPassed = value.objectMatchesImage && value.objectIsPrimarySubject && detailPolicyPassed;
  return {
    ...value,
    decision: value.bodyGrounded && imagePolicyPassed &&
      (!requireModelTitleGrounding || value.titleGrounded) ? "accept" : "reject"
  };
}

function validateSubtypeVerification(value) {
  exactKeys(value, ["decision", "imageObject", "reason", "requiredVisualEvidenceVisible"], "subtype verification");
  if (!new Set(["accept", "reject"]).has(value.decision) ||
      typeof value.imageObject !== "string" || Array.from(value.imageObject).length < 1 || Array.from(value.imageObject).length > 80 ||
      typeof value.requiredVisualEvidenceVisible !== "boolean" ||
      typeof value.reason !== "string" || Array.from(value.reason).length < 1 || Array.from(value.reason).length > 160) {
    throw new Error("Invalid subtype verification");
  }
  return {
    ...value,
    decision: value.decision === "accept" && value.requiredVisualEvidenceVisible ? "accept" : "reject"
  };
}

function validateFeatureVerification(value) {
  exactKeys(value, ["decision", "imageObject", "reason", "requiredVisualEvidenceVisible", "visibleEvidence"], "feature verification");
  if (!new Set(["accept", "reject"]).has(value.decision) ||
      typeof value.imageObject !== "string" || Array.from(value.imageObject).length < 1 || Array.from(value.imageObject).length > 80 ||
      typeof value.requiredVisualEvidenceVisible !== "boolean" ||
      typeof value.visibleEvidence !== "string" || Array.from(value.visibleEvidence).length < 1 || Array.from(value.visibleEvidence).length > 160 ||
      typeof value.reason !== "string" || Array.from(value.reason).length < 1 || Array.from(value.reason).length > 160) {
    throw new Error("Invalid feature verification");
  }
  return {
    ...value,
    decision: value.decision === "accept" && value.requiredVisualEvidenceVisible ? "accept" : "reject"
  };
}

function validateJudge(value, hasCard) {
  exactKeys(value, ["cardMatchesImage", "clarity", "detectedObjectMatchesImage", "expectedObjectVisible", "imageConnection", "reason", "specificity", "surprise", "verdict"], "judge");
  for (const key of ["expectedObjectVisible", "detectedObjectMatchesImage", "cardMatchesImage"]) {
    if (typeof value[key] !== "boolean") throw new Error(`Judge ${key} is invalid`);
  }
  for (const key of ["surprise", "specificity", "clarity", "imageConnection"]) {
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 5) throw new Error(`Judge ${key} is invalid`);
  }
  if (!["pass", "weak", "fail"].includes(value.verdict) || typeof value.reason !== "string") throw new Error("Judge verdict is invalid");
  return hasCard ? value : {
    ...value,
    surprise: 1,
    specificity: 1,
    clarity: 1,
    imageConnection: 1,
    verdict: "fail",
    reason: "未生成卡片；本项只记录识别与供给状态，不参与卡片质量评分。"
  };
}

function isPublishable(result) {
  return Boolean(result.card) && result.judge.detectedObjectMatchesImage && result.judge.cardMatchesImage &&
    result.judge.verdict === "pass" && result.score >= minimumPublishScore;
}

function validateSelection(value, allowed) {
  exactKeys(value, ["decision", "cardId", "surprise", "aha", "retellability", "naturalness", "hardIssue", "reason"], "selection");
  if (!["publish", "skip"].includes(value.decision) ||
      !["surprise", "aha", "retellability", "naturalness"].every((key) => Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= 5) ||
      typeof value.hardIssue !== "boolean" || typeof value.reason !== "string" ||
      Array.from(value.reason).length < 1 || Array.from(value.reason).length > 80) {
    throw new Error("Invalid selection");
  }
  const qualityPassed = value.surprise >= 4 && value.aha >= 4 && value.retellability >= 4 &&
    value.naturalness >= 4 && !value.hardIssue;
  if (value.decision === "skip") {
    if (value.cardId !== null) throw new Error("Skipped selection must not name a card");
    return value;
  }
  if (!allowed.has(value.cardId)) throw new Error("Selected an unknown card");
  return qualityPassed ? value : { ...value, decision: "skip", cardId: null };
}

function exactKeys(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`Invalid ${context} JSON shape`);
  }
}

function scoreJudge(judge) {
  return Math.round((judge.surprise * 0.4 + judge.specificity * 0.25 + judge.clarity * 0.2 + judge.imageConnection * 0.15) * 20);
}

function summarizePreflight(photo) {
  return {
    qualityScore: photo.qualityScore,
    labels: photo.labels,
    sensitiveFlags: photo.sensitiveFlags,
    exactDuplicateOf: photo.exactDuplicateOf,
    nearDuplicateCluster: photo.nearDuplicateCluster
  };
}

async function writeCheckpoint() {
  await writeFile(checkpointFile, `${JSON.stringify({ editorialMode, usage, results }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function readOptionalJSON(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function safeError(error) {
  return String(error?.message ?? error).replaceAll(credentials.apiKey, "[redacted]").slice(0, 240);
}

function assertJPEG(bytes, fileName) {
  if (bytes.length < 32 || bytes.length > 3 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`Sanitized JPEG invariant failed: ${fileName}`);
  }
}

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/[\s_\-/]+/g, "");
}

function normalizeCopy(value) {
  return String(value).replace(/[\s，。！？；：、,.!?;:\-—（）()]/g, "");
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function value(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredPath(flag) {
  const result = value(flag);
  if (!result) throw new Error(`${flag} is required`);
  return path.resolve(result);
}

function optionalPath(flag) {
  const result = value(flag);
  return result ? path.resolve(result) : null;
}
