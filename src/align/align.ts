import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/config.js';
import { runOk } from '../core/exec.js';
import type { WordTiming } from '../core/schemas.js';
import type { Spoken } from '../tts/pronounce.js';

export interface RecognizedWord {
  word: string;
  start: number;
  end: number;
}

const norm = (w: string): string => w.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function whisperWords(python: string, model: string, wav: string, prompt: string): Promise<RecognizedWord[]> {
  const out = await runOk(python, [path.join(ROOT, 'python', 'align_whisper.py'), model, wav], { input: prompt, timeoutMs: 600_000 });
  return JSON.parse(out) as RecognizedWord[];
}

/** Transcribes many clips in one process so the Whisper model loads once. */
export async function whisperBatch(python: string, model: string, jobs: { wav: string; prompt: string }[]): Promise<Map<string, RecognizedWord[]>> {
  const file = path.join(path.dirname(jobs[0].wav), `align-jobs-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(jobs), 'utf8');
  try {
    const out = await runOk(python, [path.join(ROOT, 'python', 'align_whisper.py'), model, '--batch', file], { timeoutMs: 3_600_000 });
    return new Map(Object.entries(JSON.parse(out) as Record<string, RecognizedWord[]>));
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** Distributes [start, end] across words by character length, with extra weight for punctuation pauses. */
export function proportionalTimings(words: string[], start: number, end: number): WordTiming[] {
  const weights = words.map((w) => Math.max(2, w.replace(/[^\w]/g, '').length) + (/[.!?]$/.test(w) ? 4 : /[,;:]$/.test(w) ? 2 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = start;
  return words.map((w, i) => {
    const d = ((end - start) * weights[i]) / total;
    const wt = { text: w, start: round(t), end: round(t + d * 0.92) };
    t += d;
    return wt;
  });
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * Maps recognized words onto the spoken tokens (greedy with a small look-ahead), then folds spoken tokens back
 * onto the written words shown in captions. Returns null when the match is too poor to trust.
 */
export function alignToScript(spoken: Spoken, recognized: RecognizedWord[]): WordTiming[] | null {
  const tokens = spoken.text.split(/\s+/).filter(Boolean);
  const times: ({ start: number; end: number } | null)[] = tokens.map(() => null);
  let j = 0;
  let matched = 0;
  for (let i = 0; i < tokens.length && j < recognized.length; i++) {
    const t = norm(tokens[i]);
    if (!t) continue;
    for (let k = j; k < Math.min(recognized.length, j + 4); k++) {
      const r = norm(recognized[k].word);
      if (r && (r === t || (t.length > 3 && (r.startsWith(t.slice(0, 4)) || t.startsWith(r.slice(0, 4)))))) {
        times[i] = { start: recognized[k].start, end: recognized[k].end };
        matched++;
        j = k + 1;
        break;
      }
    }
  }
  const content = tokens.filter((t) => norm(t)).length;
  if (content === 0 || matched / content < 0.6) return null;

  // Interpolate unmatched tokens between known neighbours.
  for (let i = 0; i < times.length; i++) {
    if (times[i]) continue;
    let a = i - 1;
    while (a >= 0 && !times[a]) a--;
    let b = i + 1;
    while (b < times.length && !times[b]) b++;
    const s = a >= 0 ? times[a]!.end : (times[b]?.start ?? 0);
    const e = b < times.length ? times[b]!.start : s + 0.3;
    const n = b - a - 1;
    const step = Math.max(0.01, (e - s) / n);
    for (let k = a + 1; k < b; k++) times[k] = { start: s + step * (k - a - 1), end: s + step * (k - a) };
  }
  // Suspicious timings: non-monotonic or absurd durations → reject.
  for (let i = 1; i < times.length; i++) if (times[i]!.start + 0.05 < times[i - 1]!.start) return null;

  const out: WordTiming[] = [];
  let p = 0;
  spoken.written.forEach((w, i) => {
    const n = Math.max(1, spoken.spans[i]);
    const first = times[Math.min(p, times.length - 1)]!;
    const last = times[Math.min(p + n - 1, times.length - 1)]!;
    out.push({ text: w, start: round(first.start), end: round(Math.max(first.start + 0.05, last.end)) });
    p += n;
  });
  return out;
}
