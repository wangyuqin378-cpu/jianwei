import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeCatalog } from "../domain/types.js";
import { knowledgeCatalogSchema } from "../domain/schemas.js";
import { AppError } from "../errors.js";
import { KnowledgeCatalogService, validateCatalog } from "./knowledge-catalog.js";

describe("knowledge catalog safety gates", () => {
  it("requires two authoritative sources for an approved health fact", () => {
    const catalog: KnowledgeCatalog = {
      version: "test",
      sources: [{
        sourceId: "one-source",
        title: "Professional source",
        url: "https://example.com/fact",
        publisher: "Example",
        authority: "professional"
      }],
      topics: [{
        topicId: "toothbrush",
        displayName: "牙刷",
        synonyms: ["toothbrush"],
        category: "cleaning",
        facts: [{
          factId: "health-fact",
          topicId: "toothbrush",
          factText: "这是一条长度足够但只有一个权威来源、必须被拒绝的健康类测试事实。",
          sourceIds: ["one-source"],
          riskLevel: "health",
          reviewStatus: "approved"
        }]
      }]
    };

    expect(() => validateCatalog(catalog)).toThrowError(AppError);
    expect(() => validateCatalog(catalog)).toThrowError(/至少需要两个权威来源/);
  });

  it("keeps high-risk facts out of cards and only allows synthetic unattested general facts in development", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const catalog = JSON.parse(await readFile(path.join(root, "knowledge/catalog.json"), "utf8")) as KnowledgeCatalog;
    const legacySeeds = new Set([
      "broom-001", "bicycle-001", "chopsticks-001", "traffic-light-001", "umbrella-001",
      "zipper-001", "thermos-001", "paper-clip-001", "ballpoint-pen-001", "vacuum-cleaner-001"
    ]);
    for (const fact of catalog.topics.flatMap((topic) => topic.facts)) {
      fact.reviewStatus = legacySeeds.has(fact.factId) ? "approved" : "draft";
      delete fact.aiReview;
      delete fact.review;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "jianwei-unattested-catalog-"));
    const file = path.join(directory, "catalog.json");
    await writeFile(file, JSON.stringify(catalog), "utf8");
    try {
    const service = await KnowledgeCatalogService.fromFile(file);
    const topic = service.findTopic("broom");
    expect(topic).not.toBeNull();
    expect(service.selectApprovedFact(topic!, "candidate")).toBeNull();
    expect(service.selectApprovedFact(topic!, "candidate", true)?.fact.factId).toBe("broom-001");
    expect(topic!.facts.filter((fact) => fact.reviewStatus === "draft")).toHaveLength(3);

    const toothbrush = service.findTopic("toothbrush");
    expect(toothbrush).not.toBeNull();
    const toothbrushDrafts = toothbrush!.facts.filter((fact) => fact.reviewStatus === "draft");
    expect(toothbrushDrafts).toHaveLength(toothbrush!.facts.length);
    expect(toothbrushDrafts.every((fact) => fact.riskLevel === "health" && new Set(fact.sourceIds).size === 2)).toBe(true);
    expect(service.selectApprovedFact(toothbrush!, "candidate")).toBeNull();
    expect(service.selectApprovedFact(toothbrush!, "candidate", true)).toBeNull();

    for (const topicId of ["washing_machine", "usb_flash_drive"]) {
      const extendedTopic = service.findTopic(topicId);
      expect(extendedTopic, topicId).not.toBeNull();
      expect(extendedTopic!.facts).toHaveLength(4);
      expect(extendedTopic!.facts.every((fact) => fact.reviewStatus === "draft" && fact.review === undefined)).toBe(true);
      expect(service.selectApprovedFact(extendedTopic!, "candidate"), topicId).toBeNull();
      expect(service.selectApprovedFact(extendedTopic!, "candidate", true), topicId).toBeNull();
    }

    const aiDraftTopic = service.findTopic("camera");
    expect(aiDraftTopic).not.toBeNull();
    expect(service.selectApprovedFact(aiDraftTopic!, "candidate")).toBeNull();
    expect(service.selectApprovedFact(aiDraftTopic!, "candidate", true)).toBeNull();

    for (const topicId of [
      "charger", "usb_cable", "solid_state_drive", "laptop", "monitor", "printer",
      "air_purifier", "dehumidifier", "dishwasher", "led_bulb",
      "power_bank", "car_tire", "candle", "hair_dryer", "electrical_outlet", "pressure_cooker",
      "power_strip", "seat_belt", "hammer", "cutting_board", "helmet",
      "spray_bottle", "sponge", "cast_iron_pan",
      "pencil", "eraser", "safety_pin",
      "mug", "spoon", "fork", "whisk", "colander",
      "notebook", "bicycle_bell",
      "clothes_hanger", "clothespin", "mop", "soap_dispenser",
      "bottle_brush", "clothes_drying_rack", "detergent_bottle",
      "dish_brush", "dustpan", "feather_duster",
      "iron", "ironing_board", "laundry_basket",
      "lint_roller", "microfiber_cloth", "nail_brush",
      "plunger", "rubber_gloves", "squeegee",
      "toilet_brush", "trash_bag", "trash_can",
      "camera_lens", "computer_fan", "e_reader",
      "microphone", "smartphone", "smartwatch",
      "game_controller", "speaker", "tablet",
      "tripod", "webcam", "wifi_router",
      "alarm_clock", "backpack", "button",
      "cabinet_handle", "comb", "curtain",
      "curtain_rod", "door_handle", "door_lock",
      "doormat", "drawer_slide", "duvet",
      "hand_fan", "light_switch", "mattress",
      "mirror", "pillow", "rug",
      "rubber_band", "sewing_needle", "shoehorn",
      "shoelace", "storage_box", "suitcase",
      "dental_floss", "lighter", "mosquito_coil",
      "thread_spool", "tissue_box", "toilet_paper",
      "wall_clock", "wallet", "watering_can",
      "window_screen", "bottle_opener", "can_opener",
      "aluminum_foil", "corkscrew", "dish_rack",
      "electric_kettle", "food_storage_container", "grater",
      "kettle", "kitchen_knife", "kitchen_scissors",
      "kitchen_tongs", "ladle", "measuring_cup",
      "measuring_spoon", "nonstick_pan", "peeler",
      "plastic_wrap", "rice_cooker", "rice_paddle",
      "rolling_pin", "stainless_steel_pan", "steamer_basket",
      "tea_strainer", "wok", "bench_vise",
      "caulking_gun", "clamp", "drill_bit",
      "garden_trowel", "handsaw", "hex_key",
      "hot_glue_gun", "multimeter", "paint_brush",
      "paint_roller", "power_drill", "pruning_shears",
      "rake", "ratchet_wrench", "sandpaper",
      "shovel", "socket_wrench", "soldering_iron",
      "utility_knife", "wire_stripper", "bicycle_chain",
      "bicycle_pedal", "bus_stop_sign", "car_key_fob",
      "license_plate", "motorcycle", "parking_meter",
      "subway_gate", "train_ticket",
      "airbag", "bicycle_brake", "car_headrest",
      "crosswalk", "fuel_nozzle",
      "motorcycle_mirror", "rearview_mirror", "road_sign",
      "speed_bump", "windshield_wiper"
    ]) {
      const batchTopic = service.findTopic(topicId);
      expect(batchTopic, topicId).not.toBeNull();
      expect(batchTopic!.facts).toHaveLength(3);
      expect(batchTopic!.facts.every((fact) => fact.reviewStatus === "draft" && fact.review === undefined)).toBe(true);
      expect(service.selectApprovedFact(batchTopic!, "candidate"), topicId).toBeNull();
      expect(service.selectApprovedFact(batchTopic!, "candidate", true), topicId).toBeNull();
    }

    const bicycle = service.findTopic("bicycle");
    expect(bicycle).not.toBeNull();
    expect(bicycle!.facts).toHaveLength(3);
    expect(bicycle!.facts.filter((fact) => fact.reviewStatus === "draft")).toHaveLength(2);
    expect(bicycle!.facts.filter((fact) => fact.reviewStatus === "draft")
      .every((fact) => fact.riskLevel === "safety" && new Set(fact.sourceIds).size === 2 && fact.review === undefined)).toBe(true);
    expect(service.selectApprovedFact(bicycle!, "candidate")).toBeNull();
    expect(service.selectApprovedFact(bicycle!, "candidate", true)?.fact.factId).toBe("bicycle-001");

    const chopsticks = service.findTopic("chopsticks");
    expect(chopsticks).not.toBeNull();
    expect(chopsticks!.facts).toHaveLength(3);
    expect(chopsticks!.facts.filter((fact) => fact.reviewStatus === "draft")).toHaveLength(2);
    expect(chopsticks!.facts.filter((fact) => fact.reviewStatus === "draft")
      .every((fact) => fact.riskLevel === "general" && fact.review === undefined)).toBe(true);
    expect(service.selectApprovedFact(chopsticks!, "candidate")).toBeNull();
    expect(service.selectApprovedFact(chopsticks!, "candidate", true)?.fact.factId).toBe("chopsticks-001");

    const trafficLight = service.findTopic("traffic_light");
    expect(trafficLight).not.toBeNull();
    expect(trafficLight!.facts).toHaveLength(3);
    expect(trafficLight!.facts.filter((fact) => fact.reviewStatus === "draft")).toHaveLength(2);
    expect(trafficLight!.facts.filter((fact) => fact.reviewStatus === "draft")
      .every((fact) => fact.riskLevel === "general" && fact.review === undefined)).toBe(true);
    expect(service.selectApprovedFact(trafficLight!, "candidate")).toBeNull();
    expect(service.selectApprovedFact(trafficLight!, "candidate", true)?.fact.factId).toBe("traffic-light-001");

    const umbrella = service.findTopic("umbrella");
    expect(umbrella).not.toBeNull();
    expect(umbrella!.facts).toHaveLength(3);
    expect(umbrella!.facts.filter((fact) => fact.reviewStatus === "draft")).toHaveLength(2);
    expect(umbrella!.facts.filter((fact) => fact.reviewStatus === "draft")
      .every((fact) => fact.riskLevel === "general" && fact.review === undefined)).toBe(true);
    expect(service.selectApprovedFact(umbrella!, "candidate")).toBeNull();
    expect(service.selectApprovedFact(umbrella!, "candidate", true)?.fact.factId).toBe("umbrella-001");

    const expectedLegacySeed = new Map([
      ["zipper", "zipper-001"],
      ["thermos", "thermos-001"],
      ["paper_clip", "paper-clip-001"],
      ["ballpoint_pen", "ballpoint-pen-001"],
      ["vacuum_cleaner", "vacuum-cleaner-001"]
    ]);
    for (const [topicId, seedFactId] of expectedLegacySeed) {
      const extendedTopic = service.findTopic(topicId);
      expect(extendedTopic, topicId).not.toBeNull();
      expect(extendedTopic!.facts).toHaveLength(4);
      expect(extendedTopic!.facts.filter((fact) => fact.reviewStatus === "draft")).toHaveLength(3);
      expect(extendedTopic!.facts.filter((fact) => fact.reviewStatus === "draft")
        .every((fact) => fact.review === undefined)).toBe(true);
      expect(service.selectApprovedFact(extendedTopic!, "candidate"), topicId).toBeNull();
      expect(service.selectApprovedFact(extendedTopic!, "candidate", true)?.fact.factId, topicId).toBe(seedFactId);
    }

    for (const topicId of [
      "computer_mouse", "keyboard", "door_hinge", "flashlight",
      "scissors", "screwdriver", "tape_measure", "spirit_level", "pliers", "wrench", "stapler",
      "remote_control", "headphones", "padlock", "key"
    ]) {
      const extendedDraftTopic = service.findTopic(topicId);
      expect(extendedDraftTopic, topicId).not.toBeNull();
      expect(extendedDraftTopic!.facts).toHaveLength(4);
      expect(extendedDraftTopic!.facts.every((fact) => fact.reviewStatus === "draft" && fact.review === undefined)).toBe(true);
      expect(service.selectApprovedFact(extendedDraftTopic!, "candidate"), topicId).toBeNull();
      expect(service.selectApprovedFact(extendedDraftTopic!, "candidate", true), topicId).toBeNull();
    }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("pins the production catalog bytes and refuses an edited file", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    await expect(KnowledgeCatalogService.fromFile(path.join(root, "knowledge/catalog.json"), {
      expectedSha256: "0".repeat(64)
    })).rejects.toMatchObject({ code: "catalog_integrity_mismatch" });
  });

  it("requires an exact normalized label instead of guessing from a substring", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianwei-label-match-"));
    const file = path.join(directory, "catalog.json");
    await writeFile(file, JSON.stringify(reviewedCatalog("human-editor-01")), "utf8");
    try {
      const service = await KnowledgeCatalogService.fromFile(file);

      expect(service.matchLabels(["Room", "Chair", "Pattern"])).toBeNull();
      expect(service.matchLabels([" BROOM "])?.topicId).toBe("broom");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses every approved fact before repeating a recent one", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianwei-fact-rotation-"));
    const file = path.join(directory, "catalog.json");
    const catalog = reviewedCatalog("human-editor-01");
    catalog.topics[0]!.facts = ["one", "two", "three"].map((suffix, index) => ({
      ...catalog.topics[0]!.facts[0]!,
      factId: `broom-${suffix}`,
      factText: `这是第${index + 1}条已经由受控人工审核者核验并批准发布的普通物件测试事实。`
    }));
    await writeFile(file, JSON.stringify(catalog), "utf8");
    try {
      const service = await KnowledgeCatalogService.fromFile(file);
      const topic = service.findTopic("broom")!;
      const first = service.selectApprovedFact(topic, "same-seed")!.fact.factId;
      const second = service.selectApprovedFact(topic, "same-seed", false, [first])!.fact.factId;
      const third = service.selectApprovedFact(topic, "same-seed", false, [second, first])!.fact.factId;
      const recycled = service.selectApprovedFact(topic, "same-seed", false, [third, second, first])!.fact.factId;

      expect(new Set([first, second, third])).toEqual(new Set(["broom-one", "broom-two", "broom-three"]));
      expect(recycled).toBe(first);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts either a controlled human review or a bound Qwen general-content review", () => {
    const catalog = reviewedCatalog("human-editor-01");
    expect(() => validateCatalog(catalog, {
      requireAttestedApprovedFacts: true,
      approvedReviewerIds: ["human-editor-01"]
    })).not.toThrow();
    expect(() => validateCatalog(catalog, {
      requireAttestedApprovedFacts: true,
      approvedReviewerIds: ["different-editor"]
    })).toThrow(/不在生产白名单/);

    const automated = reviewedCatalog("human-kimi-bot");
    expect(() => validateCatalog(automated, {
      requireAttestedApprovedFacts: true,
      approvedReviewerIds: ["human-kimi-bot"]
    })).toThrow(/疑似自动模型/);

    delete catalog.topics[0]!.facts[0]!.review;
    expect(() => validateCatalog(catalog, {
      requireAttestedApprovedFacts: true,
      approvedReviewerIds: ["human-editor-01"]
    })).toThrow(/缺少人工或 AI 审核记录/);

    const aiReviewed = reviewedCatalog("human-editor-01");
    const aiFact = aiReviewed.topics[0]!.facts[0]!;
    delete aiFact.review;
    aiFact.aiReview = {
      provider: "qwen",
      model: "qwen3.6-flash-2026-04-16",
      policyVersion: "general-content-v1",
      reviewedAt: "2026-01-01T01:00:00.000Z",
      decision: "approved",
      reasonCode: "safe_general",
      evidenceSha256: "a".repeat(64)
    };
    expect(() => validateCatalog(aiReviewed, { requireAttestedApprovedFacts: true })).not.toThrow();
    aiFact.riskLevel = "health";
    expect(() => validateCatalog(aiReviewed, { requireAttestedApprovedFacts: true })).toThrow(/不能批准健康或安全/);
  });

  it("requires an approved fact to be publishable verbatim as the card body", () => {
    const catalog = reviewedCatalog("human-editor-01");
    catalog.topics[0]!.facts[0]!.factText = "这条审核事实太短，不能原样发布。";
    expect(() => validateCatalog(catalog)).toThrow(/28-80 字卡片正文/);
  });

  it("bounds canonical object names to the persisted card contract", () => {
    const catalog = reviewedCatalog("human-editor-01");
    catalog.topics[0]!.displayName = " 扫帚 ";
    expect(knowledgeCatalogSchema.parse(catalog).topics[0]!.displayName).toBe("扫帚");

    catalog.topics[0]!.displayName = "物".repeat(61);
    expect(knowledgeCatalogSchema.safeParse(catalog).success).toBe(false);
  });
});

function reviewedCatalog(reviewerId: string): KnowledgeCatalog {
  return {
    version: "reviewed-test",
    sources: [{
      sourceId: "source-one",
      title: "Reference source",
      url: "https://example.com/reference",
      publisher: "Example",
      authority: "reference"
    }],
    topics: [{
      topicId: "broom",
      displayName: "扫帚",
      synonyms: ["broom"],
      category: "cleaning",
      facts: [{
        factId: "broom-reviewed",
        topicId: "broom",
        factText: "这是一条已经由受控人工审核者核验并批准发布的普通物件测试事实。",
        sourceIds: ["source-one"],
        riskLevel: "general",
        reviewStatus: "approved",
        review: {
          reviewerId,
          sourceCheckedAt: "2026-01-01T00:00:00.000Z",
          reviewedAt: "2026-01-01T01:00:00.000Z"
        }
      }]
    }]
  };
}
