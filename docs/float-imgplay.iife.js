var FloatImgPlay = (function (exports) {
  'use strict';

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function mergeDeep(target, source) {
    const out = Array.isArray(target) ? [...target] : { ...target };
    if (!source || typeof source !== "object") return out;

    Object.keys(source).forEach((key) => {
      const sv = source[key];
      const tv = out[key];
      if (Array.isArray(sv)) {
        out[key] = [...sv];
      } else if (sv && typeof sv === "object") {
        out[key] = mergeDeep(tv && typeof tv === "object" ? tv : {}, sv);
      } else {
        out[key] = sv;
      }
    });
    return out;
  }

  function throttle(fn, wait) {
    let last = 0;
    let timeout = null;
    let lastArgs = null;

    return (...args) => {
      const now = Date.now();
      lastArgs = args;

      const invoke = () => {
        last = now;
        timeout = null;
        fn(...lastArgs);
      };

      if (now - last >= wait) {
        invoke();
      } else if (!timeout) {
        timeout = setTimeout(invoke, wait - (now - last));
      }
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function beatsToSeconds(beats, tempo) {
    return (60 / tempo) * beats;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function charToKey(letter) {
    const map = {
      a: 60, b: 62, c: 64, d: 65, e: 67, f: 69, g: 71,
      h: 60, i: 62, j: 64, k: 65, l: 67, m: 69, n: 71,
      o: 60, p: 62, q: 63, r: 65, s: 67, t: 68, u: 70,
      v: 72, w: 61, x: 63, y: 66, z: 68
    };
    return map[letter] ?? 60;
  }

  function averageRGB(data) {
    let r = 0, g = 0, b = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return { r: r / total, g: g / total, b: b / total };
  }

  function getScale(mode, avg) {
    if (mode === "major") return [0, 2, 4, 5, 7, 9, 11, 12];
    if (mode === "minor") return [0, 2, 3, 5, 7, 8, 10, 12];
    if (mode === "pentatonic") return [0, 3, 5, 7, 10, 12];

    if (avg.r > avg.b + 20) return [0, 2, 4, 5, 7, 9, 11, 12];
    if (avg.b > avg.r + 20) return [0, 2, 3, 5, 7, 8, 10, 12];
    return [0, 3, 5, 7, 10, 12];
  }

  function fileNameFromUrl(url) {
    try {
      const clean = url.split("?")[0].split("#")[0];
      return clean.substring(clean.lastIndexOf("/") + 1) || "image";
    } catch {
      return "image";
    }
  }

  function extractCssUrl(bgValue) {
    if (!bgValue || bgValue === "none") return null;
    const m = bgValue.match(/url\((['"]?)(.*?)\1\)/i);
    return m ? m[2] : null;
  }

  function rgbaDigit(columns, audioOpts, meta) {
    const { scale, rootMidi } = meta;

    // --- Digit extraction helper ---
    // value 0-255 → hundreds (0-2), tens (0-25→0-9 scaled), ones (0-9)
    const digit = (val, place) => {
      if (place === 100) return Math.floor(val / 100);          // 0, 1, or 2
      if (place === 10) return Math.floor((val % 100) / 10);    // 0-9 (actually 0-25 but capped)
      return val % 10;                                           // 0-9
    };

    // --- Rhythm pattern table (G hundreds) ---
    const RHYTHM_MULTIPLIERS = [1.5, 1.0, 0.5];

    // --- Chord intervals within key (B hundreds) ---
    // 0 = single note, 1 = add 3rd, 2 = add 3rd+5th
    const CHORD_TYPES = [
      [],                              // 0: single note
      [2],                             // 1: add a 3rd (2 scale steps up)
      [2, 4]                           // 2: add 3rd + 5th (triad)
    ];

    // --- Articulation table (R ones) ---
    // 0-3: staccato (short), 4-6: normal, 7-9: legato (long)
    const articulationMul = (d) => {
      if (d <= 3) return 0.5;
      if (d <= 6) return 1.0;
      return 1.4;
    };

    const notes = [];
    let prevMidi = -1;

    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const brightness = (c.r + c.g + c.b) / 3;
      const saturation = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      const isRest = brightness < audioOpts.restThreshold;

      if (isRest) {
        // Dark pixels: ghost note (very quiet, short) instead of silence for variety
        const ghostMidi = rootMidi + scale[0] + audioOpts.pitchShiftSemitones;
        notes.push({
          midi: ghostMidi,
          freq: midiToFreq(ghostMidi),
          durationSeconds: beatsToSeconds(0.15, audioOpts.tempo),
          velocity: 0.04,
          isRest: true
        });
        continue;
      }

      // === R channel: pitch + articulation ===
      const rHundreds = digit(c.r, 100);   // octave: 0=low(-12), 1=mid(0), 2=high(+12)
      const rTens = digit(c.r, 10);        // scale degree selector (0-9 → wraps through scale)
      const rOnes = digit(c.r, 1);         // articulation (staccato/normal/legato)

      // === G channel: rhythm + velocity ===
      const gHundreds = digit(c.g, 100);   // rhythm pattern (whole/half/quarter)
      const gTens = digit(c.g, 10);        // velocity level (0-9 → pp to ff)
      digit(c.g, 1);         // filter cutoff variation

      // === B channel: harmony + interval ===
      const bHundreds = digit(c.b, 100);   // chord type (single/3rd/triad)
      const bTens = digit(c.b, 10);        // melodic interval jump size
      digit(c.b, 1);         // timing micro-offset (swing feel)

      // === A channel: dynamics ===
      const aTens = digit(c.a, 10);        // crescendo/decrescendo tendency

      // --- Primary note pitch ---
      const scaleIdx = rTens % scale.length;
      const octaveOffset = (rHundreds - 1) * 12;  // -12, 0, or +12

      // Melodic interval: if bTens is high, allow bigger jumps between notes
      let intervalBoost = 0;
      if (prevMidi >= 0 && bTens > 5) {
        // Jump up or down by extra scale steps based on color difference from previous
        const prevCol = columns[i - 1] || c;
        const colorDiff = Math.abs(c.r - prevCol.r) + Math.abs(c.g - prevCol.g) + Math.abs(c.b - prevCol.b);
        if (colorDiff > 100) {
          intervalBoost = (bTens > 7) ? 2 : 1;
          if (c.b > prevCol.b) intervalBoost = -intervalBoost; // direction from blue tendency
        }
      }

      const finalScaleIdx = clamp(scaleIdx + intervalBoost, 0, scale.length - 1);
      const midi = rootMidi + scale[finalScaleIdx] + octaveOffset + audioOpts.pitchShiftSemitones;
      prevMidi = midi;

      // --- Duration ---
      const rhythmMul = RHYTHM_MULTIPLIERS[clamp(gHundreds, 0, 2)];
      const articMul = articulationMul(rOnes);
      let baseDuration = audioOpts.neutralDuration;
      if (c.b > c.r && c.b > c.g) baseDuration = audioOpts.blueDuration;
      else if (c.r > c.b && c.r > c.g) baseDuration = audioOpts.brightDuration;

      const durationSeconds = beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo)
        * (baseDuration / audioOpts.neutralDuration)
        * rhythmMul
        * articMul;

      // --- Velocity (richer range using G tens + saturation + A channel) ---
      const baseVel = 0.06 + (gTens / 9) * 0.18;
      const satBoost = (saturation / 255) * 0.1;
      const dynamicBoost = (aTens > 5) ? 0.04 : 0;
      const velocity = clamp(baseVel + satBoost + dynamicBoost, 0.06, 0.36);

      // --- Push primary note ---
      notes.push({
        midi: clamp(midi, 24, 108),
        freq: midiToFreq(clamp(midi, 24, 108)),
        durationSeconds: Math.max(0.05, durationSeconds),
        velocity,
        isRest: false
      });

      // --- Chord notes (B hundreds) ---
      const chordIntervals = CHORD_TYPES[clamp(bHundreds, 0, 2)];
      for (const interval of chordIntervals) {
        const chordScaleIdx = clamp(finalScaleIdx + interval, 0, scale.length - 1);
        const chordMidi = rootMidi + scale[chordScaleIdx] + octaveOffset + audioOpts.pitchShiftSemitones;
        const clampedChordMidi = clamp(chordMidi, 24, 108);

        // Chord notes slightly quieter than root
        notes.push({
          midi: clampedChordMidi,
          freq: midiToFreq(clampedChordMidi),
          durationSeconds: Math.max(0.05, durationSeconds * 0.85),
          velocity: clamp(velocity * 0.7, 0.04, 0.3),
          isRest: false
        });
      }

      // --- Same-color repetition pattern ---
      // If current pixel is very similar to next, add a rhythmic echo
      if (i + 1 < columns.length) {
        const next = columns[i + 1];
        const diff = Math.abs(c.r - next.r) + Math.abs(c.g - next.g) + Math.abs(c.b - next.b);
        if (diff < 30) {
          // Similar colors: add a quiet echo note (rhythmic motif)
          notes.push({
            midi: clamp(midi, 24, 108),
            freq: midiToFreq(clamp(midi, 24, 108)),
            durationSeconds: Math.max(0.05, durationSeconds * 0.4),
            velocity: clamp(velocity * 0.35, 0.03, 0.15),
            isRest: false
          });
        }
      }
    }

    return notes;
  }

  function brightnessLinear(columns, audioOpts, meta) {
    const { scale, rootMidi } = meta;
    const notes = [];

    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const brightness = (c.r + c.g + c.b) / 3;

      if (brightness < audioOpts.restThreshold) {
        notes.push({ midi: 60, freq: 261.63, durationSeconds: beatsToSeconds(0.15, audioOpts.tempo), velocity: 0.04, isRest: true });
        continue;
      }

      // Brightness maps linearly to scale position
      const scaleIdx = Math.floor((brightness / 255) * (scale.length - 1));
      const midi = clamp(rootMidi + scale[scaleIdx] + audioOpts.pitchShiftSemitones, 24, 108);

      // Color dominance determines duration
      let dur = audioOpts.neutralDuration;
      if (c.r > c.g && c.r > c.b) dur = audioOpts.brightDuration;
      else if (c.b > c.r && c.b > c.g) dur = audioOpts.blueDuration;
      const durationSeconds = beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo) * (dur / audioOpts.neutralDuration);

      // Alpha channel affects velocity
      const velocity = clamp(0.08 + (brightness / 255) * 0.25, 0.06, 0.36);

      notes.push({ midi, freq: midiToFreq(midi), durationSeconds: Math.max(0.05, durationSeconds), velocity, isRest: false });
    }

    return notes;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h, s, l };
  }

  function colorHarmony(columns, audioOpts, meta) {
    const { scale, rootMidi } = meta;
    const notes = [];

    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const { h, s, l } = rgbToHsl(c.r, c.g, c.b);

      if (l < audioOpts.restThreshold / 255) {
        notes.push({ midi: 60, freq: 261.63, durationSeconds: beatsToSeconds(0.15, audioOpts.tempo), velocity: 0.04, isRest: true });
        continue;
      }

      // Hue (0-1) maps to scale degree (walking through the color wheel = walking through the scale)
      const scaleIdx = Math.floor(h * scale.length) % scale.length;
      // Lightness adds octave variation
      const octaveOffset = l < 0.33 ? -12 : l > 0.66 ? 12 : 0;
      const midi = clamp(rootMidi + scale[scaleIdx] + octaveOffset + audioOpts.pitchShiftSemitones, 24, 108);

      // Saturation drives velocity (more colorful = louder)
      const velocity = clamp(0.06 + s * 0.3, 0.06, 0.36);

      // Lightness affects duration (darker = longer, like sustained low notes)
      const durMul = 0.5 + (1 - l) * 1.0;
      const durationSeconds = beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo) * durMul;

      notes.push({ midi, freq: midiToFreq(midi), durationSeconds: Math.max(0.05, durationSeconds), velocity, isRest: false });

      // Highly saturated colors add a harmony note (a 3rd above)
      if (s > 0.6 && scale.length > 2) {
        const harmIdx = clamp(scaleIdx + 2, 0, scale.length - 1);
        const harmMidi = clamp(rootMidi + scale[harmIdx] + octaveOffset + audioOpts.pitchShiftSemitones, 24, 108);
        notes.push({ midi: harmMidi, freq: midiToFreq(harmMidi), durationSeconds: Math.max(0.05, durationSeconds * 0.7), velocity: clamp(velocity * 0.6, 0.04, 0.3), isRest: false });
      }
    }

    return notes;
  }

  function spectral(columns, audioOpts, meta) {
    // For spectral mode, we need the full column data with per-row info
    // Since columns only have averaged RGBA, we use RGB channels as 3 frequency bands
    const { scale, rootMidi } = meta;
    const notes = [];

    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const brightness = (c.r + c.g + c.b) / 3;

      if (brightness < audioOpts.restThreshold) {
        notes.push({ midi: 60, freq: 261.63, durationSeconds: beatsToSeconds(0.15, audioOpts.tempo), velocity: 0.04, isRest: true });
        continue;
      }

      // R = high frequency band, G = mid, B = low
      const bands = [
        { energy: c.r / 255, octave: 12 },   // high
        { energy: c.g / 255, octave: 0 },    // mid
        { energy: c.b / 255, octave: -12 }   // low
      ];

      const durationSeconds = beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo);

      // Emit notes for each frequency band that has enough energy
      for (const band of bands) {
        if (band.energy > 0.15) {
          const scaleIdx = Math.floor(band.energy * (scale.length - 1));
          const midi = clamp(rootMidi + scale[scaleIdx] + band.octave + audioOpts.pitchShiftSemitones, 24, 108);
          const velocity = clamp(band.energy * 0.3, 0.06, 0.36);

          notes.push({
            midi,
            freq: midiToFreq(midi),
            durationSeconds: Math.max(0.05, durationSeconds * (0.5 + band.energy * 0.8)),
            velocity,
            isRest: false
          });
        }
      }
    }

    return notes;
  }

  function contour(columns, audioOpts, meta) {
    const { scale, rootMidi } = meta;
    const notes = [];
    let currentScaleIdx = Math.floor(scale.length / 2); // start in middle

    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const brightness = (c.r + c.g + c.b) / 3;

      if (brightness < audioOpts.restThreshold) {
        notes.push({ midi: 60, freq: 261.63, durationSeconds: beatsToSeconds(0.15, audioOpts.tempo), velocity: 0.04, isRest: true });
        continue;
      }

      // Calculate gradient (change from previous pixel)
      if (i > 0) {
        const prev = columns[i - 1];
        const prevBrightness = (prev.r + prev.g + prev.b) / 3;
        const gradient = brightness - prevBrightness; // -255 to +255

        // Gradient determines melodic direction and step size
        if (Math.abs(gradient) > 10) {
          const steps = Math.round(gradient / 40); // roughly -6 to +6
          currentScaleIdx = clamp(currentScaleIdx + steps, 0, scale.length - 1);
        }
      }

      // Saturation affects octave
      const saturation = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      const octaveOffset = saturation > 170 ? 12 : saturation < 60 ? -12 : 0;

      const midi = clamp(rootMidi + scale[currentScaleIdx] + octaveOffset + audioOpts.pitchShiftSemitones, 24, 108);
      const velocity = clamp(0.08 + (brightness / 255) * 0.2 + (saturation / 255) * 0.08, 0.06, 0.36);

      // Duration varies with gradient magnitude (big changes = short notes, smooth = legato)
      const gradMag = i > 0 ? Math.abs(brightness - ((columns[i-1].r + columns[i-1].g + columns[i-1].b) / 3)) : 0;
      const durMul = gradMag > 50 ? 0.5 : gradMag > 20 ? 0.8 : 1.3;
      const durationSeconds = beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo) * durMul;

      notes.push({ midi, freq: midiToFreq(midi), durationSeconds: Math.max(0.05, durationSeconds), velocity, isRest: false });
    }

    return notes;
  }

  /**
   * Harmonic Drift Algorithm
   *
   * Core idea:
   * - Each pixel column produces a digit (0-9) from its color channels
   * - One digit controls "change probability": >= 5 means the note changes, < 5 means it holds
   * - When the note changes, it picks a chord tone from the current harmony
   * - The harmony (chord) is determined by another digit (0-9), mapped to diatonic chords
   *
   * Digit-to-chord mapping (scale degrees as chord tones):
   *   0 → I   (1, 3, 5)
   *   1 → ii  (2, 4, 6)
   *   2 → iii (3, 5, 7)
   *   3 → IV  (4, 6, 1)
   *   4 → V   (5, 7, 2)
   *   5 → vi  (6, 1, 3)
   *   6 → vii (7, 2, 4)
   *   7 → I   (1, 3, 5) octave up
   *   8 → IV  (4, 6, 1) wide voicing
   *   9 → V   (5, 7, 2) wide voicing
   */
  function harmonicDrift(columns, audioOpts, meta) {
    const { scale, rootMidi } = meta;

    // Chord tones as scale indices (0-based)
    // Each chord has 3 tones from the scale
    const CHORDS = [
      [0, 2, 4],  // 0: I
      [1, 3, 5],  // 1: ii
      [2, 4, 6],  // 2: iii
      [3, 5, 0],  // 3: IV
      [4, 6, 1],  // 4: V
      [5, 0, 2],  // 5: vi
      [6, 1, 3],  // 6: vii
      [0, 2, 4],  // 7: I (octave up)
      [3, 5, 0],  // 8: IV (wide)
      [4, 6, 1],  // 9: V (wide)
    ];

    // Octave offset for digits 7-9
    const OCTAVE_BOOST = [0, 0, 0, 0, 0, 0, 0, 12, 12, 12];

    const notes = [];
    let currentMidi = rootMidi + scale[0] + (audioOpts.pitchShiftSemitones || 0);
    let currentVelocity = 0.15;

    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const brightness = (c.r + c.g + c.b) / 3;
      const isRest = brightness < audioOpts.restThreshold;

      if (isRest) {
        notes.push({
          midi: currentMidi,
          freq: midiToFreq(currentMidi),
          durationSeconds: beatsToSeconds(0.15, audioOpts.tempo),
          velocity: 0.03,
          isRest: true
        });
        continue;
      }

      // Extract digits from channels
      const changeDigit = c.g % 10;    // G ones: change probability
      const harmonyDigit = c.r % 10;   // R ones: which chord
      const toneDigit = c.b % 10;      // B ones: which chord tone (0-2)
      const velDigit = Math.floor((c.r % 100) / 10); // R tens: velocity

      // Should the note change?
      const shouldChange = changeDigit >= 5;

      if (shouldChange) {
        // Pick chord tones from the harmony
        const chord = CHORDS[harmonyDigit];
        const toneIdx = toneDigit % 3; // pick one of the 3 chord tones
        const scaleIdx = chord[toneIdx] % scale.length;
        const octave = OCTAVE_BOOST[harmonyDigit];

        currentMidi = rootMidi + scale[scaleIdx] + octave + (audioOpts.pitchShiftSemitones || 0);
        currentMidi = clamp(currentMidi, 36, 96);
      }
      // else: note stays the same (drift/sustain)

      // Velocity varies with the digit
      currentVelocity = 0.08 + (velDigit / 9) * 0.2;

      // Duration: held notes get slightly longer
      const durMul = shouldChange ? 1.0 : 1.3;
      const baseDur = beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo);

      // Color-based duration tint
      let colorDur = audioOpts.neutralDuration;
      if (c.b > c.r && c.b > c.g) colorDur = audioOpts.blueDuration;
      else if (c.r > c.b && c.r > c.g) colorDur = audioOpts.brightDuration;

      const durationSeconds = baseDur * (colorDur / audioOpts.neutralDuration) * durMul;

      notes.push({
        midi: currentMidi,
        freq: midiToFreq(currentMidi),
        durationSeconds: Math.max(0.05, durationSeconds),
        velocity: clamp(currentVelocity, 0.05, 0.35),
        isRest: false
      });

      // When note changes and saturation is high, add a soft chord tone
      if (shouldChange) {
        const saturation = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
        if (saturation > 80) {
          const chord = CHORDS[harmonyDigit];
          const altTone = chord[(toneDigit + 1) % 3] % scale.length;
          const altMidi = clamp(
            rootMidi + scale[altTone] + OCTAVE_BOOST[harmonyDigit] + (audioOpts.pitchShiftSemitones || 0),
            36, 96
          );
          notes.push({
            midi: altMidi,
            freq: midiToFreq(altMidi),
            durationSeconds: Math.max(0.05, durationSeconds * 0.7),
            velocity: clamp(currentVelocity * 0.5, 0.03, 0.2),
            isRest: false
          });
        }
      }
    }

    return notes;
  }

  const ALGORITHMS = {
    "rgba-digit": { name: "RGBA Digit", fn: rgbaDigit, description: "RGB channel digits → pitch, rhythm, chords" },
    "brightness-linear": { name: "Brightness Linear", fn: brightnessLinear, description: "Brightness → pitch, color → duration" },
    "color-harmony": { name: "Color Harmony", fn: colorHarmony, description: "HSL hue → scale degree, saturation → velocity" },
    "spectral": { name: "Spectral", fn: spectral, description: "Y-axis as frequency spectrum" },
    "contour": { name: "Contour", fn: contour, description: "Follow brightness gradients for melody" },
    "harmonic-drift": { name: "Harmonic Drift", fn: harmonicDrift, description: "Digit-based note hold/change with diatonic chord tones" }
  };

  function getAlgorithm(name) {
    return ALGORITHMS[name] || ALGORITHMS["rgba-digit"];
  }

  function registerAlgorithm(name, fn, displayName, description) {
    ALGORITHMS[name] = { name: displayName || name, fn, description: description || "" };
  }

  class ImageEngine {
    canHandle(source, meta) {
      return true;
    }

    async analyze(source, audioOpts) {
      const img = await this._loadImage(source.url);

      // Multi-instrument mode
      if (audioOpts._instruments && audioOpts._instruments.length > 0) {
        return this._analyzeMultiLayer(img, source.fileName, audioOpts);
      }

      return this._analyzeImage(img, source.fileName, audioOpts);
    }

    _analyzeMultiLayer(img, fileName, audioOpts) {
      const layers = [];

      for (const inst of audioOpts._instruments) {
        // Merge instrument settings into audioOpts for each layer analysis
        const layerOpts = {
          ...audioOpts,
          sampleRows: inst.sampleRows || audioOpts.sampleRows,
          pitchShiftSemitones: (audioOpts.pitchShiftSemitones || 0) + (inst.octaveShift || 0) * 12
        };

        const result = this._analyzeImage(img, fileName, layerOpts);

        layers.push({
          instrument: inst,
          notes: result.score
        });
      }

      // Use the meta from first layer
      const firstResult = this._analyzeImage(img, fileName, audioOpts);

      return {
        meta: firstResult.meta,
        score: { layers }
      };
    }

    play(score, audioCtx, audioOpts) {
      // Multi-layer score: { layers: [ { instrument, notes }, ... ] }
      // Single-layer score: plain array of notes (backward compatible)
      if (score && score.layers) {
        return this._playMultiLayer(score, audioCtx, audioOpts);
      }
      return this._playSingleLayer(score, audioCtx, audioOpts);
    }

    _playSingleLayer(notes, audioCtx, audioOpts, instOverride) {
      const now = audioCtx.currentTime + 0.03;
      let t = now;
      const allNodes = [];

      const wf = (instOverride && instOverride.waveform) || audioOpts.waveform;
      const ft = (instOverride && instOverride.filterType) || audioOpts.filterType;
      const fb = (instOverride && instOverride.filterBaseHz) || audioOpts.filterBaseHz;
      const fv = (instOverride && instOverride.filterVelocityAmount) || audioOpts.filterVelocityAmount;
      const att = (instOverride && instOverride.attack) || audioOpts.attack;
      const rel = (instOverride && instOverride.release) || audioOpts.release;
      const vol = (instOverride && instOverride.volume) || audioOpts.masterVolume;

      let i = 0;
      while (i < notes.length) {
        const primary = notes[i];
        const primaryDur = primary.durationSeconds;

        const group = [primary];
        let j = i + 1;
        while (j < notes.length) {
          const candidate = notes[j];
          if (!primary.isRest && !candidate.isRest &&
              candidate.durationSeconds < primaryDur &&
              candidate.velocity < primary.velocity) {
            group.push(candidate);
            j++;
          } else {
            break;
          }
        }

        for (const note of group) {
          if (!note.isRest) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const filter = audioCtx.createBiquadFilter();

            osc.type = wf;
            osc.frequency.setValueAtTime(note.freq, t);

            filter.type = ft;
            filter.frequency.setValueAtTime(fb + note.velocity * fv, t);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(
              Math.max(0.0002, note.velocity * vol), t + att
            );
            gain.gain.exponentialRampToValueAtTime(
              0.0001, t + Math.max(att + 0.01, note.durationSeconds)
            );

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(t);
            osc.stop(t + note.durationSeconds + rel);

            allNodes.push(osc, gain, filter);
          }
        }

        t += primaryDur + 0.02;
        i = j;
      }

      return { nodes: allNodes, timers: [], totalDuration: Math.max(0, t - (audioCtx.currentTime + 0.03)) };
    }

    _playMultiLayer(score, audioCtx, audioOpts) {
      const allNodes = [];
      let maxDuration = 0;

      for (const layer of score.layers) {
        const result = this._playSingleLayer(layer.notes, audioCtx, audioOpts, layer.instrument);
        allNodes.push(...result.nodes);
        if (result.totalDuration > maxDuration) maxDuration = result.totalDuration;
      }

      return { nodes: allNodes, timers: [], totalDuration: maxDuration };
    }

    stop(handle) {
      if (handle.timers) {
        handle.timers.forEach((id) => clearTimeout(id));
      }
      if (handle.nodes) {
        handle.nodes.forEach((node) => {
          try { if (typeof node.stop === "function") node.stop(0); } catch {}
          try { if (typeof node.disconnect === "function") node.disconnect(); } catch {}
        });
      }
    }

    _loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    }

    _analyzeImage(img, fileName, audioOpts) {
      const origW = img.width;
      const origH = img.height;

      // Scale canvas resolution with image size (bigger image = more detail)
      const maxDim = Math.max(origW, origH);
      const maxSize = clamp(Math.round(maxDim / 2), 64, 512);

      let w = origW;
      let h = origH;
      if (w > h) {
        h = Math.max(1, Math.round(h * (maxSize / w)));
        w = maxSize;
      } else {
        w = Math.max(1, Math.round(w * (maxSize / h)));
        h = maxSize;
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const avg = averageRGB(data);

      const scale = getScale(audioOpts.scaleMode, avg);
      const rootMidi = audioOpts.rootMode === "fixed"
        ? audioOpts.fixedRootMidi
        : charToKey((fileName?.[0] || "c").toLowerCase());

      // Scale sample columns with image width (bigger image = more notes = longer sound)
      const dynamicColumns = clamp(Math.round(origW / 3), 24, 256);
      const columns_count = audioOpts.sampleColumns || dynamicColumns;

      const rows = (audioOpts.sampleRows || [0.25, 0.5, 0.75])
        .map(v => Math.max(0, Math.min(h - 1, Math.floor(h * v))));
      const step = Math.max(1, Math.floor(w / Math.max(1, columns_count)));

      // --- Collect raw pixel data per column ---
      const columns = [];
      for (let x = 0; x < w; x += step) {
        let rr = 0, gg = 0, bb = 0, aa = 0;

        for (const y of rows) {
          const idx = (y * w + x) * 4;
          rr += data[idx];
          gg += data[idx + 1];
          bb += data[idx + 2];
          aa += data[idx + 3];
        }

        rr = Math.round(rr / rows.length);
        gg = Math.round(gg / rows.length);
        bb = Math.round(bb / rows.length);
        aa = Math.round(aa / rows.length);

        columns.push({ r: rr, g: gg, b: bb, a: aa });
      }

      // --- Delegate to selected algorithm ---
      const algorithmName = audioOpts.algorithm || "rgba-digit";
      const algo = getAlgorithm(algorithmName);
      const notes = algo.fn(columns, audioOpts, { scale, rootMidi });

      return {
        meta: { fileName, avg, scale, rootMidi, origWidth: origW, origHeight: origH },
        score: notes
      };
    }
  }

  /**
   * MidiEngine — parses Standard MIDI Files and plays via Web Audio synthesis.
   *
   * meta.midi format:
   *   { url: "https://...", data: "base64..." }
   *   url or data, at least one required.
   *
   * Self-contained MIDI parser — no external dependencies.
   */


  class MidiEngine {
    canHandle(source, meta) {
      return !!(meta && meta.midi && (meta.midi.url || meta.midi.data));
    }

    async analyze(source, audioOpts) {
      return { score: null, meta: { type: "midi" } };
    }

    play(score, audioCtx, audioOpts) {
      if (!score || !score.notes || score.notes.length === 0) {
        return { nodes: [], timers: [], totalDuration: 0 };
      }

      const nodes = [];
      const now = audioCtx.currentTime + 0.03;
      let maxEnd = now;

      score.notes.forEach((note) => {
        const t = now + note.time;
        const dur = note.duration;
        const freq = midiToFreq(note.midi);
        const vel = note.velocity / 127;

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.type = audioOpts.waveform || "triangle";
        osc.frequency.setValueAtTime(freq, t);

        filter.type = audioOpts.filterType || "lowpass";
        filter.frequency.setValueAtTime(
          (audioOpts.filterBaseHz || 900) + vel * (audioOpts.filterVelocityAmount || 3000), t
        );

        const vol = vel * (audioOpts.masterVolume || 0.25);
        const attack = audioOpts.attack || 0.02;
        const release = audioOpts.release || 0.03;

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(t);
        osc.stop(t + dur + release);

        nodes.push(osc, gain, filter);

        const end = t + dur + release;
        if (end > maxEnd) maxEnd = end;
      });

      return {
        nodes,
        timers: [],
        totalDuration: maxEnd - now
      };
    }

    stop(handle) {
      if (handle.timers) {
        handle.timers.forEach((id) => clearTimeout(id));
      }
      if (handle.nodes) {
        handle.nodes.forEach((node) => {
          try { if (typeof node.stop === "function") node.stop(0); } catch {}
          try { if (typeof node.disconnect === "function") node.disconnect(); } catch {}
        });
      }
    }
  }

  // --- Standard MIDI File Parser ---

  MidiEngine.parseMidi = function(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let pos = 0;

    function read(n) {
      const slice = bytes.slice(pos, pos + n);
      pos += n;
      return slice;
    }

    function readUint16() {
      const val = (bytes[pos] << 8) | bytes[pos + 1];
      pos += 2;
      return val;
    }

    function readUint32() {
      const val = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 4;
      return val >>> 0;
    }

    function readVarLen() {
      let val = 0;
      let b;
      do {
        b = bytes[pos++];
        val = (val << 7) | (b & 0x7F);
      } while (b & 0x80);
      return val;
    }

    // Read header chunk
    const headerTag = String.fromCharCode(...read(4));
    if (headerTag !== "MThd") throw new Error("Not a MIDI file");

    const headerLen = readUint32();
    const format = readUint16();
    const numTracks = readUint16();
    const division = readUint16();

    const ticksPerBeat = division & 0x7FFF;
    pos = 8 + 4 + headerLen; // skip to end of header

    const allEvents = [];

    // Read track chunks
    for (let t = 0; t < numTracks; t++) {
      if (pos + 8 > bytes.length) break;

      const trackTag = String.fromCharCode(...read(4));
      const trackLen = readUint32();

      if (trackTag !== "MTrk") {
        pos += trackLen;
        continue;
      }

      const trackEnd = pos + trackLen;
      let tick = 0;
      let runningStatus = 0;

      while (pos < trackEnd) {
        const delta = readVarLen();
        tick += delta;

        let status = bytes[pos];

        // Meta event
        if (status === 0xFF) {
          pos++;
          const metaType = bytes[pos++];
          const metaLen = readVarLen();
          // Tempo change
          if (metaType === 0x51 && metaLen === 3) {
            const microsecondsPerBeat = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
            allEvents.push({
              type: "tempo",
              tick,
              tempo: 60000000 / microsecondsPerBeat
            });
          }
          pos += metaLen;
          continue;
        }

        // SysEx
        if (status === 0xF0 || status === 0xF7) {
          pos++;
          const sysexLen = readVarLen();
          pos += sysexLen;
          continue;
        }

        // Channel message
        if (status & 0x80) {
          runningStatus = status;
          pos++;
        } else {
          status = runningStatus;
        }

        const type = status & 0xF0;
        const channel = status & 0x0F;

        if (type === 0x90 || type === 0x80) {
          const note = bytes[pos++];
          const velocity = bytes[pos++];
          const isNoteOn = type === 0x90 && velocity > 0;

          allEvents.push({
            type: isNoteOn ? "noteOn" : "noteOff",
            tick,
            channel,
            midi: note,
            velocity: isNoteOn ? velocity : 0
          });
        } else if (type === 0xA0 || type === 0xB0 || type === 0xE0) {
          pos += 2; // skip 2-byte messages
        } else if (type === 0xC0 || type === 0xD0) {
          pos += 1; // skip 1-byte messages
        }
      }

      pos = trackEnd;
    }

    // Sort events by tick
    allEvents.sort((a, b) => a.tick - b.tick);

    // Convert ticks to seconds and pair noteOn/noteOff
    let currentTempo = 120;
    let currentTickTime = 0;
    let lastTick = 0;
    let secondsPerTick = 60 / (currentTempo * ticksPerBeat);

    const activeNotes = new Map();
    const notes = [];

    allEvents.forEach((evt) => {
      const deltaTicks = evt.tick - lastTick;
      currentTickTime += deltaTicks * secondsPerTick;
      lastTick = evt.tick;

      if (evt.type === "tempo") {
        currentTempo = evt.tempo;
        secondsPerTick = 60 / (currentTempo * ticksPerBeat);
        return;
      }

      if (evt.type === "noteOn") {
        const key = `${evt.channel}-${evt.midi}`;
        activeNotes.set(key, {
          midi: evt.midi,
          velocity: evt.velocity,
          time: currentTickTime,
          channel: evt.channel
        });
      }

      if (evt.type === "noteOff") {
        const key = `${evt.channel}-${evt.midi}`;
        const on = activeNotes.get(key);
        if (on) {
          notes.push({
            midi: on.midi,
            velocity: on.velocity,
            time: on.time,
            duration: Math.max(0.01, currentTickTime - on.time),
            channel: on.channel
          });
          activeNotes.delete(key);
        }
      }
    });

    // Close any remaining active notes
    activeNotes.forEach((on) => {
      notes.push({
        midi: on.midi,
        velocity: on.velocity,
        time: on.time,
        duration: 0.5,
        channel: on.channel
      });
    });

    return {
      format,
      numTracks,
      ticksPerBeat,
      bpm: currentTempo,
      notes
    };
  };

  /**
   * Fetch MIDI file and parse it.
   */
  MidiEngine.fetchAndParse = async function(url) {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`[FloatImgPlay] MIDI fetch failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return MidiEngine.parseMidi(arrayBuffer);
  };

  /**
   * Decode base64 MIDI data and parse it.
   */
  MidiEngine.parseBase64 = function(base64String) {
    const binary = atob(base64String);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return MidiEngine.parseMidi(bytes.buffer);
  };

  /**
   * AudioEngine — plays mp3/wav/ogg audio files referenced in imgplay metadata.
   *
   * meta.audio format:
   *   { url: "https://...", type: "mp3" }  // type is optional
   *
   * Uses Web Audio API AudioBufferSourceNode for precise control
   * (start/stop timing, integration with AudioContext).
   */

  class AudioEngine {
    canHandle(source, meta) {
      return !!(meta && meta.audio && meta.audio.url);
    }

    /**
     * Analyze = fetch and decode the audio file.
     * Returns a "score" that is actually the decoded AudioBuffer,
     * wrapped to match the Engine interface.
     */
    async analyze(source, audioOpts) {
      const audioUrl = source._audioMeta?.url;
      if (!audioUrl) {
        return { score: null, meta: { type: "audio" } };
      }

      return {
        score: { audioUrl },
        meta: { type: "audio", url: audioUrl }
      };
    }

    /**
     * Play the audio buffer.
     * audioOpts.masterVolume is respected via a GainNode.
     */
    play(score, audioCtx, audioOpts) {
      const nodes = [];
      const timers = [];

      if (!score || !score.audioBuffer) {
        return { nodes, timers, totalDuration: 0 };
      }

      const bufferSource = audioCtx.createBufferSource();
      bufferSource.buffer = score.audioBuffer;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(audioOpts.masterVolume, audioCtx.currentTime);

      bufferSource.connect(gain);
      gain.connect(audioCtx.destination);

      bufferSource.start(0);
      nodes.push(bufferSource, gain);

      return {
        nodes,
        timers,
        totalDuration: score.audioBuffer.duration,
        bufferSource
      };
    }

    stop(handle) {
      if (handle.timers) {
        handle.timers.forEach((id) => clearTimeout(id));
      }
      if (handle.bufferSource) {
        try { handle.bufferSource.stop(0); } catch {}
      }
      if (handle.nodes) {
        handle.nodes.forEach((node) => {
          try { if (typeof node.disconnect === "function") node.disconnect(); } catch {}
        });
      }
    }
  }

  /**
   * Helper: fetch and decode an audio URL into an AudioBuffer.
   * Called by Core before play() when AudioEngine is selected.
   */
  AudioEngine.fetchAndDecode = async function(url, audioCtx) {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`[FloatImgPlay] AudioEngine fetch failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return audioBuffer;
  };

  /**
   * MetaParser — extracts imgplay metadata from images.
   *
   * Supported sources (checked in order):
   * 1. PNG tEXt chunk with key "imgplay"
   * 2. EXIF UserComment containing imgplay JSON
   * 3. Sidecar JSON file at <image-url>.imgplay.json
   *
   * All methods are async because they may fetch data.
   * Static `parse(source)` returns synchronous empty meta (for init),
   * while `parseAsync(source)` does the full extraction.
   */

  const EMPTY_META = Object.freeze({ midi: null, audio: null, engine: null });

  class MetaParser {
    /**
     * Synchronous parse — returns empty meta.
     * Used during initial registration before async parse completes.
     */
    static parse(source) {
      return { midi: null, audio: null, engine: null };
    }

    /**
     * Full async parse — tries all sources in order.
     * Returns first valid imgplay meta found, or empty meta.
     */
    static async parseAsync(source) {
      if (!source || !source.url) return { ...EMPTY_META };

      try {
        // 1. Try PNG tEXt chunk
        const pngMeta = await MetaParser._parsePngText(source.url);
        if (pngMeta) return pngMeta;
      } catch {}

      try {
        // 2. Try EXIF UserComment
        const exifMeta = await MetaParser._parseExif(source.url);
        if (exifMeta) return exifMeta;
      } catch {}

      try {
        // 3. Try sidecar JSON
        const sidecarMeta = await MetaParser._parseSidecar(source.url);
        if (sidecarMeta) return sidecarMeta;
      } catch {}

      return { ...EMPTY_META };
    }

    /**
     * Parse PNG tEXt chunks for key "imgplay".
     * PNG tEXt chunk format: keyword (null-terminated) + text data
     */
    static async _parsePngText(url) {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return null;

      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      // Verify PNG signature: 137 80 78 71 13 10 26 10
      if (bytes.length < 8 ||
          bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
        return null;
      }

      let offset = 8; // skip PNG signature

      while (offset + 12 <= bytes.length) {
        const chunkLen = (bytes[offset] << 24) | (bytes[offset + 1] << 16) |
                         (bytes[offset + 2] << 8) | bytes[offset + 3];
        const chunkType = String.fromCharCode(
          bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]
        );

        if (chunkType === "tEXt" && chunkLen > 0) {
          const dataStart = offset + 8;
          const dataEnd = dataStart + chunkLen;
          if (dataEnd <= bytes.length) {
            const chunkData = bytes.slice(dataStart, dataEnd);
            // Find null separator between keyword and text
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
              const keyword = MetaParser._bytesToString(chunkData.slice(0, nullIdx));
              if (keyword === "imgplay") {
                const textData = MetaParser._bytesToString(chunkData.slice(nullIdx + 1));
                return MetaParser._parseJsonMeta(textData);
              }
            }
          }
        }

        // Also check iTXt (international text) chunks
        if (chunkType === "iTXt" && chunkLen > 0) {
          const dataStart = offset + 8;
          const dataEnd = dataStart + chunkLen;
          if (dataEnd <= bytes.length) {
            const chunkData = bytes.slice(dataStart, dataEnd);
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
              const keyword = MetaParser._bytesToString(chunkData.slice(0, nullIdx));
              if (keyword === "imgplay") {
                // iTXt: keyword \0 compression_flag \0 compression_method \0 lang \0 translated \0 text
                let pos = nullIdx + 1;
                // Skip compression flag, method
                pos = chunkData.indexOf(0, pos) + 1; // skip after compression
                if (pos === 0) pos = nullIdx + 3;
                // Skip language tag
                pos = chunkData.indexOf(0, pos) + 1;
                if (pos === 0) return null;
                // Skip translated keyword
                pos = chunkData.indexOf(0, pos) + 1;
                if (pos === 0) return null;
                const textData = MetaParser._bytesToString(chunkData.slice(pos));
                return MetaParser._parseJsonMeta(textData);
              }
            }
          }
        }

        if (chunkType === "IEND") break;

        // Move to next chunk: 4(length) + 4(type) + chunkLen(data) + 4(CRC)
        offset += 12 + chunkLen;
      }

      return null;
    }

    /**
     * Parse EXIF data for UserComment containing imgplay JSON.
     * Looks for JPEG APP1 EXIF marker or TIFF-in-PNG.
     */
    static async _parseExif(url) {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return null;

      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      // JPEG check: starts with 0xFF 0xD8
      if (bytes.length < 4) return null;

      if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        return MetaParser._parseJpegExif(bytes);
      }

      return null;
    }

    /**
     * Parse JPEG EXIF for UserComment tag (0x9286).
     */
    static _parseJpegExif(bytes) {
      let offset = 2;

      while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xFF) break;

        const marker = bytes[offset + 1];
        // APP1 = 0xE1 (EXIF)
        if (marker === 0xE1) {
          const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
          const segStart = offset + 4;
          const segEnd = offset + 2 + segLen;

          // Check "Exif\0\0" header
          if (segEnd <= bytes.length &&
              bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 &&
              bytes[segStart + 2] === 0x69 && bytes[segStart + 3] === 0x66 &&
              bytes[segStart + 4] === 0x00 && bytes[segStart + 5] === 0x00) {

            const tiffStart = segStart + 6;
            return MetaParser._parseTiffForUserComment(bytes, tiffStart, segEnd);
          }
        }

        // Skip non-APP1 segments
        if (marker === 0xDA) break; // Start of scan = end of metadata
        const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + len;
      }

      return null;
    }

    /**
     * Scan TIFF IFD entries for UserComment tag (0x9286).
     */
    static _parseTiffForUserComment(bytes, tiffStart, maxEnd) {
      if (tiffStart + 8 > maxEnd) return null;

      const isLE = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;

      const read16 = (off) => {
        const a = tiffStart + off;
        if (a + 2 > maxEnd) return 0;
        return isLE
          ? bytes[a] | (bytes[a + 1] << 8)
          : (bytes[a] << 8) | bytes[a + 1];
      };

      const read32 = (off) => {
        const a = tiffStart + off;
        if (a + 4 > maxEnd) return 0;
        return isLE
          ? bytes[a] | (bytes[a + 1] << 8) | (bytes[a + 2] << 16) | (bytes[a + 3] << 24)
          : (bytes[a] << 24) | (bytes[a + 1] << 16) | (bytes[a + 2] << 8) | bytes[a + 3];
      };

      const scanIFD = (ifdOffset) => {
        if (ifdOffset + 2 > maxEnd - tiffStart) return null;
        const count = read16(ifdOffset);

        for (let i = 0; i < count; i++) {
          const entryOff = ifdOffset + 2 + i * 12;
          if (entryOff + 12 > maxEnd - tiffStart) break;

          const tag = read16(entryOff);
          read16(entryOff + 2);
          const numValues = read32(entryOff + 4);
          const valueOff = read32(entryOff + 8);

          // UserComment = 0x9286
          if (tag === 0x9286 && numValues > 8) {
            const dataOff = tiffStart + valueOff;
            if (dataOff + numValues <= maxEnd) {
              // UserComment starts with 8-byte encoding prefix
              const textBytes = bytes.slice(dataOff + 8, dataOff + numValues);
              const text = MetaParser._bytesToString(textBytes).trim().replace(/\0+$/, "");
              const meta = MetaParser._parseJsonMeta(text);
              if (meta) return meta;
            }
          }

          // ExifIFD pointer = 0x8769
          if (tag === 0x8769) {
            const subResult = scanIFD(valueOff);
            if (subResult) return subResult;
          }
        }

        return null;
      };

      const firstIFDOffset = read32(4);
      return scanIFD(firstIFDOffset);
    }

    /**
     * Fetch sidecar JSON: <image-url>.imgplay.json
     */
    static async _parseSidecar(url) {
      const sidecarUrl = url + ".imgplay.json";
      const res = await fetch(sidecarUrl, { mode: "cors" });
      if (!res.ok) return null;

      const text = await res.text();
      return MetaParser._parseJsonMeta(text);
    }

    /**
     * Parse JSON string into imgplay meta structure.
     * Expects: { "imgplay": { "midi": ..., "audio": ..., "engine": ... } }
     * or direct: { "midi": ..., "audio": ..., "engine": ... }
     */
    static _parseJsonMeta(text) {
      try {
        const json = JSON.parse(text);
        const data = json.imgplay || json;

        const result = {
          midi: data.midi || null,
          audio: data.audio || null,
          engine: data.engine || null
        };

        // Only return if at least one field is non-null
        if (result.midi || result.audio || result.engine) {
          return result;
        }
        return null;
      } catch {
        return null;
      }
    }

    /**
     * Convert Uint8Array to string (UTF-8).
     */
    static _bytesToString(bytes) {
      try {
        return new TextDecoder("utf-8").decode(bytes);
      } catch {
        // Fallback for environments without TextDecoder
        let s = "";
        for (let i = 0; i < bytes.length; i++) {
          s += String.fromCharCode(bytes[i]);
        }
        return s;
      }
    }
  }

  /**
   * MidiExport — converts image analysis score to Standard MIDI File.
   *
   * Usage:
   *   const blob = MidiExport.toBlob(score, { bpm: 100 });
   *   MidiExport.download(blob, "my-image.mid");
   */

  class MidiExport {
    /**
     * Convert a score (array of notes) to a Standard MIDI File Blob.
     *
     * @param {Array} score - Array of { midi, freq, durationSeconds, velocity, isRest }
     * @param {Object} opts - { bpm: number }
     * @returns {Blob} MIDI file as Blob
     */
    static toBlob(score, opts = {}) {
      const bytes = MidiExport.toBytes(score, opts);
      return new Blob([bytes], { type: "audio/midi" });
    }

    /**
     * Convert score to MIDI byte array.
     */
    static toBytes(score, opts = {}) {
      const bpm = opts.bpm || 100;
      const ticksPerBeat = 480;
      const secondsPerTick = 60 / (bpm * ticksPerBeat);

      // Build MIDI events from score
      const events = [];
      let currentTime = 0;

      score.forEach((note) => {
        if (note.isRest) {
          currentTime += note.durationSeconds;
          return;
        }

        const startTick = Math.round(currentTime / secondsPerTick);
        const durationTicks = Math.max(1, Math.round(note.durationSeconds / secondsPerTick));
        const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127 / 0.36)));
        const midiNote = Math.max(0, Math.min(127, Math.round(note.midi)));

        events.push({
          tick: startTick,
          type: 0x90, // noteOn
          data: [midiNote, velocity]
        });

        events.push({
          tick: startTick + durationTicks,
          type: 0x80, // noteOff
          data: [midiNote, 0]
        });

        currentTime += note.durationSeconds + 0.02; // match playback gap
      });

      // Sort by tick
      events.sort((a, b) => a.tick - b.tick);

      // Convert to delta-time track bytes
      const trackBytes = [];

      // Tempo meta event: FF 51 03 tt tt tt
      const microsecondsPerBeat = Math.round(60000000 / bpm);
      trackBytes.push(0x00); // delta = 0
      trackBytes.push(0xFF, 0x51, 0x03);
      trackBytes.push((microsecondsPerBeat >> 16) & 0xFF);
      trackBytes.push((microsecondsPerBeat >> 8) & 0xFF);
      trackBytes.push(microsecondsPerBeat & 0xFF);

      let lastTick = 0;
      events.forEach((evt) => {
        const delta = evt.tick - lastTick;
        lastTick = evt.tick;

        // Write variable-length delta
        const varLen = MidiExport._toVarLen(delta);
        varLen.forEach((b) => trackBytes.push(b));

        // Write event
        trackBytes.push(evt.type); // status byte (channel 0)
        evt.data.forEach((b) => trackBytes.push(b));
      });

      // End of track: FF 2F 00
      trackBytes.push(0x00, 0xFF, 0x2F, 0x00);

      // Build complete MIDI file
      const file = [];

      // MThd header
      MidiExport._writeString(file, "MThd");
      MidiExport._writeUint32(file, 6); // header length
      MidiExport._writeUint16(file, 0); // format 0
      MidiExport._writeUint16(file, 1); // 1 track
      MidiExport._writeUint16(file, ticksPerBeat);

      // MTrk
      MidiExport._writeString(file, "MTrk");
      MidiExport._writeUint32(file, trackBytes.length);
      trackBytes.forEach((b) => file.push(b));

      return new Uint8Array(file);
    }

    /**
     * Trigger browser download of a Blob.
     */
    static download(blob, filename = "imgplay-export.mid") {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /**
     * Convenience: convert score and immediately download.
     */
    static exportAndDownload(score, opts = {}, filename) {
      const blob = MidiExport.toBlob(score, opts);
      MidiExport.download(blob, filename);
    }

    // --- Internal helpers ---

    static _toVarLen(value) {
      if (value < 0) value = 0;
      const bytes = [];
      bytes.push(value & 0x7F);
      value >>= 7;
      while (value > 0) {
        bytes.push((value & 0x7F) | 0x80);
        value >>= 7;
      }
      bytes.reverse();
      return bytes;
    }

    static _writeString(arr, str) {
      for (let i = 0; i < str.length; i++) {
        arr.push(str.charCodeAt(i));
      }
    }

    static _writeUint16(arr, val) {
      arr.push((val >> 8) & 0xFF, val & 0xFF);
    }

    static _writeUint32(arr, val) {
      arr.push((val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
    }
  }

  /**
   * MetaEmbed — embeds imgplay metadata into PNG files.
   *
   * Takes a PNG image + MIDI file (or JSON metadata) and produces
   * a new PNG with an "imgplay" tEXt chunk containing the data.
   *
   * Usage:
   *   const blob = await MetaEmbed.embedMidi(pngFile, midiFile);
   *   MetaEmbed.download(blob, "image-with-midi.png");
   */

  class MetaEmbed {
    /**
     * Embed a MIDI file into a PNG image as base64 in tEXt chunk.
     *
     * @param {File|Blob|ArrayBuffer} pngSource - PNG image
     * @param {File|Blob|ArrayBuffer} midiSource - MIDI file
     * @param {Object} extraMeta - additional metadata to merge
     * @returns {Promise<Blob>} new PNG with embedded MIDI
     */
    static async embedMidi(pngSource, midiSource, extraMeta = {}) {
      const pngBuf = await MetaEmbed._toArrayBuffer(pngSource);
      const midiBuf = await MetaEmbed._toArrayBuffer(midiSource);

      const midiBase64 = MetaEmbed._arrayBufferToBase64(midiBuf);

      const meta = Object.assign({
        midi: { data: midiBase64 }
      }, extraMeta);

      return MetaEmbed.embedJson(pngBuf, meta);
    }

    /**
     * Embed an audio URL reference into a PNG image.
     *
     * @param {File|Blob|ArrayBuffer} pngSource - PNG image
     * @param {string} audioUrl - URL to audio file
     * @param {Object} extraMeta - additional metadata
     * @returns {Promise<Blob>} new PNG with embedded audio reference
     */
    static async embedAudioUrl(pngSource, audioUrl, extraMeta = {}) {
      const pngBuf = await MetaEmbed._toArrayBuffer(pngSource);

      const meta = Object.assign({
        audio: { url: audioUrl }
      }, extraMeta);

      return MetaEmbed.embedJson(pngBuf, meta);
    }

    /**
     * Embed arbitrary imgplay JSON metadata into a PNG.
     *
     * @param {ArrayBuffer} pngBuffer - PNG file bytes
     * @param {Object} meta - metadata object (midi, audio, engine fields)
     * @returns {Blob} new PNG with tEXt chunk
     */
    static embedJson(pngBuffer, meta) {
      const pngBytes = new Uint8Array(pngBuffer);

      // Verify PNG signature
      if (pngBytes.length < 8 ||
          pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50 ||
          pngBytes[2] !== 0x4E || pngBytes[3] !== 0x47) {
        throw new Error("[MetaEmbed] Not a valid PNG file");
      }

      const jsonStr = JSON.stringify({ imgplay: meta });
      const textChunk = MetaEmbed._createTextChunk("imgplay", jsonStr);

      // Find insertion point: after IHDR chunk (first chunk after signature)
      // PNG: 8-byte signature, then chunks (4 len + 4 type + data + 4 CRC)
      const ihdrLen = (pngBytes[8] << 24) | (pngBytes[9] << 16) |
                      (pngBytes[10] << 8) | pngBytes[11];
      const insertAt = 8 + 12 + ihdrLen; // after signature + IHDR chunk

      // Build new PNG: before + tEXt chunk + after
      const before = pngBytes.slice(0, insertAt);
      const after = pngBytes.slice(insertAt);

      const result = new Uint8Array(before.length + textChunk.length + after.length);
      result.set(before, 0);
      result.set(textChunk, before.length);
      result.set(after, before.length + textChunk.length);

      return new Blob([result], { type: "image/png" });
    }

    /**
     * Remove existing imgplay tEXt chunks from a PNG.
     *
     * @param {File|Blob|ArrayBuffer} pngSource - PNG image
     * @returns {Promise<Blob>} PNG without imgplay metadata
     */
    static async strip(pngSource) {
      const pngBuf = await MetaEmbed._toArrayBuffer(pngSource);
      const bytes = new Uint8Array(pngBuf);

      if (bytes.length < 8 ||
          bytes[0] !== 0x89 || bytes[1] !== 0x50) {
        throw new Error("[MetaEmbed] Not a valid PNG file");
      }

      const parts = [bytes.slice(0, 8)]; // PNG signature
      let offset = 8;

      while (offset + 12 <= bytes.length) {
        const chunkLen = (bytes[offset] << 24) | (bytes[offset + 1] << 16) |
                         (bytes[offset + 2] << 8) | bytes[offset + 3];
        const chunkType = String.fromCharCode(
          bytes[offset + 4], bytes[offset + 5],
          bytes[offset + 6], bytes[offset + 7]
        );
        const fullChunkSize = 12 + chunkLen;

        // Check if this is an imgplay tEXt/iTXt chunk
        let isImgplay = false;
        if ((chunkType === "tEXt" || chunkType === "iTXt") && chunkLen > 0) {
          const dataStart = offset + 8;
          const dataEnd = dataStart + chunkLen;
          if (dataEnd <= bytes.length) {
            const chunkData = bytes.slice(dataStart, dataEnd);
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
              const keyword = MetaEmbed._bytesToString(chunkData.slice(0, nullIdx));
              if (keyword === "imgplay") isImgplay = true;
            }
          }
        }

        if (!isImgplay) {
          parts.push(bytes.slice(offset, offset + fullChunkSize));
        }

        if (chunkType === "IEND") break;
        offset += fullChunkSize;
      }

      const totalLen = parts.reduce(function(sum, p) { return sum + p.length; }, 0);
      const result = new Uint8Array(totalLen);
      let pos = 0;
      parts.forEach(function(p) {
        result.set(p, pos);
        pos += p.length;
      });

      return new Blob([result], { type: "image/png" });
    }

    /**
     * Trigger browser download.
     */
    static download(blob, filename = "imgplay-embedded.png") {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // --- Internal helpers ---

    static _createTextChunk(keyword, text) {
      const keyBytes = MetaEmbed._stringToBytes(keyword);
      const textBytes = MetaEmbed._stringToBytes(text);

      // tEXt chunk data: keyword + null + text
      const dataLen = keyBytes.length + 1 + textBytes.length;
      const chunk = new Uint8Array(12 + dataLen);

      // Length (4 bytes, big-endian)
      chunk[0] = (dataLen >> 24) & 0xFF;
      chunk[1] = (dataLen >> 16) & 0xFF;
      chunk[2] = (dataLen >> 8) & 0xFF;
      chunk[3] = dataLen & 0xFF;

      // Type: "tEXt"
      chunk[4] = 0x74; // t
      chunk[5] = 0x45; // E
      chunk[6] = 0x58; // X
      chunk[7] = 0x74; // t

      // Data: keyword + null + text
      chunk.set(keyBytes, 8);
      chunk[8 + keyBytes.length] = 0; // null separator
      chunk.set(textBytes, 8 + keyBytes.length + 1);

      // CRC over type + data
      const crcData = chunk.slice(4, 8 + dataLen);
      const crc = MetaEmbed._crc32(crcData);
      const crcOffset = 8 + dataLen;
      chunk[crcOffset] = (crc >> 24) & 0xFF;
      chunk[crcOffset + 1] = (crc >> 16) & 0xFF;
      chunk[crcOffset + 2] = (crc >> 8) & 0xFF;
      chunk[crcOffset + 3] = crc & 0xFF;

      return chunk;
    }

    static _crc32(bytes) {
      if (!MetaEmbed._crcTable) {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
          var c = n;
          for (var k = 0; k < 8; k++) {
            if (c & 1) c = 0xEDB88320 ^ (c >>> 1);
            else c = c >>> 1;
          }
          table[n] = c;
        }
        MetaEmbed._crcTable = table;
      }

      var crc = 0xFFFFFFFF;
      for (var i = 0; i < bytes.length; i++) {
        crc = MetaEmbed._crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    static _stringToBytes(str) {
      var bytes = new Uint8Array(str.length);
      for (var i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xFF;
      }
      return bytes;
    }

    static _bytesToString(bytes) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]);
      }
      return s;
    }

    static async _toArrayBuffer(source) {
      if (source instanceof ArrayBuffer) return source;
      if (source instanceof Uint8Array) return source.buffer;
      if (source instanceof Blob || (typeof File !== "undefined" && source instanceof File)) {
        return source.arrayBuffer();
      }
      throw new Error("[MetaEmbed] Unsupported source type");
    }

    static _arrayBufferToBase64(buffer) {
      var bytes = new Uint8Array(buffer);
      var binary = "";
      for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  }

  /**
   * Instrument presets and ensemble definitions.
   *
   * Each instrument preset defines Web Audio synthesis parameters
   * that shape a unique "voice" for image sonification.
   *
   * Each ensemble preset combines multiple instruments into a
   * multi-layer arrangement (e.g., orchestra, band, electronic).
   */

  const INSTRUMENT_PRESETS = {
    // --- Keys & Piano ---
    piano: {
      name: "Piano",
      waveform: "triangle",
      octaveShift: 0,
      volume: 0.28,
      attack: 0.01,
      release: 0.08,
      filterType: "lowpass",
      filterBaseHz: 2000,
      filterVelocityAmount: 3000,
      sampleRows: [0.3, 0.5, 0.7]
    },
    epiano: {
      name: "E.Piano",
      waveform: "sine",
      octaveShift: 0,
      volume: 0.25,
      attack: 0.005,
      release: 0.12,
      filterType: "lowpass",
      filterBaseHz: 1800,
      filterVelocityAmount: 2500,
      sampleRows: [0.3, 0.5, 0.7]
    },
    organ: {
      name: "Organ",
      waveform: "square",
      octaveShift: 0,
      volume: 0.18,
      attack: 0.01,
      release: 0.02,
      filterType: "lowpass",
      filterBaseHz: 1200,
      filterVelocityAmount: 2000,
      sampleRows: [0.25, 0.5, 0.75]
    },

    // --- Synth ---
    synthLead: {
      name: "Synth Lead",
      waveform: "sawtooth",
      octaveShift: 0,
      volume: 0.22,
      attack: 0.005,
      release: 0.03,
      filterType: "lowpass",
      filterBaseHz: 800,
      filterVelocityAmount: 5000,
      sampleRows: [0.4, 0.5, 0.6]
    },
    synthPad: {
      name: "Synth Pad",
      waveform: "sine",
      octaveShift: 0,
      volume: 0.15,
      attack: 0.15,
      release: 0.3,
      filterType: "lowpass",
      filterBaseHz: 600,
      filterVelocityAmount: 1500,
      sampleRows: [0.2, 0.5, 0.8]
    },

    // --- Bass ---
    bass: {
      name: "Bass",
      waveform: "square",
      octaveShift: -1,
      volume: 0.25,
      attack: 0.008,
      release: 0.04,
      filterType: "lowpass",
      filterBaseHz: 500,
      filterVelocityAmount: 1500,
      sampleRows: [0.6, 0.7, 0.8]
    },
    subBass: {
      name: "Sub Bass",
      waveform: "sine",
      octaveShift: -2,
      volume: 0.3,
      attack: 0.01,
      release: 0.05,
      filterType: "lowpass",
      filterBaseHz: 300,
      filterVelocityAmount: 600,
      sampleRows: [0.7, 0.8, 0.9]
    },

    // --- Plucked / Short ---
    pluck: {
      name: "Pluck",
      waveform: "triangle",
      octaveShift: 0,
      volume: 0.2,
      attack: 0.002,
      release: 0.01,
      filterType: "lowpass",
      filterBaseHz: 3000,
      filterVelocityAmount: 4000,
      sampleRows: [0.35, 0.5, 0.65]
    },

    // --- Orchestral ---
    strings: {
      name: "Strings",
      waveform: "sawtooth",
      octaveShift: 0,
      volume: 0.16,
      attack: 0.1,
      release: 0.15,
      filterType: "lowpass",
      filterBaseHz: 900,
      filterVelocityAmount: 2000,
      sampleRows: [0.2, 0.4, 0.6]
    },
    brass: {
      name: "Brass",
      waveform: "sawtooth",
      octaveShift: 0,
      volume: 0.2,
      attack: 0.03,
      release: 0.06,
      filterType: "lowpass",
      filterBaseHz: 600,
      filterVelocityAmount: 4000,
      sampleRows: [0.3, 0.5, 0.7]
    },
    flute: {
      name: "Flute",
      waveform: "sine",
      octaveShift: 1,
      volume: 0.15,
      attack: 0.04,
      release: 0.08,
      filterType: "lowpass",
      filterBaseHz: 2500,
      filterVelocityAmount: 2000,
      sampleRows: [0.2, 0.3, 0.4]
    },
    choir: {
      name: "Choir",
      waveform: "triangle",
      octaveShift: 0,
      volume: 0.14,
      attack: 0.12,
      release: 0.2,
      filterType: "lowpass",
      filterBaseHz: 800,
      filterVelocityAmount: 1800,
      sampleRows: [0.3, 0.5, 0.7]
    },

    // --- Percussion-like ---
    bell: {
      name: "Bell",
      waveform: "sine",
      octaveShift: 1,
      volume: 0.12,
      attack: 0.001,
      release: 0.4,
      filterType: "highpass",
      filterBaseHz: 1000,
      filterVelocityAmount: 3000,
      sampleRows: [0.2, 0.4]
    },
    marimba: {
      name: "Marimba",
      waveform: "triangle",
      octaveShift: 0,
      volume: 0.22,
      attack: 0.002,
      release: 0.06,
      filterType: "bandpass",
      filterBaseHz: 1500,
      filterVelocityAmount: 2500,
      sampleRows: [0.4, 0.5, 0.6]
    },

    // --- Guitar-like ---
    guitar: {
      name: "Guitar",
      waveform: "sawtooth",
      octaveShift: 0,
      volume: 0.2,
      attack: 0.003,
      release: 0.05,
      filterType: "lowpass",
      filterBaseHz: 1500,
      filterVelocityAmount: 3500,
      sampleRows: [0.35, 0.5, 0.65]
    },

    // --- Electronic / Special ---
    acid: {
      name: "Acid",
      waveform: "sawtooth",
      octaveShift: -1,
      volume: 0.2,
      attack: 0.003,
      release: 0.02,
      filterType: "lowpass",
      filterBaseHz: 300,
      filterVelocityAmount: 6000,
      sampleRows: [0.5, 0.6, 0.7]
    },
    chiptune: {
      name: "Chiptune",
      waveform: "square",
      octaveShift: 1,
      volume: 0.14,
      attack: 0.002,
      release: 0.01,
      filterType: "highpass",
      filterBaseHz: 200,
      filterVelocityAmount: 4000,
      sampleRows: [0.3, 0.5, 0.7]
    },
    warmPad: {
      name: "Warm Pad",
      waveform: "triangle",
      octaveShift: 0,
      volume: 0.15,
      attack: 0.2,
      release: 0.25,
      filterType: "lowpass",
      filterBaseHz: 700,
      filterVelocityAmount: 1200,
      sampleRows: [0.2, 0.5, 0.8]
    },
    glass: {
      name: "Glass",
      waveform: "sine",
      octaveShift: 1,
      volume: 0.1,
      attack: 0.001,
      release: 0.5,
      filterType: "highpass",
      filterBaseHz: 2000,
      filterVelocityAmount: 2000,
      sampleRows: [0.15, 0.35]
    },
    wobble: {
      name: "Wobble",
      waveform: "sawtooth",
      octaveShift: -1,
      volume: 0.22,
      attack: 0.01,
      release: 0.03,
      filterType: "lowpass",
      filterBaseHz: 200,
      filterVelocityAmount: 5000,
      sampleRows: [0.6, 0.75, 0.9]
    }
  };

  const ENSEMBLE_PRESETS = {
    orchestra: {
      name: "Orchestra",
      instruments: [
        { preset: "strings", volume: 0.18 },
        { preset: "brass", volume: 0.14 },
        { preset: "flute", volume: 0.12 }
      ]
    },
    rockBand: {
      name: "Rock Band",
      instruments: [
        { preset: "guitar", volume: 0.22 },
        { preset: "bass", volume: 0.2 },
        { preset: "organ", volume: 0.12 }
      ]
    },
    electronic: {
      name: "Electronic",
      instruments: [
        { preset: "synthLead", volume: 0.2 },
        { preset: "subBass", volume: 0.22 },
        { preset: "synthPad", volume: 0.12 }
      ]
    },
    jazzTrio: {
      name: "Jazz Trio",
      instruments: [
        { preset: "epiano", volume: 0.25 },
        { preset: "bass", volume: 0.2 },
        { preset: "pluck", volume: 0.15 }
      ]
    },
    ambient: {
      name: "Ambient",
      instruments: [
        { preset: "warmPad", volume: 0.16 },
        { preset: "glass", volume: 0.1 },
        { preset: "choir", volume: 0.12 }
      ]
    },
    chiptuneBand: {
      name: "Chiptune Band",
      instruments: [
        { preset: "chiptune", volume: 0.16 },
        { preset: "chiptune", volume: 0.14, octaveShift: -2 },
        { preset: "bell", volume: 0.1 }
      ]
    },
    cinematic: {
      name: "Cinematic",
      instruments: [
        { preset: "strings", volume: 0.18 },
        { preset: "choir", volume: 0.14 },
        { preset: "subBass", volume: 0.2 }
      ]
    },
    lofi: {
      name: "Lo-Fi",
      instruments: [
        { preset: "epiano", volume: 0.2 },
        { preset: "warmPad", volume: 0.12 },
        { preset: "pluck", volume: 0.14 }
      ]
    },
    acidHouse: {
      name: "Acid House",
      instruments: [
        { preset: "acid", volume: 0.2 },
        { preset: "subBass", volume: 0.22 },
        { preset: "synthPad", volume: 0.1 }
      ]
    },
    minimal: {
      name: "Minimal",
      instruments: [
        { preset: "piano", volume: 0.25 },
        { preset: "bell", volume: 0.1 }
      ]
    }
  };

  /**
   * Resolve an instrument config from a preset name or raw config.
   * Merges preset defaults with overrides.
   */
  function resolveInstrument(config) {
    if (typeof config === "string") {
      const preset = INSTRUMENT_PRESETS[config];
      if (!preset) throw new Error("[FloatImgPlay] Unknown instrument preset: " + config);
      return { ...preset };
    }

    if (config.preset) {
      const preset = INSTRUMENT_PRESETS[config.preset];
      if (!preset) throw new Error("[FloatImgPlay] Unknown instrument preset: " + config.preset);
      const merged = { ...preset };
      Object.keys(config).forEach(k => {
        if (k !== "preset" && config[k] !== undefined) merged[k] = config[k];
      });
      return merged;
    }

    return config;
  }

  /**
   * Resolve an ensemble preset into an array of resolved instruments.
   */
  function resolveEnsemble(name) {
    const ensemble = ENSEMBLE_PRESETS[name];
    if (!ensemble) throw new Error("[FloatImgPlay] Unknown ensemble preset: " + name);
    return ensemble.instruments.map(resolveInstrument);
  }

  /*!
   * Float:ImgPlay v2.0.0 — Modular Architecture
   * Image-to-sound player. Scans pixel data and generates rule-based music via Web Audio API.
   * Modular architecture with Engine interface and Mode Router.
   */


  class FloatImgPlay {
    constructor(options = {}) {
      this.options = mergeDeep(this._defaults(), options);
      this._resolveInstruments();
      this.instances = new Map();
      this.audioCtx = null;
      this.globalUnlocked = false;

      this.engines = {
        midi: new MidiEngine(),
        audio: new AudioEngine(),
        image: new ImageEngine()
      };

      this._boundUnlock = this._unlockAudio.bind(this);
      this._boundOnVisibilityChange = this._onDocumentVisibilityChange.bind(this);
      this._boundTick = throttle(this._tickVisibility.bind(this), 120);
    }

    init() {
      this._bindGlobalUnlock();
      document.addEventListener("visibilitychange", this._boundOnVisibilityChange, { passive: true });
      window.addEventListener("scroll", this._boundTick, { passive: true });
      window.addEventListener("resize", this._boundTick, { passive: true });

      const nodes = Array.from(document.querySelectorAll(this.options.selector));
      nodes.forEach((el) => this.register(el));
      this._tickVisibility();
      return this;
    }

    destroy() {
      document.removeEventListener("visibilitychange", this._boundOnVisibilityChange);
      window.removeEventListener("scroll", this._boundTick);
      window.removeEventListener("resize", this._boundTick);
      this.instances.forEach((inst) => this.unregister(inst.el));
      this.instances.clear();
    }

    register(el, perElementOptions = {}) {
      if (!el || this.instances.has(el)) return;

      const opts = mergeDeep(clone(this.options), perElementOptions);
      const source = this._resolveSource(el);
      if (!source) return;

      const meta = MetaParser.parse(source);
      const engine = this._resolveEngine(source, meta);

      const inst = {
        el,
        opts,
        source,
        meta,
        engine,
        isPlaying: false,
        hasRenderedUI: false,
        isVisibleInViewport: false,
        isActuallyVisible: false,
        isDocVisible: document.visibilityState === "visible",
        pendingAutoplay: false,
        playHandle: null,
        currentScore: null,
        currentMeta: null,
        observer: null,
        ui: null,
      };

      this._buildUI(inst);
      this._prepareAnalysis(inst);
      this._bindInstanceEvents(inst);
      this._setupIntersectionObserver(inst);

      this.instances.set(el, inst);

      // Async meta parse — may upgrade engine if meta found
      MetaParser.parseAsync(source).then((asyncMeta) => {
        if (asyncMeta.midi || asyncMeta.audio || asyncMeta.engine) {
          inst.meta = asyncMeta;
          inst.engine = this._resolveEngine(source, asyncMeta);
          if (asyncMeta.engine) {
            inst.opts.audio = mergeDeep(inst.opts.audio, asyncMeta.engine);
          }
          this._prepareAnalysis(inst);
        }
      }).catch(() => {});

      if (inst.opts.autoplay) {
        inst.pendingAutoplay = true;
        this._maybeAutoplay(inst);
      }
    }

    unregister(el) {
      const inst = this.instances.get(el);
      if (!inst) return;

      this.stop(el);

      if (inst.observer) inst.observer.disconnect();

      if (inst.ui?.playBtn) inst.ui.playBtn.removeEventListener("click", inst._onPlayClick);
      if (inst.ui?.volumeInput) inst.ui.volumeInput.removeEventListener("input", inst._onVolumeInput);
      if (inst.ui?.speedInput) inst.ui.speedInput.removeEventListener("input", inst._onSpeedInput);
      if (inst.ui?.settingsBtn) inst.ui.settingsBtn.removeEventListener("click", inst._onSettingsClick);
      if (inst.el) inst.el.removeEventListener("click", inst._onElClick);

      if (inst.ui?.root && inst.ui.root.parentNode) {
        inst.ui.root.parentNode.removeChild(inst.ui.root);
      }

      this.instances.delete(el);
    }

    play(target) {
      const inst = this._getInstance(target);
      if (!inst) return;
      this._playInstance(inst);
    }

    stop(target) {
      const inst = this._getInstance(target);
      if (!inst) return;
      this._stopInstance(inst);
    }

    pause(target) {
      this.stop(target);
    }

    playAll() {
      this.instances.forEach((inst) => {
        this._playInstance(inst);
      });
      return this;
    }

    stopAll() {
      this.instances.forEach((inst) => {
        this._stopInstance(inst);
      });
      return this;
    }

    exportConfig() {
      const config = {
        version: "2.0.0",
        type: "float-imgplay-config",
        audio: { ...this.options.audio },
        instrument: null,
        ensemble: null,
        algorithm: this.options.audio.algorithm || "rgba-digit"
      };

      // Remove internal _instruments from export
      delete config.audio._instruments;

      if (this.options.ensemble) {
        config.ensemble = this.options.ensemble;
      } else if (this.options.instruments && this.options.instruments.length > 0) {
        config.instrument = this.options.instruments;
      }

      return config;
    }

    importConfig(config) {
      if (!config || config.type !== "float-imgplay-config") {
        console.warn("[Float:ImgPlay] Invalid config format");
        return this;
      }

      // Apply audio settings
      if (config.audio) {
        Object.keys(config.audio).forEach((key) => {
          if (key !== "_instruments") {
            this.options.audio[key] = config.audio[key];
          }
        });
      }

      // Apply algorithm
      if (config.algorithm) {
        this.options.audio.algorithm = config.algorithm;
      }

      // Apply instrument/ensemble
      if (config.ensemble) {
        this.options.ensemble = config.ensemble;
        this.options.instruments = null;
      } else if (config.instrument) {
        this.options.instruments = config.instrument;
        this.options.ensemble = null;
      }

      // Re-resolve instruments
      this._resolveInstruments();

      // Re-analyze all instances
      this.instances.forEach((inst) => {
        inst.opts.audio = { ...this.options.audio };
        if (this.options.audio._instruments) {
          inst.opts.audio._instruments = this.options.audio._instruments;
        }
        this._stopInstance(inst);
        inst.currentScore = null;
        inst.currentMeta = null;
        this._prepareAnalysis(inst);
      });

      return this;
    }

    refresh() {
      this.instances.forEach((inst) => {
        inst.source = this._resolveSource(inst.el) || inst.source;
        inst.meta = MetaParser.parse(inst.source);
        inst.engine = this._resolveEngine(inst.source, inst.meta);
        this._prepareAnalysis(inst);

        MetaParser.parseAsync(inst.source).then((asyncMeta) => {
          if (asyncMeta.midi || asyncMeta.audio || asyncMeta.engine) {
            inst.meta = asyncMeta;
            inst.engine = this._resolveEngine(inst.source, asyncMeta);
            if (asyncMeta.engine) {
              inst.opts.audio = mergeDeep(inst.opts.audio, asyncMeta.engine);
            }
            this._prepareAnalysis(inst);
          }
        }).catch(() => {});
      });
      this._tickVisibility();
    }

    // --- Mode Router ---

    _resolveEngine(source, meta) {
      if (this.engines.midi.canHandle(source, meta)) return this.engines.midi;
      if (this.engines.audio.canHandle(source, meta)) return this.engines.audio;
      return this.engines.image;
    }

    // --- Defaults ---

    _defaults() {
      return {
        selector: ".float-imgplay",
        autoplay: false,
        autoplayWhenVisibleOnly: true,
        stopWhenHidden: true,
        showPlayOverlay: true,
        showVolumeControl: true,
        showSpeedControl: false,
        showSettingsButton: false,
        clickToPlay: true,
        overlayIcon: "\u25B6",
        overlayPlayText: "",
        occlusionSamplePoints: [
          [0.5, 0.5],
          [0.2, 0.2],
          [0.8, 0.2],
          [0.2, 0.8],
          [0.8, 0.8]
        ],
        visibilityThreshold: 0.25,
        zIndexUI: 12,
        classNames: {
          initialized: "float-imgplay--ready",
          playing: "float-imgplay--playing",
          paused: "float-imgplay--paused",
          ui: "float-imgplay-ui",
          playBtn: "float-imgplay-play",
          volumeWrap: "float-imgplay-volume",
          volumeInput: "float-imgplay-volume-input",
          speedWrap: "float-imgplay-speed",
          speedInput: "float-imgplay-speed-input",
          settingsBtn: "float-imgplay-settings",
          settingsPopup: "float-imgplay-settings-popup"
        },
        audio: {
          algorithm: "rgba-digit",
          masterVolume: 0.25,
          pitchShiftSemitones: 0,
          waveform: "triangle",
          tempo: 100,
          noteDurationBeats: 0.5,
          restThreshold: 28,
          sampleColumns: 0, // 0 = auto (scales with image width)
          sampleRows: [0.25, 0.5, 0.75],
          filterType: "lowpass",
          filterBaseHz: 900,
          filterVelocityAmount: 3000,
          attack: 0.02,
          release: 0.03,
          scaleMode: "auto",
          rootMode: "filename-first-char",
          fixedRootMidi: 60,
          octaveContrastThreshold: 100,
          octaveShiftSemitones: 12,
          brightDuration: 0.26,
          blueDuration: 0.46,
          neutralDuration: 0.34
        },
        security: {
          allowedDomains: [],
          maxFileSize: 10485760,
          allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"]
        }
      };
    }

    // --- Instrument Resolution ---

    _resolveInstruments() {
      const opts = this.options;

      // Priority: ensemble > instruments > audio (single, backward compat)
      if (opts.ensemble) {
        try {
          opts.audio._instruments = resolveEnsemble(opts.ensemble);
        } catch {
          opts.audio._instruments = null;
        }
      } else if (opts.instruments && opts.instruments.length > 0) {
        try {
          opts.audio._instruments = opts.instruments.map(resolveInstrument);
        } catch {
          opts.audio._instruments = null;
        }
      } else {
        opts.audio._instruments = null;
      }
    }

    // --- Security ---

    _checkUrlAllowed(url) {
      const domains = this.options.security?.allowedDomains;
      if (!domains || domains.length === 0) return true;
      try {
        const parsed = new URL(url, window.location.href);
        return domains.some((d) => parsed.hostname === d || parsed.hostname.endsWith("." + d));
      } catch {
        return false;
      }
    }

    _checkMimeType(mimeType) {
      const allowed = this.options.security?.allowedMimeTypes;
      if (!allowed || allowed.length === 0) return true;
      if (!mimeType) return false;
      const normalized = mimeType.split(";")[0].trim().toLowerCase();
      return allowed.some((t) => t.toLowerCase() === normalized);
    }

    async _checkResourceSecurity(url) {
      const maxSize = this.options.security?.maxFileSize;
      const allowedMimes = this.options.security?.allowedMimeTypes;
      if ((!maxSize || maxSize <= 0) && (!allowedMimes || allowedMimes.length === 0)) return true;

      try {
        const res = await fetch(url, { method: "HEAD", mode: "cors" });
        if (!res.ok) return true; // let the actual fetch handle the error

        if (maxSize && maxSize > 0) {
          const contentLength = res.headers.get("content-length");
          if (contentLength && Number(contentLength) > maxSize) {
            console.warn("[Float:ImgPlay] File exceeds maxFileSize (" + maxSize + " bytes):", url);
            return false;
          }
        }

        if (allowedMimes && allowedMimes.length > 0) {
          const contentType = res.headers.get("content-type");
          if (contentType && !this._checkMimeType(contentType)) {
            console.warn("[Float:ImgPlay] MIME type not allowed (" + contentType + "):", url);
            return false;
          }
        }

        return true;
      } catch {
        return true; // allow if HEAD fails (CORS, etc.)
      }
    }

    // --- Audio Context ---

    _bindGlobalUnlock() {
      ["pointerdown", "touchstart", "click", "keydown"].forEach((evt) => {
        window.addEventListener(evt, this._boundUnlock, { passive: true, once: false });
      });
    }

    async _unlockAudio() {
      try {
        const ctx = this._ensureAudioContext();
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        this.globalUnlocked = true;
        this.instances.forEach((inst) => {
          if (inst.pendingAutoplay) this._maybeAutoplay(inst);
        });
      } catch (err) {
        console.warn("[Float:ImgPlay] Audio unlock failed:", err);
      }
    }

    _ensureAudioContext() {
      if (!this.audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AC();
      }
      return this.audioCtx;
    }

    // --- Source Resolution ---

    _resolveSource(el) {
      if (!el) return null;

      if (el.tagName === "IMG" && el.currentSrc || el.tagName === "IMG" && el.src) {
        const src = el.currentSrc || el.src;
        if (!this._checkUrlAllowed(src)) {
          console.warn("[Float:ImgPlay] URL blocked by allowedDomains:", src);
          return null;
        }
        return { type: "img", url: src, fileName: fileNameFromUrl(src), imgEl: el };
      }

      const childImg = el.querySelector("img");
      if (childImg && (childImg.currentSrc || childImg.src)) {
        const src = childImg.currentSrc || childImg.src;
        if (!this._checkUrlAllowed(src)) {
          console.warn("[Float:ImgPlay] URL blocked by allowedDomains:", src);
          return null;
        }
        return { type: "img-child", url: src, fileName: fileNameFromUrl(src), imgEl: childImg };
      }

      const bg = getComputedStyle(el).backgroundImage;
      const url = extractCssUrl(bg);
      if (url) {
        if (!this._checkUrlAllowed(url)) {
          console.warn("[Float:ImgPlay] URL blocked by allowedDomains:", url);
          return null;
        }
        return { type: "background", url, fileName: fileNameFromUrl(url), imgEl: null };
      }

      return null;
    }

    // --- Analysis (delegates to engine) ---

    async _prepareAnalysis(inst) {
      try {
        const securityOk = await this._checkResourceSecurity(inst.source.url);
        if (!securityOk) return;
        const { score, meta } = await inst.engine.analyze(inst.source, inst.opts.audio);
        inst.currentScore = score;
        inst.currentMeta = meta;
      } catch (err) {
        console.warn("[Float:ImgPlay] analyze failed:", err);
      }
    }

    // --- Play / Stop (delegates to engine) ---

    async _playInstance(inst) {
      if (!inst.currentScore || !inst.currentMeta) {
        try {
          const result = await inst.engine.analyze(inst.source, inst.opts.audio);
          inst.currentScore = result.score;
          inst.currentMeta = result.meta;
        } catch {
          return;
        }
      }

      const ctx = this._ensureAudioContext();
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }

      if (inst.opts.autoplayWhenVisibleOnly && !this._canPlayNow(inst)) {
        inst.pendingAutoplay = true;
        return;
      }

      // MidiEngine: fetch/parse MIDI before play
      if (inst.engine instanceof MidiEngine && inst.meta?.midi && !inst.currentScore?.notes) {
        try {
          let parsed;
          if (inst.meta.midi.data) {
            parsed = MidiEngine.parseBase64(inst.meta.midi.data);
          } else if (inst.meta.midi.url) {
            if (!this._checkUrlAllowed(inst.meta.midi.url)) {
              console.warn("[Float:ImgPlay] MIDI URL blocked by allowedDomains:", inst.meta.midi.url);
              return;
            }
            const midiSecure = await this._checkResourceSecurity(inst.meta.midi.url);
            if (!midiSecure) return;
            parsed = await MidiEngine.fetchAndParse(inst.meta.midi.url);
          }
          if (parsed) inst.currentScore = parsed;
        } catch (err) {
          console.warn("[Float:ImgPlay] MIDI parse failed:", err);
          return;
        }
      }

      // AudioEngine: fetch and decode audio buffer before play
      if (inst.engine instanceof AudioEngine && inst.meta?.audio?.url && !inst.currentScore?.audioBuffer) {
        try {
          if (!this._checkUrlAllowed(inst.meta.audio.url)) {
            console.warn("[Float:ImgPlay] Audio URL blocked by allowedDomains:", inst.meta.audio.url);
            return;
          }
          const audioSecure = await this._checkResourceSecurity(inst.meta.audio.url);
          if (!audioSecure) return;
          const audioBuffer = await AudioEngine.fetchAndDecode(inst.meta.audio.url, ctx);
          inst.currentScore = { audioBuffer, audioUrl: inst.meta.audio.url };
        } catch (err) {
          console.warn("[Float:ImgPlay] Audio fetch failed:", err);
          return;
        }
      }

      this._stopInstance(inst);

      const handle = inst.engine.play(inst.currentScore, ctx, inst.opts.audio);
      inst.playHandle = handle;

      const timerId = window.setTimeout(() => {
        inst.isPlaying = false;
        inst.el.classList.remove(inst.opts.classNames.playing);
        inst.el.classList.add(inst.opts.classNames.paused);
        if (inst.ui?.playBtn) this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
      }, handle.totalDuration * 1000 + 50);

      if (!handle.timers) handle.timers = [];
      handle.timers.push(timerId);

      inst.isPlaying = true;
      inst.pendingAutoplay = false;
      inst.el.classList.add(inst.opts.classNames.playing);
      inst.el.classList.remove(inst.opts.classNames.paused);

      if (inst.ui?.playBtn) {
        this._setPauseBtnContent(inst.ui.playBtn);
      }
    }

    _stopInstance(inst) {
      if (inst.playHandle) {
        inst.engine.stop(inst.playHandle);
        inst.playHandle = null;
      }

      inst.isPlaying = false;
      inst.el.classList.remove(inst.opts.classNames.playing);
      inst.el.classList.add(inst.opts.classNames.paused);

      if (inst.ui?.playBtn) {
        this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
      }
    }

    // --- UI ---

    _buildUI(inst) {
      if (inst.hasRenderedUI) return;

      const { classNames, showPlayOverlay, showVolumeControl, showSpeedControl, showSettingsButton, overlayIcon, overlayPlayText, zIndexUI, audio } = inst.opts;
      const el = inst.el;

      const currentPosition = getComputedStyle(el).position;
      if (currentPosition === "static") {
        el.style.position = "relative";
      }
      el.style.overflow = el.style.overflow || "hidden";

      const uiRoot = document.createElement("div");
      uiRoot.className = classNames.ui;
      Object.assign(uiRoot.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: String(zIndexUI)
      });

      let playBtn = null;
      if (showPlayOverlay) {
        playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = classNames.playBtn;
        playBtn.setAttribute("aria-label", "Play image audio");
        this._setPlayBtnContent(playBtn, overlayIcon, overlayPlayText);
        Object.assign(playBtn.style, {
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "auto",
          border: "0",
          borderRadius: "999px",
          padding: "12px 16px",
          fontSize: "18px",
          lineHeight: "1",
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          backdropFilter: "blur(10px)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "56px",
          minHeight: "56px"
        });
        uiRoot.appendChild(playBtn);
      }

      let volumeWrap = null;
      let volumeInput = null;
      if (showVolumeControl) {
        volumeWrap = document.createElement("div");
        volumeWrap.className = classNames.volumeWrap;
        Object.assign(volumeWrap.style, {
          position: "absolute",
          right: "6px",
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "auto",
          background: "rgba(0,0,0,0.48)",
          color: "#fff",
          padding: "8px 10px",
          borderRadius: "14px",
          backdropFilter: "blur(8px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px"
        });

        volumeInput = document.createElement("input");
        volumeInput.type = "range";
        volumeInput.min = "0";
        volumeInput.max = "1";
        volumeInput.step = "0.01";
        volumeInput.value = String(audio.masterVolume);
        volumeInput.className = classNames.volumeInput;
        volumeInput.setAttribute("orient", "vertical");
        Object.assign(volumeInput.style, {
          writingMode: "vertical-lr",
          direction: "rtl",
          width: "20px",
          height: "70px",
          appearance: "slider-vertical",
          WebkitAppearance: "slider-vertical"
        });

        const label = document.createElement("span");
        label.textContent = "\u{1F50A}";
        label.style.fontSize = "11px";

        volumeWrap.appendChild(volumeInput);
        volumeWrap.appendChild(label);
        uiRoot.appendChild(volumeWrap);
      }

      let speedWrap = null;
      let speedInput = null;
      let speedLabel = null;
      if (showSpeedControl) {
        speedWrap = document.createElement("div");
        speedWrap.className = classNames.speedWrap;
        Object.assign(speedWrap.style, {
          position: "absolute",
          left: "8px",
          bottom: "8px",
          pointerEvents: "auto",
          background: "rgba(0,0,0,0.48)",
          color: "#fff",
          padding: "8px 10px",
          borderRadius: "14px",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: "6px"
        });

        const turtleSpan = document.createElement("span");
        turtleSpan.textContent = "\u{1F422}";

        speedInput = document.createElement("input");
        speedInput.type = "range";
        speedInput.min = "40";
        speedInput.max = "240";
        speedInput.step = "1";
        speedInput.value = String(audio.tempo);
        speedInput.className = classNames.speedInput;
        speedInput.style.width = "70px";

        const rabbitSpan = document.createElement("span");
        rabbitSpan.textContent = "\u{1F407}";

        speedLabel = document.createElement("span");
        speedLabel.textContent = String(audio.tempo);

        speedWrap.appendChild(turtleSpan);
        speedWrap.appendChild(speedInput);
        speedWrap.appendChild(rabbitSpan);
        speedWrap.appendChild(speedLabel);
        uiRoot.appendChild(speedWrap);
      }

      let settingsBtn = null;
      let settingsPopupEl = null;
      if (showSettingsButton) {
        settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.className = classNames.settingsBtn;
        settingsBtn.setAttribute("aria-label", "Settings");
        settingsBtn.textContent = "\u2699";
        Object.assign(settingsBtn.style, {
          position: "absolute",
          top: "8px",
          left: "8px",
          pointerEvents: "auto",
          border: "0",
          borderRadius: "50%",
          width: "32px",
          height: "32px",
          fontSize: "16px",
          lineHeight: "1",
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          backdropFilter: "blur(10px)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        });
        uiRoot.appendChild(settingsBtn);

        settingsPopupEl = this._buildSettingsPopup(inst);
        uiRoot.appendChild(settingsPopupEl);
      }

      el.classList.add(classNames.initialized);
      el.appendChild(uiRoot);

      inst.ui = { root: uiRoot, playBtn, volumeWrap, volumeInput, speedWrap, speedInput, speedLabel, settingsBtn, settingsPopup: settingsPopupEl };
      inst.hasRenderedUI = true;
    }

    _setPlayBtnContent(btn, icon, playText) {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      const iconSpan = document.createElement("span");
      iconSpan.textContent = icon;
      btn.appendChild(iconSpan);
      if (playText) {
        const textSpan = document.createElement("span");
        textSpan.style.marginLeft = "8px";
        textSpan.textContent = playText;
        btn.appendChild(textSpan);
      }
    }

    _setPauseBtnContent(btn) {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      const iconSpan = document.createElement("span");
      iconSpan.textContent = "\u275A\u275A";
      btn.appendChild(iconSpan);
    }

    _buildSettingsPopup(inst) {
      const { classNames } = inst.opts;
      const popup = document.createElement("div");
      popup.className = classNames.settingsPopup;
      Object.assign(popup.style, {
        position: "absolute",
        inset: "0",
        background: "rgba(0,0,0,0.88)",
        backdropFilter: "blur(12px)",
        overflowY: "auto",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: String(inst.opts.zIndexUI + 10),
        fontSize: "11px",
        color: "#fff"
      });

      // --- Header row ---
      const header = document.createElement("div");
      Object.assign(header.style, { display: "flex", justifyContent: "space-between", alignItems: "center" });
      const title = document.createElement("span");
      title.textContent = "Settings";
      title.style.fontWeight = "bold";
      title.style.fontSize = "13px";
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "\u2715";
      Object.assign(closeBtn.style, {
        background: "none", border: "0", color: "#fff", fontSize: "14px", cursor: "pointer", padding: "4px"
      });
      header.appendChild(title);
      header.appendChild(closeBtn);
      popup.appendChild(header);

      // --- State ---
      let selectedInstrument = null;
      let selectedEnsemble = null;
      let selectedAlgorithm = inst.opts.audio.algorithm || "rgba-digit";

      const pillStyle = {
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "3px 8px",
        fontSize: "10px",
        color: "#fff",
        cursor: "pointer"
      };
      const activePillStyle = {
        background: "rgba(108,92,231,0.5)",
        border: "1px solid #6c5ce7"
      };

      const algoPills = [];

      function highlightPills() {
        instrPills.forEach((p) => {
          if ((selectedInstrument === null && p._presetKey === "none") || p._presetKey === selectedInstrument) {
            Object.assign(p.style, activePillStyle);
          } else {
            p.style.background = "rgba(255,255,255,0.08)";
            p.style.border = "1px solid rgba(255,255,255,0.2)";
          }
        });
        ensemblePills.forEach((p) => {
          if (p._presetKey === selectedEnsemble) {
            Object.assign(p.style, activePillStyle);
          } else {
            p.style.background = "rgba(255,255,255,0.08)";
            p.style.border = "1px solid rgba(255,255,255,0.2)";
          }
        });
        algoPills.forEach((p) => {
          if (p._presetKey === selectedAlgorithm) {
            Object.assign(p.style, activePillStyle);
          } else {
            p.style.background = "rgba(255,255,255,0.08)";
            p.style.border = "1px solid rgba(255,255,255,0.2)";
          }
        });
      }

      // --- Instruments section ---
      const instrTitle = document.createElement("div");
      instrTitle.textContent = "Instruments";
      instrTitle.style.fontWeight = "bold";
      popup.appendChild(instrTitle);

      const instrGrid = document.createElement("div");
      Object.assign(instrGrid.style, { display: "flex", flexWrap: "wrap", gap: "4px" });

      const instrPills = [];

      // "none" / Default pill
      const nonePill = document.createElement("button");
      nonePill.type = "button";
      nonePill.textContent = "Default";
      nonePill._presetKey = "none";
      Object.assign(nonePill.style, pillStyle);
      nonePill.addEventListener("click", () => {
        selectedInstrument = null;
        selectedEnsemble = null;
        highlightPills();
      });
      instrPills.push(nonePill);
      instrGrid.appendChild(nonePill);

      Object.keys(INSTRUMENT_PRESETS).forEach((key) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.textContent = INSTRUMENT_PRESETS[key].name;
        pill._presetKey = key;
        Object.assign(pill.style, pillStyle);
        pill.addEventListener("click", () => {
          selectedInstrument = key;
          selectedEnsemble = null;
          highlightPills();
        });
        instrPills.push(pill);
        instrGrid.appendChild(pill);
      });
      popup.appendChild(instrGrid);

      // --- Ensembles section ---
      const ensTitle = document.createElement("div");
      ensTitle.textContent = "Ensembles";
      ensTitle.style.fontWeight = "bold";
      popup.appendChild(ensTitle);

      const ensGrid = document.createElement("div");
      Object.assign(ensGrid.style, { display: "flex", flexWrap: "wrap", gap: "4px" });

      const ensemblePills = [];
      Object.keys(ENSEMBLE_PRESETS).forEach((key) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.textContent = ENSEMBLE_PRESETS[key].name;
        pill._presetKey = key;
        Object.assign(pill.style, pillStyle);
        pill.addEventListener("click", () => {
          selectedEnsemble = key;
          selectedInstrument = null;
          highlightPills();
        });
        ensemblePills.push(pill);
        ensGrid.appendChild(pill);
      });
      popup.appendChild(ensGrid);

      // --- Algorithms section ---
      const algoTitle = document.createElement("div");
      algoTitle.textContent = "Algorithm";
      algoTitle.style.fontWeight = "bold";
      popup.appendChild(algoTitle);

      const algoGrid = document.createElement("div");
      Object.assign(algoGrid.style, { display: "flex", flexWrap: "wrap", gap: "4px" });

      Object.keys(ALGORITHMS).forEach((key) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.textContent = ALGORITHMS[key].name;
        pill._presetKey = key;
        Object.assign(pill.style, pillStyle);
        pill.addEventListener("click", () => {
          selectedAlgorithm = key;
          highlightPills();
        });
        algoPills.push(pill);
        algoGrid.appendChild(pill);
      });
      popup.appendChild(algoGrid);

      // --- Advanced toggle ---
      const advToggle = document.createElement("button");
      advToggle.type = "button";
      advToggle.textContent = "\u25B8 Advanced";
      Object.assign(advToggle.style, {
        background: "none", border: "0", color: "#fff", fontSize: "11px", cursor: "pointer",
        padding: "4px 0", textAlign: "left"
      });
      popup.appendChild(advToggle);

      // --- Advanced panel ---
      const advPanel = document.createElement("div");
      Object.assign(advPanel.style, { display: "none", flexDirection: "column", gap: "4px" });

      advToggle.addEventListener("click", () => {
        if (advPanel.style.display === "none") {
          advPanel.style.display = "flex";
          advToggle.textContent = "\u25BE Advanced";
        } else {
          advPanel.style.display = "none";
          advToggle.textContent = "\u25B8 Advanced";
        }
      });

      const selectStyle = { background: "#252542", border: "1px solid #3a3a5a", color: "#fff", fontSize: "10px", borderRadius: "4px", padding: "2px 4px" };

      const advInputs = {};

      const advOptions = [
        { key: "waveform", label: "Waveform", type: "select", options: ["sine", "square", "sawtooth", "triangle"] },
        { key: "tempo", label: "Tempo", type: "range", min: 40, max: 240, step: 1 },
        { key: "masterVolume", label: "Volume", type: "range", min: 0, max: 1, step: 0.01 },
        { key: "scaleMode", label: "Scale", type: "select", options: ["auto", "major", "minor", "pentatonic", "blues", "chromatic", "dorian", "mixolydian"] },
        { key: "rootMode", label: "Root Mode", type: "select", options: ["filename-first-char", "fixed", "auto"] },
        { key: "fixedRootMidi", label: "Root MIDI", type: "range", min: 36, max: 84, step: 1 },
        { key: "pitchShiftSemitones", label: "Pitch Shift", type: "range", min: -24, max: 24, step: 1 },
        { key: "filterType", label: "Filter", type: "select", options: ["lowpass", "highpass", "bandpass", "notch"] },
        { key: "filterBaseHz", label: "Filter Hz", type: "range", min: 100, max: 8000, step: 1 },
        { key: "filterVelocityAmount", label: "Filter Vel", type: "range", min: 0, max: 8000, step: 1 },
        { key: "attack", label: "Attack", type: "range", min: 0.001, max: 0.5, step: 0.001 },
        { key: "release", label: "Release", type: "range", min: 0.001, max: 0.5, step: 0.001 },
        { key: "noteDurationBeats", label: "Note Dur", type: "range", min: 0.1, max: 2, step: 0.05 },
        { key: "sampleColumns", label: "Columns", type: "range", min: 0, max: 256, step: 1 },
        { key: "restThreshold", label: "Rest Thresh", type: "range", min: 0, max: 128, step: 1 },
        { key: "brightDuration", label: "Bright Dur", type: "range", min: 0.05, max: 1, step: 0.01 },
        { key: "blueDuration", label: "Blue Dur", type: "range", min: 0.05, max: 1, step: 0.01 },
        { key: "neutralDuration", label: "Neutral Dur", type: "range", min: 0.05, max: 1, step: 0.01 }
      ];

      advOptions.forEach((opt) => {
        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", alignItems: "center", gap: "6px" });

        const lbl = document.createElement("label");
        lbl.textContent = opt.label;
        lbl.style.minWidth = "70px";
        lbl.style.fontSize = "10px";
        row.appendChild(lbl);

        const currentVal = inst.opts.audio[opt.key];

        if (opt.type === "range") {
          const input = document.createElement("input");
          input.type = "range";
          input.min = String(opt.min);
          input.max = String(opt.max);
          input.step = String(opt.step);
          input.value = String(currentVal);
          input.style.flex = "1";
          input.style.height = "14px";
          row.appendChild(input);

          const valSpan = document.createElement("span");
          valSpan.textContent = String(currentVal);
          valSpan.style.minWidth = "32px";
          valSpan.style.fontSize = "10px";
          valSpan.style.textAlign = "right";
          row.appendChild(valSpan);

          input.addEventListener("input", () => {
            valSpan.textContent = input.value;
          });

          advInputs[opt.key] = input;
        } else if (opt.type === "select") {
          const sel = document.createElement("select");
          Object.assign(sel.style, selectStyle);
          sel.style.flex = "1";
          opt.options.forEach((o) => {
            const optEl = document.createElement("option");
            optEl.value = o;
            optEl.textContent = o;
            if (o === String(currentVal)) optEl.selected = true;
            sel.appendChild(optEl);
          });
          row.appendChild(sel);
          advInputs[opt.key] = sel;
        }

        advPanel.appendChild(row);
      });

      popup.appendChild(advPanel);

      // --- Button row ---
      const btnRow = document.createElement("div");
      Object.assign(btnRow.style, { display: "flex", gap: "6px", marginTop: "4px" });

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.textContent = "Apply";
      Object.assign(applyBtn.style, {
        flex: "1", padding: "6px", border: "0", borderRadius: "6px",
        background: "#6c5ce7", color: "#fff", fontSize: "11px", cursor: "pointer"
      });

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.textContent = "Reset";
      Object.assign(resetBtn.style, {
        flex: "1", padding: "6px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px",
        background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: "11px", cursor: "pointer"
      });

      btnRow.appendChild(applyBtn);
      btnRow.appendChild(resetBtn);
      popup.appendChild(btnRow);

      // --- Event wiring ---
      closeBtn.addEventListener("click", () => { popup.style.display = "none"; });

      applyBtn.addEventListener("click", () => {
        this._applySettingsToInstance(inst, selectedInstrument, selectedEnsemble, advInputs, selectedAlgorithm);
        popup.style.display = "none";
      });

      resetBtn.addEventListener("click", () => {
        selectedInstrument = null;
        selectedEnsemble = null;
        selectedAlgorithm = "rgba-digit";
        highlightPills();
        const defaults = this._defaults().audio;
        Object.keys(advInputs).forEach((key) => {
          const el = advInputs[key];
          if (defaults[key] !== undefined) {
            el.value = String(defaults[key]);
            // Update value display for range inputs
            if (el.type === "range") {
              const valSpan = el.parentElement.querySelector("span");
              if (valSpan) valSpan.textContent = String(defaults[key]);
            }
          }
        });
      });

      // Initial highlight
      highlightPills();

      popup.style.display = "none";
      return popup;
    }

    _applySettingsToInstance(inst, instrumentName, ensembleName, advInputs, algorithmName) {
      // Read advanced values
      Object.keys(advInputs).forEach((key) => {
        const el = advInputs[key];
        const val = el.value;
        if (el.type === "range") {
          inst.opts.audio[key] = Number(val);
        } else {
          inst.opts.audio[key] = val;
        }
      });

      // Apply algorithm
      if (algorithmName) {
        inst.opts.audio.algorithm = algorithmName;
      }

      // Resolve instrument/ensemble
      if (ensembleName) {
        try {
          inst.opts.audio._instruments = resolveEnsemble(ensembleName);
        } catch { inst.opts.audio._instruments = null; }
      } else if (instrumentName) {
        try {
          inst.opts.audio._instruments = [resolveInstrument(instrumentName)];
        } catch { inst.opts.audio._instruments = null; }
      } else {
        inst.opts.audio._instruments = null;
      }

      // Re-analyze and stop current playback
      this._stopInstance(inst);
      inst.currentScore = null;
      inst.currentMeta = null;
      this._prepareAnalysis(inst);

      // Sync speed/volume sliders if present
      if (inst.ui?.speedInput) {
        inst.ui.speedInput.value = String(inst.opts.audio.tempo);
        if (inst.ui.speedLabel) inst.ui.speedLabel.textContent = inst.opts.audio.tempo + "";
      }
      if (inst.ui?.volumeInput) {
        inst.ui.volumeInput.value = String(inst.opts.audio.masterVolume);
      }
    }

    // --- Events ---

    _bindInstanceEvents(inst) {
      inst._onPlayClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inst.isPlaying) {
          this._stopInstance(inst);
        } else {
          this._playInstance(inst);
        }
      };

      inst._onElClick = (e) => {
        if (inst.ui?.volumeInput && (e.target === inst.ui.volumeInput || inst.ui.volumeWrap?.contains(e.target))) {
          return;
        }
        if (inst.ui?.speedInput && (e.target === inst.ui.speedInput || inst.ui.speedWrap?.contains(e.target))) {
          return;
        }
        if (inst.ui?.settingsBtn && (e.target === inst.ui.settingsBtn || inst.ui.settingsPopup?.contains(e.target))) {
          return;
        }
        if (inst.opts.clickToPlay === false) {
          return;
        }
        if (!inst.ui?.playBtn) {
          if (inst.isPlaying) this._stopInstance(inst);
          else this._playInstance(inst);
        }
      };

      inst._onVolumeInput = (e) => {
        const v = Number(e.target.value);
        inst.opts.audio.masterVolume = v;
      };

      inst._onSpeedInput = (e) => {
        const bpm = Number(e.target.value);
        inst.opts.audio.tempo = bpm;
        if (inst.ui?.speedLabel) inst.ui.speedLabel.textContent = bpm + "";
        if (inst.isPlaying) {
          this._stopInstance(inst);
          inst.currentScore = null;
          this._prepareAnalysis(inst);
          this._playInstance(inst);
        }
      };

      if (inst.ui?.playBtn) inst.ui.playBtn.addEventListener("click", inst._onPlayClick);
      if (inst.ui?.volumeInput) inst.ui.volumeInput.addEventListener("input", inst._onVolumeInput);
      if (inst.ui?.speedInput) inst.ui.speedInput.addEventListener("input", inst._onSpeedInput);

      if (inst.ui?.settingsBtn) {
        inst._onSettingsClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (inst.ui.settingsPopup) {
            inst.ui.settingsPopup.style.display = inst.ui.settingsPopup.style.display === "none" ? "flex" : "none";
          }
        };
        inst.ui.settingsBtn.addEventListener("click", inst._onSettingsClick);
      }

      inst.el.addEventListener("click", inst._onElClick);
    }

    // --- Visibility ---

    _setupIntersectionObserver(inst) {
      if (!("IntersectionObserver" in window)) {
        inst.isVisibleInViewport = true;
        return;
      }

      inst.observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        inst.isVisibleInViewport = !!entry && entry.isIntersecting && entry.intersectionRatio >= inst.opts.visibilityThreshold;
        this._tickSingle(inst);
      }, {
        root: null,
        threshold: [0, inst.opts.visibilityThreshold, 0.5, 0.75, 1]
      });

      inst.observer.observe(inst.el);
    }

    _onDocumentVisibilityChange() {
      this.instances.forEach((inst) => {
        inst.isDocVisible = document.visibilityState === "visible";
        if (inst.opts.stopWhenHidden && !inst.isDocVisible) {
          this._stopInstance(inst);
        } else {
          this._tickSingle(inst);
        }
      });
    }

    _tickVisibility() {
      this.instances.forEach((inst) => this._tickSingle(inst));
    }

    _tickSingle(inst) {
      inst.isActuallyVisible = this._isActuallyVisible(inst);

      if (inst.opts.stopWhenHidden && inst.isPlaying && !inst.isActuallyVisible) {
        this._stopInstance(inst);
      }

      if (inst.pendingAutoplay) {
        this._maybeAutoplay(inst);
      }
    }

    _maybeAutoplay(inst) {
      if (!inst.opts.autoplay) return;
      if (!this.globalUnlocked) return;
      if (!this._canPlayNow(inst)) return;
      this._playInstance(inst);
    }

    _canPlayNow(inst) {
      if (!inst.isDocVisible && inst.opts.stopWhenHidden) return false;
      if (inst.opts.autoplayWhenVisibleOnly && !inst.isActuallyVisible) return false;
      return true;
    }

    _isActuallyVisible(inst) {
      const el = inst.el;
      if (!el || !document.documentElement.contains(el)) return false;

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (document.visibilityState !== "visible") return false;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      if (!inst.isVisibleInViewport) return false;

      return this._isTopMostEnough(el, rect, inst.opts.occlusionSamplePoints);
    }

    _isTopMostEnough(el, rect, samplePoints) {
      let visibleHits = 0;
      let total = 0;

      for (const [rx, ry] of samplePoints) {
        const x = rect.left + rect.width * rx;
        const y = rect.top + rect.height * ry;

        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        total++;

        const top = document.elementFromPoint(x, y);
        if (!top) continue;

        if (top === el || el.contains(top) || top.contains(el)) {
          visibleHits++;
        }
      }

      if (total === 0) return false;
      return (visibleHits / total) >= 0.4;
    }

    // --- Instance lookup ---

    _getInstance(target) {
      if (!target) return null;
      if (this.instances.has(target)) return this.instances.get(target);
      if (typeof target === "string") {
        const el = document.querySelector(target);
        return el ? this.instances.get(el) : null;
      }
      return null;
    }

    // --- Static: Config Export/Import ---

    static downloadConfig(config, filename = "imgplay-preset.json") {
      const json = JSON.stringify(config, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    static loadConfigFromFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const config = JSON.parse(e.target.result);
            resolve(config);
          } catch (err) {
            reject(new Error("[Float:ImgPlay] Invalid JSON: " + err.message));
          }
        };
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }
  }

  exports.ALGORITHMS = ALGORITHMS;
  exports.AudioEngine = AudioEngine;
  exports.ENSEMBLE_PRESETS = ENSEMBLE_PRESETS;
  exports.FloatImgPlay = FloatImgPlay;
  exports.INSTRUMENT_PRESETS = INSTRUMENT_PRESETS;
  exports.ImageEngine = ImageEngine;
  exports.MetaEmbed = MetaEmbed;
  exports.MetaParser = MetaParser;
  exports.MidiEngine = MidiEngine;
  exports.MidiExport = MidiExport;
  exports.default = FloatImgPlay;
  exports.getAlgorithm = getAlgorithm;
  exports.registerAlgorithm = registerAlgorithm;
  exports.resolveEnsemble = resolveEnsemble;
  exports.resolveInstrument = resolveInstrument;

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;

})({});
