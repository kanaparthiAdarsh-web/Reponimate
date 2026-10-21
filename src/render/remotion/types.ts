import type { Script, Timing } from '../../core/schemas.js';

export interface CodeToken {
  content: string;
  color: string;
}

export interface VideoProps extends Record<string, unknown> {
  script: Script;
  timing: Timing;
  /** Pre-highlighted code (Shiki, computed in Node before rendering), keyed by scene id. */
  code: Record<string, CodeToken[][]>;
}
