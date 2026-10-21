import fs from 'node:fs';
import { loadConfig } from '../core/config.js';
import { commandExists, run } from '../core/exec.js';
import { rustScannerPath } from '../repo/scan.js';

const cfg = loadConfig();
const line = (ok: boolean, label: string, hint = '') => console.log(`${ok ? '✔' : '✖'} ${label}${!ok && hint ? `\n    → ${hint}` : ''}`);
const py = async (mod: string) => (await run(cfg.tts.python, ['-c', `import ${mod}`]).catch(() => ({ code: 1 }))).code === 0;

console.log('Reponimate doctor\n');
line(Number(process.versions.node.split('.')[0]) >= 20, `Node.js ${process.versions.node}`, 'Install Node 20 or newer');
line(await commandExists('git'), 'git', 'Install git');
line(await commandExists('ffmpeg'), 'ffmpeg / ffprobe', 'Install FFmpeg (https://ffmpeg.org)');
line(Boolean(cfg.render.browserExecutable), `Chromium: ${cfg.render.browserExecutable || 'not found (Remotion will download one)'}`);
let ollama = false;
try {
  ollama = (await fetch(`${cfg.llm.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) })).ok;
} catch {}
line(ollama, `Ollama at ${cfg.llm.ollamaHost}`, `Install from https://ollama.com, then: ollama pull ${cfg.llm.ollamaModel} && ollama pull ${cfg.llm.ollamaEmbedModel}  (or use --llm none)`);
line(fs.existsSync(cfg.tts.piperVoice) && (await py('piper')), 'Piper voice', 'pip install -r python/requirements.txt && npm run setup:voices');
line(await commandExists('espeak-ng'), 'eSpeak NG (fallback voice)', 'apt install espeak-ng / brew install espeak-ng');
line(await py('faster_whisper'), 'faster-whisper (word timings)', 'pip install -r python/requirements.txt (otherwise proportional timings are used)');
line(Boolean(rustScannerPath()), 'Rust scanner', 'Optional: npm run build:rust (needs cargo)');
