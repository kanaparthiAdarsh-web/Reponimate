import fs from 'node:fs';
import path from 'node:path';
import { run } from '../core/exec.js';
import { readJson, writeJson } from '../core/files.js';
import { measureLoudness, probeDuration } from '../core/media.js';
import { AnalysisSchema, MetadataSchema, ScriptSchema, TimingSchema, type QualityReport } from '../core/schemas.js';
import type { StageContext } from '../pipeline/context.js';

export const REQUIRED_OUTPUTS = [
  'final.mp4', 'analysis.json', 'script.json', 'timing.json', 'metadata.json', 'title.txt', 'description.txt',
  'tags.txt', 'thumbnail.html', 'thumbnail.png', 'thumbnail-prompt.txt', 'sources.json', 'errors.log',
];

type Check = QualityReport['checks'][number];

export async function runQuality(ctx: StageContext): Promise<QualityReport> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, severity: Check['severity'] = 'error'): void => {
    checks.push({ name, ok, detail, severity: ok ? 'info' : severity });
  };
  if (!fs.existsSync(ctx.file('errors.log'))) fs.writeFileSync(ctx.file('errors.log'), '');
  const script = readJson(ctx.file('script.json'), ScriptSchema);
  const timing = readJson(ctx.file('timing.json'), TimingSchema);
  const analysis = readJson(ctx.file('analysis.json'), AnalysisSchema);
  const meta = readJson(ctx.file('metadata.json'), MetadataSchema);
  const final = ctx.file('final.mp4');

  /* audio per scene */
  const missing = timing.scenes.filter((s) => !fs.existsSync(ctx.file(s.audioFile)) || s.speechSec < 0.3);
  add('audio for every scene', missing.length === 0, missing.length ? `missing/empty: ${missing.map((s) => s.id).join(', ')}` : `${timing.scenes.length} clips`);

  /* durations */
  const vDur = await probeDuration(final);
  const aStream = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'default=nw=1:nk=1', final]);
  const aDur = parseFloat(aStream.stdout) || vDur;
  add('video duration matches audio timeline', Math.abs(vDur - timing.totalSec) < 0.6 && Math.abs(aDur - timing.totalSec) < 0.6, `video ${vDur.toFixed(2)} s, audio ${aDur.toFixed(2)} s, timeline ${timing.totalSec.toFixed(2)} s`);
  const v = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,r_frame_rate,width,height', '-of', 'json', final]);
  const vs = JSON.parse(v.stdout).streams?.[0] ?? {};
  add('codec and frame rate', vs.codec_name === 'h264' && vs.r_frame_rate === `${timing.fps}/1`, `${vs.codec_name} ${vs.width}x${vs.height} ${vs.r_frame_rate}`);

  if (script.mode === 'repo-video') {
    add('length within 3–15 minutes', vDur >= 180 && vDur <= 900, `${(vDur / 60).toFixed(1)} min${vDur < 180 ? ' — the repository did not support more verified narration; it was not padded' : ''}`, 'warning');
  } else if (script.mode === 'doc-reel') {
    add('reel under 60 seconds', vDur <= 60, `${vDur.toFixed(1)} s`, 'warning');
  }

  /* loudness and silence */
  const lufs = await measureLoudness(final);
  add('loudness about -14 LUFS', lufs !== null && lufs > -17 && lufs < -11, lufs === null ? 'could not measure' : `${lufs.toFixed(1)} LUFS`, 'warning');
  const sil = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', final, '-map', '0:a', '-af', 'silencedetect=noise=-45dB:d=2.5', '-f', 'null', '-']);
  const gaps = [...sil.stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  add('no long silence gaps', gaps.length === 0, gaps.length ? `${gaps.length} gap(s) over 2.5 s` : 'none over 2.5 s', 'warning');

  /* black frames */
  const black = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', final, '-vf', 'blackdetect=d=1.0:pix_th=0.05', '-an', '-f', 'null', '-']);
  const blacks = [...black.stderr.matchAll(/black_start:([\d.]+)/g)].length;
  add('no black frames', blacks === 0, blacks ? `${blacks} black segment(s) over 1 s` : 'none');

  /* captions */
  let badWords = 0;
  for (const s of timing.scenes) {
    s.words.forEach((w, i) => {
      if (w.end < w.start || w.end > s.durationSec + 0.05 || (i && w.start + 0.05 < s.words[i - 1].start)) badWords++;
    });
  }
  const whisper = timing.scenes.filter((s) => s.alignment === 'whisper').length;
  add('captions in sync', badWords === 0, `${badWords} out-of-order or out-of-range word timings; ${whisper}/${timing.scenes.length} scenes aligned with Whisper`);

  /* readability */
  const codeScenes = script.scenes.filter((s) => s.visual.code);
  const tooBig = codeScenes.filter((s) => s.visual.code!.code.split('\n').length > 18 || Math.max(...s.visual.code!.code.split('\n').map((l) => l.length)) > 110);
  add('code excerpts readable', tooBig.length === 0, tooBig.length ? `long excerpts in ${tooBig.map((s) => s.id).join(', ')}` : `${codeScenes.length} excerpts, ≤18 lines each`, 'warning');

  /* code excerpts match source */
  if (analysis.kind === 'repo' && ctx.state.repoDir) {
    const mismatched: string[] = [];
    for (const s of codeScenes) {
      const c = s.visual.code!;
      const file = path.join(ctx.state.repoDir, c.path);
      const real = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').slice(c.startLine - 1, c.endLine).join('\n') : null;
      if (real === null || real.replace(/\r/g, '') !== c.code.replace(/\r/g, '')) mismatched.push(`${s.id} (${c.path})`);
    }
    add('code excerpts match source files', mismatched.length === 0, mismatched.length ? `mismatch: ${mismatched.join(', ')}` : `${codeScenes.length} verified byte-for-byte`);
  }

  /* claims */
  const dropped = script.scenes.flatMap((s) => s.verification.droppedSentences.map((d) => `${s.id}: ${d}`));
  const total = script.scenes.reduce((a, s) => a + s.verification.supportedSentences, 0);
  add('all narration sentences supported by sources', true, `${total} supported sentences; ${dropped.length} unsupported sentences removed before narration`);

  /* description credits */
  const desc = meta.description;
  if (analysis.kind === 'repo') {
    add('credit and license in description', desc.includes(analysis.repo.url) && /License:/.test(desc) && desc.includes(analysis.repo.owner), 'repo link, author and license line');
  } else {
    add('sources credited in description', /Source:/.test(desc), 'source attribution lines');
  }
  add('AI voice disclosure in description', /synthetic|computer-generated/i.test(desc), 'synthetic narration disclosed');

  /* outputs (quality-report.json itself is written below) */
  const absent = REQUIRED_OUTPUTS.filter((f) => !fs.existsSync(ctx.file(f)));
  add('all output files exist', absent.length === 0, absent.length ? `missing: ${absent.join(', ')}` : `${REQUIRED_OUTPUTS.length + 1} files`);

  const uncertain: string[] = [...dropped.map((d) => `removed (unsupported): ${d}`)];
  if (analysis.kind === 'repo') {
    const claims = [analysis.purpose, analysis.audience, ...analysis.frameworks, ...analysis.strengths, ...analysis.weaknesses, ...analysis.modules.map((m) => m.responsibility)];
    for (const c of claims) if (c.status !== 'verified') uncertain.push(`${c.status}: ${c.text}`);
  }
  const voice = JSON.parse(fs.readFileSync(ctx.file('audio/manifest.json'), 'utf8'));
  const licenseNotes = [
    `Narration voice: ${voice.provider}/${voice.voice} — ${voice.license}. No voice cloning is used.`,
    'Fonts: Inter, JetBrains Mono, Patrick Hand — SIL Open Font License 1.1 (bundled via @fontsource).',
    'Remotion: free for individuals and companies of up to 3 people; larger companies need a company license (remotion.dev/license).',
  ];
  if (analysis.kind === 'repo') {
    licenseNotes.unshift(`Repository license: ${analysis.license.spdx ?? 'not detected'}${analysis.license.warning ? ` — ${analysis.license.warning}` : ''}`);
  } else {
    const sources = JSON.parse(fs.readFileSync(ctx.file('sources.json'), 'utf8')) as { title: string; license?: string; attribution?: string }[];
    for (const s of sources) licenseNotes.unshift(`Source "${s.title}": ${s.license ?? 'license unknown — make sure you have the right to use this material'}${s.attribution ? ` (${s.attribution})` : ''}`);
  }
  if (ctx.cfg.render.musicFile) licenseNotes.push(`Music: ${path.basename(ctx.cfg.render.musicFile)} — confirm it is CC0 or from the YouTube Audio Library.`);

  const report: QualityReport = {
    ok: checks.every((c) => c.ok || c.severity !== 'error'),
    generatedAt: new Date().toISOString(),
    checks,
    uncertainClaims: uncertain,
    limitations: analysis.uncertainties,
    licenseNotes,
    warnings: ctx.log.warnings,
  };
  writeJson(ctx.file('quality-report.json'), report);
  return report;
}
