import fs from 'node:fs';
import path from 'node:path';
import { runOk } from '../core/exec.js';
import type { Logger } from '../core/logger.js';
import type { Timing } from '../core/schemas.js';

const LEAD = 0.25; // must match the lead used in the align stage

/**
 * Places every scene's narration at its real start time, optionally ducks a royalty-free music bed under the
 * voice (sidechaincompress), normalizes loudness to about -14 LUFS and muxes with the silent render.
 */
export async function mergeAudioVideo(o: { dir: string; timing: Timing; video: string; out: string; music?: string; log: Logger }): Promise<void> {
  const inputs: string[] = [];
  const filters: string[] = [];
  o.timing.scenes.forEach((s, i) => {
    inputs.push('-i', path.join(o.dir, s.audioFile));
    const ms = Math.round((s.startSec + LEAD) * 1000);
    filters.push(`[${i}:a]adelay=${ms}:all=1[a${i}]`);
  });
  const n = o.timing.scenes.length;
  filters.push(`${o.timing.scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${n}:normalize=0:dropout_transition=0,apad,atrim=0:${o.timing.totalSec.toFixed(3)}[voice]`);
  let last = 'voice';
  const music = o.music && fs.existsSync(o.music) ? o.music : '';
  if (music) {
    inputs.push('-stream_loop', '-1', '-i', music);
    filters.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=mono,volume=0.35,atrim=0:${o.timing.totalSec.toFixed(3)}[music]`);
    filters.push(`[voice]asplit=2[v1][v2]`);
    filters.push(`[music][v2]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]`);
    filters.push(`[v1][ducked]amix=inputs=2:normalize=0[mixed]`);
    last = 'mixed';
    o.log.info(`music bed: ${path.basename(music)} (ducked under narration)`);
  }
  filters.push(`[${last}]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]`);
  const mixed = path.join(o.dir, 'render', 'mix.m4a');
  await runOk('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', mixed], { timeoutMs: 1_800_000 });
  await runOk('ffmpeg', ['-y', '-loglevel', 'error', '-i', o.video, '-i', mixed, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', o.out], { timeoutMs: 600_000 });
}
