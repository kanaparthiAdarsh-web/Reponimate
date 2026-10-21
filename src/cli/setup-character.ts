import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/config.js';

/**
 * Checks a rigged character model placed in models/character/. Quaternius distributes its free characters
 * through Google Drive, so the download is manual; this script validates the file you saved.
 */
const dir = path.join(ROOT, 'models', 'character');
fs.mkdirSync(dir, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => /\.(glb|gltf)$/i.test(f));
if (!files.length) {
  console.log(`No character model found in ${dir}.

Get a free, rigged, textured character (no credit required, commercial use OK):
  1. Open https://quaternius.com/packs/ultimatemodularcharacters.html (or /packs/animatedmen.html)
  2. Press Download → open the Google Drive folder → download the glTF/GLB version
  3. Copy one character .glb (e.g. a casual male) into: ${dir}
  4. Run this command again to check it.

Mixamo (mixamo.com) and Ready Player Me avatars also work: export as GLB and drop it in the same folder.
Without a model, videos use the built-in toon-shaded 3D boy.`);
  process.exit(0);
}
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  if (!f.endsWith('.glb') || buf.readUInt32LE(0) !== 0x46546c67) {
    console.log(`• ${f}: not a binary glTF (.glb); export as GLB for best results.`);
    continue;
  }
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const names: string[] = (json.nodes ?? []).map((n: { name?: string }) => (n.name ?? '').replace(/^mixamorig[:_]?/i, ''));
  const has = (re: RegExp) => names.some((n) => re.test(n));
  const checks = {
    skeleton: (json.skins ?? []).length > 0,
    arms: has(/(upper_?arm|^(left|right)arm$|arm[._-]?[lr]$)/i) && has(/(fore_?arm|lower_?arm)/i),
    legs: has(/(up_?leg|upper_?leg|thigh)/i),
    head: has(/head/i),
    textures: (json.images ?? []).length > 0,
    mouthMorph: JSON.stringify(json.meshes ?? []).match(/jawOpen|mouthOpen|viseme_aa/) !== null,
  };
  console.log(`• ${f} (${(buf.length / 1e6).toFixed(1)} MB)`);
  for (const [k, v] of Object.entries(checks)) console.log(`   ${v ? '✔' : k === 'mouthMorph' ? '–' : '✖'} ${k}${k === 'mouthMorph' && !v ? ' (no blend shapes: head nods while talking)' : ''}`);
}
console.log(`\nThe first file is used automatically (or set CHARACTER_MODEL=<file name> in .env).`);
