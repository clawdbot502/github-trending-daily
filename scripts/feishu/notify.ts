import axios from 'axios';
import path from 'node:path';
import fs from 'node:fs/promises';

import type { DailyData, GitHubProject } from '../../lib/types';
import { logError, logInfo, withRetry } from '../../lib/utils';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  // 接收消息的 chat_id（群聊或私聊）- 必须设置
  chatId: string;
}

interface WeeklyProjectStats {
  project: GitHubProject;
  appearDays: number;
  totalStarsToday: number;
}

interface AccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

let cachedToken: { token: string; expireAt: number } | null = null;

function getFeishuConfig(): FeishuConfig {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const chatId = process.env.FEISHU_CHAT_ID;

  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量必须设置');
  }

  if (!chatId) {
    throw new Error(
      'FEISHU_CHAT_ID 环境变量必须设置\n' +
      '请设置目标群聊的 chat_id，格式如：oc_xxxxxxxxxxxxxxxx\n' +
      '获取方式：飞书开放平台 -> 群组详情 -> 查看 chat_id'
    );
  }

  return { appId, appSecret, chatId };
}

/**
 * 获取飞书 tenant_access_token
 * 使用 App ID 和 App Secret 进行应用级别认证
 */
async function getAccessToken(config: FeishuConfig): Promise<string> {
  // 检查缓存
  if (cachedToken && cachedToken.expireAt > Date.now()) {
    return cachedToken.token;
  }

  const response = await axios.post<AccessTokenResponse>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: config.appId,
      app_secret: config.appSecret,
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  );

  if (response.data.code !== 0) {
    throw new Error(`获取 access token 失败: ${response.data.msg}`);
  }

  const token = response.data.tenant_access_token!;
  // 提前 5 分钟过期
  const expireAt = Date.now() + (response.data.expire! - 300) * 1000;
  cachedToken = { token, expireAt };

  return token;
}

/**
 * 发送飞书消息
 */
async function sendFeishuMessage(
  chatId: string,
  content: unknown,
  config: FeishuConfig
): Promise<void> {
  const token = await getAccessToken(config);

  await withRetry(
    async () => {
      const response = await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        {
          receive_id: chatId,
          content: JSON.stringify(content),
          msg_type: 'interactive',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          params: {
            receive_id_type: 'chat_id',
          },
          timeout: 15000,
        }
      );

      if (response.data?.code !== 0) {
        throw new Error(`发送消息失败: ${response.data?.msg}`);
      }

      return response.data;
    },
    3,
    2000
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * 构建日报卡片
 */
function buildDailyCard(data: DailyData): unknown {
  const hotProjects = data.projects.filter((p) => p.category === 'hot');

  const projectDivs = hotProjects.slice(0, 10).map((project, index) => ({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${index + 1}. [${project.id}](${project.url})**\n💡 ${project.ai_summary}\n⭐ ${formatNumber(project.stars)} (+${formatNumber(project.stars_today)} today)`,
    },
  }));

  return {
    config: {
      wide_screen_mode: true,
    },
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
          content: `**今日最热 Top ${Math.min(10, hotProjects.length)} 项目**`,
        },
      },
      {
        tag: 'hr',
      },
      ...projectDivs,
    ],
  };
}

/**
 * 构建周榜卡片
 */
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

  const projectDivs = stats.slice(0, 10).map((stat, index) => ({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${index + 1}. [${stat.project.id}](${stat.project.url})**\n💡 ${stat.project.ai_summary}\n⭐ ${formatNumber(stat.project.stars)} (本周新增 +${formatNumber(stat.totalStarsToday)})\n📅 本周上榜 ${stat.appearDays} 天`,
    },
  }));

  return {
    config: {
      wide_screen_mode: true,
    },
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
          content: `**本周出现次数最多的 Top ${Math.min(10, stats.length)} 项目**`,
        },
      },
      {
        tag: 'hr',
      },
      ...projectDivs,
    ],
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

/**
 * 发送日报
 */
export async function sendFeishuDailyReport(): Promise<void> {
  const config = getFeishuConfig();
  const data = await readLatestDailyData();

  const card = buildDailyCard(data);
  await sendFeishuMessage(config.chatId, card, config);

  logInfo(`Feishu daily report sent to chat ${config.chatId}`);
}

/**
 * 发送周报
 */
export async function sendFeishuWeeklyReport(): Promise<void> {
  const config = getFeishuConfig();
  const stats = await calculateWeeklyStats();

  const card = buildWeeklyCard(stats);
  await sendFeishuMessage(config.chatId, card, config);

  logInfo(`Feishu weekly report sent to chat ${config.chatId}`);
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];

  if (mode === 'weekly') {
    sendFeishuWeeklyReport().catch((error) => {
      logError('Feishu weekly notify failed', error);
      process.exit(1);
    });
  } else {
    sendFeishuDailyReport().catch((error) => {
      logError('Feishu daily notify failed', error);
      process.exit(1);
    });
  }
}
