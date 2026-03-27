import {
  clamp, beatsToSeconds, midiToFreq, charToKey,
  averageRGB, getScale
} from "../utils/helpers.js";
import { getAlgorithm } from "../algorithms/index.js";

export class ImageEngine {
  canHandle(source, meta) {
    return true;
  }

  async analyze(source, audioOpts) {
    const img = await this._loadImage(source.url);

    // Multi-instrument mode
    if (audioOpts._instruments && audioOpts._instruments.length > 0) {
      return this._analyzeMultiLayer(img, source.fileName, audioOpts);
    }

    return this._analyzeImage(img, source.fileName, audioOpts);
  }

  _analyzeMultiLayer(img, fileName, audioOpts) {
    const layers = [];

    for (const inst of audioOpts._instruments) {
      // Merge instrument settings into audioOpts for each layer analysis
      const layerOpts = {
        ...audioOpts,
        sampleRows: inst.sampleRows || audioOpts.sampleRows,
        pitchShiftSemitones: (audioOpts.pitchShiftSemitones || 0) + (inst.octaveShift || 0) * 12
      };

      const result = this._analyzeImage(img, fileName, layerOpts);

      layers.push({
        instrument: inst,
        notes: result.score
      });
    }

    // Use the meta from first layer
    const firstResult = this._analyzeImage(img, fileName, audioOpts);

    return {
      meta: firstResult.meta,
      score: { layers }
    };
  }

  play(score, audioCtx, audioOpts) {
    // Multi-layer score: { layers: [ { instrument, notes }, ... ] }
    // Single-layer score: plain array of notes (backward compatible)
    if (score && score.layers) {
      return this._playMultiLayer(score, audioCtx, audioOpts);
    }
    return this._playSingleLayer(score, audioCtx, audioOpts);
  }

  _playSingleLayer(notes, audioCtx, audioOpts, instOverride) {
    const now = audioCtx.currentTime + 0.03;
    let t = now;
    const allNodes = [];

    const wf = (instOverride && instOverride.waveform) || audioOpts.waveform;
    const ft = (instOverride && instOverride.filterType) || audioOpts.filterType;
    const fb = (instOverride && instOverride.filterBaseHz) || audioOpts.filterBaseHz;
    const fv = (instOverride && instOverride.filterVelocityAmount) || audioOpts.filterVelocityAmount;
    const att = (instOverride && instOverride.attack) || audioOpts.attack;
    const rel = (instOverride && instOverride.release) || audioOpts.release;
    const vol = (instOverride && instOverride.volume) || audioOpts.masterVolume;

    let i = 0;
    while (i < notes.length) {
      const primary = notes[i];
      const primaryDur = primary.durationSeconds;

      const group = [primary];
      let j = i + 1;
      while (j < notes.length) {
        const candidate = notes[j];
        if (!primary.isRest && !candidate.isRest &&
            candidate.durationSeconds < primaryDur &&
            candidate.velocity < primary.velocity) {
          group.push(candidate);
          j++;
        } else {
          break;
        }
      }

      for (const note of group) {
        if (!note.isRest) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          const filter = audioCtx.createBiquadFilter();

          osc.type = wf;
          osc.frequency.setValueAtTime(note.freq, t);

          filter.type = ft;
          filter.frequency.setValueAtTime(fb + note.velocity * fv, t);

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0002, note.velocity * vol), t + att
          );
          gain.gain.exponentialRampToValueAtTime(
            0.0001, t + Math.max(att + 0.01, note.durationSeconds)
          );

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(audioCtx.destination);

          osc.start(t);
          osc.stop(t + note.durationSeconds + rel);

          allNodes.push(osc, gain, filter);
        }
      }

      t += primaryDur + 0.02;
      i = j;
    }

    return { nodes: allNodes, timers: [], totalDuration: Math.max(0, t - (audioCtx.currentTime + 0.03)) };
  }

  _playMultiLayer(score, audioCtx, audioOpts) {
    const allNodes = [];
    let maxDuration = 0;

    for (const layer of score.layers) {
      const result = this._playSingleLayer(layer.notes, audioCtx, audioOpts, layer.instrument);
      allNodes.push(...result.nodes);
      if (result.totalDuration > maxDuration) maxDuration = result.totalDuration;
    }

    return { nodes: allNodes, timers: [], totalDuration: maxDuration };
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

    // --- Enhanced analysis: collect raw pixel data per column ---
    const columns = [];
    for (let x = 0; x < w; x += step) {
      let rr = 0, gg = 0, bb = 0, aa = 0;

      for (const y of rows) {
        const idx = (y * w + x) * 4;
        rr += data[idx];
        gg += data[idx + 1];
        bb += data[idx + 2];
        aa += data[idx + 3];
      }

      rr = Math.round(rr / rows.length);
      gg = Math.round(gg / rows.length);
      bb = Math.round(bb / rows.length);
      aa = Math.round(aa / rows.length);

      columns.push({ r: rr, g: gg, b: bb, a: aa });
    }

    // --- Delegate to selected algorithm ---
    const algorithmName = audioOpts.algorithm || "rgba-digit";
    const algo = getAlgorithm(algorithmName);
    const notes = algo.fn(columns, audioOpts, { scale, rootMidi });

    return {
      meta: { fileName, avg, scale, rootMidi },
      score: notes
    };
  }
}
