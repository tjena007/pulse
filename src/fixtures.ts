// Demo data for `npm run demo` — lets you see the UI with no network and no LLM. All items are fictional.
import { setAi, type NewItem } from "./db.ts";

const H = 3600_000;
const now = Date.now();

const articles: [string, string, string, number | null, number, string, string, number][] = [
  // title, source, summary, points, hoursAgo, tldr, why, aiScore
  ["Building a durable job queue on Postgres with SKIP LOCKED", "Hacker News", "A walkthrough of replacing Redis-backed queues with Postgres for at-least-once delivery.", 412, 3, "Deep dive on using Postgres row locks as a reliable job queue, with benchmarks against Redis.", "Directly relevant to your BullMQ/event-driven work.", 9],
  ["MCP servers in production: lessons from 40 internal integrations", "Simon Willison", "Notes on auth, rate limiting and tool design for Model Context Protocol servers.", null, 5, "Practical patterns for running MCP servers at scale: auth, tool granularity, observability.", "You run a multi-MCP setup daily.", 9],
  ["Show HN: A local-first coding agent that runs entirely on a laptop GPU", "Hacker News", "Open-source agent loop with a 14B model, sandboxed shell and git-aware edits.", 680, 7, "An open-source coding agent designed to run with local models only.", "Local models + coding agents, two of your top interests.", 8],
  ["OpenTelemetry semantic conventions for GenAI reach stable", "Lobsters", "Spans and metrics for LLM calls are now standardized.", null, 10, "OTel now has stable conventions for tracing LLM requests, tokens and tool calls.", "Bridges your observability work with AI tooling.", 8],
  ["Why we moved off Lambda for our event pipeline", "Hacker News", "A team explains cost and cold-start reasons for moving Kinesis consumers to Kubernetes.", 233, 12, "Case study moving Kinesis consumers from Lambda to Kubernetes for cost and throughput.", "Mirrors a Lambda→EKS migration path.", 9],
  ["Quantizing small models for phones: what actually matters", "Hugging Face", "Benchmarks of 4-bit schemes on mobile NPUs.", null, 14, "Measured comparison of 4-bit quantization methods on phone hardware.", "Useful for on-device model app ideas.", 7],
  ["The hidden cost of retries in distributed systems", "Hacker News", "Retry storms, budgets and jitter explained with simulations.", 190, 16, "Explains retry storms and how retry budgets plus jitter prevent cascading failures.", "Classic system-design material.", 7],
  ["Terraform vs. Pulumi in 2026: a pragmatic comparison", "Lobsters", "Team-size and state-management tradeoffs.", null, 20, "Side-by-side of Terraform and Pulumi focused on state, testing and team workflow.", "You're learning Terraform.", 6],
  ["Startup raises $200M to build 'AI for everything'", "TechCrunch AI", "Funding round announced.", null, 4, "A funding announcement with little technical detail.", "Mostly hype, low signal for you.", 2],
  ["Reasoning models still struggle with long-horizon planning, new benchmark finds", "The Verge AI", "Researchers release a benchmark for multi-step agent tasks.", null, 9, "New benchmark shows agents degrade sharply on tasks needing 50+ steps.", "Context on agent reliability limits.", 7],
  ["Go 1.26 release notes: what's new for backend devs", "Lobsters", "Iterator improvements, GC changes and tooling updates.", null, 30, "Summary of the latest Go release's changes that matter for services.", "You're learning Go.", 6],
  ["A visual guide to Kafka consumer group rebalancing", "Hacker News", "Animated explanation of cooperative rebalancing.", 145, 26, "Illustrated explainer of how Kafka consumer groups rebalance partitions.", "Good event-driven interview prep.", 7],
  ["NFT marketplace pivots to AI agents", "TechCrunch AI", "Company rebrands.", null, 6, "A crypto company rebrands around AI.", "Muted topic.", 1],
  ["Designing idempotent payment APIs", "Hacker News", "Idempotency keys, exactly-once illusions and reconciliation.", 302, 40, "How to design payment endpoints that are safe to retry using idempotency keys.", "Straight out of your payments domain.", 9],
  ["Running Llama-class models with MLX on Apple silicon: a field guide", "r/LocalLLaMA", "Tokens/sec across M-series chips.", null, 8, "Community benchmarks of local inference speed on Apple silicon via MLX.", "Your Mac can host local models for this app.", 7],
];

const repos: [string, string, string, number, number, string[], string, string, number][] = [
  // fullName, desc, lang, stars, starsToday, topics, tldr, why, aiScore
  ["acme-labs/agentbox", "Sandboxed runtime for coding agents with snapshot/restore", "TypeScript", 8400, 910, ["agents", "sandbox", "mcp"], "A container sandbox for running coding agents safely with instant rollback.", "Agent infra in your language.", 9],
  ["pgq-dev/pgq", "Durable queues and cron on plain Postgres", "Go", 3100, 420, ["postgres", "queue"], "Job queue + scheduler built on Postgres, no Redis needed.", "Go + queues, both on your list.", 8],
  ["tracewise/otel-llm", "Drop-in OpenTelemetry instrumentation for LLM SDKs", "Python", 1900, 260, ["opentelemetry", "llm", "observability"], "Auto-instruments LLM client libraries with OTel spans and token metrics.", "Observability for AI calls.", 8],
  ["tinymodels/pocket-llm", "Run 3B models on iOS with Metal", "Swift", 5200, 640, ["ios", "on-device", "llm"], "A Swift library for running small LLMs on iPhone GPUs.", "Fits your on-device iOS app ideas.", 8],
  ["kubeforge/kf", "Opinionated Terraform + Helm starter for EKS", "HCL", 1200, 140, ["kubernetes", "terraform", "eks"], "Batteries-included EKS setup with Terraform modules and Helm charts.", "Hands-on way to learn K8s/Terraform.", 7],
  ["mcp-hub/registry", "Self-hostable registry for MCP servers", "TypeScript", 2700, 380, ["mcp"], "A registry and discovery service for MCP servers inside a company.", "Relevant to your MCP-heavy workflow.", 8],
  ["fastui/glass", "A gorgeous component kit for dashboards", "TypeScript", 9800, 1200, ["react", "ui"], "React component library aimed at data dashboards.", "Could help your Brain dashboard look premium.", 6],
  ["rustdb/sled-next", "Embedded key-value store rewrite", "Rust", 4100, 300, ["database", "rust"], "A rewrite of an embedded KV store with a new storage engine.", "Interesting internals, less directly useful.", 5],
  ["promptzoo/awesome-prompts-2026", "A huge list of prompts", "Markdown", 15000, 1500, ["prompts"], "A curated list of prompts.", "Popular but low signal.", 3],
  ["eventsmith/outbox", "Transactional outbox for Node.js + Postgres + Kafka", "TypeScript", 900, 110, ["event-driven", "kafka", "nestjs"], "Implements the outbox pattern for reliable event publishing from Node services.", "Exactly your stack.", 9],
];

export function mockItems(): NewItem[] {
  const a: NewItem[] = articles.map(([title, source, summary, points, h], i) => ({
    id: `mock-a${i}`, kind: "article", source, title, url: `https://example.com/demo/${i}`, summary, author: "demo",
    publishedAt: now - h * H, points, comments: points ? Math.round(points / 3) : null,
    commentsUrl: points ? `https://news.ycombinator.com/` : null, tags: [], repo: null,
  }));
  const r: NewItem[] = repos.map(([fullName, desc, language, stars, starsToday, topics], i) => ({
    id: `gh:${fullName}`, kind: "repo", source: i % 3 === 0 ? "GitHub New" : "GitHub Trending", title: fullName,
    url: `https://github.com/${fullName}`, summary: desc, author: fullName.split("/")[0], publishedAt: now - (i * 4 + 1) * H,
    points: null, comments: null, commentsUrl: null, tags: topics, repo: { fullName, language, stars, starsToday, forks: Math.round(stars / 12), topics, createdAt: new Date(now - (i + 2) * 24 * H).toISOString() },
  }));
  return [...a, ...r];
}

/** Fake AI fields so the demo shows what enrichment looks like without an LLM. */
export function mockEnrich() {
  articles.forEach(([, , , , , tldr, why, score], i) => setAi(`mock-a${i}`, { score, tldr, why, tags: [] }));
  repos.forEach(([fullName, , , , , , tldr, why, score]) => setAi(`gh:${fullName}`, { score, tldr, why, tags: [] }));
}
