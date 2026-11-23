import type { AppConfig } from '../../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

/** Proveedor de LLM intercambiable (local con Ollama, Azure OpenAI/Foundry, OpenAI-compatible, Anthropic). */
export interface LlmProvider {
  readonly id: string;
  readonly model: string | null;
  readonly available: boolean;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
}

export class LlmUnavailableError extends Error {
  constructor() {
    super('No hay ningún proveedor LLM configurado (LLM_PROVIDER=none).');
    this.name = 'LlmUnavailableError';
  }
}

export function createLlmProvider(cfg: AppConfig): LlmProvider {
  const l = cfg.llm;
  switch (l.provider) {
    case 'ollama':
      return new OllamaLlm(l.baseUrl ?? 'http://127.0.0.1:11434', l.model ?? 'qwen3:8b');
    case 'openai-compatible':
      return new OpenAICompatibleLlm(
        'openai-compatible',
        l.baseUrl ?? 'https://api.openai.com/v1',
        l.model ?? 'gpt-5-mini',
        {
          ...(l.apiKey ? { Authorization: `Bearer ${l.apiKey}` } : {}),
        },
      );
    case 'azure-openai': {
      // Endpoint v1 de Azure OpenAI / Foundry: compatible con la API de OpenAI; el "model" es el nombre del deployment.
      const base = `${(l.baseUrl ?? '').replace(/\/$/, '')}/openai/v1`;
      return new OpenAICompatibleLlm('azure-openai', base, l.model ?? 'gpt-5-mini', {
        'api-key': l.apiKey ?? '',
      });
    }
    case 'anthropic':
      return new AnthropicLlm(l.model ?? 'claude-haiku-5-5', l.apiKey ?? '');
    default:
      return new NoLlm();
  }
}

class NoLlm implements LlmProvider {
  readonly id = 'none';
  readonly model = null;
  readonly available = false;
  async chat(): Promise<string> {
    throw new LlmUnavailableError();
  }
}

class OpenAICompatibleLlm implements LlmProvider {
  readonly available = true;
  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    readonly model: string,
    private readonly headers: Record<string, string>,
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_completion_tokens: opts.maxTokens ?? 1500,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message.content ?? '';
  }
}

class OllamaLlm implements LlmProvider {
  readonly id = 'ollama';
  readonly available = true;
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        think: false,
        ...(opts.json ? { format: 'json' } : {}),
        options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 1500, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { message: { content: string } };
    return data.message.content;
  }
}

class AnthropicLlm implements LlmProvider {
  readonly id = 'anthropic';
  readonly available: boolean;
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {
    this.available = Boolean(apiKey);
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1500,
        system: opts.json ? `${system}\n\nResponde únicamente con JSON válido.` : system,
        messages: messages.filter((m) => m.role !== 'system'),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    return data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');
  }
}

/** Extrae el primer objeto JSON de una respuesta (los modelos a veces lo envuelven en ```json). */
export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error('La IA no devolvió JSON válido');
  }
}
