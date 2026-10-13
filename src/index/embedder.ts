/**
 * Embedding providers
 *
 * `ollama` talks to a local Ollama server's /api/embed endpoint. `fake`
 * produces deterministic pseudo-embeddings from a hash of the text and exists
 * so the indexer and search can be tested without a model.
 */

import { createHash } from 'crypto';

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface OllamaEmbedderOptions {
  url: string;
  model: string;
  /** Texts per request (default 16). */
  batchSize?: number;
  /** Retries per batch on transient failure (default 3). */
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ollama embedder. The dimension is discovered by embedding one probe string
 * at construction (via `create`), so the schema can be sized from it.
 */
export class OllamaEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;
  private url: string;
  private batchSize: number;
  private retries: number;

  private constructor(opts: Required<OllamaEmbedderOptions>, dim: number) {
    this.url = opts.url.replace(/\/+$/, '');
    this.model = opts.model;
    this.batchSize = opts.batchSize;
    this.retries = opts.retries;
    this.dim = dim;
  }

  static async create(options: OllamaEmbedderOptions): Promise<OllamaEmbedder> {
    // Explicit `undefined` values (config.ts passes batchSize: undefined when the
    // env var is unset) must not override the defaults, or the batch loop never advances.
    const opts: Required<OllamaEmbedderOptions> = {
      ...options,
      batchSize: options.batchSize ?? 16,
      retries: options.retries ?? 3,
    };
    const probe = new OllamaEmbedder(opts, 0);
    const [vec] = await probe.request(['dimension probe']);
    if (!vec || vec.length === 0) {
      throw new Error(`Ollama returned no embedding for model ${opts.model}`);
    }
    return new OllamaEmbedder(opts, vec.length);
  }

  private async request(input: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(`${this.url}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, input, truncate: true }),
        });
        if (!res.ok) {
          throw new Error(`Ollama /api/embed ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as { embeddings?: number[][] };
        if (!data.embeddings || data.embeddings.length !== input.length) {
          throw new Error('Ollama /api/embed returned a malformed response');
        }
        return data.embeddings;
      } catch (err) {
        lastError = err;
        if (attempt < this.retries) await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const vectors = await this.request(batch);
      for (const v of vectors) {
        if (v.length !== this.dim) {
          throw new Error(
            `Embedding dimension ${v.length} does not match model dimension ${this.dim}`
          );
        }
      }
      out.push(...vectors);
    }
    return out;
  }
}

/**
 * Deterministic fake embedder for tests. Builds a bag-of-words style vector
 * from token hashes so that texts sharing words land near each other, which is
 * enough to make retrieval tests meaningful without a model.
 */
export class FakeEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;

  constructor(dim = 64, model = 'fake') {
    this.dim = dim;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.one(text));
  }

  private one(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
    for (const word of words) {
      const h = createHash('sha256').update(word).digest();
      for (let i = 0; i < 4; i++) {
        const idx = h.readUInt16BE(i * 2) % this.dim;
        const sign = h[8 + i] & 1 ? 1 : -1;
        vec[idx] += sign;
      }
    }
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
    return vec.map(x => x / norm);
  }
}

export interface EmbedderConfig {
  provider: 'ollama' | 'fake';
  url?: string;
  model?: string;
  dim?: number;
  batchSize?: number;
}

export async function createEmbedder(config: EmbedderConfig): Promise<Embedder> {
  if (config.provider === 'fake') {
    return new FakeEmbedder(config.dim ?? 64, config.model ?? 'fake');
  }
  return OllamaEmbedder.create({
    url: config.url ?? 'http://localhost:11434',
    model: config.model ?? 'nomic-embed-text',
    batchSize: config.batchSize,
  });
}
