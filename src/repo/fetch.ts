import fs from 'node:fs';
import path from 'node:path';
import { run } from '../core/exec.js';
import { UserError, withRetry } from '../core/errors.js';
import type { RepoRef } from './url.js';

export interface FetchedRepo extends RepoRef {
  dir: string;
  commitSha: string;
}

/**
 * Shallow-clones a repository into `cacheDir`. Never runs install or build scripts:
 * hooks are disabled and LFS smudge is skipped so no repository code executes.
 */
export async function fetchRepo(
  repo: RepoRef,
  cacheDir: string,
  opts: { token?: string; timeoutMs: number },
): Promise<FetchedRepo> {
  const dir = path.join(cacheDir, `${repo.owner}__${repo.name}${repo.ref ? '@' + repo.ref.replace(/\//g, '_') : ''}`);
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const safety = ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', '-c', 'core.symlinks=true'];

  // A cached clone of a moving branch goes stale; re-clone after an hour. Pinned commit SHAs never change.
  const pinnedSha = Boolean(repo.ref && /^[0-9a-f]{40}$/.test(repo.ref));
  if (!pinnedSha && fs.existsSync(path.join(dir, '.git')) && Date.now() - fs.statSync(path.join(dir, '.git')).mtimeMs > 3600_000) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const cloneUrl = opts.token
      ? `https://x-access-token:${opts.token}@github.com/${repo.owner}/${repo.name}.git`
      : `${repo.url}.git`;
    await withRetry(async () => {
      fs.rmSync(dir, { recursive: true, force: true });
      const args = [...safety, 'clone', '--depth', '1', '--no-tags', '--single-branch'];
      if (repo.ref && !/^[0-9a-f]{7,40}$/.test(repo.ref)) args.push('--branch', repo.ref);
      args.push(cloneUrl, dir);
      const r = await run('git', args, { env, timeoutMs: opts.timeoutMs });
      if (r.code !== 0) {
        const msg = r.stderr.replace(/x-access-token:[^@]+@/g, '***@');
        if (/not found|could not read Username|Authentication failed|403/.test(msg)) {
          throw new UserError(
            `Repository ${repo.url} is not accessible (missing, private, or rate-limited).`,
            'Check the URL. For private repos set GITHUB_TOKEN in .env.',
          );
        }
        if (/Remote branch .* not found/.test(msg)) throw new UserError(`Ref "${repo.ref}" was not found in ${repo.url}.`);
        throw new Error(`git clone failed: ${msg.slice(-500)}`);
      }
    }, 3, 2000);
    // A commit SHA cannot be shallow-cloned by name; fetch it explicitly.
    if (repo.ref && /^[0-9a-f]{7,40}$/.test(repo.ref)) {
      const f = await run('git', [...safety, '-C', dir, 'fetch', '--depth', '1', 'origin', repo.ref], { env, timeoutMs: opts.timeoutMs });
      if (f.code !== 0) throw new UserError(`Commit ${repo.ref} could not be fetched from ${repo.url}.`);
      await run('git', [...safety, '-C', dir, '-c', 'advice.detachedHead=false', 'checkout', 'FETCH_HEAD'], { env });
    }
  }
  const sha = await run('git', ['-C', dir, 'rev-parse', 'HEAD'], { env });
  if (sha.code !== 0) throw new UserError(`Repository ${repo.url} appears to be empty (no commits).`);
  return { ...repo, dir, commitSha: sha.stdout.trim() };
}
