import { clamp, beatsToSeconds, midiToFreq } from "../utils/helpers.js";

export function brightnessLinear(columns, audioOpts, meta) {
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
