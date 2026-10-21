export const theme = {
  bg: '#0B1426',
  bg2: '#0F1C33',
  panel: '#13233F',
  panelBorder: '#1F3558',
  cyan: '#22D3EE',
  orange: '#FB923C',
  green: '#4ADE80',
  red: '#F87171',
  text: '#E6EDF7',
  muted: '#8DA2C0',
  ink: '#0B1426',
  board: '#F8FAFC',
  font: 'Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  hand: '"Patrick Hand", "Comic Sans MS", cursive',
} as const;

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
