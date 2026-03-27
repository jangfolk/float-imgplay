import {
  clamp, beatsToSeconds, midiToFreq, charToKey,
  averageRGB, getScale
} from "../utils/helpers.js";

export class ImageEngine {
  canHandle(source, meta) {
    return true;
  }

  async analyze(source, audioOpts) {
    const img = await this._loadImage(source.url);
    return this._analyzeImage(img, source.fileName, audioOpts);
  }

  play(score, audioCtx, audioOpts) {
    const now = audioCtx.currentTime + 0.03;
    let t = now;
    const nodes = [];
    const timers = [];

    score.forEach((note) => {
      if (!note.isRest) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.type = audioOpts.waveform;
        osc.frequency.setValueAtTime(note.freq, t);

        filter.type = audioOpts.filterType;
        filter.frequency.setValueAtTime(
          audioOpts.filterBaseHz + note.velocity * audioOpts.filterVelocityAmount, t
        );

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(
          Math.max(0.0002, note.velocity * audioOpts.masterVolume),
          t + audioOpts.attack
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          t + Math.max(audioOpts.attack + 0.01, note.durationSeconds)
        );

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(t);
        osc.stop(t + note.durationSeconds + audioOpts.release);

        nodes.push(osc, gain, filter);
      }

      t += note.durationSeconds + 0.02;
    });

    const totalDuration = Math.max(0, t - now);
    return { nodes, timers, totalDuration };
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
    const maxSize = 64;
    let w = img.width;
    let h = img.height;

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

    const rows = (audioOpts.sampleRows || [0.25, 0.5, 0.75])
      .map(v => Math.max(0, Math.min(h - 1, Math.floor(h * v))));
    const step = Math.max(1, Math.floor(w / Math.max(1, audioOpts.sampleColumns)));
    const notes = [];

    for (let x = 0; x < w; x += step) {
      let rr = 0, gg = 0, bb = 0;

      for (const y of rows) {
        const idx = (y * w + x) * 4;
        rr += data[idx];
        gg += data[idx + 1];
        bb += data[idx + 2];
      }

      rr /= rows.length;
      gg /= rows.length;
      bb /= rows.length;

      const brightness = (rr + gg + bb) / 3;
      const saturation = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
      const contrastish = Math.abs(rr - bb);

      const scaleIndex = Math.floor((brightness / 255) * (scale.length - 1));
      const octaveShift = contrastish > audioOpts.octaveContrastThreshold
        ? audioOpts.octaveShiftSemitones : 0;
      const midi = rootMidi + scale[scaleIndex] + octaveShift + audioOpts.pitchShiftSemitones;

      let duration = audioOpts.neutralDuration;
      if (bb > rr && bb > gg) duration = audioOpts.blueDuration;
      else if (rr > bb && rr > gg) duration = audioOpts.brightDuration;

      const velocity = clamp(0.08 + (saturation / 255) * 0.22, 0.08, 0.36);
      const isRest = brightness < audioOpts.restThreshold;

      notes.push({
        midi,
        freq: midiToFreq(midi),
        durationSeconds: beatsToSeconds(audioOpts.noteDurationBeats, audioOpts.tempo)
          * (duration / audioOpts.neutralDuration),
        velocity,
        isRest
      });
    }

    return {
      meta: { fileName, avg, scale, rootMidi },
      score: notes
    };
  }
}
