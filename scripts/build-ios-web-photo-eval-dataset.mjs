import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const outputDirectory = path.resolve(required("--output-dir"));
const seed = Number(args.get("--seed") ?? 20260829);
const perCategory = Number(args.get("--per-category") ?? 5);
const requestedTopicIDs = (args.get("--topic-ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const copiesPerTopic = Number(args.get("--copies-per-topic") ?? 1);
const queryOverrides = JSON.parse(args.get("--query-overrides") ?? "{}");
const categoryOverrides = JSON.parse(args.get("--category-overrides") ?? "{}");
const quiet = args.get("--quiet") === "true";
if (!Number.isInteger(seed) || !Number.isInteger(perCategory) || perCategory < 1 || perCategory > 8 ||
    !Number.isInteger(copiesPerTopic) || copiesPerTopic < 1 || copiesPerTopic > 5) {
  throw new Error("seed, per-category, and copies-per-topic must be bounded integers");
}

const catalog = JSON.parse(await readFile(path.join(root, "knowledge", "catalog.json"), "utf8"));
const categories = [...new Set(catalog.topics.map((topic) => topic.category))].sort();
const random = mulberry32(seed);
const requestedTopics = requestedTopicIDs.map((topicID) => {
  const topic = catalog.topics.find((candidate) => candidate.topicId === topicID);
  if (!topic) throw new Error(`Unknown requested topic: ${topicID}`);
  return topic;
});
if (new Set(requestedTopicIDs).size !== requestedTopicIDs.length) throw new Error("Requested topic IDs must be unique");
const sampledTopics = requestedTopics.length > 0
  ? requestedTopics.flatMap((topic) => Array.from({ length: copiesPerTopic }, () => topic))
  : categories.flatMap((category) => {
    const topics = catalog.topics.filter((topic) => topic.category === category);
    return shuffled(topics, random).slice(0, perCategory);
  });

const photosDirectory = path.join(outputDirectory, "photos");
await mkdir(photosDirectory, { recursive: true, mode: 0o700 });
const checkpointPath = path.join(outputDirectory, "dataset.checkpoint.json");
const checkpoint = await readOptionalJSON(checkpointPath);
if (checkpoint && (checkpoint.seed !== seed || checkpoint.copiesPerTopic !== copiesPerTopic ||
    JSON.stringify(checkpoint.topicIDs) !== JSON.stringify(sampledTopics.map((topic) => topic.topicId)) ||
    (checkpoint.queryOverrides && JSON.stringify(checkpoint.queryOverrides) !== JSON.stringify(queryOverrides)) ||
    (checkpoint.categoryOverrides && JSON.stringify(checkpoint.categoryOverrides) !== JSON.stringify(categoryOverrides)))) {
  throw new Error("Dataset checkpoint does not match the requested sample plan");
}
const photos = checkpoint?.photos ?? [];
const selectedPages = new Set(photos.map((photo) => photo.commonsPage));
const candidateCache = new Map();
for (const [index, topic] of sampledTopics.entries()) {
  if (index < photos.length) continue;
  const query = queryOverrides[topic.topicId] ?? englishQuery(topic);
  const commonsCategory = categoryOverrides[topic.topicId];
  const candidateKey = typeof commonsCategory === "string" && commonsCategory.trim()
    ? `category:${commonsCategory.trim()}`
    : `query:${query}`;
  if (!candidateCache.has(candidateKey)) {
    candidateCache.set(candidateKey, typeof commonsCategory === "string" && commonsCategory.trim()
      ? await commonsCategoryCandidates(commonsCategory.trim())
      : await commonsCandidates(query));
  }
  const candidates = candidateCache.get(candidateKey);
  if (candidates.length === 0) throw new Error(`No Commons photo found for ${topic.topicId} query=${query}`);
  let selected = null;
  for (const candidate of shuffled(candidates, random)) {
    if (selectedPages.has(candidate.pageUrl)) continue;
    try {
      const response = await fetchWithRetry(candidate.downloadUrl, {
        headers: { "user-agent": "JianweiPhotoTriviaEvaluation/1.0 (local product evaluation)" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/") || bytes.length < 10_000 || bytes.length > 12 * 1024 * 1024) continue;
      selected = { candidate, bytes };
      selectedPages.add(candidate.pageUrl);
      break;
    } catch {
      // One broken Commons thumbnail must not invalidate the complete seeded batch.
    }
  }
  if (!selected) throw new Error(`No downloadable Commons photo found for ${topic.topicId} query=${query}`);
  const { candidate, bytes } = selected;
  const fileName = `web-${String(index + 1).padStart(3, "0")}.jpg`;
  const filePath = path.join(photosDirectory, fileName);
  await writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
  photos.push({
    fileName,
    expectedTopicId: topic.topicId,
    expectedDisplayName: topic.displayName,
    category: topic.category,
    query,
    commonsCategory: typeof commonsCategory === "string" ? commonsCategory : null,
    commonsTitle: candidate.title,
    commonsPage: candidate.pageUrl,
    downloadUrl: candidate.downloadUrl,
    creator: candidate.creator,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    originalWidth: candidate.width,
    originalHeight: candidate.height,
    downloadedBytes: bytes.length
  });
  await writeFile(checkpointPath, `${JSON.stringify({
    schemaVersion: 1,
    seed,
    copiesPerTopic,
    queryOverrides,
    categoryOverrides,
    topicIDs: sampledTopics.map((item) => item.topicId),
    photos
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (!quiet) process.stdout.write(`${fileName} ${topic.category}/${topic.displayName} <- ${candidate.title}\n`);
  await delay(650);
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "Wikimedia Commons API",
  selectionPolicy: requestedTopics.length > 0
    ? "explicit-topics-with-seeded-random-distinct-commons-photos"
    : "seeded-random-five-topics-per-catalog-category-and-seeded-random-photo-per-topic",
  seed,
  perCategory,
  count: photos.length,
  photos
};
await writeFile(path.join(outputDirectory, "dataset.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx"
});
await unlink(checkpointPath).catch(() => undefined);
process.stdout.write(`WEB_PHOTO_DATASET=PASS photos=${photos.length} categories=${categories.length} seed=${seed}\n`);

async function commonsCandidates(query) {
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  const parameters = {
    action: "query",
    generator: "search",
    gsrsearch: `intitle:${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "24",
    prop: "imageinfo|info",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "1280",
    inprop: "url",
    format: "json",
    formatversion: "2",
    origin: "*"
  };
  for (const [key, value] of Object.entries(parameters)) endpoint.searchParams.set(key, value);
  const response = await fetchWithRetry(endpoint, {
    headers: { "user-agent": "JianweiPhotoTriviaEvaluation/1.0 (local product evaluation)" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Commons API failed HTTP ${response.status}`);
  const payload = await response.json();
  const rejectedTitle = /\b(svg|logo|icon|map|diagram|drawing|illustration|poster|flag|coat of arms|layout|schematic|chart|floor plan)\b/i;
  return (payload.query?.pages ?? []).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info || !["image/jpeg", "image/png"].includes(info.mime) ||
        Math.max(info.width ?? 0, info.height ?? 0) < 700 || rejectedTitle.test(page.title ?? "")) return [];
    const metadata = info.extmetadata ?? {};
    return [{
      title: page.title,
      pageUrl: page.canonicalurl ?? info.descriptionurl,
      downloadUrl: info.thumburl ?? info.url,
      width: info.width,
      height: info.height,
      creator: plain(metadata.Artist?.value ?? metadata.Credit?.value ?? "unknown"),
      license: plain(metadata.LicenseShortName?.value ?? metadata.UsageTerms?.value ?? "unknown"),
      licenseUrl: metadata.LicenseUrl?.value ?? null
    }];
  }).sort((left, right) => left.title.localeCompare(right.title));
}

async function commonsCategoryCandidates(category) {
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  const parameters = {
    action: "query",
    generator: "categorymembers",
    gcmtitle: `Category:${category}`,
    gcmtype: "file",
    gcmlimit: "100",
    prop: "imageinfo|info",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "1280",
    inprop: "url",
    format: "json",
    formatversion: "2",
    origin: "*"
  };
  for (const [key, value] of Object.entries(parameters)) endpoint.searchParams.set(key, value);
  const response = await fetchWithRetry(endpoint, {
    headers: { "user-agent": "JianweiPhotoTriviaEvaluation/1.0 (local product evaluation)" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Commons API failed HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeCommonsPages(payload.query?.pages ?? []);
}

function normalizeCommonsPages(pages) {
  const rejectedTitle = /\b(svg|logo|icon|map|diagram|drawing|illustration|poster|flag|coat of arms|layout|schematic|chart|floor plan|book|scan|painting|artwork)\b/i;
  return pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info || !["image/jpeg", "image/png"].includes(info.mime) ||
        Math.max(info.width ?? 0, info.height ?? 0) < 700 || rejectedTitle.test(page.title ?? "")) return [];
    const metadata = info.extmetadata ?? {};
    return [{
      title: page.title,
      pageUrl: page.canonicalurl ?? info.descriptionurl,
      downloadUrl: info.thumburl ?? info.url,
      width: info.width,
      height: info.height,
      creator: plain(metadata.Artist?.value ?? metadata.Credit?.value ?? "unknown"),
      license: plain(metadata.LicenseShortName?.value ?? metadata.UsageTerms?.value ?? "unknown"),
      licenseUrl: metadata.LicenseUrl?.value ?? null
    }];
  }).sort((left, right) => left.title.localeCompare(right.title));
}

async function fetchWithRetry(url, options) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { signal: _discardedSignal, ...requestOptions } = options;
      const response = await fetch(url, { ...requestOptions, signal: AbortSignal.timeout(30_000) });
      if (![429, 502, 503, 504].includes(response.status) || attempt === 4) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      const fallbackDelay = response.status === 429 ? 15_000 * (attempt + 1) : 1_000 * (attempt + 1);
      await delay(Number.isFinite(retryAfter) ? Math.min(60_000, retryAfter * 1_000) : fallbackDelay);
    } catch (error) {
      if (attempt === 4) throw error;
      await delay(1_000 * (attempt + 1));
    }
  }
  throw new Error("unreachable retry state");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function englishQuery(topic) {
  const latin = topic.synonyms.find((value) => /^[A-Za-z0-9][A-Za-z0-9 -]{2,60}$/.test(value));
  return (latin ?? topic.topicId.replaceAll("_", " ")).trim();
}

function plain(value) {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function shuffled(values, random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function mulberry32(seedValue) {
  let state = seedValue >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function required(flag) {
  const value = args.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

async function readOptionalJSON(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
