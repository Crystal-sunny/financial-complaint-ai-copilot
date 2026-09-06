import type { ProviderMode, RuntimeCapabilities } from '../domain';

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
};

export type ModelCallMetadata = {
  responseId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
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
  return {
    defaultProvider: 'recorded',
    openai: {
      available: Boolean(config.apiKey),
      model: config.model,
    },
  };
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
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
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
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
      },
    };
  }
}
