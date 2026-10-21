import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../core/config.js';
import { formatError } from '../core/errors.js';
import { ensureDir, writeJson } from '../core/files.js';
import { Logger } from '../core/logger.js';
import type { JobInput } from '../core/schemas.js';
import { loadOrCreateState, type StageContext } from './context.js';
import { STAGES, type Stage } from './stages.js';

export interface RunOptions {
  cfg: AppConfig;
  dir: string;
  input: JobInput;
  resumeFrom?: string;
  stopAfter?: string;
  llm?: string;
  tts?: string;
  log?: Logger;
  onStage?: (stage: Stage, index: number, total: number) => void;
  onProgress?: (stage: string, fraction: number, note?: string) => void;
}

export function stageIndex(name: string): number {
  const i = STAGES.findIndex((s) => s.name === name || s.id === name || s.id === name.padStart(2, '0'));
  if (i < 0) throw new Error(`Unknown stage "${name}". Stages: ${STAGES.map((s) => `${s.id}-${s.name}`).join(', ')}`);
  return i;
}

/** Runs every stage in order. A stage is skipped when all its outputs exist, unless it is at or after --resume-from. */
export async function runPipeline(o: RunOptions): Promise<{ dir: string; warnings: string[] }> {
  ensureDir(o.dir);
  const log = o.log ?? new Logger(path.join(o.dir, 'errors.log'));
  const state = loadOrCreateState(o.dir, o.input, { ...(o.llm ? { llmOverride: o.llm } : {}), ...(o.tts ? { ttsOverride: o.tts } : {}) });
  const ctx: StageContext = {
    cfg: o.cfg,
    dir: o.dir,
    log,
    state,
    saveState: () => writeJson(path.join(o.dir, 'job.json'), state),
    file: (name) => path.join(o.dir, name),
    progress: () => {},
  };
  ctx.saveState();
  const from = o.resumeFrom ? stageIndex(o.resumeFrom) : Infinity;
  const until = o.stopAfter ? stageIndex(o.stopAfter) : STAGES.length - 1;
  for (let i = 0; i <= until; i++) {
    const stage = STAGES[i];
    const done = stage.outputs.length > 0 && stage.outputs.every((f) => fs.existsSync(path.join(o.dir, f)));
    o.onStage?.(stage, i, STAGES.length);
    if (done && i < from) {
      log.info(`${stage.id} ${stage.name}: cached, skipping`);
      continue;
    }
    log.step(`${stage.id} ${stage.title}`);
    ctx.progress = (f, note) => o.onProgress?.(stage.name, f, note);
    const t0 = Date.now();
    try {
      await stage.run(ctx);
    } catch (err) {
      log.error(`${stage.id} ${stage.name} failed: ${formatError(err)}`);
      log.error(`Fix the problem and re-run with --resume-from ${stage.name}`);
      throw err;
    }
    log.info(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  return { dir: o.dir, warnings: log.warnings };
}
