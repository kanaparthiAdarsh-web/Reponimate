import { useThree } from '@react-three/fiber';
import React, { useEffect, useMemo, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/*
 * Loads a rigged, textured glTF character (Quaternius, Mixamo, Ready Player Me …) placed in
 * models/character/ and poses it bone-by-bone from the shared pose engine. Posing is rig-agnostic:
 * each limb bone is rotated so it points in the target direction, whatever its local axes are.
 */

export type Limb = [upper: number, lower: number];
export interface BonePose {
  la: Limb;
  ra: Limb;
  ll: Limb;
  rl: Limb;
  armFwd: number;
  tilt: number;
  turn: number;
}

const cache = new Map<string, Promise<THREE.Group>>();
function loadModel(file: string): Promise<THREE.Group> {
  if (!cache.has(file)) {
    cache.set(
      file,
      new Promise((resolve, reject) => {
        new GLTFLoader().load(staticFile(file), (g) => resolve(g.scene), undefined, reject);
      }),
    );
  }
  return cache.get(file)!;
}

const SIDE_L = /(^|[^a-z])(left|l)([^a-z]|$)|[._-]l$|left/i;
const SIDE_R = /(^|[^a-z])(right|r)([^a-z]|$)|[._-]r$|right/i;
function findBone(root: THREE.Object3D, kind: RegExp, side?: 'L' | 'R', not?: RegExp): THREE.Bone | undefined {
  let found: THREE.Bone | undefined;
  root.traverse((o) => {
    if (found || !(o as THREE.Bone).isBone) return;
    const n = o.name.replace(/^mixamorig[:_]?/i, '');
    if (!kind.test(n) || (not && not.test(n))) return;
    if (side === 'L' && (!SIDE_L.test(n) || /right/i.test(n))) return;
    if (side === 'R' && (!SIDE_R.test(n) || /left/i.test(n))) return;
    found = o as THREE.Bone;
  });
  return found;
}

interface Rig {
  root: THREE.Group;
  bind: Map<THREE.Bone, THREE.Quaternion>;
  arm: { L: THREE.Bone[]; R: THREE.Bone[] };
  leg: { L: THREE.Bone[]; R: THREE.Bone[] };
  head?: THREE.Bone;
  spine?: THREE.Bone;
  mouth: { mesh: THREE.Mesh; index: number }[];
}

function buildRig(src: THREE.Group, height: number): Rig {
  const root = cloneSkinned(src) as THREE.Group;
  // Normalise size and stand on the floor. Measure the skeleton, not the mesh: skinned-mesh bounds ignore
  // bone transforms (Mixamo stores centimetres under a rotated, 0.01-scaled armature).
  const bonesBox = (): THREE.Box3 => {
    root.updateMatrixWorld(true);
    const b = new THREE.Box3();
    const v = new THREE.Vector3();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) b.expandByPoint(o.getWorldPosition(v));
    });
    return b;
  };
  const box = bonesBox();
  // Bones end at the top of the head and the ankles/toes; add a little for hair and shoe soles.
  const s = height / Math.max(0.001, (box.max.y - box.min.y) * 1.06);
  root.scale.multiplyScalar(s);
  const box2 = bonesBox();
  root.position.y -= box2.min.y - 0.03;
  root.position.x -= (box2.min.x + box2.max.x) / 2;
  root.position.z -= (box2.min.z + box2.max.z) / 2;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.frustumCulled = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if ((mat as THREE.MeshStandardMaterial).map) (mat as THREE.MeshStandardMaterial).map!.colorSpace = THREE.SRGBColorSpace;
    }
  });
  const chain = (side: 'L' | 'R', upper: RegExp, lower: RegExp, end: RegExp, notUpper?: RegExp) =>
    [findBone(root, upper, side, notUpper), findBone(root, lower, side), findBone(root, end, side, /(thumb|index|middle|ring|pinky|toe_end|end)/i)].filter(Boolean) as THREE.Bone[];
  const bind = new Map<THREE.Bone, THREE.Quaternion>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bind.set(o as THREE.Bone, (o as THREE.Bone).quaternion.clone());
  });
  const mouth: Rig['mouth'] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    const dict = m.morphTargetDictionary;
    if (!dict) return;
    for (const key of ['jawOpen', 'mouthOpen', 'viseme_aa', 'MouthOpen', 'A']) {
      if (dict[key] !== undefined) {
        mouth.push({ mesh: m, index: dict[key] });
        break;
      }
    }
  });
  return {
    root,
    bind,
    arm: { L: chain('L', /(upper_?arm|^(left|right)?arm$|arm[._-]?[lr]$|^arm)/i, /(fore_?arm|lower_?arm)/i, /hand/i, /(fore|lower|shoulder|twist)/i), R: chain('R', /(upper_?arm|^(left|right)?arm$|arm[._-]?[lr]$|^arm)/i, /(fore_?arm|lower_?arm)/i, /hand/i, /(fore|lower|shoulder|twist)/i) },
    leg: { L: chain('L', /(up_?leg|upper_?leg|thigh)/i, /(^(left|right)?leg$|lower_?leg|shin|calf|leg[._-]?[lr]$)/i, /foot/i), R: chain('R', /(up_?leg|upper_?leg|thigh)/i, /(^(left|right)?leg$|lower_?leg|shin|calf|leg[._-]?[lr]$)/i, /foot/i) },
    head: findBone(root, /^head$|head$/i, undefined, /(top|end)/i),
    spine: findBone(root, /spine2|chest|spine1|upperchest/i),
    mouth,
  };
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();

/** Rotates `bone` (in world space) so the direction bone→child matches `dirModel` (in the character's space). */
function aim(bone: THREE.Bone, child: THREE.Object3D, dirModel: THREE.Vector3, root: THREE.Object3D): void {
  bone.updateMatrixWorld(true);
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  const current = _b.sub(_a).normalize();
  const target = dirModel.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize();
  _q.setFromUnitVectors(current, target);
  bone.getWorldQuaternion(_wq);
  const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(_pq) : _pq.identity();
  bone.quaternion.copy(parentWorld.clone().invert().multiply(_q.multiply(_wq)));
  bone.updateMatrixWorld(true);
}

const rad = THREE.MathUtils.degToRad;
/** Direction for an angle measured from straight down (+ = toward screen-right), with a forward reach. */
const dir = (deg: number, fwdDeg: number): THREE.Vector3 => {
  const f = rad(fwdDeg);
  return new THREE.Vector3(Math.sin(rad(deg)) * Math.cos(f), -Math.cos(rad(deg)) * Math.cos(f), Math.sin(f) + 0.0001).normalize();
};

function applyPose(rig: Rig, p: BonePose, talk: number, t: number, walking: boolean): void {
  for (const [bone, q] of rig.bind) bone.quaternion.copy(q);
  rig.root.updateMatrixWorld(true);
  // The character faces the camera, so its LEFT arm appears on screen-right ("ra").
  const arms: [THREE.Bone[], Limb][] = [
    [rig.arm.L, p.ra],
    [rig.arm.R, p.la],
  ];
  for (const [bones, limb] of arms) {
    if (bones.length < 3) continue;
    const swing = walking ? Math.sin(t * 9) * (bones === rig.arm.L ? 1 : -1) * 25 : 0;
    aim(bones[0], bones[1], dir(limb[0], p.armFwd + swing), rig.root);
    aim(bones[1], bones[2], dir(limb[0] + limb[1], p.armFwd + 10 + swing * 0.5), rig.root);
  }
  const legs: [THREE.Bone[], Limb, number][] = [
    [rig.leg.L, p.rl, 1],
    [rig.leg.R, p.ll, -1],
  ];
  for (const [bones, limb, side] of legs) {
    if (bones.length < 3) continue;
    const swing = walking ? Math.sin(t * 9) * side * 28 : 0;
    const knee = walking ? Math.max(0, -Math.sin(t * 9) * side) * 30 : 0;
    aim(bones[0], bones[1], dir(limb[0], swing), rig.root);
    aim(bones[1], bones[2], dir(limb[0] + limb[1], swing - knee), rig.root);
  }
  if (rig.spine) {
    rig.spine.rotateY(rad(p.turn * 0.3));
    rig.spine.rotateX(rad(Math.sin(t * 2.2) * 1.2));
  }
  if (rig.head) {
    rig.head.rotateY(rad(p.turn * 0.7));
    rig.head.rotateZ(rad(-p.tilt));
    rig.head.rotateX(rad(talk * 4 + Math.sin(t * 1.7) * 1.5));
  }
  for (const m of rig.mouth) if (m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.index] = talk * 0.7;
}

/** A posed instance of the installed character model. Suspends rendering until the model has loaded. */
export const ModelCharacter: React.FC<{ file: string; pose: BonePose; talk: number; t: number; walking: boolean; height?: number }> = ({ file, pose, talk, t, walking, height = 2.35 }) => {
  const [src, setSrc] = useState<THREE.Group | null>(null);
  const [handle] = useState(() => delayRender(`Loading character ${file}`));
  useEffect(() => {
    loadModel(file)
      .then(setSrc)
      .catch((err) => {
        console.error(`Character model ${file} failed to load`, err);
        continueRender(handle);
      });
  }, [file, handle]);
  const rig = useMemo(() => (src ? buildRig(src, height) : null), [src, height]);
  // The 3D canvas only repaints when the video frame changes, so after the model arrives asynchronously
  // force one repaint, then release the frame for capture.
  const { advance } = useThree();
  useEffect(() => {
    if (!rig) return;
    advance(performance.now());
    requestAnimationFrame(() => continueRender(handle));
  }, [rig, handle, advance]);
  if (!rig) return null;
  applyPose(rig, pose, talk, t, walking);
  return <primitive object={rig.root} />;
};
