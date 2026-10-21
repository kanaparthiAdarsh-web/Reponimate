import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildInventory } from '../src/repo/inventory.js';
import { analyzeRepo } from '../src/repo/analyze.js';
import { factChunks } from '../src/script/facts.js';

export const FIXTURE_REPO = path.join(__dirname, 'fixtures', 'sample-repo');
export const FIXTURE_DOC = path.join(__dirname, 'fixtures', 'sample-doc.md');
export const LIMITS = { maxFileBytes: 512 * 1024, maxTotalBytes: 40 * 1024 * 1024, maxFiles: 5000 };

/** Copies the fixture repo to a temp dir and adds files git would ignore (.env, a symlink escaping the repo). */
export function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reponimate-'));
  fs.cpSync(FIXTURE_REPO, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET_TOKEN=abcdef1234567890\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'bundle.js'), 'var a=' + '1+'.repeat(1500) + '1;\n');
  fs.writeFileSync(path.join(dir, '.npmrc'), '//registry.npmjs.org/:_authToken=npm_secret\n');
  try {
    fs.symlinkSync('/etc/passwd', path.join(dir, 'escape.txt'));
  } catch {
    /* symlinks may be unavailable on some systems */
  }
  return dir;
}

export function analyzedFixture() {
  const dir = tempRepo();
  const inv = buildInventory(dir, LIMITS);
  const res = analyzeRepo({ owner: 'example', name: 'tinyqueue-lite', url: 'https://github.com/example/tinyqueue-lite', dir, commitSha: 'a'.repeat(40) }, inv);
  res.knowledge.chunks.push(...factChunks(res.analysis, 1));
  return { dir, inv, ...res };
}
