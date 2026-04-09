/**
 * Supabase Client
 * 用于将 Trending 数据写入 Supabase 数据库
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { DailyData, GitHubProject } from './types';

// 单例模式
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

/**
 * 同步项目基础信息到 projects 表
 */
export async function upsertProject(project: GitHubProject): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('projects')
    .upsert(
      {
        id: project.id,
        name: project.name,
        owner: project.owner,
        url: project.url,
        description: project.description,
        language: project.language,
      },
      { onConflict: 'id' }
    );

  if (error) {
    console.error('Failed to upsert project:', project.id, error);
    throw error;
  }
}

/**
 * 同步每日趋势数据到 daily_trending 表
 */
export async function upsertDailyTrending(
  project: GitHubProject,
  date: string
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('daily_trending')
    .upsert(
      {
        project_id: project.id,
        date,
        stars: project.stars,
        stars_today: project.stars_today,
        stars_this_week: project.stars_this_week,
        forks: project.forks,
        ai_summary: project.ai_summary,
        category: project.category,
        tags: project.tags,
        security_score: project.security_score,
        trending_days: project.trending_days,
        first_seen: project.first_seen,
      },
      { onConflict: 'project_id,date' }
    );

  if (error) {
    console.error('Failed to upsert daily trending:', project.id, date, error);
    throw error;
  }
}

/**
 * 同步整日的数据到 Supabase
 */
export async function syncDailyData(dailyData: DailyData): Promise<void> {
  console.log('Syncing data to Supabase...');

  // 1. 同步项目基础信息
  for (const project of dailyData.projects) {
    await upsertProject(project);
  }
  console.log(`Synced ${dailyData.projects.length} projects`);

  // 2. 同步每日趋势数据
  for (const project of dailyData.projects) {
    await upsertDailyTrending(project, dailyData.date);
  }
  console.log(`Synced ${dailyData.projects.length} daily trending records`);

  console.log('Supabase sync completed');
}

/**
 * 获取指定日期范围的数据（用于周报/月报）
 */
export async function getTrendingDataByDateRange(
  startDate: string,
  endDate: string
): Promise<GitHubProject[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('daily_trending')
    .select(`
      *,
      projects (*)
    `)
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) {
    console.error('Failed to get trending data:', error);
    throw error;
  }

  // 转换为 GitHubProject 格式
  return data.map((row: any) => ({
    id: row.project_id,
    name: row.projects.name,
    owner: row.projects.owner,
    url: row.projects.url,
    description: row.projects.description,
    language: row.projects.language,
    stars: row.stars,
    forks: row.forks,
    stars_today: row.stars_today,
    stars_this_week: row.stars_this_week,
    category: row.category,
    tags: row.tags,
    ai_summary: row.ai_summary,
    security_score: row.security_score,
    trending_days: row.trending_days,
    first_seen: row.first_seen,
  }));
}

/**
 * 获取本周高频项目（用于周报）
 */
export async function getWeeklyTopProjects(
  startDate: string,
  endDate: string,
  limit: number = 10
): Promise<
  Array<{
    project_id: string;
    appear_days: number;
    total_stars_today: number;
    avg_stars_today: number;
  }>
> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc('get_weekly_top_projects', {
    start_date: startDate,
    end_date: endDate,
    limit_count: limit,
  });

  if (error) {
    // 如果 RPC 不存在，使用客户端查询
    console.warn('RPC not found, using client query:', error);
    return getWeeklyTopProjectsClient(startDate, endDate, limit);
  }

  return data;
}

/**
 * 客户端实现：获取本周高频项目
 */
async function getWeeklyTopProjectsClient(
  startDate: string,
  endDate: string,
  limit: number
): Promise<
  Array<{
    project_id: string;
    appear_days: number;
    total_stars_today: number;
    avg_stars_today: number;
  }>
> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('daily_trending')
    .select('project_id, stars_today')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) {
    console.error('Failed to get weekly top projects:', error);
    throw error;
  }

  // 在客户端聚合统计
  const stats = new Map<
    string,
    { appear_days: number; total_stars_today: number }
  >();

  for (const row of data) {
    const existing = stats.get(row.project_id);
    if (existing) {
      existing.appear_days++;
      existing.total_stars_today += row.stars_today || 0;
    } else {
      stats.set(row.project_id, {
        appear_days: 1,
        total_stars_today: row.stars_today || 0,
      });
    }
  }

  // 转换为数组并排序
  const result = Array.from(stats.entries()).map(
    ([project_id, stat]) => ({
      project_id,
      appear_days: stat.appear_days,
      total_stars_today: stat.total_stars_today,
      avg_stars_today: Math.round(stat.total_stars_today / stat.appear_days),
    })
  );

  // 按上榜天数排序，再按 Star 数排序
  result.sort((a, b) => {
    if (b.appear_days !== a.appear_days) {
      return b.appear_days - a.appear_days;
    }
    return b.total_stars_today - a.total_stars_today;
  });

  return result.slice(0, limit);
}

/**
 * 获取本周新上榜项目
 */
export async function getWeeklyNewComers(
  startDate: string,
  endDate: string
): Promise<string[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('daily_trending')
    .select('project_id')
    .gte('date', startDate)
    .lte('date', endDate)
    .gte('first_seen', startDate)
    .limit(20);

  if (error) {
    console.error('Failed to get new comers:', error);
    throw error;
  }

  // 去重
  return [...new Set(data.map((row: any) => row.project_id))];
}

/**
 * 获取热门标签统计
 */
export async function getHotTags(
  startDate: string,
  endDate: string
): Promise<Array<{ tag: string; count: number }>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('daily_trending')
    .select('tags')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) {
    console.error('Failed to get hot tags:', error);
    throw error;
  }

  // 统计标签出现次数
  const tagCounts = new Map<string, number>();
  for (const row of data) {
    for (const tag of row.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  // 转换为数组并排序
  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
