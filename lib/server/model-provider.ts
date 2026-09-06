import type { ProviderMode, RuntimeCapabilities } from '../domain';
import { getCaseDataTransmissionStatus } from './case-data-policy';
import { assertSchema, SchemaValidationError } from './schema-validator';
import { projectSchemaFields } from './schema-projection';

type JsonSchema = Record<string, unknown>;

export type ModelStage =
  | 'case_coordinator'
  | 'fact_rule_investigator'
  | 'disposition_compliance';

export type StructuredGenerationRequest = {
  stage: ModelStage;
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: JsonSchema;
  signal?: AbortSignal;
};

export type ModelCallMetadata = {
  responseId: string | null;
  model: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  omittedFieldCount: number;
};

export type StructuredGeneration<T> = {
  output: T;
  metadata: ModelCallMetadata;
};

export interface ModelProvider {
  readonly mode: ProviderMode;
  readonly model: string;
  generateStructured<T>(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGeneration<T>>;
}

type OpenAIResponse = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message?: string } | null;
};

const defaultModel = 'gpt-5.4-mini';

function runtimeConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
    model: process.env.OPENAI_MODEL?.trim() || defaultModel,
  };
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  const config = runtimeConfig();
  const transmission = getCaseDataTransmissionStatus();
  const glmConfigured =
    Boolean(process.env.GLM_API_KEY?.trim()) && validGlmBaseURL();
  const glmAvailable = glmConfigured && transmission === 'allowed';
  return {
    defaultProvider: glmAvailable ? 'glm' : 'recorded',
    caseDataTransmission: transmission,
    glm: {
      configured: glmConfigured,
      available: glmAvailable,
      model: process.env.GLM_MODEL?.trim() || 'glm-5.3-flash',
    },
    openai: {
      configured: Boolean(config.apiKey),
      available: false,
      model: config.model,
    },
  };
}

const glmBaseURL = 'https://open.bigmodel.cn/api/paas/v4';

function validGlmBaseURL() {
  return (
    (process.env.GLM_BASE_URL?.trim() || glmBaseURL).replace(/\/+$/, '') ===
    glmBaseURL
  );
}

const safeErrors = {
  NOT_CONFIGURED: '模型服务尚未配置',
  INVALID_ENDPOINT: '智谱 API 地址配置不正确，请使用官方通用接口',
  AUTHENTICATION: '智谱密钥无效或没有模型访问权限',
  QUOTA: '智谱可用额度不足或资源包不适用于该模型',
  RATE_LIMIT: '智谱请求频率受限，请稍后重试',
  TIMEOUT: '模型请求超时',
  UNAVAILABLE: '模型服务暂时不可用',
  INVALID_OUTPUT: '模型输出不完整或未通过结构化校验',
} as const;

export class ModelProviderError extends Error {
  constructor(
    readonly code: keyof typeof safeErrors,
    readonly diagnostic?: string,
  ) {
    super(safeErrors[code]);
    this.name = 'ModelProviderError';
  }
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function requiredFieldChecklist(schema: JsonSchema, path = '$'): string[] {
  if (
    schema.type === 'array' &&
    schema.items &&
    typeof schema.items === 'object'
  )
    return requiredFieldChecklist(schema.items as JsonSchema, `${path}[]`);
  if (schema.type !== 'object') return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  return [
    `${path} 必须且只能包含字段：${required.join('、')}`,
    ...Object.entries(properties).flatMap(([key, value]) =>
      requiredFieldChecklist(value, `${path}.${key}`),
    ),
  ];
}

export class GLMModelProvider implements ModelProvider {
  readonly mode = 'glm' as const;
  readonly model: string;
  readonly #apiKey: string;

  constructor() {
    if (!validGlmBaseURL()) throw new ModelProviderError('INVALID_ENDPOINT');
    this.#apiKey = process.env.GLM_API_KEY?.trim() ?? '';
    if (!this.#apiKey) throw new ModelProviderError('NOT_CONFIGURED');
    this.model = process.env.GLM_MODEL?.trim() || 'glm-5.3-flash';
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGeneration<T>> {
    const startedAt = performance.now();
    try {
      const timeout = AbortSignal.timeout(90000);
      const response = await fetch(`${glmBaseURL}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: request.signal
          ? AbortSignal.any([request.signal, timeout])
          : timeout,
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `${request.instructions}\n只返回一个 JSON 对象，不要输出 Markdown。必须严格遵守以下 JSON Schema，禁止增加字段：\n${JSON.stringify(request.schema)}\n输出前逐项检查每个对象的字段，尤其数组中的每一项，不能混用相似字段名：\n${requiredFieldChecklist(request.schema).join('\n')}`,
            },
            { role: 'user', content: JSON.stringify(request.input) },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'enabled' },
          reasoning_effort: 'low',
          temperature: 1,
          top_p: 0.95,
          max_tokens: request.stage === 'fact_rule_investigator' ? 8192 : 4096,
          stream: false,
        }),
      });
      const payload = (await response.json()) as {
        id?: string;
        model?: string;
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { code?: string | number };
      };
      if (!response.ok) {
        const code = String(payload.error?.code ?? '');
        if (response.status === 401 || response.status === 403)
          throw new ModelProviderError('AUTHENTICATION');
        if (response.status === 402 || code === '1113')
          throw new ModelProviderError('QUOTA');
        if (response.status === 429) throw new ModelProviderError('RATE_LIMIT');
        throw new ModelProviderError('UNAVAILABLE');
      }
      const choice = payload.choices?.[0];
      // Never expose reasoning_content, raw provider payloads, or truncated JSON.
      if (
        choice?.finish_reason !== 'stop' ||
        !choice.message?.content ||
        (payload.model && payload.model !== this.model)
      ) {
        throw new ModelProviderError(
          'INVALID_OUTPUT',
          choice?.finish_reason === 'length'
            ? 'OUTPUT_TRUNCATED'
            : 'RESPONSE_ENVELOPE',
        );
      }
      let output: T;
      let omittedFieldCount = 0;
      try {
        const projected = projectSchemaFields(
          JSON.parse(choice.message.content),
          request.schema,
        );
        output = projected.output as T;
        omittedFieldCount = projected.omittedFieldCount;
        assertSchema(output, request.schema);
      } catch (error) {
        throw new ModelProviderError(
          'INVALID_OUTPUT',
          error instanceof SchemaValidationError
            ? `SCHEMA:${error.issue}:${error.fieldPath}${error.fieldHint ? `:${error.fieldHint}` : ''}`
            : 'JSON_PARSE',
        );
      }
      return {
        output,
        metadata: {
          responseId:
            typeof payload.id === 'string' && /^[\w-]{1,200}$/.test(payload.id)
              ? payload.id
              : null,
          model: this.model,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          inputTokens: tokenCount(payload.usage?.prompt_tokens),
          outputTokens: tokenCount(payload.usage?.completion_tokens),
          omittedFieldCount,
        },
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      if (
        error instanceof Error &&
        ['TimeoutError', 'AbortError'].includes(error.name)
      )
        throw new ModelProviderError('TIMEOUT');
      throw new ModelProviderError('UNAVAILABLE');
    }
  }
}

export function createModelProvider(
  mode: Exclude<ProviderMode, 'recorded'>,
): ModelProvider {
  return mode === 'glm' ? new GLMModelProvider() : new OpenAIModelProvider();
}

function extractOutputText(response: OpenAIResponse) {
  if (response.output_text) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  throw new Error('模型响应未包含结构化文本输出');
}

export class OpenAIModelProvider implements ModelProvider {
  readonly mode = 'openai' as const;
  readonly model: string;
  readonly #apiKey: string;

  constructor() {
    const config = runtimeConfig();
    if (!config.apiKey) throw new Error('模型服务尚未配置');
    this.#apiKey = config.apiKey;
    this.model = config.model;
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGeneration<T>> {
    const startedAt = performance.now();
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: request.signal,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        reasoning: { effort: 'low' },
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            schema: request.schema,
            strict: true,
          },
          verbosity: 'low',
        },
        store: false,
        metadata: {
          workflow: 'finance_complaint_copilot',
          stage: request.stage,
        },
      }),
    });

    const payload = (await response.json()) as OpenAIResponse;
    if (!response.ok) {
      throw new Error(
        payload.error?.message || `模型请求失败：${response.status}`,
      );
    }

    let output: T;
    try {
      output = JSON.parse(extractOutputText(payload)) as T;
    } catch (cause) {
      throw new Error(
        cause instanceof SyntaxError ? '模型结构化输出无法解析' : String(cause),
      );
    }

    return {
      output,
      metadata: {
        responseId: payload.id ?? 'response-unknown',
        model: payload.model ?? this.model,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
        omittedFieldCount: 0,
      },
    };
  }
}
