import fs from 'node:fs/promises';
import path from 'node:path';

import type { ClassifiedProject, DailyData, GitHubProject } from '../lib/types';
import { logError, logInfo } from '../lib/utils';
import { summarizeProjects } from './ai/summarize';
import { filterAndClassifyProjects } from './filter/index';
import { scrapeTrending } from './scraper/index';
import { scoreProjectSecurity } from './security/score';

interface MonthlyArchive {
  month: string;
  days: DailyData[];
}

const DATA_DIR = path.resolve('data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthStamp(date: Date): string {
  return date.toISOString().slice(0, 7);
}

async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(HISTORY_DIR, { recursive: true });
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function buildStats(projects: GitHubProject[]): DailyData['stats'] {
  const byTag: Record<string, number> = {};

  for (const project of projects) {
    for (const tag of project.tags) {
      byTag[tag] = (byTag[tag] ?? 0) + 1;
    }
  }

  return {
    total: projects.length,
    hot: projects.filter((project) => project.category === 'hot').length,
    gem: projects.filter((project) => project.category === 'gem').length,
    by_tag: byTag,
  };
}

function toGitHubProject(
  project: ClassifiedProject,
  summary: string,
  security: {
    security_score: number;
    security_details: GitHubProject['security_details'];
  },
  previous?: GitHubProject,
  currentDate?: string,
): GitHubProject {
  return {
    id: project.id,
    name: project.name,
    owner: project.owner,
    url: project.url,
    description: project.description,
    ai_summary: summary,
    language: project.language,
    stars: project.stars,
    forks: project.forks,
    stars_today: project.stars_today,
    stars_this_week: project.stars_this_week,
    category: project.category,
    tags: project.tags,
    security_score: security.security_score,
    security_details: security.security_details,
    trending_days: previous ? previous.trending_days + 1 : 1,
    first_seen: previous?.first_seen ?? `${currentDate ?? dateStamp(new Date())}T00:00:00.000Z`,
  };
}

async function saveDailyData(dailyData: DailyData): Promise<void> {
  const dailyPath = path.join(DATA_DIR, `${dailyData.date}.json`);
  const latestPath = path.join(DATA_DIR, 'latest.json');

  await fs.writeFile(dailyPath, `${JSON.stringify(dailyData, null, 2)}\n`, 'utf8');
  await fs.writeFile(latestPath, `${JSON.stringify(dailyData, null, 2)}\n`, 'utf8');
}

async function updateMonthlyArchive(dailyData: DailyData): Promise<void> {
  const month = dailyData.date.slice(0, 7);
  const archivePath = path.join(HISTORY_DIR, `${month}.json`);

  const existing = await readJsonIfExists<MonthlyArchive>(archivePath);
  const archive: MonthlyArchive = existing ?? {
    month,
    days: [],
  };

  const nextDays = archive.days.filter((item) => item.date !== dailyData.date);
  nextDays.push(dailyData);
  nextDays.sort((a, b) => a.date.localeCompare(b.date));

  archive.days = nextDays;
  await fs.writeFile(archivePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
}

export async function runPipeline(): Promise<DailyData> {
  await ensureDataDirs();

  const now = new Date();
  const today = dateStamp(now);
  const latestPath = path.join(DATA_DIR, 'latest.json');

  logInfo(`Pipeline started for ${today}.`);

  const scraped = await scrapeTrending();
  // 只取 hot 分类的项目，最多 10 条
  const filtered = filterAndClassifyProjects(scraped)
    .filter((p) => p.category === 'hot')
    .slice(0, 10);

  if (filtered.length === 0) {
    throw new Error('No project selected after filter. Pipeline aborted.');
  }

  const summaries = await summarizeProjects(filtered);
  const securityScores = await scoreProjectSecurity(filtered);

  const securityMap = new Map(securityScores.map((item) => [item.id, item]));

  const previousDaily = await readJsonIfExists<DailyData>(latestPath);
  const previousMap = new Map((previousDaily?.projects ?? []).map((project) => [project.id, project]));

  const projects: GitHubProject[] = filtered.map((project) => {
    const previous = previousMap.get(project.id);
    const summary = summaries.get(project.id) ?? project.description;
    const security = securityMap.get(project.id) ?? {
      security_score: 50,
      security_details: {
        author_age_days: 0,
        repo_age_days: 0,
        has_license: false,
        has_readme: false,
        issue_count: 0,
        pr_count: 0,
        star_fork_ratio: project.stars / Math.max(project.forks, 1),
      },
    };

    return toGitHubProject(project, summary, security, previous, today);
  });

  const sortedProjects = projects.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category === 'hot' ? -1 : 1;
    }
    if (b.stars_today !== a.stars_today) {
      return b.stars_today - a.stars_today;
    }
    if (b.stars_this_week !== a.stars_this_week) {
      return b.stars_this_week - a.stars_this_week;
    }
    return b.stars - a.stars;
  });

  const dailyData: DailyData = {
    date: today,
    generated_at: now.toISOString(),
    projects: sortedProjects,
    stats: buildStats(sortedProjects),
  };

  await saveDailyData(dailyData);
  await updateMonthlyArchive(dailyData);

  logInfo(
    `Pipeline completed. projects=${dailyData.projects.length}, hot=${dailyData.stats.hot}, gem=${dailyData.stats.gem}, month=${monthStamp(now)}`,
  );

  return dailyData;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline()
    .then((dailyData) => {
      logInfo(`Saved files: data/${dailyData.date}.json, data/latest.json, data/history/${dailyData.date.slice(0, 7)}.json`);
    })
    .catch((error) => {
      logError('Pipeline failed.', error);
      process.exitCode = 1;
    });
}
