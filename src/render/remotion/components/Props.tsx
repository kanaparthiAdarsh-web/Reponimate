import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Prop } from '../../../core/schemas.js';
import { alpha, theme } from '../theme';

/** Small animated illustrations a presenter can hold or summon. All drawn in SVG, no external assets. */
export const PropIcon: React.FC<{ prop: Prop; size: number; delay?: number }> = ({ prop, size, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - delay, fps, config: { damping: 9, stiffness: 160 } });
  const t = frame / fps;
  const wrap = (children: React.ReactNode) => (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ overflow: 'visible', transform: `scale(${pop})`, opacity: Math.min(1, pop * 1.5) }}>
      {children}
    </svg>
  );
  switch (prop) {
    case 'bulb': {
      const glow = 0.5 + 0.5 * Math.abs(Math.sin(t * 3));
      return wrap(
        <>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1={50 + 34 * Math.cos((a * Math.PI) / 180)} y1={42 + 34 * Math.sin((a * Math.PI) / 180)} x2={50 + (40 + glow * 8) * Math.cos((a * Math.PI) / 180)} y2={42 + (40 + glow * 8) * Math.sin((a * Math.PI) / 180)} stroke="#FDE047" strokeWidth={4} strokeLinecap="round" opacity={glow} />
          ))}
          <circle cx={50} cy={42} r={24} fill="#FDE047" opacity={0.25 + glow * 0.5} />
          <path d="M 36 42 a 14 14 0 1 1 28 0 c 0 8 -6 11 -6 18 h -16 c 0 -7 -6 -10 -6 -18 z" fill="#FEF08A" stroke="#CA8A04" strokeWidth={3} />
          <rect x={42} y={62} width={16} height={8} rx={2} fill="#94A3B8" />
        </>,
      );
    }
    case 'gear': {
      const rot = t * 90;
      const teeth = Array.from({ length: 8 }, (_, i) => i * 45);
      return wrap(
        <g transform={`rotate(${rot} 50 50)`}>
          {teeth.map((a) => (
            <rect key={a} x={44} y={10} width={12} height={16} rx={2} fill={theme.primary} transform={`rotate(${a} 50 50)`} />
          ))}
          <circle cx={50} cy={50} r={28} fill={theme.primary} />
          <circle cx={50} cy={50} r={11} fill={theme.bg} />
        </g>,
      );
    }
    case 'magnifier': {
      const dx = Math.sin(t * 2) * 6;
      return wrap(
        <g transform={`translate(${dx} 0)`}>
          <circle cx={42} cy={42} r={24} fill={alpha(theme.primary, 0.15)} stroke={theme.primary} strokeWidth={7} />
          <line x1={60} y1={60} x2={84} y2={84} stroke={theme.secondary} strokeWidth={10} strokeLinecap="round" />
          <path d="M 30 36 a 14 14 0 0 1 12 -10" stroke="#fff" strokeWidth={3} fill="none" opacity={0.7} />
        </g>,
      );
    }
    case 'laptop': {
      const lines = [0, 1, 2, 3].map((i) => interpolate((t * 2 + i * 0.6) % 3, [0, 1.5], [0, 1], { extrapolateRight: 'clamp' }));
      return wrap(
        <>
          <rect x={14} y={18} width={72} height={48} rx={5} fill={theme.codeBg} stroke={theme.muted} strokeWidth={4} />
          {lines.map((p, i) => (
            <rect key={i} x={22} y={26 + i * 9} width={(30 + ((i * 17) % 25)) * p} height={4} rx={2} fill={i % 2 ? theme.secondary : theme.primary} />
          ))}
          <path d="M 6 70 h 88 l -6 10 h -76 z" fill={theme.muted} />
        </>,
      );
    }
    case 'rocket': {
      const y = -((t * 30) % 20);
      return wrap(
        <g transform={`translate(0 ${y}) rotate(35 50 50)`}>
          <path d="M 50 8 c 16 14 18 40 10 58 h -20 c -8 -18 -6 -44 10 -58 z" fill="#E2E8F0" stroke={theme.primary} strokeWidth={3} />
          <circle cx={50} cy={34} r={7} fill={theme.primary} />
          <path d="M 40 66 l -10 14 l 14 -4 z M 60 66 l 10 14 l -14 -4 z" fill={theme.secondary} />
          <path d={`M 44 68 q 6 ${18 + Math.sin(t * 20) * 6} 12 0 z`} fill="#FDE047" />
        </g>,
      );
    }
    default:
      return null;
  }
};

/** Confetti burst used for celebrations and the outro. Deterministic pseudo-random so renders are reproducible. */
export const Confetti: React.FC<{ width: number; height: number; count?: number; delay?: number }> = ({ width, height, count = 60, delay = 0 }) => {
  const frame = useCurrentFrame() - delay;
  if (frame < 0) return null;
  const colors = [theme.primary, theme.secondary, theme.tertiary, theme.success, theme.text];
  return (
    <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const r = (n: number) => ((Math.sin(i * 9301 + n * 49297) + 1) / 2) % 1;
        const vx = (r(1) - 0.5) * 22;
        const vy = -10 - r(2) * 16;
        const x = width / 2 + vx * frame;
        const y = height * 0.55 + vy * frame + 0.45 * frame * frame;
        const rot = frame * (r(3) * 20 - 10);
        if (y > height + 40) return null;
        return <rect key={i} x={x} y={y} width={10 + r(4) * 10} height={6 + r(5) * 6} fill={colors[i % colors.length]} transform={`rotate(${rot} ${x} ${y})`} />;
      })}
    </svg>
  );
};

/** Stroke-drawn icon (check, cross, bolt, star) used on bullet lists. */
export const DrawnIcon: React.FC<{ kind: 'check' | 'cross' | 'bolt' | 'star'; size: number; color: string; start: number }> = ({ kind, size, color, start }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const d = {
    check: 'M 18 52 L 40 74 L 82 28',
    cross: 'M 26 26 L 74 74 M 74 26 L 26 74',
    bolt: 'M 56 10 L 26 56 H 50 L 42 90 L 74 40 H 50 Z',
    star: 'M 50 10 L 61 38 L 90 40 L 67 58 L 75 88 L 50 71 L 25 88 L 33 58 L 10 40 L 39 38 Z',
  }[kind];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <circle cx={50} cy={50} r={46} fill={`${color}22`} stroke={color} strokeWidth={4} opacity={p} />
      <path d={d} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
    </svg>
  );
};
