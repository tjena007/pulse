import { XMLParser } from "fast-xml-parser";
import type { NewItem } from "../db.ts";
import type { RssFeed } from "../config.ts";
import { http, idFor, stripHtml } from "./util.ts";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: true });
const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: any): string => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));

function atomLink(link: any): string {
  const links = arr(link);
  const alt = links.find((l: any) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  return typeof alt === "string" ? alt : alt?.["@_href"] ?? "";
}

export async function fetchRss(feed: RssFeed): Promise<NewItem[]> {
  const xml = await (await http(feed.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } })).text();
  const doc = parser.parse(xml);
  const raw: any[] = doc.rss ? arr(doc.rss.channel?.item) : doc.feed ? arr(doc.feed.entry) : arr(doc["rdf:RDF"]?.item);
  const cutoff = Date.now() - 7 * 86400_000;
  const out: NewItem[] = [];
  for (const e of raw.slice(0, 50)) {
    const title = stripHtml(text(e.title), 300);
    const url = (doc.feed ? atomLink(e.link) : text(e.link)) || text(e.guid);
    if (!title || !url) continue;
    const dateStr = text(e.pubDate ?? e.published ?? e.updated ?? e["dc:date"]);
    const ts = Date.parse(dateStr);
    const publishedAt = Number.isFinite(ts) ? ts : Date.now();
    if (publishedAt < cutoff) continue;
    const body = text(e.description ?? e.summary ?? e["content:encoded"] ?? e.content);
    const tags = arr(e.category).map((c: any) => text(c) || c?.["@_term"] || "").filter(Boolean).slice(0, 6);
    out.push({
      id: idFor(url), kind: "article", source: feed.name, title, url, summary: stripHtml(body),
      author: stripHtml(text(e.author?.name ?? e.author ?? e["dc:creator"]), 80), publishedAt,
      points: null, comments: null, commentsUrl: null, tags, repo: null,
    });
  }
  return out;
}
