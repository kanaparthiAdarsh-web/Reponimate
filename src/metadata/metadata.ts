import fs from 'node:fs';
import path from 'node:path';
import type { Analysis, Metadata, Script, Timing } from '../core/schemas.js';

export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const cap = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const tagify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, '').trim();

interface SourceRef {
  id: string;
  title: string;
  url?: string;
  license?: string;
  attribution?: string;
  commit?: string;
}

/** Metadata is built from verified analysis facts and real timings, never from free-form model output. */
export function buildMetadata(o: { script: Script; analysis: Analysis; timing: Timing; sources: SourceRef[]; voice: { provider: string; voice: string; license: string } }): Metadata {
  const { script, analysis, timing } = o;
  const reel = script.mode === 'doc-reel';
  // Chapters: YouTube needs the first at 0:00 and at least 10 s per chapter.
  const chapters: Metadata['chapters'] = [];
  for (const s of timing.scenes) {
    const scene = script.scenes.find((x) => x.id === s.id)!;
    const last = chapters[chapters.length - 1];
    const lastStart = last ? timing.scenes.find((x) => fmtTime(x.startSec) === last.time)?.startSec ?? 0 : -Infinity;
    const remaining = timing.totalSec - s.startSec;
    if (!last || (s.startSec - lastStart >= 10 && remaining >= 10)) chapters.push({ time: fmtTime(s.startSec), title: scene.type === 'intro' || scene.type === 'hook' ? 'Intro' : scene.title });
  }
  if (chapters[0]) chapters[0].time = '0:00';

  let titles: string[];
  let summary: string;
  let tags: string[];
  let thumbnailText: string;
  let credit: string[];
  if (analysis.kind === 'repo') {
    const name = analysis.repo.name;
    const lang = analysis.languages[0]?.name ?? '';
    const purpose = analysis.purpose.status === 'verified' ? analysis.purpose.text : '';
    titles = [
      cap(`${name}: How This ${lang || 'Open-Source'} Project Works`, 70),
      cap(`Inside ${name} — A Code Walkthrough`, 70),
      cap(`${name} Explained in ${Math.max(1, Math.round(timing.totalSec / 60))} Minutes (Real Code)`, 70),
    ];
    summary = `A code-level tour of ${analysis.repo.owner}/${name}${purpose ? `: ${purpose}` : '.'} We read the real source, map the architecture, and weigh strengths and weaknesses.`;
    tags = [name, `${analysis.repo.owner} ${name}`, ...analysis.languages.slice(0, 3).map((l) => l.name), ...analysis.frameworks.slice(0, 4).map((f) => f.text.replace(/ \(.*\)$/, '')), 'open source', 'code walkthrough', 'github', 'software architecture', 'programming'];
    thumbnailText = cap(name.replace(/[-_]/g, ' ').toUpperCase(), 18).split(/\s+/).slice(0, 2).join(' ') + ' EXPLAINED';
    credit = [
      `Repository: ${analysis.repo.url}`,
      `Author: ${analysis.repo.owner} — all credit for the code goes to them.`,
      `License: ${analysis.license.spdx ?? 'not detected — all rights reserved by the author'}`,
      `Snapshot: commit ${analysis.repo.commitSha.slice(0, 12)}`,
    ];
  } else {
    titles = reel
      ? [cap(`${analysis.title} in 60 Seconds`, 70), cap(`${analysis.title} — Explained Fast`, 70), cap(`What Is ${analysis.title}?`, 70)]
      : [cap(`${analysis.title}, Explained Simply`, 70), cap(`What Is ${analysis.title}? A Visual Explainer`, 70), cap(`${analysis.title} in ${Math.max(1, Math.round(timing.totalSec / 60))} Minutes`, 70)];
    summary = `${analysis.summary.text}`;
    tags = [analysis.title, ...analysis.keyTerms.slice(0, 8), 'explained', 'animation', 'learn', reel ? 'shorts' : 'explainer'];
    thumbnailText = cap(analysis.title.toUpperCase(), 20).split(/\s+/).slice(0, 3).join(' ');
    credit = o.sources.map((s) => `Source: ${s.attribution ?? s.title}${s.url ? ` — ${s.url}` : ''}${s.license && !s.attribution ? ` (${s.license})` : ''}`);
  }
  tags = [...new Map(tags.map((t) => [tagify(t), tagify(t)])).values()].filter((t) => t.length > 1 && t.length <= 30).slice(0, 15);
  while (tags.length < 10) tags.push(['tutorial', 'explained', 'education', 'tech', 'learning', 'developer', 'how it works', 'animation', 'beginner', 'deep dive'][tags.length % 10]);
  tags = [...new Set(tags)].slice(0, 15);
  const hashtags = (reel ? ['#shorts', '#explained', '#learn'] : ['#opensource', '#programming', '#explained']).slice(0, 3);

  const description = [
    summary,
    '',
    ...(reel ? [] : ['Chapters:', ...chapters.map((c) => `${c.time} ${c.title}`), '']),
    ...credit,
    '',
    `Narration: synthetic voice (${o.voice.provider} / ${o.voice.voice}; ${o.voice.license}). This video was produced with AI-assisted tooling; every technical statement was checked against the source material.`,
    'Altered or synthetic content: the narrator voice is computer-generated.',
    '',
    hashtags.join(' '),
  ].join('\n');

  return {
    titles,
    description,
    chapters,
    tags,
    thumbnailText,
    thumbnailPrompt: `Bold YouTube thumbnail, dark navy background, cyan and orange accents, large text "${thumbnailText}", ${analysis.kind === 'repo' ? `a code window with ${analysis.languages[0]?.name ?? 'source'} code and a simple architecture diagram` : 'a friendly stick figure pointing at a whiteboard'}, high contrast, readable on phones.`,
    hashtags,
  };
}

export function writeMetadataFiles(dir: string, m: Metadata): void {
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(m, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'title.txt'), m.titles.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'description.txt'), m.description + '\n');
  fs.writeFileSync(path.join(dir, 'tags.txt'), m.tags.join(', ') + '\n');
  fs.writeFileSync(path.join(dir, 'thumbnail-prompt.txt'), m.thumbnailPrompt + '\n');
}
