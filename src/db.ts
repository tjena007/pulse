import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { BLOG_DAYS, DATA_DIR, config, type Interest } from "./config.ts";

export interface RepoMeta { fullName: string; language: string | null; stars: number; starsToday: number | null; forks: number | null; topics?: string[]; createdAt?: string }
export interface Item {
  id: string;
  kind: "article" | "repo" | "blog";
  source: string;
  title: string;
  url: string;
  summary: string | null;
  author: string | null;
  publishedAt: number;
  fetchedAt: number;
  points: number | null;
  comments: number | null;
  commentsUrl: string | null;
  tags: string[];
  repo: RepoMeta | null;
  aiScore: number | null;
  aiWhy: string | null;
  aiTldr: string | null;
  aiTags: string[];
}
export type NewItem = Omit<Item, "fetchedAt" | "aiScore" | "aiWhy" | "aiTldr" | "aiTags">;

export const db = new DatabaseSync(join(DATA_DIR, "pulse.db"));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
  summary TEXT, author TEXT, published_at INTEGER NOT NULL, fetched_at INTEGER NOT NULL,
  points INTEGER, comments INTEGER, comments_url TEXT, tags TEXT NOT NULL DEFAULT '[]', repo TEXT,
  ai_score REAL, ai_why TEXT, ai_tldr TEXT, ai_tags TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS items_kind_pub ON items(kind, published_at);
CREATE TABLE IF NOT EXISTS item_state (
  item_id TEXT PRIMARY KEY, vote INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0, opened INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS term_weights (term TEXT PRIMARY KEY, weight REAL NOT NULL);
CREATE TABLE IF NOT EXISTS star_snapshots (repo TEXT NOT NULL, day TEXT NOT NULL, stars INTEGER NOT NULL, PRIMARY KEY (repo, day));
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_status (source TEXT PRIMARY KEY, ok INTEGER NOT NULL, count INTEGER NOT NULL, error TEXT, at INTEGER NOT NULL);
`);

// ---------- kv / profile ----------
export function kvGet<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}
export function kvSet(key: string, value: unknown) {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
export interface Profile { interests: Interest[]; mutes: string[]; about: string }
export function getProfile(): Profile {
  return kvGet<Profile>("profile", {
    interests: config.seedInterests,
    mutes: config.mutes,
    about: "Senior backend engineer (TypeScript/NestJS, AWS, event-driven systems), getting into Kubernetes/Terraform and Go, heavy user of AI coding agents. Wants signal over hype.",
  });
}
export const setProfile = (p: Profile) => kvSet("profile", p);

// ---------- items ----------
const toItem = (r: any): Item => ({
  id: r.id, kind: r.kind, source: r.source, title: r.title, url: r.url, summary: r.summary, author: r.author,
  publishedAt: r.published_at, fetchedAt: r.fetched_at, points: r.points, comments: r.comments, commentsUrl: r.comments_url,
  tags: JSON.parse(r.tags), repo: r.repo ? JSON.parse(r.repo) : null,
  aiScore: r.ai_score, aiWhy: r.ai_why, aiTldr: r.ai_tldr, aiTags: JSON.parse(r.ai_tags),
});

const upsertStmt = db.prepare(`
INSERT INTO items (id, kind, source, title, url, summary, author, published_at, fetched_at, points, comments, comments_url, tags, repo)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind, title = excluded.title, summary = COALESCE(excluded.summary, items.summary),
  points = COALESCE(excluded.points, items.points), comments = COALESCE(excluded.comments, items.comments),
  comments_url = COALESCE(excluded.comments_url, items.comments_url),
  repo = COALESCE(excluded.repo, items.repo), fetched_at = excluded.fetched_at
`);
export function upsertItems(items: NewItem[]) {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    for (const i of items) {
      upsertStmt.run(i.id, i.kind, i.source, i.title, i.url, i.summary, i.author, i.publishedAt, now,
        i.points, i.comments, i.commentsUrl, JSON.stringify(i.tags), i.repo ? JSON.stringify(i.repo) : null);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function listItems(kind: Item["kind"], sinceMs: number): Item[] {
  return (db.prepare("SELECT * FROM items WHERE kind = ? AND (published_at >= ? OR fetched_at >= ?)").all(kind, sinceMs, sinceMs) as any[]).map(toItem);
}
export function getItem(id: string): Item | undefined {
  const r = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
  return r ? toItem(r) : undefined;
}
export function getItems(ids: string[]): Item[] {
  if (!ids.length) return [];
  return (db.prepare(`SELECT * FROM items WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as any[]).map(toItem);
}
export function setAi(id: string, ai: { score: number; why: string; tldr: string; tags: string[] }) {
  db.prepare("UPDATE items SET ai_score = ?, ai_why = ?, ai_tldr = ?, ai_tags = ? WHERE id = ?")
    .run(ai.score, ai.why, ai.tldr, JSON.stringify(ai.tags), id);
}
export function clearAi() { db.exec("UPDATE items SET ai_score = NULL, ai_why = NULL, ai_tldr = NULL, ai_tags = '[]'"); }

export function pruneOld(days: number) {
  const cutoff = (d: number) => Date.now() - d * 86400_000;
  db.prepare(`DELETE FROM items WHERE fetched_at < ? AND (kind != 'blog' OR fetched_at < ?) AND id NOT IN (SELECT item_id FROM item_state WHERE saved = 1)`)
    .run(cutoff(days), cutoff(Math.max(days, BLOG_DAYS)));
  db.prepare("DELETE FROM star_snapshots WHERE day < ?").run(new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10));
}

// ---------- state ----------
export interface ItemState { vote: number; saved: boolean; hidden: boolean; opened: boolean }
export function getStates(): Map<string, ItemState> {
  const m = new Map<string, ItemState>();
  for (const r of db.prepare("SELECT * FROM item_state").all() as any[])
    m.set(r.item_id, { vote: r.vote, saved: !!r.saved, hidden: !!r.hidden, opened: !!r.opened });
  return m;
}
export function getState(id: string): ItemState {
  const r = db.prepare("SELECT * FROM item_state WHERE item_id = ?").get(id) as any;
  return r ? { vote: r.vote, saved: !!r.saved, hidden: !!r.hidden, opened: !!r.opened } : { vote: 0, saved: false, hidden: false, opened: false };
}
export function putState(id: string, s: ItemState) {
  db.prepare(`INSERT INTO item_state(item_id, vote, saved, hidden, opened, updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(item_id) DO UPDATE SET vote=excluded.vote, saved=excluded.saved, hidden=excluded.hidden, opened=excluded.opened, updated_at=excluded.updated_at`)
    .run(id, s.vote, s.saved ? 1 : 0, s.hidden ? 1 : 0, s.opened ? 1 : 0, Date.now());
}
export function savedIds(): string[] {
  return (db.prepare("SELECT item_id FROM item_state WHERE saved = 1 ORDER BY updated_at DESC").all() as any[]).map((r) => r.item_id);
}
export function likedItems(limit: number): Item[] {
  return (db.prepare(`SELECT items.* FROM items JOIN item_state s ON s.item_id = items.id WHERE s.vote = 1 OR s.saved = 1 ORDER BY s.updated_at DESC LIMIT ?`).all(limit) as any[]).map(toItem);
}
export function dislikedItems(limit: number): Item[] {
  return (db.prepare(`SELECT items.* FROM items JOIN item_state s ON s.item_id = items.id WHERE s.vote = -1 ORDER BY s.updated_at DESC LIMIT ?`).all(limit) as any[]).map(toItem);
}

// ---------- learned weights ----------
export function getTermWeights(): Map<string, number> {
  return new Map((db.prepare("SELECT term, weight FROM term_weights").all() as any[]).map((r) => [r.term, r.weight]));
}
export function bumpTerms(terms: string[], delta: number) {
  const stmt = db.prepare(`INSERT INTO term_weights(term, weight) VALUES(?, ?)
    ON CONFLICT(term) DO UPDATE SET weight = MAX(-3, MIN(3, term_weights.weight + excluded.weight))`);
  db.exec("BEGIN");
  for (const t of terms) stmt.run(t, delta);
  db.exec("COMMIT");
}
export function resetTermWeights() { db.exec("DELETE FROM term_weights"); }
export function topTerms(n: number) {
  const pos = db.prepare("SELECT term, weight FROM term_weights WHERE weight > 0.05 ORDER BY weight DESC LIMIT ?").all(n);
  const neg = db.prepare("SELECT term, weight FROM term_weights WHERE weight < -0.05 ORDER BY weight ASC LIMIT ?").all(n);
  return { positive: pos as { term: string; weight: number }[], negative: neg as { term: string; weight: number }[] };
}

// ---------- star history ----------
export function snapshotStars(repo: string, stars: number) {
  const day = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO star_snapshots(repo, day, stars) VALUES(?,?,?) ON CONFLICT(repo, day) DO UPDATE SET stars = excluded.stars").run(repo, day, stars);
}
export function starHistory(repo: string): { day: string; stars: number }[] {
  return db.prepare("SELECT day, stars FROM star_snapshots WHERE repo = ? ORDER BY day").all(repo) as any;
}

// ---------- source status ----------
export function setSourceStatus(source: string, ok: boolean, count: number, error?: string) {
  db.prepare(`INSERT INTO source_status(source, ok, count, error, at) VALUES(?,?,?,?,?)
    ON CONFLICT(source) DO UPDATE SET ok=excluded.ok, count=excluded.count, error=excluded.error, at=excluded.at`)
    .run(source, ok ? 1 : 0, count, error ?? null, Date.now());
}
export function getSourceStatus() {
  return (db.prepare("SELECT * FROM source_status ORDER BY source").all() as any[]).map((r) => ({ source: r.source, ok: !!r.ok, count: r.count, error: r.error, at: r.at }));
}
