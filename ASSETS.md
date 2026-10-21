# Media assets

| Asset | Source | Licence |
|---|---|---|
| Narration voice `en_US-ljspeech-high` (Piper) | https://huggingface.co/rhasspy/piper-voices | Trained on the LJ Speech dataset (public domain). Downloaded by `npm run setup:voices`, never committed. |
| Kokoro-82M voices (optional) | https://github.com/thewh1teagle/kokoro-onnx releases | Apache-2.0 |
| Fonts: Inter, JetBrains Mono, Patrick Hand | @fontsource npm packages | SIL Open Font License 1.1 |
| Whiteboard, diagrams, backgrounds | Drawn in code (`src/render/remotion`) | MIT (this project) |
| Code highlighting theme `github-dark-default` | Shiki | MIT |
| Background music and sound effects | Synthesized per video by `python/music.py` from oscillators and noise. No samples or recordings. | Original output of this project (MIT); no third-party rights |
| Optional custom music (`MUSIC_FILE`) | Your own CC0 track or one from the YouTube Audio Library | Your responsibility to verify |
| Presenter character (built-in 3D toon boy and 2D fallback), props, icons | Modelled/drawn in code (`src/render/remotion/components`) | MIT (this project) |
| Optional rigged character (`models/character/*.glb`) | You download it, e.g. from Quaternius (free incl. commercial use, no credit), Mixamo or Ready Player Me. Never committed. | Per its source's licence; Quaternius allows use in videos but not redistributing the raw model |

No voice cloning, stock footage or copyrighted images are used. Generated videos, audio and model weights are git-ignored and never committed.
