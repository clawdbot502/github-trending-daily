import { GitHubProject } from '@/lib/types';
import Link from 'next/link';

interface ProjectCardProps {
  project: GitHubProject;
  index: number;
}

export default function ProjectCard({ project, index }: ProjectCardProps) {
  const isHot = project.category === 'hot';
  const cardClass = isHot ? 'card-hot' : 'card-gem';
  const accentClass = isHot ? 'gradient-text-hot' : 'gradient-text-gem';
  
  // Security score color
  const getSecurityColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div
      className={`${cardClass} rounded-xl p-6 transition-all duration-300 hover:scale-[1.02] animate-fade-in-up opacity-0`}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <Link
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group"
          >
            <h3 className="text-xl font-bold mb-1 group-hover:underline">
              <span className="text-gray-400">{project.owner}/</span>
              <span className={accentClass}>{project.name}</span>
            </h3>
          </Link>
          
          {/* Trending badge */}
          {project.trending_days > 1 && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 text-xs mono">
              <span className="animate-glow">🔥</span>
              <span>连续 {project.trending_days} 天上榜</span>
            </div>
          )}
        </div>

        {/* Security score */}
        <div className="flex flex-col items-end">
          <div className={`text-2xl font-bold mono ${getSecurityColor(project.security_score)}`}>
            {project.security_score}
          </div>
          <div className="text-xs text-gray-500 mono">安全评分</div>
        </div>
      </div>

      {/* AI Summary */}
      <p className="text-gray-300 mb-4 leading-relaxed">
        {project.ai_summary}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {project.tags.map((tag) => (
          <span
            key={tag}
            className="px-3 py-1 rounded-full bg-white/5 text-xs font-medium border border-white/10"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-sm mono">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">⭐</span>
          <span className="font-bold">{project.stars.toLocaleString()}</span>
          {project.stars_today > 0 && (
            <span className={`text-xs ${isHot ? 'text-orange-400' : 'text-cyan-400'}`}>
              +{project.stars_today.toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-gray-500">🔱</span>
          <span>{project.forks.toLocaleString()}</span>
        </div>

        {project.language && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">💻</span>
            <span>{project.language}</span>
          </div>
        )}
      </div>

      {/* Security details (hover to show) */}
      <details className="mt-4 text-xs text-gray-500">
        <summary className="cursor-pointer hover:text-gray-300 transition-colors">
          安全详情
        </summary>
        <div className="mt-2 space-y-1 pl-4 border-l border-white/10">
          <div>作者账号年龄: {Math.floor(project.security_details.author_age_days / 365)} 年</div>
          <div>仓库年龄: {Math.floor(project.security_details.repo_age_days / 365)} 年</div>
          <div>License: {project.security_details.has_license ? '✓' : '✗'}</div>
          <div>README: {project.security_details.has_readme ? '✓' : '✗'}</div>
          <div>Issues: {project.security_details.issue_count}</div>
          <div>PRs: {project.security_details.pr_count}</div>
        </div>
      </details>
    </div>
  );
}
