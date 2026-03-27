/**
 * MidiEngine — parses Standard MIDI Files and plays via Web Audio synthesis.
 *
 * meta.midi format:
 *   { url: "https://...", data: "base64..." }
 *   url or data, at least one required.
 *
 * Self-contained MIDI parser — no external dependencies.
 */

import { midiToFreq } from "../utils/helpers.js";

export class MidiEngine {
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
