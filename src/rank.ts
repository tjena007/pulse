import { bumpTerms, getProfile, getState, getStates, getTermWeights, putState, starHistory, type Item, type ItemState, type Profile } from "./db.ts";

const STOP = new Set("the a an and or of to in on for with from by is are was were be been it its this that these those how why what when who your you our we my at as via into vs new using use about can will just than then more most not now has have had get got out up show ask hn".split(" "));

export function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9.+#-]+/g, " ").split(" ")
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

/** Features the feedback model learns weights for. */
export function featuresOf(item: Item): string[] {
  const words = tokenize(`${item.title} ${item.repo ? item.summary ?? "" : ""}`);
  const bigrams = words.slice(1).map((w, i) => `${words[i]} ${w}`);
  const tags = [...item.tags, ...item.aiTags].map((t) => `tag:${t.toLowerCase()}`);
  const extra = [`src:${item.source}`];
  if (item.repo?.language) extra.push(`lang:${item.repo.language.toLowerCase()}`);
  return [...new Set([...words, ...bigrams, ...tags, ...extra])];
}

const haystack = (s: string) => " " + s.toLowerCase().replace(/[^a-z0-9.+#-]+/g, " ") + " ";
function hits(hay: string, kw: string): number {
  const k = kw.trim().toLowerCase();
  if (!k) return 0;
  // Short keywords (llm, go, k8s) must match a whole word (plural ok); longer ones match word-prefixes (agent → agents, agentic).
  const re = k.length < 4
    ? new RegExp(` ${escape(k)}s? `, "g")
    : new RegExp(` ${escape(k)}`, "g");
  return (hay.match(re) ?? []).length;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Scored extends Item {
  score: number;
  matched: string[];
  factors: { interest: number; popularity: number; learned: number; ai: number | null; recency: number };
  state: ItemState;
  velocity: { day: string; stars: number }[] | null;
}

function popularity(item: Item): number {
  if (item.repo) {
    let perDay = item.repo.starsToday ?? 0;
    if (!perDay) {
      const hist = starHistory(item.repo.fullName);
      if (hist.length >= 2) perDay = Math.max(0, hist.at(-1)!.stars - hist.at(-2)!.stars);
      else if (item.repo.createdAt) perDay = item.repo.stars / Math.max(1, (Date.now() - Date.parse(item.repo.createdAt)) / 86400_000);
    }
    return Math.min(1, Math.log10(perDay + 1) / 3.3);
  }
  if (item.points != null) return Math.min(1, Math.log10(item.points + 1) / 3 + Math.min(0.1, (item.comments ?? 0) / 2000));
  return 0.35;
}

export function scoreItems(items: Item[], profile: Profile = getProfile()): Scored[] {
  const weights = getTermWeights();
  const states = getStates();
  const now = Date.now();
  const scored: Scored[] = [];

  for (const item of items) {
    const state = states.get(item.id) ?? { vote: 0, saved: false, hidden: false, opened: false };
    const titleHay = haystack(item.title);
    const bodyHay = haystack([item.summary, item.tags.join(" "), item.aiTags.join(" "), item.repo?.language, item.repo?.topics?.join(" ")].filter(Boolean).join(" "));

    // 1) explicit interests
    let raw = 0;
    const matched: string[] = [];
    for (const it of profile.interests) {
      const h = it.keywords.reduce((n, k) => n + hits(titleHay, k) * 2 + hits(bodyHay, k), 0);
      if (h > 0) { raw += it.weight * Math.min(1, h / 2); matched.push(it.topic); }
    }
    const interest = 1 - Math.exp(-1.2 * raw);

    // 2) learned from 👍/👎
    const feats = featuresOf(item);
    const sum = feats.reduce((s, f) => s + (weights.get(f) ?? 0), 0);
    const learned = Math.tanh(sum / Math.sqrt(Math.max(1, feats.length)) / 0.6);

    // 3) popularity + recency
    const pop = popularity(item);
    const ageH = (now - item.publishedAt) / 3600_000;
    const halfLifeH = item.kind === "blog" ? 14 * 24 : item.repo ? 48 : 24;
    const recency = Math.pow(0.5, Math.max(0, ageH) / halfLifeH);

    // 4) LLM relevance (if enriched)
    const ai = item.aiScore != null ? item.aiScore / 10 : null;

    let base = ai != null
      ? 0.38 * interest + 0.18 * pop + 0.14 * learned + 0.30 * ai
      : 0.50 * interest + 0.30 * pop + 0.20 * learned;
    let score = base * (0.35 + 0.65 * recency);

    const muteHay = titleHay + bodyHay;
    if (profile.mutes.some((m) => hits(muteHay, m) > 0)) score *= 0.05;

    scored.push({
      ...item, score, matched, state,
      factors: { interest: round(interest), popularity: round(pop), learned: round(learned), ai: ai == null ? null : round(ai), recency: round(recency) },
      velocity: item.repo ? starHistory(item.repo.fullName).slice(-14) : null,
    });
  }
  return scored;
}

/** Light diversity pass so one source can't take over the top of the feed. */
export function diversify(items: Scored[]): Scored[] {
  const pool = [...items].sort((a, b) => b.score - a.score);
  const out: Scored[] = [];
  const perSource = new Map<string, number>();
  while (pool.length) {
    let best = 0, bestVal = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 25); i++) {
      const v = pool[i].score * Math.pow(0.9, perSource.get(pool[i].source) ?? 0);
      if (v > bestVal) { bestVal = v; best = i; }
    }
    const [pick] = pool.splice(best, 1);
    perSource.set(pick.source, (perSource.get(pick.source) ?? 0) + 1);
    out.push(pick);
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---------- feedback → learning ----------
export type Action = "up" | "down" | "clear" | "save" | "unsave" | "hide" | "unhide" | "open";
const LR = { vote: 0.35, save: 0.3, hide: 0.15, open: 0.05 };

export function applyFeedback(item: Item, action: Action): ItemState {
  const prev = getState(item.id);
  const next: ItemState = { ...prev };
  let delta = 0;
  switch (action) {
    case "up": next.vote = prev.vote === 1 ? 0 : 1; break;     // toggles
    case "down": next.vote = prev.vote === -1 ? 0 : -1; break;
    case "clear": next.vote = 0; break;
    case "save": next.saved = true; break;
    case "unsave": next.saved = false; break;
    case "hide": next.hidden = true; break;
    case "unhide": next.hidden = false; break;
    case "open": next.opened = true; break;
  }
  delta += (next.vote - prev.vote) * LR.vote;
  delta += (Number(next.saved) - Number(prev.saved)) * LR.save;
  delta -= (Number(next.hidden) - Number(prev.hidden)) * LR.hide;
  if (action === "open" && !prev.opened) delta += LR.open;
  if (delta !== 0) bumpTerms(featuresOf(item), delta);
  putState(item.id, next);
  return next;
}
