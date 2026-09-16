import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const input = requiredPath("--input");
const output = requiredPath("--output");
const report = JSON.parse(await readFile(input, "utf8"));
const results = new Map(report.results.map((result) => [result.fileName, result]));
const imageDirectory = path.resolve(path.dirname(report.dataset.manifest), "photos");
const relativeImageDirectory = path.relative(path.dirname(output), imageDirectory);

const dailySections = report.dailyGroups.map((group, index) => {
  const photos = group.photoFileNames.map((fileName) => {
    const result = results.get(fileName);
    const isWinner = group.winnerFileName === fileName;
    const card = result?.card;
    const status = card
      ? `知识 ${escapeHTML(String(result.score))} 分`
      : result?.detection
        ? "未形成可靠知识"
        : "本地隐私/质量过滤";
    return `<article class="photo ${isWinner ? "winner" : ""}">
      <div class="image-wrap">
        <img src="${escapeAttribute(path.posix.join(relativeImageDirectory, fileName))}" alt="${escapeAttribute(result?.source?.expectedDisplayName ?? fileName)}">
        ${isWinner ? '<span class="winner-tag">当天选中</span>' : ""}
      </div>
      <div class="photo-copy">
        <div class="eyebrow">${escapeHTML(result?.detection?.displayName ?? result?.source?.expectedDisplayName ?? fileName)} · ${status}</div>
        ${card ? `<h3>${escapeHTML(card.title)}</h3><p>${escapeHTML(card.body)}</p><a href="${escapeAttribute(card.sources?.[0]?.url ?? "#")}">${escapeHTML(card.sources?.[0]?.publisher ?? "查看来源")}</a>` : `<p>${escapeHTML(noCardReason(result))}</p>`}
      </div>
    </article>`;
  }).join("");
  return `<section class="day">
    <header><div><span class="day-number">第 ${index + 1} 天</span><h2>${group.winnerFileName ? "有可靠知识可推送" : "宁可不出卡"}</h2></div><span class="batch">${group.usedFallbackBatch ? "启用兜底批 · 6 张" : `${group.photoFileNames.length} 张`}</span></header>
    <div class="photo-grid">${photos}</div>
  </section>`;
}).join("");

const metrics = report.metrics;
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>见微 · AI 照片知识评测</title>
  <style>
    :root { color-scheme: light; --ink:#182018; --muted:#667064; --paper:#f4f0e7; --card:#fffdf8; --green:#244d38; --line:#dcd7cc; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; }
    main { width:min(1240px,calc(100% - 32px)); margin:0 auto; padding:64px 0 96px; }
    .hero { display:grid; grid-template-columns:1.25fr .75fr; gap:48px; align-items:end; margin-bottom:48px; }
    .kicker,.eyebrow,.day-number { color:var(--green); font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    h1 { font:600 clamp(40px,7vw,84px)/1.05 Georgia,"Songti SC",serif; letter-spacing:-.04em; margin:12px 0 20px; }
    .hero p { color:var(--muted); max-width:720px; font-size:17px; }
    .metrics { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
    .metric { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:18px; }
    .metric strong { display:block; font:600 34px/1 Georgia,serif; margin-bottom:8px; }
    .metric span { color:var(--muted); font-size:13px; }
    .day { background:rgba(255,253,248,.75); border:1px solid var(--line); border-radius:28px; padding:28px; margin:18px 0; }
    .day > header { display:flex; justify-content:space-between; gap:20px; align-items:center; margin-bottom:22px; }
    h2 { margin:2px 0 0; font:600 26px/1.2 Georgia,"Songti SC",serif; }
    .batch { border:1px solid var(--line); border-radius:99px; padding:6px 12px; color:var(--muted); white-space:nowrap; }
    .photo-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .photo { overflow:hidden; border:1px solid var(--line); border-radius:20px; background:var(--card); }
    .photo.winner { border:2px solid var(--green); box-shadow:0 12px 32px rgba(36,77,56,.12); }
    .image-wrap { height:230px; position:relative; background:#e8e4dc; }
    img { width:100%; height:100%; object-fit:cover; display:block; }
    .winner-tag { position:absolute; top:12px; left:12px; color:white; background:var(--green); border-radius:99px; padding:5px 10px; font-size:12px; font-weight:700; }
    .photo-copy { padding:18px; }
    h3 { margin:8px 0; font:600 21px/1.25 Georgia,"Songti SC",serif; }
    .photo-copy p { margin:8px 0; color:#3f493f; }
    a { color:var(--green); text-underline-offset:3px; }
    .note { color:var(--muted); margin-top:28px; }
    @media (max-width:800px) { main{padding-top:32px}.hero{grid-template-columns:1fr}.photo-grid{grid-template-columns:1fr}.image-wrap{height:280px}.day{padding:18px} }
  </style>
</head>
<body><main>
  <section class="hero"><div><div class="kicker">Jianwei local evaluation · ${escapeHTML(report.model)}</div><h1>每天三张，选一条真正值得知道的。</h1><p>30 张公开网络图片经过与产品一致的本地过滤、视觉识别、审核知识匹配、图片事实复核和当天选优。前三张都无可靠知识时，只补看一批三张。</p></div>
  <div class="metrics">
    <div class="metric"><strong>${metrics.dailyGroupsWithCard}/${metrics.dailyPhotoGroups}</strong><span>模拟天数成功出卡</span></div>
    <div class="metric"><strong>${metrics.cardImageMatch}/${metrics.cardGenerated}</strong><span>卡片与图片一致</span></div>
    <div class="metric"><strong>${metrics.meanInterestingnessScore}</strong><span>平均趣味分 / 100</span></div>
    <div class="metric"><strong>${metrics.hardFailures}</strong><span>错误对象或无依据硬失败</span></div>
  </div></section>
  ${dailySections}
  <p class="note">边界：这是 30 张公开图片的本机评测，不等于真实用户相册、实体机后台调度或 App Store 上架验收。没有可靠命中时，产品应明确不出卡，而不是让模型猜。</p>
</main></body></html>`;

await writeFile(output, html, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`EVAL_REPORT_RENDERED=${output}\n`);

function noCardReason(result) {
  if (!result?.detection) return `本地筛掉：${result?.localPreflight?.sensitiveFlags?.join("、") || "隐私或质量不合格"}`;
  if (!result.catalogMatch) return `识别为“${result.detection.displayName}”，但审核知识库暂无可靠主题。`;
  if (result.editorialVerification?.decision === "reject") return `候选事实未通过图片适用性复核：${result.editorialVerification.reason}`;
  return "没有通过完整的事实匹配与发布校验。";
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) { return escapeHTML(value); }

function requiredPath(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return path.resolve(args[index + 1]);
}
