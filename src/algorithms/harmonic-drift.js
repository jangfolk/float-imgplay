import { clamp, beatsToSeconds, midiToFreq } from "../utils/helpers.js";

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
export function harmonicDrift(columns, audioOpts, meta) {
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
