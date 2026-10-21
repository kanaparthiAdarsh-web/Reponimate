import path from 'node:path';
import type { Chunk, Claim, Evidence, KnowledgeBase, Manifest, RepoAnalysis } from '../core/schemas.js';
import { assignIds, chunkCode, chunkMarkdown } from '../rag/chunker.js';
import { buildImportGraph } from './imports.js';
import { CODE_LANGS, type Inventory, type RepoFile } from './inventory.js';
import { KNOWN_FRAMEWORKS, lineOf, parseManifest } from './manifests.js';
import { docAbove, extractSymbols, leadingDoc } from './symbols.js';
import type { FetchedRepo } from './fetch.js';
import { UserError } from '../core/errors.js';

const SRC = 'repo';

function ev(p: string, startLine: number, endLine = startLine): Evidence {
  return { sourceId: SRC, path: p, startLine, endLine: Math.max(startLine, endLine) };
}

function claim(text: string, status: Claim['status'], evidence: Evidence[] = []): Claim {
  return { text, status, evidence };
}

const ENTRY_NAMES = /(^|\/)(index|main|cli|app|server|__main__|lib|mod|run|bin)\.(ts|tsx|js|mjs|cjs|py|go|rs|rb|java|kt)$/;

export function findReadme(files: RepoFile[]): RepoFile | undefined {
  return files
    .filter((f) => /^readme(\.[a-z]+)?$/i.test(path.posix.basename(f.path)))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
}

/** First real paragraph of a README (skipping badges, titles, HTML and images). */
export function readmeIntro(readme: RepoFile): { text: string; start: number; end: number } | null {
  const lines = readme.text.split('\n');
  let inFence = false;
  let tagline: { text: string; start: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('```')) inFence = !inFence;
    if (inFence || !l || l.startsWith('#') || l.startsWith('<') || l.startsWith('![') || l.startsWith('[![') || l.startsWith('|') || /^[-=*_]{3,}$/.test(l)) continue;
    const para: string[] = [];
    let j = i;
    for (; j < lines.length && lines[j].trim() && !lines[j].trim().startsWith('#') && !lines[j].trim().startsWith('```'); j++) para.push(lines[j].trim());
    const text = para
      .join(' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/^>\s*/, '')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 25 && /[a-z]/.test(text)) {
      const full = tagline ? `${tagline.text.replace(/[.!]?$/, '.')} ${text}` : text;
      return { text: full.slice(0, 400), start: tagline?.start ?? i + 1, end: j };
    }
    // A short "> tagline" under the title is usually the best one-line description.
    if (text.length >= 5 && lines[i].trim().startsWith('>') && !tagline) tagline = { text, start: i + 1 };
    i = j;
  }
  return null;
}

/** Shell commands from fenced code blocks in the README (install / usage). Only text that literally appears. */
export function readmeCommands(readme: RepoFile): { command: string; line: number }[] {
  const out: { command: string; line: number }[] = [];
  const lines = readme.text.split('\n');
  let fenceLang: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].trim().match(/^(```|~~~)\s*([A-Za-z0-9_-]*)/);
    if (f) {
      fenceLang = fenceLang === null ? f[2].toLowerCase() : null;
      continue;
    }
    if (fenceLang === null) continue;
    const isShell = ['', 'sh', 'bash', 'shell', 'console', 'zsh', 'powershell', 'cmd', 'terminal'].includes(fenceLang);
    if (!isShell) continue;
    const cmd = lines[i].trim().replace(/^[$>]\s+/, '');
    if (/^(npm|npx|pnpm|yarn|bun|pip|pipx|uv|poetry|python3?|cargo|go|brew|apt(-get)?|docker|make|git|deno|gem|bundle|composer|mvn|gradle|\.\/|curl|wget|node)\b/.test(cmd) && cmd.length < 120) {
      out.push({ command: cmd, line: i + 1 });
    }
  }
  return out.slice(0, 12);
}

function detectLicense(files: RepoFile[], manifests: Manifest[]): RepoAnalysis['license'] {
  const lic = files.find((f) => f.category === 'license' && /^(license|licence|copying)/i.test(path.posix.basename(f.path)));
  if (lic) {
    const t = lic.text;
    const spdx =
      /MIT License|Permission is hereby granted, free of charge/i.test(t) ? 'MIT'
      : /Apache License[\s\S]{0,40}Version 2\.0/i.test(t) ? 'Apache-2.0'
      : /GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t) ? 'AGPL-3.0'
      : /GNU LESSER GENERAL PUBLIC LICENSE/i.test(t) ? 'LGPL'
      : /GNU GENERAL PUBLIC LICENSE[\s\S]{0,80}Version 3/i.test(t) ? 'GPL-3.0'
      : /GNU GENERAL PUBLIC LICENSE[\s\S]{0,80}Version 2/i.test(t) ? 'GPL-2.0'
      : /Mozilla Public License[\s\S]{0,20}2\.0/i.test(t) ? 'MPL-2.0'
      : /ISC License/i.test(t) ? 'ISC'
      : /BSD 3-Clause|Redistributions of source code must retain[\s\S]*Neither the name/i.test(t) ? 'BSD-3-Clause'
      : /BSD 2-Clause|Redistributions of source code must retain/i.test(t) ? 'BSD-2-Clause'
      : /unlicense|This is free and unencumbered software/i.test(t) ? 'Unlicense'
      : undefined;
    return {
      spdx,
      file: lic.path,
      warning: spdx ? (/GPL/.test(spdx) ? `${spdx} is a copyleft license; credit the author and link the source.` : undefined) : 'License file present but not recognized; read it before publishing.',
    };
  }
  const pkg = manifests.find((m) => m.type === 'npm');
  if (pkg) return { warning: 'No LICENSE file found. Without a license, all rights are reserved by the author — credit them and avoid reusing code.' };
  return { warning: 'No LICENSE file found. Without a license, all rights are reserved by the author — credit them and avoid reusing code.' };
}

export interface RepoAnalysisResult {
  analysis: RepoAnalysis;
  knowledge: KnowledgeBase;
}

export function analyzeRepo(repo: FetchedRepo, inv: Inventory): RepoAnalysisResult {
  const files = inv.files;
  if (files.length === 0) throw new UserError(`Repository ${repo.url} has no readable text files (empty, binary-only, or everything was filtered).`);
  if (!files.some((f) => f.category === 'source' || f.category === 'doc')) {
    throw new UserError(`Repository ${repo.url} has no source code or documentation to explain.`);
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  const source = files.filter((f) => f.category === 'source');
  const tests = files.filter((f) => f.category === 'test');
  const docs = files.filter((f) => f.category === 'doc');
  const readme = findReadme(files);
  const uncertainties: string[] = [];

  /* manifests & frameworks */
  const manifests = files.filter((f) => f.category === 'manifest').map(parseManifest).filter((m): m is Manifest => Boolean(m));
  const goModule = manifests.find((m) => m.type === 'go')?.name;
  const graph = buildImportGraph(files, goModule);
  const frameworks: Claim[] = [];
  const seenFw = new Set<string>();
  for (const m of manifests) {
    for (const d of [...m.dependencies, ...m.devDependencies]) {
      const label = KNOWN_FRAMEWORKS[d] ?? KNOWN_FRAMEWORKS[d.toLowerCase()];
      if (label && !seenFw.has(label)) {
        seenFw.add(label);
        const file = byPath.get(m.path)!;
        const dev = m.devDependencies.includes(d) && !m.dependencies.includes(d);
        frameworks.push(claim(`${label}${dev ? ' (development dependency)' : ''}`, 'verified', [ev(m.path, lineOf(file.text, `${d}`))]));
      }
    }
  }

  /* languages */
  const langMap = new Map<string, { files: number; lines: number }>();
  for (const f of [...source, ...tests]) {
    if (!CODE_LANGS.has(f.language)) continue;
    const e = langMap.get(f.language) ?? { files: 0, lines: 0 };
    e.files++;
    e.lines += f.lines;
    langMap.set(f.language, e);
  }
  const languages = [...langMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.lines - a.lines);

  /* ranking */
  const readmeText = readme?.text ?? '';
  const declared = new Set(manifests.flatMap((m) => [...m.bin, ...m.main]));
  const scores = new Map<string, { score: number; reasons: string[] }>();
  for (const f of source) {
    const reasons: string[] = [];
    let s = 0;
    if (declared.has(f.path) || [...declared].some((d) => d.replace(/\.(js|mjs|cjs)$/, '') === f.path.replace(/\.(ts|tsx|js|mjs)$/, '').replace(/^src\//, 'dist/').replace(/^dist\//, 'dist/'))) {
      s += 10;
      reasons.push('declared entry point in manifest');
    }
    if (ENTRY_NAMES.test(f.path)) {
      s += 4 - Math.min(3, f.path.split('/').length - 1);
      reasons.push('conventional entry-point file name');
    }
    const fanIn = graph.fanIn.get(f.path) ?? 0;
    if (fanIn) {
      s += Math.min(8, fanIn * 1.5);
      reasons.push(`imported by ${fanIn} file${fanIn > 1 ? 's' : ''}`);
    }
    const fanOut = graph.fanOut.get(f.path) ?? 0;
    if (fanOut >= 3) {
      s += Math.min(4, fanOut * 0.5);
      reasons.push(`imports ${fanOut} internal modules`);
    }
    if (readmeText.includes(path.posix.basename(f.path))) {
      s += 2;
      reasons.push('mentioned in README');
    }
    if (/^(src|lib|pkg|internal|app|cmd|crates)\//.test(f.path) || !f.path.includes('/')) s += 1;
    if (/(^|\/)(examples?|scripts?|benchmarks?|fixtures?)\//.test(f.path)) s -= 3;
    if (f.lines < 5) s -= 2;
    if (f.path.endsWith('.d.ts')) s -= 2;
    s += Math.min(2, f.lines / 200);
    scores.set(f.path, { score: Math.round(s * 10) / 10, reasons });
  }
  const keyFiles = [...scores.entries()]
    .map(([p, v]) => ({ path: p, ...v }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 20);

  /* entry points */
  const entryPoints: RepoAnalysis['entryPoints'] = [];
  for (const m of manifests) {
    for (const b of [...m.bin, ...m.main]) {
      const candidates = [b, b.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'), b.replace(/\.js$/, '.ts')];
      const hit = candidates.find((c) => byPath.has(c));
      if (hit && !entryPoints.some((e) => e.path === hit)) {
        entryPoints.push({ path: hit, reason: m.bin.includes(b) ? `command-line entry ("bin") in ${m.path}` : `main module in ${m.path}`, evidence: [ev(m.path, lineOf(byPath.get(m.path)!.text, b))] });
      }
    }
    for (const [name, target] of Object.entries(m.scripts)) {
      if (m.type !== 'python') continue;
      const mod = target.split(':')[0].replace(/\./g, '/');
      const hit = [`${mod}.py`, `src/${mod}.py`, `${mod}/__init__.py`].find((c) => byPath.has(c));
      if (hit && !entryPoints.some((e) => e.path === hit)) entryPoints.push({ path: hit, reason: `console script "${name}" in ${m.path}`, evidence: [ev(m.path, lineOf(byPath.get(m.path)!.text, name))] });
    }
  }
  for (const f of source) {
    if (entryPoints.length >= 5) break;
    const mainLine = f.text.split('\n').findIndex((l) => /if __name__ == ['"]__main__['"]|^func main\(\)|^fn main\(\)|public static void main\(/.test(l));
    if (mainLine >= 0 && !entryPoints.some((e) => e.path === f.path)) {
      entryPoints.push({ path: f.path, reason: 'defines a main function', evidence: [ev(f.path, mainLine + 1)] });
    }
  }
  if (!entryPoints.length && keyFiles[0]) {
    uncertainties.push(`No declared entry point; ${keyFiles[0].path} is the highest-ranked file by heuristics.`);
  }

  /* modules */
  const modules: RepoAnalysis['modules'] = keyFiles.slice(0, 10).map((k) => {
    const f = byPath.get(k.path)!;
    const syms = extractSymbols(f).filter((s) => s.exported).slice(0, 5);
    const doc = leadingDoc(f) ?? (syms[0] ? docAbove(f, syms[0].line) : null);
    let responsibility: Claim;
    if (doc) responsibility = claim(doc.text, 'verified', [ev(f.path, doc.startLine, doc.endLine)]);
    else if (syms.length)
      responsibility = claim(
        `Defines ${syms.map((s) => `${s.name}`).join(', ')}`,
        'verified',
        syms.slice(0, 3).map((s) => ev(f.path, s.line)),
      );
    else responsibility = claim('Responsibility not documented in the file.', 'unknown');
    return { path: k.path, responsibility, fanIn: graph.fanIn.get(k.path) ?? 0, fanOut: graph.fanOut.get(k.path) ?? 0 };
  });

  /* architecture graph: collapse to directories when there are many files */
  const internalEdges = graph.edges.filter((e) => byPath.get(e.from)?.category === 'source');
  const useDirs = source.length > 14;
  const nodeOf = (p: string): string => (useDirs ? path.posix.dirname(p).split('/').slice(0, 2).join('/') || '.' : p);
  const nodeWeight = new Map<string, number>();
  const edgeSet = new Map<string, { from: string; to: string; label?: string }>();
  for (const e of internalEdges) {
    const a = nodeOf(e.from);
    const b = nodeOf(e.to);
    nodeWeight.set(a, (nodeWeight.get(a) ?? 0) + 1);
    nodeWeight.set(b, (nodeWeight.get(b) ?? 0) + 1);
    if (a !== b) edgeSet.set(`${a}->${b}`, { from: a, to: b });
  }
  const topNodes = [...nodeWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([n]) => n);
  const importGraph = {
    nodes: topNodes.map((n) => ({ id: n, label: n === '.' ? '(root)' : useDirs ? n + '/' : path.posix.basename(n), group: useDirs ? 'dir' : 'file' })),
    edges: [...edgeSet.values()].filter((e) => topNodes.includes(e.from) && topNodes.includes(e.to)).slice(0, 14),
  };
  // External libraries are part of the architecture story too.
  const ownNames = new Set(manifests.map((m) => m.name).filter(Boolean));
  const topExternal = [...graph.external.entries()].filter(([n]) => !ownNames.has(n)).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (importGraph.nodes.length && topExternal.length) {
    for (const [name] of topExternal) {
      importGraph.nodes.push({ id: `ext:${name}`, label: name, group: 'external' });
      const user = internalEdges.length ? topNodes[0] : importGraph.nodes[0].id;
      const importer = [...source].find((f) => f.text.includes(`'${name}`) || f.text.includes(`"${name}`) || f.text.includes(`import ${name}`));
      importGraph.edges.push({ from: importer ? nodeOf(importer.path) : user, to: `ext:${name}`, label: 'uses' });
    }
    importGraph.edges = importGraph.edges.filter((e) => importGraph.nodes.some((n) => n.id === e.from));
  }

  /* purpose, audience, setup */
  const pkg = manifests.find((m) => m.description);
  const intro = readme ? readmeIntro(readme) : null;
  let purpose: Claim;
  if (intro) purpose = claim(intro.text, 'verified', [ev(readme!.path, intro.start, intro.end)]);
  else if (pkg?.description) purpose = claim(pkg.description, 'verified', [ev(pkg.path, lineOf(byPath.get(pkg.path)!.text, '"description"'))]);
  else {
    purpose = claim(`Purpose not stated in a README or manifest.`, 'unknown');
    uncertainties.push('The repository does not describe its own purpose; the video will describe structure only.');
  }
  const commands = readme ? readmeCommands(readme) : [];
  const usageCommands = commands.map((c) => ({ command: c.command, evidence: ev(readme!.path, c.line) }));
  const setup = commands
    .filter((c) => /\b(install|add|get|clone|build|setup)\b/.test(c.command))
    .slice(0, 4)
    .map((c) => claim(`Install or set up with: ${c.command}`, 'verified', [ev(readme!.path, c.line)]));
  const hasBin = manifests.some((m) => m.bin.length || Object.keys(m.scripts).length && m.type === 'python') || entryPoints.some((e) => /(^|\/)(cli|bin|__main__)|^cmd\//.test(e.path) || /main function/.test(e.reason));
  const isLibrary = manifests.some((m) => m.main.length) || files.some((f) => f.path === 'src/lib.rs');
  const hasServer = [...seenFw].some((f) => /Express|Fastify|Koa|Hono|NestJS|Django|Flask|FastAPI|Gin|Echo|Fiber|Actix|Axum|Rocket|Rails|Sinatra|Laravel|Spring/.test(f));
  const hasUi = [...seenFw].some((f) => /React|Vue|Svelte|Angular|Solid|Next|Nuxt/.test(f));
  const audience = claim(
    hasServer ? 'Developers building web services or APIs'
      : hasUi ? 'Front-end developers building user interfaces'
      : hasBin ? 'Developers who work from the command line'
      : isLibrary ? `Developers who want a ready-made ${languages[0]?.name ?? ''} library for this job`.replace('  ', ' ')
      : `Developers working with ${languages[0]?.name ?? 'this stack'}`,
    'interpretation',
  );

  /* license, strengths, weaknesses (each rule cites what it is based on) */
  const license = detectLicense(files, manifests);
  const strengths: Claim[] = [];
  const weaknesses: Claim[] = [];
  const runtimeDeps = manifests.flatMap((m) => m.dependencies);
  if (tests.length) strengths.push(claim(`Ships ${tests.length} test file${tests.length > 1 ? 's' : ''}, for example ${tests[0].path}`, 'verified', [ev(tests[0].path, 1)]));
  else weaknesses.push(claim('No test files were found in this snapshot', 'verified'));
  if (manifests.length && runtimeDeps.length <= 3)
    strengths.push(claim(`Small dependency footprint: ${runtimeDeps.length} runtime dependenc${runtimeDeps.length === 1 ? 'y' : 'ies'}`, 'verified', [ev(manifests[0].path, 1)]));
  if (runtimeDeps.length > 30) weaknesses.push(claim(`Large dependency tree: ${runtimeDeps.length} runtime dependencies`, 'verified', [ev(manifests[0].path, 1)]));
  const typed = files.some((f) => f.path.endsWith('.d.ts')) || languages[0]?.name === 'TypeScript';
  if (typed) strengths.push(claim('Ships TypeScript types', 'verified', [ev((files.find((f) => f.path.endsWith('.d.ts')) ?? source.find((f) => f.language === 'TypeScript'))!.path, 1)]));
  const ci = files.find((f) => f.path.startsWith('.github/workflows/'));
  if (ci) strengths.push(claim('Has continuous integration configured', 'verified', [ev(ci.path, 1)]));
  if (readme && readme.lines > 80) strengths.push(claim(`Detailed README of about ${readme.lines} lines`, 'verified', [ev(readme.path, 1, readme.lines)]));
  if (!readme) weaknesses.push(claim('No README found', 'verified'));
  else if (readme.lines < 15) weaknesses.push(claim('The README is very short', 'verified', [ev(readme.path, 1, readme.lines)]));
  if (license.warning && !license.spdx) weaknesses.push(claim('No recognized open-source license', 'verified'));
  const longest = [...source].sort((a, b) => b.lines - a.lines)[0];
  if (longest && longest.lines > 800) weaknesses.push(claim(`Some files are long, for example ${longest.path} at ${longest.lines} lines`, 'verified', [ev(longest.path, 1, longest.lines)]));
  if (docs.length > 3) strengths.push(claim(`Includes ${docs.length} documentation files`, 'verified', [ev(docs[0].path, 1)]));

  const sourceLines = source.reduce((a, f) => a + f.lines, 0);
  const size: RepoAnalysis['size'] = sourceLines < 600 ? 'tiny' : sourceLines < 5000 ? 'small' : sourceLines < 50000 ? 'medium' : 'large';
  if (inv.skipped.some((s) => /limit/.test(s.reason))) uncertainties.push('Some files were skipped because of size limits; the analysis may be incomplete.');
  uncertainties.push('Repository code was not executed; behavior is described from source text only, and tests were not run.');

  /* knowledge base: README/docs + ranked source + manifests */
  const chunks: Omit<Chunk, 'id'>[] = [];
  const keySet = new Set(keyFiles.map((k) => k.path));
  const ordered = [
    ...(readme ? [readme] : []),
    ...docs.filter((d) => d !== readme).slice(0, 25),
    ...files.filter((f) => f.category === 'manifest' || f.category === 'license').slice(0, 10),
    ...keyFiles.map((k) => byPath.get(k.path)!),
    ...source.filter((f) => !keySet.has(f.path)).slice(0, 120),
    ...tests.slice(0, 15),
  ];
  for (const f of ordered) {
    const kind: Chunk['kind'] = f.category === 'doc' ? 'doc' : f.category === 'source' || f.category === 'test' ? 'code' : 'config';
    const input = { sourceId: SRC, path: f.path, text: f.text, kind };
    chunks.push(...(f.language === 'Markdown' ? chunkMarkdown(input) : chunkCode(input)));
  }
  const repoMeta = [
    `Repository ${repo.owner}/${repo.name} at commit ${repo.commitSha.slice(0, 12)}.`,
    `Languages: ${languages.map((l) => `${l.name} (${l.files} files, ${l.lines} lines)`).join(', ') || 'none detected'}.`,
    `Source files: ${source.length}. Test files: ${tests.length}. Documentation files: ${docs.length}.`,
    `Frameworks and libraries: ${frameworks.map((f) => f.text).join(', ') || 'none recognized'}.`,
    `License: ${license.spdx ?? 'not recognized'}.`,
  ].join('\n');
  chunks.push({ sourceId: SRC, path: '(repository facts)', startLine: 1, endLine: 5, kind: 'meta', text: repoMeta });

  const analysis: RepoAnalysis = {
    kind: 'repo',
    title: manifests.find((m) => m.name)?.name ?? repo.name,
    repo: { owner: repo.owner, name: repo.name, url: repo.url, ref: repo.ref, commitSha: repo.commitSha },
    size,
    purpose,
    audience,
    languages,
    frameworks,
    manifests,
    entryPoints,
    modules,
    importGraph,
    keyFiles,
    setup,
    usageCommands,
    tests: { files: tests.map((t) => t.path).slice(0, 50), frameworks: frameworks.filter((f) => /Jest|Vitest|Mocha|AVA|pytest/.test(f.text)).map((f) => f.text), executed: false },
    license,
    strengths,
    weaknesses,
    uncertainties,
    stats: {
      files: files.length,
      lines: files.reduce((a, f) => a + f.lines, 0),
      bytes: inv.totalBytes,
      sourceFiles: source.length,
      testFiles: tests.length,
      docFiles: docs.length,
      skippedFiles: inv.skipped.length,
    },
    fileTree: files.filter((f) => f.category !== 'other').map((f) => f.path).slice(0, 400),
  };
  return {
    analysis,
    knowledge: {
      sources: [{ id: SRC, kind: 'repo', title: `${repo.owner}/${repo.name}`, url: repo.url, license: license.spdx, attribution: `${repo.owner}/${repo.name} by ${repo.owner}` }],
      chunks: assignIds(chunks),
    },
  };
}
