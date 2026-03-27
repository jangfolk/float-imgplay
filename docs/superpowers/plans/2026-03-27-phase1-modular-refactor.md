# Phase 1: Modular Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** Split monolithic `src/float-imgplay.js` (800 lines) into modular architecture with Engine interface, Mode Router, and stub engines for future phases.

**Architecture:** Core class delegates analysis/playback to Engine modules via Mode Router. Helpers extracted to utils.

**Constraint:** Zero behavioral change — demo page must work identically before and after.

---

### Task 1: Extract helpers to utils/helpers.js

**Files:** Create `src/utils/helpers.js`

- [ ] Extract: `_mergeDeep`, `_clone`, `_throttle`, `_clamp`, `_beatsToSeconds`, `_midiToFreq`, `_charToKey`, `_averageRGB`, `_getScale`, `_fileNameFromUrl`, `_extractCssUrl`
- [ ] Export all as named exports
- [ ] Verify: file exports all functions

---

### Task 2: Define Engine interface and create ImageEngine

**Files:** Create `src/engines/image-engine.js`

- [ ] Extract from FloatImgPlay: `_loadImage`, `_analyzeImage`, `_analyzeSource`, `_prepareAnalysis`, `_playInstance` (audio scheduling logic), `_stopInstance` (audio node cleanup)
- [ ] Import helpers from `../utils/helpers.js`
- [ ] Class `ImageEngine` with methods:
  - `canHandle(source, meta)` → always true (fallback)
  - `async analyze(source, audioOpts)` → returns `{ score, meta }`
  - `play(score, audioCtx, audioOpts)` → returns `{ nodes, timers }`
  - `stop(handle)` → cleanup nodes/timers
- [ ] Export class

---

### Task 3: Create stub engines

**Files:** Create `src/engines/midi-engine.js`, `src/engines/audio-engine.js`

- [ ] MidiEngine: canHandle returns false, analyze/play/stop throw "Not implemented"
- [ ] AudioEngine: canHandle returns false, analyze/play/stop throw "Not implemented"
- [ ] Both follow Engine interface

---

### Task 4: Create MetaParser stub

**Files:** Create `src/parsers/meta-parser.js`

- [ ] `MetaParser.parse(source)` → returns `{ midi: null, audio: null, engine: null }`
- [ ] Always returns empty meta (Phase 2 fills this in)

---

### Task 5: Create MIDI Export stub

**Files:** Create `src/export/midi-export.js`

- [ ] `MidiExport.export(score, opts)` → throws "Not implemented"
- [ ] Placeholder for Phase 5

---

### Task 6: Rewrite Core (float-imgplay.js)

**Files:** Rewrite `src/float-imgplay.js`

- [ ] Import: ImageEngine, MidiEngine, AudioEngine, MetaParser, helpers
- [ ] Add Mode Router: `_resolveEngine(source, meta)` → returns appropriate engine
- [ ] Constructor: create engine instances
- [ ] `register()`: call MetaParser → Mode Router → engine.analyze()
- [ ] `_playInstance()`: delegate to engine.play()
- [ ] `_stopInstance()`: delegate to engine.stop()
- [ ] Keep: UI building, visibility, event binding, DOM logic (these stay in Core)
- [ ] Remove: all extracted helper/analysis/synthesis methods
- [ ] Export `FloatImgPlay` class and default export

---

### Task 7: Build and verify

- [ ] `npm run build` — must succeed with no errors
- [ ] Verify dist files exist (ESM/UMD/IIFE/min + CSS)
- [ ] Verify IIFE build exposes `FloatImgPlay.FloatImgPlay`
- [ ] Open demo page — play/stop must work identically

---

### Task 8: Commit and finalize

- [ ] Commit all changes
- [ ] Verify git log is clean
