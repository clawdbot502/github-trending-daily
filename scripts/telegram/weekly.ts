import fs from 'node:fs/promises';
import path from 'node:path';
import TelegramBot from 'node-telegram-bot-api';

import type { DailyData, GitHubProject } from '../../lib/types';
import { logError, logInfo, sleep, withRetry } from '../../lib/utils';

// 从环境变量读取目标 Chat ID 和 Thread ID
const REQUIRED_CHAT_ID = process.env.REQUIRED_TELEGRAM_CHAT_ID;
const REQUIRED_THREAD_ID = process.env.REQUIRED_TELEGRAM_THREAD_ID
  ? Number.parseInt(process.env.REQUIRED_TELEGRAM_THREAD_ID, 10)
  : Number.NaN;

interface ProjectWeeklyStats {
  project: GitHubProject;
  appearDays: number; // 本周出现天数
  totalStarsToday: number; // 本周累计今日新增 stars
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function loadWeeklyData(): Promise<DailyData[]> {
  const dataDir = path.resolve('data');
  const { start, end } = getWeekRange();
  const startStr = dateString(start);
  const endStr = dateString(end);

  const days: DailyData[] = [];
  const current = new Date(start);

  while (current <= end) {
    const dateStr = dateString(current);
    const filePath = path.join(dataDir, `${dateStr}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content) as DailyData;
      days.push(data);
    } catch {
      // 文件不存在则跳过
    }

    current.setDate(current.getDate() + 1);
  }

  return days;
}

function calculateWeeklyStats(dailyDataList: DailyData[]): ProjectWeeklyStats[] {
  const projectMap = new Map<string, ProjectWeeklyStats>();

  for (const daily of dailyDataList) {
    for (const project of daily.projects) {
      const existing = projectMap.get(project.id);

      if (existing) {
        existing.appearDays += 1;
        existing.totalStarsToday += project.stars_today;
        // 保持最新的项目数据
        existing.project = project;
      } else {
        projectMap.set(project.id, {
          project,
          appearDays: 1,
          totalStarsToday: project.stars_today,
        });
      }
    }
  }

  // 转换为数组并排序
  const stats = Array.from(projectMap.values());

  // 排序规则：出现天数 > 累计今日 stars > 总 stars
  stats.sort((a, b) => {
    if (b.appearDays !== a.appearDays) {
      return b.appearDays - a.appearDays;
    }
    if (b.totalStarsToday !== a.totalStarsToday) {
      return b.totalStarsToday - a.totalStarsToday;
    }
    return b.project.stars - a.project.stars;
  });

  return stats;
}

function formatWeeklyProjectBlock(stats: ProjectWeeklyStats, index: number): string {
  const { project, appearDays, totalStarsToday } = stats;

  return [
    `${index}. ${project.id}`,
    `💡 ${project.ai_summary}`,
    `⭐ ${formatNumber(project.stars)} (本周新增 +${formatNumber(totalStarsToday)})`,
    `📅 本周上榜 ${appearDays} 天`,
    `🔗 ${project.url}`,
    '',
  ].join('\n');
}

function buildWeeklyMessage(stats: ProjectWeeklyStats[]): string {
  const { start, end } = getWeekRange();
  const startStr = dateString(start);
  const endStr = dateString(end);

  const header = [
    `📊 GitHub Trending Weekly - ${startStr} ~ ${endStr} 📊`,
    '',
    `本周出现次数最多的 Top ${Math.min(10, stats.length)} 项目`,
    '',
  ].join('\n');

  const pieces: string[] = [];

  if (stats.length > 0) {
    const top10 = stats.slice(0, 10);
    top10.forEach((stat, idx) => {
      pieces.push(formatWeeklyProjectBlock(stat, idx + 1));
    });
  } else {
    pieces.push('本周暂无符合条件的数据。\n\n');
  }

  return `${header}${pieces.join('')}`;
}

export async function sendTelegramWeeklyReport(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const threadIdRaw = process.env.TELEGRAM_THREAD_ID;
  const threadId = threadIdRaw ? Number.parseInt(threadIdRaw, 10) : Number.NaN;

  if (!token || !chatId || !threadIdRaw) {
    throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_THREAD_ID 缺失，已阻止发送。');
  }

  // 如果配置了 REQUIRED_TELEGRAM_CHAT_ID，则进行校验
  if (REQUIRED_CHAT_ID && chatId !== REQUIRED_CHAT_ID) {
    throw new Error(`TELEGRAM_CHAT_ID 不符合固定目标，收到 ${chatId}，期望 ${REQUIRED_CHAT_ID}`);
  }

  // 如果配置了 REQUIRED_TELEGRAM_THREAD_ID，则进行校验
  if (Number.isFinite(REQUIRED_THREAD_ID) && threadId !== REQUIRED_THREAD_ID) {
    throw new Error(`TELEGRAM_THREAD_ID 不符合固定目标，收到 ${threadIdRaw}，期望 ${REQUIRED_THREAD_ID}`);
  }

  const dailyDataList = await loadWeeklyData();
  const stats = calculateWeeklyStats(dailyDataList);
  const message = buildWeeklyMessage(stats);

  const bot = new TelegramBot(token, { polling: false });

  logInfo(
    `Start Telegram weekly notify. projects=${stats.length}, chatId=${chatId}, threadId=${threadId}`,
  );

  await withRetry(
    async () => {
      await bot.sendMessage(chatId, message, {
        disable_web_page_preview: true,
        message_thread_id: threadId,
      });
    },
    3,
    2_000,
  );

  logInfo('Telegram weekly notify completed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sendTelegramWeeklyReport().catch((error) => {
    logError('Telegram weekly notify failed.', error);
    process.exitCode = 1;
  });
}
