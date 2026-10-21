"""Word timestamps with faster-whisper (MIT), running locally on CPU.

Usage:
  align_whisper.py MODEL AUDIO.wav                    prompt on stdin → JSON [{word,start,end}]
  align_whisper.py MODEL --batch JOBS.json            [{"wav", "prompt"}] → JSON {wav: [words]}, model loaded once
"""
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


def words(model: WhisperModel, audio: str, prompt: str | None) -> list:
    segments, _info = model.transcribe(
        load_audio(audio), language="en", word_timestamps=True, initial_prompt=prompt or None, vad_filter=False, beam_size=1
    )
    out = []
    for seg in segments:
        for w in seg.words or []:
            out.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    return out


def main() -> None:
    model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8")
    if sys.argv[2] == "--batch":
        with open(sys.argv[3], encoding="utf-8") as f:
            jobs = json.load(f)
        json.dump({job["wav"]: words(model, job["wav"], job.get("prompt")) for job in jobs}, sys.stdout)
    else:
        json.dump(words(model, sys.argv[2], sys.stdin.read().strip()), sys.stdout)


if __name__ == "__main__":
    main()
