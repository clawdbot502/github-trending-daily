import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ClassifiedProject } from '../../lib/types';
import { logInfo, logWarn, safeText, withRetry } from '../../lib/utils';

interface KimiConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

interface KimiBatchSummary {
  id: string;
  summary: string;
}

const DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_MODEL = 'kimi-k2.5';
const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 5;
const MAX_SUMMARY_LENGTH = 60;

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
  const base = safeText(project.description) || `${project.name} 提供实用开源能力，建议查看仓库说明与示例。`;
  return toShortSummary(base, `${project.name} 提供实用开源能力。`);
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
  const parsed = Number.parseInt(process.env.KIMI_BATCH_SIZE ?? `${DEFAULT_BATCH_SIZE}`, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.max(1, Math.min(MAX_BATCH_SIZE, parsed));
}

function loadOpenClawMoonshotConfig(): Partial<KimiConfig> {
  try {
    const configPath = process.env.OPENCLAW_CONFIG_PATH ?? '/root/.openclaw/openclaw.json';
    if (!fs.existsSync(configPath)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      models?: {
        providers?: {
          moonshot?: {
            baseUrl?: string;
            apiKey?: string;
            models?: Array<{ id?: string }>;
          };
        };
      };
    };

    const moonshot = parsed.models?.providers?.moonshot;
    if (!moonshot) {
      return {};
    }

    return {
      baseUrl: moonshot.baseUrl,
      apiKey: typeof moonshot.apiKey === 'string' ? moonshot.apiKey : undefined,
      model: moonshot.models?.[0]?.id,
    };
  } catch (error) {
    logWarn(`Failed to load moonshot config from openclaw.json: ${toErrorMessage(error)}`);
    return {};
  }
}

function resolveKimiConfig(): KimiConfig {
  const fileConfig = loadOpenClawMoonshotConfig();

  return {
    apiKey: process.env.KIMI_API_KEY ?? fileConfig.apiKey,
    baseUrl: process.env.KIMI_BASE_URL ?? fileConfig.baseUrl ?? DEFAULT_BASE_URL,
    model: process.env.KIMI_MODEL ?? fileConfig.model ?? DEFAULT_MODEL,
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
    '你是一个资深技术编辑。请为每个 GitHub 项目生成一句高质量中文总结。',
    '要求：',
    '1) 每条总结 <= 50 字，直接说明“做什么 + 价值点”',
    '2) 不要营销口吻，不要空话',
    '3) 保持技术语义准确',
    '4) 必须输出 JSON 数组，格式严格为：[{"id":"owner/repo","summary":"..."}]',
    '5) 输出里不能缺项目，id 必须原样返回',
    '',
    '待总结项目：',
    items,
  ].join('\n');
}

async function callKimiForBatch(batch: ClassifiedProject[], config: KimiConfig): Promise<KimiBatchSummary[]> {
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
        throw new Error('Kimi response does not contain message.content');
      }

      return rawContent;
    },
    3,
    2_500,
  );

  const jsonPayload = extractJsonPayload(content);

  const parsed = JSON.parse(jsonPayload) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Kimi summary result is not an array JSON payload.');
  }

  const result: KimiBatchSummary[] = [];
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
  config: KimiConfig,
  summaryMap: Map<string, string>,
): Promise<void> {
  for (const project of batch) {
    try {
      const oneResult = await callKimiForBatch([project], config);
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

  const config = resolveKimiConfig();

  if (!config.apiKey) {
    logWarn('KIMI_API_KEY is missing. Fallback to description-based summaries.');
    for (const project of projects) {
      summaryMap.set(project.id, fallbackSummary(project));
    }
    return summaryMap;
  }

  const batchSize = resolveBatchSize();
  const batches = splitIntoBatches(projects, batchSize);
  logInfo(`Start AI summarization in ${batches.length} batch(es), batchSize=${batchSize}.`);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index] as ClassifiedProject[];

    try {
      const batchResult = await callKimiForBatch(batch, config);
      const batchMap = new Map(batchResult.map((item) => [item.id, item.summary]));

      for (const project of batch) {
        const generated = batchMap.get(project.id);
        summaryMap.set(project.id, toShortSummary(generated ?? '', fallbackSummary(project)));
      }

      logInfo(`AI summary batch ${index + 1}/${batches.length} completed.`);
    } catch (error) {
      logWarn(
        `AI summary batch ${index + 1}/${batches.length} failed, fallback to one-by-one retries: ${toErrorMessage(error)}`,
      );
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
