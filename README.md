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

Two easy ways:

1. **Edit the JSON directly** — open `charts/song1.json` (etc.) and add / remove
   / move note objects.
2. **Regenerate with the Python tool** (optional):
   ```
   python tools/generate_charts.py
   ```
   Uses only the Python standard library. Tweak the `SONGS` list at the top
   (BPM, duration, how busy the chart is) and re-run.

The fallback generator inside `script.js` uses the **exact same algorithm** as
the Python tool (a small seeded LCG), so the JSON files and the built-in fallback
produce identical notes. If you change a chart and want the offline fallback to
match, update the matching `SONG_GEN` settings in `script.js` too — or just rely
on the JSON files loading.

---

## Tuning the game (where to look in `script.js`)

The file is organized into numbered sections (search for the banners):

- **`CONFIG`** — canvas size, lane width, hit-line position, count-in length.
- **`DIFFICULTIES`** — per-difficulty scroll speed, timing windows, note density,
  damage values. This is where Easy / Medium / Hard are defined.
- **`STAGES`** — the three stages, their boss phase, song key, and asset paths.
- **`SONG_GEN`** — the chart-generation settings (mirror of the Python tool).
- Sections 6–10 cover battle setup, input, the game loop, canvas rendering
  (characters, notes, effects) and the stage flow.

Want an easier or harder game? Change `scrollSpeed`, `perfect`/`good` (timing
windows in ms), `density`, or `missDamage` in `DIFFICULTIES`.

---

## How it works (quick tour)

- A single `<canvas>` draws the battle; everything else is HTML/CSS.
- The game loop runs on `requestAnimationFrame`. The current song time is
  tracked in JavaScript (`songTime = now - songStart`), independent of the audio.
- Notes are stored in arrays; each note has `time`, `direction`, `lane`, a
  computed `y`, and `hit`/`missed` flags. A note's `y` is positioned so it
  reaches the hit line exactly at its `time`, then keeps scrolling down.
- Arrow-key presses look for the nearest un-hit note in that lane within the
  timing window and rate it Perfect / Good. Notes that scroll past unhit are
  counted as a Miss.

---

## Troubleshooting

- **No sound?** Expected if you haven't added the `.mp3` files. The game is
  designed to play silently on its internal clock.
- **"Characters look like simple shapes."** Also expected — add the PNGs in
  `assets/images/` to replace them.
- **Notes feel off / charts didn't load from JSON.** The built-in generator is
  being used (common on `file://` and in CodeHS). Gameplay is identical.
- **Arrow keys scroll the page.** They shouldn't during the battle (we call
  `preventDefault`), but make sure the game window/canvas has focus.

Enjoy, and *Return by Rhythm!*
