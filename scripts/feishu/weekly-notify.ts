/**
 * 飞书周报/月报推送
 */

import axios from 'axios';
import type { WeeklyReport, MonthlyReport } from '../db/reports';
import type { GitHubProject } from '../../lib/types';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  chatId: string;
}

let cachedToken: { token: string; expireAt: number } | null = null;

function getFeishuConfig(): FeishuConfig {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const chatId = process.env.FEISHU_CHAT_ID;

  if (!appId || !appSecret || !chatId) {
    throw new Error('FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_CHAT_ID must be set');
  }

  return { appId, appSecret, chatId };
}

async function getAccessToken(config: FeishuConfig): Promise<string> {
  if (cachedToken && cachedToken.expireAt > Date.now()) {
    return cachedToken.token;
  }

  const response = await axios.post(
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
  const expireAt = Date.now() + (response.data.expire! - 300) * 1000;
  cachedToken = { token, expireAt };

  return token;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * 构建周报卡片
 */
function buildWeeklyCard(report: WeeklyReport): unknown {
  const elements: unknown[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**📊 数据概览**\n本周共 **${report.totalProjects}** 个项目上榜，累计新增 **${formatNumber(report.totalNewStars)}** Star`,
      },
    },
    { tag: 'hr' },
  ];

  // 霸榜项目（出现3天以上）
  const霸榜项目 = report.topProjects.filter((p) => p.appearDays >= 3);
  if (霸榜项目.length > 0) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**🏆 本周霸榜项目（出现${霸榜项目[0].appearDays}天以上）**`,
      },
    });

    霸榜项目.slice(0, 5).forEach((item, index) => {
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${index + 1}. ${item.project.id}**\n出现 ${item.appearDays} 天，累计 +${formatNumber(item.totalStarsToday)} Star`,
        },
      });

      if (item.project.ai_summary) {
        elements.push({
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `💡 ${item.project.ai_summary.slice(0, 80)}...`,
          },
        });
      }

      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '🔗 查看仓库',
            },
            type: 'primary',
            url: item.project.url,
          },
        ],
      });

      if (index < Math.min(霸榜项目.length, 5) - 1) {
        elements.push({ tag: 'hr' });
      }
    });
  }

  // 新上榜项目
  if (report.newComers.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**🆕 新上榜项目**`,
      },
    });

    report.newComers.forEach((project) => {
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `• **${project.id}** - ${project.ai_summary?.slice(0, 50) || project.description?.slice(0, 50) || '无描述'}...`,
        },
      });
    });
  }

  // 热门标签
  if (report.hotTags.length > 0) {
    elements.push({ tag: 'hr' });
    const tagText = report.hotTags
      .slice(0, 5)
      .map((t) => `${t.tag} (${t.count}个)`)
      .join(' | ');

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**📈 热门标签**\n${tagText}`,
      },
    });
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: `📊 GitHub Trending 周报 (${report.weekStart} ~ ${report.weekEnd})`,
      },
      template: 'blue',
    },
    elements,
  };
}

/**
 * 构建月报卡片
 */
function buildMonthlyCard(report: MonthlyReport): unknown {
  const elements: unknown[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**📈 数据概览**\n本月共 **${report.totalProjects}** 个项目上榜，累计新增 **${formatNumber(report.totalNewStars)}** Star`,
      },
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**🔥 趋势总结**\n${report.summary}`,
      },
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**🥇 本月之星**`,
      },
    },
  ];

  // Top 项目
  report.topProjects.slice(0, 5).forEach((item, index) => {
    const trendIcon = item.trend === 'rising' ? '⬆️' : item.trend === 'falling' ? '⬇️' : '➡️';
    const trendText = item.trend === 'rising' ? '上升' : item.trend === 'falling' ? '下降' : '稳定';

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${index + 1}. ${item.project.id}** ${trendIcon} ${trendText}\n上榜 ${item.appearDays} 天`,
      },
    });

    if (item.project.ai_summary) {
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `💡 ${item.project.ai_summary.slice(0, 60)}...`,
        },
      });
    }

    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '🔗 查看仓库',
          },
          type: 'primary',
          url: item.project.url,
        },
      ],
    });

    if (index < Math.min(report.topProjects.length, 5) - 1) {
      elements.push({ tag: 'hr' });
    }
  });

  // 热门标签
  if (report.hotTags.length > 0) {
    elements.push({ tag: 'hr' });
    const tagText = report.hotTags
      .slice(0, 5)
      .map((t) => `${t.tag} (${t.count}个)`)
      .join(' | ');

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**📊 热门标签**\n${tagText}`,
      },
    });
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: `📈 GitHub Trending 月报 (${report.yearMonth})`,
      },
      template: 'orange',
    },
    elements,
  };
}

/**
 * 发送周报
 */
export async function sendWeeklyReportToFeishu(report: WeeklyReport): Promise<void> {
  console.log('Sending weekly report to Feishu...');

  const config = getFeishuConfig();
  const token = await getAccessToken(config);
  const card = buildWeeklyCard(report);

  const response = await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages',
    {
      receive_id: config.chatId,
      content: JSON.stringify(card),
      msg_type: 'interactive',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      params: { receive_id_type: 'chat_id' },
      timeout: 15000,
    }
  );

  if (response.data?.code !== 0) {
    throw new Error(`发送周报失败: ${response.data?.msg}`);
  }

  console.log('Weekly report sent successfully');
}

/**
 * 发送月报
 */
export async function sendMonthlyReportToFeishu(report: MonthlyReport): Promise<void> {
  console.log('Sending monthly report to Feishu...');

  const config = getFeishuConfig();
  const token = await getAccessToken(config);
  const card = buildMonthlyCard(report);

  const response = await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages',
    {
      receive_id: config.chatId,
      content: JSON.stringify(card),
      msg_type: 'interactive',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      params: { receive_id_type: 'chat_id' },
      timeout: 15000,
    }
  );

  if (response.data?.code !== 0) {
    throw new Error(`发送月报失败: ${response.data?.msg}`);
  }

  console.log('Monthly report sent successfully');
}
