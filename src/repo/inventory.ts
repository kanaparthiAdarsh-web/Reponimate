import fs from 'node:fs';
import path from 'node:path';
import { EXCLUDED_DIRS, isBinaryPath, isGeneratedPath, isInside, isSecretPath, looksBinary, redactSecrets } from './security.js';

export type FileCategory = 'source' | 'test' | 'doc' | 'config' | 'manifest' | 'license' | 'other';

export interface RepoFile {
  path: string; // posix, relative to repo root
  language: string;
  category: FileCategory;
  bytes: number;
  lines: number;
  text: string; // redacted
}

export interface Inventory {
  root: string;
  files: RepoFile[];
  skipped: { path: string; reason: string }[];
  redactions: number;
  totalBytes: number;
}

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++',
  '.cxx': 'C++', '.swift': 'Swift', '.scala': 'Scala', '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.lua': 'Lua', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.hs': 'Haskell',
  '.clj': 'Clojure', '.vue': 'Vue', '.svelte': 'Svelte', '.r': 'R', '.jl': 'Julia', '.zig': 'Zig',
  '.nim': 'Nim', '.ml': 'OCaml', '.fs': 'F#', '.sql': 'SQL', '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML',
  '.md': 'Markdown', '.mdx': 'Markdown', '.rst': 'reStructuredText', '.txt': 'Text', '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML', '.ini': 'INI', '.xml': 'XML', '.gradle': 'Gradle',
  '.proto': 'Protobuf', '.graphql': 'GraphQL', '.tf': 'Terraform', '.nix': 'Nix', '.cmake': 'CMake',
};

const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'Package.swift', 'mix.exs',
  'deno.json', 'pubspec.yaml', 'CMakeLists.txt', 'Makefile', 'Dockerfile', 'docker-compose.yml', 'compose.yaml']);

export const CODE_LANGS = new Set(['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'Ruby', 'PHP',
  'C#', 'C', 'C++', 'Swift', 'Scala', 'Shell', 'Lua', 'Dart', 'Elixir', 'Erlang', 'Haskell', 'Clojure', 'Vue',
  'Svelte', 'R', 'Julia', 'Zig', 'Nim', 'OCaml', 'F#', 'SQL']);

export function languageOf(p: string): string {
  const base = path.posix.basename(p);
  if (base === 'Dockerfile') return 'Dockerfile';
  if (base === 'Makefile') return 'Makefile';
  return LANG_BY_EXT[path.extname(p).toLowerCase()] ?? 'Other';
}

export function categorize(p: string, language: string): FileCategory {
  const base = path.posix.basename(p).toLowerCase();
  if (/^(license|licence|copying|notice)(\.|$)/.test(base)) return 'license';
  if (MANIFESTS.has(path.posix.basename(p))) return 'manifest';
  if (/(^|\/)(tests?|__tests__|spec|specs|testdata)\//i.test(p) || /[._-](test|spec)\.[a-z]+$/i.test(base) || /^test_.*\.py$/.test(base) || /^tests?\.[a-z]+$/.test(base)) {
    return 'test';
  }
  if (['Markdown', 'reStructuredText', 'Text'].includes(language) || /(^|\/)docs?\//i.test(p)) return 'doc';
  if (CODE_LANGS.has(language)) return 'source';
  if (['JSON', 'YAML', 'TOML', 'INI', 'XML', 'Dockerfile', 'Makefile', 'Gradle'].includes(language) || base.startsWith('.')) {
    return 'config';
  }
  return 'other';
}

export function hasVeryLongLine(text: string, max = 1000): boolean {
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) run = 0;
    else if (++run > max) return true;
  }
  return false;
}

export function buildInventory(
  root: string,
  limits: { maxFileBytes: number; maxTotalBytes: number; maxFiles: number },
): Inventory {
  const files: RepoFile[] = [];
  const skipped: Inventory['skipped'] = [];
  let totalBytes = 0;
  let redactions = 0;

  const walk = (dirAbs: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    // Byte-order sort: identical on every OS/locale and matches the Rust scanner.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dirAbs, e.name);
      if (e.isSymbolicLink()) {
        if (!isInside(root, abs)) skipped.push({ path: relPath, reason: 'symlink escapes repository' });
        else skipped.push({ path: relPath, reason: 'symlink (not followed)' });
        continue;
      }
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        walk(abs, relPath);
        continue;
      }
      if (!e.isFile()) continue;
      if (files.length >= limits.maxFiles) {
        skipped.push({ path: relPath, reason: 'file count limit' });
        continue;
      }
      if (isSecretPath(relPath)) {
        skipped.push({ path: relPath, reason: 'possible secret file' });
        continue;
      }
      if (isBinaryPath(relPath)) continue;
      if (isGeneratedPath(relPath)) {
        skipped.push({ path: relPath, reason: 'generated or lock file' });
        continue;
      }
      const size = fs.statSync(abs).size;
      if (size > limits.maxFileBytes) {
        skipped.push({ path: relPath, reason: `larger than ${Math.round(limits.maxFileBytes / 1024)} KB` });
        continue;
      }
      if (totalBytes + size > limits.maxTotalBytes) {
        skipped.push({ path: relPath, reason: 'total size limit' });
        continue;
      }
      const buf = fs.readFileSync(abs);
      if (looksBinary(buf)) continue;
      const raw = buf.toString('utf8');
      if (hasVeryLongLine(raw)) {
        skipped.push({ path: relPath, reason: 'minified (line longer than 1000 characters)' });
        continue;
      }
      const red = redactSecrets(raw);
      redactions += red.count;
      totalBytes += size;
      const language = languageOf(relPath);
      files.push({
        path: relPath,
        language,
        category: categorize(relPath, language),
        bytes: size,
        lines: red.text.split('\n').length,
        text: red.text,
      });
    }
  };
  walk(root, '');
  return { root, files, skipped, redactions, totalBytes };
}
