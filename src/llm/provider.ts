import type { AppConfig } from '../core/config.js';
import { UserError } from '../core/errors.js';

export interface GenerateOptions {
  system: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(opts: GenerateOptions): Promise<string>;
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  constructor(
    private host: string,
    readonly model: string,
    private timeoutMs: number,
  ) {}

  /** Fails with an actionable message if Ollama is down or the model is not pulled. Never fakes output. */
  async ensureReady(): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(5000) });
    } catch {
      throw new UserError(
        `Ollama is not reachable at ${this.host}.`,
        'Install it from https://ollama.com, run `ollama serve`, or use --llm none for the extractive (no-LLM) writer.',
      );
    }
    const tags = (await res.json()) as { models?: { name: string }[] };
    const names = (tags.models ?? []).map((m) => m.name);
    const want = this.model.includes(':') ? this.model : `${this.model}:latest`;
    if (!names.includes(want) && !names.includes(this.model)) {
      throw new UserError(`Ollama model "${this.model}" is not installed.`, `Run: ollama pull ${this.model}`);
    }
  }

  async generate(o: GenerateOptions): Promise<string> {
    const res = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: o.json ? 'json' : undefined,
        options: { temperature: o.temperature ?? 0.4, num_predict: o.maxTokens ?? 1200, num_ctx: 8192 },
        messages: [
          { role: 'system', content: o.system },
          { role: 'user', content: o.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { message?: { content?: string } };
    return j.message?.content ?? '';
  }
}

/** Optional hosted provider. Uses the Messages API over fetch so no SDK is required. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  constructor(
    private apiKey: string,
    readonly model: string,
    private timeoutMs: number,
  ) {
    if (!apiKey) throw new UserError('LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty.');
  }

  async generate(o: GenerateOptions): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: o.maxTokens ?? 1200,
        temperature: o.temperature ?? 0.4,
        system: o.system + (o.json ? '\nRespond with a single JSON object and nothing else.' : ''),
        messages: [{ role: 'user', content: o.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
}

/** Returns null for "none": the pipeline then uses the deterministic extractive writer. */
export async function createLlm(cfg: AppConfig, override?: string): Promise<LlmProvider | null> {
  const name = override ?? cfg.llm.provider;
  if (name === 'none') return null;
  if (name === 'anthropic') return new AnthropicProvider(cfg.llm.anthropicKey, cfg.llm.anthropicModel, cfg.llm.timeoutMs);
  if (name === 'ollama') {
    const p = new OllamaProvider(cfg.llm.ollamaHost, cfg.llm.ollamaModel, cfg.llm.timeoutMs);
    await p.ensureReady();
    return p;
  }
  throw new UserError(`Unknown LLM provider "${name}". Use ollama, anthropic or none.`);
}
