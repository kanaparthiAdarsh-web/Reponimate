"""Piper text to speech through its Python API (avoids CLI/stdin encoding issues on Windows).
Usage: tts_piper.py MODEL.onnx TEXT_FILE(utf-8) OUT.wav"""
import sys
import wave

from piper import PiperVoice
from piper.config import SynthesisConfig


def main() -> None:
    model, text_file, out = sys.argv[1:4]
    with open(text_file, encoding="utf-8") as f:
        text = f.read().strip()
    voice = PiperVoice.load(model)
    with wave.open(out, "wb") as wav:
        voice.synthesize_wav(text, wav, syn_config=SynthesisConfig())


if __name__ == "__main__":
    main()
