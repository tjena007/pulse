# Pulse

A localhost news feed that ranks AI/dev news and trending GitHub repos for you, and gets better the more you vote.

- **Sources:** Hacker News, ~10 RSS feeds (Simon Willison, Hugging Face, OpenAI, DeepMind, Latent Space, The Verge AI, TechCrunch AI, Lobsters, r/LocalLLaMA, arXiv), GitHub Trending (all + per language), and brand-new repos that are already picking up stars.
- **Ranking:** your interest topics, a model that learns from 👍/👎/saves/clicks, popularity (HN points, stars per day), freshness, and an optional LLM relevance score.
- **AI (optional):** one-line TL;DR, a "why this matters to you" line, and a morning brief on top. Works with **Ollama (local, free)**, Anthropic, or any OpenAI-compatible API. Without an LLM, ranking still works.
- **Storage:** one SQLite file in `data/`. No Docker, no external services.

## Run it

Needs Node 22.13 or newer (`node -v`).

```bash
npm install
npm run demo        # fake data, no network, no LLM — just to see the UI
```

Open http://localhost:4321. When it looks right:

```bash
cp .env.example .env    # pick an LLM provider (or LLM_PROVIDER=none)
npm start
```

The first refresh takes a minute or two (longer with a local model). After that it refreshes every 30 minutes.

### Local AI with Ollama

```bash
brew install ollama && ollama serve
ollama pull qwen3:8b          # or any model you like; set OLLAMA_MODEL to match
```

Small models are fine for scoring and one-line summaries. If summaries look weak, try a bigger model or switch to `LLM_PROVIDER=anthropic` with `claude-haiku-5-5` (cheap: only the top ~40 candidates per refresh get sent).

## Using it

| Key | Action |
| --- | --- |
| `j` / `k` | Move down / up |
| `o` or `Enter` | Open |
| `u` | More like this (toggle) |
| `d` | Less like this, and hide it |
| `s` | Save |
| `x` | Hide |
| `z` | Undo the last hide or "less like this" |
| `i` | Show why the selected row ranked where it did |
| `/` | Filter |

The blue bar on each row shows how relevant it is to you. Hover it, or press `i` on the selected row, to see the breakdown.

**Tuning** tab: edit interest topics, keywords and weights, your "about me" blurb (the LLM reads it), muted words, see what it has learned, and check which sources failed on the last refresh.

## Config

- `config.json` holds sources (RSS list, GitHub languages, HN point threshold), the starting interests, and retention. Interests are copied into the DB on first run; after that, edit them in the Tuning tab.
- `.env` holds the port, refresh interval, LLM provider/keys, and an optional `GITHUB_TOKEN` (raises the Search API rate limit).
- `HOST=0.0.0.0` makes it reachable from other devices on your network. Put it behind Tailscale rather than exposing it to the internet; there is no auth.

## API

Everything the UI does goes through JSON endpoints, so other local apps can use them:

- `GET /api/digest`: brief, top 10 stories and top 8 repos, compact. Meant for embedding in a dashboard.
- `GET /api/feed?tab=foryou|repos|saved&q=`
- `GET /api/brief`
- `POST /api/feedback` `{ id, action: up|down|save|unsave|hide|open }`
- `POST /api/refresh` `{ reenrich?: boolean }`
- `GET|PUT /api/profile`, `GET|DELETE /api/learned`, `GET /api/status`

`npm run refresh` runs one refresh in the terminal and prints a table of source results, which is useful when a feed breaks.

## How ranking works

```
base  = 0.38·interest + 0.18·popularity + 0.14·learned + 0.30·ai     (with LLM)
      = 0.50·interest + 0.30·popularity + 0.20·learned               (without)
score = base × (0.35 + 0.65·freshness)      freshness halves every 24h (stories) / 48h (repos)
```

- **interest**: keyword hits per topic (title counts double), times topic weight.
- **learned**: an online linear model over title words, bigrams, tags, source and repo language. Each vote nudges those weights; votes can be undone.
- **popularity**: log of HN points or stars per day. Pulse snapshots star counts daily, so repos without a "stars today" number get one from their history, and repo rows show a small star-history sparkline once there are a few days of data.
- A diversity pass stops one source from taking over the top of the feed; muted words push items to the bottom.

## Project layout

```
src/
  server.ts        Fastify routes + scheduler
  refresh.ts       fetch → store → rank → LLM enrich → brief
  rank.ts          scoring + feedback learning
  llm.ts           Ollama / Anthropic / OpenAI adapters, enrich + brief prompts
  db.ts            SQLite (node:sqlite) schema and queries
  sources/         hackernews.ts, rss.ts, github.ts
  fixtures.ts      demo data
public/            index.html, app.js, styles.css (no build step)
```

## Known limits

- GitHub Trending has no official API, so it's scraped. If GitHub changes the markup, that source shows as failed in Tuning and the new-repos source still works.
- Reddit sometimes blocks RSS from scripts. It fails on its own without breaking anything else.
- Ideas for later: embeddings for semantic matching, a "read later" export, a weekly email digest.
