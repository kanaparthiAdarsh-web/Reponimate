import fs from 'node:fs';
import path from 'node:path';

/** Directories that never contain the code we want to explain. */
export const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', 'target',
  '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.gradle', '.idea',
  '.vscode', 'bower_components', 'Pods', '.cache', '.turbo', '.yarn', 'third_party', 'site-packages',
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svgz', '.pdf', '.zip', '.gz', '.tgz', '.bz2',
  '.xz', '.7z', '.rar', '.jar', '.war', '.class', '.so', '.dylib', '.dll', '.exe', '.bin', '.o', '.a',
  '.wasm', '.mp3', '.mp4', '.wav', '.ogg', '.mov', '.avi', '.webm', '.ttf', '.otf', '.woff', '.woff2',
  '.eot', '.psd', '.sqlite', '.db', '.pyc', '.onnx', '.pt', '.safetensors', '.h5', '.pkl', '.npy',
]);

const GENERATED = [/\.min\.(js|css)$/, /\.map$/, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Cargo\.lock$/, /(^|\/)poetry\.lock$/, /(^|\/)go\.sum$/, /(^|\/)composer\.lock$/, /\.pb\.go$/, /_pb2\.py$/,
  /\.generated\./, /(^|\/)Gemfile\.lock$/, /\.snap$/];

const SECRET_FILES = [/(^|\/)\.env(\..*)?$/, /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /(^|\/)id_(rsa|dsa|ed25519|ecdsa)$/,
  /(^|\/)\.npmrc$/, /(^|\/)\.pypirc$/, /(^|\/)credentials(\.json)?$/, /(^|\/)\.netrc$/, /secrets?\.(ya?ml|json)$/];

export function isBinaryPath(p: string): boolean {
  return BINARY_EXT.has(path.extname(p).toLowerCase());
}
export function isGeneratedPath(p: string): boolean {
  return GENERATED.some((r) => r.test(p));
}
export function isSecretPath(p: string): boolean {
  // .env.example / .env.sample hold placeholders, not secrets, and often document configuration.
  if (/\.env\.(example|sample|template)$/.test(p)) return false;
  return SECRET_FILES.some((r) => r.test(p));
}

/** True when `target` (after resolving symlinks) is inside `root`. Prevents path traversal and symlink escape. */
export function isInside(root: string, target: string): boolean {
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    return false;
  }
  const rootReal = fs.realpathSync(root);
  const rel = path.relative(rootReal, real);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '[REDACTED GITHUB TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '[REDACTED GITHUB TOKEN]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED API KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED GOOGLE KEY]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED SLACK TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED JWT]'],
  [
    /((?:api[_-]?key|secret|password|passwd|token|auth)["']?\s*[:=]\s*["'])([^"'\s]{8,})(["'])/gi,
    '$1[REDACTED]$3',
  ],
];

/** Removes things that look like credentials before any text is shown to an LLM or put in a video. */
export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) {
    out = out.replace(re, (...m) => {
      count++;
      return rep.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
    });
  }
  return { text: out, count };
}
