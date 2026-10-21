import type { Visual } from '../core/schemas.js';
import type { RepoFile } from '../repo/inventory.js';
import { extractSymbols } from '../repo/symbols.js';
import { buildFlow, type Flow } from './flow.js';

export const SHIKI_LANG: Record<string, string> = {
  TypeScript: 'typescript', JavaScript: 'javascript', Python: 'python', Go: 'go', Rust: 'rust', Java: 'java',
  Kotlin: 'kotlin', Ruby: 'ruby', PHP: 'php', 'C#': 'csharp', C: 'c', 'C++': 'cpp', Swift: 'swift', Scala: 'scala',
  Shell: 'bash', Lua: 'lua', Dart: 'dart', Elixir: 'elixir', Haskell: 'haskell', Vue: 'vue', Svelte: 'svelte',
  SQL: 'sql', JSON: 'json', YAML: 'yaml', TOML: 'toml', Markdown: 'markdown', HTML: 'html', CSS: 'css',
};

/**
 * Picks a short, genuine excerpt from a file: the most substantial exported declaration, capped at `maxLines`.
 * The code is copied verbatim; nothing is reformatted or invented.
 */
function excerptAt(file: RepoFile, maxLines: number): { visual: NonNullable<Visual['code']>; symbol?: string; flow?: Flow } {
  const lines = file.text.split('\n');
  const syms = extractSymbols(file);
  const ranked = syms
    .map((s, i) => ({ s, len: (syms[i + 1]?.line ?? lines.length + 1) - s.line }))
    .filter((x) => x.len >= 3)
    .sort((a, b) => Number(b.s.exported) - Number(a.s.exported) || Number(b.s.kind === 'function' || b.s.kind === 'class') - Number(a.s.kind === 'function' || a.s.kind === 'class') || b.len - a.len);
  const pick = ranked[0];
  let start = pick ? pick.s.line : 1;
  // Include a doc comment that sits right above the declaration.
  while (start > 1 && /^\s*(\/\/|\*|\/\*\*|#|""")/.test(lines[start - 2]) && pick && pick.s.line - start < 4) start--;
  let end = Math.min(lines.length, start + maxLines - 1);
  if (pick) end = Math.min(end, pick.s.line + pick.len - 1);
  while (end > start && lines[end - 1].trim() === '') end--;
  const code = lines.slice(start - 1, end).join('\n');
  const highlight: number[] = [];
  lines.slice(start - 1, end).forEach((l, i) => {
    const n = start + i;
    if (pick && n === pick.s.line) highlight.push(n);
    else if (/\breturn\b|\bawait\b|\byield\b|\bthrow\b|=>|\?\?|\.map\(|\.filter\(|\.reduce\(/.test(l) && highlight.length < 4) highlight.push(n);
  });
  const flow = buildFlow(code, start, pick?.s.name);
  // When there is a flowchart, the narration steps through its nodes so code line and chart node light up together.
  const steps = flow ? flow.nodes.map((n) => n.line).slice(0, 8) : highlight;
  return {
    visual: { path: file.path, language: SHIKI_LANG[file.language] ?? 'text', startLine: start, endLine: end, code, highlight: steps },
    symbol: pick?.s.name,
    flow: flow ?? undefined,
  };
}

/**
 * Short excerpts stay readable; when a longer window (up to 30 lines) yields a richer flowchart,
 * use it — the camera pans along the code while the chart explains the structure.
 */
export function pickExcerpt(file: RepoFile, maxLines = 16): ReturnType<typeof excerptAt> {
  const short = excerptAt(file, maxLines);
  const long = excerptAt(file, 30);
  const nodes = (x: ReturnType<typeof excerptAt>) => x.flow?.nodes.length ?? 0;
  return nodes(long) >= 5 && nodes(long) > nodes(short) ? long : short;
}
