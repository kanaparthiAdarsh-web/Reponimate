import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../core/config.js';
import { ROOT } from '../core/config.js';
import { UserError } from '../core/errors.js';
import { commandExists, run, runOk } from '../core/exec.js';

export interface TtsProvider {
  readonly name: string;
  readonly voice: string;
  /** License note for the voice/model, copied into the quality report and ASSETS. */
  readonly license: string;
  synthesize(text: string, outWav: string): Promise<void>;
  /** Many clips in one call so the voice model loads once (much faster than one process per scene). */
  synthesizeBatch?(jobs: { text: string; out: string }[]): Promise<void>;
}

/** Writes each text to a UTF-8 file next to its output and a JOBS.json listing them; returns cleanup. */
function writeJobs(jobs: { text: string; out: string }[]): { file: string; cleanup: () => void } {
  const list = jobs.map((j) => {
    const textFile = j.out.replace(/\.wav$/i, '') + '.txt';
    fs.writeFileSync(textFile, j.text, 'utf8');
    return { text_file: textFile, out: j.out };
  });
  const file = path.join(path.dirname(jobs[0].out), `tts-jobs-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(list), 'utf8');
  return { file, cleanup: () => [file, ...list.map((l) => l.text_file)].forEach((f) => fs.rmSync(f, { force: true })) };
}

class PiperTts implements TtsProvider {
  readonly name = 'piper';
  readonly license: string;
  constructor(
    private python: string,
    private model: string,
  ) {
    this.license = path.basename(model).includes('ljspeech')
      ? 'Piper (GPL-3.0 engine); voice en_US-ljspeech trained on the public-domain LJ Speech dataset'
      : 'Piper (GPL-3.0 engine); check the MODEL_CARD of this voice for its dataset license';
  }
  get voice(): string {
    return path.basename(this.model, '.onnx');
  }
  async synthesize(text: string, outWav: string): Promise<void> {
    // Text goes through a UTF-8 file (not stdin): Windows pipes use the legacy code page and break on "—", "→", quotes…
    const textFile = outWav.replace(/\.wav$/i, '') + '.txt';
    fs.writeFileSync(textFile, text, 'utf8');
    try {
      await runOk(this.python, [path.join(ROOT, 'python', 'tts_piper.py'), this.model, textFile, outWav], { timeoutMs: 300_000 });
    } finally {
      fs.rmSync(textFile, { force: true });
    }
  }
  async synthesizeBatch(jobs: { text: string; out: string }[]): Promise<void> {
    const { file, cleanup } = writeJobs(jobs);
    try {
      await runOk(this.python, [path.join(ROOT, 'python', 'tts_piper.py'), this.model, '--batch', file], { timeoutMs: 1_800_000 });
    } finally {
      cleanup();
    }
  }
}

class KokoroTts implements TtsProvider {
  readonly name = 'kokoro';
  readonly license = 'Kokoro-82M weights, Apache-2.0; kokoro-onnx runtime, MIT';
  constructor(
    private python: string,
    private model: string,
    private voices: string,
    readonly voice: string,
  ) {}
  async synthesize(text: string, outWav: string): Promise<void> {
    await runOk(this.python, [path.join(ROOT, 'python', 'tts_kokoro.py'), this.model, this.voices, this.voice, outWav], { input: text, timeoutMs: 300_000 });
  }
  async synthesizeBatch(jobs: { text: string; out: string }[]): Promise<void> {
    const { file, cleanup } = writeJobs(jobs);
    try {
      await runOk(this.python, [path.join(ROOT, 'python', 'tts_kokoro.py'), this.model, this.voices, this.voice, '--batch', file], { timeoutMs: 1_800_000 });
    } finally {
      cleanup();
    }
  }
}

class EspeakTts implements TtsProvider {
  readonly name = 'espeak';
  readonly license = 'eSpeak NG (GPL-3.0 engine; generated audio is not restricted)';
  constructor(readonly voice: string) {}
  async synthesize(text: string, outWav: string): Promise<void> {
    await runOk('espeak-ng', ['-v', this.voice, '-s', '160', '-g', '4', '-w', outWav, '--stdin'], { input: text, timeoutMs: 120_000 });
  }
}

async function pythonHas(python: string, mod: string): Promise<boolean> {
  try {
    return (await run(python, ['-c', `import ${mod}`], { timeoutMs: 30_000 })).code === 0;
  } catch {
    return false;
  }
}

/**
 * Picks a text-to-speech backend. Every option uses openly licensed voices — there is no voice cloning.
 * auto: Piper (if a voice model is downloaded) → Kokoro (if installed) → eSpeak NG.
 */
export async function createTts(cfg: AppConfig, override?: string): Promise<TtsProvider> {
  const want = override ?? cfg.tts.provider;
  const t = cfg.tts;
  const piperOk = async () => fs.existsSync(t.piperVoice) && (await pythonHas(t.python, 'piper'));
  const kokoroOk = async () => fs.existsSync(t.kokoroModel) && fs.existsSync(t.kokoroVoices) && (await pythonHas(t.python, 'kokoro_onnx'));
  if (want === 'piper' || (want === 'auto' && (await piperOk()))) {
    if (!(await piperOk())) throw new UserError(`Piper voice not found at ${t.piperVoice} or piper-tts not installed.`, 'Run: npm run setup:voices');
    return new PiperTts(t.python, t.piperVoice);
  }
  if (want === 'kokoro' || (want === 'auto' && (await kokoroOk()))) {
    if (!(await kokoroOk())) throw new UserError('Kokoro model files or kokoro-onnx are missing.', 'Run: npm run setup:voices -- --kokoro');
    return new KokoroTts(t.python, t.kokoroModel, t.kokoroVoices, t.kokoroVoice);
  }
  if (await commandExists('espeak-ng')) return new EspeakTts(t.espeakVoice);
  throw new UserError('No text-to-speech engine is available.', 'Run `npm run setup:voices` to download the Piper voice, or install espeak-ng.');
}
