"""Kokoro-82M (Apache-2.0) text to speech via kokoro-onnx (MIT).

Usage:
  tts_kokoro.py MODEL VOICES VOICE OUT.wav                 text on stdin
  tts_kokoro.py MODEL VOICES VOICE --batch JOBS.json       [{"text_file", "out"}], model loaded once
"""
import json
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main() -> None:
    model, voices, voice = sys.argv[1:4]
    kokoro = Kokoro(model, voices)
    if sys.argv[4] == "--batch":
        with open(sys.argv[5], encoding="utf-8") as f:
            jobs = json.load(f)
        for job in jobs:
            with open(job["text_file"], encoding="utf-8") as t:
                samples, rate = kokoro.create(t.read().strip(), voice=voice, speed=1.0, lang="en-us")
            sf.write(job["out"], samples, rate)
            print(job["out"], flush=True)
    else:
        samples, rate = kokoro.create(sys.stdin.read().strip(), voice=voice, speed=1.0, lang="en-us")
        sf.write(sys.argv[4], samples, rate)


if __name__ == "__main__":
    main()
