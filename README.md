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

## 作为 Claude Code Skill 使用

本仓库已包含 `SKILL.md`，可被任何支持 Anthropic skill 规范的 agent（包括 Claude Code）直接识别和调用。

当 agent 加载此 skill 后，可通过以下入口与用户交互：

- **抓取今日 Trending**：自动运行 `npm run scrape` 完成从抓取到落盘的全流程
- **发送日报**：运行 `npm run notify`（Telegram）或 `npm run notify:feishu` / `npm run sync:feishu`（飞书）
- **发送周报/月报**：运行 `npm run notify:feishu:weekly` 或等待 pipeline 在周日/每月 1 日自动生成并推送

Skill 描述文件中已完整标注了各脚本的作用、所需环境变量及数据输出路径，agent 无需再通读源码即可正确调用。

## 环境变量

复制 `.env.example` 并填充：

```bash
cp .env.example .env.local
```

关键变量：
- `SUMMARY_API_KEY`
- `SUMMARY_BASE_URL`
- `SUMMARY_MODEL`
- `SUMMARY_BATCH_SIZE`（可选，默认 3）
- `GITHUB_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_THREAD_ID`（可选，Telegram 话题帖 thread id）
- `APP_BASE_URL`（Telegram 消息中的页面链接）

> 兼容说明：保留 `KIMI_*` 作为备用回滚配置，优先使用 `SUMMARY_*`。

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
- `SUMMARY_API_KEY`
- `SUMMARY_BASE_URL`
- `SUMMARY_MODEL`
- `SUMMARY_BATCH_SIZE`（可选，默认 3）
- `GITHUB_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_THREAD_ID`（可选）
- `APP_BASE_URL`

> 说明：前端展示本身不强依赖上述变量，但后续自动化任务与 Telegram 推送会使用到。
