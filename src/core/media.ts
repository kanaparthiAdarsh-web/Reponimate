import { runOk, run } from './exec.js';

export async function probeDuration(file: string): Promise<number> {
  const out = await runOk('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(out.trim());
  if (!Number.isFinite(d)) throw new Error(`Could not read duration of ${file}`);
  return d;
}

/** Leading and trailing silence (seconds) using ffmpeg's silencedetect. */
export async function silenceBounds(file: string, noiseDb = -40): Promise<{ lead: number; trail: number; gaps: { start: number; end: number }[] }> {
  const total = await probeDuration(file);
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=0.15`, '-f', 'null', '-']);
  const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const gaps = starts.map((s, i) => ({ start: s, end: ends[i] ?? total }));
  const lead = gaps[0] && gaps[0].start < 0.05 ? gaps[0].end : 0;
  const last = gaps[gaps.length - 1];
  const trail = last && last.end >= total - 0.05 ? total - last.start : 0;
  return { lead, trail, gaps };
}

/** Integrated loudness (LUFS) via the ebur128 filter. */
export async function measureLoudness(file: string): Promise<number | null> {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128', '-f', 'null', '-']);
  const m = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return m ? parseFloat(m[1]) : null;
}
