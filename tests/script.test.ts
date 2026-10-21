import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Logger } from '../src/core/logger.js';
import { ScriptSchema } from '../src/core/schemas.js';
import { analyzeDocs } from '../src/docs/analyze.js';
import { fromText } from '../src/docs/sources.js';
import { extractJson } from '../src/llm/json.js';
import type { GenerateOptions, LlmProvider } from '../src/llm/provider.js';
import { KnowledgeIndex } from '../src/rag/index.js';
import { buildInventory } from '../src/repo/inventory.js';
import { factChunks } from '../src/script/facts.js';
import { planDocReel, planDocVideo, planRepoVideo } from '../src/script/plan.js';
import { writeScript } from '../src/script/write.js';
import { FIXTURE_DOC, LIMITS, analyzedFixture } from './helpers.js';

const quiet = () => new Logger(undefined, true);

async function repoScript(llm: LlmProvider | null) {
  const { dir, analysis, knowledge } = analyzedFixture();
  if (analysis.kind !== 'repo') throw new Error('expected repo');
  const files = new Map(buildInventory(dir, LIMITS).files.map((f) => [f.path, f]));
  const index = await KnowledgeIndex.build(knowledge);
  const plans = planRepoVideo(analysis, (p) => files.get(p));
  return { script: await writeScript({ mode: 'repo-video', format: 'landscape', title: analysis.title, subject: 'example/tinyqueue-lite', plans, index, llm, log: quiet() }), files };
}

describe('repo script (extractive, no LLM)', () => {
  it('produces a valid, fully supported script with genuine code', async () => {
    const { script, files } = await repoScript(null);
    ScriptSchema.parse(script);
    expect(script.scenes.map((s) => s.type)).toEqual(expect.arrayContaining(['intro', 'architecture', 'code', 'terminal', 'pros-cons', 'outro']));
    for (const s of script.scenes) {
      expect(s.narration.length).toBeGreaterThan(10);
      expect(s.verification.droppedSentences).toEqual([]);
    }
    for (const s of script.scenes.filter((x) => x.visual.code)) {
      const c = s.visual.code!;
      const real = files.get(c.path)!.text.split('\n').slice(c.startLine - 1, c.endLine).join('\n');
      expect(c.code).toBe(real);
    }
    const terminal = script.scenes.find((s) => s.type === 'terminal')!;
    expect(terminal.visual.terminal!.label).toMatch(/not executed/);
  });
});

/** A fake LLM that mixes grounded sentences with hallucinations, to prove the verifier removes them. */
class LyingLlm implements LlmProvider {
  name = 'fake';
  model = 'liar-1';
  prompts: string[] = [];
  async generate(o: GenerateOptions): Promise<string> {
    this.prompts.push(o.prompt);
    return JSON.stringify({
      narration:
        'PriorityQueue is a binary-heap priority queue [c3]. ' +
        'It powers the scheduler inside the Linux kernel [c3]. ' +
        'It was downloaded 12000000 times last week [c3]. ' +
        'The push method adds an item and calls siftUp to restore the heap order [c3]. ' +
        'It also has a magicBalance function for speed [c3]. ' +
        'The README describes it as a tiny priority queue for JavaScript.',
      emphasisWords: ['heap'],
    });
  }
}

describe('repo script with an LLM', () => {
  it('drops hallucinated sentences and keeps grounded ones', async () => {
    const llm = new LyingLlm();
    const { script } = await repoScript(llm);
    const all = script.scenes.map((s) => s.narration).join(' ');
    expect(all).not.toMatch(/Linux kernel|12000000|magicBalance/);
    const dropped = script.scenes.flatMap((s) => s.verification.droppedSentences).join(' ');
    expect(dropped).toMatch(/Linux kernel/);
    expect(dropped).toMatch(/magicBalance/);
    // repository text reaches the model only inside <data> blocks, with an instruction not to obey it
    expect(llm.prompts[0]).toMatch(/<data id="/);
  });
});

describe('description → video and reel', () => {
  const doc = fromText(fs.readFileSync(FIXTURE_DOC, 'utf8'));
  const { analysis, knowledge } = analyzeDocs([doc]);
  knowledge.chunks.push(...factChunks(analysis, 1));

  it('finds sections and verified key points', () => {
    expect(analysis.title).toBe('Photosynthesis');
    expect(analysis.sections.map((s) => s.heading)).toEqual(expect.arrayContaining(['Light reactions', 'Calvin cycle']));
    expect(analysis.sections.every((s) => s.keyPoints.every((k) => k.status === 'verified' && k.evidence.length))).toBe(true);
  });

  it('builds a stick-figure explainer', async () => {
    const index = await KnowledgeIndex.build(knowledge);
    const s = await writeScript({ mode: 'doc-video', format: 'landscape', title: analysis.title, subject: analysis.title, plans: planDocVideo(analysis), index, llm: null, log: quiet() });
    expect(s.scenes.some((x) => x.visual.stickman)).toBe(true);
    expect(s.scenes.flatMap((x) => x.verification.droppedSentences)).toEqual([]);
  });

  it('keeps reels short and vertical', async () => {
    const index = await KnowledgeIndex.build(knowledge);
    const s = await writeScript({ mode: 'doc-reel', format: 'portrait', title: analysis.title, subject: analysis.title, plans: planDocReel(analysis), index, llm: null, log: quiet() });
    expect(s.format).toBe('portrait');
    expect(s.scenes.length).toBeLessThanOrEqual(5);
    expect(s.wordCount).toBeLessThan(150);
  });

  it('rejects text that is too short', () => {
    expect(() => fromText('too short')).toThrow(/too short/);
  });
});

describe('extractJson', () => {
  it('handles fences and chatter', () => {
    expect(extractJson('Sure! ```json\n{"a": "x}"}\n```')).toEqual({ a: 'x}' });
    expect(extractJson('noise {"b": [1, {"c": 2}]} trailing')).toEqual({ b: [1, { c: 2 }] });
  });
});
