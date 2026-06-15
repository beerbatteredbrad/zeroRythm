#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze_audio.py  —  Detect tempo + beats in the real song mp3s and write
beat-aligned note charts for "Return by Rhythm".

WHAT IT DOES
------------
For each of assets/audio/song1.mp3 .. song3.mp3 it:
  1. Decodes the mp3 to mono 22050 Hz PCM using ffmpeg.
  2. Builds an onset-novelty envelope (where the music "hits").
  3. Estimates the tempo (BPM) by autocorrelation, with octave correction
     and parabolic interpolation for sub-frame precision.
  4. Finds the beat phase (offset of beat 1), then tracks beats across the
     whole song, snapping each beat to the nearest onset so it does not drift.
  5. Places notes ON those beats (plus a few on strong half-beats), so the
     notes line up with the music.

It writes:
  charts/song1.json, song2.json, song3.json     (the beat-aligned charts)
  tools/_detected.json                           (bpm/offset/notes per song)
  tools/_embedded_charts.js                      (a JS snippet to paste into
                                                  script.js as the fallback)

REQUIREMENTS
------------
  - ffmpeg on PATH (or set the FFMPEG_BIN env var to its full path)
  - Python 3.x standard library only (uses wave, audioop, array, json)

USAGE
-----
  python tools/analyze_audio.py
"""

import array
import audioop
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave

# ---- Analysis constants -------------------------------------------------
SR = 22050          # sample rate we decode to
WIN = 512           # samples per energy frame
HOP = 256           # samples between frames -> ~86.13 frames/sec
FPS = SR / HOP      # frames per second of the novelty envelope
BPM_MIN = 70.0
BPM_MAX = 185.0
# Per-song lane RNG seed + which lane patterns feel good. Lanes: 0=L,1=D,2=U,3=R
DIRECTIONS = ["left", "down", "up", "right"]
LANE_SEED = {"song1": 101, "song2": 202, "song3": 303}

# 32-bit LCG so lane choices are reproducible (matches the game's generator).
LCG_A, LCG_C, LCG_M = 1664525, 1013904223, 4294967296


class Lcg(object):
    def __init__(self, seed):
        self.state = seed % LCG_M

    def nf(self):
        self.state = (LCG_A * self.state + LCG_C) % LCG_M
        return self.state / LCG_M

    def ni(self, n):
        return int(self.nf() * n)


def find_ffmpeg():
    """Locate ffmpeg: env var, PATH, or the winget package folder."""
    env = os.environ.get("FFMPEG_BIN")
    if env and os.path.exists(env):
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    # winget typically drops it under LOCALAPPDATA\Microsoft\WinGet\Packages
    base = os.path.join(os.environ.get("LOCALAPPDATA", ""),
                        "Microsoft", "WinGet", "Packages")
    if os.path.isdir(base):
        for root, _dirs, files in os.walk(base):
            if "ffmpeg.exe" in files:
                return os.path.join(root, "ffmpeg.exe")
    return None


def decode_to_wav(ffmpeg, mp3_path, wav_path):
    """Use ffmpeg to make a mono 16-bit 22050 Hz WAV we can read with stdlib."""
    cmd = [ffmpeg, "-v", "error", "-y", "-i", mp3_path,
           "-ac", "1", "-ar", str(SR), "-acodec", "pcm_s16le", wav_path]
    subprocess.check_call(cmd)


def read_samples(wav_path):
    """Return the PCM as a Python array of signed 16-bit ints + the raw bytes."""
    w = wave.open(wav_path, "rb")
    try:
        n = w.getnframes()
        raw = w.readframes(n)
    finally:
        w.close()
    samples = array.array("h")
    samples.frombytes(raw)
    return samples, raw


def novelty_envelope(raw):
    """Onset novelty: positive change in short-time RMS energy per HOP frame.
    Uses audioop.rms (C-speed) so this stays fast in pure Python."""
    nbytes = len(raw)
    nsamp = nbytes // 2
    energies = []
    i = 0
    while i + WIN <= nsamp:
        frag = raw[2 * i: 2 * (i + WIN)]
        energies.append(audioop.rms(frag, 2))
        i += HOP
    # Rectified energy flux (only increases count as onsets).
    nov = [0.0] * len(energies)
    for k in range(1, len(energies)):
        d = energies[k] - energies[k - 1]
        nov[k] = d if d > 0 else 0.0
    # Normalise to 0..1.
    mx = max(nov) if nov else 1.0
    if mx > 0:
        nov = [v / mx for v in nov]
    # Light smoothing (3-tap) to reduce jitter.
    sm = nov[:]
    for k in range(1, len(nov) - 1):
        sm[k] = (nov[k - 1] + 2.0 * nov[k] + nov[k + 1]) / 4.0
    return sm


def autocorr_tempo(nov):
    """Estimate beat period (in frames, float) via autocorrelation of novelty."""
    lag_min = int(round(60.0 / BPM_MAX * FPS))
    lag_max = int(round(60.0 / BPM_MIN * FPS))
    n = len(nov)
    best_lag, best_val = lag_min, -1.0
    ac = {}
    for lag in range(lag_min, lag_max + 1):
        s = 0.0
        for i in range(lag, n):
            s += nov[i] * nov[i - lag]
        ac[lag] = s
        if s > best_val:
            best_val, best_lag = s, lag

    # Octave correction: if a half/double lag scores comparably and lands in a
    # nicer BPM range, prefer it. This fixes common double/half-tempo errors.
    def bpm_of(lag):
        return 60.0 * FPS / lag

    for factor in (0.5, 2.0):
        cand = int(round(best_lag * factor))
        if lag_min <= cand <= lag_max:
            b = bpm_of(cand)
            if 90.0 <= b <= 165.0 and ac.get(cand, 0) > best_val * 0.6:
                best_lag = cand
                best_val = ac[cand]

    # Parabolic interpolation around the peak for sub-frame precision.
    l0 = best_lag
    if lag_min < l0 < lag_max:
        y1, y2, y3 = ac[l0 - 1], ac[l0], ac[l0 + 1]
        denom = (y1 - 2 * y2 + y3)
        shift = 0.5 * (y1 - y3) / denom if denom != 0 else 0.0
        period = l0 + max(-0.5, min(0.5, shift))
    else:
        period = float(l0)
    return period


def best_phase(nov, period):
    """Find the beat-1 offset (in frames) that best lines up with the novelty."""
    n = len(nov)
    P = period
    best_phi, best_score = 0.0, -1.0
    steps = int(round(P))
    for s in range(steps):
        phi = s
        score = 0.0
        k = 0
        while True:
            pos = phi + k * P
            idx = int(round(pos))
            if idx >= n:
                break
            score += nov[idx]
            k += 1
        if score > best_score:
            best_score, best_phi = score, float(phi)
    return best_phi


def track_beats(nov, period, phi):
    """Step beat-by-beat from phi, snapping each beat to the nearest local
    novelty peak within a window so the grid follows tempo drift."""
    n = len(nov)
    P = period
    win = max(2, int(round(P * 0.12)))   # snap search radius in frames
    beats = []
    pos = phi
    while pos < n:
        center = int(round(pos))
        lo = max(0, center - win)
        hi = min(n - 1, center + win)
        # pick the strongest novelty frame in the window as the true beat
        bi, bv = center, -1.0
        for i in range(lo, hi + 1):
            if nov[i] > bv:
                bv, bi = nov[i], i
        # Only snap if there is a real onset; otherwise keep the predicted slot.
        snap = bi if bv > 0.05 else center
        beats.append(snap)
        # Advance from the *predicted* grid (pos+P) blended with the snap to
        # avoid runaway drift from a single bad snap.
        pos = 0.5 * (pos + P) + 0.5 * (snap + P)
    return beats


def frame_to_ms(frame):
    return int(round(frame * HOP / SR * 1000.0))


def build_chart(nov, beats, key):
    """Turn the beat frames into notes. One note per beat, plus an extra note
    on a half-beat when that midpoint has a strong onset (keeps it musical and
    on-beat). Lanes are assigned with a reproducible anti-repeat RNG."""
    rng = Lcg(LANE_SEED.get(key, 1))
    # Threshold for adding half-beat notes = 60th percentile of novelty.
    vals = sorted(v for v in nov if v > 0)
    thr = vals[int(len(vals) * 0.6)] if vals else 1.0

    notes = []
    prev = -1

    def add(frame):
        nonlocal prev
        lane = rng.ni(4)
        if lane == prev and rng.nf() < 0.6:
            lane = rng.ni(4)
        prev = lane
        notes.append((frame_to_ms(frame), lane))

    for i, bf in enumerate(beats):
        # Skip the very first ~600 ms so there is a visible lead-in.
        if frame_to_ms(bf) < 600:
            continue
        add(bf)
        # Half-beat between this beat and the next, if the music hits there.
        if i + 1 < len(beats):
            mid = (bf + beats[i + 1]) // 2
            if 0 <= mid < len(nov) and nov[mid] >= thr:
                add(mid)

    notes.sort(key=lambda t: t[0])
    # De-duplicate notes that ended up at (almost) the same time.
    cleaned = []
    for t, lane in notes:
        if cleaned and t - cleaned[-1][0] < 90:
            continue
        cleaned.append((t, lane))
    return cleaned


def write_json(charts_dir, fname, pairs):
    """Write a chart as the standard [{time,direction,lane}] JSON."""
    out = []
    for t, lane in pairs:
        out.append({"time": t, "direction": DIRECTIONS[lane], "lane": lane})
    path = os.path.join(charts_dir, fname)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    audio_dir = os.path.join(root, "assets", "audio")
    charts_dir = os.path.join(root, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print("ERROR: ffmpeg not found. Install it or set FFMPEG_BIN.")
        sys.exit(2)
    print("Using ffmpeg:", ffmpeg)

    detected = {}
    embedded = {}
    songs = ["song1", "song2", "song3"]
    for key in songs:
        mp3 = os.path.join(audio_dir, key + ".mp3")
        if not os.path.exists(mp3):
            print("SKIP (missing):", mp3)
            continue
        tmp = os.path.join(tempfile.gettempdir(), key + "_rbr.wav")
        decode_to_wav(ffmpeg, mp3, tmp)
        _samples, raw = read_samples(tmp)
        try:
            os.remove(tmp)
        except OSError:
            pass

        nov = novelty_envelope(raw)
        period = autocorr_tempo(nov)
        bpm = 60.0 * FPS / period
        phi = best_phase(nov, period)
        beats = track_beats(nov, period, phi)
        chart = build_chart(nov, beats, key)

        write_json(charts_dir, key + ".json", chart)
        detected[key] = {
            "bpm": round(bpm, 2),
            "offset_ms": frame_to_ms(phi),
            "beats": len(beats),
            "notes": len(chart),
            "duration_s": round(len(nov) / FPS, 1),
        }
        embedded[key] = chart
        print("%-6s bpm=%6.2f offset=%4dms beats=%4d notes=%4d dur=%5.1fs" % (
            key, bpm, frame_to_ms(phi), len(beats), len(chart),
            len(nov) / FPS))

    # Save detected metadata.
    with open(os.path.join(here, "_detected.json"), "w", encoding="utf-8") as f:
        json.dump(detected, f, indent=2)

    # Save a JS snippet to paste into script.js as the offline fallback.
    lines = ["// AUTO-GENERATED by tools/analyze_audio.py — beat-aligned charts.",
             "// Compact [timeMs, lane] pairs (lane 0=left,1=down,2=up,3=right).",
             "var EMBEDDED_CHARTS = {"]
    for key in songs:
        if key not in embedded:
            continue
        pairs = ",".join("[%d,%d]" % (t, lane) for t, lane in embedded[key])
        lines.append('  "%s": [%s],' % (key, pairs))
    lines.append("};")
    with open(os.path.join(here, "_embedded_charts.js"), "w",
              encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print("Wrote charts + tools/_detected.json + tools/_embedded_charts.js")


if __name__ == "__main__":
    main()
