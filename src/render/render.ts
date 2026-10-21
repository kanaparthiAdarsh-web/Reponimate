import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { codeToTokens } from 'shiki';
import type { AppConfig } from '../core/config.js';
import { ROOT } from '../core/config.js';
import { runOk } from '../core/exec.js';
import { ensureDir } from '../core/files.js';
import type { Logger } from '../core/logger.js';
import type { Script, Timing } from '../core/schemas.js';
import type { CodeToken, VideoProps } from './remotion/types.js';

/** Shiki highlighting runs in Node so the browser render only paints pre-computed tokens. */
export async function highlightScript(script: Script): Promise<Record<string, CodeToken[][]>> {
  const out: Record<string, CodeToken[][]> = {};
  for (const s of script.scenes) {
    const c = s.visual.code;
    if (!c) continue;
    try {
      const { tokens } = await codeToTokens(c.code, { lang: c.language as never, theme: 'github-dark-default' });
      out[s.id] = tokens.map((line) => line.map((t) => ({ content: t.content, color: t.color ?? '#E6EDF7' })));
    } catch {
      out[s.id] = c.code.split('\n').map((l) => [{ content: l, color: '#E6EDF7' }]);
    }
  }
  return out;
}

let bundleCache: string | null = null;
async function getBundle(log: Logger): Promise<string> {
  if (bundleCache) return bundleCache;
  log.info('bundling Remotion project…');
  // models/character is served as the public dir so an installed character model can be loaded with staticFile().
  const publicDir = path.join(ROOT, 'models', 'character');
  fs.mkdirSync(publicDir, { recursive: true });
  bundleCache = await bundle({ entryPoint: path.join(ROOT, 'src', 'render', 'remotion', 'index.ts'), publicDir, onProgress: () => {} });
  return bundleCache;
}

export async function renderVideo(o: {
  script: Script;
  timing: Timing;
  outFile: string;
  workDir: string;
  preview: boolean;
  chunk: boolean;
  cfg: AppConfig;
  log: Logger;
  onProgress?: (f: number) => void;
}): Promise<void> {
  ensureDir(o.workDir);
  const inputProps: VideoProps = { script: o.script, timing: o.timing, code: await highlightScript(o.script) };
  const serveUrl = await getBundle(o.log);
  const id = o.script.format === 'portrait' ? 'ExplainerReel' : 'Explainer';
  const browserExecutable = o.cfg.render.browserExecutable || null;
  const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable });
  const scale = o.preview ? 0.5 : 1;
  const total = composition.durationInFrames;
  o.log.info(`${composition.width * scale}x${composition.height * scale} @ ${composition.fps} fps, ${total} frames${o.preview ? ' (preview)' : ''}`);

  const common = {
    composition,
    serveUrl,
    codec: 'h264' as const,
    inputProps,
    muted: true,
    scale,
    crf: o.preview ? 30 : 20,
    concurrency: o.cfg.render.concurrency,
    browserExecutable,
    chromiumOptions: { gl: o.cfg.render.gl as 'angle' },
    imageFormat: 'jpeg' as const,
    jpegQuality: o.preview ? 70 : 90,
  };

  if (!o.chunk) {
    let last = -1;
    // Render to a temp file and rename: an interrupted render must never look like a finished one.
    const tmpOut = o.outFile.replace(/\.mp4$/, '.partial.mp4');
    await renderMedia({
      ...common,
      outputLocation: tmpOut,
      onProgress: ({ progress }) => {
        o.onProgress?.(progress);
        const pct = Math.floor(progress * 10);
        if (pct !== last) {
          last = pct;
          o.log.info(`render ${pct * 10}%`);
        }
      },
    });
    fs.renameSync(tmpOut, o.outFile);
    return;
  }

  // Chunked mode for weak machines: render ~20 s pieces one at a time, resume finished ones, then join losslessly.
  const chunkFrames = composition.fps * 20;
  const parts: string[] = [];
  for (let start = 0, i = 0; start < total; start += chunkFrames, i++) {
    const end = Math.min(total - 1, start + chunkFrames - 1);
    const part = path.join(o.workDir, `chunk-${String(i).padStart(3, '0')}.mp4`);
    parts.push(part);
    if (fs.existsSync(part)) continue;
    o.log.info(`chunk ${i + 1}: frames ${start}-${end}`);
    await renderMedia({ ...common, frameRange: [start, end], outputLocation: part + '.tmp.mp4', onProgress: ({ progress }) => o.onProgress?.((start + progress * (end - start)) / total) });
    fs.renameSync(part + '.tmp.mp4', part);
  }
  const list = path.join(o.workDir, 'chunks.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${path.basename(p)}'`).join('\n'));
  const joined = o.outFile.replace(/\.mp4$/, '.partial.mp4');
  await runOk('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], { cwd: o.workDir });
  fs.renameSync(joined, o.outFile);
}
