const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const PAGE = 30;
const state = { tab: "foryou", items: [], active: -1, q: "", meta: null, explain: false, brief: null, total: 0, limit: PAGE, more: false };
let tuningDirty = false;
const LANG = { TypeScript: "#3178c6", JavaScript: "#e0c341", Python: "#3572a5", Go: "#00add8", Rust: "#dea584", Swift: "#f05138", Java: "#b07219", "C++": "#f34b7d", C: "#7a7a7a", HCL: "#844fba", Kotlin: "#a97bff", Ruby: "#cc342d", Zig: "#ec915c" };
// Mirrors the base-score weights in src/rank.ts scoreItems(); keep the two in step.
const WEIGHTS = {
  withAi: { interest: 0.38, popularity: 0.18, learned: 0.14, ai: 0.3 },
  withoutAi: { interest: 0.5, popularity: 0.3, learned: 0.2 },
};
// The CDN script is absent offline; every motion call checks this first.
const gsap = window.gsap;
const motion = !!gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- formatting ----------
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
const num = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const signed = (n) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(2)}`;
const relevance = (it) => Math.round(Math.max(0.04, Math.min(1, (it.score - 0.1) / 0.6)) * 100);
const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function spark(points, w = 56, h = 14, cls = "spark") {
  if (!points || points.length < 3) return "";
  const ys = points.map((p) => p.stars), min = Math.min(...ys), max = Math.max(...ys);
  const d = ys.map((y, i) => `${(i / (ys.length - 1)) * w},${h - ((y - min) / Math.max(1, max - min)) * h}`).join(" ");
  return `<svg class="${cls}" width="${w}" height="${h}" viewBox="0 -1 ${w} ${h + 2}" preserveAspectRatio="none" aria-label="star history"><polyline points="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

const icons = {
  up: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15V5M5 10l5-5 5 5"/></svg>`,
  down: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5v10M5 10l5 5 5-5"/></svg>`,
  save: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5.5 3.5h9v13l-4.5-3-4.5 3z"/></svg>`,
  saved: `<svg viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5.5 3.5h9v13l-4.5-3-4.5 3z"/></svg>`,
  hide: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l8 8M14 6l-8 8"/></svg>`,
};

function actionButtons(it) {
  const s = it.state;
  return `<button class="act up" data-act="up" aria-pressed="${s.vote === 1}" title="More like this (u)" aria-label="More like this">${icons.up}</button>
    <button class="act down" data-act="down" aria-pressed="${s.vote === -1}" title="Less like this (d)" aria-label="Less like this">${icons.down}</button>
    <button class="act save" data-act="${s.saved ? "unsave" : "save"}" aria-pressed="${s.saved}" title="Save (s)" aria-label="Save">${s.saved ? icons.saved : icons.save}</button>
    <button class="act" data-act="hide" title="Hide (x)" aria-label="Hide">${icons.hide}</button>`;
}

function factorTip(it) {
  const f = it.factors;
  return `Relevance ${relevance(it)}%. Interests ${f.interest}, learned ${f.learned}, popularity ${f.popularity}${f.ai != null ? `, AI ${f.ai}` : ""}, freshness ${f.recency}`;
}

// ---------- rendering ----------
function rowHtml(it, i) {
  const pct = relevance(it);
  const meta = [];
  if (it.repo) {
    if (it.repo.language) meta.push(`<span class="lang" style="--lang:${LANG[it.repo.language] ?? "var(--muted)"}">${esc(it.repo.language)}</span>`);
    meta.push(`<span>${num(it.repo.stars)} stars</span>`);
    if (it.repo.starsToday) meta.push(`<span class="hot">+${num(it.repo.starsToday)} today</span>`);
    if (it.velocity?.length >= 3) meta.push(`<span>${spark(it.velocity)}</span>`);
    meta.push(`<span>${esc(it.source === "GitHub New" ? `new, created ${ago(it.repo.createdAt ? Date.parse(it.repo.createdAt) : it.publishedAt)}` : `trending since ${ago(it.publishedAt)}`)}</span>`);
  } else {
    meta.push(`<span>${esc(it.source)}</span>`);
    const h = host(it.url);
    if (h && !it.source.toLowerCase().includes(h.split(".")[0])) meta.push(`<span>${esc(h)}</span>`);
    meta.push(`<span>${ago(it.publishedAt)}</span>`);
    if (it.points != null) meta.push(it.commentsUrl ? `<a href="${esc(it.commentsUrl)}" target="_blank" rel="noopener">${it.points} points, ${it.comments ?? 0} comments</a>` : `<span>${it.points} points</span>`);
  }
  if (it.matched.length) meta.push(`<span>${esc(it.matched.slice(0, 2).join(", "))}</span>`);

  const [owner, name] = it.repo ? it.title.split("/") : [];
  const title = it.repo ? `<span class="repo-owner">${esc(owner)}/</span>${esc(name)}` : esc(it.title);
  const tldr = it.aiTldr || it.summary;
  const tip = factorTip(it);
  const active = i === state.active;
  return `<li class="row${active ? " active" : ""}" data-i="${i}" data-id="${esc(it.id)}" tabindex="-1">
    <div class="rel" title="${esc(tip)}" role="img" aria-label="Relevance ${pct}%"><span class="rel-n">${pct}</span><span class="rel-bar"><i style="width:${pct}%"></i></span></div>
    <div class="body">
      <h3 class="title"><a href="${esc(it.url)}" target="_blank" rel="noopener" data-open>${title}</a></h3>
      ${tldr ? `<p class="tldr">${esc(tldr)}</p>` : ""}
      ${it.aiWhy ? `<p class="why"><span>Why</span> ${esc(it.aiWhy)}</p>` : ""}
      <div class="meta">${meta.join("")}</div>
      ${active && state.explain ? `<p class="factors">${esc(tip)}</p>` : ""}
    </div>
    <div class="actions">${actionButtons(it)}</div>
  </li>`;
}

/** The selected item, with each ranking signal shown as what it added to the score. */
function detailHtml(it) {
  const f = it.factors;
  const w = f.ai != null ? WEIGHTS.withAi : WEIGHTS.withoutAi;
  const signals = [
    ["Your interests", f.interest, w.interest, it.matched.length ? it.matched.slice(0, 3).join(", ") : "No topic matched"],
    ["Learned from votes", f.learned, w.learned, ""],
    ["Popularity", f.popularity, w.popularity, it.repo ? "Stars per day" : it.points != null ? "Points and comments" : "No popularity signal"],
    ...(f.ai != null ? [["AI relevance", f.ai, w.ai, ""]] : []),
  ];
  const base = signals.reduce((s, [, v, wt]) => s + v * wt, 0);
  const fresh = 0.35 + 0.65 * f.recency;
  const muted = base * fresh > 0.01 && it.score < base * fresh * 0.5;
  const tldr = it.aiTldr || it.summary;
  const h = host(it.url);
  const metaLine = it.repo ? [it.source, it.repo.language].filter(Boolean) : [it.source, h && !it.source.toLowerCase().includes(h.split(".")[0]) ? h : "", ago(it.publishedAt)].filter(Boolean);
  const stars = it.velocity?.length >= 3 ? it.velocity : null;

  return `<p class="d-meta">${metaLine.map(esc).join(" · ")}</p>
    <h2 class="d-title"><a href="${esc(it.url)}" target="_blank" rel="noopener" data-open>${esc(it.title)}</a></h2>
    ${tldr ? `<p class="d-tldr">${esc(tldr)}</p>` : ""}
    ${it.aiWhy ? `<p class="d-why"><strong>Why it's here.</strong> ${esc(it.aiWhy)}</p>` : ""}
    ${it.repo ? `<div class="d-section">
      <div class="d-facts"><span><strong>${it.repo.stars.toLocaleString()}</strong> stars</span>${it.repo.starsToday ? `<span><strong>+${it.repo.starsToday.toLocaleString()}</strong> today</span>` : ""}${it.repo.forks != null ? `<span>${it.repo.forks.toLocaleString()} forks</span>` : ""}</div>
      ${stars ? `${spark(stars, 300, 40, "d-spark")}<p class="d-note">Stars went from ${stars[0].stars.toLocaleString()} to ${stars.at(-1).stars.toLocaleString()} over ${plural(stars.length, "day")}</p>` : ""}
    </div>` : ""}
    <div class="d-section">
      <div class="d-score"><span>Relevance</span><strong><span class="d-score-n">${relevance(it)}</span><small>%</small></strong></div>
      ${signals.map(([label, v, wt, note]) => `<div class="factor">
        <span>${esc(label)}${note ? `<small>${esc(note)}</small>` : ""}</span>
        <span class="bar${v < 0 ? " neg" : ""}" role="img" aria-label="${esc(label)} ${v.toFixed(2)}"><i style="width:${Math.round(Math.min(1, Math.abs(v)) * 100)}%"></i></span>
        <span class="add">${signed(v * wt)}</span>
      </div>`).join("")}
      <p class="d-note">Then × ${fresh.toFixed(2)} for freshness (${it.repo ? "trending" : "published"} ${ago(it.publishedAt)})${muted ? ", and × 0.05 for a muted word" : ""}.</p>
    </div>
    <div class="d-actions">
      <a class="btn primary" href="${esc(it.url)}" target="_blank" rel="noopener" data-open>Open <kbd>o</kbd></a>
      ${actionButtons(it)}
    </div>`;
}

let shownId = null, shownRel = 0;
function renderDetail() {
  const el = $("#detail");
  const it = state.items[state.active];
  if (!it) { el.hidden = true; el.innerHTML = ""; shownId = null; shownRel = 0; return; }
  el.hidden = false;
  el.innerHTML = detailHtml(it);
  if (motion && shownId && it.id !== shownId) gsap.fromTo(el.children, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.24, stagger: 0.02, ease: "power2.out", clearProps: "opacity,transform" });
  if (it.id !== shownId) roll($(".d-score-n", el), relevance(it), shownRel);
  shownId = it.id; shownRel = relevance(it);
}

function renderList() {
  const list = $("#list");
  const noun = { repos: "repo", blogs: "post", saved: "item" }[state.tab] ?? "story";
  const n = state.items.length;
  const count = $("#count");
  count.innerHTML = `<span>${n}</span> ${n === 1 ? noun : noun === "story" ? "stories" : `${noun}s`}${state.q ? ` matching “${esc(state.q)}”` : ""}`;
  if (renderList.count != null && renderList.count !== n) roll(count.firstElementChild, n, renderList.count);
  renderList.count = n;
  if (!n) {
    const empty = {
      foryou: state.meta?.running ? ["Fetching your feed", "This takes a minute on the first run."] : ["Nothing here yet", "Press Refresh to fetch stories, or loosen your filter."],
      repos: ["No repos yet", "Press Refresh to pull GitHub Trending."],
      blogs: ["No posts yet", "Press Refresh to pull the engineering blogs."],
      saved: ["Nothing saved", "Press s on any story or repo to keep it here."],
    }[state.tab] ?? ["No matches", ""];
    if (state.q) empty.splice(0, 2, "No matches", `Nothing in this tab mentions “${state.q}”.`);
    list.innerHTML = `<li class="empty"><strong>${esc(empty[0])}</strong>${esc(empty[1])}</li>`;
    renderDetail();
    return;
  }
  const hadRowFocus = document.activeElement?.closest?.(".row");
  list.innerHTML = state.items.map(rowHtml).join("");
  if (hadRowFocus) focusActive();
  renderDetail();
}

function focusActive() {
  const row = document.querySelector(`.row[data-i="${state.active}"]`);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: "nearest" });
}

function renderTitle() {
  const n = state.items.length;
  const [title, sub] = {
    foryou: [
      state.brief?.headline || `${greeting()}. ${state.total ? `${state.total} ${state.total === 1 ? "story is" : "stories are"} waiting.` : state.meta?.running ? "Your feed is on its way." : "Your feed is empty."}`,
      `${today()} · ranked from the last 3 days`,
    ],
    repos: ["Trending repos", `${today()} · ${plural(n, "repo")} from the last 7 days, sorted by fit`],
    blogs: ["Engineering blogs", `${plural(n, "post")} from company engineering blogs in the last 60 days, sorted by fit`],
    saved: ["Saved", `${plural(n, "item")} kept for later`],
    tuning: ["Tuning", "What Pulse ranks for, and what it has learned from your votes."],
  }[state.tab];
  $("#title").textContent = title;
  $("#subline").textContent = sub;
  $("#list-heading").textContent = { foryou: "Ranked for you", repos: "Ranked repos", blogs: "Ranked posts", saved: "Saved items" }[state.tab] ?? "";
  document.body.dataset.tab = state.tab;
}

function renderBrief() {
  const el = $("#brief");
  const brief = state.brief;
  if (state.tab !== "foryou" || state.q || !brief || !brief.bullets.length) { el.hidden = true; return; }
  el.innerHTML = `<div class="brief-head"><h2>The brief</h2><span>Written ${ago(brief.generatedAt)}</span></div>
    <ul>${brief.bullets.map((b) =>
      `<li>${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.text)}</a>` : `<span>${esc(b.text)}</span>`}</li>`).join("")}</ul>`;
  el.hidden = false;
}

async function load({ animate = null } = {}) {
  if (state.tab === "tuning") return renderTuning();
  $("#tuning").hidden = true; $("#workspace").hidden = false;
  const tab = state.tab;
  const [data, briefRes] = await Promise.all([
    api(`/api/feed?tab=${tab}&limit=${state.limit}${state.q ? `&q=${encodeURIComponent(state.q)}` : ""}`),
    tab === "foryou" ? api("/api/brief") : null,
  ]);
  if (state.tab !== tab) return;
  state.items = data.items; state.meta = data.meta; state.brief = briefRes?.brief ?? null;
  state.more = data.items.length >= state.limit;
  if (!state.q) state.total = state.items.length;
  state.active = state.items.length ? Math.max(0, Math.min(state.active, state.items.length - 1)) : -1;
  renderTitle(); renderBrief(); renderList(); renderSync();
  if (animate) enter(animate);
  if (data.meta.running && !poll.active) poll();
}

function renderSync() {
  const m = state.meta; if (!m) return;
  const btn = $("#refresh");
  btn.disabled = m.running;
  btn.textContent = m.running ? "Refreshing" : "Refresh";
  document.body.classList.toggle("is-syncing", !!m.running);
  $("#sync-status").textContent = m.running ? m.phase : m.lastRun ? `Updated ${ago(m.lastRun)}${m.mock ? ", demo data" : ""}` : "";
  const bar = $("#sync-bar");
  bar.hidden = !m.running;
  $("i", bar).style.width = m.running ? `${Math.round(syncProgress(m.phase) * 100)}%` : "0";
  if (m.llm) $("#llm-line").textContent = m.llm.provider === "none" ? "AI off" : `AI: ${m.llm.provider}${m.llm.model ? `, ${m.llm.model}` : ""}`;
}

// The server reports progress only as a phase name; these mirror the phases set in src/refresh.ts.
function syncProgress(phase = "") {
  const step = phase.match(/^summarizing (\d+)\/(\d+)/);
  if (step) return 0.35 + 0.5 * (step[1] / step[2]);
  if (phase.startsWith("summarizing")) return 0.35;
  return { fetching: 0.15, ranking: 0.3, "writing brief": 0.9 }[phase] ?? 0.05;
}

// ---------- motion ----------
const GLYPHS = "#*@!&?%01$";

/** Text resolves left to right out of random glyphs; spaces stay put so words keep their shape. */
function scramble(el, delay = 0) {
  if (!motion || !el) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const originals = nodes.map((n) => n.data);
  const total = originals.reduce((s, t) => s + t.length, 0);
  const p = { v: 0 };
  gsap.to(p, {
    v: 1, delay, duration: 0.6, ease: "power1.out",
    onUpdate: () => {
      let g = 0;
      const reveal = Math.floor(total * p.v);
      nodes.forEach((n, i) => {
        n.data = [...originals[i]].map((c) => (g++ < reveal || /\s/.test(c) ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
      });
    },
    onComplete: () => nodes.forEach((n, i) => { n.data = originals[i]; }),
  });
}

/** Odometer: each digit column rolls from its old digit to its new one, staggered left to right. */
function roll(el, to, from = 0, delay = 0) {
  if (!motion || !el) return;
  const text = String(to);
  const prev = String(from).padStart(text.length, "0").slice(-text.length);
  const spin = from === 0 ? 10 : 0;
  const slots = [...text].map((d, i) => {
    const a = Number(prev[i]), steps = ((Number(d) - a + 10) % 10) + spin;
    return { steps, cells: Array.from({ length: steps + 1 }, (_, k) => `<span>${(a + k) % 10}</span>`).join("") };
  });
  el.classList.add("odo");
  el.innerHTML = `<span class="odo-ghost">${text}</span><span class="odo-roll" aria-hidden="true">${slots.map((s) => `<span class="odo-slot"><span class="odo-strip">${s.cells}</span></span>`).join("")}</span>`;
  const strips = $$(".odo-strip", el);
  const tl = gsap.timeline({ delay, onComplete: () => { el.classList.remove("odo"); el.textContent = text; } });
  slots.forEach((s, i) => tl.fromTo(strips[i], { yPercent: 0 }, { yPercent: (-100 * s.steps) / (s.steps + 1), duration: 0.5 + s.steps * 0.02, ease: "power3.out" }, i * 0.05));
}

/** Splits text into per-char spans that flicker in; screen readers get the plain text. */
function flickerIn(el, delay = 0) {
  if (!motion || !el) return;
  const text = el.textContent;
  let n = 0;
  const words = text.split(" ").map((w) => `<span class="split-word">${[...w].map((c) => `<span class="split-char" style="--char:${n++}">${esc(c)}</span>`).join("")}</span>`);
  el.innerHTML = `<span class="sr-only">${esc(text)}</span><span aria-hidden="true">${words.join(" ")}</span>`;
  el.style.setProperty("--flicker-delay", `${delay}s`);
  el.classList.remove("flicker-in");
  void el.offsetWidth;
  el.classList.add("flicker-in");
}

/** Sections arrive in reading order: the title, the brief, then the first rows. "page" is the full entrance, "rows" a lighter one. */
function enter(kind = "page", delay = 0) {
  if (!motion) return;
  const rows = $$("#list > li").slice(0, 12);
  const tl = gsap.timeline({ delay, defaults: { ease: "power3.out", duration: 0.6, clearProps: "opacity,transform" } });
  if (kind === "page") {
    flickerIn($("#title"), delay);
    tl.from("#subline", { y: 14, opacity: 0 }, 0.2)
      .from($$("#brief:not([hidden]) > *, #brief:not([hidden]) li"), { y: 18, opacity: 0, stagger: 0.06 }, "-=0.45")
      .from(".toolbar", { y: 12, opacity: 0 }, "-=0.45");
  } else {
    tl.from("#title, #subline", { y: 12, opacity: 0, stagger: 0.06, duration: 0.45 });
  }
  const stagger = kind === "page" ? 0.05 : 0.03;
  tl.from(rows, { y: kind === "page" ? 22 : 12, opacity: 0, stagger, duration: kind === "page" ? 0.6 : 0.4 }, kind === "page" ? "-=0.4" : "-=0.3")
    .call(() => rows.forEach((row, i) => {
      scramble($(".title a", row), i * stagger);
      const rel = $(".rel-n", row);
      if (rel) roll(rel, Number(rel.textContent), 0, i * stagger);
    }), null, "<")
    .from($$("#detail:not([hidden])"), { x: 20, opacity: 0, duration: 0.7 }, "<0.1");
}

/** A blip lands just behind the sweep's leading edge, flares, then decays like phosphor. */
function blip(sweep) {
  const angle = (gsap.getProperty(sweep, "rotation") % 360) * (Math.PI / 180);
  const r = 0.25 + Math.random() * 0.65;
  const el = document.createElement("i");
  el.style.left = `${50 + 50 * r * Math.sin(angle)}%`;
  el.style.top = `${50 - 50 * r * Math.cos(angle)}%`;
  $("#radar-blips").append(el);
  gsap.timeline()
    .fromTo(el, { scale: 0, opacity: 1 }, { scale: 1.6, duration: 0.18, ease: "power2.out" })
    .to(el, { scale: 1, duration: 0.3 })
    .to(el, { opacity: 0.3, duration: 1.6, ease: "power1.out" }, "<");
}

/**
 * The page-load intro: a radar sweeps while the first feed response lands, and each source that
 * answered the last refresh drops a blip. Then the screen collapses into the centre dot and the
 * dot flies home to the sidebar mark.
 */
function intro(ready) {
  const root = document.documentElement;
  const finish = () => root.classList.remove("intro-on");
  if (!root.classList.contains("intro-on")) return ready.then(() => enter("page"));
  if (!motion) { finish(); return ready; }

  const dot = $("#intro-dot"), sweep = $("#radar-sweep"), letters = $$(".intro-word span");
  const radar = $("#intro-radar").getBoundingClientRect();
  const cx = radar.left + radar.width / 2, cy = radar.top + radar.height / 2;
  gsap.set(dot, { x: cx - 12, y: cy - 12 });
  const spin = gsap.to(sweep, { rotation: 360, duration: 2.4, ease: "none", repeat: -1 });
  gsap.from("#intro-radar svg circle", { scale: 0, transformOrigin: "50% 50%", opacity: 0, duration: 0.8, stagger: 0.08, ease: "expo.out" });
  const blips = [];
  // Spaced so every source lands inside the shortest intro (about 1.2s).
  api("/api/status").then((s) => {
    const ok = s.sources.filter((x) => x.ok);
    ok.forEach((_, i) => blips.push(gsap.delayedCall(0.3 + i * Math.min(0.28, 0.9 / ok.length), () => blip(sweep))));
  });

  // GSAP timelines are thenables that settle early inside Promise.all, so completion gets its own promise.
  let shown;
  const seen = new Promise((resolve) => { shown = resolve; });
  const draw = gsap.timeline({ onComplete: () => shown() })
    .to(dot, { scale: 0.5, duration: 0.6, ease: "back.out(2.4)" })
    .fromTo(letters, { yPercent: 110 }, { yPercent: 0, duration: 0.7, stagger: 0.04, ease: "expo.out" }, 0.2)
    .to({}, { duration: 0.3 });
  // Any key or click skips straight to the reveal.
  const skip = () => draw.progress(1);
  addEventListener("keydown", skip, { once: true });
  addEventListener("pointerdown", skip, { once: true });
  const slow = setTimeout(() => { $("#intro-phase").textContent = "Fetching your feed"; }, 1800);

  return Promise.allSettled([ready, seen]).then(([result]) => {
    clearTimeout(slow);
    removeEventListener("keydown", skip); removeEventListener("pointerdown", skip);
    const mark = $(".brand .mark").getBoundingClientRect();
    const mx = mark.left + mark.width / 2, my = mark.top + mark.height / 2;
    const reach = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
    const core = (mark.width * 7) / 24; // the mark's core circle is r=3.5 in a 24 box
    gsap.timeline({ onComplete: () => { spin.kill(); blips.forEach((b) => b.kill()); finish(); } })
      .to(letters, { yPercent: -110, duration: 0.35, stagger: 0.03, ease: "power2.in" })
      .to(["#intro-phase", "#intro-radar"], { opacity: 0, duration: 0.25 }, 0)
      .fromTo("#intro", { clipPath: `circle(${reach}px at ${cx}px ${cy}px)` },
        { clipPath: `circle(0px at ${cx}px ${cy}px)`, duration: 0.9, ease: "expo.inOut" }, 0.15)
      .to(dot, { x: mx - 12, y: my - 12, scale: core / 24, duration: 0.75, ease: "power3.inOut" }, 0.8);
    if (result.status === "fulfilled") enter("page", 0.45);
    else throw result.reason;
  });
}

// Story cards lean toward a fine pointer; touch screens and reduced motion keep them flat.
if (motion && matchMedia("(hover: hover) and (pointer: fine)").matches) {
  const list = $("#list");
  list.addEventListener("pointermove", (e) => {
    const row = e.target.closest(".row"); if (!row) return;
    const r = row.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    row.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    row.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    gsap.to(row, { rotateY: (x - 0.5) * 3, rotateX: (0.5 - y) * 5, transformPerspective: 1000, duration: 0.5, ease: "power2.out", overwrite: "auto" });
  });
  list.addEventListener("pointerout", (e) => {
    const row = e.target.closest(".row");
    if (row && !row.contains(e.relatedTarget)) gsap.to(row, { rotateX: 0, rotateY: 0, duration: 0.7, ease: "power3.out", overwrite: "auto" });
  });
}

async function collapse(i) {
  const row = document.querySelector(`.row[data-i="${i}"]`);
  if (!motion || !row) return;
  row.style.overflow = "hidden";
  await gsap.to(row, { opacity: 0, x: 24, duration: 0.16, ease: "power2.in" });
  await gsap.to(row, { height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.2, ease: "power2.inOut" });
}

// ---------- actions ----------
function toast(msg, undo) {
  const t = $("#toast");
  $("span", t).textContent = msg;
  $("button", t).hidden = !undo;
  t.classList.toggle("has-undo", !!undo);
  t.classList.add("show");
  toast.undo = undo ?? null;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.classList.remove("show"); toast.undo = null; }, undo ? 5000 : 1600);
}

function runUndo() {
  const undo = toast.undo; if (!undo) return;
  toast.undo = null;
  undo();
}
$("#toast button").addEventListener("click", runUndo);

window.addEventListener("unhandledrejection", () => toast("Couldn't reach Pulse. Check the server and try again."));

async function act(i, action) {
  const it = state.items[i]; if (!it) return;
  const prevVote = it.state.vote;
  const { state: s } = await api("/api/feedback", { method: "POST", body: { id: it.id, action } });
  it.state = s;
  if ((action === "hide" || (action === "down" && s.vote === -1)) && state.tab !== "saved") {
    await collapse(i);
    state.items.splice(i, 1);
    state.active = Math.min(state.active, state.items.length - 1);
    const undoAction = action === "hide" ? "unhide" : prevVote === 1 ? "up" : "clear";
    toast(action === "hide" ? "Hidden" : "Showing less like this", () => restore(it, i, undoAction));
  } else if (action === "unsave" && state.tab === "saved") {
    await collapse(i);
    state.items.splice(i, 1); state.active = Math.min(state.active, state.items.length - 1); toast("Removed from saved");
  } else {
    toast({ up: s.vote === 1 ? "Showing more like this" : "Vote cleared", down: "Vote cleared", save: "Saved", unsave: "Removed from saved" }[action] ?? "");
  }
  renderList();
}

async function restore(it, i, action) {
  const tab = state.tab;
  const { state: s } = await api("/api/feedback", { method: "POST", body: { id: it.id, action } });
  it.state = s;
  if (state.tab === tab) {
    state.items.splice(Math.min(i, state.items.length), 0, it);
    state.active = i;
    renderList(); focusActive();
    if (motion) gsap.from(`.row[data-i="${i}"]`, { opacity: 0, y: -8, duration: 0.3, ease: "power2.out", clearProps: "opacity,transform" });
  }
  toast("Restored");
}

$("#list").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); if (!row) return;
  const i = Number(row.dataset.i);
  const btn = e.target.closest("[data-act]");
  if (btn) { e.preventDefault(); act(i, btn.dataset.act); return; }
  if (e.target.closest("[data-open]")) { api("/api/feedback", { method: "POST", body: { id: row.dataset.id, action: "open" } }).catch(() => {}); return; }
  if (!e.target.closest("a") && i !== state.active) { state.active = i; renderList(); }
});

$("#detail").addEventListener("click", (e) => {
  const it = state.items[state.active]; if (!it) return;
  const btn = e.target.closest("[data-act]");
  if (btn) { e.preventDefault(); act(state.active, btn.dataset.act); return; }
  if (e.target.closest("[data-open]")) api("/api/feedback", { method: "POST", body: { id: it.id, action: "open" } }).catch(() => {});
});

const tabs = $$("[role=tab]");

async function selectTab(b) {
  if (state.tab === "tuning" && tuningDirty) await saveProfile();
  tabs.forEach((x) => { const on = x === b; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; });
  $("#main").setAttribute("aria-labelledby", b.id);
  state.tab = b.dataset.tab; state.active = -1; state.explain = false; state.limit = PAGE;
  window.scrollTo(0, 0); load({ animate: "rows" });
}

tabs.forEach((b) => b.addEventListener("click", () => selectTab(b)));
$(".tablist").addEventListener("keydown", (e) => {
  const i = tabs.indexOf(e.target); if (i < 0) return;
  const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const t = tabs[(next + tabs.length) % tabs.length];
  t.focus(); selectTab(t);
});

let qTimer;
$("#search").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); state.limit = PAGE; load(); }, 180); });

// Each page re-fetches the whole list at a larger limit, so rank changes between pages can't duplicate or skip rows.
async function loadMore() {
  if (loadMore.busy || !state.more || state.tab === "tuning") return;
  loadMore.busy = true;
  try {
    state.limit += PAGE;
    await load();
  } finally { loadMore.busy = false; }
  if (state.more && $("#list-end").getBoundingClientRect().top < innerHeight) loadMore();
}
new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "400px" }).observe($("#list-end"));

$("#refresh").addEventListener("click", async () => { await api("/api/refresh", { method: "POST", body: {} }); poll(); });

async function poll() {
  poll.active = true;
  const s = await api("/api/status");
  state.meta = { ...state.meta, ...s }; renderSync();
  if (s.running) setTimeout(poll, 1500); else { poll.active = false; load({ animate: "rows" }); }
}

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea") || e.metaKey || e.ctrlKey || e.altKey || state.tab === "tuning") return;
  // Enter on a focused button or link already activates it; don't also open the highlighted story.
  if (e.key === "Enter" && e.target.closest("button, a")) return;
  if (e.key === "z") { runUndo(); return; }
  const n = state.items.length; if (!n) return;
  const move = (d) => {
    state.active = Math.max(0, Math.min(n - 1, state.active + d)); renderList(); focusActive();
  };
  const i = state.active;
  switch (e.key) {
    case "i": if (i >= 0) { state.explain = !state.explain; renderList(); } break;
    case "j": move(1); break;
    case "k": move(-1); break;
    case "o": case "Enter": if (i >= 0) { window.open(state.items[i].url, "_blank", "noopener"); act(i, "open"); } break;
    case "u": if (i >= 0) act(i, "up"); break;
    case "d": if (i >= 0) act(i, "down"); break;
    case "s": if (i >= 0) act(i, state.items[i].state.saved ? "unsave" : "save"); break;
    case "x": if (i >= 0) act(i, "hide"); break;
    case "/": e.preventDefault(); $("#search").focus(); break;
  }
});

// ---------- tuning ----------
const section = (title, help, body) => `<section class="t-sec"><div><h2>${title}</h2><p class="help">${help}</p></div><div class="panel">${body}</div></section>`;

async function renderTuning() {
  $("#workspace").hidden = true; $("#brief").hidden = true;
  renderTitle();
  const el = $("#tuning"); el.hidden = false;
  tuningDirty = false;
  const [profile, learned, status] = await Promise.all([api("/api/profile"), api("/api/learned"), api("/api/status")]);
  state.meta = { ...state.meta, ...status }; renderSync();
  const llm = status.llm;
  el.innerHTML = [
    section("Your interests", "Stories that mention these keywords rank higher. Weight sets how much each topic counts.",
      `<div id="interests">${profile.interests.map(interestHtml).join("")}</div>
      <div class="row-actions"><button class="btn" id="add-interest">Add topic</button></div>`),
    section("About you", "The AI reads this when it scores and summarizes stories.",
      `<textarea id="about" rows="3" aria-label="About you">${esc(profile.about)}</textarea>`),
    section("Muted words", "Anything mentioning these sinks to the bottom. Separate with commas.",
      `<input type="text" id="mutes" aria-label="Muted words" value="${esc(profile.mutes.join(", "))}" />`),
    section("What it has learned", "Built from your votes, saves and clicks. Green pulls a story up, red pushes it down.",
      `${learned.positive.length || learned.negative.length ? `<div class="chips">
        ${learned.positive.map((t) => `<span class="chip pos">${esc(t.term.replace(/^(tag|src|lang):/, ""))}</span>`).join("")}
        ${learned.negative.map((t) => `<span class="chip neg">${esc(t.term.replace(/^(tag|src|lang):/, ""))}</span>`).join("")}
      </div>` : `<p class="help">Nothing yet. Vote on a few stories and this fills in.</p>`}
      <div class="row-actions"><button class="btn quiet" id="reset-learned">Reset learning</button></div>`),
    section("AI", "Summaries, the “why” line and the daily brief.",
      `<p class="help">${llm.provider === "none" ? "Off. Set LLM_PROVIDER in .env to get summaries and a daily brief." :
        `${esc(llm.provider)}${llm.model ? `, ${esc(llm.model)}` : ""}${llm.ready ? "" : ". Missing API key or model in .env."}`}</p>
      <div class="row-actions"><button class="btn" id="reenrich" ${llm.ready ? "" : "disabled"}>Re-summarize with new interests</button></div>`),
    section("Sources", "From the last refresh. Edit config.json to add RSS feeds or GitHub languages.",
      `<div class="sources">${status.sources.map((s) => `<div><span class="dot${s.ok ? "" : " off"}"></span><span>${esc(s.source)}</span><small>${s.ok ? `${s.count} items` : "failed"}, ${ago(s.at)}</small>${s.error ? `<span class="err">${esc(s.error)}</span>` : ""}</div>`).join("") || `<p class="help">No refresh has run yet.</p>`}</div>`),
  ].join("") + `<div class="savebar" id="savebar" hidden><span>Unsaved changes</span><button class="btn primary" id="save-profile">Save changes</button></div>`;
  if (motion) gsap.from($$(".t-sec", el), { y: 16, opacity: 0, stagger: 0.05, duration: 0.45, ease: "power3.out", clearProps: "opacity,transform" });

  const markDirty = () => { tuningDirty = true; $("#savebar").hidden = false; };
  el.oninput = (e) => { if (e.target.closest("#interests, #about, #mutes")) markDirty(); };
  $("#add-interest").onclick = () => { $("#interests").insertAdjacentHTML("beforeend", interestHtml({ topic: "", weight: 0.6, keywords: [] })); $("#interests .interest:last-child input").focus(); markDirty(); };
  $("#interests").addEventListener("input", (e) => {
    if (e.target.type === "range") e.target.nextElementSibling.textContent = Number(e.target.value).toFixed(1);
    if (e.target.classList.contains("topic")) $("input[type=range]", e.target.closest(".interest")).setAttribute("aria-label", weightLabel(e.target.value));
  });
  $("#interests").addEventListener("click", (e) => { if (e.target.closest(".del")) { e.target.closest(".interest").remove(); markDirty(); } });
  $("#save-profile").onclick = saveProfile;
  $("#reset-learned").onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.armed) {
      b.dataset.armed = "1"; b.textContent = "Click again to erase everything it learned";
      setTimeout(() => { delete b.dataset.armed; b.textContent = "Reset learning"; }, 4000);
      return;
    }
    if (tuningDirty) await saveProfile();
    await api("/api/learned", { method: "DELETE" }); toast("Learning reset"); renderTuning();
  };
  $("#reenrich").onclick = async () => { await api("/api/refresh", { method: "POST", body: { reenrich: true } }); toast("Re-summarizing in the background"); poll(); };
}

async function saveProfile() {
  const interests = $$(".interest").map((r) => ({
    topic: $(".topic", r).value, weight: Number($("input[type=range]", r).value),
    keywords: $("textarea", r).value.split(",").map((k) => k.trim()).filter(Boolean),
  }));
  await api("/api/profile", { method: "PUT", body: { interests, about: $("#about").value, mutes: $("#mutes").value.split(",") } });
  tuningDirty = false; $("#savebar").hidden = true;
  toast("Interests saved");
}

window.addEventListener("beforeunload", (e) => { if (tuningDirty) e.preventDefault(); });

const weightLabel = (topic) => `Weight for ${topic.trim() || "new topic"}`;

function interestHtml(i) {
  return `<div class="interest">
    <input class="field topic" type="text" value="${esc(i.topic)}" placeholder="Topic name" aria-label="Topic name" />
    <label class="weight">Weight <input type="range" min="0" max="1" step="0.1" value="${i.weight}" aria-label="${esc(weightLabel(i.topic))}" /><span>${Number(i.weight).toFixed(1)}</span></label>
    <button class="act del" title="Remove topic" aria-label="Remove topic">${icons.hide}</button>
    <textarea rows="2" placeholder="Keywords, comma separated" aria-label="Keywords">${esc(i.keywords.join(", "))}</textarea>
  </div>`;
}

intro(load());
setInterval(() => { if (state.tab !== "tuning" && !document.hidden) api("/api/status").then((s) => { const was = state.meta?.lastRun; state.meta = { ...state.meta, ...s }; renderSync(); if (s.lastRun !== was && !s.running) load(); }); }, 60_000);
