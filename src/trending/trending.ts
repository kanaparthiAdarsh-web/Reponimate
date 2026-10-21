import { UserError } from '../core/errors.js';
import type { JobInput, Mode } from '../core/schemas.js';
import { decodeEntities } from '../docs/html.js';

export interface TrendingItem {
  label: string;
  detail?: string;
  source: string;
  url: string;
  input: Partial<JobInput> & { mode: Mode };
}

const UA = { 'user-agent': 'Reponimate/0.1 (local educational video generator)' };
const get = async (url: string, accept = 'application/json'): Promise<Response> => {
  const res = await fetch(url, { headers: { ...UA, accept }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
};

/** Repositories created in the last week with the most stars (GitHub search API, no key needed). */
export async function githubRising(limit = 10): Promise<TrendingItem[]> {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const res = await get(`https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=${limit}`, 'application/vnd.github+json');
  const j = (await res.json()) as { items: { full_name: string; html_url: string; description: string | null; stargazers_count: number; language: string | null }[] };
  return j.items.map((r) => ({
    label: r.full_name,
    detail: `${r.description ?? ''} · ★${r.stargazers_count}${r.language ? ` · ${r.language}` : ''}`,
    source: 'GitHub (new repos, most stars this week)',
    url: r.html_url,
    input: { mode: 'repo-video', repoUrl: r.html_url },
  }));
}

/** github.com/trending page (HTML). Used when the search API is rate-limited. */
export async function githubTrendingPage(limit = 10): Promise<TrendingItem[]> {
  const html = await (await get('https://github.com/trending', 'text/html')).text();
  const items: TrendingItem[] = [];
  for (const m of html.matchAll(/<h2 class="h3 lh-condensed">\s*<a[^>]*href="\/([^"/]+\/[^"/]+)"[\s\S]*?<\/h2>\s*(?:<p[^>]*>([\s\S]*?)<\/p>)?/g)) {
    const full = m[1];
    items.push({ label: full, detail: decodeEntities((m[2] ?? '').replace(/<[^>]+>/g, '').trim()), source: 'GitHub Trending', url: `https://github.com/${full}`, input: { mode: 'repo-video', repoUrl: `https://github.com/${full}` } });
    if (items.length >= limit) break;
  }
  return items;
}

/** Hacker News front page via the official Firebase API. Show HN posts with GitHub links become repo candidates. */
export async function hackerNews(limit = 30): Promise<{ title: string; url?: string; score: number }[]> {
  const ids = ((await (await get('https://hacker-news.firebaseio.com/v0/topstories.json')).json()) as number[]).slice(0, limit);
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        return (await (await get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json()) as { title: string; url?: string; score: number };
      } catch {
        return null;
      }
    }),
  );
  return items.filter((x): x is { title: string; url?: string; score: number } => Boolean(x?.title));
}

/** Most-read Wikipedia articles yesterday (Wikimedia feed API). */
export async function wikipediaMostRead(limit = 15): Promise<TrendingItem[]> {
  const d = new Date(Date.now() - 864e5);
  const ymd = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  const j = (await (await get(`https://en.wikipedia.org/api/rest_v1/feed/featured/${ymd}`)).json()) as {
    mostread?: { articles: { normalizedtitle: string; description?: string; views: number; content_urls: { desktop: { page: string } } }[] };
  };
  return (j.mostread?.articles ?? [])
    .filter((a) => !/^(Main Page|Special:|Deaths in|List of|Wikipedia:)/.test(a.normalizedtitle))
    .slice(0, limit)
    .map((a) => ({
      label: a.normalizedtitle,
      detail: `${a.description ?? ''} · ${a.views.toLocaleString('en-US')} views`,
      source: 'Wikipedia most read (yesterday)',
      url: a.content_urls.desktop.page,
      input: { mode: 'doc-video', topic: a.normalizedtitle },
    }));
}

/** Candidate topics for a mode, from several free sources; failures of one source do not stop the others. */
export async function trendingFor(mode: Mode): Promise<{ items: TrendingItem[]; errors: string[] }> {
  const errors: string[] = [];
  const attempt = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn();
    } catch (err) {
      errors.push((err as Error).message);
      return [];
    }
  };
  if (mode === 'repo-video') {
    let items = await attempt(() => githubRising());
    if (!items.length) items = await attempt(() => githubTrendingPage());
    if (!items.length) {
      const hn = await attempt(() => hackerNews());
      items = hn
        .filter((h) => h.url && /^https:\/\/github\.com\/[^/]+\/[^/#?]+\/?$/.test(h.url))
        .map((h) => ({ label: h.url!.replace('https://github.com/', ''), detail: h.title, source: 'Hacker News', url: h.url!, input: { mode: 'repo-video' as const, repoUrl: h.url!.replace(/\/$/, '') } }));
    }
    return { items, errors };
  }
  const wiki = await attempt(() => wikipediaMostRead());
  const hn = await attempt(() => hackerNews(20));
  const hnItems: TrendingItem[] = hn
    .filter((h) => !/^(Ask|Tell) HN/.test(h.title))
    .slice(0, 10)
    .map((h) => ({
      label: h.title.replace(/^Show HN:\s*/, ''),
      detail: `${h.score} points on Hacker News`,
      source: 'Hacker News front page',
      url: h.url ?? 'https://news.ycombinator.com',
      // Prefer the linked article itself; fall back to researching the title on Wikipedia.
      input: h.url ? { mode, urls: [h.url], textTitle: h.title.replace(/^Show HN:\s*/, '') } : { mode, topic: h.title },
    }));
  const items = [...wiki.map((w) => ({ ...w, input: { ...w.input, mode } })), ...hnItems];
  return { items, errors };
}

/** Autopilot: take the top candidate. */
export async function pickTrending(mode: Mode): Promise<TrendingItem> {
  const { items, errors } = await trendingFor(mode);
  if (!items.length) throw new UserError(`Could not find a trending topic (${errors.join('; ') || 'no results'}).`, 'Check your internet connection or enter a topic manually.');
  return items[0];
}
