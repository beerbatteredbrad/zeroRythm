#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_charts.py  —  OPTIONAL chart generator for "Return by Rhythm".

WHAT THIS DOES
--------------
Creates the three note charts the game reads:

    charts/song1.json   (Stage 1 - Subaru)
    charts/song2.json   (Stage 2 - Angry Subaru)
    charts/song3.json   (Stage 3 - Aura Monster Subaru)

Each file is a JSON array of "note" objects shaped exactly like this:

    { "time": 1200, "direction": "left", "lane": 0 }

    time      -> when the note must be hit, in milliseconds from song start
    direction -> "left" | "down" | "up" | "right"
    lane      -> 0=left, 1=down, 2=up, 3=right  (matches direction)

YOU DO NOT NEED PYTHON TO PLAY. The game already ships with these JSON
files, and also keeps an identical copy inside script.js as a fallback.
This script is only here so a student can REGENERATE or tweak the charts.

WHY A CUSTOM RANDOM NUMBER GENERATOR?
-------------------------------------
We use a tiny "LCG" (linear congruential generator) with fixed constants
instead of Python's built-in random module. That LCG is implemented the
EXACT same way inside script.js, so Python and JavaScript produce
byte-for-byte identical charts. Regenerating here will match the copy
embedded in the game.

HOW TO RUN
----------
    python tools/generate_charts.py

Run it from anywhere; it writes into the project's charts/ folder.
It uses only the Python standard library - no pip installs required.

TWEAKING
--------
Edit the SONGS list below (bpm, duration_s, place_prob, ...). Because the
LCG is seeded, the same settings always produce the same chart. If you
change a chart here, also update EMBEDDED_CHARTS in script.js (or just
rely on the JSON files loading) so the fallback stays in sync.
"""

import json
import os

# Lane index -> direction name. Index 0 is the left-most lane.
DIRECTIONS = ["left", "down", "up", "right"]

# 32-bit LCG (Numerical Recipes constants). Must match script.js exactly.
LCG_A = 1664525
LCG_C = 1013904223
LCG_M = 4294967296  # 2 ** 32


class Lcg(object):
    """Deterministic pseudo-random generator shared with the JS game."""

    def __init__(self, seed):
        self.state = seed % LCG_M

    def next_float(self):
        # Advance the state, return a float in [0, 1).
        self.state = (LCG_A * self.state + LCG_C) % LCG_M
        return self.state / LCG_M

    def next_int(self, n):
        # Integer in [0, n). floor() matches Math.floor() in JS.
        return int(self.next_float() * n)


# One config block per song. These are the BASE ("medium") charts; the
# game itself thins them for Easy and adds extra notes for Hard.
SONGS = [
    {
        "file": "song1.json",   # Stage 1 - Subaru (calm-ish opener)
        "seed": 101,
        "bpm": 120,             # beats per minute
        "duration_s": 48,       # song length in seconds
        "step_div": 1,          # 1 = a slot every beat (quarter notes)
        "place_prob": 0.78,     # chance to place a note in each slot
        "start_ms": 2000,       # first possible note (lead-in time)
    },
    {
        "file": "song2.json",   # Stage 2 - Angry Subaru (busier)
        "seed": 202,
        "bpm": 138,
        "duration_s": 52,
        "step_div": 2,          # 2 = a slot every half beat (eighth notes)
        "place_prob": 0.42,
        "start_ms": 2000,
    },
    {
        "file": "song3.json",   # Stage 3 - Aura Monster Subaru (intense)
        "seed": 303,
        "bpm": 155,
        "duration_s": 56,
        "step_div": 2,
        "place_prob": 0.46,
        "start_ms": 2000,
    },
]


def pick_lane(rng, prev_lane):
    """Pick a lane 0-3. Avoid repeating the same lane too often so the
    chart feels varied and playable (no machine-gun single key)."""
    lane = rng.next_int(4)
    if lane == prev_lane and rng.next_float() < 0.6:
        lane = rng.next_int(4)  # one reroll to reduce immediate repeats
    return lane


def generate_notes(song):
    """Build the list of note dicts for a single song config.

    NOTE: time is accumulated as a float and truncated with int(), and the
    LCG is called in this exact order, so script.js generates the same
    notes."""
    rng = Lcg(song["seed"])
    beat_ms = 60000.0 / song["bpm"]              # length of one beat
    step_ms = beat_ms / song["step_div"]         # spacing between slots
    end_ms = song["duration_s"] * 1000

    notes = []
    t = float(song["start_ms"])
    prev_lane = -1
    while t < end_ms:
        if rng.next_float() < song["place_prob"]:
            lane = pick_lane(rng, prev_lane)
            # Insertion order (time, direction, lane) is also the JSON order,
            # matching the example note object in the spec.
            notes.append({
                "time": int(t),
                "direction": DIRECTIONS[lane],
                "lane": lane,
            })
            prev_lane = lane
        t += step_ms

    return notes


def main():
    # Locate charts/ relative to this script so it works from any folder.
    here = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(here)
    charts_dir = os.path.join(project_root, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    for song in SONGS:
        notes = generate_notes(song)
        out_path = os.path.join(charts_dir, song["file"])
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(notes, f, indent=2)
            f.write("\n")
        print("Wrote {0:<14} {1:>4} notes  (bpm {2}, {3}s)".format(
            song["file"], len(notes), song["bpm"], song["duration_s"]))

    print("Done. Charts written to:", charts_dir)


if __name__ == "__main__":
    main()
