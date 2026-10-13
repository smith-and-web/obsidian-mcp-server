import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaEmbedder } from '../src/index/embedder.js';

describe('OllamaEmbedder defaults', () => {
  afterEach(() => vi.restoreAllMocks());

  it('embeds every text when batchSize and retries are explicitly undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const { input } = JSON.parse(init.body);
        return { ok: true, json: async () => ({ embeddings: input.map(() => [0.1, 0.2, 0.3]) }) };
      })
    );
    const e = await OllamaEmbedder.create({
      url: 'http://x',
      model: 'm',
      batchSize: undefined,
      retries: undefined,
    });
    const out = await e.embed(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    vi.unstubAllGlobals();
  });
});
