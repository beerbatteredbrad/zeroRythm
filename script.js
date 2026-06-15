/* ============================================================
   RETURN BY RHYTHM - script.js
   A Friday Night Funkin'-style rhythm fighting game.
   Plain JavaScript (no libraries, no modules) so it runs in CodeHS.

   Re:Zero is referenced in spirit only - all characters and effects
   are drawn from original shapes here; no copyrighted assets are bundled.

   READING GUIDE (top to bottom):
     1. CONFIG / DIFFICULTIES / STAGES ........ tunable settings
     2. Seeded chart generator ................ the JSON fallback
     3. Chart loading ......................... fetch JSON, else generate
     4. DOM references + screen state machine
     5. Loading screen + menus + difficulty + intro
     6. Battle setup + difficulty transforms
     7. Keyboard input + note judgement
     8. Game loop (requestAnimationFrame) + update
     9. Rendering on the canvas (characters, notes, effects)
    10. Stage flow (clear / game over / final trophy)
   Search for the numbered banners to jump around.
   ============================================================ */

(function () {
  "use strict";

  /* =========================================================
     1. CONFIG - core numbers you can safely tweak
     ========================================================= */
  var CONFIG = {
    W: 960,            // canvas internal width  (CSS scales it to fit)
    H: 600,            // canvas internal height
    LANE_COUNT: 4,
    LANE_W: 86,        // width of one lane
    HIT_LINE_Y: 470,   // y of the lane targets (where you hit notes)
    RECEPTOR: 64,      // size of a lane target / note
    COUNTIN_MS: 3000,  // 3..2..1 before the song starts
    SONG_TAIL_MS: 2600,// extra time after the last note before "song over"
    PLAYER_MAX_HP: 100
  };
  // x-centre of each lane (computed so the 4 lanes are centred on screen).
  CONFIG.LANES_W = CONFIG.LANE_COUNT * CONFIG.LANE_W;
  CONFIG.LANES_X0 = (CONFIG.W - CONFIG.LANES_W) / 2;
  CONFIG.laneCenterX = function (lane) {
    return CONFIG.LANES_X0 + lane * CONFIG.LANE_W + CONFIG.LANE_W / 2;
  };

  // Lane index <-> arrow direction. 0=left, 1=down, 2=up, 3=right.
  var DIRECTIONS = ["left", "down", "up", "right"];
  var KEY_TO_LANE = {
    ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3
  };
  // Note colours per lane (FNF-style palette).
  var LANE_COLORS = ["#c24bff", "#39a8ff", "#41e08a", "#ff4d6d"];

  /* Difficulty presets.
     scrollSpeed = pixels travelled per millisecond (higher = faster).
     perfect/good = timing windows in ms (smaller = stricter).
     density = how many notes (1 = base chart, <1 thins, >1 adds notes).
     missDamage = HP lost per missed note.
     bossPerfect/bossGood = damage dealt to the boss per hit. */
  var DIFFICULTIES = {
    easy:   { label: "Easy",   scrollSpeed: 0.34, perfect: 75, good: 135, density: 0.6, missDamage: 6,  bossPerfect: 6, bossGood: 3.5 },
    medium: { label: "Medium", scrollSpeed: 0.45, perfect: 55, good: 105, density: 1.0, missDamage: 9,  bossPerfect: 5, bossGood: 3 },
    hard:   { label: "Hard",   scrollSpeed: 0.60, perfect: 38, good: 78,  density: 1.5, missDamage: 12, bossPerfect: 4, bossGood: 2.4 }
  };

  /* The three stages. Each one is a different boss "phase". */
  var STAGES = [
    { id: 1, key: "song1", boss: "subaru", name: "Subaru",
      audio: "assets/audio/song1.mp3", img: "assets/images/subaru.png",
      tagline: "\"Why does it always have to be me?\"" },
    { id: 2, key: "song2", boss: "angry",  name: "Angry Subaru",
      audio: "assets/audio/song2.mp3", img: "assets/images/angry_subaru.png",
      tagline: "\"I'm so sick of starting over!\"" },
    { id: 3, key: "song3", boss: "aura",   name: "Aura Monster Subaru",
      audio: "assets/audio/song3.mp3", img: "assets/images/aura_monster_subaru.png",
      tagline: "The Witch's power floods out. This is the end." }
  ];

  /* =========================================================
     2. SEEDED CHART GENERATOR (the script.js fallback)
     This is the SAME algorithm as tools/generate_charts.py, so the
     charts it produces are identical to charts/song*.json. If the
     JSON files fail to load (which can happen in CodeHS), we just
     regenerate the very same notes right here in the browser.
     A tiny LCG keeps all values below 2^53 so plain numbers stay exact.
     ========================================================= */
  var LCG_A = 1664525, LCG_C = 1013904223, LCG_M = 4294967296;
  function Lcg(seed) { this.state = seed % LCG_M; }
  Lcg.prototype.nextFloat = function () {
    this.state = (LCG_A * this.state + LCG_C) % LCG_M;
    return this.state / LCG_M;
  };
  Lcg.prototype.nextInt = function (n) { return Math.floor(this.nextFloat() * n); };

  // Must match the SONGS list in tools/generate_charts.py.
  var SONG_GEN = {
    song1: { seed: 101, bpm: 120, durationS: 48, stepDiv: 1, placeProb: 0.78, startMs: 2000 },
    song2: { seed: 202, bpm: 138, durationS: 52, stepDiv: 2, placeProb: 0.42, startMs: 2000 },
    song3: { seed: 303, bpm: 155, durationS: 56, stepDiv: 2, placeProb: 0.46, startMs: 2000 }
  };

  function pickLaneGen(rng, prev) {
    var lane = rng.nextInt(4);
    if (lane === prev && rng.nextFloat() < 0.6) lane = rng.nextInt(4);
    return lane;
  }
  function generateChart(key) {
    var s = SONG_GEN[key];
    var rng = new Lcg(s.seed);
    var beatMs = 60000.0 / s.bpm;
    var stepMs = beatMs / s.stepDiv;
    var endMs = s.durationS * 1000;
    var notes = [];
    var t = s.startMs, prev = -1;
    while (t < endMs) {
      if (rng.nextFloat() < s.placeProb) {
        var lane = pickLaneGen(rng, prev);
        notes.push({ time: Math.floor(t), direction: DIRECTIONS[lane], lane: lane });
        prev = lane;
      }
      t += stepMs;
    }
    return notes;
  }

  /* =========================================================
     3. CHART LOADING - try the JSON files, fall back to generator
     ========================================================= */
  var CHARTS = {};   // filled in before the player can start

  function normalizeChart(data) {
    // Make sure every note has time/direction/lane and is sorted.
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var n = data[i];
      var lane = (typeof n.lane === "number") ? n.lane : DIRECTIONS.indexOf(n.direction);
      if (lane < 0 || lane > 3) continue;
      out.push({ time: n.time | 0, direction: DIRECTIONS[lane], lane: lane });
    }
    out.sort(function (a, b) { return a.time - b.time; });
    return out;
  }

  function fetchJSON(url, done) {
    // fetch can reject on the file:// protocol (common in CodeHS); we
    // catch every failure and let the caller use the generator instead.
    try {
      fetch(url)
        .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
        .then(function (j) { done(null, j); })
        .catch(function () { done(true, null); });
    } catch (e) { done(true, null); }
  }

  function loadAllCharts(cb) {
    var keys = ["song1", "song2", "song3"];
    var pending = keys.length;
    keys.forEach(function (k) {
      fetchJSON("charts/" + k + ".json", function (err, data) {
        if (err || !data || !data.length) {
          CHARTS[k] = generateChart(k);          // fallback (identical notes)
        } else {
          CHARTS[k] = normalizeChart(data);      // loaded from JSON
        }
        pending--;
        if (pending === 0) cb();
      });
    });
  }

  /* =========================================================
     4. DOM REFERENCES + SCREEN STATE MACHINE
     ========================================================= */
  function $(id) { return document.getElementById(id); }

  var dom = {};
  var canvas, ctx;
  var audioEl;
  var STATE = "loading";   // which screen is active

  function showScreen(name) {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove("active");
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
    STATE = name;
  }

  /* =========================================================
     5. LOADING, MENU, DIFFICULTY, INTRO
     ========================================================= */
  var selectedDiff = "medium";
  var currentStageIndex = 0;

  // Falling snow: create lightweight divs the CSS animates.
  function createSnow(layer, count) {
    if (!layer) return;
    for (var i = 0; i < count; i++) {
      var f = document.createElement("div");
      f.className = "snowflake";
      var size = 2 + Math.random() * 4;
      f.style.width = size + "px";
      f.style.height = size + "px";
      f.style.left = (Math.random() * 100) + "%";
      f.style.animationDuration = (6 + Math.random() * 7) + "s";
      f.style.animationDelay = (-Math.random() * 10) + "s";
      f.style.setProperty("--drift", (Math.random() * 60 - 30) + "px");
      f.style.opacity = (0.4 + Math.random() * 0.5).toString();
      layer.appendChild(f);
    }
  }

  function runLoadingSequence() {
    var fill = $("loading-bar-fill");
    var btn = $("btn-loading-start");
    var progress = 0, chartsReady = false;

    function tryEnable() {
      if (chartsReady && progress >= 100) {
        btn.disabled = false;
        btn.textContent = "Enter";
        btn.classList.remove("btn-ghost");
        btn.classList.add("btn-primary");
      }
    }
    var timer = setInterval(function () {
      progress = Math.min(100, progress + 4);
      fill.style.width = progress + "%";
      if (progress >= 100) { clearInterval(timer); tryEnable(); }
    }, 55);

    loadAllCharts(function () { chartsReady = true; tryEnable(); });

    btn.addEventListener("click", function () {
      if (!btn.disabled) showScreen("menu");
    });
  }

  function wireMenus() {
    $("btn-play").addEventListener("click", function () { showScreen("difficulty"); });
    $("btn-howto").addEventListener("click", function () {
      $("howto-box").classList.toggle("hidden");
    });
    $("btn-quit").addEventListener("click", function () { showScreen("loading"); });

    // Difficulty buttons
    var diffBtns = document.querySelectorAll(".btn-diff");
    for (var i = 0; i < diffBtns.length; i++) {
      diffBtns[i].addEventListener("click", function () {
        selectedDiff = this.getAttribute("data-diff");
        currentStageIndex = 0;
        showIntro();
      });
    }
    $("btn-diff-back").addEventListener("click", function () { showScreen("menu"); });

    $("btn-intro-start").addEventListener("click", beginBattle);
    $("btn-clear-next").addEventListener("click", onClearContinue);
    $("btn-retry").addEventListener("click", beginBattle);
    $("btn-gameover-menu").addEventListener("click", function () { showScreen("menu"); });
    $("btn-win-menu").addEventListener("click", function () {
      currentStageIndex = 0; showScreen("menu");
    });

    // Trophy image: if the PNG is missing, show the CSS-drawn trophy.
    var trophy = $("trophy-img");
    trophy.addEventListener("error", function () {
      trophy.classList.add("failed");
      $("trophy-fallback").classList.add("show");
    });
  }

  function showIntro() {
    var s = STAGES[currentStageIndex];
    $("intro-stage-label").textContent = "Stage " + s.id;
    $("intro-boss-name").textContent = s.name;
    $("intro-tagline").textContent = s.tagline;
    // Portrait: try the boss PNG; if it never loads the round panel just
    // keeps its themed gradient background.
    var portrait = $("intro-portrait");
    portrait.style.backgroundImage = "url('" + s.img + "')";
    showScreen("intro");
  }

  /* =========================================================
     6. BATTLE SETUP + DIFFICULTY TRANSFORMS
     ========================================================= */
  var B = null;   // the live battle state (null when not playing)

  // Thin a chart down (keep a fraction of notes, evenly spread).
  function thinChart(notes, keepRatio) {
    var out = [], acc = 0;
    for (var i = 0; i < notes.length; i++) {
      acc += keepRatio;
      if (acc >= 1) { acc -= 1; out.push(notes[i]); }
    }
    return out;
  }
  // Add extra notes between existing ones (for Hard).
  function densifyChart(notes, factor) {
    var rng = new Lcg(7 + currentStageIndex * 13);  // stable per stage
    var out = [];
    for (var i = 0; i < notes.length; i++) {
      out.push(notes[i]);
      if (i + 1 < notes.length) {
        var a = notes[i], b = notes[i + 1];
        var gap = b.time - a.time;
        if (gap >= 260 && rng.nextFloat() < (factor - 1)) {
          var lane = rng.nextInt(4);
          if (lane === a.lane || lane === b.lane) lane = (lane + 1) % 4;
          out.push({
            time: a.time + Math.floor(gap / 2),
            direction: DIRECTIONS[lane], lane: lane
          });
        }
      }
    }
    out.sort(function (x, y) { return x.time - y.time; });
    return out;
  }

  function applyDifficulty(base, diff) {
    var notes = base.slice();
    if (diff.density < 1) notes = thinChart(notes, diff.density);
    else if (diff.density > 1) notes = densifyChart(notes, diff.density);
    return notes;
  }

  function initBattle() {
    var stage = STAGES[currentStageIndex];
    var diff = DIFFICULTIES[selectedDiff];
    var base = CHARTS[stage.key] || generateChart(stage.key);
    var shaped = applyDifficulty(base, diff);

    var notes = shaped.map(function (n) {
      return { time: n.time, direction: n.direction, lane: n.lane,
               y: -100, hit: false, missed: false, fade: 1 };
    });

    var lastTime = notes.length ? notes[notes.length - 1].time : 4000;
    // Boss HP scales with note count so a strong run drains it by song end.
    var bossMaxHP = Math.max(40, notes.length * diff.bossPerfect * 0.7);

    B = {
      stage: stage, diff: diff, notes: notes,
      score: 0, combo: 0, maxCombo: 0,
      perfect: 0, good: 0, miss: 0,
      playerHP: CONFIG.PLAYER_MAX_HP,
      bossHP: bossMaxHP, bossMaxHP: bossMaxHP,
      songStart: 0, songTime: -CONFIG.COUNTIN_MS,
      songDuration: lastTime + CONFIG.SONG_TAIL_MS,
      started: false, audioStarted: false, over: false,
      pressed: [false, false, false, false],
      laneFlash: [0, 0, 0, 0],
      effects: [], auraParticles: [],
      bossFlash: 0, bossRecoil: 0,
      shakeMag: 0, lastCount: 99
    };
  }

  function beginBattle() {
    initBattle();
    // HUD labels
    $("hud-stage").textContent = "Stage " + B.stage.id + " - " + B.stage.name;
    $("hud-diff").textContent = B.diff.label;
    $("boss-bar-label").textContent = B.stage.name;
    $("hud-score").textContent = "0";
    $("hud-combo").textContent = "0 combo";
    updateBars();
    showScreen("play");
    // The song clock (songStart) is seeded on the first update frame so it
    // uses the exact same timestamp source as the game loop (see updateBattle).
  }

  /* =========================================================
     7. KEYBOARD INPUT + NOTE JUDGEMENT
     ========================================================= */
  function onKeyDown(e) {
    var lane = KEY_TO_LANE[e.key];
    if (lane === undefined) {
      if (e.key === "Enter") handleEnter();
      return;
    }
    e.preventDefault();                 // stop the page from scrolling
    if (STATE !== "play" || !B || B.over) return;
    if (B.pressed[lane]) return;        // ignore key auto-repeat
    B.pressed[lane] = true;
    B.laneFlash[lane] = 1;
    judgeLane(lane);
  }
  function onKeyUp(e) {
    var lane = KEY_TO_LANE[e.key];
    if (lane !== undefined && B) B.pressed[lane] = false;
  }
  function handleEnter() {
    // Enter advances through the simple screens for convenience.
    if (STATE === "loading" && !$("btn-loading-start").disabled) showScreen("menu");
    else if (STATE === "intro") beginBattle();
  }

  function judgeLane(lane) {
    if (B.songTime < 0) return;         // still in the count-in
    var diff = B.diff;
    var best = null, bestDelta = 1e9;
    for (var i = 0; i < B.notes.length; i++) {
      var n = B.notes[i];
      if (n.lane !== lane || n.hit || n.missed) continue;
      var delta = Math.abs(n.time - B.songTime);
      if (delta <= diff.good && delta < bestDelta) { best = n; bestDelta = delta; }
    }
    if (!best) return;                   // empty tap -> no penalty, just a flash
    if (bestDelta <= diff.perfect) registerHit(best, "perfect");
    else registerHit(best, "good");
  }

  function registerHit(note, rating) {
    note.hit = true;
    B.combo++;
    if (B.combo > B.maxCombo) B.maxCombo = B.combo;

    var base = (rating === "perfect") ? 350 : 150;
    B.score += base + Math.min(B.combo, 50) * 2;
    if (rating === "perfect") B.perfect++; else B.good++;

    var dmg = (rating === "perfect") ? B.diff.bossPerfect : B.diff.bossGood;
    B.bossHP = Math.max(0, B.bossHP - dmg);

    spawnHitEffect(note.lane, rating);
    B.bossFlash = 1;
    B.bossRecoil = (rating === "perfect") ? 16 : 10;
    if (rating === "perfect") B.shakeMag = Math.max(B.shakeMag, 7);
    showRating(rating);
    updateBars();
    $("hud-score").textContent = B.score.toString();
    $("hud-combo").textContent = B.combo + " combo";
  }

  function registerMiss(note) {
    note.missed = true;
    B.combo = 0;
    B.miss++;
    B.playerHP = Math.max(0, B.playerHP - B.diff.missDamage);
    showRating("miss");
    B.shakeMag = Math.max(B.shakeMag, 4);
    updateBars();
    $("hud-combo").textContent = "0 combo";
  }

  function showRating(kind) {
    var el = $("rating-popup");
    el.textContent = kind === "perfect" ? "PERFECT" : (kind === "good" ? "GOOD" : "MISS");
    el.className = "rating-popup " + kind;   // reset classes
    // Force the CSS animation to restart by reflowing.
    void el.offsetWidth;
    el.classList.add("show");
  }

  function updateBars() {
    $("player-hp-fill").style.width = (B.playerHP / CONFIG.PLAYER_MAX_HP * 100) + "%";
    $("boss-hp-fill").style.width = (B.bossHP / B.bossMaxHP * 100) + "%";
  }

  /* =========================================================
     8. GAME LOOP + UPDATE
     ========================================================= */
  function loop(now) {
    requestAnimationFrame(loop);
    if (STATE === "play" && B && !B.over) {
      updateBattle(now);
      renderBattle(now);
    }
  }

  function updateBattle(now) {
    // Seed the song clock on the first frame so songStart and songTime share
    // the same timestamp source (the rAF `now`). Gives a clean 3..2..1 count-in.
    if (!B.started) { B.started = true; B.songStart = now + CONFIG.COUNTIN_MS; }
    B.songTime = now - B.songStart;

    // Count-in 3..2..1 then start the (optional) music at song time 0.
    if (B.songTime < 0) {
      var secs = Math.ceil(-B.songTime / 1000);   // 3,2,1
      if (secs !== B.lastCount) { showCountIn(secs); B.lastCount = secs; }
    } else if (!B.audioStarted) {
      B.audioStarted = true;
      if (B.lastCount !== 0) { showCountIn(0); B.lastCount = 0; }
      startAudio();
    }

    // Mark notes that scrolled past the hit line without being hit.
    for (var i = 0; i < B.notes.length; i++) {
      var n = B.notes[i];
      if (!n.hit && !n.missed && B.songTime > n.time + B.diff.good) registerMiss(n);
    }

    // Decay visual feedback timers.
    if (B.bossFlash > 0) B.bossFlash = Math.max(0, B.bossFlash - 0.06);
    if (B.bossRecoil > 0) B.bossRecoil = Math.max(0, B.bossRecoil - 1.2);
    if (B.shakeMag > 0) B.shakeMag = Math.max(0, B.shakeMag - 0.5);
    for (var l = 0; l < 4; l++) if (B.laneFlash[l] > 0) B.laneFlash[l] = Math.max(0, B.laneFlash[l] - 0.08);

    updateEffects();
    updateAura(now);

    // Win / lose checks.
    if (B.playerHP <= 0) { endBattle("gameover"); return; }
    if (B.bossHP <= 0) { endBattle("clear"); return; }            // early KO
    if (B.songTime >= B.songDuration) { endBattle("clear"); return; }  // survived
  }

  function showCountIn(secs) {
    var el = $("countin");
    el.textContent = secs > 0 ? secs.toString() : "GO!";
    el.className = "countin";
    void el.offsetWidth;
    el.classList.add("show");
  }

  /* =========================================================
     9. RENDERING (canvas) - characters, notes, effects
     ========================================================= */

  // --- Image assets: try to load PNGs, fall back to drawn shapes. ---
  function loadImg(src) {
    var img = new Image();
    img.ok = false;
    img.onload = function () { img.ok = true; };
    img.onerror = function () { img.ok = false; };
    img.src = src;
    return img;
  }
  var IMG = {
    alcor: loadImg("assets/images/alcor_subaru.png"),
    subaru: loadImg("assets/images/subaru.png"),
    angry: loadImg("assets/images/angry_subaru.png"),
    aura: loadImg("assets/images/aura_monster_subaru.png")
  };

  // Visual palettes for the drawn (fallback) characters.
  var PALETTES = {
    alcor:  { skin: "#f0c9a8", hair: "#15151c", coat: "#1b2340", coatDark: "#0d1124",
              accent: "#e0143c", eye: "#43e0ff", glow: "#43e0ff", aura: "rgba(123,47,247,0.5)" },
    subaru: { skin: "#f0c9a8", hair: "#1a1a22", coat: "#6a6f7a", coatDark: "#3c4049",
              accent: "#ff7a3c", eye: "#222", glow: "#ff7a3c", aura: "rgba(120,140,200,0.35)" },
    angry:  { skin: "#e8b89a", hair: "#101016", coat: "#5a1020", coatDark: "#2a0810",
              accent: "#ff2a2a", eye: "#ff3030", glow: "#ff2a2a", aura: "rgba(224,20,60,0.6)" },
    aura:   { skin: "#cdd6ff", hair: "#05040a", coat: "#0c0c18", coatDark: "#05050c",
              accent: "#7b2ff7", eye: "#ffffff", glow: "#b06bff", aura: "rgba(123,47,247,0.75)",
              monster: true }
  };

  function renderBattle(now) {
    ctx.clearRect(0, 0, CONFIG.W, CONFIG.H);

    // Screen shake: nudge the whole battle drawing.
    var sx = 0, sy = 0;
    if (B.shakeMag > 0.2) {
      sx = (Math.random() * 2 - 1) * B.shakeMag;
      sy = (Math.random() * 2 - 1) * B.shakeMag;
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawBackground(now);
    drawAura(now);                                   // glow + particles behind boss
    drawCharacter("alcor", PALETTES.alcor, 165, 430, 1.0, now, 0, false);
    var phase = B.stage.boss;                        // subaru / angry / aura
    var bossScale = phase === "aura" ? 1.35 : (phase === "angry" ? 1.12 : 1.0);
    drawCharacter(bossImgKey(phase), PALETTES[phase], 800 + B.bossRecoil, 430, bossScale, now, B.bossFlash, true);

    drawLanes();
    drawReceptors();
    drawNotes();
    drawEffects();

    ctx.restore();

    // HUD song-progress bar (DOM).
    var prog = Math.max(0, Math.min(1, B.songTime / B.songDuration));
    $("song-progress-fill").style.width = (prog * 100) + "%";
  }

  function bossImgKey(phase) {
    return phase === "subaru" ? "subaru" : (phase === "angry" ? "angry" : "aura");
  }

  function drawBackground(now) {
    var phase = B.stage.boss;
    var g = ctx.createLinearGradient(0, 0, 0, CONFIG.H);
    if (phase === "subaru") { g.addColorStop(0, "#0d1530"); g.addColorStop(1, "#05060a"); }
    else if (phase === "angry") {
      var p = 0.5 + 0.5 * Math.sin(now / 220);
      g.addColorStop(0, "#2a0610"); g.addColorStop(1, "#0a0205");
      ctx.fillStyle = g; ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
      ctx.fillStyle = "rgba(224,20,60," + (0.06 + 0.06 * p) + ")";
      ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
      return;
    } else { g.addColorStop(0, "#100626"); g.addColorStop(1, "#03030a"); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
  }

  // Glowing aura + floating particles behind the boss; intensity per phase.
  function drawAura(now) {
    var phase = B.stage.boss;
    var pal = PALETTES[phase];
    var bx = 800, by = 300;
    var pulse = 0.5 + 0.5 * Math.sin(now / (phase === "aura" ? 300 : 500));
    var radius = (phase === "aura" ? 230 : phase === "angry" ? 170 : 130) * (0.9 + 0.2 * pulse);

    var rg = ctx.createRadialGradient(bx, by, 10, bx, by, radius);
    rg.addColorStop(0, pal.aura);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(bx - radius, by - radius, radius * 2, radius * 2);

    // Rotating magic circle for the final monster.
    if (phase === "aura") {
      ctx.save();
      ctx.translate(bx, by + 120);
      ctx.rotate(now / 1400);
      ctx.strokeStyle = "rgba(176,107,255,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([14, 12]);
      ctx.beginPath(); ctx.arc(0, 0, 120, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Particles.
    for (var i = 0; i < B.auraParticles.length; i++) {
      var pt = B.auraParticles[i];
      var a = pt.life / pt.maxLife;
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function updateAura(now) {
    var phase = B.stage.boss;
    var rate = phase === "aura" ? 4 : phase === "angry" ? 2 : 1;
    var pal = PALETTES[phase];
    for (var r = 0; r < rate; r++) {
      if (B.auraParticles.length > 160) break;
      var ang = Math.random() * Math.PI * 2;
      var dist = 40 + Math.random() * 70;
      B.auraParticles.push({
        x: 800 + Math.cos(ang) * dist,
        y: 300 + Math.sin(ang) * dist,
        vx: (Math.random() * 2 - 1) * 0.6,
        vy: -0.6 - Math.random() * 1.4,
        size: 2 + Math.random() * (phase === "aura" ? 4 : 2.5),
        life: 1, maxLife: 1,
        color: phase === "subaru" ? "#9fb4ff" : phase === "angry" ? "#ff5a5a" : (Math.random() < 0.5 ? "#b06bff" : "#6fe9ff"),
        decay: 0.008 + Math.random() * 0.01
      });
    }
    for (var i = B.auraParticles.length - 1; i >= 0; i--) {
      var p = B.auraParticles[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.life <= 0) B.auraParticles.splice(i, 1);
    }
  }

  // Draw a character: use the PNG if it loaded, otherwise a drawn figure.
  function drawCharacter(imgKey, pal, cx, feetY, scale, now, flash, isBoss) {
    var img = IMG[imgKey];
    // Idle bob (breathing). Angry/monster bob faster & harder.
    var bobSpeed = pal.monster ? 240 : (pal === PALETTES.angry ? 300 : 420);
    var bobAmp = pal.monster ? 10 : (pal === PALETTES.angry ? 7 : 5);
    var bob = Math.sin(now / bobSpeed) * bobAmp;

    if (img && img.ok) {
      var w = 200 * scale, h = 240 * scale;
      ctx.save();
      ctx.translate(cx, feetY + bob);
      if (isBoss) ctx.scale(-1, 1);   // face the player
      ctx.drawImage(img, -w / 2, -h, w, h);
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.6;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(img, -w / 2, -h, w, h);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    drawFighter(cx, feetY + bob, scale, pal, flash, isBoss);
  }

  // Stylised fallback figure (drawn entirely with canvas shapes).
  function drawFighter(cx, feetY, s, pal, flash, faceLeft) {
    ctx.save();
    ctx.translate(cx, feetY);
    if (faceLeft) ctx.scale(-1, 1);   // bosses look toward the player

    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 2 * s, 50 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // coat / cloak (trapezoid skirt)
    var coatGrad = ctx.createLinearGradient(0, -150 * s, 0, 0);
    coatGrad.addColorStop(0, pal.coat);
    coatGrad.addColorStop(1, pal.coatDark);
    ctx.fillStyle = coatGrad;
    ctx.beginPath();
    ctx.moveTo(-28 * s, -92 * s);
    ctx.lineTo(28 * s, -92 * s);
    ctx.lineTo(40 * s, -6 * s);
    ctx.quadraticCurveTo(0, 6 * s, -40 * s, -6 * s);
    ctx.closePath();
    ctx.fill();

    // torso
    roundRect(-27 * s, -140 * s, 54 * s, 52 * s, 12 * s);
    ctx.fillStyle = coatGrad;
    ctx.fill();

    // accent stripe (scarf / belt)
    ctx.fillStyle = pal.accent;
    ctx.fillRect(-27 * s, -104 * s, 54 * s, 7 * s);

    // arms
    ctx.fillStyle = pal.coatDark;
    roundRect(-40 * s, -138 * s, 14 * s, 46 * s, 7 * s); ctx.fill();
    roundRect(26 * s, -138 * s, 14 * s, 46 * s, 7 * s); ctx.fill();

    // head
    ctx.fillStyle = pal.skin;
    ctx.beginPath();
    ctx.arc(0, -162 * s, 20 * s, 0, Math.PI * 2);
    ctx.fill();

    // hair (top arc)
    ctx.fillStyle = pal.hair;
    ctx.beginPath();
    ctx.arc(0, -164 * s, 21 * s, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineTo(18 * s, -150 * s);
    ctx.lineTo(-18 * s, -150 * s);
    ctx.closePath();
    ctx.fill();

    // eyes
    ctx.fillStyle = pal.eye;
    if (pal.monster) {
      // glowing monster eyes
      ctx.shadowColor = pal.glow; ctx.shadowBlur = 14 * s;
      ctx.beginPath(); ctx.arc(-8 * s, -162 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(8 * s, -162 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillRect(-11 * s, -164 * s, 6 * s, 4 * s);
      ctx.fillRect(5 * s, -164 * s, 6 * s, 4 * s);
    }

    // angry eyebrows
    if (pal === PALETTES.angry || pal.monster) {
      ctx.strokeStyle = pal.monster ? pal.glow : "#000";
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.moveTo(-13 * s, -171 * s); ctx.lineTo(-4 * s, -167 * s);
      ctx.moveTo(13 * s, -171 * s); ctx.lineTo(4 * s, -167 * s);
      ctx.stroke();
    }

    // Alcor: headphones + glowing visor line
    if (pal === PALETTES.alcor) {
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 4 * s;
      ctx.beginPath(); ctx.arc(0, -164 * s, 23 * s, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.fillStyle = pal.glow;
      ctx.shadowColor = pal.glow; ctx.shadowBlur = 12 * s;
      ctx.fillRect(-22 * s, -166 * s, 6 * s, 10 * s);
      ctx.fillRect(16 * s, -166 * s, 6 * s, 10 * s);
      ctx.fillRect(-12 * s, -160 * s, 24 * s, 3 * s);  // visor glow
      ctx.shadowBlur = 0;
    }

    // Monster: jagged aura spikes around the body
    if (pal.monster) {
      ctx.strokeStyle = pal.glow;
      ctx.lineWidth = 2 * s;
      ctx.globalAlpha = 0.8;
      for (var k = 0; k < 10; k++) {
        var a = (k / 10) * Math.PI * 2;
        var r1 = 46 * s, r2 = 64 * s;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, -120 * s + Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, -120 * s + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // hit flash overlay
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.55;
      ctx.fillStyle = "#ffffff";
      roundRect(-30 * s, -150 * s, 60 * s, 150 * s, 14 * s); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -162 * s, 21 * s, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawLanes() {
    // Subtle lane columns so the play area reads clearly.
    for (var l = 0; l < CONFIG.LANE_COUNT; l++) {
      var x = CONFIG.LANES_X0 + l * CONFIG.LANE_W;
      ctx.fillStyle = (l % 2 === 0) ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(x, 0, CONFIG.LANE_W, CONFIG.H);
    }
    // Glowing hit line across the lanes.
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CONFIG.LANES_X0, CONFIG.HIT_LINE_Y);
    ctx.lineTo(CONFIG.LANES_X0 + CONFIG.LANES_W, CONFIG.HIT_LINE_Y);
    ctx.stroke();
  }

  function drawReceptors() {
    for (var l = 0; l < CONFIG.LANE_COUNT; l++) {
      var x = CONFIG.laneCenterX(l);
      var pressed = B.laneFlash[l] > 0.05 || B.pressed[l];
      drawArrow(x, CONFIG.HIT_LINE_Y, CONFIG.RECEPTOR, l,
                pressed ? LANE_COLORS[l] : "rgba(0,0,0,0)",
                "rgba(255,255,255,0.85)", pressed ? LANE_COLORS[l] : null,
                pressed ? 18 : 0);
    }
  }

  function drawNotes() {
    var speed = B.diff.scrollSpeed;
    for (var i = 0; i < B.notes.length; i++) {
      var n = B.notes[i];
      if (n.hit) continue;
      // y so the note reaches the hit line exactly at n.time.
      n.y = CONFIG.HIT_LINE_Y - (n.time - B.songTime) * speed;
      if (n.y < -CONFIG.RECEPTOR || n.y > CONFIG.H + CONFIG.RECEPTOR) continue;
      var x = CONFIG.laneCenterX(n.lane);
      var alpha = 1;
      if (n.missed) { alpha = Math.max(0, n.fade -= 0.04); }  // fade missed notes
      ctx.globalAlpha = alpha;
      drawArrow(x, n.y, CONFIG.RECEPTOR, n.lane, LANE_COLORS[n.lane], "rgba(0,0,0,0.5)", LANE_COLORS[n.lane], 10);
      ctx.globalAlpha = 1;
    }
  }

  // Draw a directional arrow centred at (cx,cy). dir: 0=L,1=D,2=U,3=R.
  // Base shape points UP, then we rotate it for the lane direction.
  function drawArrow(cx, cy, size, dir, fill, stroke, glow, blur) {
    var s = size / 2;
    var angle = [-Math.PI / 2, Math.PI, 0, Math.PI / 2][dir]; // L,D,U,R from an up arrow
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = blur || 12; }
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(-s, 0);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(-s * 0.5, s);
    ctx.lineTo(s * 0.5, s);
    ctx.lineTo(s * 0.5, 0);
    ctx.lineTo(s, 0);
    ctx.closePath();
    if (fill && fill !== "rgba(0,0,0,0)") { ctx.fillStyle = fill; ctx.fill(); }
    ctx.shadowBlur = 0;
    if (stroke) { ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.stroke(); }
    ctx.restore();
  }

  /* ---- Note-hit burst effects ---- */
  function spawnHitEffect(lane, rating) {
    B.effects.push({
      x: CONFIG.laneCenterX(lane), y: CONFIG.HIT_LINE_Y,
      t: 0, maxT: 22, color: rating === "perfect" ? "#ffd24a" : "#41e08a",
      rating: rating,
      sparks: makeSparks(rating === "perfect" ? 8 : 5)
    });
  }
  function makeSparks(n) {
    var arr = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random();
      arr.push({ a: a, sp: 2.5 + Math.random() * 2.5 });
    }
    return arr;
  }
  function updateEffects() {
    for (var i = B.effects.length - 1; i >= 0; i--) {
      B.effects[i].t++;
      if (B.effects[i].t > B.effects[i].maxT) B.effects.splice(i, 1);
    }
  }
  function drawEffects() {
    for (var i = 0; i < B.effects.length; i++) {
      var e = B.effects[i];
      var p = e.t / e.maxT;          // 0..1 progress
      var r = 12 + p * 46;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 4 * (1 - p) + 1;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
      // sparks flying out
      ctx.fillStyle = e.color;
      for (var k = 0; k < e.sparks.length; k++) {
        var sp = e.sparks[k];
        var d = p * sp.sp * 14;
        ctx.beginPath();
        ctx.arc(e.x + Math.cos(sp.a) * d, e.y + Math.sin(sp.a) * d, 3 * (1 - p), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // Rounded-rectangle path helper (used by the drawn figures).
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* =========================================================
     10. STAGE FLOW (clear / game over / final trophy)
     ========================================================= */
  function endBattle(result) {
    if (B.over) return;
    B.over = true;
    stopAudio();
    if (result === "gameover") {
      showScreen("gameover");
    } else {
      fillClearScreen();
      showScreen("clear");
    }
  }

  function fillClearScreen() {
    var total = B.perfect + B.good + B.miss;
    var acc = total ? Math.round((B.perfect + B.good * 0.5) / total * 100) : 0;
    $("clear-boss-line").textContent = B.stage.name + " defeated!";
    $("clear-score").textContent = B.score.toString();
    $("clear-combo").textContent = B.maxCombo.toString();
    $("clear-perfect").textContent = B.perfect.toString();
    $("clear-good").textContent = B.good.toString();
    $("clear-miss").textContent = B.miss.toString();
    $("clear-accuracy").textContent = acc + "%";
    // Last stage? Then the button leads to the trophy.
    var btn = $("btn-clear-next");
    btn.textContent = (currentStageIndex >= STAGES.length - 1) ? "Claim Trophy" : "Next Stage";
  }

  function onClearContinue() {
    if (currentStageIndex >= STAGES.length - 1) {
      showScreen("win");        // beat all three phases -> trophy
    } else {
      currentStageIndex++;
      showIntro();
    }
  }

  /* ---- Optional audio (game runs fine without the mp3 files) ----
     To add music, drop files named song1.mp3 / song2.mp3 / song3.mp3 into
     assets/audio/ (paths are set per stage in STAGES above). Nothing else to
     do - they play automatically when the song starts. */
  function startAudio() {
    try {
      audioEl.src = B.stage.audio;
      audioEl.currentTime = 0;
      audioEl.volume = 0.85;                 // comfortable default volume
      var p = audioEl.play();
      if (p && p.catch) p.catch(function () { /* missing/blocked: ignore */ });
    } catch (e) { /* ignore */ }
  }
  function stopAudio() {
    try { audioEl.pause(); audioEl.removeAttribute("src"); audioEl.load(); } catch (e) { }
  }

  /* =========================================================
     INIT
     ========================================================= */
  function init() {
    canvas = $("battle-canvas");
    ctx = canvas.getContext("2d");
    audioEl = $("audio-song");

    createSnow($("snow-layer"), 70);
    createSnow($("win-snow"), 50);

    wireMenus();
    runLoadingSequence();

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
