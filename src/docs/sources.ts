import type { Source } from '../core/schemas.js';
import { UserError } from '../core/errors.js';
import { redactSecrets } from '../repo/security.js';
import { htmlToText } from './html.js';
import { safeFetchText } from '../core/netguard.js';

export interface LoadedDoc {
  source: Source;
  text: string;
}

const UA = 'Reponimate/0.1 (local educational video generator; https://github.com/kanaparthiAdarsh-web/Reponimate)';

export function fromText(text: string, title?: string): LoadedDoc {
  const clean = redactSecrets(text.replace(/\r\n/g, '\n')).text.trim();
  if (clean.split(/\s+/).length < 30) {
    throw new UserError('The description is too short to make a video from.', 'Paste at least a few paragraphs (30+ words) of documentation.');
  }
  if (clean.length > 500_000) throw new UserError('The description is too long (over 500,000 characters). Split it into smaller documents.');
  const heading = clean.match(/^#\s+(.+)$/m)?.[1];
  return { source: { id: 'doc1', kind: 'text', title: title || heading || clean.split(/[.\n]/)[0].slice(0, 60) }, text: clean };
}

export async function fromUrl(url: string, id: string): Promise<LoadedDoc> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UserError(`"${url}" is not a valid URL.`);
  }
  const { text: raw, type } = await safeFetchText(u.href, { maxBytes: 3_000_000, timeoutMs: 20_000, headers: { 'user-agent': UA } });
  const { title, text } = /html/.test(type) ? htmlToText(raw) : { title: u.pathname.split('/').pop() || u.hostname, text: raw };
  return { source: { id, kind: 'web', title: title || u.hostname, url }, text: redactSecrets(text).text };
}

/** Plain-text Wikipedia article. Content is CC BY-SA 4.0 — the attribution is carried into the video description. */
export async function fromWikipedia(topic: string, id: string, lang = 'en'): Promise<LoadedDoc> {
  const api = `https://${lang}.wikipedia.org/w/api.php?` +
    new URLSearchParams({ action: 'query', format: 'json', prop: 'extracts|info', explaintext: '1', exsectionformat: 'wiki', inprop: 'url', redirects: '1', titles: topic, origin: '*' });
  const res = await fetch(api, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new UserError(`Wikipedia request failed (HTTP ${res.status}).`);
  const j = (await res.json()) as { query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string; missing?: string }> } };
  const page = Object.values(j.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || !page.extract) throw new UserError(`No Wikipedia article found for "${topic}".`);
  // Convert "== Heading ==" to markdown and drop reference-only sections.
  const text = page.extract
    .replace(/^(=+)\s*(.+?)\s*=+\s*$/gm, (_, eq: string, h: string) => `${'#'.repeat(Math.min(4, eq.length))} ${h}`)
    .split(/\n(?=#{2} )/)
    .filter((sec) => !/^## (See also|References|External links|Further reading|Notes|Bibliography|Sources)\b/.test(sec))
    .join('\n');
  return {
    source: {
      id,
      kind: 'wikipedia',
      title: page.title,
      url: page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      license: 'CC BY-SA 4.0',
      attribution: `"${page.title}" from Wikipedia, the free encyclopedia, licensed under CC BY-SA 4.0`,
    },
    text: `# ${page.title}\n\n${text}`,
  };
}

export async function searchWikipedia(query: string, lang = 'en'): Promise<string | null> {
  const api = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ action: 'opensearch', format: 'json', limit: '1', search: query, origin: '*' });
  const res = await fetch(api, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as [string, string[]];
  return j[1]?.[0] ?? null;
}
