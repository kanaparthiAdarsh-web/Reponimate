import { tokenize } from './tokenize.js';

/** Classic Okapi BM25 over pre-tokenized documents. */
export class Bm25 {
  private docs: Map<string, number>[] = [];
  private lengths: number[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(
    texts: string[],
    private k1 = 1.4,
    private b = 0.75,
  ) {
    for (const t of texts) {
      const tf = new Map<string, number>();
      const toks = tokenize(t);
      for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      this.docs.push(tf);
      this.lengths.push(toks.length);
    }
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }

  idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  score(query: string): number[] {
    const q = [...new Set(tokenize(query))];
    return this.docs.map((tf, i) => {
      let s = 0;
      for (const term of q) {
        const f = tf.get(term);
        if (!f) continue;
        s += (this.idf(term) * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lengths[i]) / (this.avgLen || 1)));
      }
      return s;
    });
  }
}
