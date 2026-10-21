import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import React, { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import type { Pose, Prop, WordTiming } from '../../../core/schemas.js';
import { theme } from '../theme';
import { poseAt } from './Presenter';
import { ModelCharacter } from './ModelCharacter';

/*
 * A stylised 3D "game character" boy built entirely from primitives (no external model files, no licences).
 * Toon (cel) shading + inverted-hull outlines give the look of a stylised game; a joint hierarchy
 * (shoulder → elbow → hand, hip → knee → foot, neck → head) is driven by the shared pose engine.
 */

type Limb = [upper: number, lower: number];
interface Pose3D {
  la: Limb; // arm angles (deg, from straight down; + = toward screen-right)
  ra: Limb;
  ll: Limb;
  rl: Limb;
  armFwd: number; // arms reach toward the camera (deg)
  tilt: number; // head roll
  turn: number; // head yaw (toward the content on screen-right)
  brow: number; // 0 neutral … 1 raised
}

const POSES: Record<Pose, Pose3D> = {
  wave: { la: [-12, -4], ra: [150, 30], ll: [-4, 0], rl: [4, 0], armFwd: 10, tilt: 6, turn: 0, brow: 0.5 },
  point: { la: [-10, -4], ra: [88, 0], ll: [-4, 0], rl: [4, 0], armFwd: 20, tilt: 3, turn: 18, brow: 0.3 },
  think: { la: [-18, 70], ra: [28, 140], ll: [-3, 0], rl: [3, 0], armFwd: 35, tilt: -9, turn: -8, brow: 0.9 },
  explain: { la: [-40, -30], ra: [40, 30], ll: [-5, 0], rl: [5, 0], armFwd: 30, tilt: 0, turn: 0, brow: 0.45 },
  celebrate: { la: [-150, -15], ra: [150, 15], ll: [-8, 0], rl: [8, 0], armFwd: 0, tilt: 0, turn: 0, brow: 1 },
  confused: { la: [-55, -50], ra: [145, 75], ll: [-4, 0], rl: [4, 0], armFwd: 15, tilt: -12, turn: -6, brow: 1 },
  walk: { la: [-18, -6], ra: [18, 6], ll: [-4, 0], rl: [4, 0], armFwd: 0, tilt: 0, turn: 0, brow: 0.3 },
  present: { la: [-10, -4], ra: [115, -15], ll: [-4, 0], rl: [4, 0], armFwd: 15, tilt: 4, turn: 15, brow: 0.35 },
};

export const LOOKS_3D = [
  { skin: '#F2C6A0', hair: '#3A2618' },
  { skin: '#C98E66', hair: '#1C1612' },
  { skin: '#8C5A3C', hair: '#120E0B' },
  { skin: '#EBC09C', hair: '#8A5A33' },
  { skin: '#B27B55', hair: '#2E241E' },
];

const rad = THREE.MathUtils.degToRad;
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
function blend(a: Pose3D, b: Pose3D, k: number): Pose3D {
  const l = (x: Limb, y: Limb): Limb => [mix(x[0], y[0], k), mix(x[1], y[1], k)];
  return { la: l(a.la, b.la), ra: l(a.ra, b.ra), ll: l(a.ll, b.ll), rl: l(a.rl, b.rl), armFwd: mix(a.armFwd, b.armFwd, k), tilt: mix(a.tilt, b.tilt, k), turn: mix(a.turn, b.turn, k), brow: mix(a.brow, b.brow, k) };
}

/** Three-tone ramp for cel shading. */
function useToonRamp(): THREE.DataTexture {
  return useMemo(() => {
    const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }, []);
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: '#15100d', side: THREE.BackSide });

/** A toon-shaded mesh with an inverted-hull outline. */
const Part: React.FC<{
  geo: React.ReactElement;
  color: string;
  ramp: THREE.DataTexture;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  outline?: number;
  emissive?: string;
}> = ({ geo, color, ramp, position, rotation, scale, outline = 0.035, emissive }) => (
  <group position={position} rotation={rotation} scale={scale}>
    <mesh>
      {geo}
      <meshToonMaterial color={color} gradientMap={ramp} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.9 : 0} />
    </mesh>
    {outline > 0 && (
      <mesh scale={[1 + outline, 1 + outline, 1 + outline]} material={OUTLINE}>
        {geo}
      </mesh>
    )}
  </group>
);

const Prop3D: React.FC<{ prop: Prop; t: number; ramp: THREE.DataTexture; pop: number }> = ({ prop, t, ramp, pop }) => {
  const s = Math.max(0.001, pop);
  switch (prop) {
    case 'bulb':
      return (
        <group scale={[s, s, s]}>
          <Part geo={<sphereGeometry args={[0.16, 24, 24]} />} color="#FFE9A8" emissive="#FFD45A" ramp={ramp} position={[0, 0.05, 0]} />
          <Part geo={<cylinderGeometry args={[0.07, 0.07, 0.1, 16]} />} color="#9AA3AE" ramp={ramp} position={[0, -0.13, 0]} />
          <pointLight color="#FFD45A" intensity={1.2 + Math.sin(t * 6) * 0.4} distance={2} />
        </group>
      );
    case 'gear':
      return (
        <group scale={[s, s, s]} rotation={[0, 0, t * 1.6]}>
          <Part geo={<torusGeometry args={[0.13, 0.05, 10, 24]} />} color={theme.secondary} ramp={ramp} />
          {Array.from({ length: 8 }, (_, i) => (
            <Part key={i} geo={<boxGeometry args={[0.07, 0.08, 0.08]} />} color={theme.secondary} ramp={ramp} position={[Math.cos((i * Math.PI) / 4) * 0.2, Math.sin((i * Math.PI) / 4) * 0.2, 0]} rotation={[0, 0, (i * Math.PI) / 4]} outline={0.02} />
          ))}
        </group>
      );
    case 'magnifier':
      return (
        <group scale={[s, s, s]} rotation={[0, 0, rad(-35) + Math.sin(t * 2) * 0.1]}>
          <Part geo={<torusGeometry args={[0.13, 0.03, 10, 28]} />} color="#6E7781" ramp={ramp} position={[0, 0.2, 0]} />
          <mesh position={[0, 0.2, 0]}>
            <circleGeometry args={[0.13, 28]} />
            <meshBasicMaterial color={theme.primary} transparent opacity={0.25} />
          </mesh>
          <Part geo={<cylinderGeometry args={[0.025, 0.03, 0.18, 10]} />} color="#5B3B26" ramp={ramp} position={[0, 0, 0]} />
        </group>
      );
    case 'laptop':
      return (
        <group scale={[s, s, s]} rotation={[rad(-10), rad(-20), 0]}>
          <Part geo={<boxGeometry args={[0.42, 0.02, 0.3]} />} color="#B8C0CA" ramp={ramp} position={[0, 0, 0]} outline={0.02} />
          <Part geo={<boxGeometry args={[0.42, 0.28, 0.02]} />} color="#B8C0CA" ramp={ramp} position={[0, 0.14, -0.15]} rotation={[rad(-12), 0, 0]} outline={0.02} />
          <mesh position={[0, 0.14, -0.137]} rotation={[rad(-12), 0, 0]}>
            <planeGeometry args={[0.37, 0.23]} />
            <meshBasicMaterial color={theme.primary} />
          </mesh>
        </group>
      );
    case 'rocket':
      return (
        <group scale={[s, s, s]} position={[0, Math.sin(t * 5) * 0.03, 0]}>
          <Part geo={<cylinderGeometry args={[0.07, 0.08, 0.26, 16]} />} color="#EEF1F4" ramp={ramp} />
          <Part geo={<coneGeometry args={[0.07, 0.13, 16]} />} color={theme.secondary} ramp={ramp} position={[0, 0.19, 0]} />
          <Part geo={<coneGeometry args={[0.06, 0.12 + Math.abs(Math.sin(t * 20)) * 0.05, 12]} />} color="#FFC857" emissive="#FF9F1C" ramp={ramp} position={[0, -0.19, 0]} rotation={[Math.PI, 0, 0]} outline={0} />
        </group>
      );
    default:
      return null;
  }
};

const Boy: React.FC<{ p: Pose3D; t: number; talking: boolean; mouth: number; blink: boolean; walking: boolean; bounce: number; look: number; prop?: Prop; propPop: number; shirt: string; pose: Pose }> = ({
  p,
  t,
  talking,
  mouth,
  blink,
  walking,
  bounce,
  look,
  prop,
  propPop,
  shirt,
  pose,
}) => {
  const ramp = useToonRamp();
  const L = LOOKS_3D[((look % LOOKS_3D.length) + LOOKS_3D.length) % LOOKS_3D.length];
  const pants = '#2F3440';
  const breathe = Math.sin(t * 2.2) * 0.012;
  const g = talking ? 1 : 0.4;
  const wob = Math.sin(t * 3.2);
  const swing = walking ? Math.sin(t * 9) : 0;
  // Arm: rotate about Z (sideways) then X (toward camera).
  const arm = (side: 1 | -1, limb: Limb, extraWave = 0) => {
    const upper = rad(limb[0] + (side === 1 ? extraWave : wob * 3 * g));
    const lower = rad(limb[1] + (side === 1 ? extraWave * 1.2 : wob * 4 * g));
    return (
      <group position={[0.36 * side, 1.28 + breathe, 0]} rotation={[rad(-p.armFwd) + (walking ? -side * swing * 0.5 : 0), 0, upper]}>
        <Part geo={<capsuleGeometry args={[0.1, 0.26, 6, 14]} />} color={shirt} ramp={ramp} position={[0, -0.2, 0]} />
        <group position={[0, -0.42, 0]} rotation={[rad(-10) * (1 - Math.abs(Math.sin(lower))), 0, lower]}>
          <Part geo={<capsuleGeometry args={[0.085, 0.22, 6, 14]} />} color={shirt} ramp={ramp} position={[0, -0.16, 0]} />
          <Part geo={<sphereGeometry args={[0.1, 18, 18]} />} color={L.skin} ramp={ramp} position={[0, -0.36, 0.01]} />
          {side === 1 && prop && prop !== 'bulb' && (
            <group position={[0, -0.45, 0.12]}>
              <Prop3D prop={prop} t={t} ramp={ramp} pop={propPop} />
            </group>
          )}
        </group>
      </group>
    );
  };
  const leg = (side: 1 | -1, limb: Limb) => {
    const fwd = walking ? side * swing * 0.6 : 0;
    const knee = walking ? Math.max(0, -side * swing) * 0.7 : 0;
    return (
      <group position={[0.15 * side, 0.62, 0]} rotation={[fwd, 0, rad(limb[0])]}>
        <Part geo={<capsuleGeometry args={[0.12, 0.22, 6, 14]} />} color={pants} ramp={ramp} position={[0, -0.17, 0]} />
        <group position={[0, -0.36, 0]} rotation={[knee, 0, rad(limb[1])]}>
          <Part geo={<capsuleGeometry args={[0.11, 0.18, 6, 14]} />} color={pants} ramp={ramp} position={[0, -0.13, 0]} />
          <Part geo={<boxGeometry args={[0.2, 0.11, 0.32]} />} color="#F4F4F2" ramp={ramp} position={[0, -0.3, 0.06]} outline={0.05} />
          <Part geo={<boxGeometry args={[0.21, 0.04, 0.33]} />} color={theme.secondary} ramp={ramp} position={[0, -0.355, 0.06]} outline={0} />
        </group>
      </group>
    );
  };
  const waveExtra = pose === 'wave' ? Math.sin(t * 9) * 18 : pose === 'explain' ? -wob * 10 * g : 0;
  const browLift = p.brow * 0.05;
  return (
    <group position={[0, bounce, 0]}>
      {/* shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]}>
        <circleGeometry args={[0.55, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} />
      </mesh>
      {leg(-1, p.ll)}
      {leg(1, p.rl)}
      {/* hips + hoodie torso */}
      <Part geo={<capsuleGeometry args={[0.26, 0.12, 8, 18]} />} color={pants} ramp={ramp} position={[0, 0.68, 0]} scale={[1.05, 1, 0.8]} />
      <Part geo={<capsuleGeometry args={[0.3, 0.38, 8, 20]} />} color={shirt} ramp={ramp} position={[0, 1.04 + breathe, 0]} scale={[1.05, 1, 0.78]} />
      <Part geo={<torusGeometry args={[0.2, 0.06, 10, 24]} />} color={shirt} ramp={ramp} position={[0, 1.36, -0.06]} rotation={[rad(80), 0, 0]} outline={0.02} />
      {/* hoodie strings + pocket */}
      <Part geo={<cylinderGeometry args={[0.012, 0.012, 0.18, 6]} />} color="#F4F4F2" ramp={ramp} position={[-0.07, 1.22, 0.25]} outline={0} />
      <Part geo={<cylinderGeometry args={[0.012, 0.012, 0.18, 6]} />} color="#F4F4F2" ramp={ramp} position={[0.07, 1.22, 0.25]} outline={0} />
      <Part geo={<boxGeometry args={[0.34, 0.12, 0.02]} />} color={new THREE.Color(shirt).multiplyScalar(0.82).getStyle()} ramp={ramp} position={[0, 0.9, 0.235]} outline={0} />
      {arm(-1, p.la)}
      {arm(1, p.ra, waveExtra)}
      {/* neck + head */}
      <Part geo={<cylinderGeometry args={[0.08, 0.09, 0.12, 14]} />} color={L.skin} ramp={ramp} position={[0, 1.42, 0]} outline={0} />
      <group position={[0, 1.5 + breathe, 0]} rotation={[pose === 'think' ? rad(-8) : 0, rad(p.turn) + wob * 0.03, rad(p.tilt) + wob * 0.02]}>
        <group position={[0, 0.34, 0]}>
          <Part geo={<sphereGeometry args={[0.42, 32, 32]} />} color={L.skin} ramp={ramp} scale={[1, 0.95, 0.92]} />
          {/* ears */}
          <Part geo={<sphereGeometry args={[0.08, 14, 14]} />} color={L.skin} ramp={ramp} position={[-0.41, -0.02, 0]} />
          <Part geo={<sphereGeometry args={[0.08, 14, 14]} />} color={L.skin} ramp={ramp} position={[0.41, -0.02, 0]} />
          {/* hair: cap + spiky fringe */}
          <Part geo={<sphereGeometry args={[0.45, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.55]} />} color={L.hair} ramp={ramp} position={[0, 0.06, -0.02]} scale={[1, 0.95, 0.95]} />
          {[-0.24, -0.08, 0.08, 0.24].map((x, i) => (
            <Part key={i} geo={<coneGeometry args={[0.1, 0.24, 10]} />} color={L.hair} ramp={ramp} position={[x, 0.3 - Math.abs(x) * 0.25, 0.3]} rotation={[rad(70), 0, rad(-x * 120)]} outline={0.02} />
          ))}
          <Part geo={<coneGeometry args={[0.12, 0.3, 10]} />} color={L.hair} ramp={ramp} position={[0.05, 0.45, -0.05]} rotation={[rad(-20), 0, rad(-15)]} outline={0.02} />
          {/* eyes: big anime style with highlights */}
          {[-1, 1].map((s) => (
            <group key={s} position={[0.15 * s, 0.01, 0.35]} scale={[1, blink ? 0.1 : 1, 1]}>
              <mesh scale={[1, 1.25, 0.5]}>
                <sphereGeometry args={[0.085, 20, 20]} />
                <meshBasicMaterial color="#FFFFFF" />
              </mesh>
              <mesh position={[0.01 * s + Math.sin(p.turn / 20) * 0.02, pose === 'think' ? 0.03 : -0.005, 0.035]} scale={[1, 1.2, 0.5]}>
                <sphereGeometry args={[0.055, 18, 18]} />
                <meshBasicMaterial color="#3B2A20" />
              </mesh>
              <mesh position={[0.02, 0.035, 0.065]}>
                <sphereGeometry args={[0.018, 10, 10]} />
                <meshBasicMaterial color="#FFFFFF" />
              </mesh>
              {/* brow */}
              <mesh position={[0, 0.15 + browLift + (pose === 'confused' && s === 1 ? 0.04 : 0), 0.02]} rotation={[0, 0, s * (pose === 'confused' ? -0.3 : -0.12 + p.brow * 0.15)]}>
                <boxGeometry args={[0.13, 0.025, 0.02]} />
                <meshBasicMaterial color={L.hair} />
              </mesh>
            </group>
          ))}
          {/* nose, cheeks, mouth */}
          <Part geo={<sphereGeometry args={[0.035, 12, 12]} />} color={new THREE.Color(L.skin).multiplyScalar(0.92).getStyle()} ramp={ramp} position={[0, -0.09, 0.39]} outline={0} />
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.24 * s, -0.12, 0.31]}>
              <circleGeometry args={[0.05, 16]} />
              <meshBasicMaterial color="#F08C8C" transparent opacity={0.35} />
            </mesh>
          ))}
          <mesh position={[0, -0.2, 0.37]} scale={[1, talking ? 0.35 + mouth * 0.9 : pose === 'celebrate' || pose === 'wave' ? 0.55 : 0.18, 0.4]}>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshBasicMaterial color="#5A2420" />
          </mesh>
          {prop === 'bulb' && (
            <group position={[0.15, 0.85, 0]}>
              <Prop3D prop="bulb" t={t} ramp={ramp} pop={propPop} />
            </group>
          )}
        </group>
      </group>
    </group>
  );
};

/** Frames the whole character: camera in front, slightly above, looking at the chest. */
const CameraRig: React.FC = () => {
  const { camera, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  cam.fov = 28;
  cam.aspect = size.width / size.height;
  cam.position.set(0, 1.35, 7.4);
  cam.lookAt(0, 1.18, 0);
  cam.updateProjectionMatrix();
  return null;
};

/** Drop-in replacement for the 2D Presenter: same props and pose behaviour, rendered in 3D with WebGL. */
export const Presenter3D: React.FC<{
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
  const enter = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  const seq = poseAt(poses?.length ? poses : [basePose], words, t);
  const walking = walkIn && t < 1;
  const pose: Pose = walking ? 'walk' : seq.k < 0.5 ? seq.from : seq.to;
  const p = walking ? POSES.walk : blend(POSES[seq.from], POSES[seq.to], seq.k);
  const walkX = walkIn ? interpolate(t, [0, 1], [-2.6, 0], { extrapolateRight: 'clamp', easing: (x) => 1 - (1 - x) ** 3 }) : 0;
  const talking = words.some((w) => t >= w.start && t <= w.end);
  const mouth = talking ? Math.abs(Math.sin(t * 21)) : 0;
  const blink = frame % 115 < 4;
  const bounce = pose === 'celebrate' ? Math.abs(Math.sin(t * 6)) * 0.18 : walking ? Math.abs(Math.sin(t * 9)) * 0.05 : 0;
  const propPop = spring({ frame: frame - delay - 20, fps, config: { damping: 9, stiffness: 160 } });
  const rampFallback = useToonRamp();
  const w = Math.round(size * 0.62);
  const h = Math.round(size);
  return (
    <div style={{ width: w, height: h, opacity: Math.min(1, enter * 1.4), transform: `translateY(${(1 - enter) * 40}px) scaleX(${flip ? -1 : 1})` }}>
      <ThreeCanvas width={w} height={h} linear flat={false} camera={{ fov: 30, position: [0, 1.25, 6.4] }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <CameraRig />
        <ambientLight intensity={1.1} />
        <directionalLight position={[2.5, 4, 5]} intensity={2.2} />
        <directionalLight position={[-3, 2, -3]} intensity={1.4} color={theme.primary} />
        <group position={[walkX, -0.05, 0]} rotation={[0, walking ? rad(35) : rad(-6) + Math.sin(t * 0.7) * 0.05, 0]}>
          {theme.characterModel ? (
            <>
              <hemisphereLight args={['#ffffff', '#555555', 2.2]} />
              <directionalLight position={[0, 2.5, 6]} intensity={2.4} />
              <ModelCharacter file={theme.characterModel} pose={p} talk={mouth} t={t} walking={walking} />
              {prop === 'bulb' && (
                <group position={[0.25, 2.65, 0]}>
                  <Prop3D prop="bulb" t={t} ramp={rampFallback} pop={propPop} />
                </group>
              )}
            </>
          ) : (
            <Boy p={p} t={t} talking={talking} mouth={mouth} blink={blink} walking={walking} bounce={bounce} look={look} prop={prop} propPop={propPop} shirt={outfit ?? theme.primary} pose={pose} />
          )}
        </group>
      </ThreeCanvas>
    </div>
  );
};
