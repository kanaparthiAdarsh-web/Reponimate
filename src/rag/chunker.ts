import type { Chunk } from '../core/schemas.js';

export interface ChunkInput {
  sourceId: string;
  path: string;
  text: string;
  kind: Chunk['kind'];
}

/** Splits markdown on headings, then caps each section at `maxLines` lines. */
export function chunkMarkdown(input: ChunkInput, maxLines = 40): Omit<Chunk, 'id'>[] {
  const lines = input.text.split('\n');
  const out: Omit<Chunk, 'id'>[] = [];
  let start = 0;
  let heading: string | undefined;
  let inFence = false;
  const flush = (end: number): void => {
    for (let s = start; s < end; s += maxLines) {
      const e = Math.min(end, s + maxLines);
      const text = lines.slice(s, e).join('\n').trim();
      if (text.length > 20) out.push({ sourceId: input.sourceId, path: input.path, startLine: s + 1, endLine: e, kind: input.kind, heading, text });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    const h = !inFence && lines[i].match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (h && i > start) {
      flush(i);
      start = i;
    }
    if (h) heading = h[1].replace(/[*_`]/g, '');
  }
  flush(lines.length);
  return out;
}

/** Splits code into windows that prefer to end at blank lines or top-level declarations. */
export function chunkCode(input: ChunkInput, target = 45, overlap = 6): Omit<Chunk, 'id'>[] {
  const lines = input.text.split('\n');
  const out: Omit<Chunk, 'id'>[] = [];
  if (lines.length <= target + 10) {
    const text = input.text.trim();
    if (text) out.push({ sourceId: input.sourceId, path: input.path, startLine: 1, endLine: lines.length, kind: input.kind, text });
    return out;
  }
  let s = 0;
  while (s < lines.length) {
    let e = Math.min(lines.length, s + target);
    if (e < lines.length) {
      // look for a nicer boundary within the last 15 lines of the window
      for (let k = e; k > e - 15 && k > s + 10; k--) {
        if (lines[k]?.trim() === '' || /^(export |def |class |func |fn |pub |async |function |const |interface |type )/.test(lines[k] ?? '')) {
          e = k;
          break;
        }
      }
    }
    const text = lines.slice(s, e).join('\n').trim();
    if (text) out.push({ sourceId: input.sourceId, path: input.path, startLine: s + 1, endLine: e, kind: input.kind, text });
    if (e >= lines.length) break;
    s = Math.max(e - overlap, s + 1);
  }
  return out;
}

/** Splits plain prose into paragraph groups of roughly `maxWords` words. */
export function chunkProse(input: ChunkInput, maxWords = 180): Omit<Chunk, 'id'>[] {
  if (/^#{1,4}\s/m.test(input.text)) return chunkMarkdown(input);
  const lines = input.text.split('\n');
  const out: Omit<Chunk, 'id'>[] = [];
  let start = 0;
  let words = 0;
  for (let i = 0; i < lines.length; i++) {
    words += lines[i].split(/\s+/).filter(Boolean).length;
    const paragraphEnd = lines[i].trim() === '' || i === lines.length - 1;
    if ((words >= maxWords && paragraphEnd) || i === lines.length - 1) {
      const text = lines.slice(start, i + 1).join('\n').trim();
      if (text.length > 20) out.push({ sourceId: input.sourceId, path: input.path, startLine: start + 1, endLine: i + 1, kind: input.kind, text });
      start = i + 1;
      words = 0;
    }
  }
  return out;
}

export function assignIds(chunks: Omit<Chunk, 'id'>[], offset = 0): Chunk[] {
  return chunks.map((c, i) => ({ ...c, id: `c${offset + i + 1}` }));
}
