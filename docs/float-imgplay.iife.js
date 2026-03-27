var FloatImgPlay = (function (exports) {
  'use strict';

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function mergeDeep(target, source) {
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

  function throttle(fn, wait) {
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

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function beatsToSeconds(beats, tempo) {
    return (60 / tempo) * beats;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function charToKey(letter) {
    const map = {
      a: 60, b: 62, c: 64, d: 65, e: 67, f: 69, g: 71,
      h: 60, i: 62, j: 64, k: 65, l: 67, m: 69, n: 71,
      o: 60, p: 62, q: 63, r: 65, s: 67, t: 68, u: 70,
      v: 72, w: 61, x: 63, y: 66, z: 68
    };
    return map[letter] ?? 60;
  }

  function averageRGB(data) {
    let r = 0, g = 0, b = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return { r: r / total, g: g / total, b: b / total };
  }

  function getScale(mode, avg) {
    if (mode === "major") return [0, 2, 4, 5, 7, 9, 11, 12];
    if (mode === "minor") return [0, 2, 3, 5, 7, 8, 10, 12];
    if (mode === "pentatonic") return [0, 3, 5, 7, 10, 12];

    if (avg.r > avg.b + 20) return [0, 2, 4, 5, 7, 9, 11, 12];
    if (avg.b > avg.r + 20) return [0, 2, 3, 5, 7, 8, 10, 12];
    return [0, 3, 5, 7, 10, 12];
  }

  function fileNameFromUrl(url) {
    try {
      const clean = url.split("?")[0].split("#")[0];
      return clean.substring(clean.lastIndexOf("/") + 1) || "image";
    } catch {
      return "image";
    }
  }

  function extractCssUrl(bgValue) {
    if (!bgValue || bgValue === "none") return null;
    const m = bgValue.match(/url\((['"]?)(.*?)\1\)/i);
    return m ? m[2] : null;
  }

  class ImageEngine {
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

      // Group notes: primary notes advance time, chord/echo notes
      // (shorter duration, lower velocity) play at the same time
      let i = 0;
      while (i < score.length) {
        const primary = score[i];
        const primaryDur = primary.durationSeconds;

        // Collect this primary + any following chord/echo notes
        // Chord notes are shorter and quieter than the primary
        const group = [primary];
        let j = i + 1;
        while (j < score.length) {
          const candidate = score[j];
          // A chord/echo note: shorter duration AND lower velocity than primary
          if (!primary.isRest && !candidate.isRest &&
              candidate.durationSeconds < primaryDur &&
              candidate.velocity < primary.velocity) {
            group.push(candidate);
            j++;
          } else {
            break;
          }
        }

        // Schedule all notes in this group at time t
        for (const note of group) {
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
        }

        t += primaryDur + 0.02;
        i = j;
      }

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
        digit(c.g, 1);         // filter cutoff variation

        // === B channel: harmony + interval ===
        const bHundreds = digit(c.b, 100);   // chord type (single/3rd/triad)
        const bTens = digit(c.b, 10);        // melodic interval jump size
        digit(c.b, 1);         // timing micro-offset (swing feel)

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

      return {
        meta: { fileName, avg, scale, rootMidi },
        score: notes
      };
    }
  }

  /**
   * MidiEngine — parses Standard MIDI Files and plays via Web Audio synthesis.
   *
   * meta.midi format:
   *   { url: "https://...", data: "base64..." }
   *   url or data, at least one required.
   *
   * Self-contained MIDI parser — no external dependencies.
   */


  class MidiEngine {
    canHandle(source, meta) {
      return !!(meta && meta.midi && (meta.midi.url || meta.midi.data));
    }

    async analyze(source, audioOpts) {
      return { score: null, meta: { type: "midi" } };
    }

    play(score, audioCtx, audioOpts) {
      if (!score || !score.notes || score.notes.length === 0) {
        return { nodes: [], timers: [], totalDuration: 0 };
      }

      const nodes = [];
      const now = audioCtx.currentTime + 0.03;
      let maxEnd = now;

      score.notes.forEach((note) => {
        const t = now + note.time;
        const dur = note.duration;
        const freq = midiToFreq(note.midi);
        const vel = note.velocity / 127;

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.type = audioOpts.waveform || "triangle";
        osc.frequency.setValueAtTime(freq, t);

        filter.type = audioOpts.filterType || "lowpass";
        filter.frequency.setValueAtTime(
          (audioOpts.filterBaseHz || 900) + vel * (audioOpts.filterVelocityAmount || 3000), t
        );

        const vol = vel * (audioOpts.masterVolume || 0.25);
        const attack = audioOpts.attack || 0.02;
        const release = audioOpts.release || 0.03;

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(t);
        osc.stop(t + dur + release);

        nodes.push(osc, gain, filter);

        const end = t + dur + release;
        if (end > maxEnd) maxEnd = end;
      });

      return {
        nodes,
        timers: [],
        totalDuration: maxEnd - now
      };
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
  }

  // --- Standard MIDI File Parser ---

  MidiEngine.parseMidi = function(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let pos = 0;

    function read(n) {
      const slice = bytes.slice(pos, pos + n);
      pos += n;
      return slice;
    }

    function readUint16() {
      const val = (bytes[pos] << 8) | bytes[pos + 1];
      pos += 2;
      return val;
    }

    function readUint32() {
      const val = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 4;
      return val >>> 0;
    }

    function readVarLen() {
      let val = 0;
      let b;
      do {
        b = bytes[pos++];
        val = (val << 7) | (b & 0x7F);
      } while (b & 0x80);
      return val;
    }

    // Read header chunk
    const headerTag = String.fromCharCode(...read(4));
    if (headerTag !== "MThd") throw new Error("Not a MIDI file");

    const headerLen = readUint32();
    const format = readUint16();
    const numTracks = readUint16();
    const division = readUint16();

    const ticksPerBeat = division & 0x7FFF;
    pos = 8 + 4 + headerLen; // skip to end of header

    const allEvents = [];

    // Read track chunks
    for (let t = 0; t < numTracks; t++) {
      if (pos + 8 > bytes.length) break;

      const trackTag = String.fromCharCode(...read(4));
      const trackLen = readUint32();

      if (trackTag !== "MTrk") {
        pos += trackLen;
        continue;
      }

      const trackEnd = pos + trackLen;
      let tick = 0;
      let runningStatus = 0;

      while (pos < trackEnd) {
        const delta = readVarLen();
        tick += delta;

        let status = bytes[pos];

        // Meta event
        if (status === 0xFF) {
          pos++;
          const metaType = bytes[pos++];
          const metaLen = readVarLen();
          // Tempo change
          if (metaType === 0x51 && metaLen === 3) {
            const microsecondsPerBeat = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
            allEvents.push({
              type: "tempo",
              tick,
              tempo: 60000000 / microsecondsPerBeat
            });
          }
          pos += metaLen;
          continue;
        }

        // SysEx
        if (status === 0xF0 || status === 0xF7) {
          pos++;
          const sysexLen = readVarLen();
          pos += sysexLen;
          continue;
        }

        // Channel message
        if (status & 0x80) {
          runningStatus = status;
          pos++;
        } else {
          status = runningStatus;
        }

        const type = status & 0xF0;
        const channel = status & 0x0F;

        if (type === 0x90 || type === 0x80) {
          const note = bytes[pos++];
          const velocity = bytes[pos++];
          const isNoteOn = type === 0x90 && velocity > 0;

          allEvents.push({
            type: isNoteOn ? "noteOn" : "noteOff",
            tick,
            channel,
            midi: note,
            velocity: isNoteOn ? velocity : 0
          });
        } else if (type === 0xA0 || type === 0xB0 || type === 0xE0) {
          pos += 2; // skip 2-byte messages
        } else if (type === 0xC0 || type === 0xD0) {
          pos += 1; // skip 1-byte messages
        }
      }

      pos = trackEnd;
    }

    // Sort events by tick
    allEvents.sort((a, b) => a.tick - b.tick);

    // Convert ticks to seconds and pair noteOn/noteOff
    let currentTempo = 120;
    let currentTickTime = 0;
    let lastTick = 0;
    let secondsPerTick = 60 / (currentTempo * ticksPerBeat);

    const activeNotes = new Map();
    const notes = [];

    allEvents.forEach((evt) => {
      const deltaTicks = evt.tick - lastTick;
      currentTickTime += deltaTicks * secondsPerTick;
      lastTick = evt.tick;

      if (evt.type === "tempo") {
        currentTempo = evt.tempo;
        secondsPerTick = 60 / (currentTempo * ticksPerBeat);
        return;
      }

      if (evt.type === "noteOn") {
        const key = `${evt.channel}-${evt.midi}`;
        activeNotes.set(key, {
          midi: evt.midi,
          velocity: evt.velocity,
          time: currentTickTime,
          channel: evt.channel
        });
      }

      if (evt.type === "noteOff") {
        const key = `${evt.channel}-${evt.midi}`;
        const on = activeNotes.get(key);
        if (on) {
          notes.push({
            midi: on.midi,
            velocity: on.velocity,
            time: on.time,
            duration: Math.max(0.01, currentTickTime - on.time),
            channel: on.channel
          });
          activeNotes.delete(key);
        }
      }
    });

    // Close any remaining active notes
    activeNotes.forEach((on) => {
      notes.push({
        midi: on.midi,
        velocity: on.velocity,
        time: on.time,
        duration: 0.5,
        channel: on.channel
      });
    });

    return {
      format,
      numTracks,
      ticksPerBeat,
      bpm: currentTempo,
      notes
    };
  };

  /**
   * Fetch MIDI file and parse it.
   */
  MidiEngine.fetchAndParse = async function(url) {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`[FloatImgPlay] MIDI fetch failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return MidiEngine.parseMidi(arrayBuffer);
  };

  /**
   * Decode base64 MIDI data and parse it.
   */
  MidiEngine.parseBase64 = function(base64String) {
    const binary = atob(base64String);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return MidiEngine.parseMidi(bytes.buffer);
  };

  /**
   * AudioEngine — plays mp3/wav/ogg audio files referenced in imgplay metadata.
   *
   * meta.audio format:
   *   { url: "https://...", type: "mp3" }  // type is optional
   *
   * Uses Web Audio API AudioBufferSourceNode for precise control
   * (start/stop timing, integration with AudioContext).
   */

  class AudioEngine {
    canHandle(source, meta) {
      return !!(meta && meta.audio && meta.audio.url);
    }

    /**
     * Analyze = fetch and decode the audio file.
     * Returns a "score" that is actually the decoded AudioBuffer,
     * wrapped to match the Engine interface.
     */
    async analyze(source, audioOpts) {
      const audioUrl = source._audioMeta?.url;
      if (!audioUrl) {
        return { score: null, meta: { type: "audio" } };
      }

      return {
        score: { audioUrl },
        meta: { type: "audio", url: audioUrl }
      };
    }

    /**
     * Play the audio buffer.
     * audioOpts.masterVolume is respected via a GainNode.
     */
    play(score, audioCtx, audioOpts) {
      const nodes = [];
      const timers = [];

      if (!score || !score.audioBuffer) {
        return { nodes, timers, totalDuration: 0 };
      }

      const bufferSource = audioCtx.createBufferSource();
      bufferSource.buffer = score.audioBuffer;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(audioOpts.masterVolume, audioCtx.currentTime);

      bufferSource.connect(gain);
      gain.connect(audioCtx.destination);

      bufferSource.start(0);
      nodes.push(bufferSource, gain);

      return {
        nodes,
        timers,
        totalDuration: score.audioBuffer.duration,
        bufferSource
      };
    }

    stop(handle) {
      if (handle.timers) {
        handle.timers.forEach((id) => clearTimeout(id));
      }
      if (handle.bufferSource) {
        try { handle.bufferSource.stop(0); } catch {}
      }
      if (handle.nodes) {
        handle.nodes.forEach((node) => {
          try { if (typeof node.disconnect === "function") node.disconnect(); } catch {}
        });
      }
    }
  }

  /**
   * Helper: fetch and decode an audio URL into an AudioBuffer.
   * Called by Core before play() when AudioEngine is selected.
   */
  AudioEngine.fetchAndDecode = async function(url, audioCtx) {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`[FloatImgPlay] AudioEngine fetch failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return audioBuffer;
  };

  /**
   * MetaParser — extracts imgplay metadata from images.
   *
   * Supported sources (checked in order):
   * 1. PNG tEXt chunk with key "imgplay"
   * 2. EXIF UserComment containing imgplay JSON
   * 3. Sidecar JSON file at <image-url>.imgplay.json
   *
   * All methods are async because they may fetch data.
   * Static `parse(source)` returns synchronous empty meta (for init),
   * while `parseAsync(source)` does the full extraction.
   */

  const EMPTY_META = Object.freeze({ midi: null, audio: null, engine: null });

  class MetaParser {
    /**
     * Synchronous parse — returns empty meta.
     * Used during initial registration before async parse completes.
     */
    static parse(source) {
      return { midi: null, audio: null, engine: null };
    }

    /**
     * Full async parse — tries all sources in order.
     * Returns first valid imgplay meta found, or empty meta.
     */
    static async parseAsync(source) {
      if (!source || !source.url) return { ...EMPTY_META };

      try {
        // 1. Try PNG tEXt chunk
        const pngMeta = await MetaParser._parsePngText(source.url);
        if (pngMeta) return pngMeta;
      } catch {}

      try {
        // 2. Try EXIF UserComment
        const exifMeta = await MetaParser._parseExif(source.url);
        if (exifMeta) return exifMeta;
      } catch {}

      try {
        // 3. Try sidecar JSON
        const sidecarMeta = await MetaParser._parseSidecar(source.url);
        if (sidecarMeta) return sidecarMeta;
      } catch {}

      return { ...EMPTY_META };
    }

    /**
     * Parse PNG tEXt chunks for key "imgplay".
     * PNG tEXt chunk format: keyword (null-terminated) + text data
     */
    static async _parsePngText(url) {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return null;

      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      // Verify PNG signature: 137 80 78 71 13 10 26 10
      if (bytes.length < 8 ||
          bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
        return null;
      }

      let offset = 8; // skip PNG signature

      while (offset + 12 <= bytes.length) {
        const chunkLen = (bytes[offset] << 24) | (bytes[offset + 1] << 16) |
                         (bytes[offset + 2] << 8) | bytes[offset + 3];
        const chunkType = String.fromCharCode(
          bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]
        );

        if (chunkType === "tEXt" && chunkLen > 0) {
          const dataStart = offset + 8;
          const dataEnd = dataStart + chunkLen;
          if (dataEnd <= bytes.length) {
            const chunkData = bytes.slice(dataStart, dataEnd);
            // Find null separator between keyword and text
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
              const keyword = MetaParser._bytesToString(chunkData.slice(0, nullIdx));
              if (keyword === "imgplay") {
                const textData = MetaParser._bytesToString(chunkData.slice(nullIdx + 1));
                return MetaParser._parseJsonMeta(textData);
              }
            }
          }
        }

        // Also check iTXt (international text) chunks
        if (chunkType === "iTXt" && chunkLen > 0) {
          const dataStart = offset + 8;
          const dataEnd = dataStart + chunkLen;
          if (dataEnd <= bytes.length) {
            const chunkData = bytes.slice(dataStart, dataEnd);
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
              const keyword = MetaParser._bytesToString(chunkData.slice(0, nullIdx));
              if (keyword === "imgplay") {
                // iTXt: keyword \0 compression_flag \0 compression_method \0 lang \0 translated \0 text
                let pos = nullIdx + 1;
                // Skip compression flag, method
                pos = chunkData.indexOf(0, pos) + 1; // skip after compression
                if (pos === 0) pos = nullIdx + 3;
                // Skip language tag
                pos = chunkData.indexOf(0, pos) + 1;
                if (pos === 0) return null;
                // Skip translated keyword
                pos = chunkData.indexOf(0, pos) + 1;
                if (pos === 0) return null;
                const textData = MetaParser._bytesToString(chunkData.slice(pos));
                return MetaParser._parseJsonMeta(textData);
              }
            }
          }
        }

        if (chunkType === "IEND") break;

        // Move to next chunk: 4(length) + 4(type) + chunkLen(data) + 4(CRC)
        offset += 12 + chunkLen;
      }

      return null;
    }

    /**
     * Parse EXIF data for UserComment containing imgplay JSON.
     * Looks for JPEG APP1 EXIF marker or TIFF-in-PNG.
     */
    static async _parseExif(url) {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return null;

      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      // JPEG check: starts with 0xFF 0xD8
      if (bytes.length < 4) return null;

      if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        return MetaParser._parseJpegExif(bytes);
      }

      return null;
    }

    /**
     * Parse JPEG EXIF for UserComment tag (0x9286).
     */
    static _parseJpegExif(bytes) {
      let offset = 2;

      while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xFF) break;

        const marker = bytes[offset + 1];
        // APP1 = 0xE1 (EXIF)
        if (marker === 0xE1) {
          const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
          const segStart = offset + 4;
          const segEnd = offset + 2 + segLen;

          // Check "Exif\0\0" header
          if (segEnd <= bytes.length &&
              bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 &&
              bytes[segStart + 2] === 0x69 && bytes[segStart + 3] === 0x66 &&
              bytes[segStart + 4] === 0x00 && bytes[segStart + 5] === 0x00) {

            const tiffStart = segStart + 6;
            return MetaParser._parseTiffForUserComment(bytes, tiffStart, segEnd);
          }
        }

        // Skip non-APP1 segments
        if (marker === 0xDA) break; // Start of scan = end of metadata
        const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + len;
      }

      return null;
    }

    /**
     * Scan TIFF IFD entries for UserComment tag (0x9286).
     */
    static _parseTiffForUserComment(bytes, tiffStart, maxEnd) {
      if (tiffStart + 8 > maxEnd) return null;

      const isLE = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;

      const read16 = (off) => {
        const a = tiffStart + off;
        if (a + 2 > maxEnd) return 0;
        return isLE
          ? bytes[a] | (bytes[a + 1] << 8)
          : (bytes[a] << 8) | bytes[a + 1];
      };

      const read32 = (off) => {
        const a = tiffStart + off;
        if (a + 4 > maxEnd) return 0;
        return isLE
          ? bytes[a] | (bytes[a + 1] << 8) | (bytes[a + 2] << 16) | (bytes[a + 3] << 24)
          : (bytes[a] << 24) | (bytes[a + 1] << 16) | (bytes[a + 2] << 8) | bytes[a + 3];
      };

      const scanIFD = (ifdOffset) => {
        if (ifdOffset + 2 > maxEnd - tiffStart) return null;
        const count = read16(ifdOffset);

        for (let i = 0; i < count; i++) {
          const entryOff = ifdOffset + 2 + i * 12;
          if (entryOff + 12 > maxEnd - tiffStart) break;

          const tag = read16(entryOff);
          read16(entryOff + 2);
          const numValues = read32(entryOff + 4);
          const valueOff = read32(entryOff + 8);

          // UserComment = 0x9286
          if (tag === 0x9286 && numValues > 8) {
            const dataOff = tiffStart + valueOff;
            if (dataOff + numValues <= maxEnd) {
              // UserComment starts with 8-byte encoding prefix
              const textBytes = bytes.slice(dataOff + 8, dataOff + numValues);
              const text = MetaParser._bytesToString(textBytes).trim().replace(/\0+$/, "");
              const meta = MetaParser._parseJsonMeta(text);
              if (meta) return meta;
            }
          }

          // ExifIFD pointer = 0x8769
          if (tag === 0x8769) {
            const subResult = scanIFD(valueOff);
            if (subResult) return subResult;
          }
        }

        return null;
      };

      const firstIFDOffset = read32(4);
      return scanIFD(firstIFDOffset);
    }

    /**
     * Fetch sidecar JSON: <image-url>.imgplay.json
     */
    static async _parseSidecar(url) {
      const sidecarUrl = url + ".imgplay.json";
      const res = await fetch(sidecarUrl, { mode: "cors" });
      if (!res.ok) return null;

      const text = await res.text();
      return MetaParser._parseJsonMeta(text);
    }

    /**
     * Parse JSON string into imgplay meta structure.
     * Expects: { "imgplay": { "midi": ..., "audio": ..., "engine": ... } }
     * or direct: { "midi": ..., "audio": ..., "engine": ... }
     */
    static _parseJsonMeta(text) {
      try {
        const json = JSON.parse(text);
        const data = json.imgplay || json;

        const result = {
          midi: data.midi || null,
          audio: data.audio || null,
          engine: data.engine || null
        };

        // Only return if at least one field is non-null
        if (result.midi || result.audio || result.engine) {
          return result;
        }
        return null;
      } catch {
        return null;
      }
    }

    /**
     * Convert Uint8Array to string (UTF-8).
     */
    static _bytesToString(bytes) {
      try {
        return new TextDecoder("utf-8").decode(bytes);
      } catch {
        // Fallback for environments without TextDecoder
        let s = "";
        for (let i = 0; i < bytes.length; i++) {
          s += String.fromCharCode(bytes[i]);
        }
        return s;
      }
    }
  }

  /**
   * MidiExport — converts image analysis score to Standard MIDI File.
   *
   * Usage:
   *   const blob = MidiExport.toBlob(score, { bpm: 100 });
   *   MidiExport.download(blob, "my-image.mid");
   */

  class MidiExport {
    /**
     * Convert a score (array of notes) to a Standard MIDI File Blob.
     *
     * @param {Array} score - Array of { midi, freq, durationSeconds, velocity, isRest }
     * @param {Object} opts - { bpm: number }
     * @returns {Blob} MIDI file as Blob
     */
    static toBlob(score, opts = {}) {
      const bytes = MidiExport.toBytes(score, opts);
      return new Blob([bytes], { type: "audio/midi" });
    }

    /**
     * Convert score to MIDI byte array.
     */
    static toBytes(score, opts = {}) {
      const bpm = opts.bpm || 100;
      const ticksPerBeat = 480;
      const secondsPerTick = 60 / (bpm * ticksPerBeat);

      // Build MIDI events from score
      const events = [];
      let currentTime = 0;

      score.forEach((note) => {
        if (note.isRest) {
          currentTime += note.durationSeconds;
          return;
        }

        const startTick = Math.round(currentTime / secondsPerTick);
        const durationTicks = Math.max(1, Math.round(note.durationSeconds / secondsPerTick));
        const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127 / 0.36)));
        const midiNote = Math.max(0, Math.min(127, Math.round(note.midi)));

        events.push({
          tick: startTick,
          type: 0x90, // noteOn
          data: [midiNote, velocity]
        });

        events.push({
          tick: startTick + durationTicks,
          type: 0x80, // noteOff
          data: [midiNote, 0]
        });

        currentTime += note.durationSeconds + 0.02; // match playback gap
      });

      // Sort by tick
      events.sort((a, b) => a.tick - b.tick);

      // Convert to delta-time track bytes
      const trackBytes = [];

      // Tempo meta event: FF 51 03 tt tt tt
      const microsecondsPerBeat = Math.round(60000000 / bpm);
      trackBytes.push(0x00); // delta = 0
      trackBytes.push(0xFF, 0x51, 0x03);
      trackBytes.push((microsecondsPerBeat >> 16) & 0xFF);
      trackBytes.push((microsecondsPerBeat >> 8) & 0xFF);
      trackBytes.push(microsecondsPerBeat & 0xFF);

      let lastTick = 0;
      events.forEach((evt) => {
        const delta = evt.tick - lastTick;
        lastTick = evt.tick;

        // Write variable-length delta
        const varLen = MidiExport._toVarLen(delta);
        varLen.forEach((b) => trackBytes.push(b));

        // Write event
        trackBytes.push(evt.type); // status byte (channel 0)
        evt.data.forEach((b) => trackBytes.push(b));
      });

      // End of track: FF 2F 00
      trackBytes.push(0x00, 0xFF, 0x2F, 0x00);

      // Build complete MIDI file
      const file = [];

      // MThd header
      MidiExport._writeString(file, "MThd");
      MidiExport._writeUint32(file, 6); // header length
      MidiExport._writeUint16(file, 0); // format 0
      MidiExport._writeUint16(file, 1); // 1 track
      MidiExport._writeUint16(file, ticksPerBeat);

      // MTrk
      MidiExport._writeString(file, "MTrk");
      MidiExport._writeUint32(file, trackBytes.length);
      trackBytes.forEach((b) => file.push(b));

      return new Uint8Array(file);
    }

    /**
     * Trigger browser download of a Blob.
     */
    static download(blob, filename = "imgplay-export.mid") {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /**
     * Convenience: convert score and immediately download.
     */
    static exportAndDownload(score, opts = {}, filename) {
      const blob = MidiExport.toBlob(score, opts);
      MidiExport.download(blob, filename);
    }

    // --- Internal helpers ---

    static _toVarLen(value) {
      if (value < 0) value = 0;
      const bytes = [];
      bytes.push(value & 0x7F);
      value >>= 7;
      while (value > 0) {
        bytes.push((value & 0x7F) | 0x80);
        value >>= 7;
      }
      bytes.reverse();
      return bytes;
    }

    static _writeString(arr, str) {
      for (let i = 0; i < str.length; i++) {
        arr.push(str.charCodeAt(i));
      }
    }

    static _writeUint16(arr, val) {
      arr.push((val >> 8) & 0xFF, val & 0xFF);
    }

    static _writeUint32(arr, val) {
      arr.push((val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
    }
  }

  /**
   * MetaEmbed — embeds imgplay metadata into PNG files.
   *
   * Takes a PNG image + MIDI file (or JSON metadata) and produces
   * a new PNG with an "imgplay" tEXt chunk containing the data.
   *
   * Usage:
   *   const blob = await MetaEmbed.embedMidi(pngFile, midiFile);
   *   MetaEmbed.download(blob, "image-with-midi.png");
   */

  class MetaEmbed {
    /**
     * Embed a MIDI file into a PNG image as base64 in tEXt chunk.
     *
     * @param {File|Blob|ArrayBuffer} pngSource - PNG image
     * @param {File|Blob|ArrayBuffer} midiSource - MIDI file
     * @param {Object} extraMeta - additional metadata to merge
     * @returns {Promise<Blob>} new PNG with embedded MIDI
     */
    static async embedMidi(pngSource, midiSource, extraMeta = {}) {
      const pngBuf = await MetaEmbed._toArrayBuffer(pngSource);
      const midiBuf = await MetaEmbed._toArrayBuffer(midiSource);

      const midiBase64 = MetaEmbed._arrayBufferToBase64(midiBuf);

      const meta = Object.assign({
        midi: { data: midiBase64 }
      }, extraMeta);

      return MetaEmbed.embedJson(pngBuf, meta);
    }

    /**
     * Embed an audio URL reference into a PNG image.
     *
     * @param {File|Blob|ArrayBuffer} pngSource - PNG image
     * @param {string} audioUrl - URL to audio file
     * @param {Object} extraMeta - additional metadata
     * @returns {Promise<Blob>} new PNG with embedded audio reference
     */
    static async embedAudioUrl(pngSource, audioUrl, extraMeta = {}) {
      const pngBuf = await MetaEmbed._toArrayBuffer(pngSource);

      const meta = Object.assign({
        audio: { url: audioUrl }
      }, extraMeta);

      return MetaEmbed.embedJson(pngBuf, meta);
    }

    /**
     * Embed arbitrary imgplay JSON metadata into a PNG.
     *
     * @param {ArrayBuffer} pngBuffer - PNG file bytes
     * @param {Object} meta - metadata object (midi, audio, engine fields)
     * @returns {Blob} new PNG with tEXt chunk
     */
    static embedJson(pngBuffer, meta) {
      const pngBytes = new Uint8Array(pngBuffer);

      // Verify PNG signature
      if (pngBytes.length < 8 ||
          pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50 ||
          pngBytes[2] !== 0x4E || pngBytes[3] !== 0x47) {
        throw new Error("[MetaEmbed] Not a valid PNG file");
      }

      const jsonStr = JSON.stringify({ imgplay: meta });
      const textChunk = MetaEmbed._createTextChunk("imgplay", jsonStr);

      // Find insertion point: after IHDR chunk (first chunk after signature)
      // PNG: 8-byte signature, then chunks (4 len + 4 type + data + 4 CRC)
      const ihdrLen = (pngBytes[8] << 24) | (pngBytes[9] << 16) |
                      (pngBytes[10] << 8) | pngBytes[11];
      const insertAt = 8 + 12 + ihdrLen; // after signature + IHDR chunk

      // Build new PNG: before + tEXt chunk + after
      const before = pngBytes.slice(0, insertAt);
      const after = pngBytes.slice(insertAt);

      const result = new Uint8Array(before.length + textChunk.length + after.length);
      result.set(before, 0);
      result.set(textChunk, before.length);
      result.set(after, before.length + textChunk.length);

      return new Blob([result], { type: "image/png" });
    }

    /**
     * Remove existing imgplay tEXt chunks from a PNG.
     *
     * @param {File|Blob|ArrayBuffer} pngSource - PNG image
     * @returns {Promise<Blob>} PNG without imgplay metadata
     */
    static async strip(pngSource) {
      const pngBuf = await MetaEmbed._toArrayBuffer(pngSource);
      const bytes = new Uint8Array(pngBuf);

      if (bytes.length < 8 ||
          bytes[0] !== 0x89 || bytes[1] !== 0x50) {
        throw new Error("[MetaEmbed] Not a valid PNG file");
      }

      const parts = [bytes.slice(0, 8)]; // PNG signature
      let offset = 8;

      while (offset + 12 <= bytes.length) {
        const chunkLen = (bytes[offset] << 24) | (bytes[offset + 1] << 16) |
                         (bytes[offset + 2] << 8) | bytes[offset + 3];
        const chunkType = String.fromCharCode(
          bytes[offset + 4], bytes[offset + 5],
          bytes[offset + 6], bytes[offset + 7]
        );
        const fullChunkSize = 12 + chunkLen;

        // Check if this is an imgplay tEXt/iTXt chunk
        let isImgplay = false;
        if ((chunkType === "tEXt" || chunkType === "iTXt") && chunkLen > 0) {
          const dataStart = offset + 8;
          const dataEnd = dataStart + chunkLen;
          if (dataEnd <= bytes.length) {
            const chunkData = bytes.slice(dataStart, dataEnd);
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx > 0) {
              const keyword = MetaEmbed._bytesToString(chunkData.slice(0, nullIdx));
              if (keyword === "imgplay") isImgplay = true;
            }
          }
        }

        if (!isImgplay) {
          parts.push(bytes.slice(offset, offset + fullChunkSize));
        }

        if (chunkType === "IEND") break;
        offset += fullChunkSize;
      }

      const totalLen = parts.reduce(function(sum, p) { return sum + p.length; }, 0);
      const result = new Uint8Array(totalLen);
      let pos = 0;
      parts.forEach(function(p) {
        result.set(p, pos);
        pos += p.length;
      });

      return new Blob([result], { type: "image/png" });
    }

    /**
     * Trigger browser download.
     */
    static download(blob, filename = "imgplay-embedded.png") {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // --- Internal helpers ---

    static _createTextChunk(keyword, text) {
      const keyBytes = MetaEmbed._stringToBytes(keyword);
      const textBytes = MetaEmbed._stringToBytes(text);

      // tEXt chunk data: keyword + null + text
      const dataLen = keyBytes.length + 1 + textBytes.length;
      const chunk = new Uint8Array(12 + dataLen);

      // Length (4 bytes, big-endian)
      chunk[0] = (dataLen >> 24) & 0xFF;
      chunk[1] = (dataLen >> 16) & 0xFF;
      chunk[2] = (dataLen >> 8) & 0xFF;
      chunk[3] = dataLen & 0xFF;

      // Type: "tEXt"
      chunk[4] = 0x74; // t
      chunk[5] = 0x45; // E
      chunk[6] = 0x58; // X
      chunk[7] = 0x74; // t

      // Data: keyword + null + text
      chunk.set(keyBytes, 8);
      chunk[8 + keyBytes.length] = 0; // null separator
      chunk.set(textBytes, 8 + keyBytes.length + 1);

      // CRC over type + data
      const crcData = chunk.slice(4, 8 + dataLen);
      const crc = MetaEmbed._crc32(crcData);
      const crcOffset = 8 + dataLen;
      chunk[crcOffset] = (crc >> 24) & 0xFF;
      chunk[crcOffset + 1] = (crc >> 16) & 0xFF;
      chunk[crcOffset + 2] = (crc >> 8) & 0xFF;
      chunk[crcOffset + 3] = crc & 0xFF;

      return chunk;
    }

    static _crc32(bytes) {
      if (!MetaEmbed._crcTable) {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
          var c = n;
          for (var k = 0; k < 8; k++) {
            if (c & 1) c = 0xEDB88320 ^ (c >>> 1);
            else c = c >>> 1;
          }
          table[n] = c;
        }
        MetaEmbed._crcTable = table;
      }

      var crc = 0xFFFFFFFF;
      for (var i = 0; i < bytes.length; i++) {
        crc = MetaEmbed._crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    static _stringToBytes(str) {
      var bytes = new Uint8Array(str.length);
      for (var i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xFF;
      }
      return bytes;
    }

    static _bytesToString(bytes) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]);
      }
      return s;
    }

    static async _toArrayBuffer(source) {
      if (source instanceof ArrayBuffer) return source;
      if (source instanceof Uint8Array) return source.buffer;
      if (source instanceof Blob || (typeof File !== "undefined" && source instanceof File)) {
        return source.arrayBuffer();
      }
      throw new Error("[MetaEmbed] Unsupported source type");
    }

    static _arrayBufferToBase64(buffer) {
      var bytes = new Uint8Array(buffer);
      var binary = "";
      for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  }

  /*!
   * FloatImgPlay v2.0.0 — Modular Architecture
   * Image-to-sound player. Scans pixel data and generates rule-based music via Web Audio API.
   * Modular architecture with Engine interface and Mode Router.
   */


  class FloatImgPlay {
    constructor(options = {}) {
      this.options = mergeDeep(this._defaults(), options);
      this.instances = new Map();
      this.audioCtx = null;
      this.globalUnlocked = false;

      this.engines = {
        midi: new MidiEngine(),
        audio: new AudioEngine(),
        image: new ImageEngine()
      };

      this._boundUnlock = this._unlockAudio.bind(this);
      this._boundOnVisibilityChange = this._onDocumentVisibilityChange.bind(this);
      this._boundTick = throttle(this._tickVisibility.bind(this), 120);
    }

    init() {
      this._bindGlobalUnlock();
      document.addEventListener("visibilitychange", this._boundOnVisibilityChange, { passive: true });
      window.addEventListener("scroll", this._boundTick, { passive: true });
      window.addEventListener("resize", this._boundTick, { passive: true });

      const nodes = Array.from(document.querySelectorAll(this.options.selector));
      nodes.forEach((el) => this.register(el));
      this._tickVisibility();
      return this;
    }

    destroy() {
      document.removeEventListener("visibilitychange", this._boundOnVisibilityChange);
      window.removeEventListener("scroll", this._boundTick);
      window.removeEventListener("resize", this._boundTick);
      this.instances.forEach((inst) => this.unregister(inst.el));
      this.instances.clear();
    }

    register(el, perElementOptions = {}) {
      if (!el || this.instances.has(el)) return;

      const opts = mergeDeep(clone(this.options), perElementOptions);
      const source = this._resolveSource(el);
      if (!source) return;

      const meta = MetaParser.parse(source);
      const engine = this._resolveEngine(source, meta);

      const inst = {
        el,
        opts,
        source,
        meta,
        engine,
        isPlaying: false,
        hasRenderedUI: false,
        isVisibleInViewport: false,
        isActuallyVisible: false,
        isDocVisible: document.visibilityState === "visible",
        pendingAutoplay: false,
        playHandle: null,
        currentScore: null,
        currentMeta: null,
        observer: null,
        ui: null,
      };

      this._buildUI(inst);
      this._prepareAnalysis(inst);
      this._bindInstanceEvents(inst);
      this._setupIntersectionObserver(inst);

      this.instances.set(el, inst);

      // Async meta parse — may upgrade engine if meta found
      MetaParser.parseAsync(source).then((asyncMeta) => {
        if (asyncMeta.midi || asyncMeta.audio || asyncMeta.engine) {
          inst.meta = asyncMeta;
          inst.engine = this._resolveEngine(source, asyncMeta);
          if (asyncMeta.engine) {
            inst.opts.audio = mergeDeep(inst.opts.audio, asyncMeta.engine);
          }
          this._prepareAnalysis(inst);
        }
      }).catch(() => {});

      if (inst.opts.autoplay) {
        inst.pendingAutoplay = true;
        this._maybeAutoplay(inst);
      }
    }

    unregister(el) {
      const inst = this.instances.get(el);
      if (!inst) return;

      this.stop(el);

      if (inst.observer) inst.observer.disconnect();

      if (inst.ui?.playBtn) inst.ui.playBtn.removeEventListener("click", inst._onPlayClick);
      if (inst.ui?.volumeInput) inst.ui.volumeInput.removeEventListener("input", inst._onVolumeInput);
      if (inst.el) inst.el.removeEventListener("click", inst._onElClick);

      if (inst.ui?.root && inst.ui.root.parentNode) {
        inst.ui.root.parentNode.removeChild(inst.ui.root);
      }

      this.instances.delete(el);
    }

    play(target) {
      const inst = this._getInstance(target);
      if (!inst) return;
      this._playInstance(inst);
    }

    stop(target) {
      const inst = this._getInstance(target);
      if (!inst) return;
      this._stopInstance(inst);
    }

    pause(target) {
      this.stop(target);
    }

    refresh() {
      this.instances.forEach((inst) => {
        inst.source = this._resolveSource(inst.el) || inst.source;
        inst.meta = MetaParser.parse(inst.source);
        inst.engine = this._resolveEngine(inst.source, inst.meta);
        this._prepareAnalysis(inst);

        MetaParser.parseAsync(inst.source).then((asyncMeta) => {
          if (asyncMeta.midi || asyncMeta.audio || asyncMeta.engine) {
            inst.meta = asyncMeta;
            inst.engine = this._resolveEngine(inst.source, asyncMeta);
            if (asyncMeta.engine) {
              inst.opts.audio = mergeDeep(inst.opts.audio, asyncMeta.engine);
            }
            this._prepareAnalysis(inst);
          }
        }).catch(() => {});
      });
      this._tickVisibility();
    }

    // --- Mode Router ---

    _resolveEngine(source, meta) {
      if (this.engines.midi.canHandle(source, meta)) return this.engines.midi;
      if (this.engines.audio.canHandle(source, meta)) return this.engines.audio;
      return this.engines.image;
    }

    // --- Defaults ---

    _defaults() {
      return {
        selector: ".float-imgplay",
        autoplay: false,
        autoplayWhenVisibleOnly: true,
        stopWhenHidden: true,
        showPlayOverlay: true,
        showVolumeControl: true,
        overlayIcon: "\u25B6",
        overlayPlayText: "",
        occlusionSamplePoints: [
          [0.5, 0.5],
          [0.2, 0.2],
          [0.8, 0.2],
          [0.2, 0.8],
          [0.8, 0.8]
        ],
        visibilityThreshold: 0.25,
        zIndexUI: 12,
        classNames: {
          initialized: "float-imgplay--ready",
          playing: "float-imgplay--playing",
          paused: "float-imgplay--paused",
          ui: "float-imgplay-ui",
          playBtn: "float-imgplay-play",
          volumeWrap: "float-imgplay-volume",
          volumeInput: "float-imgplay-volume-input"
        },
        audio: {
          masterVolume: 0.25,
          pitchShiftSemitones: 0,
          waveform: "triangle",
          tempo: 100,
          noteDurationBeats: 0.5,
          restThreshold: 28,
          sampleColumns: 24,
          sampleRows: [0.25, 0.5, 0.75],
          filterType: "lowpass",
          filterBaseHz: 900,
          filterVelocityAmount: 3000,
          attack: 0.02,
          release: 0.03,
          scaleMode: "auto",
          rootMode: "filename-first-char",
          fixedRootMidi: 60,
          octaveContrastThreshold: 100,
          octaveShiftSemitones: 12,
          brightDuration: 0.26,
          blueDuration: 0.46,
          neutralDuration: 0.34
        },
        security: {
          allowedDomains: [],
          maxFileSize: 10485760,
          allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"]
        }
      };
    }

    // --- Security ---

    _checkUrlAllowed(url) {
      const domains = this.options.security?.allowedDomains;
      if (!domains || domains.length === 0) return true;
      try {
        const parsed = new URL(url, window.location.href);
        return domains.some((d) => parsed.hostname === d || parsed.hostname.endsWith("." + d));
      } catch {
        return false;
      }
    }

    _checkMimeType(mimeType) {
      const allowed = this.options.security?.allowedMimeTypes;
      if (!allowed || allowed.length === 0) return true;
      if (!mimeType) return false;
      const normalized = mimeType.split(";")[0].trim().toLowerCase();
      return allowed.some((t) => t.toLowerCase() === normalized);
    }

    async _checkResourceSecurity(url) {
      const maxSize = this.options.security?.maxFileSize;
      const allowedMimes = this.options.security?.allowedMimeTypes;
      if ((!maxSize || maxSize <= 0) && (!allowedMimes || allowedMimes.length === 0)) return true;

      try {
        const res = await fetch(url, { method: "HEAD", mode: "cors" });
        if (!res.ok) return true; // let the actual fetch handle the error

        if (maxSize && maxSize > 0) {
          const contentLength = res.headers.get("content-length");
          if (contentLength && Number(contentLength) > maxSize) {
            console.warn("[FloatImgPlay] File exceeds maxFileSize (" + maxSize + " bytes):", url);
            return false;
          }
        }

        if (allowedMimes && allowedMimes.length > 0) {
          const contentType = res.headers.get("content-type");
          if (contentType && !this._checkMimeType(contentType)) {
            console.warn("[FloatImgPlay] MIME type not allowed (" + contentType + "):", url);
            return false;
          }
        }

        return true;
      } catch {
        return true; // allow if HEAD fails (CORS, etc.)
      }
    }

    // --- Audio Context ---

    _bindGlobalUnlock() {
      ["pointerdown", "touchstart", "click", "keydown"].forEach((evt) => {
        window.addEventListener(evt, this._boundUnlock, { passive: true, once: false });
      });
    }

    async _unlockAudio() {
      try {
        const ctx = this._ensureAudioContext();
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        this.globalUnlocked = true;
        this.instances.forEach((inst) => {
          if (inst.pendingAutoplay) this._maybeAutoplay(inst);
        });
      } catch (err) {
        console.warn("[FloatImgPlay] Audio unlock failed:", err);
      }
    }

    _ensureAudioContext() {
      if (!this.audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AC();
      }
      return this.audioCtx;
    }

    // --- Source Resolution ---

    _resolveSource(el) {
      if (!el) return null;

      if (el.tagName === "IMG" && el.currentSrc || el.tagName === "IMG" && el.src) {
        const src = el.currentSrc || el.src;
        if (!this._checkUrlAllowed(src)) {
          console.warn("[FloatImgPlay] URL blocked by allowedDomains:", src);
          return null;
        }
        return { type: "img", url: src, fileName: fileNameFromUrl(src), imgEl: el };
      }

      const childImg = el.querySelector("img");
      if (childImg && (childImg.currentSrc || childImg.src)) {
        const src = childImg.currentSrc || childImg.src;
        if (!this._checkUrlAllowed(src)) {
          console.warn("[FloatImgPlay] URL blocked by allowedDomains:", src);
          return null;
        }
        return { type: "img-child", url: src, fileName: fileNameFromUrl(src), imgEl: childImg };
      }

      const bg = getComputedStyle(el).backgroundImage;
      const url = extractCssUrl(bg);
      if (url) {
        if (!this._checkUrlAllowed(url)) {
          console.warn("[FloatImgPlay] URL blocked by allowedDomains:", url);
          return null;
        }
        return { type: "background", url, fileName: fileNameFromUrl(url), imgEl: null };
      }

      return null;
    }

    // --- Analysis (delegates to engine) ---

    async _prepareAnalysis(inst) {
      try {
        const securityOk = await this._checkResourceSecurity(inst.source.url);
        if (!securityOk) return;
        const { score, meta } = await inst.engine.analyze(inst.source, inst.opts.audio);
        inst.currentScore = score;
        inst.currentMeta = meta;
      } catch (err) {
        console.warn("[FloatImgPlay] analyze failed:", err);
      }
    }

    // --- Play / Stop (delegates to engine) ---

    async _playInstance(inst) {
      if (!inst.currentScore || !inst.currentMeta) {
        try {
          const result = await inst.engine.analyze(inst.source, inst.opts.audio);
          inst.currentScore = result.score;
          inst.currentMeta = result.meta;
        } catch {
          return;
        }
      }

      const ctx = this._ensureAudioContext();
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }

      if (inst.opts.autoplayWhenVisibleOnly && !this._canPlayNow(inst)) {
        inst.pendingAutoplay = true;
        return;
      }

      // MidiEngine: fetch/parse MIDI before play
      if (inst.engine instanceof MidiEngine && inst.meta?.midi && !inst.currentScore?.notes) {
        try {
          let parsed;
          if (inst.meta.midi.data) {
            parsed = MidiEngine.parseBase64(inst.meta.midi.data);
          } else if (inst.meta.midi.url) {
            if (!this._checkUrlAllowed(inst.meta.midi.url)) {
              console.warn("[FloatImgPlay] MIDI URL blocked by allowedDomains:", inst.meta.midi.url);
              return;
            }
            const midiSecure = await this._checkResourceSecurity(inst.meta.midi.url);
            if (!midiSecure) return;
            parsed = await MidiEngine.fetchAndParse(inst.meta.midi.url);
          }
          if (parsed) inst.currentScore = parsed;
        } catch (err) {
          console.warn("[FloatImgPlay] MIDI parse failed:", err);
          return;
        }
      }

      // AudioEngine: fetch and decode audio buffer before play
      if (inst.engine instanceof AudioEngine && inst.meta?.audio?.url && !inst.currentScore?.audioBuffer) {
        try {
          if (!this._checkUrlAllowed(inst.meta.audio.url)) {
            console.warn("[FloatImgPlay] Audio URL blocked by allowedDomains:", inst.meta.audio.url);
            return;
          }
          const audioSecure = await this._checkResourceSecurity(inst.meta.audio.url);
          if (!audioSecure) return;
          const audioBuffer = await AudioEngine.fetchAndDecode(inst.meta.audio.url, ctx);
          inst.currentScore = { audioBuffer, audioUrl: inst.meta.audio.url };
        } catch (err) {
          console.warn("[FloatImgPlay] Audio fetch failed:", err);
          return;
        }
      }

      this._stopInstance(inst);

      const handle = inst.engine.play(inst.currentScore, ctx, inst.opts.audio);
      inst.playHandle = handle;

      const timerId = window.setTimeout(() => {
        inst.isPlaying = false;
        inst.el.classList.remove(inst.opts.classNames.playing);
        inst.el.classList.add(inst.opts.classNames.paused);
        if (inst.ui?.playBtn) this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
      }, handle.totalDuration * 1000 + 50);

      if (!handle.timers) handle.timers = [];
      handle.timers.push(timerId);

      inst.isPlaying = true;
      inst.pendingAutoplay = false;
      inst.el.classList.add(inst.opts.classNames.playing);
      inst.el.classList.remove(inst.opts.classNames.paused);

      if (inst.ui?.playBtn) {
        this._setPauseBtnContent(inst.ui.playBtn);
      }
    }

    _stopInstance(inst) {
      if (inst.playHandle) {
        inst.engine.stop(inst.playHandle);
        inst.playHandle = null;
      }

      inst.isPlaying = false;
      inst.el.classList.remove(inst.opts.classNames.playing);
      inst.el.classList.add(inst.opts.classNames.paused);

      if (inst.ui?.playBtn) {
        this._setPlayBtnContent(inst.ui.playBtn, inst.opts.overlayIcon, inst.opts.overlayPlayText);
      }
    }

    // --- UI ---

    _buildUI(inst) {
      if (inst.hasRenderedUI) return;

      const { classNames, showPlayOverlay, showVolumeControl, overlayIcon, overlayPlayText, zIndexUI, audio } = inst.opts;
      const el = inst.el;

      const currentPosition = getComputedStyle(el).position;
      if (currentPosition === "static") {
        el.style.position = "relative";
      }
      el.style.overflow = el.style.overflow || "hidden";

      const uiRoot = document.createElement("div");
      uiRoot.className = classNames.ui;
      Object.assign(uiRoot.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: String(zIndexUI)
      });

      let playBtn = null;
      if (showPlayOverlay) {
        playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = classNames.playBtn;
        playBtn.setAttribute("aria-label", "Play image audio");
        this._setPlayBtnContent(playBtn, overlayIcon, overlayPlayText);
        Object.assign(playBtn.style, {
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "auto",
          border: "0",
          borderRadius: "999px",
          padding: "12px 16px",
          fontSize: "18px",
          lineHeight: "1",
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          backdropFilter: "blur(10px)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "56px",
          minHeight: "56px"
        });
        uiRoot.appendChild(playBtn);
      }

      let volumeWrap = null;
      let volumeInput = null;
      if (showVolumeControl) {
        volumeWrap = document.createElement("div");
        volumeWrap.className = classNames.volumeWrap;
        Object.assign(volumeWrap.style, {
          position: "absolute",
          right: "10px",
          bottom: "10px",
          pointerEvents: "auto",
          background: "rgba(0,0,0,0.48)",
          color: "#fff",
          padding: "8px 10px",
          borderRadius: "14px",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        });

        const label = document.createElement("span");
        label.textContent = "\u{1F50A}";
        label.style.fontSize = "12px";

        volumeInput = document.createElement("input");
        volumeInput.type = "range";
        volumeInput.min = "0";
        volumeInput.max = "1";
        volumeInput.step = "0.01";
        volumeInput.value = String(audio.masterVolume);
        volumeInput.className = classNames.volumeInput;
        volumeInput.style.width = "88px";

        volumeWrap.appendChild(label);
        volumeWrap.appendChild(volumeInput);
        uiRoot.appendChild(volumeWrap);
      }

      el.classList.add(classNames.initialized);
      el.appendChild(uiRoot);

      inst.ui = { root: uiRoot, playBtn, volumeWrap, volumeInput };
      inst.hasRenderedUI = true;
    }

    _setPlayBtnContent(btn, icon, playText) {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      const iconSpan = document.createElement("span");
      iconSpan.textContent = icon;
      btn.appendChild(iconSpan);
      if (playText) {
        const textSpan = document.createElement("span");
        textSpan.style.marginLeft = "8px";
        textSpan.textContent = playText;
        btn.appendChild(textSpan);
      }
    }

    _setPauseBtnContent(btn) {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      const iconSpan = document.createElement("span");
      iconSpan.textContent = "\u275A\u275A";
      btn.appendChild(iconSpan);
    }

    // --- Events ---

    _bindInstanceEvents(inst) {
      inst._onPlayClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inst.isPlaying) {
          this._stopInstance(inst);
        } else {
          this._playInstance(inst);
        }
      };

      inst._onElClick = (e) => {
        if (inst.ui?.volumeInput && (e.target === inst.ui.volumeInput || inst.ui.volumeWrap?.contains(e.target))) {
          return;
        }
        if (!inst.ui?.playBtn) {
          if (inst.isPlaying) this._stopInstance(inst);
          else this._playInstance(inst);
        }
      };

      inst._onVolumeInput = (e) => {
        const v = Number(e.target.value);
        inst.opts.audio.masterVolume = v;
      };

      if (inst.ui?.playBtn) inst.ui.playBtn.addEventListener("click", inst._onPlayClick);
      if (inst.ui?.volumeInput) inst.ui.volumeInput.addEventListener("input", inst._onVolumeInput);
      inst.el.addEventListener("click", inst._onElClick);
    }

    // --- Visibility ---

    _setupIntersectionObserver(inst) {
      if (!("IntersectionObserver" in window)) {
        inst.isVisibleInViewport = true;
        return;
      }

      inst.observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        inst.isVisibleInViewport = !!entry && entry.isIntersecting && entry.intersectionRatio >= inst.opts.visibilityThreshold;
        this._tickSingle(inst);
      }, {
        root: null,
        threshold: [0, inst.opts.visibilityThreshold, 0.5, 0.75, 1]
      });

      inst.observer.observe(inst.el);
    }

    _onDocumentVisibilityChange() {
      this.instances.forEach((inst) => {
        inst.isDocVisible = document.visibilityState === "visible";
        if (inst.opts.stopWhenHidden && !inst.isDocVisible) {
          this._stopInstance(inst);
        } else {
          this._tickSingle(inst);
        }
      });
    }

    _tickVisibility() {
      this.instances.forEach((inst) => this._tickSingle(inst));
    }

    _tickSingle(inst) {
      inst.isActuallyVisible = this._isActuallyVisible(inst);

      if (inst.opts.stopWhenHidden && inst.isPlaying && !inst.isActuallyVisible) {
        this._stopInstance(inst);
      }

      if (inst.pendingAutoplay) {
        this._maybeAutoplay(inst);
      }
    }

    _maybeAutoplay(inst) {
      if (!inst.opts.autoplay) return;
      if (!this.globalUnlocked) return;
      if (!this._canPlayNow(inst)) return;
      this._playInstance(inst);
    }

    _canPlayNow(inst) {
      if (!inst.isDocVisible && inst.opts.stopWhenHidden) return false;
      if (inst.opts.autoplayWhenVisibleOnly && !inst.isActuallyVisible) return false;
      return true;
    }

    _isActuallyVisible(inst) {
      const el = inst.el;
      if (!el || !document.documentElement.contains(el)) return false;

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (document.visibilityState !== "visible") return false;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      if (!inst.isVisibleInViewport) return false;

      return this._isTopMostEnough(el, rect, inst.opts.occlusionSamplePoints);
    }

    _isTopMostEnough(el, rect, samplePoints) {
      let visibleHits = 0;
      let total = 0;

      for (const [rx, ry] of samplePoints) {
        const x = rect.left + rect.width * rx;
        const y = rect.top + rect.height * ry;

        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        total++;

        const top = document.elementFromPoint(x, y);
        if (!top) continue;

        if (top === el || el.contains(top) || top.contains(el)) {
          visibleHits++;
        }
      }

      if (total === 0) return false;
      return (visibleHits / total) >= 0.4;
    }

    // --- Instance lookup ---

    _getInstance(target) {
      if (!target) return null;
      if (this.instances.has(target)) return this.instances.get(target);
      if (typeof target === "string") {
        const el = document.querySelector(target);
        return el ? this.instances.get(el) : null;
      }
      return null;
    }
  }

  exports.AudioEngine = AudioEngine;
  exports.FloatImgPlay = FloatImgPlay;
  exports.ImageEngine = ImageEngine;
  exports.MetaEmbed = MetaEmbed;
  exports.MetaParser = MetaParser;
  exports.MidiEngine = MidiEngine;
  exports.MidiExport = MidiExport;
  exports.default = FloatImgPlay;

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;

})({});
