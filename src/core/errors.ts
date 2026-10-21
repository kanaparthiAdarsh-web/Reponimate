/** An error with a message meant for the person running the tool, plus an optional fix hint. */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'UserError';
  }
}

export function formatError(err: unknown): string {
  if (err instanceof UserError) return err.hint ? `${err.message}\n  → ${err.hint}` : err.message;
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, attempts = 3, delayMs = 1000): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (err instanceof UserError || i === attempts) break;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** (i - 1)));
    }
  }
  throw last;
}
