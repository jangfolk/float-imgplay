import { clamp, beatsToSeconds, midiToFreq } from "../utils/helpers.js";

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

export function colorHarmony(columns, audioOpts, meta) {
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
