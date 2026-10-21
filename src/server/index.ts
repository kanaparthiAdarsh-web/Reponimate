import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ZodError } from 'zod';
import { loadConfig, ROOT } from '../core/config.js';
import { commandExists } from '../core/exec.js';
import { formatError, UserError } from '../core/errors.js';
import { JobInputSchema, ModeSchema, type JobInput } from '../core/schemas.js';
import { STAGES } from '../pipeline/stages.js';
import { rustScannerPath } from '../repo/scan.js';
import { parseGithubUrl } from '../repo/url.js';
import { pickTrending, trendingFor } from '../trending/trending.js';
import { JobManager, type Job } from './jobs.js';

const cfg = loadConfig();
const jobs = new JobManager(cfg);
const app = express();
app.disable('x-powered-by');

/**
 * The studio can clone repos and spend CPU for hours, so only the local user may drive it:
 * - Host must be a local name (blocks DNS-rebinding attacks from web pages);
 * - state-changing requests must come from the studio's own origin (blocks CSRF from other sites).
 * Set ALLOWED_HOSTS to a comma-separated list when serving behind your own reverse proxy.
 */
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)]);
export function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return allowedHosts.has(host);
}
app.use((req, res, next) => {
  if (!hostAllowed(req.headers.host)) return void res.status(403).json({ error: 'Host not allowed' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    let originHost: string | undefined;
    try {
      originHost = origin ? new URL(origin).host : undefined;
    } catch {
      originHost = 'invalid';
    }
    if (origin && !hostAllowed(originHost)) return void res.status(403).json({ error: 'Cross-origin request blocked' });
    if (!req.is('application/json')) return void res.status(415).json({ error: 'Send JSON' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'");
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'src', 'web')));

const publicJob = (j: Job) => {
  const files = fs.existsSync(j.dir) ? fs.readdirSync(j.dir).filter((f) => fs.statSync(path.join(j.dir, f)).isFile()) : [];
  return { id: j.id, label: j.label, mode: j.input.mode, status: j.status, stage: j.stage, stageIndex: j.stageIndex, progress: j.progress, error: j.error, createdAt: j.createdAt, files, stages: STAGES.map((s) => s.name) };
};

/** Maps errors to safe responses: user mistakes get their message, internal errors never leak stacks or paths. */
const wrap = (fn: (req: express.Request, res: express.Response) => Promise<void>) => (req: express.Request, res: express.Response) =>
  fn(req, res).catch((err) => {
    if (err instanceof UserError) return void res.status(400).json({ error: formatError(err) });
    if (err instanceof ZodError) return void res.status(400).json({ error: `Invalid request: ${err.issues.map((i) => `${i.path.join('.') || 'value'} ${i.message}`).join('; ').slice(0, 300)}` });
    console.error(err);
    res.status(500).json({ error: 'Internal error — see the server console.' });
  });

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) return next();
  res.status(err.status ?? 400).json({ error: err.message.slice(0, 200) });
});

app.get('/api/health', wrap(async (_req, res) => {
  let ollama = false;
  let models: string[] = [];
  try {
    const r = await fetch(`${cfg.llm.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
    ollama = r.ok;
    models = ((await r.json()) as { models: { name: string }[] }).models.map((m) => m.name);
  } catch {
    /* not running */
  }
  res.json({
    llm: { provider: cfg.llm.provider, model: cfg.llm.ollamaModel, ollama, models },
    tts: { provider: cfg.tts.provider, piperVoice: fs.existsSync(cfg.tts.piperVoice), espeak: await commandExists('espeak-ng') },
    ffmpeg: await commandExists('ffmpeg'),
    browser: cfg.render.browserExecutable || null,
    rustScanner: Boolean(rustScannerPath()),
  });
}));

app.get('/api/trending', wrap(async (req, res) => {
  const mode = ModeSchema.parse(req.query.mode ?? 'repo-video');
  res.json(await trendingFor(mode));
}));

function toInput(body: Record<string, unknown>): { input: JobInput; label: string } {
  const mode = ModeSchema.parse(body.mode);
  const channelName = typeof body.channelName === 'string' && body.channelName.trim() ? body.channelName.trim() : cfg.channelName || undefined;
  const text = typeof body.text === 'string' ? body.text : undefined;
  const url = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : undefined;
  const topic = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : undefined;
  if (mode === 'repo-video') {
    const repo = parseGithubUrl(String(body.repoUrl ?? ''));
    return { input: JobInputSchema.parse({ mode, repoUrl: repo.url, ref: repo.ref, preview: Boolean(body.preview), channelName }), label: `${repo.owner}/${repo.name}` };
  }
  if (!text?.trim() && !url && !topic) throw new UserError('Paste some documentation, give a URL, or enter a topic.');
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined;
  return {
    input: JobInputSchema.parse({ mode, text: text?.trim() || undefined, textTitle: title, urls: url ? [url] : [], topic, preview: Boolean(body.preview), channelName }),
    label: title ?? topic ?? url ?? text!.trim().split('\n')[0].slice(0, 50),
  };
}

app.post('/api/jobs', wrap(async (req, res) => {
  const { input, label } = toInput(req.body ?? {});
  const llm = typeof req.body.llm === 'string' && req.body.llm ? req.body.llm : undefined;
  res.json(publicJob(jobs.create(input, label, llm)));
}));

app.post('/api/autopilot', wrap(async (req, res) => {
  const mode = ModeSchema.parse(req.body?.mode);
  const pick = await pickTrending(mode);
  const channelName = typeof req.body?.channelName === 'string' && req.body.channelName.trim() ? req.body.channelName.trim() : cfg.channelName || undefined;
  const input = JobInputSchema.parse({ ...pick.input, mode, preview: Boolean(req.body?.preview), channelName });
  const llm = typeof req.body.llm === 'string' && req.body.llm ? req.body.llm : undefined;
  res.json({ pick: { label: pick.label, source: pick.source, url: pick.url }, job: publicJob(jobs.create(input, pick.label, llm)) });
}));

app.get('/api/jobs', (_req, res) => {
  res.json(jobs.list().map(publicJob));
});

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return void res.status(404).json({ error: 'not found' });
  const read = (f: string) => (fs.existsSync(path.join(j.dir, f)) ? JSON.parse(fs.readFileSync(path.join(j.dir, f), 'utf8')) : null);
  res.json({ ...publicJob(j), logs: j.logs.slice(-200), metadata: read('metadata.json'), quality: read('quality-report.json') });
});

app.post('/api/jobs/:id/resume', (req, res) => {
  const from = typeof req.body?.from === 'string' ? req.body.from : undefined;
  const j = jobs.resume(req.params.id, from);
  if (!j) return void res.status(404).json({ error: 'not found' });
  res.json(publicJob(j));
});

app.get('/api/jobs/:id/events', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return void res.status(404).end();
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('snapshot', publicJob(j));
  const off = jobs.subscribe(j.id, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    off();
    clearInterval(ping);
  });
});

/** Serves generated files; the path is confined to the job directory. */
app.get('/files/:id/:file', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return void res.status(404).end();
  const file = path.resolve(j.dir, req.params.file);
  if (!file.startsWith(path.resolve(j.dir) + path.sep) || !fs.existsSync(file)) return void res.status(404).end();
  res.sendFile(file);
});

export { app, jobs };

if (!process.env.REPONIMATE_NO_LISTEN) {
  app.listen(cfg.port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(`Reponimate studio → http://localhost:${cfg.port}`);
  });
}
