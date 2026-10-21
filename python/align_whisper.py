"""Word timestamps with faster-whisper (MIT), running locally on CPU.
Usage: align_whisper.py MODEL AUDIO.wav  -> JSON list of {word,start,end} on stdout."""
import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel


def load_audio(path: str) -> np.ndarray:
    """Decode with the ffmpeg CLI to 16 kHz mono float32 (avoids PyAV version mismatches)."""
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def main() -> None:
    model_name, audio = sys.argv[1], sys.argv[2]
    prompt = sys.stdin.read().strip() or None
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        load_audio(audio), language="en", word_timestamps=True, initial_prompt=prompt, vad_filter=False, beam_size=1
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    json.dump(words, sys.stdout)


if __name__ == "__main__":
    main()
