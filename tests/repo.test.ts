import { describe, expect, it } from 'vitest';
import { parseGithubUrl } from '../src/repo/url.js';
import { isSecretPath, redactSecrets } from '../src/repo/security.js';
import { analyzedFixture } from './helpers.js';

describe('parseGithubUrl', () => {
  it('normalizes owner/repo and strips .git', () => {
    expect(parseGithubUrl('https://github.com/Owner/Repo.git')).toMatchObject({ owner: 'Owner', name: 'Repo', url: 'https://github.com/Owner/Repo' });
  });
  it('reads a ref from /tree/ URLs', () => {
    expect(parseGithubUrl('https://github.com/a/b/tree/v1.2.0').ref).toBe('v1.2.0');
  });
  it('rejects non-GitHub and malformed URLs', () => {
    expect(() => parseGithubUrl('https://gitlab.com/a/b')).toThrow(/github/);
    expect(() => parseGithubUrl('http://github.com/a/b')).toThrow();
    expect(() => parseGithubUrl('https://github.com/onlyowner')).toThrow(/Missing/);
    expect(() => parseGithubUrl('not a url')).toThrow(/valid URL/);
    expect(() => parseGithubUrl('https://github.com/a/b', 'x;rm -rf /')).toThrow(/Invalid ref/);
  });
});

describe('security', () => {
  it('redacts credentials', () => {
    const { text, count } = redactSecrets('key = "sk-abcdefghijklmnopqrstuvwxyz" and ghp_' + 'a'.repeat(36));
    expect(text).not.toContain('sk-abcdef');
    expect(text).not.toContain('ghp_aaaa');
    expect(count).toBeGreaterThanOrEqual(2);
  });
  it('flags secret files but not .env.example', () => {
    expect(isSecretPath('.env')).toBe(true);
    expect(isSecretPath('config/.env.production')).toBe(true);
    expect(isSecretPath('keys/server.pem')).toBe(true);
    expect(isSecretPath('.env.example')).toBe(false);
  });
});

describe('repository analysis', () => {
  const { inv, analysis, knowledge } = analyzedFixture();

  it('skips secrets, dependencies and escaping symlinks', () => {
    const paths = inv.files.map((f) => f.path);
    expect(paths).not.toContain('.env');
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
    expect(paths).not.toContain('escape.txt');
    expect(inv.files.find((f) => f.path === 'src/config.js')!.text).not.toContain('sk-test123');
  });

  it('extracts a verified purpose with evidence', () => {
    expect(analysis.kind).toBe('repo');
    if (analysis.kind !== 'repo') return;
    expect(analysis.purpose.status).toBe('verified');
    expect(analysis.purpose.text).toMatch(/priority queue/i);
    expect(analysis.purpose.evidence[0].path).toBe('README.md');
  });

  it('builds the import graph and ranks the core module', () => {
    if (analysis.kind !== 'repo') return;
    const edges = analysis.importGraph.edges.map((e) => `${e.from}->${e.to}`);
    expect(edges).toContain('src/index.js->src/queue.js');
    expect(analysis.keyFiles.slice(0, 3).map((k) => k.path)).toContain('src/queue.js');
    expect(analysis.entryPoints.map((e) => e.path)).toContain('src/index.js');
  });

  it('detects license, tests and README commands without running anything', () => {
    if (analysis.kind !== 'repo') return;
    expect(analysis.license.spdx).toBe('MIT');
    expect(analysis.tests.files).toContain('test/queue.test.js');
    expect(analysis.tests.executed).toBe(false);
    expect(analysis.usageCommands.map((c) => c.command)).toContain('npm install tinyqueue-lite');
  });

  it('documents modules from their own doc comments', () => {
    if (analysis.kind !== 'repo') return;
    const q = analysis.modules.find((m) => m.path === 'src/queue.js')!;
    expect(q.responsibility).toMatchObject({ status: 'verified', text: 'A binary-heap priority queue.' });
  });

  it('builds a knowledge base with line-accurate chunks', () => {
    const c = knowledge.chunks.find((x) => x.path === 'src/queue.js')!;
    expect(c.startLine).toBe(1);
    expect(c.text).toContain('class PriorityQueue');
  });
});
