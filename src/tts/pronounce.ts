import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/config.js';

let dict: Record<string, string> | null = null;
function dictionary(): Record<string, string> {
  if (!dict) {
    const file = path.join(ROOT, 'config', 'pronunciations.json');
    dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }
  return dict!;
}

const EXT_WORDS: Record<string, string> = {
  js: 'J S', ts: 'T S', tsx: 'T S X', jsx: 'J S X', py: 'pie', rs: 'R S', go: 'go', md: 'markdown', json: 'jason',
  yml: 'yammel', yaml: 'yammel', toml: 'tom-ul', rb: 'ruby', sh: 'shell', css: 'C S S', html: 'H T M L', mjs: 'M J S',
};

/** Converts one written token into how it should be spoken. */
export function speakToken(tok: string): string {
  const d = dictionary();
  const m = tok.match(/^([("'`]*)(.*?)([)"'`.,!?;:]*)$/)!;
  const [, pre, core, post] = m;
  if (!core) return tok;
  if (d[core]) return pre + d[core] + post;
  let w = core.replace(/`/g, '');
  // file.ext and dotted identifiers
  if (/^[\w@/-]+\.[a-z0-9]{1,5}$/i.test(w) && !/^\d+\.\d+$/.test(w)) {
    const i = w.lastIndexOf('.');
    w = `${w.slice(0, i)} dot ${EXT_WORDS[w.slice(i + 1).toLowerCase()] ?? w.slice(i + 1)}`;
  }
  w = w
    .replace(/^@/, 'at ')
    .replace(/\//g, ' slash ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_+/g, ' ')
    .replace(/\(\)$/, '')
    .replace(/(\w)-(\w)/g, '$1 $2');
  return pre + w.split(' ').map((p) => d[p] ?? p).join(' ') + post;
}

export interface Spoken {
  text: string;
  /** For each written word, how many spoken words it became. Lets us map timings back to captions. */
  spans: number[];
  written: string[];
}

export function toSpoken(text: string): Spoken {
  const written = text.split(/\s+/).filter(Boolean);
  const parts = written.map(speakToken);
  return { text: parts.join(' '), spans: parts.map((p) => p.split(/\s+/).filter(Boolean).length), written };
}
