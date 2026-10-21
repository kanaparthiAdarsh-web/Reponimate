import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { ensureDir } from '../core/files.js';

/** Downloads open-licence voice models. Nothing here is a cloned or proprietary voice. */
const cfg = loadConfig();
const want = process.argv.includes('--kokoro') ? 'kokoro' : 'piper';

async function download(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) return console.log(`✔ ${path.basename(dest)} already present`);
  ensureDir(path.dirname(dest));
  console.log(`↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  fs.writeFileSync(dest + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(dest + '.part', dest);
}

if (want === 'piper') {
  // en_US-ljspeech-high: trained on the public-domain LJ Speech dataset.
  const base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx';
  await download(base, cfg.tts.piperVoice);
  await download(base + '.json', cfg.tts.piperVoice + '.json');
} else {
  // Kokoro-82M, Apache-2.0.
  const rel = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
  await download(`${rel}/kokoro-v1.0.onnx`, cfg.tts.kokoroModel);
  await download(`${rel}/voices-v1.0.bin`, cfg.tts.kokoroVoices);
  console.log('Also run: pip install kokoro-onnx soundfile');
}
console.log('Done.');
