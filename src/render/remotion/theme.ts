import type { Palette } from '../../core/schemas.js';
import { PALETTES } from '../palette-data';

/**
 * Active theme. Colours come from the script's palette (chosen per repository/topic) and are applied
 * once per frame by <Explainer> before any component reads them.
 */
export const theme = {
  ...PALETTES.slate,
  font: 'Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  hand: '"Patrick Hand", "Comic Sans MS", cursive',
  /** Which presenter appearance this video uses (see LOOKS in Presenter.tsx). */
  look: 0,
  presenter: '3d' as '2d' | '3d',
  /** File name of an installed rigged character (models/character/*.glb); empty = built-in toon boy. */
  characterModel: '' as string,
};

export function applyPalette(p: Palette | undefined, seed = ''): void {
  Object.assign(theme, p ?? PALETTES.slate);
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  theme.look = h % 5;
}

/** "#RRGGBB" + alpha → rgba() string. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export interface Layout {
  width: number;
  height: number;
  portrait: boolean;
  /** Base font size; everything scales from this so text stays readable on phones. */
  unit: number;
  pad: number;
}

export function layoutFor(width: number, height: number): Layout {
  const portrait = height > width;
  return { width, height, portrait, unit: portrait ? 44 : 40, pad: portrait ? 70 : 110 };
}
