import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));
const regressions = await read("evaluation/editorial-regressions-v327.json");
const controls = await read("evaluation/editorial-calibration-v328.json");
const expectedObjects = {
  "web-009.jpg": "盛有米饭的电饭煲，不能仅凭外观确认磁控子类型",
  "web-021.jpg": "皂液器及泵头，不能从外部确认内部阀门结构",
  "web-049.jpg": "浮在水面的小钢制回形针",
  "web-033.jpg": "带锅盖的分隔锅，一侧有带孔沥水结构"
};
const results = [];
const mapping = [];
function add(id, expectedDisplayName, card, origin) {
  const cardId = createHash("sha256").update(JSON.stringify({ expectedDisplayName, title: card.title, body: card.body })).digest("hex").slice(0, 16);
  results.push({ status: "ready", expectedDisplayName, card: { cardId, detectedObjectName: card.detectedObjectName, title: card.title, body: card.body, sources: card.sources } });
  mapping.push({ cardId, localCaseID: id, origin });
}
for (const c of regressions.cases.filter(c => c.pipelineReady)) {
  const file = `.tooling/release-audit-v326/public-cold-path-pilot-${c.run}.json`;
  const report = await read(file);
  const result = report.results.find(r => r.fileName === c.photo && r.card?.title === c.title);
  if (!result?.card?.sources?.length || result.card.body !== c.body) throw new Error(`Draft/evidence mismatch: ${c.id}`);
  add(c.id, expectedObjects[c.photo], result.card, { kind: "actual-pilot-draft", file, photo: c.photo });
}
for (const c of controls.cases) {
  add(c.id, c.objectName, { ...c, detectedObjectName: c.objectName }, { kind: "Codex-authored-control-not-generated-photo-card", file: "evaluation/editorial-calibration-v328.json" });
}
results.sort((a, b) => a.card.cardId.localeCompare(b.card.cardId));
const directory = path.join(root, ".tooling/editorial-review-v329");
await mkdir(directory, { recursive: true, mode: 0o700 });
const fixture = {
  purpose: "Text-only anonymous diagnostic, NOT the 60-photo release benchmark or a photo recognition test. Source snippets include model extraction and explicit Codex paraphrases; judges cannot establish URL accessibility or full-source truth from these alone.",
  results
};
await writeFile(path.join(directory, "input.json"), JSON.stringify(fixture, null, 2), { flag: "wx", mode: 0o600 });
await writeFile(path.join(directory, "local-mapping.json"), JSON.stringify({ mapping, excluded: { "action-order": "Rejected before card publication. Original candidate survives, but the complete paired evidence set was not retained; do not substitute evidence from another draft." } }, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ cards: results.length, actualDrafts: 6, authoredControls: 3, excludedUnpairedEvidence: 1 }));
