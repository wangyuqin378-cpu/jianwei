import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const runValues = values("--run");
const outputFile = requiredValue("--output");
if (runValues.length < 3) throw new Error("Stability gate requires at least three --run eval.json,panel.json pairs");

const runs = [];
for (const value of runValues) {
  const [evalPath, panelPath, extra] = value.split(",");
  if (!evalPath || !panelPath || extra) throw new Error("Each --run must be eval.json,panel.json");
  const evaluation = JSON.parse(await readFile(path.resolve(evalPath), "utf8"));
  const panel = JSON.parse(await readFile(path.resolve(panelPath), "utf8"));
  const resultByName = new Map(evaluation.results.map((result) => [result.fileName, result]));
  const winners = evaluation.dailyGroups.map((group) => {
    const result = resultByName.get(group.winnerFileName);
    if (!group.winnerFileName) return null;
    if (!result?.card) throw new Error(`Missing winner card in ${evalPath}: ${group.winnerFileName}`);
    return {
      fileName: result.fileName,
      factId: result.card.factId,
      title: result.card.title,
      body: result.card.body
    };
  });
  const reusedJudges = evaluation.results.filter((result) => result.judgeReused).length;
  const minimumChoiceGroups = Math.ceil(evaluation.metrics.dailyPhotoGroups * 0.6);
  const evaluationPassed = evaluation.metrics.hardFailures === 0 &&
    evaluation.metrics.dailyCoverageRate === 1 &&
    evaluation.metrics.dailyWinnerMeetsMinimumScore === evaluation.metrics.dailyGroupsWithCard &&
    evaluation.metrics.fallbackDailyGroups === 0 &&
    evaluation.metrics.dailyGroupsWithChoice >= minimumChoiceGroups &&
    reusedJudges === 0;
  const panelPassed = panel.summary.hardIssues === 0 && panel.summary.calibrationPassed === true &&
    panel.summary.cards === panel.summary.passed && panel.cards.every((card) => card.passed === true);
  runs.push({
    evaluationFile: path.resolve(evalPath),
    panelFile: path.resolve(panelPath),
    evaluationPassed,
    panelPassed,
    metrics: evaluation.metrics,
    panelSummary: panel.summary,
    reusedJudges,
    minimumChoiceGroups,
    winners
  });
}

const expectedWinners = JSON.stringify(runs[0].winners);
const identicalWinners = runs.every((run) => JSON.stringify(run.winners) === expectedWinners);
const passed = identicalWinners && runs.every((run) => run.evaluationPassed && run.panelPassed);
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  gate: {
    minimumRuns: 3,
    requireIdenticalWinners: true,
    requireWinnerMinimumScore: true,
    requireDailyCoverage: true,
    requireChoiceOnSixtyPercentOfDays: true,
    forbidFallbackBatches: true,
    forbidReusedJudges: true,
    requireAllPanelCards: true,
    requireLowInterestAndHardIssueCalibration: true,
    requireZeroHardIssues: true
  },
  passed,
  identicalWinners,
  runs
};
await writeFile(path.resolve(outputFile), `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx"
});
process.stdout.write(`PHOTO_CARD_STABILITY=${passed ? "PASS" : "FAIL"} runs=${runs.length} winners=${runs[0].winners.length} identical=${identicalWinners}\n`);
if (!passed) process.exitCode = 1;

function values(flag) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) output.push(args[index + 1]);
  }
  return output;
}

function requiredValue(flag) {
  const value = values(flag)[0];
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
