import { settings } from "./config.ts";
import { dislikedItems, likedItems, setAi, kvSet, kvGet, type Item, type Profile } from "./db.ts";

const L = settings.llm;

export function llmInfo() {
  switch (L.provider) {
    case "ollama": return { provider: "ollama", model: L.ollama.model, ready: true };
    case "anthropic": return { provider: "anthropic", model: L.anthropic.model, ready: !!L.anthropic.apiKey };
    case "openai": return { provider: "openai", model: L.openai.model, ready: !!L.openai.apiKey && !!L.openai.model };
    default: return { provider: "none", model: null, ready: false };
  }
}

const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties) });
const ENRICH_SCHEMA = obj({ items: { type: "array", items: obj({ id: str, score: { type: "number" }, tldr: str, why: str, tags: { type: "array", items: str } }) } });
const BRIEF_SCHEMA = obj({ headline: str, bullets: { type: "array", items: obj({ id: str, text: str }) } });

// Small local models with thinking off ignore a schema described only in the prompt, so Ollama gets it as a hard constraint.
async function complete(system: string, user: string, schema: object): Promise<string> {
  const signal = AbortSignal.timeout(180_000);
  if (L.provider === "ollama") {
    const res = await fetch(`${L.ollama.baseUrl}/api/chat`, {
      method: "POST", signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: L.ollama.model, stream: false, think: false, format: schema, options: { temperature: 0.2 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    return ((await res.json()) as any).message.content;
  }
  if (L.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": L.anthropic.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: L.anthropic.model, max_tokens: 4000, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    return ((await res.json()) as any).content.map((c: any) => c.text ?? "").join("");
  }
  if (L.provider === "openai") {
    const res = await fetch(`${L.openai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${L.openai.apiKey}` },
      body: JSON.stringify({ model: L.openai.model, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
    return ((await res.json()) as any).choices[0].message.content;
  }
  throw new Error("no LLM provider configured");
}

function parseJson<T>(s: string): T {
  const cleaned = s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(json)?/g, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LLM did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function profileBlock(p: Profile): string {
  const liked = likedItems(15).map((i) => `+ ${i.title}`).join("\n") || "(none yet)";
  const disliked = dislikedItems(10).map((i) => `- ${i.title}`).join("\n") || "(none yet)";
  return `READER: ${p.about}
INTERESTS (weight 0-1): ${p.interests.map((i) => `${i.topic} (${i.weight})`).join("; ")}
NOT INTERESTED IN: ${p.mutes.join(", ") || "-"}
RECENTLY LIKED:\n${liked}
RECENTLY DOWNVOTED:\n${disliked}`;
}

const ENRICH_SYSTEM = `You curate a personal tech news feed. For each item, judge how worth-reading it is for THIS reader specifically.
Score 0-10: 9-10 = must-read, directly in their wheelhouse and substantive; 6-8 = relevant and useful; 3-5 = tangential; 0-2 = noise, hype, or off-topic.
Prefer substance (launches, deep dives, postmortems, useful tools) over hype, funding news and hot takes.
Respond with JSON only: {"items":[{"id":"...","score":7,"tldr":"one plain sentence, max 25 words, saying what it actually is","why":"max 15 words: why THIS reader would care, or why not","tags":["2-4 short lowercase topic tags"]}]}`;

export async function enrichItems(items: Item[], profile: Profile, onProgress?: (done: number) => void): Promise<number> {
  if (!llmInfo().ready || !items.length) return 0;
  let done = 0;
  const pBlock = profileBlock(profile);
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    const list = batch.map((it) => JSON.stringify({
      id: it.id, kind: it.kind, source: it.source, title: it.title,
      text: (it.summary ?? "").slice(0, 300), ...(it.repo ? { language: it.repo.language, stars: it.repo.stars, starsToday: it.repo.starsToday } : { points: it.points }),
    })).join("\n");
    try {
      const out = parseJson<{ items: { id: string; score: number; tldr: string; why: string; tags: string[] }[] }>(
        await complete(ENRICH_SYSTEM, `${pBlock}\n\nITEMS (one JSON per line):\n${list}`, ENRICH_SCHEMA));
      const before = done;
      for (const r of out.items ?? []) {
        if (!batch.some((b) => b.id === r.id)) continue;
        setAi(r.id, {
          score: Math.max(0, Math.min(10, Number(r.score) || 0)),
          tldr: String(r.tldr ?? "").slice(0, 240), why: String(r.why ?? "").slice(0, 160),
          tags: (Array.isArray(r.tags) ? r.tags : []).map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 4),
        });
        done++;
      }
      if (done === before) console.warn(`[llm] enrich batch returned no usable items (got ${out.items?.length ?? 0} entries, none matching the ${batch.length} ids sent)`);
    } catch (e) {
      console.warn(`[llm] enrich batch failed: ${(e as Error).message}`);
    }
    onProgress?.(done);
  }
  return done;
}

export interface Brief { generatedAt: number; headline: string; bullets: { text: string; id: string }[] }

export async function generateBrief(top: Item[], profile: Profile): Promise<Brief | null> {
  if (!llmInfo().ready || top.length < 3) return null;
  const list = top.slice(0, 20).map((it) => JSON.stringify({ id: it.id, title: it.title, tldr: it.aiTldr ?? it.summary?.slice(0, 200), source: it.source })).join("\n");
  try {
    const out = parseJson<{ headline: string; bullets: { text: string; id: string }[] }>(await complete(
      `You write a 60-second morning briefing for one engineer. Pick the 5 most important items for them and write one crisp sentence each (max 28 words), plain and specific, no hype words. Add a headline of max 10 words capturing today's theme.
Respond with JSON only: {"headline":"...","bullets":[{"id":"<item id>","text":"..."}]}`,
      `${profileBlock(profile)}\n\nTODAY'S TOP ITEMS:\n${list}`, BRIEF_SCHEMA));
    const ids = new Set(top.map((t) => t.id));
    const brief: Brief = { generatedAt: Date.now(), headline: String(out.headline ?? ""), bullets: (out.bullets ?? []).filter((b) => ids.has(b.id)).slice(0, 6) };
    if (!brief.bullets.length) console.warn(`[llm] brief has no usable bullets (got ${out.bullets?.length ?? 0}, none matching the ${top.length} ids sent)`);
    kvSet("brief", brief);
    return brief;
  } catch (e) {
    console.warn(`[llm] brief failed: ${(e as Error).message}`);
    return null;
  }
}
export const getBrief = () => kvGet<Brief | null>("brief", null);
