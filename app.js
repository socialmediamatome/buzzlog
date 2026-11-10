// バズログ: data/feed.json を読み込み、サービスごとに埋め込み・テキスト・リンクのカードで表示する
(() => {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const sortSel = document.getElementById("sort");
  const chipsEl = document.getElementById("chips");
  let items = [];
  let filter = "all";

  // サービスの表示名と、カードの種類（embed=公式埋め込み / text=本文カード / link=記事カード）
  const P = {
    youtube:    { label: "YouTube",     kind: "embed" },
    x:          { label: "X",           kind: "embed" },
    tiktok:     { label: "TikTok",      kind: "embed" },
    instagram:  { label: "Instagram",   kind: "embed" },
    niconico:   { label: "ニコニコ",     kind: "embed" },
    bluesky:    { label: "Bluesky",     kind: "embed" },
    misskey:    { label: "Misskey",     kind: "text" },
    mastodon:   { label: "Mastodon",    kind: "text" },
    hatena:     { label: "はてブ",       kind: "link" },
    reddit:     { label: "Reddit",      kind: "link" },
    hackernews: { label: "Hacker News", kind: "link" },
    zenn:       { label: "Zenn",        kind: "link" },
    web:        { label: "Web",         kind: "link" },
  };

  // URL から媒体とIDを判定（手動追加の投稿用）
  function parse(url) {
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^(www|m|mobile)\./, "");
      let m;
      if ((h === "x.com" || h === "twitter.com") && (m = u.pathname.match(/\/status(?:es)?\/(\d+)/))) return { platform: "x", id: m[1] };
      if (h === "youtu.be") return { platform: "youtube", id: u.pathname.slice(1) };
      if (h === "youtube.com") {
        if ((m = u.pathname.match(/\/shorts\/([\w-]{6,})/))) return { platform: "youtube", id: m[1], vertical: true };
        if (u.searchParams.get("v")) return { platform: "youtube", id: u.searchParams.get("v") };
      }
      if (h.endsWith("tiktok.com") && (m = u.pathname.match(/\/video\/(\d+)/))) return { platform: "tiktok", id: m[1] };
      if (h === "instagram.com" && (m = u.pathname.match(/\/(p|reel|reels|tv)\/([\w-]+)/))) return { platform: "instagram", id: m[2], kind: m[1] === "reels" ? "reel" : m[1] };
      if ((h === "nicovideo.jp" || h === "nico.ms") && (m = u.pathname.match(/((?:sm|so|nm)\d+)/))) return { platform: "niconico", id: m[1] };
      if (h === "bsky.app") return { platform: "bluesky" };
      if (h === "misskey.io") return { platform: "misskey" };
      if (h === "reddit.com") return { platform: "reddit" };
      if (h === "zenn.dev") return { platform: "zenn" };
      return { platform: "web" };
    } catch (e) { return null; }
  }

  // 外部スクリプトを一度だけ読み込む
  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = src; s.async = true; s.charset = "utf-8";
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  function iframe(src, cls, title) {
    const f = document.createElement("iframe");
    f.src = src; f.className = cls; f.title = title; f.loading = "lazy";
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share";
    f.allowFullscreen = true;
    return f;
  }
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

  async function mount(el, item) {
    const p = item.parsed;
    el.textContent = "";
    const title = item.title || P[item.platform].label;
    switch (item.platform) {
      case "youtube":
        el.appendChild(iframe(`https://www.youtube-nocookie.com/embed/${p.id}`, p.vertical ? "ratio-9x16" : "ratio-16x9", title));
        break;
      case "niconico":
        el.appendChild(iframe(`https://embed.nicovideo.jp/watch/${p.id}`, "ratio-16x9", title));
        break;
      case "tiktok":
        el.appendChild(iframe(`https://www.tiktok.com/embed/v2/${p.id}`, "ratio-9x16", title));
        break;
      case "instagram":
        el.appendChild(iframe(`https://www.instagram.com/${p.kind}/${p.id}/embed/`, "ig", title));
        break;
      case "x": {
        const ok = await loadScript("https://platform.twitter.com/widgets.js");
        if (ok && window.twttr?.widgets) {
          const box = document.createElement("div");
          box.style.width = "100%";
          el.appendChild(box);
          const res = await window.twttr.widgets.createTweet(p.id, box, { lang: "ja", theme: dark() ? "dark" : "light", dnt: true, align: "center" });
          if (!res) el.innerHTML = `<p class="placeholder">この投稿は表示できません（削除・非公開の可能性）</p>`;
        } else el.innerHTML = `<p class="placeholder">X の埋め込みを読み込めませんでした</p>`;
        break;
      }
      case "bluesky": {
        if (!item.embed) { el.replaceWith(textBlock(item)); break; }
        const bq = document.createElement("blockquote");
        bq.className = "bluesky-embed";
        bq.dataset.blueskyUri = item.embed.uri;
        bq.dataset.blueskyCid = item.embed.cid;
        bq.dataset.blueskyEmbedColorMode = "system";
        const t = document.createElement("p");
        t.textContent = item.text || "";
        bq.appendChild(t);
        el.appendChild(bq);
        await loadScript("https://embed.bsky.app/static/embed.js");
        window.bluesky?.scan?.(el);
        break;
      }
    }
  }

  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          mount(e.target, e.target._item);
        }
      }, { rootMargin: "600px 0px" })
    : null;

  const fmt = (n) => n >= 1e8 ? (n / 1e8).toFixed(1) + "億" : n >= 1e4 ? (n / 1e4).toFixed(1) + "万" : n.toLocaleString("ja-JP");
  const ago = (iso) => {
    const d = (Date.now() - new Date(iso)) / 1000;
    if (!isFinite(d)) return "";
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + "分前";
    if (d < 86400) return Math.round(d / 3600) + "時間前";
    return Math.round(d / 86400) + "日前";
  };
  const score = (i) => Math.max(0, ...(i.stats || []).map((s) => s.value || 0), i.views || 0, i.likes || 0);

  function textBlock(item) {
    const b = document.createElement("div");
    b.className = "textbody";
    const p = document.createElement("p");
    p.textContent = item.text || "";
    b.appendChild(p);
    if (item.image) {
      const img = document.createElement("img");
      img.src = item.image; img.alt = ""; img.loading = "lazy";
      img.onerror = () => img.remove();
      b.appendChild(img);
    }
    return b;
  }

  function card(item) {
    const kind = P[item.platform].kind;
    const c = document.createElement("article");
    c.className = `card kind-${kind}`;

    const head = document.createElement("div");
    head.className = "card-head";
    const badge = document.createElement("span");
    badge.className = `badge p-${item.platform}`;
    badge.textContent = P[item.platform].label;
    head.appendChild(badge);
    if (item.tag) { const t = document.createElement("span"); t.className = "tag"; t.textContent = item.tag; head.appendChild(t); }
    if (item.author) { const a = document.createElement("span"); a.className = "author"; a.textContent = item.author; head.appendChild(a); }
    const src = document.createElement("span");
    src.className = "src" + (item.source === "auto" ? " auto" : "");
    src.textContent = item.source === "auto" ? "自動" : "ピックアップ";
    head.appendChild(src);
    c.appendChild(head);

    if (kind === "embed") {
      const embed = document.createElement("div");
      embed.className = "embed";
      embed.innerHTML = `<p class="placeholder">読み込み中…</p>`;
      embed._item = item;
      c.appendChild(embed);
      if (io) io.observe(embed); else mount(embed, item);
    } else if (kind === "text") {
      c.appendChild(textBlock(item));
    } else if (item.image) {
      const img = document.createElement("img");
      img.className = "thumb"; img.src = item.image; img.alt = ""; img.loading = "lazy";
      img.onerror = () => img.remove();
      c.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "card-body";
    if (item.title) {
      const t = document.createElement("h2");
      t.className = "title";
      t.textContent = item.title;
      body.appendChild(t);
    }
    if (kind === "link" && item.text) {
      const d = document.createElement("p");
      d.className = "desc";
      d.textContent = item.text;
      body.appendChild(d);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    const stats = item.stats || [
      item.views && { label: "再生", value: item.views },
      item.likes && { label: "いいね", value: item.likes },
    ].filter(Boolean);
    for (const s of stats) {
      if (!s.value) continue;
      const span = document.createElement("span");
      span.innerHTML = `${s.label} <span class="num">${fmt(s.value)}</span>`;
      meta.appendChild(span);
    }
    if (item.note) { const n = document.createElement("span"); n.textContent = item.note; meta.appendChild(n); }
    const when = item.publishedAt || item.addedAt;
    if (when) { const w = document.createElement("span"); w.textContent = ago(when); meta.appendChild(w); }
    const a = document.createElement("a");
    a.className = "open"; a.href = item.url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = kind === "link" ? "記事を開く ↗" : "元の投稿を開く ↗";
    meta.appendChild(a);
    body.appendChild(meta);
    c.appendChild(body);
    return c;
  }

  // ミックス: 手動ピックアップを先頭に、残りはサービスを順番に1件ずつ混ぜる（各サービス内は反応順）
  function mix(list) {
    const manual = list.filter((i) => i.source !== "auto");
    const groups = {};
    for (const i of list.filter((i) => i.source === "auto")) (groups[i.platform] ||= []).push(i);
    Object.values(groups).forEach((g) => g.sort((a, b) => score(b) - score(a)));
    const out = [...manual];
    const qs = Object.values(groups);
    while (qs.some((q) => q.length)) for (const q of qs) if (q.length) out.push(q.shift());
    return out;
  }

  function render() {
    let list = items.filter((i) => filter === "all" || i.platform === filter);
    if (sortSel.value === "mix") list = mix(list);
    else if (sortSel.value === "score") list.sort((a, b) => score(b) - score(a));
    else list.sort((a, b) => new Date(b.publishedAt || b.addedAt || 0) - new Date(a.publishedAt || a.addedAt || 0));
    grid.textContent = "";
    list.forEach((i) => grid.appendChild(card(i)));
    empty.hidden = list.length > 0;
  }

  function buildChips() {
    const counts = {};
    for (const i of items) counts[i.platform] = (counts[i.platform] || 0) + 1;
    const order = Object.keys(P).filter((k) => counts[k]);
    chipsEl.textContent = "";
    for (const k of ["all", ...order]) {
      const b = document.createElement("button");
      b.className = "chip" + (k === filter ? " is-on" : "");
      b.dataset.filter = k;
      b.innerHTML = `${k === "all" ? "すべて" : P[k].label} <b>${k === "all" ? items.length : counts[k]}</b>`;
      b.addEventListener("click", () => {
        filter = k;
        chipsEl.querySelectorAll(".chip").forEach((x) => x.classList.toggle("is-on", x === b));
        render();
      });
      chipsEl.appendChild(b);
    }
  }

  function buildTrends(trends) {
    if (!trends?.length) return;
    const ol = document.getElementById("trends-list");
    for (const t of trends) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = t.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = t.keyword;
      li.appendChild(a);
      if (t.traffic) { const s = document.createElement("span"); s.textContent = t.traffic; li.appendChild(s); }
      ol.appendChild(li);
    }
    document.getElementById("trends").hidden = false;
  }

  sortSel.addEventListener("change", render);

  fetch("data/feed.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((feed) => {
      items = (feed.items || [])
        .map((i) => {
          const parsed = parse(i.url);
          return parsed ? { ...i, parsed, platform: i.platform || parsed.platform } : null;
        })
        .filter((i) => i && P[i.platform]);
      document.getElementById("updated").textContent =
        feed.updatedAt ? "更新 " + new Date(feed.updatedAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "";
      buildTrends(feed.trends);
      buildChips();
      render();
    })
    .catch(() => {
      document.getElementById("updated").textContent = "";
      empty.hidden = false;
      empty.textContent = "data/feed.json を読み込めませんでした。";
    });
})();
