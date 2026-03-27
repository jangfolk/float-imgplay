# Float:ImgPlay

Image-to-sound engine. Converts images into playable audio using Web Audio API.

> "Images are not just seen — they are played."

**[Live Demo](https://float1122.github.io/float-imgplay/)**

## Features

- **Image Analysis Engine** — 7 algorithms convert pixel data into rule-based music
- **MIDI Engine** — Parse and play Standard MIDI Files embedded in image metadata
- **Audio Engine** — Stream mp3/wav audio referenced in image metadata
- **Meta Parser** — Extract metadata from PNG tEXt, EXIF UserComment, or sidecar JSON
- **Meta Embed** — Embed MIDI/audio data directly into PNG files
- **MIDI Export** — Export generated scores as Standard MIDI Files (.mid)
- **20 Instrument Presets** — Piano, Synth, Bass, Strings, Brass, and more
- **10 Ensemble Presets** — Orchestra, Rock Band, Electronic, Jazz Trio, and more
- **Multi-Layer Playback** — Multiple instruments playing simultaneously on one image
- **Custom Algorithms** — Register your own pixel-to-sound algorithms
- **Per-Element UI** — Play button, volume, speed, settings popup per image
- **Preset Export/Import** — Save and load configurations as JSON
- **Security** — Domain whitelist, file size limits, MIME type validation
- **Visibility System** — IntersectionObserver + occlusion detection for smart autoplay
- **Zero dependencies** — Pure browser APIs, no runtime dependencies

## Install

```bash
npm install float-imgplay
```

### CDN

```html
<!-- unpkg -->
<link rel="stylesheet" href="https://unpkg.com/float-imgplay/dist/float-imgplay.css">
<script src="https://unpkg.com/float-imgplay"></script>

<!-- jsdelivr -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/float-imgplay/dist/float-imgplay.css">
<script src="https://cdn.jsdelivr.net/npm/float-imgplay"></script>
```

## Quick Start

### Script tag

```html
<div class="float-imgplay">
  <img src="/images/photo.jpg" alt="" width="320" height="320">
</div>

<script src="https://unpkg.com/float-imgplay"></script>
<script>
  new FloatImgPlay({ selector: '.float-imgplay' }).init();
</script>
```

### ESM

```js
import { FloatImgPlay } from 'float-imgplay';

const player = new FloatImgPlay({ selector: '.float-imgplay' });
player.init();
```

### CommonJS

```js
const { FloatImgPlay } = require('float-imgplay');
```

### Background image

```html
<div class="float-imgplay"
     style="background-image:url('/images/sky.jpg'); width:320px; height:320px;">
</div>
```

## Sound Algorithms

7 built-in algorithms for converting pixel data into music. Set with `audio.algorithm`.

| Algorithm | Key | Description |
|---|---|---|
| **RGBA Digit** | `rgba-digit` | RGB channel digits → pitch, rhythm, chords (default) |
| **Brightness Linear** | `brightness-linear` | Brightness → pitch, color dominance → duration |
| **Color Harmony** | `color-harmony` | HSL hue → scale degree, saturation → velocity |
| **Spectral** | `spectral` | RGB as frequency bands (Y-axis spectrum) |
| **Contour** | `contour` | Follows brightness gradients for melody contour |
| **Harmonic Drift** | `harmonic-drift` | Digit-based note hold/change with diatonic chord tones |
| **Color Pitch** | `color-pitch` | Color → pitch, brightness → duration (staccato ~ sustain) |

### Custom algorithms

```js
import { registerAlgorithm } from 'float-imgplay';

registerAlgorithm('my-algo', (columns, audioOpts, meta) => {
  // columns: [{ r, g, b, a }, ...]
  // meta: { scale, rootMidi }
  // Return: [{ midi, freq, durationSeconds, velocity, isRest }, ...]
  return columns.map(c => ({
    midi: 60 + Math.round((c.r / 255) * 24),
    freq: 440 * Math.pow(2, (60 + Math.round((c.r / 255) * 24) - 69) / 12),
    durationSeconds: 0.2 + (c.g / 255) * 0.8,
    velocity: 0.1 + (c.b / 255) * 0.2,
    isRest: (c.r + c.g + c.b) / 3 < 28
  }));
}, 'My Algorithm', 'Custom pixel-to-sound mapping');
```

## Instrument Presets

### Instruments (20)

Set with `instruments: [{ preset: 'piano' }]`.

| Preset | Waveform | Character |
|---|---|---|
| `piano` | triangle | Warm, natural tone |
| `epiano` | sine | Electric piano, fast attack |
| `organ` | square | Thin, sustained |
| `synthLead` | sawtooth | Aggressive, bright |
| `synthPad` | sine | Slow attack, thick pad |
| `bass` | square | -1 octave, deep |
| `subBass` | sine | -2 octaves, sub-frequency |
| `pluck` | triangle | Quick attack/release |
| `strings` | sawtooth | Slow attack, long release |
| `brass` | sawtooth | Mid attack, bold |
| `flute` | sine | +1 octave, airy |
| `choir` | triangle | Slow attack, ethereal |
| `bell` | sine | +1 octave, long release |
| `marimba` | triangle | Bandpass, short decay |
| `guitar` | sawtooth | Mid attack, bright |
| `acid` | sawtooth | Aggressive filter sweep |
| `chiptune` | square | 8-bit retro |
| `warmPad` | triangle | Warm, medium attack |
| `glass` | sine | +1 octave, crystalline |
| `wobble` | sawtooth | -1 octave, extreme filter |

### Ensembles (10)

Set with `ensemble: 'orchestra'`.

| Ensemble | Instruments |
|---|---|
| `orchestra` | Strings + Brass + Flute |
| `rockBand` | Guitar + Bass + Organ |
| `electronic` | Synth Lead + Sub Bass + Synth Pad |
| `jazzTrio` | E.Piano + Bass + Pluck |
| `ambient` | Warm Pad + Glass + Choir |
| `chiptuneBand` | Chiptune (2 layers) + Bell |
| `cinematic` | Strings + Choir + Sub Bass |
| `lofi` | E.Piano + Warm Pad + Pluck |
| `acidHouse` | Acid + Sub Bass + Synth Pad |
| `minimal` | Piano + Bell |

```js
// Single instrument
const player = new FloatImgPlay({
  selector: '.float-imgplay',
  instruments: [{ preset: 'piano' }]
});

// Ensemble
const player = new FloatImgPlay({
  selector: '.float-imgplay',
  ensemble: 'orchestra'
});

// Multi-instrument with custom settings
const player = new FloatImgPlay({
  selector: '.float-imgplay',
  instruments: [
    { preset: 'piano', volume: 0.3 },
    { preset: 'bass', octaveShift: -1, volume: 0.2 },
    { preset: 'strings', volume: 0.15 }
  ]
});
```

## Options

```js
const player = new FloatImgPlay({
  selector: '.float-imgplay',
  autoplay: false,
  autoplayWhenVisibleOnly: true,
  stopWhenHidden: true,
  showPlayOverlay: true,
  showVolumeControl: true,
  showSpeedControl: false,
  showSettingsButton: false,

  audio: {
    algorithm: 'rgba-digit',         // rgba-digit | brightness-linear | color-harmony | spectral | contour | harmonic-drift | color-pitch
    masterVolume: 0.25,
    pitchShiftSemitones: 0,
    waveform: 'triangle',            // sine | square | sawtooth | triangle
    tempo: 100,
    noteDurationBeats: 0.5,
    restThreshold: 28,
    sampleColumns: 0,                // 0 = auto (scales with image width)
    sampleRows: [0.25, 0.5, 0.75],
    filterType: 'lowpass',           // lowpass | highpass | bandpass | notch
    filterBaseHz: 900,
    filterVelocityAmount: 3000,
    attack: 0.02,
    release: 0.03,
    scaleMode: 'auto',               // auto | major | minor | pentatonic | blues | chromatic | dorian | mixolydian
    rootMode: 'filename-first-char',  // filename-first-char | fixed
    fixedRootMidi: 60,
    octaveContrastThreshold: 100,
    octaveShiftSemitones: 12
  },

  security: {
    allowedDomains: [],               // empty = allow all
    maxFileSize: 10485760,            // 10MB
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  }
});
```

### General Options

| Option | Default | Description |
|---|---|---|
| `selector` | `'.float-imgplay'` | CSS selector for target elements |
| `autoplay` | `false` | Auto-play on init |
| `autoplayWhenVisibleOnly` | `true` | Only autoplay when visible |
| `stopWhenHidden` | `true` | Stop when scrolled away / tab hidden / occluded |
| `showPlayOverlay` | `true` | Show centered play button |
| `showVolumeControl` | `true` | Show volume slider (vertical, right side) |
| `showSpeedControl` | `false` | Show speed/BPM slider (bottom left) |
| `showSettingsButton` | `false` | Show gear icon for per-element settings popup |

### Audio Options

| Option | Default | Description |
|---|---|---|
| `audio.algorithm` | `'rgba-digit'` | Sound algorithm |
| `audio.masterVolume` | `0.25` | Master volume (0-1) |
| `audio.waveform` | `'triangle'` | Oscillator type |
| `audio.tempo` | `100` | BPM (40-240) |
| `audio.noteDurationBeats` | `0.5` | Note duration in beats |
| `audio.sampleColumns` | `0` | Number of columns to sample (0 = auto, scales with image width) |
| `audio.sampleRows` | `[0.25, 0.5, 0.75]` | Vertical positions to sample (0-1) |
| `audio.scaleMode` | `'auto'` | Scale selection mode |
| `audio.rootMode` | `'filename-first-char'` | Root note detection mode |
| `audio.filterType` | `'lowpass'` | BiquadFilter type |
| `audio.filterBaseHz` | `900` | Filter base frequency |
| `audio.filterVelocityAmount` | `3000` | Filter velocity modulation |
| `audio.attack` | `0.02` | Attack time (seconds) |
| `audio.release` | `0.03` | Release time (seconds) |
| `audio.pitchShiftSemitones` | `0` | Global pitch shift (-24 to +24) |
| `audio.restThreshold` | `28` | Brightness below this = rest |

### Per-Element Overrides

```js
player.register(element, {
  showPlayOverlay: true,
  showVolumeControl: false,
  showSpeedControl: true,
  showSettingsButton: true
});
```

## Mode Router

Float:ImgPlay automatically selects the right engine based on image metadata:

```
Image with meta.midi  → MIDI Engine (parse & play MIDI)
Image with meta.audio → Audio Engine (stream mp3/wav)
Image without meta    → Image Engine (pixel analysis)
```

### Embedding metadata

**Sidecar JSON** — Place `image.jpg.imgplay.json` next to your image:

```json
{
  "imgplay": {
    "midi": { "url": "/songs/track.mid" }
  }
}
```

**PNG tEXt** — Embed in PNG chunk with key `imgplay`

**EXIF UserComment** — Embed in JPEG EXIF data

### Embed MIDI into PNG

```js
import { MetaEmbed } from 'float-imgplay';

// Embed MIDI file data into a PNG image
const pngFile = /* File object */;
const midiFile = /* File object */;

const result = await MetaEmbed.embedMidi(pngFile, midiFile);
MetaEmbed.download(result, 'image-with-midi.png');
```

## MIDI Export

```js
import { FloatImgPlay, MidiExport } from 'float-imgplay';

const player = new FloatImgPlay({ selector: '.float-imgplay' });
player.init();

// Export a score as MIDI file
const inst = player.instances.get(someElement);
if (inst && inst.currentScore) {
  MidiExport.exportAndDownload(inst.currentScore, { bpm: 120 }, 'my-image.mid');
}
```

## Preset Export / Import

```js
// Export current configuration as JSON
const config = player.exportConfig();
console.log(JSON.stringify(config, null, 2));

// Import configuration
player.importConfig({
  audio: { algorithm: 'color-pitch', tempo: 140, waveform: 'sawtooth' },
  instruments: [{ preset: 'synthLead' }]
});
```

## API

| Method | Description |
|---|---|
| `init()` | Initialize and register all matching elements |
| `destroy()` | Remove all instances and event listeners |
| `register(el, options?)` | Register a single element with optional overrides |
| `unregister(el)` | Remove a single element |
| `play(el)` | Play audio for an element |
| `stop(el)` | Stop audio for an element |
| `pause(el)` | Alias for `stop()` |
| `playAll()` | Play all registered instances |
| `stopAll()` | Stop all registered instances |
| `refresh()` | Re-analyze all images (e.g., after src change) |
| `exportConfig()` | Export current settings as JSON |
| `importConfig(config)` | Import settings from JSON |

### Exported modules

```js
import {
  FloatImgPlay,          // Core player
  ImageEngine,           // Pixel analysis engine
  MidiEngine,            // MIDI parser + playback
  AudioEngine,           // Audio streaming engine
  MetaParser,            // Metadata extraction
  MetaEmbed,             // Embed metadata into PNG
  MidiExport,            // Score to MIDI file
  INSTRUMENT_PRESETS,    // Instrument preset definitions
  ENSEMBLE_PRESETS,      // Ensemble preset definitions
  resolveInstrument,     // Resolve instrument by preset name
  resolveEnsemble,       // Resolve ensemble by name
  ALGORITHMS,            // Algorithm registry
  getAlgorithm,          // Get algorithm by name
  registerAlgorithm      // Register custom algorithm
} from 'float-imgplay';
```

## How it works

1. **Pixel scanning** — Downscales image dynamically (64-512px based on original size), samples pixel rows at configurable positions
2. **Algorithm** — Selected algorithm maps pixel data (color, brightness, saturation) to musical parameters (pitch, duration, velocity)
3. **Scale quantization** — Notes are snapped to the detected or configured scale (major, minor, pentatonic, etc.)
4. **Multi-layer synthesis** — Instruments are resolved and each layer generates its own audio nodes
5. **Web Audio chain** — Oscillator → BiquadFilter → GainNode → Destination per note
6. **Visibility** — IntersectionObserver + visibilitychange + elementFromPoint() occlusion detection

## Architecture

```
[Image] → [Meta Parser] → [Mode Router] → [Engine] → [Web Audio Output]
                                              ↓
                                    ┌─────────┼─────────┐
                                    │         │         │
                              ImageEngine  MidiEngine  AudioEngine
                                    │
                              [Algorithm]
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              RGBA Digit    Color Pitch    Spectral  ...
                    │
              [Instrument Presets / Ensembles]
                    │
              [Multi-Layer Playback]
```

## Contact

- Website: [float.do](https://float.do)
- Email: contact@float.do

## License

MIT - see [LICENSE](LICENSE) for details.
