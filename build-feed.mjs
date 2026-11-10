// 手動の投稿（data/manual.json）と、無料で取れる各サービスの「いま話題」を集めて
// data/feed.json を作ります。どれか1つのサービスが失敗しても、他は続行します。
//
//   node scripts/build-feed.mjs
//
// 環境変数（すべて省略可）
//   YOUTUBE_API_KEY   YouTube Data API v3 のキー（未設定なら YouTube はスキップ）
//   YOUTUBE_REGION    急上昇の地域（既定: JP）
//   YOUTUBE_MAX       1カテゴリあたりの件数（既定: 20、最大 50）
//   PER_SOURCE        YouTube 以外の各サービスの件数（既定: 12）
//   MANUAL_MAX_DAYS   手動投稿を何日まで載せるか（既定: 0 = 無期限）
//   SKIP_SOURCES      止めたいサービスをカンマ区切りで（例: reddit,mastodon）

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manualPath = path.join(root, "data", "manual.json");
const feedPath = path.join(root, "data", "feed.json");

const env = process.env;
const region = env.YOUTUBE_REGION || "JP";
const ytMax = Math.min(Number(env.YOUTUBE_MAX || 20), 50);
const per = Number(env.PER_SOURCE || 12);
const manualMaxDays = Number(env.MANUAL_MAX_DAYS || 0);
const skip = new Set((env.SKIP_SOURCES || "").split(",").map((s) => s.trim()).filter(Boolean));
const UA = "Mozilla/5.0 (compatible; buzzlog/1.0; +https://github.com/)";

// ---------- 共通ヘルパー ----------
async function get(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}
const getJSON = async (url, opts) => (await get(url, opts)).json();
const getText = async (url, opts) => (await get(url, opts)).text();

const decode = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, "&");
const stripTags = (html = "") =>
  decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "")).trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]).trim() : "";
};
const items = (xml) => xml.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
const num = (s) => Number(String(s ?? "").replace(/[^\d]/g, "")) || 0;
const clip = (s = "", n = 280) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- 各サービス ----------
const sources = {
  // YouTube 急上昇（総合・音楽・ゲーム）
  async youtube() {
    if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY が未設定");
    const cats = [
      { id: "", label: "" },
      { id: "10", label: "音楽" },
      { id: "20", label: "ゲーム" },
    ];
    const out = [];
    for (const c of cats) {
      const api = new URL("https://www.googleapis.com/youtube/v3/videos");
      api.search = new URLSearchParams({
        part: "snippet,statistics", chart: "mostPopular", regionCode: region,
        maxResults: String(c.id ? Math.ceil(ytMax / 2) : ytMax), key: env.YOUTUBE_API_KEY,
        ...(c.id ? { videoCategoryId: c.id } : {}),
      });
      try {
        const data = await getJSON(api);
        for (const v of data.items || []) {
          out.push({
            platform: "youtube",
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: v.snippet?.title,
            author: v.snippet?.channelTitle,
            publishedAt: v.snippet?.publishedAt,
            tag: c.label,
            stats: [
              { label: "再生", value: num(v.statistics?.viewCount) },
              { label: "いいね", value: num(v.statistics?.likeCount) },
            ],
          });
        }
      } catch (e) {
        console.warn(`  YouTube(${c.label || "総合"}) 失敗: ${e.message}`);
      }
    }
    return out;
  },

  // Bluesky の「Discover（話題）」フィード
  async bluesky() {
    const feed = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";
    const data = await getJSON(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feed)}&limit=50`);
    return (data.feed || [])
      .map((f) => f.post)
      .filter((p) => p && !(p.labels || []).length && !(p.author?.labels || []).length)
      .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
      .slice(0, per)
      .map((p) => {
        const rkey = p.uri.split("/").pop();
        return {
          platform: "bluesky",
          url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
          author: p.author.displayName || p.author.handle,
          text: clip(p.record?.text || ""),
          publishedAt: p.record?.createdAt || p.indexedAt,
          embed: { uri: p.uri, cid: p.cid },
          stats: [
            { label: "いいね", value: p.likeCount || 0 },
            { label: "リポスト", value: p.repostCount || 0 },
          ],
        };
      });
  },

  // Misskey.io の「ハイライト」
  async misskey() {
    const notes = await getJSON("https://misskey.io/api/notes/featured", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 40 }),
    });
    return notes
      .filter((n) => n.text && !n.cw && !(n.files || []).some((f) => f.isSensitive) && n.visibility === "public")
      .map((n) => ({ n, react: Object.values(n.reactions || {}).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.react - a.react)
      .slice(0, per)
      .map(({ n, react }) => ({
        platform: "misskey",
        url: `https://misskey.io/notes/${n.id}`,
        author: n.user?.name || n.user?.username,
        text: clip(n.text),
        image: (n.files || []).find((f) => f.type?.startsWith("image/"))?.thumbnailUrl,
        publishedAt: n.createdAt,
        stats: [
          { label: "リアクション", value: react },
          { label: "リノート", value: n.renoteCount || 0 },
        ],
      }));
  },

  // Mastodon（mastodon.social）の話題の投稿
  async mastodon() {
    const list = await getJSON(`https://mastodon.social/api/v1/trends/statuses?limit=${Math.min(per, 20)}`);
    return list
      .filter((s) => !s.sensitive && !s.spoiler_text)
      .map((s) => ({
        platform: "mastodon",
        url: s.url,
        author: s.account?.display_name || s.account?.acct,
        text: clip(stripTags(s.content)),
        image: (s.media_attachments || []).find((m) => m.type === "image")?.preview_url,
        publishedAt: s.created_at,
        stats: [
          { label: "お気に入り", value: s.favourites_count || 0 },
          { label: "ブースト", value: s.reblogs_count || 0 },
        ],
      }));
  },

  // ニコニコ動画 24時間総合ランキング
  async niconico() {
    const xml = await getText("https://www.nicovideo.jp/ranking/genre/all?term=24h&rss=2.0&lang=ja-jp");
    return items(xml).slice(0, per).map((it) => {
      const link = tag(it, "link").split("?")[0];
      const desc = tag(it, "description");
      return {
        platform: "niconico",
        url: link,
        title: tag(it, "title").replace(/^第\d+位：/, ""),
        publishedAt: new Date(tag(it, "pubDate") || Date.now()).toISOString(),
        stats: [
          { label: "再生", value: num((desc.match(/nico-info-total-view">([\d,]+)/) || [])[1]) },
          { label: "コメント", value: num((desc.match(/nico-info-total-res">([\d,]+)/) || [])[1]) },
        ],
      };
    });
  },

  // はてなブックマーク 総合人気エントリー
  async hatena() {
    const xml = await getText("https://b.hatena.ne.jp/hotentry/all.rss");
    return items(xml).slice(0, per).map((it) => ({
      platform: "hatena",
      url: tag(it, "link"),
      title: tag(it, "title"),
      text: clip(tag(it, "description"), 140),
      image: tag(it, "hatena:imageurl") || undefined,
      publishedAt: tag(it, "dc:date"),
      stats: [{ label: "ブクマ", value: num(tag(it, "hatena:bookmarkcount")) }],
    }));
  },

  // Reddit r/popular（GitHub のサーバーからは拒否されることがあります）
  async reddit() {
    const data = await getJSON("https://www.reddit.com/r/popular/top.json?t=day&limit=40");
    return (data.data?.children || [])
      .map((c) => c.data)
      .filter((d) => !d.over_18 && !d.spoiler)
      .slice(0, per)
      .map((d) => ({
        platform: "reddit",
        url: `https://www.reddit.com${d.permalink}`,
        title: d.title,
        author: `r/${d.subreddit}`,
        image: /^https?:/.test(d.thumbnail || "") ? d.thumbnail : undefined,
        publishedAt: new Date(d.created_utc * 1000).toISOString(),
        stats: [
          { label: "スコア", value: d.score || 0 },
          { label: "コメント", value: d.num_comments || 0 },
        ],
      }));
  },

  // Hacker News トップ
  async hackernews() {
    const data = await getJSON("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30");
    return (data.hits || [])
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .slice(0, per)
      .map((h) => ({
        platform: "hackernews",
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title,
        author: h.author,
        publishedAt: h.created_at,
        stats: [
          { label: "ポイント", value: h.points || 0 },
          { label: "コメント", value: h.num_comments || 0 },
        ],
      }));
  },

  // Zenn デイリートレンド
  async zenn() {
    const data = await getJSON("https://zenn.dev/api/articles?order=daily&count=20");
    return (data.articles || []).slice(0, per).map((a) => ({
      platform: "zenn",
      url: `https://zenn.dev${a.path}`,
      title: `${a.emoji || ""} ${a.title}`.trim(),
      author: a.user?.name || a.user?.username,
      publishedAt: a.published_at,
      stats: [{ label: "いいね", value: a.liked_count || 0 }],
    }));
  },
};

// Google トレンド（急上昇ワード）はカードではなく、上部の帯に出します
async function fetchTrends() {
  const xml = await getText(`https://trends.google.com/trending/rss?geo=${region}`);
  return items(xml).slice(0, 20).map((it) => {
    const keyword = tag(it, "title");
    return {
      keyword,
      traffic: tag(it, "ht:approx_traffic"),
      url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}`,
    };
  });
}

// ---------- 実行 ----------
const manual = ((await readFile(manualPath, "utf8").then(JSON.parse).catch(() => ({}))).items) || [];
const now = Date.now();
const manualItems = manual
  .filter((i) => i && i.url)
  .filter((i) => !manualMaxDays || !i.addedAt || now - new Date(i.addedAt) < manualMaxDays * 86400e3)
  .map((i) => ({ ...i, source: "manual" }));

const report = [];
const results = await Promise.all(
  Object.entries(sources).map(async ([name, fn]) => {
    if (skip.has(name)) { report.push([name, "スキップ"]); return []; }
    try {
      const list = (await fn()).filter((i) => i.url).map((i) => ({ ...i, source: "auto" }));
      report.push([name, `${list.length} 件`]);
      return list;
    } catch (e) {
      report.push([name, `失敗（${e.message}）`]);
      return [];
    }
  }),
);

let trends = [];
if (!skip.has("trends")) {
  try { trends = await fetchTrends(); report.push(["google-trends", `${trends.length} 語`]); }
  catch (e) { report.push(["google-trends", `失敗（${e.message}）`]); }
}

const seen = new Set();
const all = [];
for (const i of [...manualItems, ...results.flat()]) {
  const key = i.url.replace(/#.*$/, "").replace(/\/$/, "");
  if (seen.has(key)) continue;
  seen.add(key);
  all.push(i);
}

await writeFile(feedPath, JSON.stringify({ updatedAt: new Date().toISOString(), trends, items: all }, null, 2) + "\n");

console.log("\n取得結果");
for (const [name, r] of report.sort()) console.log(`  ${name.padEnd(14)} ${r}`);
console.log(`  manual         ${manualItems.length} 件`);
console.log(`→ feed.json に合計 ${all.length} 件を書き出しました`);
