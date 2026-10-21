import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

let loaded = false;
function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(ROOT, '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function env(name: string, fallback = ''): string {
  loadDotEnv();
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function resolveFromRoot(p: string): string {
  return p && !path.isAbsolute(p) ? path.join(ROOT, p) : p;
}

export type LlmProviderName = 'ollama' | 'anthropic' | 'none';
export type TtsProviderName = 'auto' | 'piper' | 'kokoro' | 'espeak';
export type AlignerName = 'whisper' | 'proportional';

export interface AppConfig {
  llm: {
    provider: LlmProviderName;
    ollamaHost: string;
    ollamaModel: string;
    ollamaEmbedModel: string;
    anthropicKey: string;
    anthropicModel: string;
    timeoutMs: number;
  };
  tts: {
    provider: TtsProviderName;
    piperVoice: string;
    kokoroModel: string;
    kokoroVoices: string;
    kokoroVoice: string;
    espeakVoice: string;
    python: string;
  };
  aligner: AlignerName;
  whisperModel: string;
  render: { browserExecutable: string; concurrency: number; musicFile: string; gl: string; music: string };
  githubToken: string;
  channelName: string;
  port: number;
  cacheDir: string;
  outDir: string;
  limits: {
    maxFileBytes: number;
    maxTotalBytes: number;
    maxFiles: number;
    cloneTimeoutMs: number;
  };
}

/** Finds a locally installed Chromium so Remotion/Puppeteer do not need to download one. */
function detectBrowser(): string {
  const candidates = [
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? '';
}

export function loadConfig(): AppConfig {
  return {
    llm: {
      provider: env('LLM_PROVIDER', 'ollama') as LlmProviderName,
      ollamaHost: env('OLLAMA_HOST', 'http://127.0.0.1:11434'),
      ollamaModel: env('OLLAMA_MODEL', 'qwen2.5:7b-instruct'),
      ollamaEmbedModel: env('OLLAMA_EMBED_MODEL', 'nomic-embed-text'),
      anthropicKey: env('ANTHROPIC_API_KEY'),
      anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
      timeoutMs: Number(env('LLM_TIMEOUT_MS', '180000')),
    },
    tts: {
      provider: env('TTS_PROVIDER', 'auto') as TtsProviderName,
      piperVoice: resolveFromRoot(env('PIPER_VOICE', 'models/piper/en_US-ljspeech-high.onnx')),
      kokoroModel: resolveFromRoot(env('KOKORO_MODEL', 'models/kokoro/kokoro-v1.0.onnx')),
      kokoroVoices: resolveFromRoot(env('KOKORO_VOICES', 'models/kokoro/voices-v1.0.bin')),
      kokoroVoice: env('KOKORO_VOICE', 'af_heart'),
      espeakVoice: env('ESPEAK_VOICE', 'en-us'),
      python: env('PYTHON', 'python3'),
    },
    aligner: env('ALIGNER', 'whisper') as AlignerName,
    whisperModel: env('WHISPER_MODEL', 'base.en'),
    render: {
      browserExecutable: env('BROWSER_EXECUTABLE') || detectBrowser(),
      concurrency: Number(env('RENDER_CONCURRENCY', '4')),
      // 'angle' was ~5x faster than 'swangle' on a CPU-only Linux box; use 'swiftshader' or 'egl' if angle fails on yours.
      gl: env('RENDER_GL', 'angle'),
      music: env('MUSIC', 'auto'),
      musicFile: resolveFromRoot(env('MUSIC_FILE')),
    },
    githubToken: env('GITHUB_TOKEN'),
    channelName: env('CHANNEL_NAME'),
    cacheDir: resolveFromRoot(env('CACHE_DIR', 'cache')),
    outDir: resolveFromRoot(env('OUT_DIR', 'out')),
    port: Number(env('PORT', '4777')),
    limits: {
      maxFileBytes: 512 * 1024,
      maxTotalBytes: 40 * 1024 * 1024,
      maxFiles: 5000,
      cloneTimeoutMs: 120_000,
    },
  };
}
