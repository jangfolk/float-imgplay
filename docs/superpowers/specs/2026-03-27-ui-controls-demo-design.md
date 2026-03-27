# UI Controls Extension & Demo Page Renewal

**Date:** 2026-03-27
**Status:** Approved

## Summary

Extend FloatImgPlay with new UI overlay controls (speed slider, settings popup), redesign volume control to vertical orientation, add per-element UI toggle options, and rebuild the demo page with 8 diverse images showcasing all UI combinations. Add `playAll()`/`stopAll()` API methods for simultaneous multi-image playback.

## 1. New Options (Core Library)

### New constructor options

```js
{
  // Existing (unchanged)
  showPlayOverlay: true,
  showVolumeControl: true,

  // New
  showSpeedControl: false,     // Tempo slider at bottom-left
  showSettingsButton: false,   // Gear icon at top-right
  clickToPlay: true,           // false = clicking image does NOT trigger play
}
```

All options work with per-element overrides via `player.register(el, { showSpeedControl: true })`.

## 2. UI Layout on Image

```
+-------------------------------+
|                           [G] |   <- Settings gear (top-right)
|                            |  |
|                            #  |   <- Volume vertical slider (right edge)
|           [ > ]            #  |   <- Play button (center)
|                            |  |
|  [slow===o===fast]            |   <- Speed slider (bottom-left)
+-------------------------------+
```

### Play Button (existing, unchanged position)
- Center of image
- Toggle play/pause on click

### Volume Control (redesigned)
- **Position:** Right edge, vertically oriented
- **Style:** Dark blur container, vertical range input
- **Speaker icon** at bottom of slider
- **Range:** 0 to 1, step 0.01
- Height: ~70% of image height, centered vertically

### Speed Control (new)
- **Position:** Bottom-left corner
- **Style:** Dark blur container (matching volume style)
- **Range:** 40 to 240 BPM, step 1
- **Display:** Current BPM value shown
- **Behavior:** Changing tempo reinitializes playback if currently playing

### Settings Button (new)
- **Position:** Top-right corner
- **Style:** Gear icon, dark blur circle button
- **Behavior:** Click opens settings popup overlay on the image

## 3. Settings Popup

Opens as an overlay on top of the image when gear icon is clicked.

### Structure

```
+-- Settings -------------[X]-+
|                              |
| Instruments                  |
| [Piano] [Bass] [Strings]... |
| (scrollable grid, compact)   |
|                              |
| Ensembles                    |
| [Orchestra] [Rock] [Jazz]...|
|                              |
| > Advanced                   |
| +---------------------------+|
| | Waveform: [triangle v]   ||
| | Tempo:    ===o===  100    ||
| | Scale:    [auto v]        ||
| | Root:     [filename v]    ||
| | Filter:   [lowpass v]     ||
| | FilterHz: ===o===  900    ||
| | Attack:   ==o===   0.02   ||
| | Release:  ==o===   0.03   ||
| | Columns:  ===o===  24     ||
| | RestThrs: ===o===  28     ||
| | Pitch:    ===o===  0      ||
| | Duration: ===o===  0.5    ||
| | BrightDur:===o===  0.26   ||
| | BlueDur:  ===o===  0.46   ||
| | NeutDur:  ===o===  0.34   ||
| +---------------------------+|
|       [Apply] [Reset]        |
+------------------------------+
```

### Behavior
- **Default view:** Instrument grid + Ensemble grid (compact pill-style buttons)
- **"Advanced" toggle:** Expands to show all audio options (sliders, selects)
- **Apply:** Reinitializes only this image with new settings
- **Reset:** Reverts to global defaults
- **Close:** Click X or click outside popup
- **Scrollable:** If content exceeds image height, popup scrolls internally
- Popup has `pointerEvents: auto` and `z-index` above other controls

### Instrument/Ensemble Selection
- Clicking an instrument highlights it and deselects ensemble (and vice versa)
- Clicking "Default" (no instrument) clears selection
- Selection is per-element, independent of other images

## 4. New API Methods

```js
player.playAll();    // Play all registered instances simultaneously
player.stopAll();    // Stop all registered instances
```

### Implementation
- `playAll()` iterates `this.instances` and calls `this.play(inst.el)` for each
- `stopAll()` iterates `this.instances` and calls `this.stop(inst.el)` for each
- Both methods return `this` for chaining

## 5. clickToPlay Option

When `clickToPlay: false`:
- Image element click handler does NOT trigger play/stop
- Play overlay button (if shown) still works
- Volume and speed controls still work
- Only the direct element click is disabled
- Use case: display-only images, or images controlled only via API

## 6. Demo Page (docs/index.html)

### Image Grid
- **8 images** at **160x160** (half of current 320x320)
- Grid: `repeat(auto-fill, minmax(160px, 1fr))`
- Diverse subjects via picsum.photos:

| # | Seed | Subject | UI Combo |
|---|------|---------|----------|
| 1 | clouds | Clouds/Sky | All controls (play + speed + volume + settings) |
| 2 | volcano | Volcano/Fire | No controls + `clickToPlay: false` |
| 3 | landscape | Landscape | Play button only |
| 4 | portrait | Person | Volume only |
| 5 | city | City/Urban | Speed only |
| 6 | galaxy | Space/Galaxy | Play + Volume |
| 7 | food | Food | Play + Speed |
| 8 | abstract | Abstract Art | Speed + Volume |

Each image has a label below showing its UI configuration.

### Play All Section
- Above the demo grid: **"Play All"** and **"Stop All"** buttons
- Uses `player.playAll()` and `player.stopAll()` API

### Per-Element Registration
Demo images are registered individually with per-element options:

```js
// Example: Image 1 - all controls
player.register(document.getElementById('demo-1'), {
  showPlayOverlay: true,
  showVolumeControl: true,
  showSpeedControl: true,
  showSettingsButton: true
});

// Example: Image 2 - no controls, disabled
player.register(document.getElementById('demo-2'), {
  showPlayOverlay: false,
  showVolumeControl: false,
  showSpeedControl: false,
  showSettingsButton: false,
  clickToPlay: false
});
```

Global player is initialized with all controls OFF by default, then each image overrides individually.

## 7. Files Changed

### Core Library
- `src/float-imgplay.js` — New options in `_defaults()`, `_buildUI()` updated for speed/settings/vertical volume, `playAll()`/`stopAll()` methods, `clickToPlay` logic
- `src/float-imgplay.css` — New classes for speed control, settings popup, vertical volume

### Demo
- `docs/index.html` — 8 images, per-element registration, Play All buttons, updated layout

### Build
- `docs/float-imgplay.iife.js` — Rebuilt
- `examples/basic.html` — Synced

## 8. Out of Scope

- Preset sharing platform (separate project on float.do)
- Mobile-specific gestures
- Keyboard accessibility for new controls (future enhancement)
