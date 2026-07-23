import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const catalogPath = path.join(root, "knowledge", "catalog.json");
const backlogPath = path.join(root, "knowledge", "topic-backlog.json");
const categoryTargets = {
  home: 45,
  tableware: 35,
  cleaning: 30,
  tool: 35,
  digital: 30,
  transport: 25
};

const proposals = {
  home: [
    ["door_handle", "门把手", "door handle"],
    ["door_lock", "门锁", "door lock"],
    ["light_switch", "电灯开关", "light switch"],
    ["electrical_outlet", "电源插座", "electrical outlet"],
    ["led_bulb", "LED 灯泡", "LED bulb"],
    ["curtain", "窗帘", "curtain"],
    ["curtain_rod", "窗帘杆", "curtain rod"],
    ["window_screen", "纱窗", "window screen"],
    ["doormat", "门垫", "doormat"],
    ["rug", "地毯", "rug"],
    ["pillow", "枕头", "pillow"],
    ["duvet", "羽绒被", "duvet"],
    ["mattress", "床垫", "mattress"],
    ["alarm_clock", "闹钟", "alarm clock"],
    ["wall_clock", "挂钟", "wall clock"],
    ["mirror", "镜子", "mirror"],
    ["hair_dryer", "吹风机", "hair dryer"],
    ["comb", "梳子", "comb"],
    ["sewing_needle", "缝衣针", "sewing needle"],
    ["thread_spool", "线轴", "thread spool"],
    ["button", "衣扣", "clothing button"],
    ["shoelace", "鞋带", "shoelace"],
    ["shoehorn", "鞋拔", "shoehorn"],
    ["wallet", "钱包", "wallet"],
    ["backpack", "背包", "backpack"],
    ["suitcase", "行李箱", "suitcase"],
    ["tissue_box", "纸巾盒", "tissue box"],
    ["toilet_paper", "卫生纸", "toilet paper"],
    ["storage_box", "收纳箱", "storage box"],
    ["drawer_slide", "抽屉滑轨", "drawer slide"],
    ["cabinet_handle", "柜门把手", "cabinet handle"],
    ["rubber_band", "橡皮筋", "rubber band"],
    ["candle", "蜡烛", "candle"],
    ["lighter", "打火机", "lighter"],
    ["mosquito_coil", "蚊香", "mosquito coil"],
    ["hand_fan", "手扇", "hand fan"]
  ],
  tableware: [
    ["kitchen_knife", "菜刀", "kitchen knife"],
    ["peeler", "削皮器", "peeler"],
    ["can_opener", "开罐器", "can opener"],
    ["bottle_opener", "开瓶器", "bottle opener"],
    ["corkscrew", "红酒开瓶器", "corkscrew"],
    ["kitchen_tongs", "食物夹", "kitchen tongs"],
    ["ladle", "汤勺", "ladle"],
    ["rice_paddle", "饭勺", "rice paddle"],
    ["rolling_pin", "擀面杖", "rolling pin"],
    ["grater", "刨丝器", "grater"],
    ["kitchen_scissors", "厨房剪", "kitchen scissors"],
    ["measuring_cup", "量杯", "measuring cup"],
    ["measuring_spoon", "量勺", "measuring spoon"],
    ["kettle", "水壶", "kettle"],
    ["electric_kettle", "电热水壶", "electric kettle"],
    ["pressure_cooker", "压力锅", "pressure cooker"],
    ["rice_cooker", "电饭煲", "rice cooker"],
    ["wok", "炒锅", "wok"],
    ["nonstick_pan", "不粘锅", "nonstick pan"],
    ["stainless_steel_pan", "不锈钢锅", "stainless steel pan"],
    ["steamer_basket", "蒸屉", "steamer basket"],
    ["food_storage_container", "保鲜盒", "food storage container"],
    ["plastic_wrap", "保鲜膜", "plastic wrap"],
    ["aluminum_foil", "铝箔", "aluminum foil"],
    ["dish_rack", "沥水架", "dish rack"],
    ["tea_strainer", "茶滤", "tea strainer"]
  ],
  cleaning: [
    ["dustpan", "簸箕", "dustpan"],
    ["toilet_brush", "马桶刷", "toilet brush"],
    ["plunger", "皮搋子", "plunger"],
    ["squeegee", "刮水器", "squeegee"],
    ["microfiber_cloth", "超细纤维布", "microfiber cloth"],
    ["dish_brush", "洗碗刷", "dish brush"],
    ["bottle_brush", "瓶刷", "bottle brush"],
    ["lint_roller", "粘毛滚", "lint roller"],
    ["laundry_basket", "洗衣篮", "laundry basket"],
    ["clothes_drying_rack", "晾衣架", "clothes drying rack"],
    ["iron", "熨斗", "clothes iron"],
    ["ironing_board", "熨衣板", "ironing board"],
    ["detergent_bottle", "洗涤剂瓶", "detergent bottle"],
    ["dishwasher", "洗碗机", "dishwasher"],
    ["trash_can", "垃圾桶", "trash can"],
    ["trash_bag", "垃圾袋", "trash bag"],
    ["rubber_gloves", "清洁手套", "rubber gloves"],
    ["dental_floss", "牙线", "dental floss"],
    ["nail_brush", "指甲刷", "nail brush"],
    ["feather_duster", "鸡毛掸子", "feather duster"],
    ["dehumidifier", "除湿机", "dehumidifier"],
    ["air_purifier", "空气净化器", "air purifier"]
  ],
  tool: [
    ["utility_knife", "美工刀", "utility knife"],
    ["handsaw", "手锯", "handsaw"],
    ["power_drill", "电钻", "power drill"],
    ["drill_bit", "钻头", "drill bit"],
    ["hex_key", "内六角扳手", "hex key"],
    ["ratchet_wrench", "棘轮扳手", "ratchet wrench"],
    ["socket_wrench", "套筒扳手", "socket wrench"],
    ["clamp", "夹钳", "clamp"],
    ["bench_vise", "台钳", "bench vise"],
    ["sandpaper", "砂纸", "sandpaper"],
    ["paint_brush", "油漆刷", "paint brush"],
    ["paint_roller", "滚筒刷", "paint roller"],
    ["caulking_gun", "胶枪", "caulking gun"],
    ["hot_glue_gun", "热熔胶枪", "hot glue gun"],
    ["soldering_iron", "电烙铁", "soldering iron"],
    ["multimeter", "万用表", "multimeter"],
    ["wire_stripper", "剥线钳", "wire stripper"],
    ["garden_trowel", "园艺铲", "garden trowel"],
    ["pruning_shears", "修枝剪", "pruning shears"],
    ["watering_can", "浇水壶", "watering can"],
    ["shovel", "铁锹", "shovel"],
    ["rake", "耙子", "rake"]
  ],
  digital: [
    ["smartphone", "智能手机", "smartphone"],
    ["tablet", "平板电脑", "tablet computer"],
    ["laptop", "笔记本电脑", "laptop"],
    ["monitor", "显示器", "computer monitor"],
    ["webcam", "网络摄像头", "webcam"],
    ["microphone", "麦克风", "microphone"],
    ["speaker", "扬声器", "speaker"],
    ["charger", "充电器", "charger"],
    ["usb_cable", "USB 数据线", "USB cable"],
    ["hdmi_cable", "HDMI 线", "HDMI cable"],
    ["ethernet_cable", "网线", "Ethernet cable"],
    ["wifi_router", "无线路由器", "Wi-Fi router"],
    ["power_bank", "充电宝", "power bank"],
    ["sd_card", "SD 卡", "SD card"],
    ["camera", "相机", "camera"],
    ["camera_lens", "相机镜头", "camera lens"],
    ["tripod", "三脚架", "tripod"],
    ["smartwatch", "智能手表", "smartwatch"],
    ["game_controller", "游戏手柄", "game controller"],
    ["e_reader", "电子书阅读器", "e-reader"],
    ["printer", "打印机", "printer"],
    ["computer_fan", "电脑风扇", "computer fan"],
    ["hard_drive", "机械硬盘", "hard disk drive"],
    ["solid_state_drive", "固态硬盘", "solid state drive"]
  ],
  transport: [
    ["car_tire", "汽车轮胎", "car tire"],
    ["windshield_wiper", "雨刮器", "windshield wiper"],
    ["rearview_mirror", "后视镜", "rearview mirror"],
    ["car_headrest", "汽车头枕", "car headrest"],
    ["airbag", "安全气囊", "airbag"],
    ["license_plate", "车牌", "license plate"],
    ["car_key_fob", "汽车遥控钥匙", "car key fob"],
    ["fuel_nozzle", "加油枪", "fuel nozzle"],
    ["parking_meter", "停车计时器", "parking meter"],
    ["road_sign", "道路标志", "road sign"],
    ["crosswalk", "人行横道", "crosswalk"],
    ["speed_bump", "减速带", "speed bump"],
    ["bicycle_chain", "自行车链条", "bicycle chain"],
    ["bicycle_brake", "自行车刹车", "bicycle brake"],
    ["bicycle_pedal", "自行车脚踏", "bicycle pedal"],
    ["motorcycle", "摩托车", "motorcycle"],
    ["motorcycle_mirror", "摩托车后视镜", "motorcycle mirror"],
    ["subway_gate", "地铁闸机", "subway gate"],
    ["bus_stop_sign", "公交站牌", "bus stop sign"],
    ["train_ticket", "火车票", "train ticket"]
  ]
};

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const catalogTopics = Array.isArray(catalog.topics) ? catalog.topics : [];
const byCategory = new Map(Object.keys(categoryTargets).map((category) => [category, []]));
const catalogById = new Map();

for (const topic of catalogTopics) {
  if (!topic.topicId || catalogById.has(topic.topicId)) {
    throw new Error(`Catalog topic IDs must be present and unique: ${topic.topicId ?? "<missing>"}`);
  }
  catalogById.set(topic.topicId, topic);
  if (!byCategory.has(topic.category)) throw new Error(`Unknown catalog category: ${topic.category}`);
  const humanAttestedFactCount = (topic.facts ?? []).filter((fact) =>
    fact.reviewStatus === "approved" && fact.review?.reviewerId && fact.review?.reviewedAt && fact.review?.sourceCheckedAt
  ).length;
  byCategory.get(topic.category).push({
    topicId: topic.topicId,
    displayName: topic.displayName,
    category: topic.category,
    aliases: [...new Set(topic.synonyms ?? [])],
    catalogState: "seeded",
    factsInCatalog: (topic.facts ?? []).length,
    humanAttestedFactCount,
    targetFactCount: 3,
    researchState: humanAttestedFactCount >= 3 ? "ready" : "human_research_required",
    readyForProduction: humanAttestedFactCount >= 3
  });
}

for (const [category, rows] of Object.entries(proposals)) {
  for (const [topicId, displayName, englishAlias] of rows) {
    const catalogTopic = catalogById.get(topicId);
    if (catalogTopic) {
      if (catalogTopic.displayName !== displayName || catalogTopic.category !== category) {
        throw new Error(`Catalog topic conflicts with controlled proposal: ${topicId}`);
      }
      continue;
    }
    byCategory.get(category).push({
      topicId,
      displayName,
      category,
      aliases: [englishAlias, displayName],
      catalogState: "proposed",
      factsInCatalog: 0,
      humanAttestedFactCount: 0,
      targetFactCount: 3,
      researchState: "human_research_required",
      readyForProduction: false
    });
  }
}

const topics = [...byCategory.values()].flat().sort((left, right) =>
  left.category.localeCompare(right.category) || left.topicId.localeCompare(right.topicId)
);
const ids = new Set(topics.map((topic) => topic.topicId));
if (ids.size !== topics.length) throw new Error("Topic backlog contains duplicate topic IDs");
if (topics.length !== 200) throw new Error(`Topic backlog must contain exactly 200 topics; found ${topics.length}`);
for (const [category, target] of Object.entries(categoryTargets)) {
  const actual = byCategory.get(category).length;
  if (actual !== target) throw new Error(`${category} must contain ${target} topics; found ${actual}`);
}
for (const topic of topics) {
  if (!topic.topicId || !topic.displayName || topic.aliases.length < 2) throw new Error(`Incomplete topic: ${topic.topicId}`);
}

const backlog = {
  version: "2026-07-18-beta-taxonomy.1",
  generatedFromCatalogVersion: catalog.version,
  policy: {
    publishesFacts: false,
    requiredFactsPerTopic: "3-5",
    requiredReview: "accountable human source review",
    note: "Proposed topics are taxonomy backlog only and are never served until facts and sources pass the production catalog gate."
  },
  categoryTargets,
  metrics: {
    topics: topics.length,
    seededTopics: topics.filter((topic) => topic.catalogState === "seeded").length,
    proposedTopics: topics.filter((topic) => topic.catalogState === "proposed").length,
    productionReadyTopics: topics.filter((topic) => topic.readyForProduction).length
  },
  topics
};

const rendered = `${JSON.stringify(backlog, null, 2)}\n`;
if (process.argv.includes("--write")) {
  await writeFile(backlogPath, rendered, "utf8");
} else {
  const current = await readFile(backlogPath, "utf8");
  if (current !== rendered) throw new Error("knowledge/topic-backlog.json is stale; run node scripts/build-topic-backlog.mjs --write");
}
process.stdout.write(`TOPIC_BACKLOG_GATE=GO topics=200 seeded=${backlog.metrics.seededTopics} proposed=${backlog.metrics.proposedTopics} ready=${backlog.metrics.productionReadyTopics} publishesFacts=0\n`);
