import { clamp, beatsToSeconds, midiToFreq } from "../utils/helpers.js";

export function contour(columns, audioOpts, meta) {
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
