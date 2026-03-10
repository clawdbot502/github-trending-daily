import fs from 'node:fs/promises';
import path from 'node:path';
import TelegramBot from 'node-telegram-bot-api';

import type { DailyData, GitHubProject } from '../../lib/types';
import { logError, logInfo, logWarn, sleep, withRetry } from '../../lib/utils';

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const SAFE_MESSAGE_LIMIT = 3800;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatTags(project: GitHubProject): string {
  if (!project.tags.length) {
    return '未分类';
  }

  return project.tags.slice(0, 3).join(' · ');
}

function formatProjectBlock(project: GitHubProject, index: number): string {
  return [
    `${index}. ${project.id}`,
    `💡 ${project.ai_summary}`,
    `⭐ ${formatNumber(project.stars)} (+${formatNumber(project.stars_today)} today / +${formatNumber(project.stars_this_week)} week)`,
    `🏷️ ${formatTags(project)}`,
    `🛡️ 安全评分: ${project.security_score}/100`,
    `🔗 ${project.url}`,
    '',
  ].join('\n');
}

function buildMessages(dailyData: DailyData, appBaseUrl: string): string[] {
  const hotProjects = dailyData.projects.filter((project) => project.category === 'hot');
  const gemProjects = dailyData.projects.filter((project) => project.category === 'gem');

  const header = [
    `🔥 GitHub Trending Daily - ${dailyData.date} 🔥`,
    '',
    `今日共发现 ${dailyData.projects.length} 个优质项目（热门 ${hotProjects.length} / 宝藏 ${gemProjects.length}）`,
    '',
  ].join('\n');

  const continuationHeader = `🔥 GitHub Trending Daily - ${dailyData.date}（续）\n\n`;
  const footer = `━━━━━━━━━━━━━━━━━━━━\n📊 完整报告：${appBaseUrl}`;

  const pieces: string[] = [];

  if (hotProjects.length > 0) {
    pieces.push('━━━━━━━━━━━━━━━━━━━━\n【热门项目】\n\n');
    hotProjects.forEach((project, idx) => {
      pieces.push(formatProjectBlock(project, idx + 1));
    });
  }

  if (gemProjects.length > 0) {
    pieces.push('━━━━━━━━━━━━━━━━━━━━\n【宝藏项目】\n\n');
    gemProjects.forEach((project, idx) => {
      pieces.push(formatProjectBlock(project, idx + 1));
    });
  }

  if (pieces.length === 0) {
    pieces.push('今日暂无符合条件的项目。\n\n');
  }

  const chunks: string[] = [];
  let current = header;

  for (const piece of pieces) {
    const reserve = footer.length + 2;
    if (current.length + piece.length + reserve > SAFE_MESSAGE_LIMIT) {
      chunks.push(current.trimEnd());
      current = `${continuationHeader}${piece}`;
      continue;
    }

    current += piece;
  }

  if (current.length + footer.length + 2 > TELEGRAM_MAX_MESSAGE_LENGTH) {
    chunks.push(current.trimEnd());
    current = `${continuationHeader}${footer}`;
  } else {
    current += `${footer}\n`;
  }

  if (current.trim().length > 0) {
    chunks.push(current.trimEnd());
  }

  return chunks;
}

async function readLatestDailyData(): Promise<DailyData> {
  const latestPath = path.resolve('data/latest.json');
  const content = await fs.readFile(latestPath, 'utf8');
  return JSON.parse(content) as DailyData;
}

export async function sendTelegramDailyReport(dailyData?: DailyData): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const threadIdRaw = process.env.TELEGRAM_THREAD_ID;
  const threadId = threadIdRaw ? Number.parseInt(threadIdRaw, 10) : undefined;
  const appBaseUrl = process.env.APP_BASE_URL ?? 'https://your-vercel-app.vercel.app';

  if (!token || !chatId) {
    logWarn('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing, skip Telegram notify.');
    return;
  }

  const data = dailyData ?? (await readLatestDailyData());
  const messages = buildMessages(data, appBaseUrl);

  const bot = new TelegramBot(token, { polling: false });

  logInfo(`Start Telegram notify. messages=${messages.length}, projects=${data.projects.length}`);

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i] as string;

    await withRetry(
      async () => {
        await bot.sendMessage(chatId, message, {
          disable_web_page_preview: true,
          ...(threadId && Number.isFinite(threadId) ? { message_thread_id: threadId } : {}),
        });
      },
      3,
      2_000,
    );

    if (i < messages.length - 1) {
      await sleep(500);
    }
  }

  logInfo('Telegram notify completed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sendTelegramDailyReport()
    .catch((error) => {
      logError('Telegram notify failed.', error);
      process.exitCode = 1;
    });
}
