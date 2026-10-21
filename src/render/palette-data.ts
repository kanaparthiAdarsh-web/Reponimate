import type { Palette } from '../core/schemas.js';

/**
 * Curated, muted palettes (no neon). Each one suits a kind of project; a repository-specific
 * hue shift then makes every video's colours its own.
 */
export const PALETTES: Record<string, Palette> = {
  ember: { name: 'Ember', bg: '#1B1714', bg2: '#241D18', panel: '#26201B', panelBorder: '#3A3029', codeBg: '#15110E', primary: '#E0895A', secondary: '#D9B26F', tertiary: '#8FA68E', text: '#F2EBE3', muted: '#A8998A', ink: '#1B1714', board: '#F6F0E6', boardInk: '#2B2118', success: '#9BB98A', danger: '#D9826B' },
  fjord: { name: 'Fjord', bg: '#111A1F', bg2: '#16232A', panel: '#182630', panelBorder: '#263A47', codeBg: '#0D151A', primary: '#7FB7BE', secondary: '#E3C08D', tertiary: '#B48EAD', text: '#E8EEF0', muted: '#8FA3AD', ink: '#0F181C', board: '#F2F4F1', boardInk: '#1C2A31', success: '#9CC5A1', danger: '#D99A8B' },
  orchard: { name: 'Orchard', bg: '#161A14', bg2: '#1D2219', panel: '#20261D', panelBorder: '#313A2C', codeBg: '#12150F', primary: '#A3C585', secondary: '#E7B76A', tertiary: '#C98B9B', text: '#EEF0E6', muted: '#9DA493', ink: '#151912', board: '#F7F5EA', boardInk: '#26301F', success: '#A3C585', danger: '#D98C7A' },
  plum: { name: 'Plum', bg: '#1A1520', bg2: '#211A29', panel: '#251D2D', panelBorder: '#3A2E45', codeBg: '#140F19', primary: '#C7A3E0', secondary: '#F2A98B', tertiary: '#9CC5B0', text: '#F1EAF5', muted: '#A596B0', ink: '#1A1520', board: '#F7F2F8', boardInk: '#2C2135', success: '#9CC5B0', danger: '#E79A9A' },
  studio: { name: 'Studio', bg: '#15171E', bg2: '#1B1E27', panel: '#1D2029', panelBorder: '#2E3240', codeBg: '#101218', primary: '#8AB4F8', secondary: '#F6BD8B', tertiary: '#9ED9C4', text: '#ECEEF4', muted: '#959BAD', ink: '#13151B', board: '#F5F6FA', boardInk: '#1F2533', success: '#9ED9C4', danger: '#F2A3A3' },
  moss: { name: 'Moss', bg: '#121815', bg2: '#17201B', panel: '#1A231E', panelBorder: '#2A372F', codeBg: '#0E1310', primary: '#7DBE9A', secondary: '#D8C48A', tertiary: '#9AAFD1', text: '#E8F0EA', muted: '#8FA396', ink: '#111713', board: '#F2F5EF', boardInk: '#1D2A22', success: '#7DBE9A', danger: '#D9907F' },
  chalkboard: { name: 'Chalkboard', bg: '#1E2A24', bg2: '#22312A', panel: '#26352D', panelBorder: '#36483D', codeBg: '#18221D', primary: '#F3E3B5', secondary: '#E8A598', tertiary: '#A7C7E7', text: '#F5F1E6', muted: '#AEB9AE', ink: '#1E2A24', board: '#FBF8EF', boardInk: '#24342B', success: '#B7D7A8', danger: '#E8A598' },
  dusk: { name: 'Dusk', bg: '#1C1623', bg2: '#241C2C', panel: '#271F30', panelBorder: '#3B2F47', codeBg: '#15101A', primary: '#F0A07C', secondary: '#F5D491', tertiary: '#8EC5C2', text: '#F6EEF0', muted: '#AE9EAF', ink: '#1C1623', board: '#FBF4EE', boardInk: '#2E2236', success: '#8EC5C2', danger: '#E58C8C' },
  parchment: { name: 'Parchment', bg: '#1F1A15', bg2: '#28211A', panel: '#2B241C', panelBorder: '#41372B', codeBg: '#17130F', primary: '#D7B98E', secondary: '#B9775C', tertiary: '#8FA3A0', text: '#F3EADC', muted: '#AA9C88', ink: '#1F1A15', board: '#F8F0E1', boardInk: '#3A2D20', success: '#A8B88C', danger: '#C9775E' },
  slate: { name: 'Slate', bg: '#16191D', bg2: '#1C2026', panel: '#1F242B', panelBorder: '#30363F', codeBg: '#111418', primary: '#9DB4C0', secondary: '#E2B07A', tertiary: '#B3A2C7', text: '#E9ECEF', muted: '#939BA5', ink: '#15181C', board: '#F4F5F6', boardInk: '#20262D', success: '#A6C4A0', danger: '#D99C8C' },
};

/** GitHub linguist colours: meaningful for language bars (viewers recognise them). */
export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178C6', JavaScript: '#F1E05A', Python: '#3572A5', Go: '#00ADD8', Rust: '#DEA584', Java: '#B07219',
  Kotlin: '#A97BFF', Ruby: '#701516', PHP: '#4F5D95', 'C#': '#178600', C: '#555555', 'C++': '#F34B7D', Swift: '#F05138',
  Scala: '#C22D40', Shell: '#89E051', Lua: '#000080', Dart: '#00B4AB', Elixir: '#6E4A7E', Haskell: '#5E5086', Vue: '#41B883',
  Svelte: '#FF3E00', R: '#198CE7', Julia: '#A270BA', Zig: '#EC915C', SQL: '#E38C00', CSS: '#663399', HTML: '#E34C26',
};

