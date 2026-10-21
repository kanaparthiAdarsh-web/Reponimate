import fs from 'node:fs';

export type LogLevel = 'info' | 'warn' | 'error' | 'step';
export type LogListener = (level: LogLevel, message: string) => void;

/** Console + file logger. Warnings and errors also go to errors.log in the job directory. */
export class Logger {
  private listeners: LogListener[] = [];
  readonly warnings: string[] = [];

  constructor(
    private errorLogPath?: string,
    private quiet = false,
  ) {}

  onLog(listener: LogListener): void {
    this.listeners.push(listener);
  }

  private emit(level: LogLevel, message: string): void {
    const stamp = new Date().toISOString();
    if (!this.quiet) {
      const prefix = { info: '  ', warn: '  ⚠ ', error: '  ✖ ', step: '\n▶ ' }[level];
      (level === 'error' ? console.error : console.log)(prefix + message);
    }
    if ((level === 'warn' || level === 'error') && this.errorLogPath) {
      fs.appendFileSync(this.errorLogPath, `[${stamp}] ${level.toUpperCase()} ${message}\n`);
    }
    if (level === 'warn') this.warnings.push(message);
    for (const l of this.listeners) l(level, message);
  }

  info(m: string): void {
    this.emit('info', m);
  }
  warn(m: string): void {
    this.emit('warn', m);
  }
  error(m: string): void {
    this.emit('error', m);
  }
  step(m: string): void {
    this.emit('step', m);
  }
}
