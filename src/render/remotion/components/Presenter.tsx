import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Pose, Prop, WordTiming } from '../../../core/schemas.js';
import { theme } from '../theme';
import { PropIcon } from './Props';

type Limb = [upper: number, lower: number];
interface PoseDef {
  la: Limb;
  ra: Limb;
  ll: Limb;
  rl: Limb;
  /** Head tilt in degrees and brow lift (0..1). */
  tilt: number;
  brow: number;
}

// Arm/leg angles in degrees from straight down; positive swings toward screen-right.
const POSES: Record<Pose, PoseDef> = {
  wave: { la: [-12, -6], ra: [155, 185], ll: [-6, -2], rl: [6, 2], tilt: 4, brow: 0.4 },
  point: { la: [-10, -4], ra: [92, 88], ll: [-6, -2], rl: [6, 2], tilt: 3, brow: 0.2 },
  think: { la: [-20, 70], ra: [30, 168], ll: [-5, -2], rl: [5, 2], tilt: -8, brow: 0.8 },
  explain: { la: [-38, -85], ra: [38, 85], ll: [-7, -2], rl: [7, 2], tilt: 0, brow: 0.4 },
  celebrate: { la: [-155, -170], ra: [155, 170], ll: [-10, -4], rl: [10, 4], tilt: 0, brow: 1 },
  confused: { la: [-60, -140], ra: [150, 220], ll: [-6, -2], rl: [6, 2], tilt: -10, brow: 1 },
  walk: { la: [-22, -12], ra: [22, 12], ll: [-22, -8], rl: [22, 8], tilt: 0, brow: 0.2 },
  present: { la: [-10, -4], ra: [118, 100], ll: [-6, -2], rl: [6, 2], tilt: 5, brow: 0.3 },
};

/** Appearance presets; one is chosen per video so channels do not always show the same person. */
export const LOOKS = [
  { skin: '#F1C7A5', skinShade: '#DDA987', hair: '#3B2A20', style: 'short' },
  { skin: '#C68E6A', skinShade: '#AE7655', hair: '#1F1A17', style: 'curly' },
  { skin: '#8D5B3E', skinShade: '#784A30', hair: '#16110E', style: 'bun' },
  { skin: '#E8B796', skinShade: '#D29C79', hair: '#7A4A2A', style: 'long' },
  { skin: '#B07A56', skinShade: '#986444', hair: '#2A2420', style: 'short' },
] as const;

const rad = (d: number): number => (d * Math.PI) / 180;
const joint = (x: number, y: number, len: number, deg: number): [number, number] => [x + len * Math.sin(rad(deg)), y + len * Math.cos(rad(deg))];
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const lerpLimb = (a: Limb, b: Limb, k: number): Limb => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
function blend(a: PoseDef, b: PoseDef, k: number): PoseDef {
  return { la: lerpLimb(a.la, b.la, k), ra: lerpLimb(a.ra, b.ra, k), ll: lerpLimb(a.ll, b.ll, k), rl: lerpLimb(a.rl, b.rl, k), tilt: lerp(a.tilt, b.tilt, k), brow: lerp(a.brow, b.brow, k) };
}

/** Which pose to show at time t: the sequence advances at every sentence end, blending over 0.35 s. */
export function poseAt(poses: Pose[], words: WordTiming[], t: number): { from: Pose; to: Pose; k: number } {
  if (poses.length <= 1) return { from: poses[0], to: poses[0], k: 1 };
  const ends = words.filter((w) => /[.!?]["')]?$/.test(w.text)).map((w) => w.end);
  const passed = ends.filter((e) => e < t);
  const i = passed.length;
  const to = poses[i % poses.length];
  const from = poses[(i + poses.length - 1) % poses.length];
  const k = i === 0 ? 1 : Math.min(1, (t - passed[passed.length - 1]) / 0.35);
  return { from, to, k: k * k * (3 - 2 * k) };
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/**
 * Flat-vector human presenter: hair, face with blinking eyes, expressive brows and a lip-synced mouth,
 * shirt and trousers in the video's palette, skin-toned hands. Walks in, changes pose each sentence,
 * idles with breathing motion and can hold an animated prop.
 */
export const Presenter: React.FC<{
  pose: Pose;
  poses?: Pose[];
  prop?: Prop;
  words: WordTiming[];
  size: number;
  look?: number;
  outfit?: string;
  flip?: boolean;
  delay?: number;
  walkIn?: boolean;
}> = ({ pose: basePose, poses, prop, words, size, look = theme.look, outfit, flip = false, delay = 0, walkIn = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const L = LOOKS[((look % LOOKS.length) + LOOKS.length) % LOOKS.length];
  const shirt = outfit ?? theme.primary;
  const pants = shade(theme.panel, 1.5);
  const enter = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  const seq = poseAt(poses?.length ? poses : [basePose], words, t);
  const walking = walkIn && t < 0.9;
  const pose: Pose = walking ? 'walk' : seq.k < 0.5 ? seq.from : seq.to;
  const p = walking ? POSES.walk : blend(POSES[seq.from], POSES[seq.to], seq.k);
  const walkX = walkIn ? interpolate(t, [0, 0.9], [-size * 0.9, 0], { extrapolateRight: 'clamp', easing: (x) => 1 - (1 - x) ** 3 }) : 0;
  const wob = Math.sin(t * 3.2);
  const talking = words.some((w) => t >= w.start && t <= w.end);
  // Gestures are livelier while talking.
  const g = talking ? 1 : 0.4;
  const la: Limb = [p.la[0] + (pose === 'explain' ? wob * 10 : wob * 3) * g, p.la[1] + (pose === 'celebrate' ? wob * 8 : wob * 4 * g)];
  const ra: Limb = [
    p.ra[0] + (pose === 'wave' ? Math.sin(t * 9) * 16 : pose === 'explain' ? -wob * 10 * g : wob * 3 * g),
    p.ra[1] + (pose === 'wave' ? Math.sin(t * 9) * 22 : -wob * 4 * g),
  ];
  const ll: Limb = walking ? [Math.sin(t * 9) * 26, Math.max(0, Math.sin(t * 9)) * 20] : p.ll;
  const rl: Limb = walking ? [-Math.sin(t * 9) * 26, Math.max(0, -Math.sin(t * 9)) * 20] : p.rl;
  const breathe = Math.sin(t * 2.2) * 2;
  const bounce = pose === 'celebrate' ? Math.abs(Math.sin(t * 6)) * -16 : walking ? Math.abs(Math.sin(t * 9)) * -6 : 0;

  const lShoulder: [number, number] = [116, 156 + breathe * 0.3];
  const rShoulder: [number, number] = [184, 156 + breathe * 0.3];
  const lHip: [number, number] = [132, 292];
  const rHip: [number, number] = [168, 292];
  const limb = (o: [number, number], l: Limb, a: number, b: number) => {
    const e = joint(o[0], o[1], a, l[0]);
    const h = joint(e[0], e[1], b, l[1]);
    return { e, h };
  };
  const armL = limb(lShoulder, la, 74, 68);
  const armR = limb(rShoulder, ra, 74, 68);
  const legL = limb(lHip, ll, 92, 92);
  const legR = limb(rHip, rl, 92, 92);
  const line = (a: [number, number], b: [number, number], w: number, c: string) => (
    <path d={`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`} stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
  );
  const arm = (o: [number, number], a: { e: [number, number]; h: [number, number] }) => (
    <g>
      {line(o, a.e, 30, shade(shirt, 0.88))}
      {line(a.e, a.h, 22, L.skin)}
      <circle cx={a.h[0]} cy={a.h[1]} r={13} fill={L.skin} stroke={L.skinShade} strokeWidth={2} />
    </g>
  );
  const leg = (o: [number, number], a: { e: [number, number]; h: [number, number] }, dir: number) => (
    <g>
      {line(o, a.e, 38, pants)}
      {line(a.e, a.h, 32, pants)}
      <ellipse cx={a.h[0] + dir * 10} cy={a.h[1] + 8} rx={26} ry={12} fill="#26221F" />
    </g>
  );

  // Face
  const blink = frame % 120 < 4;
  const mouthOpen = talking ? 3 + Math.abs(Math.sin(t * 21)) * 9 : 0;
  const lookUp = pose === 'think' ? -4 : 0;
  const browY = 58 - p.brow * 6;
  const happy = pose === 'celebrate' || pose === 'wave';
  const hair = (() => {
    switch (L.style) {
      case 'curly':
        return <path d="M 108 74 C 98 34 132 24 150 28 C 172 22 206 36 194 76 C 190 60 182 52 172 50 C 160 58 136 58 124 50 C 116 54 110 62 108 74 Z" fill={L.hair} />;
      case 'bun':
        return (
          <>
            <circle cx={150} cy={22} r={16} fill={L.hair} />
            <path d="M 110 76 C 106 40 128 30 150 30 C 174 30 196 42 190 76 C 184 58 170 50 150 50 C 132 50 116 58 110 76 Z" fill={L.hair} />
          </>
        );
      case 'long':
        return <path d="M 108 120 C 96 70 108 30 150 30 C 194 30 206 70 194 120 L 186 118 C 192 80 184 56 172 52 C 156 60 136 60 124 52 C 114 58 108 80 114 118 Z" fill={L.hair} />;
      default:
        return <path d="M 110 72 C 108 42 128 30 152 30 C 176 30 194 44 190 70 C 184 56 170 48 150 50 C 134 50 118 56 110 72 Z" fill={L.hair} />;
    }
  })();

  const handR = armR.h;
  const propPos = prop === 'bulb' ? { x: 150, y: -50 } : prop === 'gear' ? { x: 236, y: 0 } : { x: handR[0], y: handR[1] };
  return (
    <div style={{ position: 'relative', width: size * 0.6, height: size, transform: `translateX(${walkX}px)` }}>
      <svg viewBox="0 0 300 500" width={size * 0.6} height={size} style={{ overflow: 'visible', transform: `translateY(${(1 - enter) * 60 + bounce}px) scaleX(${flip ? -1 : 1})`, opacity: enter }}>
        <ellipse cx={150} cy={490} rx={74} ry={9} fill="#000" opacity={0.22} />
        {leg(lHip, legL, -1)}
        {leg(rHip, legR, 1)}
        {/* torso */}
        <path d={`M 112 ${150 + breathe * 0.3} Q 150 ${136 + breathe * 0.3} 188 ${150 + breathe * 0.3} L 184 296 Q 150 304 116 296 Z`} fill={shirt} />
        <path d={`M 138 ${142 + breathe * 0.3} L 150 162 L 162 ${142 + breathe * 0.3}`} fill={shade(shirt, 0.75)} />
        <rect x={142} y={118} width={16} height={26} rx={6} fill={L.skinShade} />
        {arm(lShoulder, armL)}
        {arm(rShoulder, armR)}
        {/* head */}
        <g transform={`rotate(${p.tilt + wob * 1.5} 150 120)`}>
          <ellipse cx={111} cy={84} rx={7} ry={10} fill={L.skinShade} />
          <ellipse cx={189} cy={84} rx={7} ry={10} fill={L.skinShade} />
          <ellipse cx={150} cy={80} rx={38} ry={44} fill={L.skin} />
          {hair}
          {/* brows */}
          <path d={`M 128 ${browY + (pose === 'confused' ? -4 : 0)} q 8 -4 16 0`} stroke={L.hair} strokeWidth={4} strokeLinecap="round" fill="none" />
          <path d={`M 156 ${browY} q 8 -4 16 0`} stroke={L.hair} strokeWidth={4} strokeLinecap="round" fill="none" />
          {/* eyes */}
          {blink ? (
            <>
              <path d="M 130 76 h 12" stroke="#2A211C" strokeWidth={3} strokeLinecap="round" />
              <path d="M 158 76 h 12" stroke="#2A211C" strokeWidth={3} strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse cx={136} cy={76 + lookUp} rx={5} ry={6} fill="#2A211C" />
              <ellipse cx={164} cy={76 + lookUp} rx={5} ry={6} fill="#2A211C" />
              <circle cx={138} cy={74 + lookUp} r={1.6} fill="#fff" />
              <circle cx={166} cy={74 + lookUp} r={1.6} fill="#fff" />
            </>
          )}
          <path d="M 150 84 q 3 8 -2 10" stroke={L.skinShade} strokeWidth={3} fill="none" strokeLinecap="round" />
          <circle cx={128} cy={96} r={6} fill="#E58C8C" opacity={0.25} />
          <circle cx={172} cy={96} r={6} fill="#E58C8C" opacity={0.25} />
          {/* mouth */}
          {talking ? (
            <ellipse cx={150} cy={104} rx={9} ry={mouthOpen / 2 + 2} fill="#6B2E2A" />
          ) : pose === 'confused' ? (
            <path d="M 140 106 q 5 -4 10 0 t 10 0" stroke="#6B2E2A" strokeWidth={3} fill="none" strokeLinecap="round" />
          ) : (
            <path d={happy ? 'M 136 100 Q 150 116 164 100' : 'M 140 104 Q 150 110 160 104'} stroke="#6B2E2A" strokeWidth={3.5} fill={happy ? '#6B2E2A' : 'none'} strokeLinecap="round" />
          )}
        </g>
        {pose === 'confused' && (
          <text x={210} y={30} fontFamily={theme.hand} fontSize={64} fill={theme.secondary} opacity={0.6 + 0.4 * Math.abs(Math.sin(t * 3))}>
            ?
          </text>
        )}
      </svg>
      {prop && prop !== 'none' && !walking && (
        <div style={{ position: 'absolute', left: (propPos.x / 300) * size * 0.6 - size * 0.1, top: (propPos.y / 500) * size - size * 0.1 + bounce }}>
          <PropIcon prop={prop} size={size * 0.2} delay={delay + 18} />
        </div>
      )}
    </div>
  );
};
