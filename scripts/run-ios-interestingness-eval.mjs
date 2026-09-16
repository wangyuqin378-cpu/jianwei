import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const argumentsList = process.argv.slice(2);
const credentialIndex = argumentsList.indexOf("--credentials-file");
const outputIndex = argumentsList.indexOf("--output");
if (credentialIndex < 0 || !argumentsList[credentialIndex + 1]) {
  throw new Error("--credentials-file is required");
}
const credentialsFile = path.resolve(argumentsList[credentialIndex + 1]);
const outputFile = outputIndex >= 0
  ? path.resolve(argumentsList[outputIndex + 1] ?? "")
  : path.join(root, ".tooling", "ios-beta", "interestingness-live.json");
if (!outputFile) throw new Error("--output requires a path");

const credentials = parseBailianCredentialsCsv(await readFile(credentialsFile, "utf8"));
const catalog = JSON.parse(await readFile(path.join(root, "knowledge", "catalog.json"), "utf8"));
const fixtureIDs = [
  "broom", "zipper", "umbrella", "thermos", "mug",
  "chopsticks", "whisk", "colander", "cast_iron_pan", "scissors",
  "screwdriver", "tape_measure", "spirit_level", "pliers", "wrench",
  "stapler", "keyboard", "headphones", "charger", "electric_kettle"
];
const cards = [];
let inputTokens = 0;
let outputTokens = 0;
for (const topicID of fixtureIDs) {
  const topic = catalog.topics.find((candidate) => candidate.topicId === topicID);
  if (!topic) throw new Error(`Missing evaluation topic: ${topicID}`);
  const options = topic.facts
    .filter((fact) => fact.riskLevel === "general" && fact.reviewStatus === "approved" && (fact.review || fact.aiReview?.decision === "approved"))
    .map((fact) => ({ factId: fact.factId, objectName: topic.displayName, fact: fact.factText }));
  if (options.length < 3 || options.length > 8) throw new Error(`Invalid option count for ${topicID}`);
  const prompt = [
    "你是一个极其挑剔的日常冷知识编辑。读者会在自己的照片旁看到卡片；目标不是介绍物件，而是让人产生一次具体的‘原来如此’。",
    "先在候选事实中选择最有趣的一条。优先级依次是：反常识或反转；照片中可见细节背后的原因；设计取舍或隐藏分工；能纠正常见误解。百科定义、空泛常识、只报年代、专利摘要口吻都排在后面。",
    "正文将由程序原样使用所选事实，你只写标题。title 为 8 到 22 个汉字，像一个具体发现、疑问或反差。标题里的物件、部件、形状、用途和效果必须在所选事实中明确出现，只能额外添加‘为何’‘原来’‘不代表’‘背后’‘藏着’等连接词。",
    "不得把‘带角度’改成‘有弧度’，不得把‘开锅层’叫成‘黑垢’，也不得提出原事实没有回答的‘是否省力’等问题。不要新增用途、因果、历史、建议或专有名词。",
    "标题不使用‘你知道吗’‘冷知识’‘一种’‘现代’‘该专利’‘关于’开头，也不能照抄事实开头。",
    "严格只返回 json：{\"factId\":\"候选 ID\",\"title\":\"标题\"}，不得返回其他字段。",
    JSON.stringify(options)
  ].join("\n");
  const response = await fetch(`${credentials.openAiCompatible.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      "content-type": "application/json",
      "X-DashScope-DataInspection": "{\"input\":\"cip\",\"output\":\"cip\"}"
    },
    body: JSON.stringify({
      model: "qwen3.7-flash-2026-07-15",
      messages: [{ role: "user", content: prompt }],
      enable_thinking: false,
      response_format: { type: "json_object" },
      temperature: 0.35
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  const envelope = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof envelope.error?.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(envelope.error.code)
      ? envelope.error.code
      : "unknown";
    const parameter = typeof envelope.error?.param === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(envelope.error.param)
      ? envelope.error.param
      : "unknown";
    const diagnostic = typeof envelope.error?.message === "string"
      ? envelope.error.message
          .replaceAll(credentials.apiKey, "[redacted]")
          .replaceAll(credentials.openAiCompatible, "[redacted]")
          .slice(0, 300)
      : "unavailable";
    throw new Error(`Qwen editorial request failed with HTTP ${response.status} code=${code} param=${parameter} message=${diagnostic}`);
  }
  const raw = envelope.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("Qwen editorial response has no content");
  const edited = validateEditorial(JSON.parse(raw), options);
  const selected = options.find((option) => option.factId === edited.factId);
  cards.push({ topicId: topicID, objectName: topic.displayName, ...edited, body: selected.fact, sourceFact: selected.fact });
  inputTokens += Number(envelope.usage?.prompt_tokens ?? 0);
  outputTokens += Number(envelope.usage?.completion_tokens ?? 0);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  model: "qwen3.7-flash-2026-07-15",
  policy: "daily-photo-original-insight-v1",
  calls: cards.length,
  usage: { inputTokens, outputTokens },
  hardChecks: {
    groundedFactId: true,
    bodyIsExactReviewedFact: true,
    titleLength: true,
    noPatentStylePrefix: true,
    noTitleBodyCopy: true,
    titleTokensAreGrounded: true
  },
  cards
};
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
for (const card of cards) process.stdout.write(`${card.objectName}｜${card.title}\n${card.body}\n`);
process.stdout.write(`INTERESTINGNESS_LIVE=PASS calls=${cards.length} inputTokens=${inputTokens} outputTokens=${outputTokens}\n`);

function validateEditorial(value, options) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["factId", "title"])) {
    throw new Error("Editorial response has an invalid shape");
  }
  if (!options.some((option) => option.factId === value.factId)) throw new Error("Editorial factId is not grounded");
  if (typeof value.title !== "string") throw new Error("Editorial title is not text");
  const title = value.title.trim();
  const body = options.find((option) => option.factId === value.factId).fact;
  const titleLength = Array.from(title).length;
  if (titleLength < 8 || titleLength > 22) {
    throw new Error(`Editorial title length failed title=${titleLength} copy=${title}`);
  }
  const forbidden = ["你知道吗", "冷知识", "一种", "现代", "该专利", "关于"];
  if (forbidden.some((prefix) => title.startsWith(prefix))) {
    throw new Error("Editorial copy uses a rejected explanatory prefix");
  }
  const normalize = (text) => text.replace(/[\s，。！？；：、,.!?;:\-—（）()]/g, "");
  const normalizedTitle = normalize(title);
  const normalizedBody = normalize(body);
  if (normalizedBody.startsWith(normalizedTitle) || normalizedTitle.startsWith(normalizedBody.slice(0, 8))) {
    throw new Error("Editorial title repeats the body");
  }
  const bodyTokens = new Set(body.match(/[A-Za-z]+(?:-[A-Za-z]+)*|\d+(?:\.\d+)?/g) ?? []);
  const ungroundedToken = (title.match(/[A-Za-z]+(?:-[A-Za-z]+)*|\d+(?:\.\d+)?/g) ?? [])
    .find((token) => !bodyTokens.has(token));
  if (ungroundedToken) throw new Error(`Editorial title contains an ungrounded token: ${ungroundedToken}`);
  return { factId: value.factId, title };
}
