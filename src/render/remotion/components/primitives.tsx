import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { WordTiming } from '../../../core/schemas.js';
import { alpha, theme, type Layout } from '../theme';

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

export const Background: React.FC<{ layout: Layout; accent?: string }> = ({ layout, accent = theme.primary }) => {
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
      {/* Drifting code glyphs give depth; deterministic so every render is identical. */}
      {Array.from({ length: 18 }, (_, i) => {
        const r = (n: number) => (Math.sin(i * 127.1 + n * 311.7) * 43758.5453) % 1;
        const rr = (n: number) => Math.abs(r(n));
        const speed = 0.15 + rr(1) * 0.35;
        const y = layout.height + 60 - ((frame * speed * 2 + rr(2) * layout.height * 1.3) % (layout.height + 160));
        const x = rr(3) * layout.width + Math.sin(frame / 50 + i) * 20;
        const glyph = ['{ }', '</>', '( )', ';', '=>', '[ ]', '#', '&&', '01'][i % 9];
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, fontFamily: theme.mono, fontSize: 22 + rr(4) * 26, color: i % 3 ? theme.primary : theme.secondary, opacity: 0.06 + rr(5) * 0.08, transform: `rotate(${Math.sin(frame / 80 + i) * 15}deg)` }}>
            {glyph}
          </div>
        );
      })}
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

export const SectionTitle: React.FC<{ text: string; layout: Layout; color?: string; delay?: number }> = ({ text, layout, color = theme.primary, delay = 0 }) => {
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
          maxWidth: big ? '100%' : '68%',
        }}
      >
        {g.map((w, i) => {
          const active = t >= w.start && t <= w.end + 0.08;
          const key = w.text.toLowerCase().replace(/[^\w]/g, '');
          const color = active ? theme.primary : emph.has(key) ? theme.secondary : theme.text;
          // Real space characters between words: margins collapse or get covered by highlighted words.
          return (
            <React.Fragment key={i}>
              {i > 0 && ' '}
              <span style={{ color, textDecoration: active && big ? 'underline' : undefined, textDecorationThickness: 6, textUnderlineOffset: 10 }}>
                {big ? w.text.toUpperCase() : w.text}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export const ProgressBar: React.FC<{ layout: Layout; total: number }> = ({ layout, total }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 6, width: layout.width * Math.min(1, frame / Math.max(1, total)), background: `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})` }} />
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
  // Colour panels sweep across the frame at the start of wipe/slide scenes, uncovering the new scene.
  const sweep = kind === 'wipe' || kind === 'slide' ? interpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) }) : 1;
  return (
    <>
      <AbsoluteFill style={{ opacity: kind === 'none' ? 1 : Math.min(inP, outP), transform, clipPath: clip }}>{children}</AbsoluteFill>
      {sweep < 1 && (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: '60%', left: `${-60 + sweep * 220}%`, background: theme.primary, transform: 'skewX(-18deg)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: '45%', left: `${-90 + sweep * 220}%`, background: theme.secondary, transform: 'skewX(-18deg)' }} />
        </AbsoluteFill>
      )}
    </>
  );
};

/** Emphasis words pop up as chips when they are spoken, then float away. */
export const KeywordPops: React.FC<{ words: WordTiming[]; emphasis: string[]; layout: Layout }> = ({ words, emphasis, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const keys = new Set(emphasis.map((e) => e.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean));
  const hits = words.filter((w) => keys.has(w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  const seen = new Set<string>();
  return (
    <>
      {hits.map((w, i) => {
        const key = w.text.toLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);
        const age = t - w.start;
        if (age < 0 || age > 2.2) return null;
        const s = spring({ frame: Math.round(age * fps), fps, config: { damping: 9, stiffness: 180 } });
        const fade = interpolate(age, [1.6, 2.2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              right: layout.pad * 0.6 + (i % 2) * 40,
              top: (layout.portrait ? layout.height * 0.62 : layout.height * 0.16) - age * 30,
              padding: '10px 22px',
              borderRadius: 999,
              background: i % 2 ? theme.secondary : theme.primary,
              color: theme.ink,
              fontFamily: theme.font,
              fontWeight: 800,
              fontSize: layout.unit * 0.75,
              transform: `scale(${s}) rotate(${(i % 2 ? 1 : -1) * 4}deg)`,
              opacity: fade,
              boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
            }}
          >
            {w.text.replace(/[.,!?;:]+$/, '')}
          </div>
        );
      })}
    </>
  );
};

/** Channel badge in the bottom-right corner: avatar with initials, name, slide-in and a periodic shine. */
export const ChannelBadge: React.FC<{ name: string; layout: Layout }> = ({ name, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 20, fps, config: { damping: 16 } });
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '').join('');
  const cycle = (frame % (fps * 12)) / fps; // shine every 12 s
  const shine = interpolate(cycle, [0, 0.9], [-30, 130], { extrapolateRight: 'clamp' });
  const fs = layout.unit * (layout.portrait ? 0.6 : 0.52);
  return (
    <div
      style={{
        position: 'absolute',
        right: layout.portrait ? 36 : 34,
        bottom: layout.portrait ? 54 : 30,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: `8px 20px 8px 8px`,
        borderRadius: 999,
        background: alpha(theme.panel, 0.88),
        border: `2px solid ${alpha(theme.primary, 0.45)}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        transform: `translateX(${(1 - enter) * 160}px)`,
        opacity: enter,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: fs * 2, height: fs * 2, borderRadius: '50%', background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`, color: theme.ink, fontFamily: theme.font, fontWeight: 800, fontSize: fs * 0.85, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {initials}
      </div>
      <div style={{ fontFamily: theme.font, fontWeight: 700, fontSize: fs, color: theme.text, whiteSpace: 'nowrap', maxWidth: layout.width * 0.3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
      <div style={{ position: 'absolute', top: 0, bottom: 0, width: '30%', left: `${shine}%`, background: `linear-gradient(90deg, transparent, ${alpha(theme.text, 0.18)}, transparent)`, transform: 'skewX(-20deg)' }} />
    </div>
  );
};
