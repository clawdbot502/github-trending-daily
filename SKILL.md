---
name: github-trending-daily
description: Use this skill whenever the user wants to fetch, analyze, summarize, or report GitHub Trending repositories. This includes scraping daily/weekly trending data, generating AI summaries in Chinese, scoring project security, filtering by tags (AI, Agent, Quant, Web3, etc.), syncing to Feishu/Lark Base, sending notifications to Feishu groups or Telegram, and generating weekly/monthly reports. Make sure to use this skill when the user mentions GitHub Trending, trending repos, hot GitHub projects, or wants to automate daily/weekly open-source intelligence reports.
---

# GitHub Trending Daily

This repository is a complete GitHub Trending daily report automation system. It scrapes, filters, summarizes, scores, stores, and notifies — all in one pipeline.

## Quick command reference

Run these npm scripts from the repository root. If `node_modules` is missing, run `npm ci` first.

| Command | What it does |
|---------|--------------|
| `npm run scrape` | Full pipeline: scrape trending → filter/classify → AI summarize → security score → save local JSON + sync Supabase. Also auto-generates weekly (Sunday) and monthly (1st) reports to Feishu if the dates match. |
| `npm run notify` | Read `data/latest.json` and send Telegram daily report (auto-splits if >4096 chars). |
| `npm run notify:weekly` | Send Telegram weekly report. |
| `npm run notify:feishu` | Send Feishu/Lark interactive card daily report. |
| `npm run notify:feishu:weekly` | Send Feishu/Lark interactive card weekly report. |
| `npm run sync:feishu` | Sync `data/latest.json` to Feishu Base (Bitable) and send the interactive card notification. |

## Standard workflows

### 1. Run the full daily pipeline
```bash
npm ci --no-audit --no-fund
npm run scrape
```
This produces:
- `data/YYYY-MM-DD.json`
- `data/latest.json`
- `data/history/YYYY-MM.json`

If today is Sunday, it also generates and sends a weekly report to Feishu.  
If today is the 1st of the month, it also generates and sends a monthly report to Feishu.

### 2. Send notifications after scraping
After `npm run scrape`, use one or more of:
```bash
npm run notify              # Telegram daily
npm run notify:feishu       # Feishu daily card
npm run sync:feishu         # Feishu Base + daily card
npm run notify:weekly       # Telegram weekly (reads current week data)
npm run notify:feishu:weekly # Feishu weekly card (reads current week data)
```

### 3. Only scrape without saving (dry observation)
```bash
npx tsx scripts/scraper/index.ts
```
This prints the first 5 merged trending projects to stdout without writing files.

## Key capabilities

- **Scraper** (`scripts/scraper/index.ts`): Fetches both `daily` and `weekly` GitHub Trending pages with axios + cheerio. Merges them and deduplicates by repo ID.
- **Filter** (`scripts/filter/index.ts`): Tags projects into categories like AI, Agent, Quant, Finance, Web3, Crypto, Skills, Content. Classifies as `hot` (high daily stars) or `gem` (small but interesting).
- **AI Summarizer** (`scripts/ai/summarize.ts`): Calls an LLM API (configured via `SUMMARY_*` env vars) to generate a 2-sentence Chinese summary for each project. Supports primary + fallback model rotation.
- **Security Scorer** (`scripts/security/score.ts`): Queries the GitHub API for repo age, author age, license, README, issues/PRs, and star-fork ratio to produce a 0-100 security score.
- **Reports** (`scripts/db/reports.ts`): Generates weekly/monthlyaggregated reports from Supabase data.
- **Supabase sync** (`lib/supabase.ts`): Persists project metadata and daily trending records to Supabase.

## Environment variables

Required for scraping + AI summary:
- `GITHUB_TOKEN`
- `SUMMARY_API_KEY`
- `SUMMARY_BASE_URL`
- `SUMMARY_MODEL`

Required for Telegram notifications:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_THREAD_ID` (optional)

Required for Feishu/Lark notifications and Base sync:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_CHAT_ID`
- `FEISHU_BASE_TOKEN` (only for `sync:feishu`)
- `FEISHU_TABLE_ID` (only for `sync:feishu`)

Required for Supabase sync:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:
- `APP_BASE_URL` — link inserted into Telegram messages
- `SUMMARY_BATCH_SIZE` — default 3, max 5

## Data outputs

- `data/<YYYY-MM-DD>.json` — daily snapshot
- `data/latest.json` — most recent snapshot (used by notify scripts)
- `data/history/<YYYY-MM>.json` — monthly archive aggregating all daily snapshots

When handling user requests, always prefer running the existing npm scripts rather than reimplementing the logic inline.
