import crypto from 'node:crypto';
import fs from 'node:fs';

export interface Embedder {
  name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Local embeddings through Ollama's /api/embed endpoint (e.g. nomic-embed-text). */
export class OllamaEmbedder implements Embedder {
  name: string;
  constructor(
    private host: string,
    private model: string,
    private timeoutMs = 120_000,
  ) {
    this.name = `ollama:${model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32).map((t) => t.slice(0, 6000));
      const res = await fetch(`${this.host}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: batch }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
      const j = (await res.json()) as { embeddings: number[][] };
      out.push(...j.embeddings);
    }
    return out;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Disk cache so re-runs (and --resume-from) never re-embed unchanged chunks. */
export class EmbeddingCache {
  private data: Record<string, number[]> = {};
  constructor(private file: string) {
    if (fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }
  static key(model: string, text: string): string {
    return crypto.createHash('sha1').update(model + '\0' + text).digest('hex');
  }
  get(k: string): number[] | undefined {
    return this.data[k];
  }
  set(k: string, v: number[]): void {
    this.data[k] = v;
  }
  save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}
