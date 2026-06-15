# Return by Rhythm

A Friday Night Funkin'-style **rhythm fighting game**, themed after *Re:Zero*
(personal / student project). You play as **Alcor Subaru** — a cool rhythm-game
version of Subaru — and fight three boss phases across three songs:

| Stage | Boss phase | Song |
|------:|------------|------|
| 1 | Subaru | `assets/audio/song1.mp3` |
| 2 | Angry Subaru | `assets/audio/song2.mp3` |
| 3 | Aura Monster Subaru | `assets/audio/song3.mp3` |

> **Note on the theme:** This is an unofficial, non-commercial fan/learning
> project. It ships **no copyrighted art or music** — characters and effects are
> drawn with original canvas shapes, and the audio/image files are just
> placeholders you can drop your own assets into. The game is fully playable
> with no audio or image files at all.

---

## Controls

Notes scroll **down** into four lanes. Press the matching arrow key as a note
reaches its lane target at the hit line:

| Lane | Key | Arrow |
|------|-----|-------|
| 0 | **Left Arrow** | ◄ |
| 1 | **Down Arrow** | ▼ |
| 2 | **Up Arrow** | ▲ |
| 3 | **Right Arrow** | ► |

`Enter` also advances the loading and stage-intro screens.

## How to play / objective

- Hit notes to **damage the boss** and build **combo**.
- Each hit is rated **Perfect**, **Good**, or (if you let a note pass) **Miss**.
- Missing notes **reduces your health**. If your health hits **0 you lose**
  (Game Over).
- **Survive the song** (or drain the boss's health to zero) to **clear the stage**.
- Clear all three stages to reach the **final trophy screen**.

Higher difficulty = more notes, faster scrolling, and stricter timing.

---

## Running the game

### Locally (any modern browser)
Just open **`index.html`** in your browser. That's it — no build step, no server,
no installs.

> If you open it directly from disk (`file://`), the browser may block loading the
> JSON note charts. **That's fine:** the game automatically falls back to an
> identical built-in chart generator, so it plays exactly the same. (To load the
> JSON files instead, serve the folder over HTTP, e.g. any static file server.)

### In CodeHS
1. Create a Web (HTML/CSS/JS) project.
2. Recreate the files below with the **same names and folder structure**.
3. Run it. If CodeHS can't fetch the `charts/*.json` files, the built-in
   fallback generator kicks in automatically — the game still works.

No Node.js, npm, React, Vite, TypeScript, or external libraries are required.

---

## File structure

```
index.html               Page structure: the 8 screens, the battle <canvas>, HUD
style.css                All styling + the loading-screen animation
script.js                All game logic (heavily commented, single file)
charts/song1.json        Note charts: arrays of { time, direction, lane }
charts/song2.json
charts/song3.json
tools/generate_charts.py Optional Python tool to (re)generate the charts
assets/audio/            Put song1.mp3 / song2.mp3 / song3.mp3 here (optional)
assets/images/           Put character & trophy PNGs here (optional)
README.md
```

### A note object
```json
{ "time": 1200, "direction": "left", "lane": 0 }
```
- `time` — when to hit the note, in **milliseconds** from song start
- `direction` — `"left" | "down" | "up" | "right"`
- `lane` — `0=left, 1=down, 2=up, 3=right` (matches `direction`)

---

## Adding your own assets (all optional)

The game tries to load these files and **gracefully falls back** to drawn shapes
if they're missing:

**Audio** (played through a normal `<audio>` tag; timing always comes from the
JavaScript clock, so missing audio never breaks the game):
```
assets/audio/song1.mp3
assets/audio/song2.mp3
assets/audio/song3.mp3
```

**Images** (if present they replace the drawn placeholder characters):
```
assets/images/alcor_subaru.png
assets/images/subaru.png
assets/images/angry_subaru.png
assets/images/aura_monster_subaru.png
assets/images/trophy.png
```

---

## Editing the note charts

The note charts that ship with the game are **synced to the real songs** — the
notes fall on the beat. They were produced by analysing the mp3s (see below).

Three ways to change them:

1. **Edit the JSON directly** — open `charts/song1.json` (etc.) and add / remove
   / move note objects.
2. **Re-sync to your own songs (recommended if you swap the mp3s):**
   ```
   python tools/analyze_audio.py
   ```
   This detects each song's tempo and beats and rewrites `charts/song*.json`
   on the beat. It needs **ffmpeg** on your PATH (to decode the mp3) and prints
   the detected BPM/offset for each song. After running it, paste the contents
   of the generated `tools/_embedded_charts.js` over the `EMBEDDED_CHARTS = …`
   block in `script.js` (the offline fallback), and update each stage's `bpm`
   in the `STAGES` list so the Hard difficulty keeps adding notes on the beat.
3. **Generate a simple placeholder chart (no audio needed):**
   ```
   python tools/generate_charts.py
   ```
   Standard-library only; tweak the `SONGS` list (BPM, duration, busyness).

### How charts load (and the on-beat fallback)
The game first tries to `fetch()` `charts/song*.json`. If that fails (common on
`file://` and in CodeHS), it falls back to `EMBEDDED_CHARTS` inside `script.js`
— the **same beat-aligned notes**, embedded as compact `[timeMs, lane]` pairs —
so the game stays on beat no matter how you open it. (A simple procedural
generator is the final fallback if the embedded data is ever removed.)

### Staying in sync while playing
The chart times and `audio.currentTime` share the same timeline, so once the
music is playing the game **anchors its clock to the audio** every frame (big
gaps snap, small drift is nudged gently). That keeps the notes locked to the
song even if playback starts a little late.

### Difficulties stay on beat
- **Easy** keeps a subset of the on-beat notes (wider timing, slower scroll).
- **Medium** is the base beat-aligned chart.
- **Hard** adds extra notes, but only ever on the **half-beat** (the midpoint of
  a full-beat gap), so it stays musically aligned. Faster scroll, stricter timing.

---

## Tuning the game (where to look in `script.js`)

The file is organized into numbered sections (search for the banners):

- **`CONFIG`** — canvas size, lane width, hit-line position, count-in length.
- **`DIFFICULTIES`** — per-difficulty scroll speed, timing windows, note density,
  damage values. This is where Easy / Medium / Hard are defined.
- **`STAGES`** — the three stages, their boss phase, song key, detected `bpm`,
  and asset paths.
- **`EMBEDDED_CHARTS`** — the beat-aligned notes embedded for the offline
  fallback (auto-generated by `tools/analyze_audio.py`).
- **`SONG_GEN`** — settings for the simple last-resort procedural generator.
- Sections 6–10 cover battle setup, input, the game loop, canvas rendering
  (characters, notes, effects) and the stage flow.

Want an easier or harder game? Change `scrollSpeed`, `perfect`/`good` (timing
windows in ms), `density`, or `missDamage` in `DIFFICULTIES`.

---

## How it works (quick tour)

- A single `<canvas>` draws the battle; everything else is HTML/CSS.
- The game loop runs on `requestAnimationFrame`. The current song time is
  tracked in JavaScript (`songTime = now - songStart`); when the music is
  playing, that clock is anchored to `audio.currentTime` so notes stay in sync.
- Notes are stored in arrays; each note has `time`, `direction`, `lane`, a
  computed `y`, and `hit`/`missed` flags. A note's `y` is positioned so it
  reaches the hit line exactly at its `time`, then keeps scrolling down.
- Arrow-key presses look for the nearest un-hit note in that lane within the
  timing window and rate it Perfect / Good. Notes that scroll past unhit are
  counted as a Miss.

---

## Troubleshooting

- **No sound?** First make sure `assets/audio/song1.mp3` … `song3.mp3` exist.
  Browsers block audio that isn't started by a click ("autoplay policy"); the
  game works around this by priming the audio when you press **Begin Battle**,
  so start a stage from that button. If a song is still silent the game keeps
  playing on its internal clock (notes still work).
- **"Characters look like simple shapes."** Expected — add the PNGs in
  `assets/images/` to replace them.
- **Notes feel slightly off the music.** The shipped charts are beat-detected;
  if you replaced the mp3s, re-run `python tools/analyze_audio.py` (needs
  ffmpeg) to re-sync, and update `EMBEDDED_CHARTS` + `STAGES[].bpm` as noted
  above. Opening over a local web server (so the JSON loads) also helps.
- **Arrow keys scroll the page.** They shouldn't during the battle (we call
  `preventDefault`), but make sure the game window/canvas has focus.

## Optional tools (only for re-syncing charts)
You do **not** need these to play. To re-detect beats from your own songs:
- **Python 3** (standard library only)
- **ffmpeg** on your PATH (decodes the mp3s for analysis)

Enjoy, and *Return by Rhythm!*
