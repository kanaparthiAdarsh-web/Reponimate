import { describe, expect, it } from 'vitest';
import { buildInventory } from '../src/repo/inventory.js';
import { rustScannerPath, scanRepository } from '../src/repo/scan.js';
import { LIMITS, tempRepo } from './helpers.js';

describe.skipIf(!rustScannerPath())('Rust scanner', () => {
  it('matches the TypeScript scanner on the fixture repo', async () => {
    const dir = tempRepo();
    const rust = await scanRepository(dir, LIMITS);
    const ts = buildInventory(dir, LIMITS);
    expect(rust.files.map((f) => f.path)).toEqual(ts.files.map((f) => f.path));
    expect(rust.files.map((f) => f.text)).toEqual(ts.files.map((f) => f.text));
    expect(rust.files.map((f) => f.category)).toEqual(ts.files.map((f) => f.category));
    expect(rust.redactions).toBe(ts.redactions);
    expect(rust.skipped.map((s) => s.path).sort()).toEqual(ts.skipped.map((s) => s.path).sort());
  });
});
