// data/manual.json（手動で追加した投稿）と YouTube の急上昇（自動取得）をまとめて
// data/feed.json を作ります。
//
//   node scripts/build-feed.mjs
//
// 環境変数
//   YOUTUBE_API_KEY   YouTube Data API v3 のキー（未設定なら自動取得はスキップ）
//   YOUTUBE_REGION    急上昇の地域（既定: JP）
//   YOUTUBE_MAX       取得件数（既定: 20、最大 50）
//   MANUAL_MAX_DAYS   手動投稿を何日まで載せるか（既定: 0 = 無期限）

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manualPath = path.join(root, "data", "manual.json");
const feedPath = path.join(root, "data", "feed.json");

const env = process.env;
const region = env.YOUTUBE_REGION || "JP";
const maxResults = Math.min(Number(env.YOUTUBE_MAX || 20), 50);
const manualMaxDays = Number(env.MANUAL_MAX_DAYS || 0);

async function readJSON(p, fallback) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (k !== "v") u.searchParams.delete(k);
    return u.toString();
  } catch { return null; }
}

async function fetchYouTubeTrending() {
  if (!env.YOUTUBE_API_KEY) {
    console.log("YOUTUBE_API_KEY が未設定のため、YouTube の自動取得はスキップします");
    return [];
  }
  const api = new URL("https://www.googleapis.com/youtube/v3/videos");
  api.search = new URLSearchParams({
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode: region,
    maxResults: String(maxResults),
    key: env.YOUTUBE_API_KEY,
  });
  const res = await fetch(api);
  if (!res.ok) {
    console.error("YouTube API エラー:", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return (data.items || []).map((v) => ({
    url: `https://www.youtube.com/watch?v=${v.id}`,
    title: v.snippet?.title,
    author: v.snippet?.channelTitle,
    publishedAt: v.snippet?.publishedAt,
    views: Number(v.statistics?.viewCount || 0),
    likes: Number(v.statistics?.likeCount || 0),
    source: "auto",
  }));
}

const manual = (await readJSON(manualPath, { items: [] })).items || [];
const now = Date.now();
const manualItems = manual
  .filter((i) => i && i.url)
  .filter((i) => !manualMaxDays || !i.addedAt || now - new Date(i.addedAt) < manualMaxDays * 86400e3)
  .map((i) => ({ ...i, source: "manual" }));

const auto = await fetchYouTubeTrending();

// 重複URLは手動の方を優先
const seen = new Set();
const items = [];
for (const i of [...manualItems, ...auto]) {
  const key = normalizeUrl(i.url);
  if (!key || seen.has(key)) continue;
  seen.add(key);
  items.push(i);
}

await writeFile(feedPath, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`feed.json を更新: 手動 ${manualItems.length} 件 / 自動 ${auto.length} 件 → 合計 ${items.length} 件`);
