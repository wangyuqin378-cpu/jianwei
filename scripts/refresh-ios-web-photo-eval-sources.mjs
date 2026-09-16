import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const input = requiredPath("--input");
const output = requiredPath("--output");
const catalogPath = path.resolve("knowledge/catalog.json");
const report = JSON.parse(await readFile(input, "utf8"));
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

const sources = new Map(catalog.sources.map((source) => [source.sourceId, source]));
const facts = new Map();
for (const topic of catalog.topics) {
  for (const fact of topic.facts) {
    if (facts.has(fact.factId)) throw new Error(`Duplicate fact: ${fact.factId}`);
    facts.set(fact.factId, { ...fact, catalogTopicId: topic.topicId });
  }
}

let checked = 0;
for (const result of report.results) {
  if (!result.card) continue;
  const fact = facts.get(result.card.factId);
  if (!fact || fact.catalogTopicId !== result.card.topicId || fact.topicId !== result.card.topicId) {
    throw new Error(`Card fact binding is invalid: ${result.fileName}`);
  }
  const boundSources = fact.sourceIds.map((sourceId) => {
    const source = sources.get(sourceId);
    if (!source || !source.url.startsWith("https://")) {
      throw new Error(`Card source binding is invalid: ${result.fileName}:${sourceId}`);
    }
    return {
      id: source.sourceId,
      title: source.title,
      url: source.url,
      publisher: source.publisher,
      authority: source.authority
    };
  });
  if (boundSources.length === 0) throw new Error(`Card has no source: ${result.fileName}`);
  result.card.sources = boundSources;
  checked += 1;
}

const previousDailyGroups = report.dailyGroups ?? [];
const eligible = report.results.filter((result) => result.detection);
const dailyGroups = [];
for (let index = 0; index < eligible.length;) {
  const primaryGroup = eligible.slice(index, index + 3);
  const primaryPublishable = primaryGroup.filter((result) => result.card && result.judge?.cardMatchesImage);
  const fallbackGroup = primaryPublishable.length === 0
    ? eligible.slice(index + primaryGroup.length, index + primaryGroup.length + 3)
    : [];
  const photoGroup = [...primaryGroup, ...fallbackGroup];
  const usedFallbackBatch = fallbackGroup.length > 0;
  index += photoGroup.length;
  const publishable = photoGroup.filter((result) => result.card && result.judge?.cardMatchesImage);
  let winner = null;
  let reason = usedFallbackBatch
    ? "首批与兜底批共六张照片均未通过发布校验。"
    : "三张候选均未通过识别、事实匹配与发布校验。";
  let status = "no_card";
  if (publishable.length === 1) {
    winner = publishable[0];
    reason = usedFallbackBatch
      ? "首批无命中，兜底三张中只有这一条通过全部发布校验。"
      : "三张照片中只有这一条通过全部发布校验。";
    status = "single_publishable";
  } else if (publishable.length > 1) {
    const publishableNames = new Set(publishable.map((result) => result.fileName));
    const reusableSelection = previousDailyGroups.find((group) =>
      group.winnerFileName && publishableNames.has(group.winnerFileName) &&
      publishable.every((result) => group.candidateFileNames?.includes(result.fileName))
    );
    if (!reusableSelection) {
      throw new Error(`No reusable AI selection for photo group starting at ${photoGroup[0].fileName}`);
    }
    winner = publishable.find((result) => result.fileName === reusableSelection.winnerFileName);
    reason = reusableSelection.reason;
    status = "ai_selection_reused";
  }
  dailyGroups.push({
    photoFileNames: photoGroup.map((result) => result.fileName),
    candidateFileNames: publishable.map((result) => result.fileName),
    usedFallbackBatch,
    status,
    cardId: winner?.card.cardId ?? null,
    reason,
    winnerFileName: winner?.fileName ?? null
  });
}

report.schemaVersion = Math.max(2, report.schemaVersion ?? 1);
report.generatedAt = new Date().toISOString();
report.derivedFrom = path.resolve(input);
report.policy = `${report.policy}+catalog-source-refresh-v1`;
report.metrics.sourceBindingsChecked = checked;
report.metrics.sourceBindingFailures = 0;
report.metrics.dailyPhotoGroups = dailyGroups.length;
report.metrics.dailyGroupsWithCard = dailyGroups.filter((group) => group.winnerFileName).length;
report.metrics.dailyGroupsWithChoice = dailyGroups.filter((group) => group.candidateFileNames.length >= 2).length;
report.metrics.fallbackDailyGroups = dailyGroups.filter((group) => group.usedFallbackBatch).length;
report.metrics.dailyPhotosAnalyzed = dailyGroups.reduce((sum, group) => sum + group.photoFileNames.length, 0);
report.metrics.dailyCoverageRate = dailyGroups.length
  ? Math.round((dailyGroups.filter((group) => group.winnerFileName).length / dailyGroups.length) * 100) / 100
  : 0;
report.dailyGroups = dailyGroups;

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`SOURCE_BINDING_REFRESH=PASS cards=${checked} output=${path.resolve(output)}\n`);

function requiredPath(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return path.resolve(args[index + 1]);
}
