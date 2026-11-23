import type { AppConfig } from '../../config';

/**
 * Embeddings: representación numérica (vector) del significado de un texto.
 * Textos con significado parecido → vectores cercanos (similitud coseno), aunque no compartan palabras.
 */
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>;
}

export function createEmbeddingProvider(cfg: AppConfig): EmbeddingProvider {
  const e = cfg.embeddings;
  switch (e.provider) {
    case 'openai-compatible':
      return new OpenAICompatibleEmbeddings(e.baseUrl ?? 'https://api.openai.com/v1', e.model, e.apiKey);
    case 'ollama':
      return new OllamaEmbeddings(e.baseUrl ?? 'http://127.0.0.1:11434', e.model);
    default:
      return new LocalEmbeddings(e.model, cfg.paths.models);
  }
}

/** Modelo local ONNX vía transformers.js: gratis, offline tras la primera descarga, sin enviar datos fuera. */
class LocalEmbeddings implements EmbeddingProvider {
  readonly id = 'local';
  private extractor: Promise<(input: string[], opts: object) => Promise<{ tolist(): number[][] }>> | null =
    null;

  constructor(
    readonly model: string,
    private readonly cacheDir: string,
  ) {}

  private load() {
    this.extractor ??= (async () => {
      const t = await import('@huggingface/transformers');
      t.env.cacheDir = this.cacheDir;
      t.env.allowRemoteModels = true; // solo la primera vez descarga el modelo de Hugging Face
      const pipe = await t.pipeline('feature-extraction', this.model, { dtype: 'q8' });
      return pipe as unknown as (input: string[], opts: object) => Promise<{ tolist(): number[][] }>;
    })();
    return this.extractor;
  }

  async embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
    const extractor = await this.load();
    // Los modelos E5 esperan prefijos "query:"/"passage:" (búsqueda asimétrica).
    const isE5 = /e5/i.test(this.model);
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => (isE5 ? `${kind}: ${t}` : t));
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      for (const row of tensor.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }
}

class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  readonly id = 'openai-compatible';
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey?: string,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, input: texts.slice(i, i + 64) }),
      });
      if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { data: { embedding: number[] }[] };
      out.push(...data.data.map((d) => normalize(Float32Array.from(d.embedding))));
    }
    return out;
  }
}

class OllamaEmbeddings implements EmbeddingProvider {
  readonly id = 'ollama';
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`Ollama embeddings HTTP ${res.status}`);
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings.map((e) => normalize(Float32Array.from(e)));
  }
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}
