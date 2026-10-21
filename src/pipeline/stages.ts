import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { proportionalTimings, alignToScript, whisperWords } from '../align/align.js';
import { UserError } from '../core/errors.js';
import { ensureDir, readJson, writeJson } from '../core/files.js';
import { probeDuration, silenceBounds } from '../core/media.js';
import { AnalysisSchema, KnowledgeBaseSchema, MetadataSchema, ScriptSchema, SourceSchema, TimingSchema, type Timing } from '../core/schemas.js';
import { analyzeDocs } from '../docs/analyze.js';
import { fromText, fromUrl, fromWikipedia, searchWikipedia, type LoadedDoc } from '../docs/sources.js';
import { createLlm } from '../llm/provider.js';
import { buildMetadata, writeMetadataFiles } from '../metadata/metadata.js';
import { renderThumbnail } from '../metadata/thumbnail.js';
import { runQuality } from '../quality/quality.js';
import { OllamaEmbedder } from '../rag/embeddings.js';
import { KnowledgeIndex } from '../rag/index.js';
import { mergeAudioVideo } from '../render/merge.js';
import { renderVideo } from '../render/render.js';
import { analyzeRepo } from '../repo/analyze.js';
import { fetchRepo } from '../repo/fetch.js';
import { scanRepository } from '../repo/scan.js';
import { parseGithubUrl } from '../repo/url.js';
import { factChunks } from '../script/facts.js';
import { planDocReel, planDocVideo, planRepoVideo } from '../script/plan.js';
import { writeScript } from '../script/write.js';
import { toSpoken, type Spoken } from '../tts/pronounce.js';
import { createTts } from '../tts/providers.js';
import type { StageContext } from './context.js';

export interface Stage {
  id: string;
  name: string;
  title: string;
  outputs: string[];
  run(ctx: StageContext): Promise<void>;
}

export const FPS = 30;
const DocsFileSchema = z.array(z.object({ source: SourceSchema, text: z.string() }));
const AudioMetaSchema = z.object({ hash: z.string(), provider: z.string(), voice: z.string(), license: z.string(), spoken: z.object({ text: z.string(), spans: z.array(z.number()), written: z.array(z.string()) }) });

function loadScript(ctx: StageContext) {
  return readJson(ctx.file('script.json'), ScriptSchema);
}

/* 01 ------------------------------------------------------------------ */
const ingest: Stage = {
  id: '01',
  name: 'ingest',
  title: 'Fetch sources',
  outputs: ['sources.json'],
  async run(ctx) {
    const { input } = ctx.state;
    if (input.mode === 'repo-video') {
      if (!input.repoUrl) throw new UserError('Repo mode needs a GitHub URL (or use the trending autopilot).');
      const ref = parseGithubUrl(input.repoUrl, input.ref);
      ctx.log.info(`cloning ${ref.url}${ref.ref ? ` @ ${ref.ref}` : ''} (shallow, no scripts executed)`);
      const repo = await fetchRepo(ref, path.join(ctx.cfg.cacheDir, 'repos'), { token: ctx.cfg.githubToken || undefined, timeoutMs: ctx.cfg.limits.cloneTimeoutMs });
      ctx.state.repoDir = repo.dir;
      ctx.state.commitSha = repo.commitSha;
      ctx.saveState();
      ctx.log.info(`commit ${repo.commitSha}`);
      writeJson(ctx.file('sources.json'), [{ id: 'repo', kind: 'repo', title: `${repo.owner}/${repo.name}`, url: repo.url, commit: repo.commitSha }]);
      return;
    }
    const docs: LoadedDoc[] = [];
    if (input.text?.trim()) docs.push(fromText(input.text, input.textTitle));
    for (const [i, u] of input.urls.entries()) docs.push(await fromUrl(u, `web${i + 1}`));
    if (input.topic && !docs.length) {
      const title = (await searchWikipedia(input.topic)) ?? input.topic;
      ctx.log.info(`researching "${title}" on Wikipedia (CC BY-SA 4.0, attribution added to description)`);
      docs.push(await fromWikipedia(title, 'wiki1'));
    }
    if (!docs.length) throw new UserError('Description mode needs text, a URL, or a topic.');
    writeJson(ctx.file('documents.json'), docs);
    writeJson(ctx.file('sources.json'), docs.map((d) => d.source));
  },
};

/* 02 ------------------------------------------------------------------ */
const analyze: Stage = {
  id: '02',
  name: 'analyze',
  title: 'Analyze and build the knowledge base',
  outputs: ['analysis.json', 'knowledge.json'],
  async run(ctx) {
    const { input } = ctx.state;
    if (input.mode === 'repo-video') {
      const dir = ctx.state.repoDir!;
      const ref = parseGithubUrl(input.repoUrl!, input.ref);
      const inv = await scanRepository(dir, ctx.cfg.limits, ctx.log);
      ctx.log.info(`${inv.files.length} files inventoried, ${inv.skipped.length} skipped, ${inv.redactions} secret-like strings redacted`);
      const { analysis, knowledge } = analyzeRepo({ ...ref, dir, commitSha: ctx.state.commitSha! }, inv);
      knowledge.chunks.push(...factChunks(analysis, 1));
      writeJson(ctx.file('analysis.json'), AnalysisSchema.parse(analysis));
      writeJson(ctx.file('knowledge.json'), knowledge);
      ctx.log.info(`size: ${analysis.size}; ${analysis.keyFiles.length} key files; ${knowledge.chunks.length} knowledge chunks`);
      if (analysis.license.warning) ctx.log.warn(analysis.license.warning);
      return;
    }
    const docs = readJson(ctx.file('documents.json'), DocsFileSchema);
    const { analysis, knowledge } = analyzeDocs(docs, input.textTitle);
    knowledge.chunks.push(...factChunks(analysis, 1));
    writeJson(ctx.file('analysis.json'), AnalysisSchema.parse(analysis));
    writeJson(ctx.file('knowledge.json'), knowledge);
    ctx.log.info(`${analysis.sections.length} sections, ${analysis.stats.words} words, ${knowledge.chunks.length} knowledge chunks`);
  },
};

/* 03 ------------------------------------------------------------------ */
const script: Stage = {
  id: '03',
  name: 'script',
  title: 'Write and verify the script (RAG)',
  outputs: ['script.json'],
  async run(ctx) {
    const { input } = ctx.state;
    const analysis = readJson(ctx.file('analysis.json'), AnalysisSchema);
    const kb = readJson(ctx.file('knowledge.json'), KnowledgeBaseSchema);
    const llm = await createLlm(ctx.cfg, ctx.state.llmOverride);
    const embedder = llm?.name === 'ollama' ? new OllamaEmbedder(ctx.cfg.llm.ollamaHost, ctx.cfg.llm.ollamaEmbedModel) : null;
    const index = await KnowledgeIndex.build(kb, { embedder, cacheFile: ctx.file('embeddings.cache.json'), onWarn: (m) => ctx.log.warn(m) });
    ctx.log.info(`retrieval: ${index.mode}; writer: ${llm ? `${llm.name}/${llm.model}` : 'extractive (no LLM)'}`);

    let plans;
    if (analysis.kind === 'repo') {
      const inv = await scanRepository(ctx.state.repoDir!, ctx.cfg.limits, ctx.log);
      const byPath = new Map(inv.files.map((f) => [f.path, f]));
      plans = planRepoVideo(analysis, (p) => byPath.get(p));
    } else plans = input.mode === 'doc-reel' ? planDocReel(analysis) : planDocVideo(analysis);

    const result = await writeScript({
      mode: input.mode,
      format: input.mode === 'doc-reel' ? 'portrait' : 'landscape',
      title: analysis.title,
      subject: analysis.kind === 'repo' ? `${analysis.repo.owner}/${analysis.repo.name}` : analysis.title,
      url: analysis.kind === 'repo' ? analysis.repo.url : undefined,
      plans,
      index,
      llm,
      log: ctx.log,
    });
    writeJson(ctx.file('script.json'), ScriptSchema.parse(result));
    const minutes = result.wordCount / 150;
    ctx.log.info(`${result.scenes.length} scenes, ${result.wordCount} words (≈${minutes.toFixed(1)} min)`);
    if (analysis.kind === 'repo' && minutes < 3) {
      ctx.log.warn(`This repository supports about ${minutes.toFixed(1)} minutes of verified narration, below the 3-minute target. The video was kept short instead of padding it.`);
    }
  },
};

/* 04 ------------------------------------------------------------------ */
const tts: Stage = {
  id: '04',
  name: 'tts',
  title: 'Synthesize narration (open-licence voice)',
  outputs: ['audio/manifest.json'],
  async run(ctx) {
    const s = loadScript(ctx);
    const provider = await createTts(ctx.cfg, ctx.state.ttsOverride);
    ctx.log.info(`voice: ${provider.name} / ${provider.voice} — ${provider.license}`);
    const dir = ensureDir(ctx.file('audio'));
    for (const [i, scene] of s.scenes.entries()) {
      const spoken = toSpoken(scene.narration);
      const hash = crypto.createHash('sha1').update(provider.name + provider.voice + spoken.text).digest('hex').slice(0, 16);
      const wav = path.join(dir, `${scene.id}.wav`);
      const metaFile = path.join(dir, `${scene.id}.json`);
      if (fs.existsSync(wav) && fs.existsSync(metaFile) && readJson(metaFile, AudioMetaSchema).hash === hash) continue;
      const raw = path.join(dir, `${scene.id}.raw.wav`);
      await provider.synthesize(spoken.text, raw);
      // Normalize every clip to 48 kHz mono so the merge step works on uniform inputs.
      const { runOk } = await import('../core/exec.js');
      await runOk('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-ar', '48000', '-ac', '1', wav]);
      fs.rmSync(raw, { force: true });
      writeJson(metaFile, { hash, provider: provider.name, voice: provider.voice, license: provider.license, spoken });
      ctx.progress((i + 1) / s.scenes.length, scene.id);
      ctx.log.info(`${scene.id}: ${(await probeDuration(wav)).toFixed(1)} s`);
    }
    writeJson(ctx.file('audio/manifest.json'), { provider: provider.name, voice: provider.voice, license: provider.license, scenes: s.scenes.map((x) => x.id) });
  },
};

/* 05 ------------------------------------------------------------------ */
const align: Stage = {
  id: '05',
  name: 'align',
  title: 'Word timings and scene durations',
  outputs: ['timing.json'],
  async run(ctx) {
    const s = loadScript(ctx);
    const reel = s.format === 'portrait';
    const lead = 0.25;
    const tail = reel ? 0.35 : 0.7;
    let whisperOk = ctx.cfg.aligner === 'whisper';
    let t = 0;
    const scenes: Timing['scenes'] = [];
    for (const [i, scene] of s.scenes.entries()) {
      const wav = ctx.file(`audio/${scene.id}.wav`);
      const meta = readJson(ctx.file(`audio/${scene.id}.json`), AudioMetaSchema);
      const spoken = meta.spoken as Spoken;
      const dur = await probeDuration(wav);
      const { lead: sl, trail: st } = await silenceBounds(wav);
      let words = null;
      let method: 'whisper' | 'proportional' = 'proportional';
      if (whisperOk) {
        try {
          const rec = await whisperWords(ctx.cfg.tts.python, ctx.cfg.whisperModel, wav, spoken.text.slice(0, 200));
          words = alignToScript(spoken, rec);
          if (words) method = 'whisper';
          else ctx.log.warn(`${scene.id}: Whisper timings looked unreliable; using proportional timings.`);
        } catch (err) {
          whisperOk = false;
          ctx.log.warn(`Whisper alignment unavailable (${(err as Error).message.split('\n')[0].slice(0, 120)}); using proportional timings.`);
        }
      }
      if (!words) words = proportionalTimings(spoken.written, sl, Math.max(sl + 0.5, dur - st));
      const durationSec = Math.ceil((lead + dur + tail) * FPS) / FPS;
      scenes.push({
        id: scene.id,
        audioFile: `audio/${scene.id}.wav`,
        startSec: Math.round(t * 1000) / 1000,
        speechSec: Math.round(dur * 1000) / 1000,
        durationSec,
        alignment: method,
        words: words.map((w) => ({ ...w, start: w.start + lead, end: w.end + lead })),
      });
      t += durationSec;
      ctx.progress((i + 1) / s.scenes.length, scene.id);
    }
    writeJson(ctx.file('timing.json'), TimingSchema.parse({ fps: FPS, totalSec: Math.round(t * 1000) / 1000, scenes }));
    ctx.log.info(`total ${t.toFixed(1)} s (${(t / 60).toFixed(1)} min); alignment: ${[...new Set(scenes.map((x) => x.alignment))].join(', ')}`);
  },
};

/* 06 ------------------------------------------------------------------ */
const render: Stage = {
  id: '06',
  name: 'render',
  title: 'Render motion graphics (Remotion)',
  outputs: ['render/video.mp4'],
  async run(ctx) {
    await renderVideo({
      script: loadScript(ctx),
      timing: readJson(ctx.file('timing.json'), TimingSchema),
      outFile: ctx.file('render/video.mp4'),
      workDir: ctx.file('render'),
      preview: ctx.state.input.preview,
      chunk: ctx.state.input.chunkRender,
      cfg: ctx.cfg,
      log: ctx.log,
      onProgress: (f) => ctx.progress(f),
    });
  },
};

/* 07 ------------------------------------------------------------------ */
const merge: Stage = {
  id: '07',
  name: 'merge',
  title: 'Mix audio and assemble final.mp4',
  outputs: ['final.mp4'],
  async run(ctx) {
    await mergeAudioVideo({
      dir: ctx.dir,
      timing: readJson(ctx.file('timing.json'), TimingSchema),
      video: ctx.file('render/video.mp4'),
      out: ctx.file('final.mp4'),
      music: ctx.cfg.render.musicFile,
      log: ctx.log,
    });
  },
};

/* 08 ------------------------------------------------------------------ */
const metadata: Stage = {
  id: '08',
  name: 'metadata',
  title: 'Titles, description, tags and thumbnail',
  outputs: ['metadata.json', 'thumbnail.png'],
  async run(ctx) {
    const s = loadScript(ctx);
    const analysis = readJson(ctx.file('analysis.json'), AnalysisSchema);
    const timing = readJson(ctx.file('timing.json'), TimingSchema);
    const sources = JSON.parse(fs.readFileSync(ctx.file('sources.json'), 'utf8'));
    const voice = JSON.parse(fs.readFileSync(ctx.file('audio/manifest.json'), 'utf8'));
    const meta = MetadataSchema.parse(buildMetadata({ script: s, analysis, timing, sources, voice }));
    writeMetadataFiles(ctx.dir, meta);
    await renderThumbnail({ dir: ctx.dir, meta, script: s, analysis, cfg: ctx.cfg });
  },
};

/* 09 ------------------------------------------------------------------ */
const quality: Stage = {
  id: '09',
  name: 'quality',
  title: 'Quality check',
  outputs: ['quality-report.json'],
  async run(ctx) {
    const report = await runQuality(ctx);
    for (const c of report.checks.filter((x) => !x.ok)) (c.severity === 'error' ? ctx.log.error : ctx.log.warn).call(ctx.log, `${c.name}: ${c.detail}`);
    ctx.log.info(`quality: ${report.checks.filter((c) => c.ok).length}/${report.checks.length} checks passed`);
  },
};

export const STAGES: Stage[] = [ingest, analyze, script, tts, align, render, merge, metadata, quality];
