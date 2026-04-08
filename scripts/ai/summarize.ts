import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ClassifiedProject } from '../../lib/types';
import { logInfo, logWarn, safeText, withRetry } from '../../lib/utils';

interface SummaryConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

interface BatchSummary {
  id: string;
  summary: string;
}

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
const DEFAULT_MODEL = 'glm-5';
const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 5;
const MAX_SUMMARY_LENGTH = 120; // 增加到120字符以容纳两段式总结

function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  return trimmed;
}

function toShortSummary(text: string, fallback: string): string {
  const cleaned = safeText(text);
  if (!cleaned) {
    return fallback;
  }

  if (cleaned.length <= MAX_SUMMARY_LENGTH) {
    return cleaned;
  }

  return `${cleaned.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

function fallbackSummary(project: ClassifiedProject): string {
  const description = safeText(project.description);

  if (description && /[\u4e00-\u9fff]/.test(description)) {
    return toShortSummary(description, `${project.name} 提供实用开源能力。`);
  }

  const tagText = project.tags.length > 0 ? project.tags.join(' / ') : '开源工具';
  const language = project.language || '多语言';
  const chineseFallback = `${project.name} 是一个面向 ${tagText} 场景的开源项目，使用 ${language} 开发。`;

  return toShortSummary(chineseFallback, `${project.name} 提供实用开源能力。`);
}

function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const code = error.code;
    const message = error.message;

    if (status) {
      return `axios status=${status} code=${code ?? 'N/A'} message=${message}`;
    }

    return `axios code=${code ?? 'N/A'} message=${message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function resolveBatchSize(): number {
  const parsed = Number.parseInt(process.env.SUMMARY_BATCH_SIZE ?? process.env.KIMI_BATCH_SIZE ?? `${DEFAULT_BATCH_SIZE}`, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.max(1, Math.min(MAX_BATCH_SIZE, parsed));
}

function loadOpenClawSummaryConfig(): Partial<SummaryConfig> {
  try {
    const configPath = process.env.OPENCLAW_CONFIG_PATH ?? '/root/.openclaw/openclaw.json';
    if (!fs.existsSync(configPath)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      models?: {
        providers?: Record<string, {
          baseUrl?: string;
          apiKey?: string;
          models?: Array<{ id?: string }>;
        }>;
      };
    };

    const providers = parsed.models?.providers ?? {};
    const preferredProviders = ['zhipu-coding', 'openai', 'openrouter', 'moonshot'];

    for (const providerName of preferredProviders) {
      const provider = providers[providerName];
      if (!provider) {
        continue;
      }

      const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : undefined;
      const model = provider.models?.[0]?.id;
      if (!apiKey || !provider.baseUrl || !model) {
        continue;
      }

      return {
        apiKey,
        baseUrl: provider.baseUrl,
        model,
      };
    }

    return {};
  } catch (error) {
    logWarn(`Failed to load summary config from openclaw.json: ${toErrorMessage(error)}`);
    return {};
  }
}

function resolveSummaryConfig(): SummaryConfig {
  const fileConfig = loadOpenClawSummaryConfig();

  return {
    apiKey: process.env.SUMMARY_API_KEY ?? process.env.KIMI_API_KEY ?? fileConfig.apiKey,
    baseUrl: process.env.SUMMARY_BASE_URL ?? process.env.KIMI_BASE_URL ?? fileConfig.baseUrl ?? DEFAULT_BASE_URL,
    model: process.env.SUMMARY_MODEL ?? process.env.KIMI_MODEL ?? fileConfig.model ?? DEFAULT_MODEL,
  };
}

function buildBatchPrompt(batch: ClassifiedProject[]): string {
  const items = batch
    .map((project, index) => {
      return [
        `${index + 1}. id=${project.id}`,
        `name=${project.name}`,
        `language=${project.language || 'Unknown'}`,
        `description=${project.description || 'N/A'}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    '你是一个资深技术编辑。请为每个 GitHub 项目生成高质量中文总结。',
    '要求：',
    '1) 每个项目生成两段式总结，用” | “分隔：',
    '   - 第一段(提炼核心)：基于原始 description 提炼项目的核心功能和用途，30字以内',
    '   - 第二段(突出亮点)：分析项目的技术特点、差异化优势或适用场景，30字以内',
    '2) 总长度控制在80字以内',
    '3) 不要营销口吻，不要空话，保持技术语义准确',
    '4) 必须输出 JSON 数组，格式严格为：[{“id”:”owner/repo”,”summary”:”核心功能 | 亮点特色”}]',
    '5) 输出里不能缺项目，id 必须原样返回',
    '',
    '待总结项目：',
    items,
  ].join('\n');
}

async function callSummaryApiForBatch(batch: ClassifiedProject[], config: SummaryConfig): Promise<BatchSummary[]> {
  const payload = {
    model: config.model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: '你是严谨的技术内容助手，只输出用户要求的 JSON。',
      },
      {
        role: 'user',
        content: buildBatchPrompt(batch),
      },
    ],
  };

  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const content = await withRetry(
    async () => {
      const response = await axios.post<{
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      }>(endpoint, payload, {
        timeout: 25_000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
      });

      const rawContent = response.data.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error('Summary API response does not contain message.content');
      }

      return rawContent;
    },
    3,
    2_500,
  );

  const jsonPayload = extractJsonPayload(content);

  const parsed = JSON.parse(jsonPayload) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Summary result is not an array JSON payload.');
  }

  const result: BatchSummary[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const id = safeText((item as { id?: string }).id);
    const summary = safeText((item as { summary?: string }).summary);

    if (!id || !summary) {
      continue;
    }

    result.push({
      id,
      summary,
    });
  }

  return result;
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

async function summarizeBatchOneByOne(
  batch: ClassifiedProject[],
  config: SummaryConfig,
  summaryMap: Map<string, string>,
): Promise<void> {
  for (const project of batch) {
    try {
      const oneResult = await callSummaryApiForBatch([project], config);
      const oneSummary = oneResult.find((item) => item.id === project.id)?.summary;
      summaryMap.set(project.id, toShortSummary(oneSummary ?? '', fallbackSummary(project)));
    } catch (error) {
      logWarn(`AI single retry failed for ${project.id}, fallback summary applied: ${toErrorMessage(error)}`);
      summaryMap.set(project.id, fallbackSummary(project));
    }
  }
}

export async function summarizeProjects(projects: ClassifiedProject[]): Promise<Map<string, string>> {
  const summaryMap = new Map<string, string>();

  if (projects.length === 0) {
    return summaryMap;
  }

  const config = resolveSummaryConfig();

  if (!config.apiKey) {
    logWarn('SUMMARY_API_KEY/KIMI_API_KEY is missing. Fallback to Chinese template summaries.');
    for (const project of projects) {
      summaryMap.set(project.id, fallbackSummary(project));
    }
    return summaryMap;
  }

  const batchSize = resolveBatchSize();
  const batches = splitIntoBatches(projects, batchSize);
  logInfo(`Start AI summarization with model=${config.model} in ${batches.length} batch(es), batchSize=${batchSize}.`);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index] as ClassifiedProject[];

    try {
      const batchResult = await callSummaryApiForBatch(batch, config);
      const batchMap = new Map(batchResult.map((item) => [item.id, item.summary]));

      for (const project of batch) {
        const generated = batchMap.get(project.id);
        summaryMap.set(project.id, toShortSummary(generated ?? '', fallbackSummary(project)));
      }

      logInfo(`AI summary batch ${index + 1}/${batches.length} completed.`);
    } catch (error) {
      const errMessage = toErrorMessage(error);

      if (errMessage.includes('ECONNABORTED') || errMessage.toLowerCase().includes('timeout')) {
        logWarn(
          `AI summary batch ${index + 1}/${batches.length} timeout. model=${config.model} endpoint 当前不可用，剩余项目统一使用中文兜底摘要。`,
        );

        for (let rest = index; rest < batches.length; rest += 1) {
          for (const project of batches[rest] as ClassifiedProject[]) {
            summaryMap.set(project.id, fallbackSummary(project));
          }
        }

        return summaryMap;
      }

      logWarn(`AI summary batch ${index + 1}/${batches.length} failed, fallback to one-by-one retries: ${errMessage}`);
      await summarizeBatchOneByOne(batch, config, summaryMap);
    }
  }

  return summaryMap;
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  logInfo('Summarizer module is intended to be called from scripts/main.ts');
}
