import type { NewItem } from "../db.ts";
import { http, idFor, stripHtml } from "./util.ts";

interface Hit { objectID: string; title: string; url?: string; author: string; points: number; num_comments: number; created_at_i: number; story_text?: string; _tags: string[] }

export async function fetchHackerNews(minPoints: number): Promise<NewItem[]> {
  const since = Math.floor(Date.now() / 1000) - 36 * 3600;
  const urls = [
    "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60",
    `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>${since},points>=${minPoints}&hitsPerPage=100`,
  ];
  const results = await Promise.all(urls.map(async (u) => ((await (await http(u)).json()) as { hits: Hit[] }).hits));
  const seen = new Map<string, NewItem>();
  for (const h of results.flat()) {
    if (!h.title || seen.has(h.objectID)) continue;
    const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
    const url = h.url || discussion;
    const tags = h._tags.filter((t) => ["show_hn", "ask_hn"].includes(t)).map((t) => t.replace("_hn", " hn"));
    seen.set(h.objectID, {
      id: idFor(url), kind: "article", source: "Hacker News", title: h.title, url,
      summary: stripHtml(h.story_text), author: h.author, publishedAt: h.created_at_i * 1000,
      points: h.points, comments: h.num_comments, commentsUrl: discussion, tags, repo: null,
    });
  }
  return [...seen.values()];
}
