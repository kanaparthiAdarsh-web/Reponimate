import path from 'node:path';
import type { RepoFile } from './inventory.js';

export interface ImportEdge {
  from: string;
  to: string; // internal file path
}

export interface ImportGraphResult {
  edges: ImportEdge[];
  external: Map<string, number>; // package -> number of importing files
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
}

/** Extracts raw import specifiers with lightweight regexes per language (static only; nothing is executed). */
export function extractImports(file: RepoFile): string[] {
  const t = file.text;
  const out: string[] = [];
  switch (file.language) {
    case 'TypeScript':
    case 'JavaScript':
    case 'Vue':
    case 'Svelte':
      for (const m of t.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
      for (const m of t.matchAll(/import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
      for (const m of t.matchAll(/(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
      break;
    case 'Python':
      for (const m of t.matchAll(/^\s*from\s+(\.*[A-Za-z0-9_.]*)\s+import\s+([A-Za-z0-9_, ]+)/gm)) {
        out.push(m[1]);
        if (/^\.+$/.test(m[1])) for (const n of m[2].split(',')) out.push(m[1] + n.trim());
      }
      for (const m of t.matchAll(/^\s*import\s+([A-Za-z0-9_.]+)/gm)) out.push(m[1]);
      break;
    case 'Go': {
      for (const m of t.matchAll(/import\s*\(([\s\S]*?)\)/g)) for (const s of m[1].matchAll(/"([^"]+)"/g)) out.push(s[1]);
      for (const m of t.matchAll(/import\s+(?:\w+\s+)?"([^"]+)"/g)) out.push(m[1]);
      break;
    }
    case 'Rust':
      for (const m of t.matchAll(/^\s*(?:pub\s+)?mod\s+([a-z0-9_]+)\s*;/gm)) out.push(`mod:${m[1]}`);
      for (const m of t.matchAll(/^\s*use\s+([a-z0-9_]+)::/gm)) out.push(m[1]);
      break;
    case 'Ruby':
      for (const m of t.matchAll(/require(?:_relative)?\s+['"]([^'"]+)['"]/g)) out.push(m[1]);
      break;
    default:
      break;
  }
  return [...new Set(out)];
}

function resolveInternal(file: RepoFile, spec: string, byPath: Set<string>, goModule?: string): string | null {
  const dir = path.posix.dirname(file.path);
  const tryPaths = (base: string, exts: string[]): string | null => {
    for (const e of exts) {
      const p = path.posix.normalize(base + e);
      if (byPath.has(p)) return p;
    }
    return null;
  };
  if (['TypeScript', 'JavaScript', 'Vue', 'Svelte'].includes(file.language)) {
    if (!spec.startsWith('.')) return null;
    const base = path.posix.join(dir, spec).replace(/\.(js|mjs|cjs)$/, '');
    return tryPaths(base, ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.mjs']);
  }
  if (file.language === 'Python') {
    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)![0].length;
      let base = dir;
      for (let i = 1; i < dots; i++) base = path.posix.dirname(base);
      const rest = spec.slice(dots).replace(/\./g, '/');
      return tryPaths(rest ? path.posix.join(base, rest) : base, ['.py', '/__init__.py']);
    }
    const rel = spec.replace(/\./g, '/');
    return tryPaths(rel, ['.py', '/__init__.py']) ?? tryPaths(`src/${rel}`, ['.py', '/__init__.py']);
  }
  if (file.language === 'Go' && goModule && spec.startsWith(goModule + '/')) {
    const pkgDir = spec.slice(goModule.length + 1);
    for (const p of byPath) if (path.posix.dirname(p) === pkgDir && p.endsWith('.go') && !p.endsWith('_test.go')) return p;
    return null;
  }
  if (file.language === 'Rust' && spec.startsWith('mod:')) {
    const name = spec.slice(4);
    return tryPaths(path.posix.join(dir, name), ['.rs', '/mod.rs']);
  }
  if (file.language === 'Ruby') {
    return tryPaths(path.posix.join(dir, spec), ['.rb', '']) ?? tryPaths(path.posix.join('lib', spec), ['.rb']);
  }
  return null;
}

function externalName(spec: string, language: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('mod:')) return null;
  if (spec.startsWith('node:')) return null;
  if (['TypeScript', 'JavaScript', 'Vue', 'Svelte'].includes(language)) {
    const parts = spec.split('/');
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  }
  if (language === 'Python') return spec.split('.')[0];
  return spec;
}

export function buildImportGraph(files: RepoFile[], goModule?: string): ImportGraphResult {
  const code = files.filter((f) => f.category === 'source' || f.category === 'test');
  const byPath = new Set(code.map((f) => f.path));
  const edges: ImportEdge[] = [];
  const external = new Map<string, number>();
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const f of code) {
    const seen = new Set<string>();
    for (const spec of extractImports(f)) {
      const target = resolveInternal(f, spec, byPath, goModule);
      if (target && target !== f.path) {
        if (seen.has(target)) continue;
        seen.add(target);
        edges.push({ from: f.path, to: target });
        if (f.category === 'source') {
          fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
          fanOut.set(f.path, (fanOut.get(f.path) ?? 0) + 1);
        }
      } else if (!target && f.category === 'source') {
        const ext = externalName(spec, f.language);
        if (ext) external.set(ext, (external.get(ext) ?? 0) + 1);
      }
    }
  }
  return { edges, external, fanIn, fanOut };
}
