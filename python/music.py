"""Procedural, copyright-free background music and sound effects.

Everything here is synthesized from oscillators and noise: no samples, no recordings, so the output
belongs to whoever runs it and cannot trigger Content ID claims.

Usage:
  music.py music OUT.wav SECONDS SEED MOOD        MOOD = chill | upbeat | focus
  music.py sfx   OUT.wav SECONDS EVENTS.json      events: [{"t": 1.2, "kind": "whoosh"|"pop"|"chime"}]
"""
import json
import sys
import wave

import numpy as np

SR = 48000


def write_wav(path: str, stereo: np.ndarray) -> None:
    peak = float(np.max(np.abs(stereo))) or 1.0
    data = np.clip(stereo / peak * 0.89, -1, 1)
    pcm = (data * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """One-pole low-pass filter (vectorised enough for long buffers via cumulative recursion in chunks)."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    # Process in blocks to keep Python overhead acceptable.
    block = 4096
    for s in range(0, len(x), block):
        seg = x[s : s + block]
        out = np.empty_like(seg)
        for i, v in enumerate(seg):
            acc = (1 - a) * v + a * acc
            out[i] = acc
        y[s : s + block] = out
    return y


def env(n: int, attack: float, release: float) -> np.ndarray:
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def note_freq(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


# Diatonic seventh chords as semitone offsets from the key root (major key).
CHORDS = {
    "I": [0, 4, 7, 11],
    "ii": [2, 5, 9, 12],
    "iii": [4, 7, 11, 14],
    "IV": [5, 9, 12, 16],
    "V": [7, 11, 14, 17],
    "vi": [9, 12, 16, 19],
}
PROGRESSIONS = [
    ["I", "vi", "ii", "V"],
    ["vi", "IV", "I", "V"],
    ["I", "iii", "IV", "V"],
    ["ii", "V", "I", "vi"],
    ["IV", "V", "iii", "vi"],
]
MOODS = {"chill": 80, "focus": 72, "upbeat": 100}


def music(seconds: float, seed: int, mood: str) -> np.ndarray:
    rng = np.random.default_rng(seed)
    bpm = MOODS.get(mood, 80) + int(rng.integers(-4, 5))
    beat = 60 / bpm
    bar = beat * 4
    root = 48 + int(rng.integers(0, 12))  # C3..B3
    prog = PROGRESSIONS[int(rng.integers(0, len(PROGRESSIONS)))]
    n = int(seconds * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    t_bar = np.arange(int(bar * SR)) / SR

    bars = int(np.ceil(seconds / bar))
    for b in range(bars):
        start = int(b * bar * SR)
        chord = CHORDS[prog[b % len(prog)]]
        seg = np.zeros(len(t_bar))
        for k, off in enumerate(chord):
            f = note_freq(root + 12 + off)
            detune = 1 + (k - 1.5) * 0.0015
            # Warm pad: sine + soft triangle, slow attack.
            tone = 0.6 * np.sin(2 * np.pi * f * detune * t_bar) + 0.25 * (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * f * t_bar))
            seg += tone * 0.18
        seg *= env(len(t_bar), 0.6, 0.5)
        # Bass on beats 1 and 3.
        bass = np.zeros(len(t_bar))
        f_b = note_freq(root - 12 + chord[0])
        for beat_i in (0, 2):
            s = int(beat_i * beat * SR)
            ln = int(beat * 1.6 * SR)
            tt = np.arange(min(ln, len(t_bar) - s)) / SR
            bass[s : s + len(tt)] += np.sin(2 * np.pi * f_b * tt) * np.exp(-tt * 2.2) * 0.5
        # Gentle arpeggio in the upper register, every 8th, randomized per bar.
        arp = np.zeros(len(t_bar))
        if mood != "focus":
            for step in range(8):
                if rng.random() < 0.55:
                    s = int(step * beat / 2 * SR)
                    tt = np.arange(int(beat / 2 * SR)) / SR
                    f_a = note_freq(root + 24 + chord[int(rng.integers(0, 4))])
                    tone = np.sin(2 * np.pi * f_a * tt) * np.exp(-tt * 9) * 0.12
                    arp[s : s + len(tt)] += tone[: len(arp) - s]
        mix = seg + bass + arp
        end = min(n, start + len(mix))
        left[start:end] += mix[: end - start]
        right[start:end] += (seg * 0.9 + bass + arp * 0.6)[: end - start]

    # Drums: soft kick on 1/3, brushed snare on 2/4, quiet hats on 8ths.
    beats = int(seconds / beat)
    for i in range(beats):
        s = int(i * beat * SR)
        if s >= n:
            break
        if i % 2 == 0:
            tt = np.arange(int(0.25 * SR)) / SR
            kick = np.sin(2 * np.pi * (50 + 70 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 14) * 0.55
            e = min(n, s + len(kick))
            left[s:e] += kick[: e - s]
            right[s:e] += kick[: e - s]
        else:
            tt = np.arange(int(0.18 * SR)) / SR
            snare = rng.normal(0, 1, len(tt)) * np.exp(-tt * 24) * 0.12
            e = min(n, s + len(snare))
            left[s:e] += snare[: e - s] * 0.8
            right[s:e] += snare[: e - s]
        for half in (0, 1):
            hs = s + int(half * beat / 2 * SR)
            tt = np.arange(int(0.04 * SR)) / SR
            hat = rng.normal(0, 1, len(tt)) * np.exp(-tt * 120) * 0.035
            e = min(n, hs + len(hat))
            if hs < n:
                left[hs:e] += hat[: e - hs] * (0.6 if half else 1)
                right[hs:e] += hat[: e - hs] * (1 if half else 0.6)

    # Vinyl-style noise floor for warmth.
    noise = rng.normal(0, 0.004, n)
    left += noise
    right += noise
    # Fade in/out.
    fade = env(n, 2.0, 3.0)
    return np.stack([left * fade, right * fade], axis=1)


def sfx(seconds: float, events: list) -> np.ndarray:
    n = int(seconds * SR) + SR
    out = np.zeros(n)
    rng = np.random.default_rng(7)
    for ev in events:
        s = int(float(ev["t"]) * SR)
        if s >= n:
            continue
        kind = ev.get("kind", "pop")
        if kind == "whoosh":
            ln = int(0.45 * SR)
            tt = np.arange(ln) / SR
            noise = rng.normal(0, 1, ln)
            # Band-limited sweep: mix of filtered noise with rising/falling envelope.
            shaped = lowpass(noise, 2500) * np.sin(np.pi * tt / tt[-1]) ** 2 * 0.35
            snd = shaped
        elif kind == "chime":
            ln = int(0.9 * SR)
            tt = np.arange(ln) / SR
            snd = (np.sin(2 * np.pi * 880 * tt) + 0.5 * np.sin(2 * np.pi * 1320 * tt)) * np.exp(-tt * 5) * 0.18
        else:  # pop
            ln = int(0.12 * SR)
            tt = np.arange(ln) / SR
            snd = np.sin(2 * np.pi * (520 + 380 * np.exp(-tt * 40)) * tt) * np.exp(-tt * 35) * 0.25
        e = min(n, s + len(snd))
        out[s:e] += snd[: e - s]
    return np.stack([out, out], axis=1)


def main() -> None:
    cmd = sys.argv[1]
    if cmd == "music":
        out, seconds, seed, mood = sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
        write_wav(out, music(seconds, seed, mood))
    elif cmd == "sfx":
        out, seconds, events_file = sys.argv[2], float(sys.argv[3]), sys.argv[4]
        with open(events_file, encoding="utf-8") as f:
            events = json.load(f)
        write_wav(out, sfx(seconds, events))
    else:
        raise SystemExit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
