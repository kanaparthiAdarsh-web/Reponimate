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
    'version summary recap wrap here now time today\'s inside under hood meet real source pieces fit weigh strengths weaknesses plus side other hand sum up keep read half story wired together interesting catch surprise secret magic actually really work works happen ' +
    'before after finally first next honest trade offs install hood pull back curtain lot more than meets eye clever trick ' +
    'question ever wonder wondered whether worth idea problem solve solves solved simple simpler deal big turns out guess ' +
    'stick around stay end because short answer long answer piece puzzle care break nutshell explained follow quick explainers up open though want would surprised surprising part parts').split(/\s+/).map(stem),
);

/** Sentences that announce themselves as comparisons rather than facts. */
const ANALOGY = /^(imagine|picture this|think of (it|this|that) (as|like)|it'?s (a bit |kind of |sort of )?like|kind of like|like a\b)/i;

/** Marketing words that need explicit source support before the narrator may say them. */
const HYPE = /\b(fastest|best|most popular|revolutionary|industry[- ]standard|blazing|world'?s (best|fastest|most|leading)|#1|number one|guaranteed)\b|\b(millions|billions)\b(?![^.]*\d)(?<!\d[^.]*)/i;

export interface SupportResult {
  supported: boolean;
  framing: boolean;
  score: number;
  chunkIds: string[];
  missingTerms: string[];
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'twenty', 'hundred', 'thousand', 'million', 'billion'];

/** Numbers stated in a sentence, as digits and as words ("4" ↔ "four"). "one" used as a pronoun is ignored. */
export function numbersIn(sentence: string): { raw: string; digits?: string; word?: string }[] {
  const out: { raw: string; digits?: string; word?: string }[] = [];
  for (const m of sentence.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])/g)) {
    const digits = m[0].replace(/,/g, '');
    const i = Number(digits);
    out.push({ raw: m[0], digits, word: Number.isInteger(i) && i < NUMBER_WORDS.length && i <= 12 ? NUMBER_WORDS[i] : undefined });
  }
  for (const m of sentence.toLowerCase().matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|hundred|thousand|million|billion)\b/g)) {
    const idx = NUMBER_WORDS.indexOf(m[1]);
    out.push({ raw: m[1], word: m[1], digits: idx <= 12 ? String(idx) : undefined });
  }
  return out;
}

const NAME_OK = new Set(['I', 'OK', 'Okay', 'Think', 'Imagine', 'Picture', 'Let', 'Here', 'Now', 'So', 'But', 'And', 'Or', 'Then', 'First', 'Next', 'Finally', 'Today', 'Meet', 'Ever', 'Why', 'What', 'How', 'Who', 'When', 'Where', 'Would', 'Could', 'Should', 'Did', 'Do', 'Does', 'Is', 'Are', 'Can']);

/** Capitalised words that are not sentence-initial (after ". ", ": ", quotes): likely names of people, companies or products. */
export function properNouns(sentence: string): string[] {
  const out: string[] = [];
  const words = sentence.replace(/[`"“”‘’()]/g, ' ').split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const w = words[i].replace(/['’]s$/, '').replace(/[^\p{L}\p{N}+#.-]/gu, '').replace(/[.-]+$/, '');
    if (!w || /[.!?:]$/.test(prev) || NAME_OK.has(w)) continue;
    if (/^\p{Lu}[\p{Ll}]+[\p{L}\p{N}]*$/u.test(w) || /^\p{Lu}{2,}[\p{L}\p{N}]*$/u.test(w)) out.push(w);
  }
  return out;
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
  // Rhetorical devices — viewer questions and explicitly marked analogies — assert nothing about the
  // subject, so they need no coverage; they still may not introduce names, numbers or hype.
  const question = /\?\s*$/.test(sentence);
  const analogy = ANALOGY.test(sentence);
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
  // Negation flips meaning without changing vocabulary ("does not support X" vs "supports X").
  const NEG = /\b(not|never|no|none|cannot|without|neither|nor)\b|n't\b/i;
  const bestChunk = bestIdx >= 0 ? chunks[bestIdx] : undefined;
  // Numbers (digits or words, any size) must appear in the chunks that actually support the sentence,
  // not merely somewhere in the evidence ("4" exists in almost any code file).
  const supporting = chunks
    .map((c, i) => ({ c, cov: substantive.filter((t) => tokenSets[i].has(t)).length }))
    .filter((x) => x.cov > 0)
    .sort((a, b) => b.cov - a.cov)
    .slice(0, 2)
    .map((x) => `${x.c.path}\n${x.c.text}`.toLowerCase());
  for (const n of numbersIn(sentence)) {
    const forms = [n.raw, n.digits, n.word].filter(Boolean) as string[];
    const found = supporting.some((t) => forms.some((f) => new RegExp(`(^|[^0-9a-z.])${f.toLowerCase().replace(/[.,]/g, (c) => '\\' + c)}([^0-9a-z]|$)`).test(t)));
    if (!found && !missingTerms.includes(n.raw)) missingTerms.push(n.raw);
  }
  const negationMismatch = NEG.test(sentence) && !(bestChunk && NEG.test(bestChunk.text));
  if (negationMismatch) missingTerms.push('(negation not found in the evidence)');
  if ((question || analogy) && /\b(is|are|was|were|has|have)\s+(the\s+)?(only|first|most|best|fastest)\b/i.test(sentence)) missingTerms.push('(superlative presupposition)');
  // Named entities (capitalised words mid-sentence) must exist in the evidence: no invented people, companies or products.
  for (const name of properNouns(sentence)) if (!all.includes(name.toLowerCase()) && !missingTerms.includes(name)) missingTerms.push(name);
  const needed = analogy ? 0 : question ? Math.min(threshold, 0.3) : threshold;
  return {
    supported: missingTerms.length === 0 && (substantive.length === 0 || score >= needed),
    framing: false,
    score,
    chunkIds: usedIds,
    missingTerms,
  };
}
