import type { Format, Scene, Script, Timing } from '../../core/schemas.js';
import type { VideoProps } from './types';

/** Fixture data for `npm run studio`: one scene of every visual type, with synthetic timings. */
export function fixtureProps(format: Format): VideoProps {
  const base = (id: string, type: Scene['type'], title: string, narration: string, visual: Scene['visual']): Scene => ({
    id,
    type,
    title,
    narration,
    visual,
    visualDescription: '',
    evidence: [],
    emphasisWords: ['code'],
    estimatedSeconds: 5,
    transition: 'fade',
    captions: { enabled: true, maxWords: format === 'portrait' ? 3 : 7 },
    verification: { status: 'verified', supportedSentences: 1, droppedSentences: [], notes: [] },
  });
  const scenes: Scene[] = [
    base('s01', 'intro', 'demo-lib', 'Meet demo lib. It turns text into tidy slugs.', { headline: 'demo-lib', subhead: 'Slugify a string for URLs and IDs' }),
    base('s02', 'architecture', 'Architecture', 'The index file imports the replacements module.', {
      headline: 'Architecture',
      graph: { nodes: [{ id: 'a', label: 'index.js' }, { id: 'b', label: 'replacements.js' }, { id: 'ext:x', label: 'transliterate', group: 'external' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'ext:x' }] },
    }),
    base('s03', 'code', 'slugify()', 'Here is the slugify function from index dot js.', {
      headline: 'index.js',
      code: { path: 'index.js', language: 'javascript', startLine: 10, endLine: 14, code: 'export default function slugify(string, options) {\n\tconst value = transliterate(string);\n\treturn value.toLowerCase();\n}', highlight: [10, 12] },
    }),
    base('s04', 'presenter', 'How it works', 'First it transliterates. Then it lowercases the result.', { headline: 'How it works', presenter: { pose: 'explain', board: ['Transliterate', 'Lowercase', 'Join with dashes'] } }),
    base('s05', 'pros-cons', 'Pros & cons', 'It is small and typed, but has few tests.', { headline: 'Pros & cons', pros: ['Small', 'Typed'], cons: ['Few tests'] }),
    base('s06', 'outro', 'Thanks', 'Thanks for watching.', { headline: 'Thanks for watching!', presenter: { pose: 'celebrate', board: [] } }),
  ];
  const script: Script = { mode: 'repo-video', format, title: 'demo-lib', subject: 'demo/demo-lib', url: 'https://github.com/demo/demo-lib', generatedBy: { provider: 'fixture', model: 'none' }, wordCount: 50, scenes };
  let t = 0;
  const timing: Timing = {
    fps: 30,
    totalSec: 0,
    scenes: scenes.map((s) => {
      const words = s.narration.split(' ');
      const d = 5;
      const sc = { id: s.id, audioFile: '', startSec: t, speechSec: 4, durationSec: d, alignment: 'proportional' as const, words: words.map((w, i) => ({ text: w, start: 0.3 + (i * 3.8) / words.length, end: 0.3 + ((i + 0.9) * 3.8) / words.length })) };
      t += d;
      return sc;
    }),
  };
  timing.totalSec = t;
  return { script, timing, code: {} };
}
