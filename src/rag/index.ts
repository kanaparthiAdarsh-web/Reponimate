import type { Chunk, KnowledgeBase } from '../core/schemas.js';
import { Bm25 } from './bm25.js';
import { cosine, EmbeddingCache, type Embedder } from './embeddings.js';

export interface Hit {
  chunk: Chunk;
  score: number;
}

/**
 * Hybrid retriever: BM25 keyword search fused with dense embeddings via reciprocal-rank fusion.
 * Works with BM25 alone when no embedder is available, so the pipeline never depends on a model being installed.
 */
export class KnowledgeIndex {
  private bm25: Bm25;
  private vectors: number[][] | null = null;
  readonly byId: Map<string, Chunk>;

  private constructor(
    readonly kb: KnowledgeBase,
    private embedder: Embedder | null,
  ) {
    this.bm25 = new Bm25(kb.chunks.map((c) => `${c.path} ${c.heading ?? ''} ${c.text}`));
    this.byId = new Map(kb.chunks.map((c) => [c.id, c]));
  }

  get mode(): string {
    return this.vectors ? `hybrid (BM25 + ${this.embedder!.name})` : 'BM25 only';
  }

  static async build(
    kb: KnowledgeBase,
    opts: { embedder?: Embedder | null; cacheFile?: string; onWarn?: (m: string) => void } = {},
  ): Promise<KnowledgeIndex> {
    const idx = new KnowledgeIndex(kb, opts.embedder ?? null);
    if (opts.embedder && kb.chunks.length) {
      try {
        const cache = opts.cacheFile ? new EmbeddingCache(opts.cacheFile) : null;
        const keys = kb.chunks.map((c) => EmbeddingCache.key(opts.embedder!.name, c.text));
        const missing = kb.chunks.filter((_, i) => !cache?.get(keys[i]));
        if (missing.length) {
          const vecs = await opts.embedder.embed(missing.map((c) => `${c.path}\n${c.text}`));
          let j = 0;
          kb.chunks.forEach((_, i) => {
            if (!cache?.get(keys[i])) cache?.set(keys[i], vecs[j++]);
          });
          if (!cache) idx.vectors = vecs;
        }
        if (cache) {
          idx.vectors = keys.map((k) => cache.get(k)!);
          cache.save();
        }
      } catch (err) {
        idx.vectors = null;
        opts.onWarn?.(`Embeddings unavailable (${(err as Error).message.split('\n')[0]}); using BM25 keyword retrieval only.`);
      }
    }
    return idx;
  }

  async search(query: string, k = 6, filter?: (c: Chunk) => boolean): Promise<Hit[]> {
    const chunks = this.kb.chunks;
    const bm = this.bm25.score(query);
    const candidates = chunks.map((c, i) => i).filter((i) => !filter || filter(chunks[i]));
    const rrf = new Map<number, number>();
    const add = (ranked: number[]): void => ranked.forEach((i, r) => rrf.set(i, (rrf.get(i) ?? 0) + 1 / (60 + r)));
    add([...candidates].filter((i) => bm[i] > 0).sort((a, b) => bm[b] - bm[a]).slice(0, 50));
    if (this.vectors && this.embedder) {
      try {
        const [qv] = await this.embedder.embed([query]);
        const sims = candidates.map((i) => [i, cosine(qv, this.vectors![i])] as const);
        add(sims.sort((a, b) => b[1] - a[1]).slice(0, 50).map(([i]) => i));
      } catch {
        /* keyword results still stand */
      }
    }
    return [...rrf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([i, score]) => ({ chunk: chunks[i], score }));
  }
}
