import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import { BLOG_DAYS, ROOT, settings } from "./config.ts";
import { getItem, getItems, getProfile, getSourceStatus, kvGet, kvSet, listItems, resetTermWeights, savedIds, setProfile, topTerms, clearAi, type Profile } from "./db.ts";
import { applyFeedback, diversify, scoreItems, type Action } from "./rank.ts";
import { getBrief, llmInfo } from "./llm.ts";
import { refresh, status } from "./refresh.ts";

const app = Fastify({ logger: { level: "warn" } });
await app.register(fastifyStatic, { root: join(ROOT, "public") });

const DAY = 86400_000;

function feed(tab: string, q: string | undefined, limit: number) {
  let items;
  if (tab === "saved") {
    const ids = savedIds();
    const order = new Map(ids.map((id, i) => [id, i]));
    return scoreItems(getItems(ids)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  const kind = tab === "repos" ? "repo" : tab === "blogs" ? "blog" : "article";
  const days = { repo: 7, blog: BLOG_DAYS, article: 3 }[kind];
  items = scoreItems(listItems(kind, Date.now() - days * DAY))
    .filter((i) => !i.state.hidden && i.state.vote !== -1);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((i) => `${i.title} ${i.summary ?? ""} ${i.aiTldr ?? ""} ${i.source}`.toLowerCase().includes(needle));
  }
  return diversify(items).slice(0, limit);
}

app.get("/api/feed", async (req) => {
  const { tab = "foryou", q, limit = "80" } = req.query as Record<string, string>;
  return { items: feed(tab, q, Math.min(300, Number(limit) || 80)), meta: { ...status, llm: llmInfo(), mock: settings.mock } };
});

app.get("/api/brief", async () => {
  const brief = getBrief();
  if (!brief) return { brief: null };
  const items = new Map(getItems(brief.bullets.map((b) => b.id)).map((i) => [i.id, i]));
  return { brief: { ...brief, bullets: brief.bullets.map((b) => ({ ...b, title: items.get(b.id)?.title, url: items.get(b.id)?.url })) } };
});

app.post("/api/feedback", async (req, reply) => {
  const { id, action } = req.body as { id: string; action: Action };
  const item = getItem(id);
  if (!item) return reply.code(404).send({ error: "unknown item" });
  return { state: applyFeedback(item, action) };
});

app.post("/api/refresh", async (req) => {
  const { reenrich } = (req.body ?? {}) as { reenrich?: boolean };
  if (reenrich) clearAi();
  void refresh({ reenrich }).then(() => kvSet("lastRun", status.lastRun));
  return { started: true };
});

app.get("/api/status", async () => ({ ...status, llm: llmInfo(), sources: getSourceStatus(), mock: settings.mock, refreshMinutes: settings.refreshMinutes }));

app.get("/api/profile", async () => getProfile());
app.put("/api/profile", async (req) => {
  const p = req.body as Profile;
  const clean: Profile = {
    about: String(p.about ?? "").slice(0, 600),
    mutes: (p.mutes ?? []).map((m) => String(m).trim()).filter(Boolean),
    interests: (p.interests ?? []).map((i) => ({
      topic: String(i.topic).trim(), weight: Math.max(0, Math.min(1, Number(i.weight) || 0)),
      keywords: (i.keywords ?? []).map((k) => String(k).trim().toLowerCase()).filter(Boolean),
    })).filter((i) => i.topic),
  };
  setProfile(clean);
  return clean;
});

app.get("/api/learned", async () => topTerms(20));
app.delete("/api/learned", async () => { resetTermWeights(); return { ok: true }; });

/** Compact JSON for other local apps (e.g. a personal dashboard) to embed. */
app.get("/api/digest", async () => ({
  generatedAt: Date.now(),
  brief: getBrief(),
  articles: feed("foryou", undefined, 10).map(slim),
  repos: feed("repos", undefined, 8).map(slim),
}));
const slim = (i: ReturnType<typeof feed>[number]) => ({ id: i.id, title: i.title, url: i.url, source: i.source, score: Math.round(i.score * 100), tldr: i.aiTldr, why: i.aiWhy, stars: i.repo?.stars, starsToday: i.repo?.starsToday });

// ---- scheduler ----
const lastRun = kvGet<number>("lastRun", 0);
status.lastRun = lastRun;
const every = settings.refreshMinutes * 60_000;
const tick = () => refresh().then(() => kvSet("lastRun", status.lastRun));
if (Date.now() - lastRun > every || settings.mock) void tick();
setInterval(tick, every).unref();

const host = process.env.HOST ?? "127.0.0.1";
await app.listen({ port: settings.port, host });
const llm = llmInfo();
console.log(`\n  ◉ Pulse running → http://localhost:${settings.port}`);
console.log(`    LLM: ${llm.provider}${llm.model ? ` (${llm.model})` : ""}${llm.ready || llm.provider === "none" ? "" : " — missing key/model, AI features off"}`);
console.log(`    Refresh every ${settings.refreshMinutes} min${settings.mock ? " · DEMO MODE (fake data)" : ""}\n`);
