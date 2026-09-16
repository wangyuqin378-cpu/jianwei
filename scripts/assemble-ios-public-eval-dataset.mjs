import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const outputDirectory = path.resolve(requiredValue("--output-dir"));
const perCategory = Number(optionalValue("--per-category") ?? 10);
const perTopic = optionalValue("--per-topic") == null ? null : Number(optionalValue("--per-topic"));
const requireTitleMatch = optionalValue("--require-title-match") === "true";
const inputs = repeatedValues("--input");
if (!Number.isInteger(perCategory) || perCategory < 1 || perCategory > 20) {
  throw new Error("--per-category must be an integer from 1 to 20");
}
if (perTopic != null && (!Number.isInteger(perTopic) || perTopic < 1 || perTopic > 5)) {
  throw new Error("--per-topic must be an integer from 1 to 5");
}
if (inputs.length < 1) throw new Error("At least one --input dataset.json,preflight.json pair is required");

const candidates = [];
for (const [inputIndex, input] of inputs.entries()) {
  const [datasetPathValue, preflightPathValue, extra] = input.split(",");
  if (!datasetPathValue || !preflightPathValue || extra) {
    throw new Error("Each --input must be dataset.json,preflight.json");
  }
  const datasetPath = path.resolve(datasetPathValue);
  const preflightPath = path.resolve(preflightPathValue);
  const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
  const preflight = JSON.parse(await readFile(preflightPath, "utf8"));
  const metadataByName = new Map(dataset.photos.map((photo) => [photo.fileName, photo]));
  for (const photo of preflight.photos) {
    if (!photo.currentAppEligible || photo.exactDuplicateOf) continue;
    const metadata = metadataByName.get(photo.fileName);
    if (!metadata) throw new Error(`Missing metadata for ${photo.fileName} in ${datasetPath}`);
    if (requireTitleMatch && !titleLooksRelevant(metadata)) continue;
    const bytes = await readFile(photo.sanitizedFile);
    candidates.push({
      inputIndex,
      metadata,
      preflight: photo,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }
}

const categories = [...new Set(candidates.map((candidate) => candidate.metadata.category))].sort();
const selected = [];
const usedPages = new Set();
const usedHashes = new Set();
if (perTopic != null) {
  const topicIDs = [...new Set(candidates.map((candidate) => candidate.metadata.expectedTopicId))];
  for (const topicID of topicIDs) {
    const topicSelection = [];
    for (const candidate of candidates.filter((item) => item.metadata.expectedTopicId === topicID)) {
      if (topicSelection.length >= perTopic) break;
      if (!canSelect(candidate)) continue;
      select(candidate, topicSelection);
    }
    if (topicSelection.length !== perTopic) {
      throw new Error(`Not enough eligible unique photos for ${topicID}: ${topicSelection.length}/${perTopic}`);
    }
    selected.push(...topicSelection);
  }
} else for (const category of categories) {
  const pool = candidates.filter((candidate) => candidate.metadata.category === category);
  const categorySelection = [];
  const usedTopics = new Set();
  for (const candidate of pool) {
    if (categorySelection.length >= perCategory) break;
    if (usedTopics.has(candidate.metadata.expectedTopicId) || !canSelect(candidate)) continue;
    select(candidate, categorySelection);
    usedTopics.add(candidate.metadata.expectedTopicId);
  }
  for (const candidate of pool) {
    if (categorySelection.length >= perCategory) break;
    if (!canSelect(candidate)) continue;
    select(candidate, categorySelection);
  }
  if (categorySelection.length !== perCategory) {
    throw new Error(`Not enough eligible unique photos for ${category}: ${categorySelection.length}/${perCategory}`);
  }
  selected.push(...categorySelection);
}

const photosDirectory = path.join(outputDirectory, "photos");
await mkdir(photosDirectory, { recursive: true, mode: 0o700 });
const photos = [];
for (const [index, candidate] of selected.entries()) {
  const fileName = `web-${String(index + 1).padStart(3, "0")}.jpg`;
  const target = path.join(photosDirectory, fileName);
  await copyFile(candidate.preflight.sanitizedFile, target);
  photos.push({
    ...candidate.metadata,
    fileName,
    assembledFromFileName: candidate.metadata.fileName,
    sanitizedSha256: candidate.sha256
  });
}

const manifest = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  source: "Wikimedia Commons API; assembled from locally preflighted public datasets",
  selectionPolicy: "eligible-only-balanced-by-category-topic-first-page-and-byte-deduplicated",
  perCategory,
  perTopic,
  count: photos.length,
  topicCount: new Set(photos.map((photo) => photo.expectedTopicId)).size,
  inputs: inputs.map((input) => input.split(",").map((value) => path.resolve(value))),
  photos
};
await writeFile(path.join(outputDirectory, "dataset.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx"
});
process.stdout.write(`PUBLIC_EVAL_DATASET=PASS photos=${photos.length} topics=${manifest.topicCount} categories=${categories.length}\n`);

function canSelect(candidate) {
  return !usedPages.has(candidate.metadata.commonsPage) && !usedHashes.has(candidate.sha256);
}

function titleLooksRelevant(metadata) {
  const title = String(metadata.commonsTitle ?? "").toLowerCase().replaceAll("_", " ");
  const topic = String(metadata.expectedTopicId ?? "").toLowerCase();
  const blocked = {
    charger: /\b(dodge|police|patrol|vehicle|car)\b/,
    feather_duster: /\bworm\b/,
    steamer_basket: /\b(coastal|ship|railway|locomotive)\b/,
    drawer_slide: /\b(inscribed|ancient|amenhotep|game board)\b/,
    handsaw: /\b(painting|canvas|cats?)\b/,
    car_tire: /\b(accident|romanov)\b/,
    plunger: /\b(trumpet|mute)\b/,
    dish_brush: /^file:dish\b/,
    garden_trowel: /\bplant\b/,
    trash_bag: /\b(window|vehicle|car)\b/,
    shoelace: /\b(purse|drawstring)\b/,
    lighter: /\b(inn|hotel|pub|restaurant|molotov|cocktail)\b/,
    whisk: /\b(fly whisk|whisk broom|ceremonial whisk)\b/,
    peeler: /\b(grave|cemetery|person)\b/,
    sandpaper: /\b(vine|plant|flower)\b/,
    rake: /\b(bridge|road|village|place)\b/,
    flashlight: /\b(gun|rifle|pistol|p90|suppressor)\b/,
    motorcycle: /\b(license plate|number plate)\b/,
    laptop: /\b(keyboard)\b/,
    keyboard: /\b(windows|mobile|layout|screenshot)\b/,
    printer: /\btitle\b/,
    zipper: /\b(mile.marker|sculpture|artwork)\b/,
    paper_clip: /\bnyc|monument|sculpture\b/,
    bicycle_chain: /\bbox\b/,
    hair_dryer: /\b(plug|gfci)\b/
  };
  if (blocked[topic]?.test(title)) return false;
  const aliases = {
    kitchen_scissors: ["scissor"],
    kitchen_tongs: ["tong"],
    computer_mouse: ["computer mouse", "wireless mouse", "optical mouse"],
    car_tire: ["car tire", "car tyre", "automobile tire", "automobile tyre"],
    hard_drive: ["hard drive", "hard disk"],
    solid_state_drive: ["solid state drive", "ssd"],
    wifi_router: ["wifi router", "wi-fi router", "wireless router"],
    usb_flash_drive: ["usb flash drive", "usb drive"],
    remote_control: ["remote control", "remote-control"],
    bicycle_bell: ["bicycle bell", "bike bell"],
    bicycle_chain: ["bicycle chain", "bike chain"],
    seat_belt: ["seat belt", "seatbelt"],
    clothes_hanger: ["clothes hanger", "coat hanger"],
    clothes_drying_rack: ["drying rack", "clothes rack"],
    tape_measure: ["tape measure", "measuring tape"],
    drawer_slide: ["drawer slide", "drawer rail"],
    steamer_basket: ["steamer basket"],
    bottle_opener: ["bottle opener"],
    feather_duster: ["feather duster"],
    dental_floss: ["dental floss"],
    traffic_light: ["traffic light", "traffic signal"],
    washing_machine: ["washing machine"],
    vacuum_cleaner: ["vacuum cleaner"]
  };
  const needles = aliases[topic] ?? [topic.replaceAll("_", " ")];
  return needles.some((needle) => title.includes(needle));
}

function select(candidate, categorySelection) {
  categorySelection.push(candidate);
  usedPages.add(candidate.metadata.commonsPage);
  usedHashes.add(candidate.sha256);
}

function repeatedValues(flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function requiredValue(flag) {
  const value = optionalValue(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function optionalValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
