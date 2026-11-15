// One-off refresh from the terminal: `npm run refresh` — handy for debugging sources.
import { refresh, status } from "./refresh.ts";
import { getSourceStatus, kvSet } from "./db.ts";

await refresh();
kvSet("lastRun", status.lastRun);
console.table(getSourceStatus().map((s) => ({ source: s.source, ok: s.ok, items: s.count, error: s.error?.slice(0, 80) ?? "" })));
console.log(`AI-enriched: ${status.enriched}${status.lastError ? ` · error: ${status.lastError}` : ""}`);
