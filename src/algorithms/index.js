import { rgbaDigit } from "./rgba-digit.js";
import { brightnessLinear } from "./brightness-linear.js";
import { colorHarmony } from "./color-harmony.js";
import { spectral } from "./spectral.js";
import { contour } from "./contour.js";
import { harmonicDrift } from "./harmonic-drift.js";
import { colorPitch } from "./color-pitch.js";

export const ALGORITHMS = {
  "rgba-digit": { name: "RGBA Digit", fn: rgbaDigit, description: "RGB channel digits → pitch, rhythm, chords" },
  "brightness-linear": { name: "Brightness Linear", fn: brightnessLinear, description: "Brightness → pitch, color → duration" },
  "color-harmony": { name: "Color Harmony", fn: colorHarmony, description: "HSL hue → scale degree, saturation → velocity" },
  "spectral": { name: "Spectral", fn: spectral, description: "Y-axis as frequency spectrum" },
  "contour": { name: "Contour", fn: contour, description: "Follow brightness gradients for melody" },
  "harmonic-drift": { name: "Harmonic Drift", fn: harmonicDrift, description: "Digit-based note hold/change with diatonic chord tones" },
  "color-pitch": { name: "Color Pitch", fn: colorPitch, description: "Color→pitch, brightness→duration (staccato~sustain)" }
};

export function getAlgorithm(name) {
  return ALGORITHMS[name] || ALGORITHMS["rgba-digit"];
}

export function registerAlgorithm(name, fn, displayName, description) {
  ALGORITHMS[name] = { name: displayName || name, fn, description: description || "" };
}
