// バズログ: data/feed.json を読み込み、各媒体の公式埋め込みで表示する
(() => {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const sortSel = document.getElementById("sort");
  let items = [];
  let filter = "all";

  // URL から媒体とIDを判定
  function parse(url) {
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^www\.|^m\./, "");
      let m;
      if (h === "x.com" || h === "twitter.com") {
        if ((m = u.pathname.match(/\/status(?:es)?\/(\d+)/))) return { platform: "x", id: m[1] };
      }
      if (h === "youtube.com" || h === "youtu.be") {
        if (h === "youtu.be") return { platform: "youtube", id: u.pathname.slice(1), vertical: false };
        if ((m = u.pathname.match(/\/shorts\/([\w-]{6,})/))) return { platform: "youtube", id: m[1], vertical: true };
        if (u.searchParams.get("v")) return { platform: "youtube", id: u.searchParams.get("v"), vertical: false };
      }
      if (h === "tiktok.com" || h.endsWith(".tiktok.com")) {
        if ((m = u.pathname.match(/\/video\/(\d+)/))) return { platform: "tiktok", id: m[1] };
      }
      if (h === "instagram.com") {
        if ((m = u.pathname.match(/\/(p|reel|reels|tv)\/([\w-]+)/))) return { platform: "instagram", id: m[2], kind: m[1] === "reels" ? "reel" : m[1] };
      }
    } catch (e) { /* 不正なURL */ }
    return null;
  }

  // 外部スクリプト（X用）を一度だけ読み込む
  let twttrReady;
  function loadTwitter() {
    if (!twttrReady) {
      twttrReady = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "https://platform.twitter.com/widgets.js";
        s.async = true;
        s.onload = () => window.twttr.ready(resolve);
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return twttrReady;
  }

  function iframe(src, cls, title) {
    const f = document.createElement("iframe");
    f.src = src;
    f.className = cls;
    f.title = title;
    f.loading = "lazy";
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share";
    f.allowFullscreen = true;
    return f;
  }

  async function mount(el, item) {
    const p = item.parsed;
    el.textContent = "";
    if (p.platform === "youtube") {
      el.appendChild(iframe(`https://www.youtube-nocookie.com/embed/${p.id}`, p.vertical ? "ratio-9x16" : "ratio-16x9", item.title || "YouTube"));
    } else if (p.platform === "tiktok") {
      el.appendChild(iframe(`https://www.tiktok.com/embed/v2/${p.id}`, "ratio-9x16", item.title || "TikTok"));
    } else if (p.platform === "instagram") {
      el.appendChild(iframe(`https://www.instagram.com/${p.kind}/${p.id}/embed/`, "ig", item.title || "Instagram"));
    } else if (p.platform === "x") {
      const tw = await loadTwitter();
      if (tw && window.twttr?.widgets) {
        const box = document.createElement("div");
        box.style.width = "100%";
        el.appendChild(box);
        const theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        const res = await window.twttr.widgets.createTweet(p.id, box, { lang: "ja", theme, dnt: true, align: "center" });
        if (!res) el.innerHTML = `<p class="placeholder">この投稿は表示できません（削除・非公開の可能性）</p>`;
      } else {
        el.innerHTML = `<p class="placeholder">X の埋め込みを読み込めませんでした</p>`;
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

  const LABEL = { x: "X", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" };
  const fmt = (n) => n >= 1e8 ? (n / 1e8).toFixed(1) + "億" : n >= 1e4 ? (n / 1e4).toFixed(1) + "万" : String(n);
  const ago = (iso) => {
    const d = (Date.now() - new Date(iso)) / 1000;
    if (!isFinite(d)) return "";
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + "分前";
    if (d < 86400) return Math.round(d / 3600) + "時間前";
    return Math.round(d / 86400) + "日前";
  };

  function card(item) {
    const p = item.parsed;
    const c = document.createElement("article");
    c.className = "card";
    c.dataset.platform = p.platform;

    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<span class="badge ${p.platform}">${LABEL[p.platform]}</span>`;
    if (item.author) head.append(item.author);
    const src = document.createElement("span");
    src.className = "src" + (item.source === "auto" ? " auto" : "");
    src.textContent = item.source === "auto" ? "急上昇から自動取得" : "ピックアップ";
    head.appendChild(src);

    const embed = document.createElement("div");
    embed.className = "embed";
    embed.innerHTML = `<p class="placeholder">読み込み中…</p>`;
    embed._item = item;

    const body = document.createElement("div");
    body.className = "card-body";
    if (item.title) {
      const t = document.createElement("h2");
      t.className = "title";
      t.textContent = item.title;
      body.appendChild(t);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    if (item.views) meta.insertAdjacentHTML("beforeend", `<span>再生 <span class="num">${fmt(item.views)}</span></span>`);
    if (item.likes) meta.insertAdjacentHTML("beforeend", `<span>いいね <span class="num">${fmt(item.likes)}</span></span>`);
    if (item.note) { const n = document.createElement("span"); n.textContent = item.note; meta.appendChild(n); }
    const when = item.publishedAt || item.addedAt;
    if (when) meta.insertAdjacentHTML("beforeend", `<span>${ago(when)}</span>`);
    const a = document.createElement("a");
    a.className = "open";
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "元の投稿を開く ↗";
    meta.appendChild(a);
    body.appendChild(meta);

    c.append(head, embed, body);
    if (io) io.observe(embed); else mount(embed, item);
    return c;
  }

  function render() {
    const list = items
      .filter((i) => filter === "all" || i.parsed.platform === filter)
      .sort((a, b) =>
        sortSel.value === "views"
          ? (b.views || b.likes || 0) - (a.views || a.likes || 0)
          : new Date(b.publishedAt || b.addedAt || 0) - new Date(a.publishedAt || a.addedAt || 0));
    grid.textContent = "";
    list.forEach((i) => grid.appendChild(card(i)));
    empty.hidden = list.length > 0;
  }

  document.querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => {
      filter = b.dataset.filter;
      document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("is-on", x === b));
      render();
    }));
  sortSel.addEventListener("change", render);

  fetch("data/feed.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((feed) => {
      items = (feed.items || [])
        .map((i) => ({ ...i, parsed: parse(i.url) }))
        .filter((i) => i.parsed);
      for (const k of ["all", "x", "youtube", "tiktok", "instagram"]) {
        document.getElementById("count-" + k).textContent =
          k === "all" ? items.length : items.filter((i) => i.parsed.platform === k).length;
      }
      document.getElementById("updated").textContent =
        feed.updatedAt ? "更新 " + new Date(feed.updatedAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "";
      render();
    })
    .catch(() => {
      document.getElementById("updated").textContent = "";
      empty.hidden = false;
      empty.textContent = "data/feed.json を読み込めませんでした。";
    });
})();
