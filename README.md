# Float:ImgPlay

Image-to-sound engine. Converts images into playable audio using Web Audio API.

> "Images are not just seen — they are played."

## Features

- **Image Analysis Engine** — Pixel scanning generates rule-based music from any image
- **MIDI Engine** — Parse and play Standard MIDI Files embedded in image metadata
- **Audio Engine** — Stream mp3/wav audio referenced in image metadata
- **Meta Parser** — Extract metadata from PNG tEXt, EXIF UserComment, or sidecar JSON
- **MIDI Export** — Export generated scores as Standard MIDI Files (.mid)
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

## Options

```js
const player = new FloatImgPlay({
  selector: '.float-imgplay',
  autoplay: false,
  autoplayWhenVisibleOnly: true,
  stopWhenHidden: true,
  showPlayOverlay: true,
  showVolumeControl: true,

  audio: {
    masterVolume: 0.25,
    pitchShiftSemitones: 0,
    waveform: 'triangle',       // sine | square | sawtooth | triangle
    tempo: 100,
    noteDurationBeats: 0.5,
    restThreshold: 28,
    sampleColumns: 24,
    sampleRows: [0.25, 0.5, 0.75],
    filterType: 'lowpass',
    filterBaseHz: 900,
    filterVelocityAmount: 3000,
    attack: 0.02,
    release: 0.03,
    scaleMode: 'auto',          // auto | major | minor | pentatonic
    rootMode: 'filename-first-char', // filename-first-char | fixed
    fixedRootMidi: 60,
    octaveContrastThreshold: 100,
    octaveShiftSemitones: 12
  },

  security: {
    allowedDomains: [],          // empty = allow all
    maxFileSize: 10485760,       // 10MB
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  }
});
```

| Option | Default | Description |
|---|---|---|
| `selector` | `'.float-imgplay'` | CSS selector for target elements |
| `autoplay` | `false` | Auto-play on init |
| `autoplayWhenVisibleOnly` | `true` | Only autoplay when visible |
| `stopWhenHidden` | `true` | Stop when scrolled away / tab hidden / occluded |
| `showPlayOverlay` | `true` | Show centered play button |
| `showVolumeControl` | `true` | Show volume slider |
| `audio.masterVolume` | `0.25` | Master volume (0-1) |
| `audio.waveform` | `'triangle'` | Oscillator type |
| `audio.tempo` | `100` | BPM |
| `audio.scaleMode` | `'auto'` | Scale selection mode |
| `audio.filterType` | `'lowpass'` | BiquadFilter type |
| `security.allowedDomains` | `[]` | Allowed hostnames (empty = all) |
| `security.maxFileSize` | `10485760` | Max file size in bytes |

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
| `refresh()` | Re-analyze all images (e.g., after src change) |

### Exported modules

```js
import {
  FloatImgPlay,   // Core player
  ImageEngine,    // Pixel analysis engine
  MidiEngine,     // MIDI parser + playback
  AudioEngine,    // Audio streaming engine
  MetaParser,     // Metadata extraction
  MidiExport      // Score to MIDI file
} from 'float-imgplay';
```

## How it works

1. **Pixel scanning** — Downscales image to 64px, samples pixel rows at configurable positions
2. **Pitch mapping** — Brightness maps to scale degree, red/blue contrast triggers octave shifts
3. **Duration** — Blue-dominant pixels get longer notes, red-dominant get shorter
4. **Velocity** — Color saturation maps to note velocity
5. **Synthesis** — Web Audio API oscillator/filter/gain node chain produces sound
6. **Visibility** — IntersectionObserver + visibilitychange + elementFromPoint() occlusion detection

## Architecture

```
[Image] → [Meta Parser] → [Mode Router] → [Engine] → [Web Audio Output]
                                              ↓
                                    ┌─────────┼─────────┐
                                    │         │         │
                              ImageEngine  MidiEngine  AudioEngine
```

## Contact

- Website: [float.do](https://float.do)
- Email: contact@float.do

## License

MIT - see [LICENSE](LICENSE) for details.
