/**
 * Feishu Base Sync Script
 * 同步 GitHub Trending 数据到飞书多维表格并推送群消息
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import type { DailyData, GitHubProject } from '../../lib/types';

// 配置
const CONFIG = {
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  feishuBaseToken: process.env.FEISHU_BASE_TOKEN || '',
  feishuTableId: process.env.FEISHU_TABLE_ID || '',
  feishuChatId: process.env.FEISHU_CHAT_ID || '',
};

let cachedToken: { token: string; expireAt: number } | null = null;

/**
 * 验证配置
 */
function validateConfig(): void {
  const required = [
    'feishuAppId',
    'feishuAppSecret',
    'feishuBaseToken',
    'feishuTableId',
    'feishuChatId',
  ];

  for (const key of required) {
    if (!CONFIG[key as keyof typeof CONFIG]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

/**
 * 获取 Trending 数据
 */
async function fetchTrendingData(): Promise<DailyData> {
  console.log('Fetching trending data...');

  // 优先读取本地生成的 data/latest.json
  const localPath = path.join(process.cwd(), 'data', 'latest.json');
  if (fs.existsSync(localPath)) {
    console.log('Using local data file:', localPath);
    const content = fs.readFileSync(localPath, 'utf-8');
    return JSON.parse(content) as DailyData;
  }

  throw new Error('Local data/latest.json not found. Run scrape first.');
}

/**
 * 转换项目数据为 Base 记录格式
 */
function convertToBaseRecord(
  project: GitHubProject,
  date: string
): Record<string, unknown> {
  return {
    日期: new Date(date).getTime(), // 转换为毫秒时间戳
    仓库ID: project.id,
    仓库名: project.name,
    所有者: project.owner,
    链接: { text: project.url, link: project.url },
    描述: project.description || '',
    AI总结: project.ai_summary || '',
    语言: project.language || 'Unknown',
    Star数: project.stars,
    Fork数: project.forks,
    今日Star: project.stars_today,
    本周Star: project.stars_this_week,
    分类: project.category,
    标签: project.tags || [],
    安全评分: project.security_score,
  };
}

/**
 * 获取飞书 tenant_access_token
 */
async function getAccessToken(): Promise<string> {
  // 检查缓存
  if (cachedToken && cachedToken.expireAt > Date.now()) {
    return cachedToken.token;
  }

  const response = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: CONFIG.feishuAppId,
      app_secret: CONFIG.feishuAppSecret,
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
 * 同步数据到飞书 Base
 */
async function syncToBase(data: DailyData): Promise<number> {
  console.log(`Syncing ${data.projects.length} projects to Feishu Base...`);

  const token = await getAccessToken();

  const records = data.projects.map((project) => ({
    fields: convertToBaseRecord(project, data.date),
  }));

  // 批量创建记录（飞书限制 500 条/次）
  const batchSize = 500;
  const recordIds: string[] = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const response = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${CONFIG.feishuBaseToken}/tables/${CONFIG.feishuTableId}/records/batch_create`,
      { records: batch },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.code !== 0) {
      throw new Error(`Failed to create records: ${response.data.msg}`);
    }

    recordIds.push(...response.data.data.records.map((r: { record_id: string }) => r.record_id));

    // 批次间延迟 500ms，避免限流
    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`Successfully created ${recordIds.length} records`);
  return recordIds.length;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * 构建 Interactive Card 消息
 */
function buildDailyCard(data: DailyData): unknown {
  const hotProjects = data.projects.filter((p) => p.category === 'hot');

  // 为每个项目构建卡片元素
  const projectElements: unknown[] = [];

  hotProjects.slice(0, 10).forEach((project, index) => {
    // 添加分隔线（第一个除外）
    if (index > 0) {
      projectElements.push({ tag: 'hr' });
    }

    // 项目标题
    projectElements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${index + 1}. ${project.id}**`,
      },
    });

    // 使用 AI 总结（如果有）
    const summary = project.ai_summary || project.description || '暂无描述';
    projectElements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `💡 ${summary}`,
      },
    });

    // 技术信息：语言 + Star 数（突出总星标）
    projectElements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `🔧 ${project.language || 'Unknown'} | ⭐ 总星标: ${formatNumber(project.stars)} | 今日新增: +${formatNumber(project.stars_today)}`,
      },
    });

    // 查看仓库按钮
    projectElements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '🔗 查看仓库',
          },
          type: 'primary',
          url: project.url,
        },
      ],
    });
  });

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: `🔥 GitHub 热门项目日报 - ${data.date}`,
      },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📊 今日 GitHub 趋势榜 Top ${Math.min(10, hotProjects.length)}**`,
        },
      },
      {
        tag: 'hr',
      },
      ...projectElements,
    ],
  };
}

/**
 * 发送群消息（使用 Interactive Card）
 */
async function sendNotification(data: DailyData): Promise<void> {
  console.log('Sending notification to Feishu group...');

  const token = await getAccessToken();
  const card = buildDailyCard(data);

  const response = await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages',
    {
      receive_id: CONFIG.feishuChatId,
      content: JSON.stringify(card),
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
    }
  );

  if (response.data?.code !== 0) {
    throw new Error(`发送消息失败: ${response.data?.msg}`);
  }

  console.log('Message sent successfully, message_id:', response.data.data?.message_id);
}

/**
 * 带重试的函数执行
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 2000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${i + 1} failed:`, lastError.message);

      if (i < retries - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        // 指数退避
        delay *= 2;
      }
    }
  }

  throw lastError;
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('=== Feishu Base Sync Started ===');
  console.log('Time:', new Date().toISOString());

  try {
    // 验证配置
    validateConfig();
    console.log('Configuration validated');

    // 获取数据
    const data = await withRetry(() => fetchTrendingData(), 3, 1000);
    console.log(`Fetched ${data.projects.length} projects for ${data.date}`);

    // 同步到 Base
    const syncedCount = await withRetry(() => syncToBase(data), 3, 2000);
    console.log(`Synced ${syncedCount} records to Feishu Base`);

    // 发送 Interactive Card 消息
    await withRetry(() => sendNotification(data), 3, 1000);

    console.log('=== Feishu Base Sync Completed ===');
    process.exit(0);
  } catch (error) {
    console.error('=== Feishu Base Sync Failed ===');
    console.error(error);
    process.exit(1);
  }
}

// 执行主函数
main();
