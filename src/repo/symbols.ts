import type { RepoFile } from './inventory.js';

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'type' | 'const';
  line: number;
  exported: boolean;
}

const PATTERNS: Record<string, [RegExp, SymbolInfo['kind']][]> = {
  js: [
    [/^(export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
    [/^(export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [/^(export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, 'type'],
    [/^(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 'function'],
    [/^(export\s+)const\s+([A-Za-z_$][\w$]*)/, 'const'],
  ],
  py: [
    [/^()(?:async\s+)?def\s+([A-Za-z_]\w*)/, 'function'],
    [/^()class\s+([A-Za-z_]\w*)/, 'class'],
  ],
  go: [
    [/^()func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, 'function'],
    [/^()type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, 'type'],
  ],
  rs: [
    [/^(pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-z_]\w*)/, 'function'],
    [/^(pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, 'type'],
  ],
  java: [
    [/^\s{0,4}(public\s+)?(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/, 'class'],
  ],
  rb: [
    [/^()\s{0,2}def\s+(?:self\.)?([a-z_]\w*[?!]?)/, 'function'],
    [/^()\s{0,2}(?:class|module)\s+([A-Z]\w*)/, 'class'],
  ],
};

function familyOf(lang: string): string | null {
  if (['TypeScript', 'JavaScript', 'Vue', 'Svelte'].includes(lang)) return 'js';
  return ({ Python: 'py', Go: 'go', Rust: 'rs', Java: 'java', Kotlin: 'java', Ruby: 'rb' } as Record<string, string>)[lang] ?? null;
}

/** Top-level declarations found by line-anchored regexes (no code is executed or compiled). */
export function extractSymbols(file: RepoFile): SymbolInfo[] {
  const fam = familyOf(file.language);
  if (!fam) return [];
  const out: SymbolInfo[] = [];
  file.text.split('\n').forEach((line, i) => {
    for (const [re, kind] of PATTERNS[fam]) {
      const m = line.match(re);
      if (m) {
        const name = m[2];
        const exported =
          fam === 'js' ? Boolean(m[1]) : fam === 'go' ? /^[A-Z]/.test(name) : fam === 'rs' ? Boolean(m[1]) : fam === 'py' ? !name.startsWith('_') : true;
        out.push({ name, kind, line: i + 1, exported });
        break;
      }
    }
  });
  return out;
}

/** A doc comment (block, // or #) directly above line `line` (1-based). */
export function docAbove(file: RepoFile, line: number): { text: string; startLine: number; endLine: number } | null {
  const lines = file.text.split('\n');
  let i = line - 2;
  const collected: string[] = [];
  if (/\*\/\s*$/.test(lines[i] ?? '')) {
    for (; i >= 0; i--) {
      collected.unshift(lines[i].replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, ''));
      if (/^\s*\/\*/.test(lines[i])) break;
    }
  } else {
    for (; i >= 0 && /^\s*(\/\/\/?|#(?!include|!))/.test(lines[i]); i--) collected.unshift(lines[i].replace(/^\s*(\/\/+|#+)\s?/, ''));
    i++;
  }
  const text = collected.join(' ').replace(/@\w+.*$/, '').replace(/\s+/g, ' ').trim();
  if (text.length < 12) return null;
  return { text: text.slice(0, 300), startLine: Math.max(1, i + 1), endLine: line - 1 };
}

/** The comment or docstring at the top of a file, if it has one; used as verified module documentation. */
export function leadingDoc(file: RepoFile): { text: string; startLine: number; endLine: number } | null {
  const lines = file.text.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('#!') || lines[i].trim() === '' || /^\s*(['"]use strict['"]|# -\*-)/.test(lines[i]))) i++;
  const start = i;
  const collected: string[] = [];
  if (/^\s*\/\*\*?/.test(lines[i] ?? '')) {
    for (; i < lines.length; i++) {
      collected.push(lines[i].replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, ''));
      if (lines[i].includes('*/')) break;
    }
  } else if (/^\s*("""|''')/.test(lines[i] ?? '')) {
    const q = lines[i].trim().slice(0, 3);
    collected.push(lines[i].trim().slice(3));
    if (!lines[i].trim().slice(3).includes(q)) {
      for (i++; i < lines.length; i++) {
        collected.push(lines[i]);
        if (lines[i].includes(q)) break;
      }
    }
  } else {
    for (; i < lines.length && /^\s*(\/\/|#(?!include|!)|--)/.test(lines[i]); i++) collected.push(lines[i].replace(/^\s*(\/\/+|#+|--)\s?/, ''));
  }
  const text = collected.join(' ').replace(/["']{3}/g, '').replace(/@\w+.*$/, '').replace(/\s+/g, ' ').trim();
  if (text.length < 15 || /copyright|license|eslint|prettier|@ts-|SPDX/i.test(text.slice(0, 60))) return null;
  return { text: text.slice(0, 300), startLine: start + 1, endLine: Math.max(start + 1, i + 1) };
}
