import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";

const args = process.argv.slice(2);
const input = requiredPath("--input");
const preflightPath = requiredPath("--preflight");
const credentialsPath = requiredPath("--credentials-file");
const output = requiredPath("--output");
const mode = value("--mode") ?? "full-card";
if (!new Set(["full-card", "title-only", "extractive-hook"]).has(mode)) throw new Error("Invalid --mode");
const model = "qwen3.7-flash-2026-07-15";
const credentials = parseBailianCredentialsCsv(await readFile(credentialsPath, "utf8"));
const report = JSON.parse(await readFile(input, "utf8"));
const preflight = JSON.parse(await readFile(preflightPath, "utf8"));
const preflightByName = new Map(preflight.photos.map((photo) => [photo.fileName, photo]));
const checkpointPath = `${output}.checkpoint.json`;
const checkpoint = await readOptionalJSON(checkpointPath);
const usage = checkpoint?.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
const results = checkpoint?.results ?? [];
const completed = new Set(results.map((result) => result.fileName));

for (const result of report.results.filter((item) => item.card)) {
  if (completed.has(result.fileName)) continue;
  const photo = preflightByName.get(result.fileName);
  if (!photo?.sanitizedFile) throw new Error(`Missing sanitized photo: ${result.fileName}`);
  const jpeg = await readFile(photo.sanitizedFile);
  const imageURL = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  let generated;
  try {
    generated = await validatedQwen([{
      role: "user",
      content: [
        { type: "text", text: writerPrompt(result, mode) },
        { type: "image_url", image_url: { url: imageURL } }
      ]
    }], mode === "full-card" ? 0.7 : 0.2, (raw) => validateVariants(raw, result, mode));
  } catch (error) {
    results.push({
      fileName: result.fileName,
      objectName: result.card.objectName,
      factId: result.card.factId,
      verifiedFact: result.card.body,
      baseline: { id: "baseline", title: result.card.title, body: result.card.body, angle: "current_product" },
      variants: [],
      panel: null,
      selected: { id: "baseline", title: result.card.title, body: result.card.body, angle: "current_product" },
      improved: false,
      baselinePassesGate: false,
      generationFailure: String(error?.message ?? error).slice(0, 800)
    });
    await writeFile(checkpointPath, `${JSON.stringify({ usage, results }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`${result.fileName} ${result.card.objectName} winner=baseline improved=false generation=failed\n`);
    continue;
  }
  const candidates = [
    { id: "baseline", title: result.card.title, body: result.card.body, angle: "current_product" },
    ...generated.variants
  ];
  const panel = await validatedQwen([{
    role: "user",
    content: [
      { type: "text", text: judgePrompt(result, candidates) },
      { type: "image_url", image_url: { url: imageURL } }
    ]
  }], 0, (raw) => validatePanel(raw, candidates.map((candidate) => candidate.id)));
  const selected = candidates.find((candidate) => candidate.id === panel.winnerId);
  if (!selected) throw new Error(`Unknown winner for ${result.fileName}`);
  const baselineRating = panel.ratings.find((rating) => rating.id === "baseline");
  const selectedRating = panel.ratings.find((rating) => rating.id === selected.id);
  results.push({
    fileName: result.fileName,
    objectName: result.card.objectName,
    factId: result.card.factId,
    verifiedFact: result.card.body,
    baseline: candidates[0],
    variants: generated.variants,
    panel,
    selected,
    improved: selected.id !== "baseline" && passesGate(selectedRating),
    baselinePassesGate: passesGate(baselineRating)
  });
  await writeFile(checkpointPath, `${JSON.stringify({ usage, results }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${result.fileName} ${result.card.objectName} winner=${selected.id} improved=${selected.id !== "baseline" && passesGate(selectedRating)}\n`);
}

const improved = results.filter((result) => result.improved).length;
const baselinePasses = results.filter((result) => result.baselinePassesGate).length;
const selectedPasses = results.filter((result) => passesGate(result.panel?.ratings.find((rating) => rating.id === result.selected.id))).length;
const finalReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  model,
  mode,
  sourceReport: input,
  judgeCaveat: "same-model reader panel; output still requires human product review and deterministic grounding tests",
  gate: {
    factualAtLeast: 5,
    photoConnectionAtLeast: 4,
    stopPowerAtLeast: 4,
    ahaAtLeast: 4,
    retellabilityAtLeast: 4,
    textbookPenaltyAtMost: 1
  },
  metrics: {
    cards: results.length,
    baselinePasses,
    selectedPasses,
    improved,
    baselineWinOrTie: results.filter((result) => result.selected.id === "baseline").length
  },
  usage,
  results
};
await writeFile(output, `${JSON.stringify(finalReport, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`CARD_EXPERIENCE_ITERATION=PASS improved=${improved}/${results.length} baselinePass=${baselinePasses} selectedPass=${selectedPasses} calls=${usage.calls}\n`);

function writerPrompt(result, currentMode) {
  if (currentMode === "extractive-hook") {
    return [
      "你在为手机桌面小组件设计两拍式知识标题。目标是让读者先看到一个熟悉动作或误解，再立刻看到反差或原理。",
      `照片主体：${result.card.objectName}`,
      `唯一核验事实：${result.card.body}`,
      "正文 body 必须逐字复制唯一核验事实。标题只能从核验事实里截取两个连续原文片段，中间用一个全角竖线｜连接；竖线两侧都必须能在核验事实中逐字找到，不得增加、替换、改写任何实义词。",
      "每段 4–24 个汉字，总标题 9–49 个字符。允许省略原文中不影响含义的前后文字，但不能删除‘有些、也有、若、适当、可能、原始、过去、许多、有的’等适用范围。",
      `本条事实标题必须保留的限定词：${requiredScopeMarkers(result.card.body).join("、") || "无"}。`,
      "三种取法：contrast 选原文已有的误解与反转；action 选动作与结果；micro 选部件与作用。原文不支持某种取法时，改选另一组真实片段，不得编造。",
      "示例只说明格式：事实若写‘按下按钮时灯会亮；松手后弹簧让按钮复位’，标题可写‘按下按钮时灯会亮｜松手后弹簧让按钮复位’。不得把示例内容用于本图。",
      "严格返回一个 json 对象：{\"variants\":[{\"id\":\"contrast\",\"title\":\"原文片段｜原文片段\",\"body\":\"逐字复制的核验事实\",\"angle\":\"一句话说明两拍关系\"},{\"id\":\"action\",...},{\"id\":\"micro\",...}]}。不得返回其他字段。"
    ].join("\n");
  }
  if (currentMode === "title-only") {
    return [
      "你在为手机桌面小组件改写知识卡标题。当前标题被真人评价为无聊，但事实正确性比吸引力更重要。",
      `照片主体：${result.card.objectName}`,
      `唯一核验事实：${result.card.body}`,
      "正文 body 必须逐字复制唯一核验事实，一个字都不能改。只改标题。",
      "写三个不同标题：contrast 突出事实原文已有的反差；action 突出事实原文已有的动作与结果；micro 突出事实原文已有的部件或瞬间。原文没有反差时不要制造反差。",
      "标题 8–20 个汉字。实义词只能直接取自照片主体名和事实原文；只能额外使用‘为何、原来、竟然、其实、还、却、也、更、这、了、的、而、并非、靠、来自、会、如何、怎样’等连接词。不得用同义词替换后改变强度或范围。",
      "事实含有‘有些、也有、若、适当、可能、原始、过去、许多、有的’时，标题必须保留相应限定，不得改成普遍或绝对结论。不得新增目的、好处、比较、比喻、用途或因果。",
      "禁止使用：你知道吗、冷知识、藏着怎样、设计取舍、为什么会被设计成这样、这个细节不是偶然、其实很有讲究。",
      "严格返回一个 json 对象：{\"variants\":[{\"id\":\"contrast\",\"title\":\"...\",\"body\":\"逐字复制的核验事实\",\"angle\":\"一句话说明标题用了原文哪处反差\"},{\"id\":\"action\",...},{\"id\":\"micro\",...}]}。不得返回其他字段。"
    ].join("\n");
  }
  return [
    "你在为手机桌面小组件写一张日常照片知识卡。当前版本被真人评价为无聊。不要写百科说明，要让一个聪明但没耐心的人在两秒内停下来，并在十秒后能复述给朋友。",
    `照片主体：${result.card.objectName}`,
    `唯一允许使用的事实：${result.card.body}`,
    "事实已经核验；不得加入事实中没有的数字、年代、人物、材料、部件、用途、比较、因果、建议或绝对化结论。可以改变句序、使用不改变含义的日常比喻，但比喻不得伪装成新机制。",
    "看图后写三个真正不同的版本：contrast 用反差打破直觉；action 从手正在做的动作切入；micro 放大一个具体部件或瞬间。若事实不支持某种角度，就换成另一种具体角度，不能硬编。",
    "标题 8–20 个汉字，必须直接透露一个具体矛盾、结果或悬念。禁止使用：你知道吗、冷知识、藏着怎样、设计取舍、为什么会被设计成这样、这个细节不是偶然、其实很有讲究。",
    "正文 32–80 个汉字，最多两句。第一句立刻兑现标题，第二句解释机制或意义。不要复述标题，不用‘该物品、这种设计、通过……从而……’的论文腔。",
    "严格返回一个 json 对象：{\"variants\":[{\"id\":\"contrast\",\"title\":\"...\",\"body\":\"...\",\"angle\":\"一句话说明吸引点\"},{\"id\":\"action\",...},{\"id\":\"micro\",...}]}。不得返回其他字段。"
  ].join("\n");
}

function judgePrompt(result, candidates) {
  return [
    "你是由三种读者组成的严格盲评小组，不要因为文案更华丽就偏爱它：",
    "1. 滑动很快的读者：标题是否会让他停两秒；",
    "2. 好奇的朋友：读完是否产生具体的‘原来如此’，十秒后能否复述；",
    "3. 事实编辑：标题和正文是否完全被给定事实支持，并且自然对应照片。",
    `照片主体：${result.card.objectName}`,
    `唯一核验事实：${result.card.body}`,
    `候选：${JSON.stringify(candidates)}`,
    "逐条按 1–5 分评价 factual、photoConnection、stopPower、aha、retellability；textbookPenalty 按 0–5，越像百科、说明书、专利摘要或空泛标题，惩罚越高。factual 只有完全无新增断言才能给 5。",
    "赢家必须 factual=5、photoConnection>=4，且在 stopPower、aha、retellability 上整体最强。只要新版本没有明显超过当前版本，就保留 baseline。禁止奖励夸张和标题党。",
    "严格返回一个 json 对象：{\"ratings\":[{\"id\":\"baseline\",\"factual\":5,\"photoConnection\":4,\"stopPower\":2,\"aha\":3,\"retellability\":3,\"textbookPenalty\":2,\"reason\":\"...\"},...],\"winnerId\":\"contrast\",\"winnerReason\":\"不超过80字\"}。四个候选必须各有且只有一条评分。"
  ].join("\n");
}

function validateVariants(raw, result, currentMode) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).join() !== "variants" || !Array.isArray(raw.variants) || raw.variants.length !== 3) {
    throw new Error("Invalid variants envelope");
  }
  const expected = new Set(["contrast", "action", "micro"]);
  const accepted = [];
  const rejected = [];
  for (const variant of raw.variants) {
    const structurallyValid = variant && typeof variant === "object" && !Array.isArray(variant) &&
      sameKeys(variant, ["angle", "body", "id", "title"]) && expected.delete(variant.id) &&
      typeof variant.title === "string" && variant.title.length >= 8 && variant.title.length <= (currentMode === "extractive-hook" ? 49 : 20) &&
      typeof variant.body === "string" && variant.body.length >= 28 && variant.body.length <= 80 &&
      typeof variant.angle === "string" && variant.angle.length >= 2 && variant.angle.length <= 80 &&
      !/你知道吗|冷知识|藏着怎样|设计取舍|为什么会被设计成这样|这个细节不是偶然|其实很有讲究/.test(variant.title);
    if (!structurallyValid) {
      if (currentMode !== "full-card") {
        rejected.push(`${variant?.id ?? "unknown"}:structural:${JSON.stringify(variant).slice(0, 220)}`);
        continue;
      }
      throw new Error(`Invalid variant: ${JSON.stringify(variant)}`);
    }
    if (currentMode === "title-only") {
      if (variant.body !== result.card.body) {
        rejected.push(`${variant.id}:body_changed`);
        continue;
      }
      try {
        validateGroundedTitle(variant.title, result.card.body, result.card.objectName);
      } catch (error) {
        rejected.push(`${variant.id}:${error.message}`);
        continue;
      }
    } else if (currentMode === "extractive-hook") {
      if (variant.body !== result.card.body) {
        rejected.push(`${variant.id}:body_changed`);
        continue;
      }
      try {
        validateExtractiveTitle(variant.title, result.card.body);
      } catch (error) {
        rejected.push(`${variant.id}:${error.message}`);
        continue;
      }
    }
    accepted.push(variant);
  }
  if (currentMode !== "full-card" && accepted.length === 0) {
    throw new Error(`No grounded title variant survived: ${rejected.join(" | ").slice(0, 700)}`);
  }
  return { variants: accepted };
}

function validateExtractiveTitle(title, fact) {
  const pieces = title.split("｜");
  if (pieces.length !== 2 || pieces.some((piece) => piece.length < 4 || piece.length > 24 || !fact.includes(piece))) {
    throw new Error(`Extractive title is not made of two fact spans: ${title}`);
  }
  for (const marker of requiredScopeMarkers(fact)) {
    if (!title.includes(marker)) throw new Error(`Extractive title drops scope: ${marker}`);
  }
}

function requiredScopeMarkers(fact) {
  return ["有些", "也有", "若", "适当", "可能", "原始", "过去", "许多", "有的"].filter((marker) => fact.includes(marker));
}

function validateGroundedTitle(title, fact, objectName) {
  const allowedConnectors = new Set([
    "为何", "为什么", "原来", "竟然", "其实", "还", "却", "也", "更", "这", "其中", "了", "的", "与", "和", "而",
    "并非", "靠", "来自", "如今", "会", "如何", "怎样", "只", "只是", "能", "可", "非", "不只是", "更是"
  ]);
  const source = `${objectName}${fact}`;
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const invalid = Array.from(segmenter.segment(title)).find(({ segment, isWordLike }) =>
    isWordLike && /\p{Script=Han}/u.test(segment) && !source.includes(segment) && !allowedConnectors.has(segment)
  );
  if (invalid) throw new Error(`Ungrounded title word: ${invalid.segment}`);
  const scopeRules = [
    [["原始"], ["原始", "早期", "第一代"]],
    [["过去", "曾经"], ["过去", "曾经", "早期"]],
    [["有些"], ["有些", "一些", "部分", "可能"]],
    [["也有"], ["也有", "有的", "一种", "部分", "路线"]],
    [["若"], ["若", "如果", "提供", "选项"]],
    [["适当"], ["适当"]]
  ];
  const leading = Array.from(fact).slice(0, 24).join("");
  for (const [factMarkers, titleMarkers] of scopeRules) {
    if (factMarkers.some((marker) => leading.includes(marker)) && !titleMarkers.some((marker) => title.includes(marker))) {
      throw new Error(`Title drops fact scope: ${title}`);
    }
  }
  const factHasNegation = ["不是", "并不", "并非", "不负责", "而是", "没有", "不只"].some((marker) => fact.includes(marker));
  if (["并非", "而非", "不是"].some((marker) => title.includes(marker)) && !factHasNegation) {
    throw new Error(`Title invents negation: ${title}`);
  }
}

function validatePanel(raw, candidateIDs) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !sameKeys(raw, ["ratings", "winnerId", "winnerReason"]) ||
      !Array.isArray(raw.ratings) || raw.ratings.length !== candidateIDs.length || typeof raw.winnerReason !== "string" || raw.winnerReason.length > 160) {
    throw new Error(`Invalid panel envelope: ${JSON.stringify(raw).slice(0, 500)}`);
  }
  const expected = new Set(candidateIDs);
  for (const rating of raw.ratings) {
    if (!rating || typeof rating !== "object" || Array.isArray(rating) ||
        !sameKeys(rating, ["aha", "factual", "id", "photoConnection", "reason", "retellability", "stopPower", "textbookPenalty"]) ||
        !expected.delete(rating.id) || typeof rating.reason !== "string" || rating.reason.length > 120 ||
        !["factual", "photoConnection", "stopPower", "aha", "retellability"].every((key) => Number.isInteger(rating[key]) && rating[key] >= 1 && rating[key] <= 5) ||
        !Number.isInteger(rating.textbookPenalty) || rating.textbookPenalty < 0 || rating.textbookPenalty > 5) {
      throw new Error(`Invalid rating: ${JSON.stringify(rating)}`);
    }
  }
  if (!candidateIDs.includes(raw.winnerId)) throw new Error("Invalid winner");
  return raw;
}

function passesGate(rating) {
  return Boolean(rating && rating.factual === 5 && rating.photoConnection >= 4 && rating.stopPower >= 4 && rating.aha >= 4 && rating.retellability >= 4 && rating.textbookPenalty <= 1);
}

async function qwenJSON(messages, temperature) {
  const endpoint = `${credentials.openAiCompatible.replace(/\/$/, "")}/chat/completions`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.apiKey}`,
        "content-type": "application/json",
        "X-DashScope-DataInspection": "{\"input\":\"cip\",\"output\":\"cip\"}"
      },
      body: JSON.stringify({
        model,
        messages,
        enable_thinking: false,
        temperature,
        response_format: { type: "json_object" }
      }),
      redirect: "error",
      signal: AbortSignal.timeout(45_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }
      const message = typeof payload.error?.message === "string"
        ? payload.error.message.replaceAll(credentials.apiKey, "[redacted]").slice(0, 300)
        : "unavailable";
      throw new Error(`Qwen HTTP ${response.status}: ${message}`);
    }
    usage.calls += 1;
    usage.inputTokens += payload.usage?.prompt_tokens ?? 0;
    usage.outputTokens += payload.usage?.completion_tokens ?? 0;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Qwen response missing content");
    return JSON.parse(content);
  }
  throw new Error("Qwen retries exhausted");
}

async function validatedQwen(messages, temperature, validator) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const retryMessages = attempt === 0
      ? messages
      : [...messages, { role: "user", content: `上一次输出未通过严格 Schema：${String(lastError?.message).slice(0, 240)}。请重新检查并只返回完全符合要求的 json。` }];
    try {
      return validator(await qwenJSON(retryMessages, temperature));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function sameKeys(value, keys) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function requiredPath(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return path.resolve(args[index + 1]);
}

function value(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function readOptionalJSON(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
