import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Pose, WordTiming } from '../../../core/schemas.js';
import { theme } from '../theme';

type Limb = [upper: number, lower: number];
interface PoseDef {
  la: Limb;
  ra: Limb;
  ll: Limb;
  rl: Limb;
}

// Angles in degrees measured from straight down; positive values swing toward screen-right.
const POSES: Record<Pose, PoseDef> = {
  wave: { la: [-20, -10], ra: [150, 175], ll: [-12, -4], rl: [12, 4] },
  point: { la: [-15, -5], ra: [95, 92], ll: [-12, -4], rl: [12, 4] },
  think: { la: [-25, 55], ra: [35, 165], ll: [-10, -4], rl: [10, 4] },
  explain: { la: [-55, -110], ra: [55, 110], ll: [-14, -4], rl: [14, 4] },
  celebrate: { la: [-150, -170], ra: [150, 170], ll: [-18, -6], rl: [18, 6] },
  confused: { la: [-70, -150], ra: [145, 215], ll: [-12, -4], rl: [12, 4] },
  walk: { la: [-25, -15], ra: [25, 15], ll: [-25, -10], rl: [25, 10] },
  present: { la: [-12, -4], ra: [125, 105], ll: [-12, -4], rl: [12, 4] },
};

const rad = (d: number): number => (d * Math.PI) / 180;
function joint(x: number, y: number, len: number, deg: number): [number, number] {
  return [x + len * Math.sin(rad(deg)), y + len * Math.cos(rad(deg))];
}

/** A hand-drawn style stick figure. Mouth moves while words are being spoken; the pose idles with small motion. */
export const Stickman: React.FC<{ pose: Pose; words: WordTiming[]; size: number; color?: string; flip?: boolean; delay?: number }> = ({
  pose,
  words,
  size,
  color = theme.text,
  flip = false,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const enter = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  const p = POSES[pose];
  const wob = Math.sin(t * 3.2);
  const talking = words.some((w) => t >= w.start && t <= w.end);
  const anim: PoseDef = {
    la: [p.la[0] + (pose === 'explain' ? wob * 10 : wob * 3), p.la[1] + (pose === 'celebrate' ? wob * 8 : 0)],
    ra: [p.ra[0] + (pose === 'wave' ? Math.sin(t * 9) * 18 : pose === 'explain' ? -wob * 10 : wob * 3), p.ra[1] + (pose === 'wave' ? Math.sin(t * 9) * 22 : 0)],
    ll: pose === 'walk' ? [Math.sin(t * 6) * 25, Math.sin(t * 6) * 10] : p.ll,
    rl: pose === 'walk' ? [-Math.sin(t * 6) * 25, -Math.sin(t * 6) * 10] : p.rl,
  };
  const bounce = pose === 'celebrate' ? Math.abs(Math.sin(t * 6)) * -18 : Math.sin(t * 2) * 2;
  const sx = 150;
  const shoulder: [number, number] = [sx, 150];
  const hip: [number, number] = [sx, 285];
  const limb = (origin: [number, number], l: Limb, a: number, b: number): string => {
    const e = joint(origin[0], origin[1], a, l[0]);
    const h = joint(e[0], e[1], b, l[1]);
    return `M ${origin[0]} ${origin[1]} L ${e[0]} ${e[1]} L ${h[0]} ${h[1]}`;
  };
  const blink = frame % 110 < 4;
  const mouthH = talking ? 4 + Math.abs(Math.sin(t * 22)) * 9 : 2;
  const stroke = { stroke: color, strokeWidth: 9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <svg
      viewBox="0 0 300 500"
      width={size * 0.6}
      height={size}
      style={{ overflow: 'visible', transform: `translateY(${(1 - enter) * 60 + bounce}px) scaleX(${flip ? -1 : 1})`, opacity: enter }}
    >
      <ellipse cx={150} cy={482} rx={70 - bounce} ry={10} fill="#000" opacity={0.25} />
      <path d={limb(hip, anim.ll, 100, 95)} {...stroke} />
      <path d={limb(hip, anim.rl, 100, 95)} {...stroke} />
      <path d={`M ${shoulder[0]} 128 L ${hip[0]} ${hip[1]}`} {...stroke} />
      <path d={limb(shoulder, anim.la, 80, 75)} {...stroke} />
      <path d={limb(shoulder, anim.ra, 80, 75)} {...stroke} />
      <circle cx={150} cy={88} r={40} {...stroke} fill={theme.bg} />
      {blink ? (
        <>
          <path d="M 128 82 L 140 82" {...stroke} strokeWidth={5} />
          <path d="M 160 82 L 172 82" {...stroke} strokeWidth={5} />
        </>
      ) : (
        <>
          <circle cx={134} cy={82} r={5} fill={color} />
          <circle cx={166} cy={82} r={5} fill={color} />
        </>
      )}
      {pose === 'confused' ? (
        <path d="M 135 108 Q 145 102 155 108 T 168 106" {...stroke} strokeWidth={5} />
      ) : talking ? (
        <ellipse cx={150} cy={106} rx={10} ry={mouthH} fill={color} />
      ) : (
        <path d={pose === 'celebrate' || pose === 'wave' ? 'M 134 102 Q 150 118 166 102' : 'M 138 106 L 162 106'} {...stroke} strokeWidth={5} />
      )}
      {pose === 'confused' && (
        <text x={205} y={40} fontFamily={theme.hand} fontSize={70} fill={theme.orange} opacity={0.6 + 0.4 * Math.abs(Math.sin(t * 3))}>
          ?
        </text>
      )}
      {pose === 'think' && (
        <g opacity={interpolate(Math.sin(t * 2), [-1, 1], [0.4, 1])}>
          <circle cx={210} cy={40} r={7} fill={theme.muted} />
          <circle cx={232} cy={16} r={11} fill={theme.muted} />
        </g>
      )}
    </svg>
  );
};

/** Whiteboard whose lines are "written" one after another in a handwriting font. */
export const Whiteboard: React.FC<{ items: string[]; width: number; height: number; reveal: number[]; fontSize: number; title?: string }> = ({ items, width, height, reveal, fontSize, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });
  return (
    <div
      style={{
        width,
        height,
        background: theme.board,
        borderRadius: 18,
        border: `10px solid #CBD5E1`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
        padding: fontSize * 0.9,
        boxSizing: 'border-box',
        transform: `scale(${0.9 + 0.1 * enter})`,
        opacity: enter,
        display: 'flex',
        flexDirection: 'column',
        gap: fontSize * 0.55,
        overflow: 'hidden',
      }}
    >
      {title && <div style={{ fontFamily: theme.hand, fontSize: fontSize * 1.15, color: '#1D4ED8', borderBottom: '4px solid #93C5FD', paddingBottom: 6 }}>{title}</div>}
      {items.map((item, i) => {
        const start = reveal[i] ?? 0;
        const chars = Math.floor(interpolate(frame, [start, start + Math.max(12, item.length * 0.9)], [0, item.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
        if (frame < start) return null;
        return (
          <div key={i} style={{ fontFamily: theme.hand, fontSize, color: '#0F172A', lineHeight: 1.15, display: 'flex', gap: 14 }}>
            <span style={{ color: i % 2 ? '#EA580C' : '#0891B2' }}>✎</span>
            <span>{item.slice(0, chars)}</span>
          </div>
        );
      })}
    </div>
  );
};
