import { DailyData } from '@/lib/types';
import ProjectCard from '@/components/ProjectCard';
import fs from 'fs';
import path from 'path';

async function getData(): Promise<DailyData> {
  const filePath = path.join(process.cwd(), 'data', 'latest.json');
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(fileContent);
}

export default async function Home() {
  const data = await getData();
  const hotProjects = data.projects.filter(p => p.category === 'hot');
  const gemProjects = data.projects.filter(p => p.category === 'gem');

  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <header className="relative overflow-hidden border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-20">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 via-transparent to-cyan-500/10 pointer-events-none" />
          
          <div className="relative z-10">
            <div className="animate-slide-in-left opacity-0">
              <h1 className="text-6xl md:text-8xl font-bold mb-6 leading-tight">
                GitHub
                <br />
                <span className="gradient-text-hot">Trending</span>
                <br />
                Daily
              </h1>
            </div>

            <div className="animate-fade-in-up opacity-0 delay-200">
              <p className="text-xl text-gray-400 max-w-2xl mb-8">
                每日自动抓取 GitHub 热门项目，AI 智能总结，安全评分
                <br />
                助你发现最有价值的开源项目
              </p>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-8 animate-fade-in-up opacity-0 delay-300">
              <div>
                <div className="text-4xl font-bold gradient-text-hot mono">
                  {data.stats.total}
                </div>
                <div className="text-sm text-gray-500 mono">今日精选</div>
              </div>
              <div>
                <div className="text-4xl font-bold gradient-text-hot mono">
                  {data.stats.hot}
                </div>
                <div className="text-sm text-gray-500 mono">热门项目</div>
              </div>
              <div>
                <div className="text-4xl font-bold gradient-text-gem mono">
                  {data.stats.gem}
                </div>
                <div className="text-sm text-gray-500 mono">宝藏项目</div>
              </div>
            </div>

            {/* Date */}
            <div className="mt-8 animate-fade-in-up opacity-0 delay-400">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                <span className="text-gray-500">📅</span>
                <span className="mono text-sm">
                  {new Date(data.date).toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long'
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Hot Projects Section */}
      {hotProjects.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 py-16">
          <div className="mb-8">
            <h2 className="text-4xl font-bold mb-2">
              <span className="gradient-text-hot">🔥 热门项目</span>
            </h2>
            <p className="text-gray-400">
              Star 增长迅速，社区活跃度高的项目
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {hotProjects.map((project, index) => (
              <ProjectCard key={project.id} project={project} index={index} />
            ))}
          </div>
        </section>
      )}

      {/* Gem Projects Section */}
      {gemProjects.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 py-16">
          <div className="mb-8">
            <h2 className="text-4xl font-bold mb-2">
              <span className="gradient-text-gem">💎 宝藏项目</span>
            </h2>
            <p className="text-gray-400">
              小众但有价值，解决实际问题的创意项目
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {gemProjects.map((project, index) => (
              <ProjectCard key={project.id} project={project} index={index} />
            ))}
          </div>
        </section>
      )}

      {/* Tags Cloud */}
      <section className="max-w-7xl mx-auto px-6 py-16 border-t border-white/10">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">
            <span className="text-gray-300">🏷️ 热门标签</span>
          </h2>
        </div>

        <div className="flex flex-wrap gap-4">
          {Object.entries(data.stats.by_tag)
            .sort(([, a], [, b]) => b - a)
            .map(([tag, count]) => (
              <div
                key={tag}
                className="px-6 py-3 rounded-full bg-white/5 border border-white/10 hover:border-white/20 transition-all hover:scale-105"
              >
                <span className="font-bold">{tag}</span>
                <span className="ml-2 text-gray-500 mono text-sm">×{count}</span>
              </div>
            ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12">
        <div className="max-w-7xl mx-auto px-6 text-center text-gray-500 text-sm">
          <p className="mb-2">
            每天香港时间 9:00 自动更新
          </p>
          <p>
            数据来源：GitHub Trending | AI 总结：Kimi | 安全评分：启发式规则
          </p>
          <p className="mt-4">
            <a
              href="https://github.com/brucey0017-cloud/github-trending-daily"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors underline"
            >
              View on GitHub
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
