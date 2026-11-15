import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

export interface Interest { topic: string; weight: number; keywords: string[] }
export interface RssFeed { name: string; url: string; enabled: boolean }
export interface AppConfig {
  seedInterests: Interest[];
  mutes: string[];
  sources: {
    hackernews: { enabled: boolean; minPoints: number };
    github: { enabled: boolean; trendingLanguages: string[]; trendingSince: "daily" | "weekly" | "monthly"; newRisingMinStars: number };
    rss: RssFeed[];
  };
  retentionDays: number;
}

export const config: AppConfig = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));

const env = process.env;
export const settings = {
  port: Number(env.PORT ?? 4321),
  refreshMinutes: Number(env.REFRESH_MINUTES ?? 30),
  mock: env.MOCK === "1",
  githubToken: env.GITHUB_TOKEN || undefined,
  llm: {
    provider: (env.LLM_PROVIDER ?? "none") as "none" | "ollama" | "anthropic" | "openai",
    enrichLimit: Number(env.LLM_ENRICH_LIMIT ?? 40),
    ollama: { baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434", model: env.OLLAMA_MODEL ?? "qwen3:8b" },
    anthropic: { apiKey: env.ANTHROPIC_API_KEY ?? "", model: env.ANTHROPIC_MODEL ?? "claude-haiku-5-5" },
    openai: { apiKey: env.OPENAI_API_KEY ?? "", baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", model: env.OPENAI_MODEL ?? "" },
  },
};

export const DATA_DIR = join(ROOT, "data");
mkdirSync(DATA_DIR, { recursive: true });
