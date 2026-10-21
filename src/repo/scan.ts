import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/config.js';
import { run } from '../core/exec.js';
import type { Logger } from '../core/logger.js';
import { buildInventory, categorize, languageOf, type Inventory } from './inventory.js';

interface RustScan {
  files: { path: string; bytes: number; lines: number; text: string }[];
  skipped: { path: string; reason: string }[];
  redactions: number;
  totalBytes: number;
}

export function rustScannerPath(): string | null {
  const candidates = [
    process.env.REPONIMATE_SCAN ?? '',
    path.join(ROOT, 'crates', 'reponimate-scan', 'target', 'release', 'reponimate-scan'),
    path.join(ROOT, 'crates', 'reponimate-scan', 'target', 'release', 'reponimate-scan.exe'),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

let announced = false;

/**
 * Inventories a repository with the Rust scanner (parallel, fast) when it has been built with
 * `npm run build:rust`, otherwise with the equivalent TypeScript implementation.
 */
export async function scanRepository(
  root: string,
  limits: { maxFileBytes: number; maxTotalBytes: number; maxFiles: number },
  log?: Logger,
): Promise<Inventory> {
  const bin = rustScannerPath();
  if (bin) {
    try {
      const r = await run(bin, [root, '--max-file-bytes', String(limits.maxFileBytes), '--max-total-bytes', String(limits.maxTotalBytes), '--max-files', String(limits.maxFiles)], { timeoutMs: 120_000 });
      if (r.code === 0) {
        const j = JSON.parse(r.stdout) as RustScan;
        if (!announced) log?.info('scanner: Rust (reponimate-scan)');
        announced = true;
        return {
          root,
          files: j.files.map((f) => {
            const language = languageOf(f.path);
            return { ...f, language, category: categorize(f.path, language) };
          }),
          skipped: j.skipped,
          redactions: j.redactions,
          totalBytes: j.totalBytes,
        };
      }
      log?.warn(`Rust scanner failed (${r.stderr.slice(0, 200)}); falling back to the TypeScript scanner.`);
    } catch (err) {
      log?.warn(`Rust scanner unavailable (${(err as Error).message}); falling back to the TypeScript scanner.`);
    }
  } else if (!announced) {
    log?.info('scanner: TypeScript (run `npm run build:rust` for the faster Rust scanner)');
    announced = true;
  }
  return buildInventory(root, limits);
}
