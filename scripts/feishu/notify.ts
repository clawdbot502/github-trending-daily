import axios from 'axios';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

import type { DailyData, GitHubProject } from '../../lib/types';
import { logError, logInfo, withRetry } from '../../lib/utils';

interface FeishuConfig {
  webhookUrl: string;
  secret?: string;
}

interface WeeklyProjectStats {
  project: GitHubProject;
  appearDays: number;
  totalStarsToday: number;
}

function generateSign(secret: string): { timestamp: string; sign: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac('sha256', stringToSign).digest('base64');
  return { timestamp, sign };
}

function getFeishuConfig(): FeishuConfig {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('FEISHU_WEBHOOK_URL 环境变量未设置');
  }
  return {
    webhookUrl,
    secret: process.env.FEISHU_SECRET,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function buildDailyCard(data: DailyData): unknown {
  const hotProjects = data.projects.filter((p) => p.category === 'hot');

  const projectElements = hotProjects.slice(0, 10).map((project, index) => ({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${index + 1}. [${project.id}](${project.url})**\n💡 ${project.ai_summary}\n⭐ ${formatNumber(project.stars)} (+${formatNumber(project.stars_today)} today)`,
    },
  }));

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: `🔥 GitHub Trending Daily - ${data.date}`,
        },
        template: 'orange',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `今日最热 Top ${Math.min(10, hotProjects.length)} 项目`,
          },
        },
        { tag: 'hr' },
        ...projectElements,
      ],
    },
  };
}

function buildDailyText(data: DailyData): unknown {
  const hotProjects = data.projects.filter((p) => p.category === 'hot');
  const lines = [
    `🔥 GitHub Trending Daily - ${data.date}`,
    '',
    `今日最热 Top ${Math.min(10, hotProjects.length)} 项目`,
    '',
  ];

  hotProjects.slice(0, 10).forEach((project, index) => {
    lines.push(`${index + 1}. ${project.id}`);
    lines.push(`💡 ${project.ai_summary}`);
    lines.push(`⭐ ${formatNumber(project.stars)} (+${formatNumber(project.stars_today)} today)`);
    lines.push(`🔗 ${project.url}`);
    lines.push('');
  });

  return {
    msg_type: 'text',
    content: { text: lines.join('\n') },
  };
}

function buildWeeklyCard(stats: WeeklyProjectStats[]): unknown {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const formatDate = (d: Date) => d.toISOString().slice(0, 10);
  const weekRange = `${formatDate(monday)} ~ ${formatDate(sunday)}`;

  const projectElements = stats.slice(0, 10).map((stat, index) => ({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${index + 1}. [${stat.project.id}](${stat.project.url})**\n💡 ${stat.project.ai_summary}\n⭐ ${formatNumber(stat.project.stars)} (本周新增 +${formatNumber(stat.totalStarsToday)})\n📅 本周上榜 ${stat.appearDays} 天`,
    },
  }));

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: `📊 GitHub Trending Weekly - ${weekRange}`,
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `本周出现次数最多的 Top ${Math.min(10, stats.length)} 项目`,
          },
        },
        { tag: 'hr' },
        ...projectElements,
      ],
    },
  };
}

async function readLatestDailyData(): Promise<DailyData> {
  const latestPath = path.resolve('data/latest.json');
  const content = await fs.readFile(latestPath, 'utf8');
  return JSON.parse(content) as DailyData;
}

async function calculateWeeklyStats(): Promise<WeeklyProjectStats[]> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);
  const dataDir = path.resolve('data');
  const projectMap = new Map<string, WeeklyProjectStats>();

  for (let i = 0; i <= daysSinceMonday; i++) {
    const currentDate = new Date(monday);
    currentDate.setDate(monday.getDate() + i);
    const dateStr = currentDate.toISOString().slice(0, 10);
    const filePath = path.join(dataDir, `${dateStr}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const dailyData = JSON.parse(content) as DailyData;
      for (const project of dailyData.projects) {
        const existing = projectMap.get(project.id);
        if (existing) {
          existing.appearDays += 1;
          existing.totalStarsToday += project.stars_today;
          existing.project = project;
        } else {
          projectMap.set(project.id, {
            project,
            appearDays: 1,
            totalStarsToday: project.stars_today,
          });
        }
      }
    } catch {
      // 文件不存在则跳过
    }
  }

  const stats = Array.from(projectMap.values());
  stats.sort((a, b) => {
    if (b.appearDays !== a.appearDays) return b.appearDays - a.appearDays;
    if (b.totalStarsToday !== a.totalStarsToday) return b.totalStarsToday - a.totalStarsToday;
    return b.project.stars - a.project.stars;
  });
  return stats;
}

async function sendToFeishu(payload: unknown, config: FeishuConfig): Promise<void> {
  const { webhookUrl, secret } = config;
  const body: Record<string, unknown> = { ...payload };
  if (secret) {
    const { timestamp, sign } = generateSign(secret);
    body.timestamp = timestamp;
    body.sign = sign;
  }
  await withRetry(
    async () => {
      const response = await axios.post(webhookUrl, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      if (response.data?.code !== 0) {
        throw new Error(`Feishu API error: ${JSON.stringify(response.data)}`);
      }
      return response.data;
    },
    3,
    2000,
  );
}

export async function sendFeishuDailyReport(): Promise<void> {
  const config = getFeishuConfig();
  const data = await readLatestDailyData();
  try {
    const payload = buildDailyCard(data);
    await sendToFeishu(payload, config);
    logInfo('Feishu daily card message sent');
  } catch (error) {
    logError('Card failed, fallback to text', error);
    const payload = buildDailyText(data);
    await sendToFeishu(payload, config);
    logInfo('Feishu daily text message sent');
  }
}

export async function sendFeishuWeeklyReport(): Promise<void> {
  const config = getFeishuConfig();
  const stats = await calculateWeeklyStats();
  const payload = buildWeeklyCard(stats);
  await sendToFeishu(payload, config);
  logInfo('Feishu weekly card message sent');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  if (mode === 'weekly') {
    sendFeishuWeeklyReport().catch((error) => {
      logError('Feishu weekly failed', error);
      process.exit(1);
    });
  } else {
    sendFeishuDailyReport().catch((error) => {
      logError('Feishu daily failed', error);
      process.exit(1);
    });
  }
}
