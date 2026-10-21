import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../core/config.js';
import { readJson, writeJson } from '../core/files.js';
import type { Logger } from '../core/logger.js';
import { JobInputSchema, type JobInput } from '../core/schemas.js';

export const JobStateSchema = z.object({
  input: JobInputSchema,
  createdAt: z.string(),
  repoDir: z.string().optional(),
  commitSha: z.string().optional(),
  topicSource: z.string().optional(),
  llmOverride: z.string().optional(),
  ttsOverride: z.string().optional(),
});
export type JobState = z.infer<typeof JobStateSchema>;

export interface StageContext {
  cfg: AppConfig;
  dir: string;
  log: Logger;
  state: JobState;
  saveState(): void;
  file(name: string): string;
  progress(fraction: number, note?: string): void;
}

export function loadOrCreateState(dir: string, input: JobInput, extra: Partial<JobState> = {}): JobState {
  const f = path.join(dir, 'job.json');
  if (fs.existsSync(f)) {
    const prev = readJson(f, JobStateSchema);
    return {
      ...prev,
      ...extra,
      input: { ...prev.input, preview: input.preview, chunkRender: input.chunkRender, channelName: input.channelName ?? prev.input.channelName },
    };
  }
  const state: JobState = { input, createdAt: new Date().toISOString(), ...extra };
  writeJson(f, state);
  return state;
}
