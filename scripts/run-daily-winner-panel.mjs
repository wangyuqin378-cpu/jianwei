import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";

const args = process.argv.slice(2);
const panelModel = optionalValue("--model") ?? "qwen3.7-plus-2026-05-26";
const credentialFile = requiredPath("--credentials-file");
const reportFile = requiredPath("--report");
const outputFile = requiredPath("--output");
const scope = optionalValue("--scope") ?? "winners";
if (!["winners", "all-cards"].includes(scope)) throw new Error("--scope must be winners or all-cards");
const batchSize = Number(optionalValue("--batch-size") ?? 3);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 3) throw new Error("--batch-size must be an integer from 1 to 3");
const credentials = parseBailianCredentialsCsv(await readFile(credentialFile, "utf8"));
const report = JSON.parse(await readFile(reportFile, "utf8"));
if (report.evidenceKind === "source-bound-catalog-review-candidates") {
  throw new Error("Use run-three-model-blind-review.mjs for source-bound catalog cards; this legacy panel compares copy to catalog summaries only");
}
const catalog = JSON.parse(await readFile(path.resolve("knowledge/catalog.json"), "utf8"));
const factsById = new Map(catalog.topics.flatMap((topic) =>
  topic.facts.map((fact) => [fact.factId, { topicId: topic.topicId, factText: fact.factText }])
));
const resultByName = new Map(report.results.map((result) => [result.fileName, result]));
const reviewResults = scope === "all-cards"
  ? report.results.filter((result) => result.card)
  : report.dailyGroups.flatMap((group) => group.winnerFileName ? [resultByName.get(group.winnerFileName)] : []);
const winners = reviewResults.flatMap((result) => {
  const catalogFact = factsById.get(result?.card?.factId);
  const sourceFact = catalogFact?.factText ?? result?.card?.sourceFact;
  if (!result?.card || typeof sourceFact !== "string" || sourceFact.trim().length === 0) {
    throw new Error(`Missing review card or source fact: ${result?.fileName ?? "unknown"}`);
  }
  return [{
    cardId: result.card.cardId,
    fileName: result.fileName,
    objectName: result.card.objectName,
    title: result.card.title,
    body: result.card.body,
    sourceFact
  }];
});
if (winners.length === 0) throw new Error("Winner panel requires at least one daily winner");
const lowInterestControls = [
  {
    cardId: "sample-7f31",
    fileName: "sample-007.jpg",
    objectName: "扫帚",
    title: "扫帚是用来清扫地面的工具",
    body: "扫帚通常由刷毛和把手组成。人握住把手移动刷毛，就能把地面的灰尘聚拢起来。",
    sourceFact: "扫帚是一种用于清扫地面的日常工具。"
  },
  {
    cardId: "sample-c842",
    fileName: "sample-019.jpg",
    objectName: "U 盘",
    title: "USB 接口采用差分信号传输",
    body: "USB 通过 D+ 与 D− 导线形成差分对，并按照相关协议完成数据通信，这种设计被许多外设使用。",
    sourceFact: "USB 使用 D+ 与 D− 差分数据线传输信号。"
  }
];
const hardIssueControls = [
  {
    cardId: "sample-21ad",
    fileName: "sample-004.jpg",
    objectName: "鼠标",
    title: "鼠标每秒都会给桌面拍 6000 多张照片",
    body: "所有光学鼠标都会以每秒 6000 多张的速度拍摄桌面，再比较前后图像来判断移动方向。",
    sourceFact: "Logitech 的资料显示，其部分鼠标中的光学传感器每秒会拍摄超过 6000 张快照。"
  },
  {
    cardId: "sample-934e",
    fileName: "sample-016.jpg",
    objectName: "U 盘",
    title: "U 盘的长短触点是为了避免热插拔损坏",
    body: "电源触点先接通、数据触点后接通，因此插拔时能保护 U 盘和电脑不被热插拔损坏。",
    sourceFact: "USB Standard-A 的电源与地线触点先接通，D+、D− 数据触点随后接通；拔出时数据触点先断开。"
  },
  {
    cardId: "sample-b506",
    fileName: "sample-023.jpg",
    objectName: "浇水壶",
    title: "现代浇水壶的顶孔都要用拇指控制",
    body: "现在常见的塑料浇水壶只要堵住顶部气孔就会停水，松开拇指才继续出水。",
    sourceFact: "中世纪的一类陶制浇水壶在顶部设气孔；拇指堵住时水停止流出，松开后水从壶底小孔洒出。"
  },
  {
    cardId: "sample-5f0c",
    fileName: "sample-031.jpg",
    objectName: "衣夹",
    title: "弹簧衣夹的关键不是省力，而是防风",
    body: "旧式衣夹容易被风从衣服上吹落，因此弹簧夹口把衣物和绳子抓得更牢。",
    sourceFact: "1853 年的一项弹簧衣夹专利强调，相比普通衣夹，这种夹子不会被风从衣服上吹落。"
  },
  {
    cardId: "sample-8a42",
    fileName: "sample-032.jpg",
    objectName: "橡皮筋",
    title: "橡皮筋不是模压出来的，而是从长管上切出来的",
    body: "橡胶先制成长管，再横向切成窄环，每一刀就得到一个圈。",
    sourceFact: "橡皮筋通常不是逐个模压出来的：橡胶通常先制成长管，再横向切成许多窄环。"
  }
];
const roles = [
  {
    id: "curious_reader",
    instruction: "你代表每天只愿停留十秒的普通读者。重点判断第一眼是否真想继续读、读完是否愿意转述，而不是知识是否有用。"
  },
  {
    id: "magazine_editor",
    instruction: "你代表严厉的杂志短稿编辑。重点判断反差与解释是否形成完整小故事，语言是否具体、自然，是否像说明书或模型套话。"
  },
  {
    id: "skeptical_fact_editor",
    instruction: "你代表挑剔的事实编辑。重点判断标题有没有夸大，正文是否完整解释标题，表达是否忠于来源且没有靠修辞制造假惊奇。"
  }
];
const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
const panels = [];
for (const role of roles) {
  for (const [batchIndex, winnerBatch] of chunks(winners, batchSize).entries()) {
    const cardsForReview = interleaveBlindly(winnerBatch, [...lowInterestControls, ...hardIssueControls]);
    const messages = [
      {
        role: "user",
        content: [
        "你在盲评一组会真实推送给用户的照片冷知识卡。所有 cardId 和 fileName 都是随机编号，不能据此判断样本性质。不要因为文字正确就给高分，也不要因为主题日常就给低分。",
        role.instruction,
        "四个维度必须独立评分，不得因为知识不够罕见而连带压低可转述性，也不得因为容易复述而抬高惊喜度。",
        "surprise：1=对象定义或人尽皆知；2=普通说明；3=不常注意的具体细节；4=明显反直觉或能改写原有理解；5=极少见且可信的强反差。",
        "aha：1=没有解释；2=只重复标题；3=给出相关原因但链条不完整；4=用一个清楚机制完整回答标题；5=机制既完整又异常简洁。",
        "retellability：先在 oneSentence 中不看原句复述。1=无法说清；2=只剩模糊主题；3=能说结论但丢掉关键机制或具体画面；4=一句话保留对象、反差和关键机制；5=不仅完整，还带有难忘的数字、动作或比喻。若 oneSentence 已保留这三项，却给 3 分或更低，评分自相矛盾。",
        "naturalness：1=不可读；2=明显说明书或模型话术；3=通顺但平；4=具体、克制、像人写；5=几乎无法再删改。",
        "hardIssue 只要存在来源外扩写、范围被偷换、标题正文不一致或表达会让普通人形成错误理解，就必须为 true。不要用常识替来源补证据。",
        "hardIssue 只检查输入中的 title 与 body，不检查你自己写的 oneSentence。若 oneSentence 不慎添加了原卡没有的词，应修正 oneSentence，不能把你自己的新增内容算成卡片 hardIssue。",
        "sourceFact 是唯一允许使用的事实证据。若标题或正文新增了来源没有写出的目的、好处、保护作用或因果，即使听起来合理，也必须 hardIssue=true；若把‘有些、部分、可能、一类、过去’扩大成‘所有、都会、现代、现在常见’，也必须 hardIssue=true。",
        "评分前逐句对照 title、body 与 sourceFact：只要卡片省掉来源中的范围限定，或把先后顺序改写成来源没有声明的设计目的、功效与保障，hardIssue 必须为 true。这个判断优先于文案是否顺口。",
        "特别注意：来源只描述‘A 先发生、B 后发生’，不能推出‘这样设计是为了防止某种损坏或获得某种好处’。即使该目的符合工程常识，只要 sourceFact 没写，卡片补出的目的与保障仍是 hardIssue。",
        "标题使用‘不是 X，而是 Y’时，sourceFact 必须明确提到或排除 X；若 X 只出现在标题里，就是用来源外对比制造反差，hardIssue 必须为 true。",
        "sourceFact 中的‘通常、有些、部分、一类、可能’即使卡片没有改成‘所有’，只要被直接删掉并写成无条件陈述，也属于范围扩大，hardIssue 必须为 true。",
        "校准示例一：sourceFact 只说‘该外壳强调防水’，卡片却写‘关键不是便携，而是防水’，因为来源没有提到或排除‘便携’，所以 hardIssue=true。",
        "校准示例二：sourceFact 说‘某些玻璃会这样制造’，卡片删掉‘某些’并直接写‘玻璃都这样制造’，所以 hardIssue=true。",
        "严格返回 JSON，不得增加字段：{\"reviews\":[{\"cardId\":\"id\",\"oneSentence\":\"不超过60字的一句话复述\",\"surprise\":4,\"aha\":4,\"retellability\":4,\"naturalness\":4,\"hardIssue\":false,\"reason\":\"不超过60字\"}]}。每个 cardId 恰好出现一次。",
          JSON.stringify(cardsForReview)
        ].join("\n")
      }
    ];
    let reviews = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !reviews; attempt += 1) {
      try {
        reviews = applyDeterministicHardIssues(
          validatePanel(await qwenJSON(messages), cardsForReview),
          cardsForReview
        );
      } catch (error) {
        lastError = error;
      }
    }
    if (!reviews) throw lastError;
    panels.push({ role: role.id, batchIndex, reviews });
  }
}

const cards = winners.map((winner) => {
  const reviews = reviewsFor(winner.cardId);
  const medians = Object.fromEntries(["surprise", "aha", "retellability", "naturalness"]
    .map((key) => [key, median(reviews.map((review) => review[key]))]));
  const meanMedian = rounded(Object.values(medians).reduce((sum, score) => sum + score, 0) / 4);
  const hardIssues = reviews.filter((review) => review.hardIssue).length;
  const peakMedian = Math.max(...Object.values(medians));
  const passed = hardIssues === 0 && medians.surprise >= 4 && medians.aha >= 4 &&
    medians.retellability >= 4 && medians.naturalness >= 4;
  return { ...winner, medians, meanMedian, peakMedian, hardIssues, passed, reviews };
});
const lowInterestCalibrationPassed = lowInterestControls.every((control) => {
  const reviews = reviewsFor(control.cardId);
  return median(reviews.map((review) => review.surprise)) <= 2;
});
const hardIssueCalibrationPassed = hardIssueControls.every((control) => {
  const reviews = reviewsFor(control.cardId);
  return reviews.filter((review) => review.hardIssue).length >= Math.ceil(reviews.length * 2 / 3);
});
const calibrationDiagnostics = {
  lowInterest: lowInterestControls.map((control) => {
    const reviews = reviewsFor(control.cardId);
    return {
      cardId: control.cardId,
      surpriseMedian: median(reviews.map((review) => review.surprise)),
      retellabilityMedian: median(reviews.map((review) => review.retellability))
    };
  }),
  hardIssue: hardIssueControls.map((control) => {
    const reviews = reviewsFor(control.cardId);
    return {
      cardId: control.cardId,
      votes: reviews.filter((review) => review.hardIssue).length,
      reasons: reviews.map((review) => review.reason)
    };
  })
};
const summary = {
  cards: cards.length,
  passed: cards.filter((card) => card.passed).length,
  hardIssues: cards.reduce((sum, card) => sum + card.hardIssues, 0),
  meanMedian: rounded(cards.reduce((sum, card) => sum + card.meanMedian, 0) / cards.length),
  calibrationPassed: lowInterestCalibrationPassed && hardIssueCalibrationPassed,
  lowInterestCalibrationPassed,
  hardIssueCalibrationPassed
};
const output = {
  schemaVersion: 2,
  evidenceKind: "legacy-single-model-copy-review",
  releaseEligible: false,
  generatedAt: new Date().toISOString(),
  model: panelModel,
  caveat: "three role-conditioned reviews from the production model; deterministic grounding and multi-run stability remain separate gates",
  sourceReport: reportFile,
  scope,
  roles: roles.map((role) => role.id),
  batchSize,
  batchCount: Math.ceil(winners.length / batchSize),
  usage,
  summary,
  calibrationDiagnostics,
  cards
};
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
for (const card of cards) {
  process.stdout.write(`${card.passed ? "PASS" : "FAIL"} ${card.objectName}｜${card.title} median=${JSON.stringify(card.medians)} hard=${card.hardIssues}\n`);
}
const panelPassed = summary.passed === summary.cards && summary.calibrationPassed;
process.stdout.write(`DAILY_WINNER_PANEL=${panelPassed ? "PASS" : "FAIL"} passed=${summary.passed}/${summary.cards} calibration=${summary.calibrationPassed ? "PASS" : "FAIL"} meanMedian=${summary.meanMedian} calls=${usage.calls}\n`);
if (!panelPassed) process.exitCode = 1;

function reviewsFor(cardId) {
  return panels.flatMap((panel) => {
    const review = panel.reviews.find((candidate) => candidate.cardId === cardId);
    return review ? [review] : [];
  });
}

function applyDeterministicHardIssues(reviews, cards) {
  const byId = new Map(cards.map((card) => [card.cardId, card]));
  return reviews.map((review) => {
    const card = byId.get(review.cardId);
    if (!card) return review;
    const source = card.sourceFact;
    const copy = `${card.title}\n${card.body}`;
    const missingScope = [
      ["通常", "一般", "往往", "常见情况下"],
      ["有些", "部分", "一些", "某些", "一类"],
      ["可能", "有时", "不一定"]
    ].find((group) => group.some((word) => source.includes(word)) && !group.some((word) => copy.includes(word)));
    if (!missingScope) return review;
    const reason = `来源中的范围限定“${missingScope.find((word) => source.includes(word))}”未保留；${review.reason}`;
    return { ...review, hardIssue: true, reason: [...reason].slice(0, 60).join("") };
  });
}

async function qwenJSON(messages) {
  const response = await fetch(`${credentials.openAiCompatible.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      "content-type": "application/json",
      "X-DashScope-DataInspection": "{\"input\":\"cip\",\"output\":\"cip\"}"
    },
    body: JSON.stringify({
      model: panelModel,
      messages,
      enable_thinking: false,
      response_format: { type: "json_object" },
      temperature: 0
    }),
    redirect: "error",
    signal: AbortSignal.timeout(45_000)
  });
  const envelope = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof envelope.error?.message === "string"
      ? envelope.error.message.replaceAll(credentials.apiKey, "[redacted]").slice(0, 300)
      : "unavailable";
    throw new Error(`Qwen panel failed HTTP ${response.status}: ${message}`);
  }
  usage.calls += 1;
  usage.inputTokens += Number(envelope.usage?.prompt_tokens ?? 0);
  usage.outputTokens += Number(envelope.usage?.completion_tokens ?? 0);
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Qwen panel response has no content");
  return JSON.parse(content);
}

function validatePanel(value, expectedCards) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value)) !== JSON.stringify(["reviews"]) || !Array.isArray(value.reviews)) {
    throw new Error("Invalid panel shape");
  }
  const expected = new Set(expectedCards.map((card) => card.cardId));
  if (value.reviews.length !== expected.size) throw new Error("Panel review count differs");
  const seen = new Set();
  for (const review of value.reviews) {
    const keys = ["aha", "cardId", "hardIssue", "naturalness", "oneSentence", "reason", "retellability", "surprise"];
    if (!review || typeof review !== "object" || Array.isArray(review) ||
        JSON.stringify(Object.keys(review).sort()) !== JSON.stringify(keys)) {
      throw new Error(`Invalid panel review shape: ${JSON.stringify(Object.keys(review ?? {}).sort())}`);
    }
    if (!expected.has(review.cardId) || seen.has(review.cardId)) throw new Error("Unexpected or duplicate panel card");
    seen.add(review.cardId);
    for (const key of ["surprise", "aha", "retellability", "naturalness"]) {
      if (!Number.isInteger(review[key]) || review[key] < 1 || review[key] > 5) throw new Error(`Invalid panel score: ${key}`);
    }
    if (typeof review.hardIssue !== "boolean" || typeof review.reason !== "string" ||
        typeof review.oneSentence !== "string" || Array.from(review.reason).length > 120 ||
        Array.from(review.oneSentence).length < 6 || Array.from(review.oneSentence).length > 80) {
      throw new Error("Invalid panel explanation");
    }
  }
  return value.reviews;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function interleaveBlindly(primary, controls) {
  return [...primary, ...controls]
    .map((card) => ({ card, order: stableHash(`panel-v2:${card.cardId}:${card.fileName}`) }))
    .sort((left, right) => left.order - right.order || left.card.cardId.localeCompare(right.card.cardId))
    .map(({ card }) => card);
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const scalar of value) {
    hash ^= scalar.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function requiredPath(flag) {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return path.resolve(value);
}

function optionalValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
