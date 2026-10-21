import type { Chunk } from '../core/schemas.js';
import { specificTerms, stem, tokenize } from './tokenize.js';

/** Words that frame a video without asserting anything about the subject. */
const FRAMING = new Set(
  ('look dive take start begin video today explore walk through together question comment subscribe think ' +
    'code project repo repository topic idea part section next first second final finally quick quickly see show ' +
    'let us talk explain explained understand closer deeper minute minutes watch thank thanks hey welcome okay ' +
    'right story journey break down tour ready why matter matters worth know interesting simple simply keep ' +
    'mind thing things way ways everything anything something going happen happens below link description ' +
    'channel tell share opinion favorite favourite try yourself you answer remember point big picture short ' +
    'version summary recap wrap here now time today\'s inside under hood meet real source pieces fit weigh strengths weaknesses plus side other hand sum up keep read').split(/\s+/).map(stem),
);

/** Marketing words that need explicit source support before the narrator may say them. */
const HYPE = /\b(fastest|best|most popular|revolutionary|industry[- ]standard|blazing|millions|billions|world'?s|#1|number one|guaranteed)\b/i;

export interface SupportResult {
  supported: boolean;
  framing: boolean;
  score: number;
  chunkIds: string[];
  missingTerms: string[];
}

export function splitSentences(text: string): string[] {
  // Split only where punctuation is followed by whitespace, so "index.js" or "v1.2" stay intact.
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks one sentence against candidate evidence chunks.
 * A sentence is supported when every specific term (identifier, file name, number) appears in the evidence
 * and enough of its content words are covered by a single chunk or by the union of the top chunks.
 */
export function checkSupport(sentence: string, chunks: Chunk[], threshold = 0.5): SupportResult {
  const content = [...new Set(tokenize(sentence))];
  const substantive = content.filter((t) => !FRAMING.has(t));
  const terms = specificTerms(sentence);
  const hype = HYPE.test(sentence);
  if (substantive.length === 0 && terms.length === 0 && !hype) {
    return { supported: true, framing: true, score: 1, chunkIds: [], missingTerms: [] };
  }
  const lowerTexts = chunks.map((c) => `${c.path}\n${c.heading ?? ''}\n${c.text}`.toLowerCase());
  const all = lowerTexts.join('\n');
  const missingTerms = terms.filter((t) => !all.includes(t.toLowerCase().replace(/`/g, '')));
  if (hype) {
    const m = sentence.match(HYPE)![0].toLowerCase();
    // A self-description ("the fastest X") is the author's claim, not a fact: it may only be repeated with attribution.
    const attributed = /\b(readme|according to|describes?|claims?|calls? itself|says|advertises|documentation)\b/i.test(sentence);
    if (!all.includes(m) || !attributed) missingTerms.push(m);
  }

  const tokenSets = chunks.map((c) => new Set(tokenize(`${c.path} ${c.heading ?? ''} ${c.text}`)));
  let best = 0;
  let bestIdx = -1;
  tokenSets.forEach((set, i) => {
    const cov = substantive.filter((t) => set.has(t)).length / Math.max(1, substantive.length);
    if (cov > best) {
      best = cov;
      bestIdx = i;
    }
  });
  const union = new Set<string>();
  for (const s of tokenSets.slice(0, 3)) for (const t of s) union.add(t);
  const unionCov = substantive.filter((t) => union.has(t)).length / Math.max(1, substantive.length);
  const score = Math.max(best, unionCov * 0.9);
  const usedIds = chunks
    .map((c, i) => ({ id: c.id, cov: substantive.filter((t) => tokenSets[i].has(t)).length }))
    .filter((x) => x.cov > 0)
    .sort((a, b) => b.cov - a.cov)
    .slice(0, 3)
    .map((x) => x.id);
  if (bestIdx >= 0 && !usedIds.includes(chunks[bestIdx].id)) usedIds.unshift(chunks[bestIdx].id);
  return {
    supported: missingTerms.length === 0 && (substantive.length === 0 || score >= threshold),
    framing: false,
    score,
    chunkIds: usedIds,
    missingTerms,
  };
}
