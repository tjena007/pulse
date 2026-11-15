import { config, settings } from "./config.ts";
import { getProfile, listItems, pruneOld, setSourceStatus, snapshotStars, upsertItems, type NewItem } from "./db.ts";
import { fetchHackerNews } from "./sources/hackernews.ts";
import { fetchRss } from "./sources/rss.ts";
import { fetchNewRising, fetchTrending } from "./sources/github.ts";
import { enrichItems, generateBrief, llmInfo } from "./llm.ts";
import { kvSet } from "./db.ts";
import { diversify, scoreItems } from "./rank.ts";
import { mockEnrich, mockItems } from "./fixtures.ts";

export const status = { running: false, phase: "idle", lastRun: 0 as number, lastError: null as string | null, enriched: 0 };

function mergeRepos(items: NewItem[]): NewItem[] {
  const byId = new Map<string, NewItem>();
  for (const it of items) {
    const prev = byId.get(it.id);
    if (!prev) { byId.set(it.id, it); continue; }
    if (prev.repo && it.repo) {
      prev.repo = {
        ...prev.repo, ...Object.fromEntries(Object.entries(it.repo).filter(([, v]) => v != null)),
        starsToday: Math.max(prev.repo.starsToday ?? 0, it.repo.starsToday ?? 0) || null,
        stars: Math.max(prev.repo.stars, it.repo.stars),
        topics: [...new Set([...(prev.repo.topics ?? []), ...(it.repo.topics ?? [])])],
      };
      prev.tags = [...new Set([...prev.tags, ...it.tags])];
      if (it.source === "GitHub Trending") prev.source = it.source; // trending wins as the label
    }
  }
  return [...byId.values()];
}

async function run(name: string, fn: () => Promise<NewItem[]>): Promise<NewItem[]> {
  try {
    const items = await fn();
    setSourceStatus(name, true, items.length);
    return items;
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(`[source] ${name}: ${msg}`);
    setSourceStatus(name, false, 0, msg);
    return [];
  }
}

export async function refresh(opts: { reenrich?: boolean } = {}) {
  if (status.running) return status;
  status.running = true; status.lastError = null; status.phase = "fetching";
  try {
    const s = config.sources;
    const jobs: Promise<NewItem[]>[] = [];
    if (settings.mock) {
      jobs.push(run("Mock data", async () => mockItems()));
    } else {
      if (s.hackernews.enabled) jobs.push(run("Hacker News", () => fetchHackerNews(s.hackernews.minPoints)));
      for (const f of s.rss.filter((f) => f.enabled)) jobs.push(run(f.name, () => fetchRss(f)));
      if (s.github.enabled) {
        for (const lang of s.github.trendingLanguages)
          jobs.push(run(`GitHub Trending${lang ? ` (${lang})` : ""}`, () => fetchTrending(lang, s.github.trendingSince)));
        jobs.push(run("GitHub New", () => fetchNewRising(s.github.newRisingMinStars, settings.githubToken)));
      }
    }
    const items = mergeRepos((await Promise.all(jobs)).flat());
    upsertItems(items);
    for (const it of items) if (it.repo) snapshotStars(it.repo.fullName, it.repo.stars);
    pruneOld(config.retentionDays);

    if (settings.mock && !llmInfo().ready) {
      mockEnrich();
      kvSet("brief", { generatedAt: Date.now(), headline: "Demo mode — connect an LLM for a real brief", bullets: [
        { id: "mock-a0", text: "Postgres SKIP LOCKED queues are getting another look as teams drop Redis for simpler at-least-once delivery." },
        { id: "gh:acme-labs/agentbox", text: "A TypeScript sandbox for coding agents with snapshot/restore is the fastest-rising repo today." },
        { id: "mock-a4", text: "Another team writes up moving Kinesis consumers from Lambda to Kubernetes, citing cost and throughput." },
      ] });
      status.lastRun = Date.now();
      return status;
    }

    // Enrich the most promising un-enriched candidates (cheap heuristic first, LLM second).
    status.phase = "ranking";
    const profile = getProfile();
    const since = Date.now() - 3 * 86400_000;
    const pool = [...listItems("article", since), ...listItems("repo", since)];
    const candidates = scoreItems(pool, profile)
      .filter((i) => !i.state.hidden && i.state.vote !== -1 && (opts.reenrich || i.aiScore == null))
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.llm.enrichLimit);
    status.phase = `summarizing ${candidates.length} items`;
    status.enriched = await enrichItems(candidates, profile, (n) => { status.phase = `summarizing ${n}/${candidates.length}`; });

    status.phase = "writing brief";
    const top = diversify(scoreItems(pool, profile).filter((i) => !i.state.hidden && i.state.vote !== -1)).slice(0, 20);
    await generateBrief(top, profile);
    status.lastRun = Date.now();
  } catch (e) {
    status.lastError = (e as Error).message;
    console.error(e);
  } finally {
    status.running = false; status.phase = "idle";
  }
  return status;
}
