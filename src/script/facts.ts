import type { Analysis, Chunk, Claim } from '../core/schemas.js';

/**
 * Turns the verified/interpretation claims of an analysis into knowledge-base chunks.
 * They were computed deterministically from the repository, so narration built on them can be verified
 * the same way as narration built on source text.
 */
export function factChunks(analysis: Analysis, startId: number): Chunk[] {
  const groups: [string, Claim[]][] = [];
  if (analysis.kind === 'repo') {
    const a = analysis;
    groups.push(['purpose', [a.purpose, a.audience]]);
    groups.push(['frameworks', a.frameworks]);
    groups.push(['strengths', a.strengths]);
    groups.push(['weaknesses', a.weaknesses]);
    groups.push(['setup', a.setup]);
    groups.push(['modules', a.modules.map((m) => ({ ...m.responsibility, text: `${m.path}: ${m.responsibility.text}. Imported by ${m.fanIn} files; imports ${m.fanOut} internal modules.` }))]);
    groups.push(['key files', a.keyFiles.slice(0, 8).filter((k) => k.reasons.length).map((k) => ({ text: `${k.path} is ${k.reasons.join(', ')}.`, status: 'verified' as const, evidence: [] }))]);
    groups.push(['entry points', a.entryPoints.map((e) => ({ text: `${e.path} is an entry point (${e.reason}).`, status: 'verified' as const, evidence: e.evidence }))]);
    groups.push([
      'statistics',
      [
        {
          text:
            `The repository has ${a.stats.files} readable files, ${a.stats.sourceFiles} source files, ${a.stats.testFiles} test files and ${a.stats.docFiles} documentation files, ` +
            `with ${a.stats.lines} lines in total. Main languages: ${a.languages.slice(0, 3).map((l) => `${l.name} with ${l.files} files`).join(', ')}. ` +
            `License: ${a.license.spdx ?? 'not recognized'}. Tests were not executed.`,
          status: 'verified',
          evidence: [],
        },
      ],
    ]);
  } else {
    const a = analysis;
    groups.push(['summary', [a.summary]]);
    groups.push(['key terms', [{ text: `Key terms: ${a.keyTerms.join(', ')}.`, status: 'verified', evidence: [] }]]);
  }
  const out: Chunk[] = [];
  for (const [name, claims] of groups) {
    const usable = claims.filter((c) => c.status === 'verified' || c.status === 'interpretation');
    if (!usable.length) continue;
    out.push({
      id: `f${startId + out.length}`,
      sourceId: 'analysis',
      path: `(analysis: ${name})`,
      startLine: 1,
      endLine: usable.length,
      kind: 'meta',
      text: usable.map((c) => c.text).join('\n'),
    });
  }
  return out;
}
