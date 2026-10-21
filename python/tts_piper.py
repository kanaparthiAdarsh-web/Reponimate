"""Piper text to speech through its Python API (avoids CLI/stdin encoding issues on Windows).

Usage:
  tts_piper.py MODEL.onnx TEXT_FILE(utf-8) OUT.wav     one clip
  tts_piper.py MODEL.onnx --batch JOBS.json            many clips, voice loaded once
     JOBS.json = [{"text_file": "...", "out": "..."}]
"""
import json
import sys
import wave

from piper import PiperVoice
from piper.config import SynthesisConfig


def synth(voice: PiperVoice, text_file: str, out: str) -> None:
    with open(text_file, encoding="utf-8") as f:
        text = f.read().strip()
    with wave.open(out, "wb") as wav:
        voice.synthesize_wav(text, wav, syn_config=SynthesisConfig())


def main() -> None:
    model = sys.argv[1]
    voice = PiperVoice.load(model)
    if sys.argv[2] == "--batch":
        with open(sys.argv[3], encoding="utf-8") as f:
            jobs = json.load(f)
        for job in jobs:
            synth(voice, job["text_file"], job["out"])
            print(job["out"], flush=True)
    else:
        synth(voice, sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    main()
