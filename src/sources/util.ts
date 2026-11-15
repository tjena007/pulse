import { createHash } from "node:crypto";

export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 pulse-localhost/0.1";

export async function http(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Response> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "*/*", ...opts.headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res;
}

const TRACKING = /^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_|source$)/;
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, "");
  } catch { return raw; }
}
export const idFor = (url: string) => createHash("sha1").update(normalizeUrl(url)).digest("hex").slice(0, 16);

export function stripHtml(s: unknown, max = 400): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const text = s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

export const parseCount = (s: string | undefined | null) => {
  const n = Number(String(s ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
