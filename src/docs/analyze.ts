import type { Chunk, Claim, DocAnalysis, KnowledgeBase } from '../core/schemas.js';
import { assignIds, chunkProse } from '../rag/chunker.js';
import { tokenize } from '../rag/tokenize.js';
import type { LoadedDoc } from './sources.js';
import { UserError } from '../core/errors.js';

export interface LocatedSentence {
  text: string;
  line: number;
  sourceId: string;
  path: string;
}

/** Splits text into sentences while remembering the line each one starts on (for evidence). */
export function sentencesWithLines(text: string, sourceId: string, path: string): LocatedSentence[] {
  const out: LocatedSentence[] = [];
  const lines = text.split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence || /^\s*#/.test(line) || /^\s*[|>]/.test(line)) return;
    const clean = line.replace(/^\s*[-*+]\s+|^\s*\d+[.)]\s+/, '').replace(/\[(\d+|citation needed)\]/g, '').replace(/[*_`]/g, '').trim();
    for (const s of clean.match(/[^.!?]+(?:[.!?]+["')\]]?|$)/g) ?? []) {
      const t = s.trim();
      const words = t.split(/\s+/).length;
      if (words >= 5 && words <= 45 && /[a-zA-Z]/.test(t)) out.push({ text: /[.!?]["')\]]?$/.test(t) ? t : t + '.', line: i + 1, sourceId, path });
    }
  });
  return out;
}

/** Sentence importance: average IDF-weighted term frequency, with a bonus for appearing early in its section. */
export function rankSentences(sentences: LocatedSentence[], docFreq: Map<string, number>, totalDocs: number): { s: LocatedSentence; score: number }[] {
  const tf = new Map<string, number>();
  for (const s of sentences) for (const t of tokenize(s.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
  return sentences.map((s, i) => {
    const toks = tokenize(s.text);
    const score =
      toks.reduce((a, t) => a + (tf.get(t) ?? 0) * Math.log(1 + totalDocs / (1 + (docFreq.get(t) ?? 0))), 0) / Math.max(4, toks.length) +
      (i === 0 ? 1.5 : i < 3 ? 0.5 : 0);
    return { s, score };
  });
}

interface Section {
  heading: string;
  sourceId: string;
  path: string;
  startLine: number;
  text: string;
}

function splitSections(doc: LoadedDoc): Section[] {
  const lines = doc.text.split('\n');
  const sections: Section[] = [];
  let cur: Section = { heading: doc.source.title, sourceId: doc.source.id, path: doc.source.title, startLine: 1, text: '' };
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    if (h) {
      if (cur.text.trim()) sections.push(cur);
      cur = { heading: h[2].replace(/[*_`]/g, ''), sourceId: doc.source.id, path: doc.source.title, startLine: i + 1, text: '' };
    } else cur.text += (cur.text ? '\n' : '') + line;
  });
  if (cur.text.trim()) sections.push(cur);
  // Prose without headings: group paragraphs into parts of roughly 220 words.
  if (sections.length === 1 && sections[0].text.split(/\s+/).length > 400) {
    const paras = sections[0].text.split(/\n\s*\n/);
    const grouped: Section[] = [];
    let buf = '';
    let start = 1;
    let line = 1;
    for (const p of paras) {
      if (!buf) start = line;
      buf += (buf ? '\n\n' : '') + p;
      line += p.split('\n').length + 1;
      if (buf.split(/\s+/).length > 220) {
        grouped.push({ heading: '', sourceId: doc.source.id, path: doc.source.title, startLine: start, text: buf });
        buf = '';
      }
    }
    if (buf) grouped.push({ heading: '', sourceId: doc.source.id, path: doc.source.title, startLine: start, text: buf });
    return grouped;
  }
  return sections;
}

const DISPLAY_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'which', 'their', 'have', 'has', 'been', 'also', 'into', 'such', 'other', 'more', 'most', 'than', 'they', 'them', 'its', 'can', 'may', 'will', 'one', 'two', 'used', 'use', 'using', 'these', 'those', 'many', 'some', 'when', 'where', 'what', 'about', 'after', 'before', 'between', 'during', 'over', 'under', 'while', 'would', 'could', 'should', 'there', 'then', 'each', 'only', 'both', 'first', 'new', 'all', 'not', 'but', 'his', 'her', 'had', 'who']);

function keyTerms(text: string, n: number): string[] {
  const counts = new Map<string, { n: number; display: string }>();
  for (const m of text.matchAll(/\b[A-Za-z][A-Za-z0-9+#.-]{2,}\b/g)) {
    const w = m[0].replace(/[.-]+$/, '');
    const k = w.toLowerCase();
    if (DISPLAY_STOP.has(k) || k.length < 4) continue;
    const e = counts.get(k) ?? { n: 0, display: w };
    e.n++;
    if (/^[A-Z]/.test(w)) e.display = w;
    counts.set(k, e);
  }
  return [...counts.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, n).map((e) => e.display);
}

export function analyzeDocs(docs: LoadedDoc[], titleOverride?: string): { analysis: DocAnalysis; knowledge: KnowledgeBase } {
  const sections = docs.flatMap(splitSections).filter((s) => s.text.split(/\s+/).length >= 25);
  const allSentences = sections.map((s) => sentencesWithLines(s.text, s.sourceId, s.path).map((x) => ({ ...x, line: x.line + s.startLine })));
  const docFreq = new Map<string, number>();
  for (const sent of allSentences) {
    const seen = new Set(sent.flatMap((x) => tokenize(x.text)));
    for (const t of seen) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const ev = (s: LocatedSentence) => ({ sourceId: s.sourceId, path: s.path, startLine: s.line, endLine: s.line });
  const claimOf = (s: LocatedSentence): Claim => ({ text: s.text, status: 'verified', evidence: [ev(s)] });

  const outSections: DocAnalysis['sections'] = sections.map((sec, i) => {
    const ranked = rankSentences(allSentences[i], docFreq, sections.length)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .sort((a, b) => a.s.line - b.s.line);
    const heading = sec.heading || keyTerms(sec.text, 2).join(' & ') || `Part ${i + 1}`;
    return { heading, chunkIds: [], keyPoints: ranked.map((r) => claimOf(r.s)) };
  });

  const lead = docs.flatMap((d) => sentencesWithLines(d.text, d.source.id, d.source.title))[0];
  const first = lead ?? allSentences.flat()[0];
  if (!first) throw new UserError('No readable sentences were found in the material (only code, tables or very short lines?).');
  const title = titleOverride || docs[0].source.title;
  const allText = docs.map((d) => d.text).join('\n');
  const numbers = allSentences
    .flat()
    .filter((s) => /\b(1[5-9]\d\d|20\d\d|\d+(\.\d+)?\s?%|\d{1,3}(,\d{3})+|\d+\s?(million|billion|thousand))\b/i.test(s.text))
    .slice(0, 6)
    .map(claimOf);

  /* Knowledge base for retrieval and verification. */
  const chunks: Omit<Chunk, 'id'>[] = [];
  for (const d of docs) chunks.push(...chunkProse({ sourceId: d.source.id, path: d.source.title, text: d.text, kind: 'doc' }));
  const kbChunks = assignIds(chunks);
  // Link sections to the chunks that cover their key points.
  outSections.forEach((sec) => {
    sec.chunkIds = kbChunks
      .filter((c) => sec.keyPoints.some((k) => k.evidence.some((e) => e.sourceId === c.sourceId && e.startLine >= c.startLine && e.startLine <= c.endLine)))
      .map((c) => c.id);
  });

  const words = allText.split(/\s+/).length;
  const uncertainties: string[] = [];
  if (words < 250) uncertainties.push('The source material is short; the video will be brief and may repeat less detail.');
  if (docs.some((d) => d.source.kind === 'web')) uncertainties.push('Web pages were converted to text automatically; some navigation text may remain.');
  uncertainties.push('Narration is limited to what the provided material says; it was not fact-checked against outside sources.');

  return {
    analysis: {
      kind: 'document',
      title,
      summary: first ? claimOf(first) : { text: title, status: 'unknown', evidence: [] },
      sections: outSections.slice(0, 12),
      keyTerms: keyTerms(allText, 12),
      numbers,
      stats: { words, sections: outSections.length, sources: docs.length },
      uncertainties,
    },
    knowledge: { sources: docs.map((d) => d.source), chunks: kbChunks },
  };
}
