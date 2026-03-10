# GitHub Trending Daily

GitHub 热门项目日报系统（MVP）。

架构：
- GitHub Actions：每日抓取 + 生成数据 + Telegram 推送
- GitHub Repo：存储 `data/*.json`
- Vercel：前端展示

## 技术栈

- Next.js 14 (App Router)
- TypeScript (strict)
- Tailwind CSS
- axios + cheerio
- node-telegram-bot-api

## 环境变量

复制 `.env.example` 并填充：

```bash
cp .env.example .env.local
```

关键变量：
- `KIMI_API_KEY`
- `GITHUB_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_THREAD_ID`（可选，Telegram 话题帖 thread id）
- `APP_BASE_URL`（Telegram 消息中的页面链接）

## 本地命令

```bash
npm ci
npm run lint
npm run build
npm run scrape
npm run notify
```

`npm run scrape` 会执行完整 pipeline：
1. 抓取 trending（daily + weekly）
2. 过滤/分类（hot/gem）
3. Kimi 生成一句话总结（含重试）
4. 安全评分
5. 落盘：
   - `data/YYYY-MM-DD.json`
   - `data/latest.json`
   - `data/history/YYYY-MM.json`

`npm run notify` 会读取 `data/latest.json` 并发送 Telegram 日报（自动分段，避免 4096 字符限制）。

## Vercel 部署（Checkpoint 3.1）

本仓库已包含 `vercel.json`：
- 使用 `npm ci --no-audit --no-fund` 安装依赖
- 使用 `npm run build` 构建
- framework 指定为 `nextjs`

在 Vercel Project Settings → Environment Variables 中添加：
- `KIMI_API_KEY`
- `GITHUB_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `APP_BASE_URL`

> 说明：前端展示本身不强依赖上述变量，但后续自动化任务与 Telegram 推送会使用到。
