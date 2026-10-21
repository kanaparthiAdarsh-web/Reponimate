import { describe, expect, it } from 'vitest';
import type { Chunk } from '../src/core/schemas.js';
import { chunkCode, chunkMarkdown } from '../src/rag/chunker.js';
import { KnowledgeIndex } from '../src/rag/index.js';
import { specificTerms, tokenize } from '../src/rag/tokenize.js';
import { checkSupport, splitSentences } from '../src/rag/verify.js';
import { verifyNarration } from '../src/script/write.js';
import { analyzedFixture } from './helpers.js';

const chunk = (id: string, text: string, path = 'src/a.js'): Chunk => ({ id, sourceId: 'repo', path, startLine: 1, endLine: 5, kind: 'code', text });

describe('tokenize', () => {
  it('splits identifiers and stems', () => {
    expect(tokenize('parseGithubUrl parses URLs')).toEqual(expect.arrayContaining(['pars', 'github', 'url']));
  });
  it('finds specific terms', () => {
    expect(specificTerms('Call siftDown in queue.js with 130 items.')).toEqual(expect.arrayContaining(['siftDown', 'queue.js', '130']));
  });
});

describe('chunkers', () => {
  it('splits markdown by heading and keeps line numbers', () => {
    const chunks = chunkMarkdown({ sourceId: 's', path: 'a.md', kind: 'doc', text: '# A\nintro text that is long enough\n## B\nsecond section text here' });
    expect(chunks.map((c) => c.heading)).toEqual(['A', 'B']);
    expect(chunks[1].startLine).toBe(3);
  });
  it('splits long code into overlapping windows', () => {
    const text = Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const chunks = chunkCode({ sourceId: 's', path: 'a.js', kind: 'code', text });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[chunks.length - 1].endLine).toBe(200);
  });
});

describe('sentence splitting', () => {
  it('does not split on file names or versions', () => {
    expect(splitSentences('Open index.js now. Version 1.2 is out! Next.')).toEqual(['Open index.js now.', 'Version 1.2 is out!', 'Next.']);
  });
});

describe('retrieval', () => {
  it('ranks the chunk that defines the queried function first (BM25)', async () => {
    const { knowledge } = analyzedFixture();
    const idx = await KnowledgeIndex.build(knowledge);
    const hits = await idx.search('siftDown heap pop', 3);
    expect(hits[0].chunk.path).toBe('src/queue.js');
    expect(idx.mode).toBe('BM25 only');
  });
});

describe('claim verification (anti-hallucination)', () => {
  const chunks = [chunk('c1', 'export class PriorityQueue { push(item) {} pop() {} siftUp(i) {} } // binary heap storage'), chunk('c2', 'Custom comparator support via defaultCompare', 'README.md')];

  it('accepts a sentence grounded in the evidence', () => {
    expect(checkSupport('PriorityQueue stores items in a binary heap.', chunks).supported).toBe(true);
  });
  it('rejects invented identifiers', () => {
    const r = checkSupport('It also exposes a peekMany helper.', chunks);
    expect(r.supported).toBe(false);
    expect(r.missingTerms).toContain('peekMany');
  });
  it('rejects invented numbers and hype', () => {
    expect(checkSupport('The queue handles 50000 items per second.', chunks).supported).toBe(false);
    expect(checkSupport('It is the fastest priority queue.', chunks).supported).toBe(false);
  });
  it('rejects unrelated claims', () => {
    expect(checkSupport('The library streams video over WebRTC to mobile browsers.', chunks).supported).toBe(false);
  });
  it('allows pure framing sentences', () => {
    expect(checkSupport("Let's take a closer look.", chunks)).toMatchObject({ supported: true, framing: true });
  });
  it('filters an LLM narration sentence by sentence and strips citations', () => {
    const byId = new Map(chunks.map((c) => [c.id, c]));
    const v = verifyNarration('PriorityQueue keeps items in a binary heap [c1]. It is used by millions of developers [c1]. You can pass a custom comparator [c2].', chunks, byId);
    expect(v.narration).toBe('PriorityQueue keeps items in a binary heap. You can pass a custom comparator.');
    expect(v.dropped).toEqual(['It is used by millions of developers.']);
    expect(v.chunkIds).toEqual(expect.arrayContaining(['c1', 'c2']));
  });
});
