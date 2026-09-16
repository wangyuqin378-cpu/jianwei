import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const panelFiles = values("--panel").map((value) => path.resolve(value));
const outputFile = path.resolve(requiredValue("--output"));
const requestedFactIds = new Set((optionalValue("--fact-ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
if (panelFiles.length < 3) throw new Error("Catalog card stability requires at least three --panel files");

const panels = await Promise.all(panelFiles.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
for (const panel of panels) {
  if (panel.scope !== "all-cards" || panel.summary?.calibrationPassed !== true) {
    throw new Error("Every catalog quality panel must use all-cards scope and pass calibration");
  }
}

const allExpected = panels[0].cards.map((card) => card.cardId).sort();
if (!panels.every((panel) => JSON.stringify(panel.cards.map((card) => card.cardId).sort()) === JSON.stringify(allExpected))) {
  throw new Error("Catalog quality panels do not contain the same cards");
}
const expected = requestedFactIds.size === 0
  ? allExpected
  : allExpected.filter((cardId) => requestedFactIds.has(cardId.replace(/^catalog:/, "")));
if (requestedFactIds.size > 0 && expected.length !== requestedFactIds.size) {
  throw new Error("One or more requested fact IDs are absent from the quality panels");
}

const cards = expected.map((cardId) => {
  const trials = panels.map((panel) => panel.cards.find((card) => card.cardId === cardId));
  const factId = cardId.startsWith("catalog:") ? cardId.slice("catalog:".length) : cardId;
  const passedTrials = trials.filter((trial) => trial.passed).length;
  return {
    cardId,
    factId,
    passedTrials,
    stable: passedTrials === panels.length,
    trials: trials.map((trial, index) => ({
      panelFile: panelFiles[index],
      passed: trial.passed,
      medians: trial.medians,
      hardIssues: trial.hardIssues
    }))
  };
});

const report = {
  schemaVersion: 1,
  evidenceKind: "legacy-single-model-copy-stability",
  releaseEligible: false,
  caveat: "Catalog IDs and role-conditioned copy scores do not prove current source support or independent-provider approval. Not accepted for seeding.",
  generatedAt: new Date().toISOString(),
  policy: {
    minimumTrials: 3,
    requireEveryTrialPassed: true,
    requireEveryCalibrationPassed: true,
    requireZeroHardIssues: true
  },
  passed: cards.length > 0 && cards.every((card) => card.stable),
  trialCount: panels.length,
  stableFactIds: cards.filter((card) => card.stable).map((card) => card.factId),
  cards
};
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx"
});
process.stdout.write(`CATALOG_CARD_STABILITY=${report.passed ? "PASS" : "FAIL"} trials=${panels.length} stable=${report.stableFactIds.length}/${cards.length} facts=${report.stableFactIds.join(",")}\n`);
if (!report.passed) process.exitCode = 1;

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

function optionalValue(flag) {
  return values(flag)[0] ?? null;
}
