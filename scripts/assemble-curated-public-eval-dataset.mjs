import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const selectionFile = path.resolve(requiredValue("--selection"));
const outputDirectory = path.resolve(requiredValue("--output-dir"));
const selection = JSON.parse(await readFile(selectionFile, "utf8"));
if (!Array.isArray(selection.photos) || selection.photos.length !== 60) {
  throw new Error(`Curated release evaluation requires exactly 60 selections; received ${selection.photos?.length ?? 0}`);
}

const resolved = [];
const pages = new Set();
const hashes = new Set();
for (const item of selection.photos) {
  const sourceDirectory = path.resolve(root, item.sourceDataset);
  const datasetFile = await existingDatasetFile(sourceDirectory);
  const sourceDataset = JSON.parse(await readFile(datasetFile, "utf8"));
  const metadata = sourceDataset.photos?.find((photo) => photo.fileName === item.fileName);
  if (!metadata) throw new Error(`Missing metadata: ${item.sourceDataset}/${item.fileName}`);
  if (metadata.expectedTopicId !== item.topicId) {
    throw new Error(`Topic mismatch for ${item.sourceDataset}/${item.fileName}: ${metadata.expectedTopicId} != ${item.topicId}`);
  }
  const sourcePhoto = path.join(sourceDirectory, "photos", item.fileName);
  const bytes = await readFile(sourcePhoto);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!metadata.commonsPage || pages.has(metadata.commonsPage)) throw new Error(`Duplicate or missing Commons page: ${metadata.commonsPage}`);
  if (hashes.has(hash)) throw new Error(`Duplicate photo bytes: ${item.sourceDataset}/${item.fileName}`);
  pages.add(metadata.commonsPage);
  hashes.add(hash);
  resolved.push({ sourceDirectory, sourcePhoto, metadata, sourceSha256: hash });
}

const topicCounts = new Map();
for (const item of resolved) topicCounts.set(item.metadata.expectedTopicId, (topicCounts.get(item.metadata.expectedTopicId) ?? 0) + 1);
if (topicCounts.size !== 30 || [...topicCounts.values()].some((count) => count !== selection.copiesPerTopic)) {
  throw new Error(`Expected 30 topics with ${selection.copiesPerTopic} photos each; got ${JSON.stringify(Object.fromEntries(topicCounts))}`);
}

await stat(outputDirectory).then(
  () => { throw new Error(`Output directory already exists: ${outputDirectory}`); },
  () => undefined
);
const photosDirectory = path.join(outputDirectory, "photos");
await mkdir(photosDirectory, { recursive: true, mode: 0o700 });
const photos = [];
for (const [index, item] of resolved.entries()) {
  const fileName = `web-${String(index + 1).padStart(3, "0")}.jpg`;
  await copyFile(item.sourcePhoto, path.join(photosDirectory, fileName));
  photos.push({
    ...item.metadata,
    fileName,
    assembledFromDataset: path.relative(root, item.sourceDirectory),
    assembledFromFileName: item.metadata.fileName,
    sourceSha256: item.sourceSha256
  });
}

const manifest = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  source: "Wikimedia Commons API; manually visually audited and deterministically assembled",
  selectionPolicy: "30-stable-topics-two-distinct-public-non-person-photos-each",
  selectionFile: path.relative(root, selectionFile),
  count: photos.length,
  topicCount: topicCounts.size,
  copiesPerTopic: selection.copiesPerTopic,
  topics: Object.fromEntries([...topicCounts].sort(([left], [right]) => left.localeCompare(right))),
  photos
};
await writeFile(path.join(outputDirectory, "dataset.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx"
});
process.stdout.write(`CURATED_PUBLIC_EVAL=PASS photos=${manifest.count} topics=${manifest.topicCount} uniquePages=${pages.size} uniqueHashes=${hashes.size}\n`);

async function existingDatasetFile(directory) {
  for (const name of ["dataset.json", "dataset.checkpoint.json"]) {
    const candidate = path.join(directory, name);
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Continue to the checkpoint fallback.
    }
  }
  throw new Error(`No dataset manifest found in ${directory}`);
}

function requiredValue(flag) {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`${flag} is required`);
  return args[index + 1];
}
