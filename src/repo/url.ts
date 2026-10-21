import { UserError } from '../core/errors.js';

export interface RepoRef {
  owner: string;
  name: string;
  url: string;
  ref?: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** Accepts https://github.com/owner/repo[.git][/tree/<ref>] and returns a normalized identity. */
export function parseGithubUrl(input: string, ref?: string): RepoRef {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new UserError(`"${input}" is not a valid URL.`, 'Use a URL like https://github.com/OWNER/REPOSITORY');
  }
  if (u.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(u.hostname)) {
    throw new UserError(`Only https://github.com URLs are supported (got ${u.origin}).`);
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new UserError(`Missing owner or repository in ${input}.`);
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/, '');
  if (!NAME.test(owner) || !NAME.test(name) || /^[-.]/.test(owner) || /^[-.]/.test(name)) {
    throw new UserError(`Invalid owner or repository name in ${input}.`);
  }
  let pinned = ref;
  if (!pinned && parts[2] === 'tree' && parts[3]) pinned = decodeURIComponent(parts.slice(3).join('/'));
  if (pinned && (!/^[A-Za-z0-9_./-]{1,200}$/.test(pinned) || /^[-.]|\.\.|\/\//.test(pinned))) throw new UserError(`Invalid ref "${pinned}".`);
  return { owner, name, url: `https://github.com/${owner}/${name}`, ref: pinned };
}
