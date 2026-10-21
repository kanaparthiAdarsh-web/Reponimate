import { describe, expect, it } from 'vitest';
import { alignToScript, proportionalTimings } from '../src/align/align.js';
import type { Analysis, Script, Timing } from '../src/core/schemas.js';
import { MetadataSchema } from '../src/core/schemas.js';
import { buildMetadata, fmtTime } from '../src/metadata/metadata.js';
import { layoutGraph } from '../src/render/remotion/components/panels.js';
import { speakToken, toSpoken } from '../src/tts/pronounce.js';
import { analyzedFixture } from './helpers.js';

describe('pronunciation', () => {
  it('speaks identifiers, files and acronyms', () => {
    expect(speakToken('parseGithubUrl')).toBe('parse Github Url');
    expect(speakToken('queue.js,')).toBe('queue dot J S,');
    expect(speakToken('README')).toBe('read me');
    expect(speakToken('snake_case_name')).toBe('snake case name');
  });
  it('tracks how written words map to spoken words', () => {
    const s = toSpoken('Open queue.js now');
    expect(s.spans).toEqual([1, 4, 1]);
  });
});

describe('alignment', () => {
  it('maps recognized words back to written words', () => {
    const spoken = toSpoken('Open queue.js now.');
    const rec = ['open', 'queue', 'dot', 'js', 'now'].map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const t = alignToScript(spoken, rec)!;
    expect(t.map((w) => w.text)).toEqual(['Open', 'queue.js', 'now.']);
    expect(t[1].start).toBe(0.5);
    expect(t[1].end).toBeGreaterThan(1.4);
    expect(t[1].end).toBeLessThanOrEqual(t[2].start + 0.01);
  });
  it('rejects unreliable recognitions', () => {
    expect(alignToScript(toSpoken('alpha beta gamma delta'), [{ word: 'banana', start: 0, end: 1 }])).toBeNull();
  });
  it('proportional timings are ordered and inside the range', () => {
    const t = proportionalTimings(['Hello', 'world.', 'Again'], 1, 4);
    expect(t[0].start).toBe(1);
    expect(t[2].end).toBeLessThanOrEqual(4);
    expect(t.every((w, i) => i === 0 || w.start >= t[i - 1].end)).toBe(true);
  });
});

describe('metadata', () => {
  it('builds titles, chapters from real timings and credits', () => {
    const { analysis } = analyzedFixture();
    const script = { mode: 'repo-video', format: 'landscape', title: 't', subject: 's', generatedBy: { provider: 'x', model: 'y' }, wordCount: 10, scenes: [
      { id: 's01', type: 'intro', title: 'Intro' }, { id: 's02', type: 'code', title: 'push()' }, { id: 's03', type: 'outro', title: 'Thanks' },
    ] } as unknown as Script;
    const timing: Timing = { fps: 30, totalSec: 95, scenes: [
      { id: 's01', audioFile: '', startSec: 0, speechSec: 1, durationSec: 30, alignment: 'proportional', words: [] },
      { id: 's02', audioFile: '', startSec: 30, speechSec: 1, durationSec: 60, alignment: 'proportional', words: [] },
      { id: 's03', audioFile: '', startSec: 90, speechSec: 1, durationSec: 5, alignment: 'proportional', words: [] },
    ] };
    const m = MetadataSchema.parse(buildMetadata({ script, analysis: analysis as Analysis, timing, sources: [], voice: { provider: 'piper', voice: 'v', license: 'l' } }));
    expect(m.titles.every((t) => t.length <= 70)).toBe(true);
    expect(m.chapters).toEqual([{ time: '0:00', title: 'Intro' }, { time: '0:30', title: 'push()' }]);
    expect(m.description).toContain('https://github.com/example/tinyqueue-lite');
    expect(m.description).toMatch(/License: MIT/);
    expect(m.description).toMatch(/synthetic/);
    expect(m.tags.length).toBeGreaterThanOrEqual(10);
    expect(fmtTime(3725)).toBe('1:02:05');
  });
});

describe('architecture layout', () => {
  it('places dependencies in later layers', () => {
    const pos = layoutGraph({ nodes: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }, 900, 300, false);
    expect(pos.get('a')!.x).toBeLessThan(pos.get('b')!.x);
    expect(pos.get('b')!.x).toBeLessThan(pos.get('c')!.x);
  });
});
