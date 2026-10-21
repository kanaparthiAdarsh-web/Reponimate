# Reponimate

**Turn a GitHub repository, documentation, or a trending topic into a narrated, animated explainer video. Everything runs on your own machine.**

Reponimate reads the real source material, builds a local RAG knowledge base, writes a script in which every sentence is checked against that material, and narrates it with an openly licensed voice. It then animates the script with Remotion (code walkthroughs, architecture diagrams, animated presenter whiteboard lessons, word-synced captions) and produces an MP4 with titles, a description with chapters, tags, a thumbnail and a quality report.

| Mode | Input | Output |
|---|---|---|
| **① Repo → Video** | a public GitHub URL | 16:9 code walkthrough (architecture, real code, usage, pros and cons) |
| **② Description → Video** | pasted docs or notes, a web page URL, or a topic | 16:9 explainer with an animated presenter, whiteboards and props |
| **③ Description → Reel** | same as ② | 9:16 short under 60 s with big captions, for Shorts and Reels |
| **⚡ Start (autopilot)** | nothing | picks a trending repo or topic (GitHub, Hacker News, Wikipedia) and makes the video |

> Experimental, non-commercial hobby project. Review every video before you upload it.

---

## Quick start

```bash
# 1. Requirements: Node 20+, git, FFmpeg, Python 3.10+, Chromium/Chrome (Remotion can download one)
npm install
pip install -r python/requirements.txt     # Piper TTS + faster-whisper
npm run setup:voices                       # downloads the public-domain-trained Piper voice (~110 MB)
npm run build:rust                         # optional: fast Rust repository scanner (needs cargo)

# 2. Optional but recommended: a local LLM for nicer narration
#    https://ollama.com  →  ollama pull qwen2.5:7b-instruct && ollama pull nomic-embed-text

# 3. Check your setup
npm run doctor

# 4a. Use the web studio
npm run web            # → http://localhost:4777

# 4b. …or the CLI
npm run make-video -- https://github.com/sindresorhus/slugify
npm run make-video -- --mode doc-video --file notes.md
npm run make-video -- --mode doc-reel --topic "Black holes"
npm run make-video -- --mode repo-video --trending
```

You don't need Ollama. Without it, use `--llm none` (or pick "Extractive" in the studio). The script is then assembled only from verified facts and sentences in the source. It's less lively, but it can't invent anything.

### CLI options

```
--mode repo-video|doc-video|doc-reel     --ref <branch|tag|sha>     --title "..."
--text "..." | --file notes.md | --url https://... | --topic "..."  --trending
--llm ollama|anthropic|none              --tts piper|kokoro|espeak
--preview  (half resolution)             --chunk-render (20 s chunks, resumable, for weak PCs)
--channel "My Channel"  (badge, bottom-right) --no-music   --fresh (ignore cached results)
--resume-from <stage>                    --stop-after <stage>        --out <dir>
```

Each stage caches its output and is skipped on re-run, so `--resume-from render` re-renders without re-running TTS. The stages are `ingest → analyze → script → tts → align → render → merge → metadata → quality`.

### Output (`out/<name>/`)

`final.mp4`, `analysis.json`, `knowledge.json`, `script.json`, `timing.json`, `metadata.json`, `title.txt`, `description.txt`, `tags.txt`, `thumbnail.html`, `thumbnail.png`, `thumbnail-prompt.txt`, `quality-report.json`, `sources.json`, `errors.log`, plus `audio/` and `render/` working folders.

---

## How it works

```
          ┌──────────── 01 ingest ────────────┐
GitHub URL│ shallow git clone (hooks off,     │   text / URL / topic
──────────▶ no scripts run) + commit SHA      ◀──────────────────────
          │ SSRF-guarded fetch, Wikipedia API │
          └───────────────┬───────────────────┘
                          ▼
          ┌──────────── 02 analyze ───────────┐
          │ Rust scanner (or TS fallback):    │
          │  skip binaries/secrets/minified,  │
          │  redact tokens, path & symlink    │
          │  checks → inventory               │
          │ manifests, frameworks, import     │
          │ graph, file ranking, entry points │
          │ → analysis.json (claims labelled  │
          │   verified / interpretation /     │
          │   unverified / unknown + evidence)│
          │ → knowledge.json (RAG chunks)     │
          └───────────────┬───────────────────┘
                          ▼
          ┌──────────── 03 script (RAG) ──────┐
          │ planner picks scenes from the     │
          │ real repo/doc (size-aware)        │
          │ per scene: hybrid retrieval       │
          │  (BM25 + Ollama embeddings, RRF)  │
          │ LLM writes with [chunk] citations │
          │ verifier checks EVERY sentence;   │
          │ unsupported ones are dropped;     │
          │ fallback = extractive narration   │
          └───────────────┬───────────────────┘
                          ▼
   04 tts (Piper/Kokoro/eSpeak) → 05 align (faster-whisper, fallback proportional)
                          ▼
   06 render (Remotion, durations from real audio) → 07 merge (FFmpeg, ducking, −14 LUFS)
                          ▼
   08 metadata + Puppeteer thumbnail → 09 quality report
```

### Anti-hallucination design

These are the measures that keep the narration from making things up. Each one has tests.

1. **Visuals never come from the LLM.** Code panels show byte-for-byte excerpts, which the quality stage re-checks against the files. Architecture diagrams come from the static import graph. Terminal scenes only show README commands, are labelled *"not executed"*, and never show output.
2. **Facts come from deterministic analysis.** Purpose, frameworks, entry points, strengths and weaknesses are computed from files. Each one carries a status and file/line evidence.
3. **Retrieval is restricted.** The writer sees only retrieved chunks, wrapped in `<data>` fences, and is told to ignore any instructions inside them. Chunks that look like prompt injection are withheld, and fence-breaking text is neutralised.
4. **Every sentence is verified.** Identifiers, file names and numbers must appear in the evidence, and enough content words must be covered by it. Marketing claims ("fastest", "millions") need source support *and* attribution ("the README claims…"). Everything that fails is dropped and logged in `quality-report.json`.
5. **It never claims tests pass.** Repository code is never executed, and the narration and report say so.
6. **Verification works in any language, and negation must match.** Telugu, Hindi and Cyrillic sentences are checked like English ones. "Does *not* support X" is rejected when the source only says it supports X.

### Known limitations (honest list)

- The sentence verifier is lexical, not a full reasoning model. It catches invented names, numbers, hype, off-topic claims and negation flips. It can still miss a sentence that uses only source words but swaps their relationship ("A calls B" when the source says "B calls A"). Watch the video before publishing.
- Import graphs and symbols come from regex-based static parsing for JS/TS, Python, Go, Rust, Ruby and Java. Unusual module systems may produce an incomplete diagram.
- Default voices are English. eSpeak NG covers many languages (set `ESPEAK_VOICE`), but its quality is basic.
- Small models (3B) often fail verification on a scene. That scene then falls back to extractive narration, which stays correct but is plainer. A 7B+ model gives livelier scripts.
- Rendering is CPU-bound. On an 8-core machine, expect roughly 1–2× the video length at full HD. Use `--preview` while iterating.

### Rust and TypeScript

The CPU-heavy part of ingestion runs in Rust (`crates/reponimate-scan`): the parallel directory walk, filtering, binary sniffing and regex secret redaction. A test checks that its output matches the TypeScript implementation exactly, and the pipeline falls back to TypeScript when the binary isn't built. On real runs the slow parts are rendering (Chromium), TTS and the LLM. Rust wouldn't speed those up, and Remotion needs React, so they stay in their best-suited tools.

---

## What the videos look like

- **Animated human presenter.** A flat-vector host with hair, face, blinking eyes, expressive brows and lip-sync. The host walks in, changes pose at every sentence (wave, point, think, explain, present, celebrate) and uses animated props: an idea bulb, a spinning gear, a magnifier over code, a laptop, a rocket. The outfit follows the video's palette, and the appearance varies per channel or video.
- **Motion graphics with meaning.** Architecture diagrams draw themselves and data packets flow along the import edges, while nodes pulse when the narrator names them. The camera glides to each highlighted code line. Counters tick up, language bars grow in GitHub's language colours, and keywords pop up as they are spoken. Colour-panel wipes mark scene changes, and code glyphs drift in the background.
- **A palette per repository.** Curated, muted palettes (no neon) are chosen from what the project is: Ember for Rust/systems, Fjord for Go/infra, Orchard for Python/data, Plum for AI, Studio for web UI, Moss for security, Chalkboard for explainers, and more. A hue shift derived from the repository name makes each video's colours its own.
- **Channel badge.** Type your channel name in the studio (or pass `--channel`, or set `CHANNEL_NAME`). It shows bottom-right on every frame, in the outro, the description and the thumbnail.
- **Music and sound effects.** `python/music.py` synthesizes an original lo-fi track for every video, with key, progression and tempo seeded by the subject and the mood set by the mode. It also makes whooshes on transitions, pops on keywords and a chime at the end. Everything is generated from oscillators and noise, so there's nothing to claim. The music ducks under the voice. Use `MUSIC_FILE` to supply your own track, or `--no-music` to turn it off.
- **Narration that holds attention.** Scenes open on tension or a question and end with an open loop that teases the next one. Viewer questions and clearly marked analogies are allowed, but the verifier still rejects invented names, numbers, hype and presuppositions ("Why does NASA use it?").

## Voices (no cloning, open licences)

| Provider | Default voice | Licence |
|---|---|---|
| **Piper** (default) | `en_US-ljspeech-high` | Engine GPL-3.0. Voice trained on the public-domain LJ Speech dataset. |
| **Kokoro** (`--tts kokoro`) | `af_heart` | Model weights Apache-2.0, kokoro-onnx MIT |
| **eSpeak NG** (fallback) | `en-us` | GPL-3.0 engine. Audio output is unrestricted. |

Voice cloning was removed on purpose. The video description always discloses the synthetic narration. Enable YouTube's *altered or synthetic content* setting when you upload.

---

## Local, Firebase or a server? (recommendation)

**Run it locally.** That's the default and what I recommend for this project.

| Option | Verdict |
|---|---|
| **Local machine** (`npm run web`) | ✅ **Best fit.** Free, private, and no API keys are needed. Rendering uses many CPU cores and lots of RAM for several minutes, which is fine on a desktop. |
| **Firebase** (Hosting + Functions) | ❌ **Poor fit.** Cloud Functions have short time limits, small disks and no FFmpeg/Chromium/Python stack by default, and can't run Ollama. Firebase Hosting could serve the UI only, with nowhere to render. |
| **Your own server/VPS** (Docker) | ✅ Good if you want it always on. Use a machine with **8+ cores and 16 GB+ RAM**, or a GPU box for faster LLM inference, and run `docker compose up`. Put it behind a reverse proxy with authentication, and set `ALLOWED_HOSTS` to your domain. The server refuses foreign `Host` headers. |

```bash
docker compose up --build
docker compose exec ollama ollama pull qwen2.5:7b-instruct
docker compose exec ollama ollama pull nomic-embed-text
# → http://localhost:4777
```

Remotion also offers *Lambda* rendering on AWS for scale. It isn't wired in, because local rendering keeps the project free and private.

---

## Security model

The repository and every document are **untrusted input**:

- Clones are shallow, with git hooks disabled, LFS smudge off and `file://` blocked. Install and build scripts are never run, and `--allow-execution` is intentionally refused.
- Limits apply to file size, total size, file count and minified one-line files. Symlinks are never followed, and ones that escape the repo are reported.
- `.env`, keys, `.npmrc` and credentials files are skipped. Tokens, private keys, JWTs and `password = "..."` values are redacted before any text reaches an LLM, the video or the logs.
- URL inputs are SSRF-guarded: localhost, private, link-local, metadata, IPv4-mapped IPv6 and decimal/hex IP tricks are blocked on every redirect hop, and the body size is capped.
- The web server listens on `127.0.0.1`. It rejects foreign `Host` headers (DNS rebinding) and cross-origin or non-JSON POSTs (CSRF), confines file serving to the job folder, sends a strict CSP, and never leaks stack traces.

`tests/adversarial.test.ts` holds the attack tests: SSRF, argument injection, prompt injection, data-fence breakout, secret leakage, symlink loops, hostile file names, broken LLM output, path traversal, DNS rebinding, CSRF and oversized input.

---

## Development

```bash
npm test            # vitest: unit, pipeline and adversarial tests
npm run test:rust   # cargo tests for the scanner
npm run typecheck
npm run studio      # Remotion Studio with fixture data (every scene type)
```

Project layout:

```
src/core        config, schemas (Zod), logging, process/media helpers, SSRF guard
src/repo        URL parsing, safe clone, inventory, manifests, imports, symbols, analysis
src/docs        text/URL/Wikipedia loaders and document analysis
src/rag         tokenizer, chunkers, BM25, embeddings, hybrid index, sentence verifier
src/llm         Ollama / Anthropic providers, JSON-with-retry
src/script      scene planner, code excerpts, RAG writer with verification
src/tts         TTS providers, pronunciation dictionary (config/pronunciations.json)
src/align       faster-whisper alignment + proportional fallback
src/render      Remotion compositions/components, renderer, FFmpeg merge
src/metadata    titles/description/chapters/tags, thumbnail
src/quality     quality report
src/trending    GitHub, Hacker News, Wikipedia trend sources
src/pipeline    stages + resumable runner
src/server      local studio API (Express) + job queue
src/web         studio UI (no build step)
crates/         reponimate-scan (Rust)
python/         Piper/Kokoro/Whisper helpers
```

See [LICENSES.md](LICENSES.md) and [ASSETS.md](ASSETS.md) for third-party licences. Reponimate itself is MIT-licensed ([LICENSE](LICENSE)).
