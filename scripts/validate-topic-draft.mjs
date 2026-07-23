import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadTopicBacklog, makeValidatorFixture, validateTopicDraft } from "./lib/topic-draft.mjs";

const { backlogById } = await loadTopicBacklog();

if (process.argv.includes("--self-test")) {
  const fixture = makeValidatorFixture();
  validateTopicDraft(fixture, backlogById);
  expectFailure({ ...fixture, facts: [{ ...fixture.facts[0], reviewStatus: "approved" }, ...fixture.facts.slice(1)] });
  expectFailure({
    ...fixture,
    facts: [{ ...fixture.facts[0], riskLevel: "health" }, ...fixture.facts.slice(1)]
  });
  expectFailure({ ...fixture, aliases: [fixture.displayName, fixture.displayName] });
  const extension = { ...fixture, intakeMode: "extend", facts: fixture.facts.slice(0, 2) };
  validateTopicDraft(extension, backlogById);
  expectFailure({ ...extension, facts: extension.facts.slice(0, 1) });
  expectFailure({
    ...fixture,
    sources: [{ ...fixture.sources[0], url: "https://127.0.0.1/source" }]
  });
  process.stdout.write(
    "TOPIC_DRAFT_VALIDATOR_GATE=GO selfTest=1 approvedFactsRejected=1 riskySingleSourceRejected=1 duplicateAliasesRejected=1 privateSourcesRejected=1 minimalExtension=1 extensionUnderfillRejected=1\n"
  );
  process.exit(0);
}

const fileArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!fileArgument) throw new Error("Usage: node scripts/validate-topic-draft.mjs <draft.json> or --self-test");
const draftPath = path.resolve(process.cwd(), fileArgument);
const draft = JSON.parse(await readFile(draftPath, "utf8"));
validateTopicDraft(draft, backlogById);
process.stdout.write(`TOPIC_DRAFT_GATE=GO topic=${draft.topicId} facts=${draft.facts.length} mode=${draft.intakeMode ?? "new"} origin=${draft.origin} productionApproved=0\n`);

function expectFailure(value) {
  let failed = false;
  try {
    validateTopicDraft(value, backlogById);
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("Validator self-test expected a rejection");
}
