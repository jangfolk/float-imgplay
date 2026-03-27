import { clamp, beatsToSeconds, midiToFreq } from "../utils/helpers.js";

/**
 * Color Pitch Algorithm
 *
 * Direct, sensitive mapping:
 * - Hue (color) → pitch: 0=lowest note, 255=highest note
 * - Brightness → duration: 0=staccato tap, 255=long sustain
 * - Saturation → velocity/volume
 *
 * Like Harmonic Drift but more direct and expressive.
 * Colorful images = wide pitch range. Dark images = short staccato. Bright = long tones.
 */
export function colorPitch(columns, audioOpts, meta) {
  const { scale, rootMidi } = meta;

  // Pitch range: 3 octaves centered on root
  const LOW_MIDI = rootMidi - 12 + (audioOpts.pitchShiftSemitones || 0);
  const HIGH_MIDI = rootMidi + 24 + (audioOpts.pitchShiftSemitones || 0);
  const RANGE = HIGH_MIDI - LOW_MIDI; // 36 semitones

  // Duration range
  const baseBeat = beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo);
  const MIN_DUR = baseBeat * 0.15;  // staccato tap
  const MAX_DUR = baseBeat * 4.0;   // long sustain

  const notes = [];
  let prevMidi = -1;

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const brightness = (c.r + c.g + c.b) / 3;

    // Rest for very dark pixels
    if (brightness < audioOpts.restThreshold) {
      notes.push({
        midi: rootMidi,
        freq: midiToFreq(rootMidi),
        durationSeconds: MIN_DUR,
        velocity: 0.02,
        isRest: true
      });
      continue;
    }

    // --- Pitch from color (hue-like) ---
    // Use dominant channel to determine pitch position
    // Red=warm/low, Green=mid, Blue=cool/high, mixed=in between
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const delta = max - min;

    let hue01; // 0-1 representing color position
    if (delta < 10) {
      // Grayscale: use brightness directly
      hue01 = brightness / 255;
    } else if (max === c.r) {
      // Red dominant: low range (0 - 0.33)
      hue01 = ((c.g - c.b) / delta + 6) % 6 / 6;
    } else if (max === c.g) {
      // Green dominant: mid range (0.33 - 0.66)
      hue01 = ((c.b - c.r) / delta + 2) / 6;
    } else {
      // Blue dominant: high range (0.66 - 1.0)
      hue01 = ((c.r - c.g) / delta + 4) / 6;
    }

    // Map hue to scale note (quantized to scale for musicality)
    const scaleSemitones = Math.round(hue01 * RANGE);
    // Snap to nearest scale tone
    const octave = Math.floor(scaleSemitones / 12);
    const remainder = scaleSemitones % 12;
    let closest = scale[0];
    let closestDist = 999;
    for (const s of scale) {
      const dist = Math.abs(s - remainder);
      if (dist < closestDist) {
        closestDist = dist;
        closest = s;
      }
    }
    const midi = clamp(LOW_MIDI + octave * 12 + closest, 24, 108);

    // --- Duration from brightness ---
    // 0 = staccato, 255 = long sustain
    const durT = brightness / 255;
    // Exponential curve for more dramatic difference
    const durationSeconds = MIN_DUR + (MAX_DUR - MIN_DUR) * (durT * durT);

    // --- Velocity from saturation ---
    const saturation = delta;
    const baseVel = 0.08 + (saturation / 255) * 0.2;
    // Brightness also contributes slightly
    const brightBoost = (brightness / 255) * 0.05;
    const velocity = clamp(baseVel + brightBoost, 0.05, 0.35);

    notes.push({
      midi,
      freq: midiToFreq(midi),
      durationSeconds: Math.max(0.03, durationSeconds),
      velocity,
      isRest: false
    });

    // Add harmonic on big pitch jumps (color transitions)
    if (prevMidi >= 0 && Math.abs(midi - prevMidi) > 7 && saturation > 60) {
      // Add a quiet fifth or third
      const harmIdx = clamp(
        scale.indexOf(closest) + 2,
        0, scale.length - 1
      );
      const harmSemi = harmIdx >= 0 ? scale[harmIdx] : scale[0];
      const harmMidi = clamp(LOW_MIDI + octave * 12 + harmSemi, 24, 108);

      notes.push({
        midi: harmMidi,
        freq: midiToFreq(harmMidi),
        durationSeconds: Math.max(0.03, durationSeconds * 0.6),
        velocity: clamp(velocity * 0.4, 0.03, 0.15),
        isRest: false
      });
    }

    prevMidi = midi;
  }

  return notes;
}
