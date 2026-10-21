"""Kokoro-82M (Apache-2.0) text to speech via kokoro-onnx (MIT).
Usage: tts_kokoro.py MODEL VOICES VOICE OUT.wav  (text on stdin)"""
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main() -> None:
    model, voices, voice, out = sys.argv[1:5]
    text = sys.stdin.read().strip()
    kokoro = Kokoro(model, voices)
    samples, rate = kokoro.create(text, voice=voice, speed=1.0, lang="en-us")
    sf.write(out, samples, rate)


if __name__ == "__main__":
    main()
