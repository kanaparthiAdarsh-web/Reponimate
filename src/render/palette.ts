import crypto from 'node:crypto';
import type { Analysis, Mode, Palette } from '../core/schemas.js';

import { LANGUAGE_COLORS, PALETTES } from './palette-data.js';

export { LANGUAGE_COLORS, PALETTES };

const RULES: [RegExp, keyof typeof PALETTES][] = [
  [/\b(llm|gpt|openai|anthropic|langchain|transformers?|torch|pytorch|tensorflow|jax|diffusion|neural|machine learning|deep learning|embedding|rag|agent|ai)\b/i, 'plum'],
  [/\b(security|crypto|cryptograph\w*|auth\w*|encrypt\w*|vulnerab\w*|pentest|firewall|tls|oauth|password)\b/i, 'moss'],
  [/\b(kubernetes|docker|terraform|cloud|devops|infra\w*|deploy\w*|cluster|serverless|ansible|helm|grpc|network\w*)\b/i, 'fjord'],
  [/\b(pandas|numpy|scikit|data ?science|dataset|analytics|jupyter|statistic\w*|biology|plant|nature|ecology|climate|chemistry)\b/i, 'orchard'],
  [/\b(react|vue|svelte|angular|next\.?js|nuxt|tailwind|css|frontend|front-end|ui|design system|component)\b/i, 'studio'],
  [/\b(history|ancient|empire|war|century|medieval|civilization|archaeolog\w*|philosoph\w*)\b/i, 'parchment'],
  [/\b(space|galaxy|planet|star|black hole|universe|quantum|physics|astronom\w*|cosmos)\b/i, 'plum'],
];

const LANGUAGE_PALETTE: Record<string, keyof typeof PALETTES> = {
  Rust: 'ember', C: 'ember', 'C++': 'ember', Zig: 'ember', Go: 'fjord', Python: 'orchard', Julia: 'orchard', R: 'orchard',
  TypeScript: 'studio', JavaScript: 'studio', Vue: 'studio', Svelte: 'studio', Kotlin: 'dusk', Swift: 'dusk', Dart: 'dusk',
  Ruby: 'dusk', Elixir: 'plum', Haskell: 'plum', Java: 'parchment', Scala: 'parchment', PHP: 'slate', 'C#': 'slate', Shell: 'fjord',
};

/* ---- colour maths ---- */
function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function shiftHue(hex: string, deg: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + deg + 360) % 360, s, l);
}

/** Small, deterministic per-subject hue shift (−14°…+14°) so each repository gets its own variant. */
export function personalize(p: Palette, seed: string): Palette {
  const n = crypto.createHash('sha1').update(seed).digest()[0];
  const deg = (n % 29) - 14;
  return {
    ...p,
    name: `${p.name} ${deg >= 0 ? '+' : ''}${deg}°`,
    primary: shiftHue(p.primary, deg),
    secondary: shiftHue(p.secondary, -deg / 2),
    tertiary: shiftHue(p.tertiary, deg),
    bg: shiftHue(p.bg, deg / 2),
    bg2: shiftHue(p.bg2, deg / 2),
    panel: shiftHue(p.panel, deg / 2),
  };
}

/** Picks a palette from what the subject is about (domain keywords first, then main language, then mode). */
export function choosePalette(a: Analysis, mode: Mode): Palette {
  let text: string;
  let seed: string;
  let byLanguage: keyof typeof PALETTES | undefined;
  if (a.kind === 'repo') {
    text = [a.title, a.purpose.text, ...a.frameworks.map((f) => f.text), ...a.manifests.flatMap((m) => m.dependencies)].join(' ');
    seed = `${a.repo.owner}/${a.repo.name}`;
    byLanguage = LANGUAGE_PALETTE[a.languages[0]?.name ?? ''];
  } else {
    text = [a.title, a.summary.text, ...a.keyTerms].join(' ');
    seed = a.title;
  }
  const rule = RULES.find(([re]) => re.test(text));
  const base = rule?.[1] ?? byLanguage ?? (mode === 'doc-reel' ? 'dusk' : mode === 'doc-video' ? 'chalkboard' : 'slate');
  return personalize(PALETTES[base], seed);
}
