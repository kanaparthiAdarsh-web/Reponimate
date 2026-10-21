import { spawn } from 'node:child_process';
import fs from 'node:fs';

/** "py -3.12" → ["py", "-3.12"]; an existing path with spaces (C:\Program Files\…) stays one command. */
export function splitCommand(cmd: string): [string, ...string[]] {
  if (!/\s/.test(cmd.trim()) || fs.existsSync(cmd)) return [cmd];
  const [bin, ...rest] = cmd.trim().split(/\s+/);
  return [bin, ...rest];
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell. Rejects on timeout; never interpolates untrusted input into a shell string. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // UTF-8 mode for Python helpers: on Windows they would otherwise read and print in the legacy code page.
    const env = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...(opts.env ?? process.env) };
    const [bin, ...pre] = splitCommand(cmd);
    const child = spawn(bin, [...pre, ...args], { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${cmd} timed out after ${opts.timeoutMs} ms`));
        }, opts.timeoutMs)
      : undefined;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function runOk(cmd: string, args: string[], opts: Parameters<typeof run>[2] = {}): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    // Lead with the last line (for Python tracebacks that is the actual exception), then the tail for context.
    const last = r.stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed (${r.code}): ${last}\n${r.stderr.slice(-800)}`);
  }
  return r.stdout;
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    // ffmpeg/ffprobe only understand "-version"; most other tools use "--version".
    const r = await run(cmd, [/^ff(mpeg|probe)$/.test(cmd) ? '-version' : '--version'], { timeoutMs: 10_000 });
    return r.code === 0 || r.stdout.length > 0;
  } catch {
    return false;
  }
}
