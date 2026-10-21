import type { z } from 'zod';
import type { LlmProvider } from './provider.js';

/** Pulls the first JSON object out of a model reply (handles ```json fences and leading chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('No JSON object in model output');
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('Unterminated JSON object in model output');
}

/** Asks for JSON, validates with Zod and retries with the validation error fed back to the model. */
export async function generateJson<T>(
  llm: LlmProvider,
  schema: z.ZodType<T>,
  opts: { system: string; prompt: string; temperature?: number; maxTokens?: number },
  attempts = 3,
): Promise<T> {
  let prompt = opts.prompt;
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    const raw = await llm.generate({ ...opts, prompt, json: true });
    try {
      return schema.parse(extractJson(raw));
    } catch (err) {
      lastErr = (err as Error).message.slice(0, 600);
      prompt = `${opts.prompt}\n\nYour previous reply was invalid: ${lastErr}\nReply again with ONLY a valid JSON object matching the requested shape.`;
    }
  }
  throw new Error(`Model did not return valid JSON after ${attempts} attempts: ${lastErr}`);
}
