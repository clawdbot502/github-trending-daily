/**
 * 周报/月报生成模块
 * 基于 Supabase 数据生成周期性报告
 */

import type { GitHubProject } from '../../lib/types';
import {
  getSupabaseClient,
  getWeeklyTopProjects,
  getWeeklyNewComers,
  getHotTags,
} from '../../lib/supabase';

export interface WeeklyReport {
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;
  topProjects: Array<{
    project: GitHubProject;
    appearDays: number;
    totalStarsToday: number;
    avgStarsToday: number;
  }>;
  newComers: GitHubProject[];
  hotTags: Array<{ tag: string; count: number }>;
  totalProjects: number;
  totalNewStars: number;
}

export interface MonthlyReport {
  yearMonth: string; // "2026-04"
  monthStart: string;
  monthEnd: string;
  topProjects: Array<{
    project: GitHubProject;
    appearDays: number;
    trend: 'rising' | 'stable' | 'falling';
  }>;
  hotTags: Array<{ tag: string; count: number }>;
  totalProjects: number;
  totalNewStars: number;
  summary: string;
}

/**
 * 获取本周一和周日日期
 */
export function getWeekRange(date: Date = new Date()): { start: string; end: string } {
  const dayOfWeek = date.getDay(); // 0=周日, 1=周一
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(date);
  monday.setDate(date.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

/**
 * 获取指定月份的起止日期
 */
export function getMonthRange(year: number, month: number): { start: string; end: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // 月末

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/**
 * 获取项目完整信息
 */
async function getProjectDetails(projectIds: string[]): Promise<Map<string, GitHubProject>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .in('id', projectIds);

  if (error) {
    console.error('Failed to get project details:', error);
    throw error;
  }

  const projectMap = new Map<string, GitHubProject>();
  for (const row of data) {
    projectMap.set(row.id, {
      id: row.id,
      name: row.name,
      owner: row.owner,
      url: row.url,
      description: row.description,
      language: row.language,
      stars: 0,
      forks: 0,
      stars_today: 0,
      stars_this_week: 0,
      category: 'hot',
      tags: [],
      ai_summary: '',
      security_score: 0,
      trending_days: 0,
      first_seen: row.created_at,
    });
  }

  return projectMap;
}

/**
 * 获取项目的最新完整数据（包含 ai_summary 等）
 */
async function getLatestProjectData(
  projectIds: string[],
  endDate: string
): Promise<Map<string, Partial<GitHubProject>>> {
  const supabase = getSupabaseClient();

  const result = new Map<string, Partial<GitHubProject>>();

  for (const projectId of projectIds) {
    const { data, error } = await supabase
      .from('daily_trending')
      .select('*')
      .eq('project_id', projectId)
      .lte('date', endDate)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.warn(`Failed to get latest data for ${projectId}:`, error);
      continue;
    }

    if (data) {
      result.set(projectId, {
        ai_summary: data.ai_summary,
        category: data.category,
        tags: data.tags,
        security_score: data.security_score,
        trending_days: data.trending_days,
        stars: data.stars,
        forks: data.forks,
      });
    }
  }

  return result;
}

/**
 * 生成周报
 */
export async function generateWeeklyReport(date: Date = new Date()): Promise<WeeklyReport> {
  console.log('Generating weekly report...');

  const { start, end } = getWeekRange(date);
  console.log(`Week range: ${start} to ${end}`);

  // 1. 获取本周高频项目
  const topProjectStats = await getWeeklyTopProjects(start, end, 10);
  console.log(`Found ${topProjectStats.length} top projects`);

  // 2. 获取项目详情
  const projectIds = topProjectStats.map((p) => p.project_id);
  const projectDetails = await getProjectDetails(projectIds);
  const latestData = await getLatestProjectData(projectIds, end);

  // 3. 合并数据
  const topProjects = topProjectStats
    .map((stat) => {
      const baseProject = projectDetails.get(stat.project_id);
      const latest = latestData.get(stat.project_id);

      if (!baseProject) return null;

      return {
        project: {
          ...baseProject,
          ...latest,
        } as GitHubProject,
        appearDays: stat.appear_days,
        totalStarsToday: stat.total_stars_today,
        avgStarsToday: stat.avg_stars_today,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // 4. 获取新上榜项目
  const newComerIds = await getWeeklyNewComers(start, end);
  const newComerDetails = await getProjectDetails(newComerIds);
  const newComerLatest = await getLatestProjectData(newComerIds, end);

  const newComers = newComerIds
    .map((id) => {
      const base = newComerDetails.get(id);
      const latest = newComerLatest.get(id);
      if (!base) return null;
      return { ...base, ...latest } as GitHubProject;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, 5); // 只展示前5个

  // 5. 获取热门标签
  const hotTags = await getHotTags(start, end);

  // 6. 统计数据
  const totalProjects = topProjects.length;
  const totalNewStars = topProjects.reduce((sum, p) => sum + p.totalStarsToday, 0);

  console.log('Weekly report generated successfully');

  return {
    weekStart: start,
    weekEnd: end,
    topProjects,
    newComers,
    hotTags,
    totalProjects,
    totalNewStars,
  };
}

/**
 * 生成月报
 */
export async function generateMonthlyReport(
  year: number,
  month: number
): Promise<MonthlyReport> {
  console.log(`Generating monthly report for ${year}-${month}...`);

  const { start, end } = getMonthRange(year, month);
  console.log(`Month range: ${start} to ${end}`);

  // 1. 获取本月高频项目
  const topProjectStats = await getWeeklyTopProjects(start, end, 15);

  // 2. 获取项目详情
  const projectIds = topProjectStats.map((p) => p.project_id);
  const projectDetails = await getProjectDetails(projectIds);

  // 3. 计算趋势（对比上月）
  const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const prevRange = getMonthRange(prevMonth.year, prevMonth.month);

  const { data: prevData } = await getSupabaseClient()
    .from('daily_trending')
    .select('project_id')
    .gte('date', prevRange.start)
    .lte('date', prevRange.end);

  const prevProjectIds = new Set(prevData?.map((d) => d.project_id) || []);

  // 4. 合并数据并计算趋势
  const latestData = await getLatestProjectData(projectIds, end);

  const topProjects = topProjectStats
    .map((stat) => {
      const baseProject = projectDetails.get(stat.project_id);
      const latest = latestData.get(stat.project_id);

      if (!baseProject) return null;

      // 判断趋势
      let trend: 'rising' | 'stable' | 'falling' = 'stable';
      if (!prevProjectIds.has(stat.project_id)) {
        trend = 'rising'; // 新上榜
      } else if (stat.appear_days >= 20) {
        trend = 'stable'; // 高频出现
      }

      return {
        project: {
          ...baseProject,
          ...latest,
        } as GitHubProject,
        appearDays: stat.appear_days,
        trend,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, 10);

  // 5. 获取热门标签
  const hotTags = await getHotTags(start, end);

  // 6. 统计数据
  const totalProjects = topProjectStats.length;
  const totalNewStars = topProjectStats.reduce((sum, p) => sum + p.total_stars_today, 0);

  // 7. 生成总结
  const summary = generateMonthlySummary(topProjects, hotTags);

  console.log('Monthly report generated successfully');

  return {
    yearMonth: `${year}-${String(month).padStart(2, '0')}`,
    monthStart: start,
    monthEnd: end,
    topProjects,
    hotTags,
    totalProjects,
    totalNewStars,
    summary,
  };
}

/**
 * 生成月度总结文字
 */
function generateMonthlySummary(
  topProjects: MonthlyReport['topProjects'],
  hotTags: MonthlyReport['hotTags']
): string {
  const risingCount = topProjects.filter((p) => p.trend === 'rising').length;
  const topTag = hotTags[0]?.tag || 'AI';
  const secondTag = hotTags[1]?.tag || '开源工具';

  return (
    `本月共有 ${topProjects.length} 个项目登上 Trending 榜，` +
    `其中 ${risingCount} 个为新上榜项目。` +
    `${topTag} 和 ${secondTag} 是本月最热门的技术方向，` +
    `反映出开发者对 ${topTag.toLowerCase()} 技术栈的持续关注。`
  );
}

/**
 * 判断今天是否应该生成周报（周日）
 */
export function shouldGenerateWeeklyReport(date: Date = new Date()): boolean {
  return date.getDay() === 0; // 周日
}

/**
 * 判断今天是否应该生成月报（每月1日）
 */
export function shouldGenerateMonthlyReport(date: Date = new Date()): boolean {
  return date.getDate() === 1;
}
