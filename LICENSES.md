# Third-party licences

Versions are pinned in `package.json`, `package-lock.json`, `crates/reponimate-scan/Cargo.lock` and `python/requirements.txt`. The licences below were checked at those versions.

## Node / TypeScript

| Package | Version | Licence | Notes |
|---|---|---|---|
| remotion, @remotion/renderer, @remotion/bundler, @remotion/cli | 4.0.537 | Remotion License | Free for individuals, non-profits and for-profit organisations with up to 3 employees. Larger companies need a company licence. See https://remotion.dev/license |
| react, react-dom | 19.2.0 | MIT | |
| shiki | 4.0.2 | MIT | |
| zod | 4.1.12 | MIT | |
| express | 5.1.0 | MIT | |
| puppeteer-core | 24.25.0 | Apache-2.0 | |
| @fontsource/inter, @fontsource/jetbrains-mono, @fontsource/patrick-hand | 5.2.8 | OFL-1.1 (fonts) / MIT (packaging) | |
| typescript (dev) | 5.9.3 | Apache-2.0 | |
| tsx (dev) | 4.20.6 | MIT | |
| vitest (dev) | 3.2.4 | MIT | |

## Rust (`crates/reponimate-scan`)

| Crate | Licence |
|---|---|
| regex 1.x | MIT OR Apache-2.0 |
| serde, serde_json 1.x | MIT OR Apache-2.0 |

## Python helpers

| Package | Version | Licence | Notes |
|---|---|---|---|
| piper-tts | 1.8.0 | GPL-3.0 | Run as a separate process; the generated audio is not covered by the GPL. |
| faster-whisper | 1.2.1 | MIT | Whisper model weights are MIT (OpenAI). |
| kokoro-onnx (optional) | 0.6.1 | MIT | |

## External tools (not bundled)

| Tool | Licence |
|---|---|
| FFmpeg | LGPL-2.1+ / GPL depending on build |
| eSpeak NG | GPL-3.0 |
| Chromium | BSD-3-Clause and others |
| Ollama | MIT. Each model has its own licence: Qwen2.5-7B-Instruct is Apache-2.0, nomic-embed-text is Apache-2.0. |
| git | GPL-2.0 |

## Online services (used only when you ask for them)

- **GitHub** (clone, search API, trending page): GitHub Terms of Service apply.
- **Hacker News API** (Firebase): public read-only API.
- **Wikipedia / Wikimedia APIs**: article text is CC BY-SA 4.0. Attribution is added to the video description automatically.
- **Anthropic API** (optional `LLM_PROVIDER=anthropic`): your own API terms apply.

## Target repositories

The analysed repository's licence is detected and written into `quality-report.json` and the video description, always with a credit to the author. If a repo has no licence, all rights stay with its author. Reponimate shows only short excerpts for commentary and education, and links back to the source.
