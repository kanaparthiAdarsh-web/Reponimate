import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { WordTiming } from '../../../core/schemas.js';
import { theme, type Layout } from '../theme';

/** Spring-driven 0→1 entrance that starts at `delay` frames. */
export function useEntrance(delay = 0, damping = 18): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.8, stiffness: 120 } });
}

/** Frame at which item i of n should appear, spread across the spoken words so visuals follow the narration. */
export function revealFrame(i: number, n: number, words: WordTiming[], fps: number, start = 0.4): number {
  if (!words.length || n <= 1) return Math.round((start + i * 1.2) * fps);
  const idx = Math.min(words.length - 1, Math.floor((i / n) * words.length));
  return Math.round(Math.max(start, i === 0 ? start : words[idx].start) * fps);
}

export const Background: React.FC<{ layout: Layout; accent?: string }> = ({ layout, accent = theme.cyan }) => {
  const frame = useCurrentFrame();
  const drift = (frame * 0.25) % 80;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 20% 10%, ${theme.bg2} 0%, ${theme.bg} 60%)` }}>
      <svg width={layout.width} height={layout.height} style={{ position: 'absolute', opacity: 0.18 }}>
        <defs>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform={`translate(${drift} ${drift})`}>
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke={theme.panelBorder} strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div
        style={{
          position: 'absolute',
          width: layout.width * 0.6,
          height: layout.width * 0.6,
          right: -layout.width * 0.2,
          bottom: -layout.width * 0.25,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}22 0%, transparent 65%)`,
          transform: `scale(${1 + Math.sin(frame / 60) * 0.04})`,
        }}
      />
    </AbsoluteFill>
  );
};

export const SectionTitle: React.FC<{ text: string; layout: Layout; color?: string; delay?: number }> = ({ text, layout, color = theme.cyan, delay = 0 }) => {
  const p = useEntrance(delay);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ width: 10, height: layout.unit * 1.3, background: color, borderRadius: 6, transform: `scaleY(${p})` }} />
      <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: layout.unit * 1.35, color: theme.text, letterSpacing: -0.5, lineHeight: 1.1 }}>{text}</div>
    </div>
  );
};

export const LowerThird: React.FC<{ label: string; layout: Layout }> = ({ label, layout }) => {
  const frame = useCurrentFrame();
  const p = useEntrance(6);
  const out = interpolate(frame, [110, 130], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        left: layout.pad,
        top: layout.portrait ? 60 : 44,
        padding: '10px 22px',
        background: theme.panel,
        border: `2px solid ${theme.panelBorder}`,
        borderRadius: 999,
        fontFamily: theme.mono,
        fontSize: layout.unit * 0.55,
        color: theme.muted,
        opacity: p * out,
        transform: `translateX(${(1 - p) * -40}px)`,
      }}
    >
      {label}
    </div>
  );
};

/** Word-synced captions; the active word is highlighted. Groups of `maxWords` words. */
export const Captions: React.FC<{ words: WordTiming[]; maxWords: number; layout: Layout; emphasis: string[] }> = ({ words, maxWords, layout, emphasis }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (!words.length) return null;
  // Break into groups at sentence ends or every maxWords words.
  const groups: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= maxWords || /[.!?]$/.test(w.text)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  const g = groups.find((grp) => t >= grp[0].start - 0.05 && t <= grp[grp.length - 1].end + 0.25);
  if (!g) return null;
  const emph = new Set(emphasis.map((e) => e.toLowerCase()));
  const big = layout.portrait;
  return (
    <div
      style={{
        position: 'absolute',
        left: layout.pad * 0.6,
        right: layout.pad * 0.6,
        bottom: big ? layout.height * 0.2 : 48,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: big ? 800 : 600,
          fontSize: big ? layout.unit * 1.45 : layout.unit * 0.9,
          lineHeight: 1.25,
          textAlign: 'center',
          padding: big ? '6px 14px' : '10px 26px',
          background: big ? 'transparent' : 'rgba(5, 10, 20, 0.72)',
          borderRadius: 16,
          color: theme.text,
          textShadow: big ? '0 4px 0 #000, 0 0 18px rgba(0,0,0,0.8)' : undefined,
          maxWidth: big ? '100%' : '80%',
        }}
      >
        {g.map((w, i) => {
          const active = t >= w.start && t <= w.end + 0.08;
          const key = w.text.toLowerCase().replace(/[^\w]/g, '');
          const color = active ? theme.cyan : emph.has(key) ? theme.orange : theme.text;
          return (
            <span key={i} style={{ color, display: 'inline-block', transform: active && big ? 'scale(1.08)' : undefined, marginRight: '0.28em' }}>
              {big ? w.text.toUpperCase() : w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const ProgressBar: React.FC<{ layout: Layout; total: number }> = ({ layout, total }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 6, width: layout.width * Math.min(1, frame / Math.max(1, total)), background: `linear-gradient(90deg, ${theme.cyan}, ${theme.orange})` }} />
  );
};

/** Scene-level transition: fades/slides in at the start and out at the end of the scene. */
export const Transition: React.FC<{ kind: string; durationInFrames: number; children: React.ReactNode }> = ({ kind, durationInFrames, children }) => {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const outP = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  let transform = '';
  let clip: string | undefined;
  if (kind === 'slide') transform = `translateX(${(1 - inP) * 80}px)`;
  if (kind === 'zoom') transform = `scale(${0.92 + 0.08 * inP})`;
  if (kind === 'wipe') clip = `inset(0 ${(1 - inP) * 100}% 0 0)`;
  return <AbsoluteFill style={{ opacity: kind === 'none' ? 1 : Math.min(inP, outP), transform, clipPath: clip }}>{children}</AbsoluteFill>;
};
