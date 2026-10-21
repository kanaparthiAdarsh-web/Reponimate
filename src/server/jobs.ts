import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../core/config.js';
import { formatError } from '../core/errors.js';
import { slugify } from '../core/files.js';
import { Logger } from '../core/logger.js';
import type { JobInput } from '../core/schemas.js';
import { runPipeline } from '../pipeline/runner.js';
import { STAGES } from '../pipeline/stages.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  dir: string;
  input: JobInput;
  label: string;
  status: JobStatus;
  stage?: string;
  stageIndex: number;
  progress: number;
  logs: { level: string; message: string; at: string }[];
  error?: string;
  createdAt: string;
  llm?: string;
  resumeFrom?: string;
}

type Listener = (event: string, data: unknown) => void;

/** In-process queue. Video jobs are heavy, so they run strictly one at a time. */
export class JobManager {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(private cfg: AppConfig) {
    this.loadExisting();
  }

  private loadExisting(): void {
    if (!fs.existsSync(this.cfg.outDir)) return;
    for (const name of fs.readdirSync(this.cfg.outDir)) {
      const f = path.join(this.cfg.outDir, name, 'job.json');
      if (!fs.existsSync(f)) continue;
      try {
        const st = JSON.parse(fs.readFileSync(f, 'utf8'));
        const done = fs.existsSync(path.join(this.cfg.outDir, name, 'quality-report.json'));
        this.jobs.set(name, {
          id: name,
          dir: path.join(this.cfg.outDir, name),
          input: st.input,
          label: st.input.repoUrl ?? st.input.textTitle ?? st.input.topic ?? name,
          status: done ? 'done' : 'failed',
          stageIndex: done ? STAGES.length : 0,
          progress: done ? 1 : 0,
          logs: [],
          error: done ? undefined : 'Interrupted or failed earlier — press Resume to continue from cache.',
          createdAt: st.createdAt,
        });
      } catch {
        /* ignore unreadable job folders */
      }
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  subscribe(id: string, l: Listener): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(l);
    this.listeners.set(id, set);
    return () => set.delete(l);
  }

  private emit(job: Job, event: string, data: unknown): void {
    for (const l of this.listeners.get(job.id) ?? []) l(event, data);
    for (const l of this.listeners.get('*') ?? []) l(event, { id: job.id, ...((data as object) ?? {}) });
  }

  create(input: JobInput, label: string, llm?: string): Job {
    const id = `${new Date().toISOString().slice(0, 10)}-${slugify(label, 40)}-${crypto.randomBytes(3).toString('hex')}`;
    const job: Job = { id, dir: path.join(this.cfg.outDir, id), input, label, status: 'queued', stageIndex: 0, progress: 0, logs: [], createdAt: new Date().toISOString(), llm };
    this.jobs.set(id, job);
    this.queue.push(id);
    void this.pump();
    return job;
  }

  resume(id: string, from?: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job || job.status === 'running' || job.status === 'queued') return job;
    job.status = 'queued';
    job.error = undefined;
    job.resumeFrom = from;
    this.queue.push(id);
    void this.pump();
    return job;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const id = this.queue.shift();
    if (!id) return;
    const job = this.jobs.get(id)!;
    this.running = true;
    job.status = 'running';
    this.emit(job, 'status', { status: job.status });
    const log = new Logger(path.join(job.dir, 'errors.log'), true);
    fs.mkdirSync(job.dir, { recursive: true });
    log.onLog((level, message) => {
      const entry = { level, message, at: new Date().toISOString() };
      job.logs.push(entry);
      if (job.logs.length > 500) job.logs.shift();
      this.emit(job, 'log', entry);
    });
    try {
      await runPipeline({
        cfg: this.cfg,
        dir: job.dir,
        input: job.input,
        llm: job.llm,
        resumeFrom: job.resumeFrom,
        log,
        onStage: (stage, i) => {
          job.stage = stage.name;
          job.stageIndex = i;
          job.progress = 0;
          this.emit(job, 'stage', { stage: stage.name, index: i, total: STAGES.length });
        },
        onProgress: (_stage, f) => {
          job.progress = f;
          this.emit(job, 'progress', { progress: f });
        },
      });
      job.status = 'done';
      job.stageIndex = STAGES.length;
    } catch (err) {
      job.status = 'failed';
      job.error = formatError(err).split('\n').slice(0, 3).join('\n');
    }
    this.emit(job, 'status', { status: job.status, error: job.error });
    this.running = false;
    void this.pump();
  }
}
