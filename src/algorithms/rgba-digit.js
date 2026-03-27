import { clamp, beatsToSeconds, midiToFreq } from "../utils/helpers.js";

export function rgbaDigit(columns, audioOpts, meta) {
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
    const gOnes = digit(c.g, 1);         // filter cutoff variation

    // === B channel: harmony + interval ===
    const bHundreds = digit(c.b, 100);   // chord type (single/3rd/triad)
    const bTens = digit(c.b, 10);        // melodic interval jump size
    const bOnes = digit(c.b, 1);         // timing micro-offset (swing feel)

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
