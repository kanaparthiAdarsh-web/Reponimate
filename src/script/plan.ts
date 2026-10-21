import path from 'node:path';
import type { DocAnalysis, Evidence, Pose, Prop, RepoAnalysis, SceneType, Visual } from '../core/schemas.js';
import type { RepoFile } from '../repo/inventory.js';
import { pickExcerpt } from './code-excerpt.js';

export interface ScenePlan {
  id: string;
  type: SceneType;
  title: string;
  /** Retrieval query used to pull evidence chunks for this scene. */
  query: string;
  /** What the scene must cover, given to the writer. */
  brief: string;
  /** Deterministic narration assembled only from verified facts; used without an LLM or as a fallback. */
  extractive: string;
  visual: Visual;
  visualDescription: string;
  evidence: Evidence[];
  targetWords: number;
  transition: 'fade' | 'slide' | 'wipe' | 'zoom' | 'none';
  emphasis: string[];
  /** Statements about what is on screen (line numbers, labels, disclaimers); valid only for this scene. */
  sceneFacts?: string[];
}

const sentence = (s: string): string => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? (/[.!?]$/.test(t) ? t : t + '.') : '';
};
const list = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const short = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

/** Turns "Slugify a string. Useful for…" into a viewer question when the purpose starts with a verb. */
function hookQuestion(purpose: string, name: string): string {
  const first = purpose.split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '');
  const verb = /^(Create|Build|Make|Turn|Convert|Generate|Parse|Run|Manage|Find|Get|Render|Deploy|Test|Track|Format|Write|Read|Send|Store|Search|Sync|Validate|Compile|Bundle|Serve|Slugify|Transform|Translate|Detect|Download|Upload|Monitor|Automate|Visualize|Analy[sz]e|Edit|Lint|Check)\b/;
  if (verb.test(first) && first.split(' ').length <= 14) return `Ever needed to ${first.charAt(0).toLowerCase() + first.slice(1)}?`;
  return `What does ${name} actually do, and why would you want it?`;
}

/** One-line open loops that pull the viewer into the next scene. They contain no claims about the subject. */
const TEASERS: Partial<Record<SceneType, string[]>> = {
  problem: ['So how big is this project, really?'],
  stats: ['But how do the pieces fit together?'],
  architecture: ["Now let's open the code that does the real work."],
  code: ["Here's where it gets interesting.", "And there's one more piece of the puzzle."],
  terminal: ["Before you install it, though, let's be honest about the trade-offs."],
  'pros-cons': ['So, should you use it?'],
};

function withTeasers(plans: ScenePlan[]): ScenePlan[] {
  return plans.map((p, i) => {
    const next = plans[i + 1];
    if (!next || p.type === 'outro' || p.type === 'conclusion') return p;
    let line: string | undefined;
    if (p.type === 'code' && next.type === 'code') line = TEASERS.code![1];
    else if (p.type === 'code' && next.type !== 'code') line = next.type === 'terminal' ? 'So how do you actually use it?' : 'So, should you use it?';
    else if (p.type === 'intro') line = 'Stick around, because the clever part is inside the code.';
    else line = TEASERS[p.type]?.[0];
    if (p.type === 'problem' && next.type !== 'stats') line = undefined;
    return line ? { ...p, extractive: `${p.extractive} ${line}` } : p;
  });
}

/* -------------------- Repository → long video -------------------- */

export function planRepoVideo(a: RepoAnalysis, getFile: (p: string) => RepoFile | undefined): ScenePlan[] {
  const name = a.repo.name;
  const plans: ScenePlan[] = [];
  let n = 0;
  const add = (p: Omit<ScenePlan, 'id'>): void => {
    plans.push({ ...p, id: `s${String(++n).padStart(2, '0')}` });
  };
  const purpose = a.purpose.status === 'verified' ? a.purpose.text : '';
  const langs = a.languages.slice(0, 3).map((l) => l.name);

  add({
    type: 'intro',
    title: name,
    query: `${name} purpose overview what is`,
    brief: `Hook the viewer in the first sentence with the concrete problem ${name} solves, then say what it is in one line. Promise a code-level tour.`,
    extractive: [
      purpose ? hookQuestion(purpose, name) : '',
      purpose ? `Meet ${name}. ${sentence(purpose)}` : `Meet ${name}, a ${langs[0] ?? ''} project by ${a.repo.owner}.`,
      `We'll read its real source code, see how the pieces fit together, and weigh its strengths and weaknesses.`,
    ].join(' '),
    visual: { headline: name, subhead: short(purpose || `${a.repo.owner}/${name}`, 90) },
    visualDescription: 'Animated title card with the repository name and one-line purpose.',
    evidence: a.purpose.evidence,
    targetWords: 70,
    transition: 'zoom',
    emphasis: [name],
  });

  const runtimeFw = a.frameworks.filter((f) => !f.text.includes('development dependency')).map((f) => f.text);
  const readmeChunksQuery = `${name} why problem features motivation`;
  add({
    type: 'problem',
    title: 'What problem does it solve?',
    query: readmeChunksQuery,
    brief: `Explain the problem or need ${name} addresses, using only the README and docs. Mention who it is for.`,
    extractive: [
      purpose ? sentence(`The README describes it like this: ${purpose}`) : '',
      a.audience.text ? sentence(`It looks aimed at ${a.audience.text.charAt(0).toLowerCase() + a.audience.text.slice(1)}`) : '',
      runtimeFw.length ? sentence(`It builds on ${list(runtimeFw.slice(0, 4))}`) : '',
    ].join(' '),
    visual: {
      headline: 'The problem',
      presenter: {
        pose: 'confused',
        poses: ['confused', 'think', 'explain'],
        prop: 'bulb',
        board: [purpose ? short(purpose, 70) : 'Purpose not documented', a.audience.text, ...runtimeFw.slice(0, 1)].filter(Boolean).slice(0, 3),
      },
    },
    visualDescription: 'The host looks puzzled, gets an idea (light bulb) and writes the problem, audience and stack on a whiteboard.',
    evidence: [...a.purpose.evidence, ...a.frameworks.flatMap((f) => f.evidence)].slice(0, 4),
    targetWords: 110,
    transition: 'slide',
    emphasis: ['problem'],
  });

  add({
    type: 'stats',
    title: 'The project at a glance',
    query: `${name} languages files structure`,
    brief: 'Give a quick sense of size and shape: languages, number of source files, tests and docs. Use only the statistics provided.',
    extractive: [
      `At this commit the repository has ${plural(a.stats.sourceFiles, 'source file')} and ${plural(a.stats.testFiles, 'test file')}.`,
      langs.length ? `The main language${langs.length > 1 ? 's are' : ' is'} ${list(langs)}.` : '',
      a.license.spdx ? `It is released under the ${a.license.spdx} license.` : `No standard license was detected, so all rights stay with the author.`,
    ].join(' '),
    visual: {
      headline: 'At a glance',
      stats: [
        { label: 'Source files', value: a.stats.sourceFiles },
        { label: 'Test files', value: a.stats.testFiles },
        { label: 'Lines of text', value: a.stats.lines },
        { label: 'Languages', value: a.languages.length },
      ],
      bars: a.languages.slice(0, 4).map((l) => ({ label: l.name, value: l.lines })),
      files: a.fileTree.slice(0, 14),
    },
    visualDescription: 'Counters animate up, language bars grow, and a file tree unfolds.',
    evidence: [],
    targetWords: 80,
    transition: 'fade',
    emphasis: langs,
  });

  if (a.importGraph.nodes.length >= 2) {
    const main = a.modules.slice(0, 4);
    add({
      type: 'architecture',
      title: 'How it is organized',
      query: `${main.map((m) => m.path).join(' ')} architecture modules structure`,
      brief: `Walk through the main modules and how they depend on each other: ${main.map((m) => m.path).join(', ')}. Use the module descriptions and import relations only.`,
      extractive: main
        .map((m) => (m.responsibility.status === 'verified' ? sentence(`${m.path}: ${m.responsibility.text}`) : ''))
        .concat(main[0] && main[0].fanIn ? [`${main[0].path} is imported by ${main[0].fanIn} other file${main[0].fanIn > 1 ? 's' : ''}.`] : [])
        .join(' '),
      visual: { headline: 'Architecture', graph: a.importGraph, host: { poses: ['point', 'explain', 'think'], prop: 'gear' } },
      visualDescription: 'Architecture diagram from the static import graph: nodes pop in, edges draw, data packets flow along them and nodes pulse when named; the host points at it.',
      evidence: main.flatMap((m) => m.responsibility.evidence).slice(0, 6),
      targetWords: 150,
      transition: 'wipe',
      emphasis: main.map((m) => path.posix.basename(m.path)),
    });
  }

  const codeScenes = { tiny: 2, small: 3, medium: 4, large: 5 }[a.size];
  const seen = new Set<string>();
  for (const k of a.keyFiles) {
    if (seen.size >= codeScenes) break;
    const f = getFile(k.path);
    if (!f || f.lines < 4 || f.path.endsWith('.d.ts')) continue;
    seen.add(k.path);
    const { visual, symbol } = pickExcerpt(f);
    const mod = a.modules.find((m) => m.path === k.path);
    add({
      type: 'code',
      title: symbol ? `${symbol}()` : path.posix.basename(k.path),
      query: `${k.path} ${symbol ?? ''}`,
      brief: `Explain what this excerpt from ${k.path} (lines ${visual.startLine}-${visual.endLine}) does, line by line where it matters. Only describe what the code visibly does.`,
      extractive: [
        `Let's open ${k.path}.`,
        mod && mod.responsibility.status === 'verified' ? sentence(mod.responsibility.text.replace(/^Defines /, 'It defines ')) : '',
        symbol ? `On screen is ${symbol}, from line ${visual.startLine} to ${visual.endLine}.` : `On screen are lines ${visual.startLine} to ${visual.endLine}.`,
        k.reasons.length ? sentence(`This file matters because it is ${list(k.reasons.slice(0, 2))}`) : '',
      ].join(' '),
      visual: { headline: k.path, code: visual, host: { poses: ['point', 'think', 'explain'], prop: 'magnifier' } },
      visualDescription: `Code panel with a genuine excerpt from ${k.path}; the camera glides to each highlighted line as it is discussed while the host inspects it with a magnifier.`,
      evidence: [{ sourceId: 'repo', path: k.path, startLine: visual.startLine, endLine: visual.endLine }],
      targetWords: 160,
      transition: 'slide',
      emphasis: symbol ? [symbol] : [],
      sceneFacts: [
        `On screen: ${symbol ? `${symbol}, ` : ''}lines ${visual.startLine} to ${visual.endLine} of ${k.path}.`,
        `${k.path} matters because it is ${list(k.reasons.slice(0, 2))}.`,
      ],
    });
  }

  if (a.usageCommands.length) {
    const cmds = a.usageCommands.slice(0, 5);
    add({
      type: 'terminal',
      title: 'Using it',
      query: `${name} usage install example ${cmds.map((c) => c.command).join(' ')}`,
      brief: 'Explain how someone installs and uses it, based only on the README commands shown. Say clearly these come from the README and were not run for this video.',
      extractive: [
        `According to the README, you get started with ${cmds[0].command}.`,
        cmds[1] ? `It also shows ${cmds[1].command}.` : '',
        `These commands come from the documentation; we did not run them for this video.`,
      ].join(' '),
      visual: {
        headline: 'Code walkthrough: usage from the README',
        terminal: { label: 'From README (not executed)', lines: cmds.map((c) => ({ kind: 'cmd' as const, text: c.command })) },
        host: { poses: ['present', 'explain'], prop: 'laptop' },
      },
      visualDescription: 'Terminal-styled panel typing the README commands, labelled as not executed.',
      evidence: cmds.map((c) => c.evidence),
      targetWords: 90,
      transition: 'fade',
      emphasis: [],
      sceneFacts: ['These commands come from the README documentation. We did not run them for this video; no output is shown.'],
    });
  }

  if (a.strengths.length || a.weaknesses.length) {
    add({
      type: 'pros-cons',
      title: 'Strengths and weaknesses',
      query: `${name} tests dependencies documentation license limitations`,
      brief: 'Give an honest, balanced assessment using only the listed strengths and weaknesses. Explain why each one matters to a user.',
      extractive: [
        a.strengths.length ? `On the plus side: ${list(a.strengths.slice(0, 3).map((s) => s.text.charAt(0).toLowerCase() + s.text.slice(1)))}.` : '',
        a.weaknesses.length ? `On the other hand: ${list(a.weaknesses.slice(0, 3).map((s) => s.text.charAt(0).toLowerCase() + s.text.slice(1)))}.` : '',
      ].join(' '),
      visual: {
        headline: 'Pros & cons',
        pros: a.strengths.slice(0, 4).map((s) => short(s.text, 60)),
        cons: a.weaknesses.slice(0, 4).map((s) => short(s.text, 60)),
        host: { poses: ['think', 'present', 'explain'] },
      },
      visualDescription: 'Two columns, pros in cyan and cons in orange, revealed item by item.',
      evidence: [...a.strengths, ...a.weaknesses].flatMap((c) => c.evidence).slice(0, 6),
      targetWords: 140,
      transition: 'wipe',
      emphasis: ['strengths', 'weaknesses'],
    });
  }

  add({
    type: 'conclusion',
    title: 'Should you use it?',
    query: `${name} purpose audience`,
    brief: `Summarize who should use ${name} and when, and restate the main limitation. No new facts.`,
    extractive: [
      purpose ? sentence(`To sum up, ${name} is for this job: ${purpose.charAt(0).toLowerCase() + purpose.slice(1)}`) : `To sum up, that is how ${name} is put together.`,
      a.audience.text ? sentence(`It is a good fit for ${a.audience.text.charAt(0).toLowerCase() + a.audience.text.slice(1)}`) : '',
      a.weaknesses[0] ? sentence(`Keep in mind: ${a.weaknesses[0].text.charAt(0).toLowerCase() + a.weaknesses[0].text.slice(1)}`) : '',
    ].join(' '),
    visual: {
      headline: 'Verdict',
      presenter: { pose: 'present', poses: ['present', 'explain', 'point'], prop: 'bulb', board: [a.audience.text, ...(a.weaknesses[0] ? [`Watch out: ${short(a.weaknesses[0].text, 50)}`] : [])] },
    },
    visualDescription: 'The host presents the verdict on a whiteboard: who it is for and the main caveat.',
    evidence: a.purpose.evidence,
    targetWords: 90,
    transition: 'fade',
    emphasis: [name],
  });

  add({
    type: 'outro',
    title: 'Thanks for watching',
    query: `${name} license author`,
    brief: 'Credit the author, mention the license, point to the link in the description, and ask viewers one question.',
    extractive: [
      `${name} is written by ${a.repo.owner}${a.license.spdx ? ` and released under the ${a.license.spdx} license` : ''}.`,
      `The link to the repository is in the description.`,
      `Would you use it in your next project? Tell me in the comments.`,
    ].join(' '),
    visual: { headline: `github.com/${a.repo.owner}/${name}`, subhead: `Credit: ${a.repo.owner}${a.license.spdx ? ` · ${a.license.spdx}` : ''}` },
    visualDescription: 'Outro with the repository link and author credit.',
    evidence: [],
    targetWords: 45,
    transition: 'fade',
    emphasis: [a.repo.owner],
  });
  return withTeasers(plans);
}

/* -------------------- Description → explainer video / reel -------------------- */

const POSES: Pose[] = ['explain', 'point', 'think', 'present'];
const PROPS: Prop[] = ['bulb', 'gear', 'magnifier', 'laptop'];

export function planDocVideo(a: DocAnalysis): ScenePlan[] {
  const plans: ScenePlan[] = [];
  let n = 0;
  const add = (p: Omit<ScenePlan, 'id'>): void => {
    plans.push({ ...p, id: `s${String(++n).padStart(2, '0')}` });
  };
  const sections = a.sections.filter((s) => s.keyPoints.length).slice(0, 8);
  add({
    type: 'hook',
    title: a.title,
    query: `${a.title} ${a.summary.text}`,
    brief: `Open with a curiosity hook about ${a.title}, then state in one sentence what it is.`,
    extractive: `What is ${a.title}, and why should you care? ${sentence(a.summary.text)} Let's break it down, one piece at a time.`,
    visual: { headline: a.title, presenter: { pose: 'wave', poses: ['wave', 'confused', 'think'], prop: 'bulb', board: [], speech: 'Let me explain!' } },
    visualDescription: 'The presenter waves next to the title.',
    evidence: a.summary.evidence,
    targetWords: 55,
    transition: 'zoom',
    emphasis: [a.title],
  });
  sections.forEach((sec, i) => {
    const points = sec.keyPoints.slice(0, 3);
    const withBoard = i % 2 === 0;
    add({
      type: withBoard ? 'presenter' : 'bullets',
      title: sec.heading,
      query: `${sec.heading} ${points.map((p) => p.text).join(' ')}`,
      brief: `Explain "${sec.heading}" simply, as a teacher would, using only the provided material. Use one everyday comparison only if it does not add facts.`,
      extractive: [i === 0 ? `First up: ${sec.heading}.` : i === sections.length - 1 ? `Finally: ${sec.heading}.` : `Next: ${sec.heading}.`, ...points.map((p) => sentence(p.text))].join(' ') + (i < sections.length - 1 && i % 2 === 1 ? " But that's only part of the story." : ''),
      visual: withBoard
        ? {
            headline: sec.heading,
            presenter: {
              pose: POSES[i % POSES.length],
              poses: [POSES[i % POSES.length], 'point', 'explain', 'think'],
              prop: PROPS[i % PROPS.length],
              board: points.map((p) => short(p.text, 60)),
              second: i % 4 === 2 ? 'confused' : undefined,
            },
          }
        : { headline: sec.heading, bullets: points.map((p) => short(p.text, 70)), host: { poses: ['point', 'explain', 'present'], prop: PROPS[(i + 1) % PROPS.length] } },
      visualDescription: withBoard ? 'The presenter teaches at a whiteboard that fills with key points.' : 'Key points revealed one by one with icons.',
      evidence: points.flatMap((p) => p.evidence),
      targetWords: 120,
      transition: i % 2 ? 'slide' : 'wipe',
      emphasis: sec.heading.split(/\s+/).filter((w) => w.length > 4).slice(0, 2),
    });
  });
  if (a.numbers.length >= 2) {
    add({
      type: 'definition',
      title: 'By the numbers',
      query: a.numbers.map((x) => x.text).join(' '),
      brief: 'Present the key numbers and dates exactly as written in the material.',
      extractive: a.numbers.slice(0, 3).map((x) => sentence(x.text)).join(' '),
      visual: { headline: 'By the numbers', bullets: a.numbers.slice(0, 3).map((x) => short(x.text, 70)) },
      visualDescription: 'Numbers and dates highlighted in large type.',
      evidence: a.numbers.slice(0, 3).flatMap((x) => x.evidence),
      targetWords: 80,
      transition: 'fade',
      emphasis: [],
    });
  }
  add({
    type: 'conclusion',
    title: 'Recap',
    query: `${a.title} summary ${sections.map((s) => s.heading).join(' ')}`,
    brief: 'Recap the main ideas in order. No new facts.',
    extractive: `Let's recap. ${sentence(a.summary.text)} We covered ${list(sections.slice(0, 5).map((s) => s.heading))}.`,
    visual: { headline: 'Recap', presenter: { pose: 'present', poses: ['present', 'point', 'explain'], prop: 'rocket', board: sections.slice(0, 5).map((s) => short(s.heading, 40)) } },
    visualDescription: 'The presenter presents a recap board listing the sections.',
    evidence: a.summary.evidence,
    targetWords: 80,
    transition: 'fade',
    emphasis: [],
  });
  add({
    type: 'outro',
    title: 'Thanks for watching',
    query: a.title,
    brief: 'Thank the viewer, point to the sources in the description, ask one question.',
    extractive: `That's ${a.title} in a nutshell. The sources are linked in the description. What should I explain next? Tell me in the comments.`,
    visual: { headline: 'Thanks for watching!', presenter: { pose: 'celebrate', poses: ['celebrate', 'wave'], prop: 'rocket', board: [] } },
    visualDescription: 'The presenter celebrates with confetti.',
    evidence: [],
    targetWords: 35,
    transition: 'fade',
    emphasis: [],
  });
  return plans;
}

/** 9:16 short: hook, three punchy points, payoff. Targets 35-55 seconds of speech. */
export function planDocReel(a: DocAnalysis): ScenePlan[] {
  const points = a.sections
    .flatMap((s) => s.keyPoints.filter((k) => k.text !== a.summary.text).slice(0, 1).map((k) => ({ heading: s.heading, k })))
    .slice(0, 3);
  const plans: ScenePlan[] = [
    {
      id: 's01',
      type: 'hook',
      title: a.title,
      query: `${a.title} ${a.summary.text}`,
      brief: `One punchy hook sentence (max 14 words) about ${a.title} that makes people keep watching, then one sentence saying what it is.`,
      extractive: `${a.title}, explained in under a minute. ${sentence(a.summary.text)} Here's how it works.`,
      visual: { headline: a.title, presenter: { pose: 'confused', poses: ['confused', 'think'], prop: 'bulb', board: [], speech: '?!' } },
      visualDescription: 'Big title, confused presenter.',
      evidence: a.summary.evidence,
      targetWords: 30,
      transition: 'zoom',
      emphasis: [a.title],
    },
    ...points.map((p, i): ScenePlan => ({
      id: `s0${i + 2}`,
      type: 'presenter',
      title: p.heading,
      query: `${p.heading} ${p.k.text}`,
      brief: `One or two short sentences explaining "${p.heading}". Max 30 words. Only facts from the material.`,
      extractive: sentence(p.k.text),
      visual: { headline: `${i + 1}. ${short(p.heading, 28)}`, presenter: { pose: POSES[i % POSES.length], poses: [POSES[i % POSES.length], 'point', 'explain'], prop: PROPS[i % PROPS.length], board: [short(p.k.text, 110)] } },
      visualDescription: 'The presenter with a board showing the point.',
      evidence: p.k.evidence,
      targetWords: 28,
      transition: 'slide',
      emphasis: [],
    })),
    {
      id: `s0${points.length + 2}`,
      type: 'outro',
      title: 'Follow for more',
      query: a.title,
      brief: 'One sentence payoff and a call to follow. No new facts.',
      extractive: `That's ${a.title} in a nutshell. Follow for more quick explainers.`,
      visual: { headline: 'Follow for more!', presenter: { pose: 'celebrate', poses: ['celebrate', 'wave'], prop: 'rocket', board: [] } },
      visualDescription: 'Celebrating presenter and follow prompt.',
      evidence: [],
      targetWords: 18,
      transition: 'fade',
      emphasis: [],
    },
  ];
  return plans;
}
