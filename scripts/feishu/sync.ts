/**
 * Feishu Base Sync Script
 * 同步 GitHub Trending 数据到飞书多维表格并推送群消息
 */

import * as fs from 'fs';
import * as path from 'path';
import { FeishuSDK } from './sdk';
import type { DailyData, GitHubProject } from '../../lib/types';

// 配置
const CONFIG = {
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  feishuBaseToken: process.env.FEISHU_BASE_TOKEN || '',
  feishuTableId: process.env.FEISHU_TABLE_ID || '',
  feishuChatId: process.env.FEISHU_CHAT_ID || '',
};

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
    日期: date,
    仓库ID: project.id,
    仓库名: project.name,
    所有者: project.owner,
    链接: project.url,
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
 * 同步数据到飞书 Base
 */
async function syncToBase(data: DailyData): Promise<number> {
  console.log(`Syncing ${data.projects.length} projects to Feishu Base...`);

  const sdk = new FeishuSDK(CONFIG.feishuAppId, CONFIG.feishuAppSecret);

  const records = data.projects.map((project) => ({
    fields: convertToBaseRecord(project, data.date),
  }));

  const recordIds = await sdk.batchCreateRecords(
    CONFIG.feishuBaseToken,
    CONFIG.feishuTableId,
    records
  );

  console.log(`Successfully created ${recordIds.length} records`);
  return recordIds.length;
}

/**
 * 筛选 Hot 项目 Top N
 */
function getHotTopN(data: DailyData, n: number): GitHubProject[] {
  const hotProjects = data.projects.filter((p) => p.category === 'hot');
  return hotProjects
    .sort((a, b) => b.stars_today - a.stars_today)
    .slice(0, n);
}

/**
 * 生成 Markdown 消息
 */
function generateMessage(data: DailyData, top5: GitHubProject[]): string {
  const lines: string[] = [
    `## GitHub Trending Daily - ${data.date}`,
    '',
    '### Top 5 Hot Projects',
    '',
  ];

  top5.forEach((project, index) => {
    const summary = project.ai_summary
      ? project.ai_summary.replace(new RegExp(`^${project.name} 是`), '这是一个')
      : project.description || '暂无描述';

    lines.push(
      `**${index + 1}. [${project.id}](${project.url})** ⭐ +${project.stars_today}`,
      `> ${summary}`,
      ''
    );
  });

  // 添加统计信息
  const hotCount = data.projects.filter((p) => p.category === 'hot').length;
  const gemCount = data.projects.filter((p) => p.category === 'gem').length;

  lines.push(
    '---',
    '',
    `**今日统计**: Hot ${hotCount} 个 | Gem ${gemCount} 个`,
    '',
    `[查看完整数据](https://base.feishu.cn/${CONFIG.feishuBaseToken})`
  );

  return lines.join('\n');
}

/**
 * 发送群消息
 */
async function sendNotification(message: string): Promise<void> {
  console.log('Sending notification to Feishu group...');

  const sdk = new FeishuSDK(CONFIG.feishuAppId, CONFIG.feishuAppSecret);
  const messageId = await sdk.sendMessage(CONFIG.feishuChatId, message, 'post');

  console.log('Message sent successfully, message_id:', messageId);
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

    // 获取 Top 5 Hot
    const top5 = getHotTopN(data, 5);
    console.log(`Selected top ${top5.length} hot projects`);

    // 生成并发送消息
    const message = generateMessage(data, top5);
    await withRetry(() => sendNotification(message), 3, 1000);

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
