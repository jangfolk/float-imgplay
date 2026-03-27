import { clamp, beatsToSeconds, midiToFreq } from "../utils/helpers.js";

export function spectral(columns, audioOpts, meta) {
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
