import * as cheerio from "cheerio";
import type { NewItem } from "../db.ts";
import { http, parseCount } from "./util.ts";

const repoItem = (fullName: string, description: string | null, meta: Omit<NonNullable<NewItem["repo"]>, "fullName">, source: string, publishedAt: number): NewItem => ({
  id: `gh:${fullName.toLowerCase()}`, kind: "repo", source, title: fullName, url: `https://github.com/${fullName}`,
  summary: description, author: fullName.split("/")[0], publishedAt, points: null, comments: null, commentsUrl: null,
  tags: meta.topics ?? [], repo: { fullName, ...meta },
});

/** Scrapes github.com/trending (there is no official API for it). */
export async function fetchTrending(language: string, since: string): Promise<NewItem[]> {
  const html = await (await http(`https://github.com/trending/${encodeURIComponent(language)}?since=${since}`, { headers: { accept: "text/html" } })).text();
  const $ = cheerio.load(html);
  const out: NewItem[] = [];
  $("article.Box-row").each((_, el) => {
    const row = $(el);
    const href = row.find("h2 a").attr("href")?.trim();
    if (!href) return;
    const fullName = href.replace(/^\//, "").replace(/\s+/g, "");
    const desc = row.find("p").first().text().trim() || null;
    const lang = row.find('[itemprop="programmingLanguage"]').text().trim() || null;
    const stars = parseCount(row.find('a[href$="/stargazers"]').first().text());
    const forks = parseCount(row.find('a[href$="/forks"]').first().text());
    const todayText = row.find("span.d-inline-block.float-sm-right").text();
    out.push(repoItem(fullName, desc, { language: lang, stars, forks, starsToday: parseCount(todayText) || null }, "GitHub Trending", Date.now()));
  });
  if (!out.length) throw new Error("trending page parsed 0 repos — GitHub markup may have changed");
  return out;
}

/** Brand-new repos (last 7 days) that are already picking up stars — catches things before they hit Trending. */
export async function fetchNewRising(minStars: number, token?: string): Promise<NewItem[]> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const q = encodeURIComponent(`created:>${since} stars:>=${minStars}`);
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await http(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=50`, { headers });
  const data = (await res.json()) as { items: any[] };
  return data.items.map((r) =>
    repoItem(r.full_name, r.description, {
      language: r.language, stars: r.stargazers_count, forks: r.forks_count, starsToday: null, topics: r.topics ?? [], createdAt: r.created_at,
    }, "GitHub New", Date.parse(r.created_at)));
}
