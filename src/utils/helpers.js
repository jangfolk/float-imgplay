export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function mergeDeep(target, source) {
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

export function throttle(fn, wait) {
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

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function beatsToSeconds(beats, tempo) {
  return (60 / tempo) * beats;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function charToKey(letter) {
  const map = {
    a: 60, b: 62, c: 64, d: 65, e: 67, f: 69, g: 71,
    h: 60, i: 62, j: 64, k: 65, l: 67, m: 69, n: 71,
    o: 60, p: 62, q: 63, r: 65, s: 67, t: 68, u: 70,
    v: 72, w: 61, x: 63, y: 66, z: 68
  };
  return map[letter] ?? 60;
}

export function averageRGB(data) {
  let r = 0, g = 0, b = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: r / total, g: g / total, b: b / total };
}

export function getScale(mode, avg) {
  if (mode === "major") return [0, 2, 4, 5, 7, 9, 11, 12];
  if (mode === "minor") return [0, 2, 3, 5, 7, 8, 10, 12];
  if (mode === "pentatonic") return [0, 3, 5, 7, 10, 12];

  if (avg.r > avg.b + 20) return [0, 2, 4, 5, 7, 9, 11, 12];
  if (avg.b > avg.r + 20) return [0, 2, 3, 5, 7, 8, 10, 12];
  return [0, 3, 5, 7, 10, 12];
}

export function fileNameFromUrl(url) {
  try {
    const clean = url.split("?")[0].split("#")[0];
    return clean.substring(clean.lastIndexOf("/") + 1) || "image";
  } catch {
    return "image";
  }
}

export function extractCssUrl(bgValue) {
  if (!bgValue || bgValue === "none") return null;
  const m = bgValue.match(/url\((['"]?)(.*?)\1\)/i);
  return m ? m[2] : null;
}
