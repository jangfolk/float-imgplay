/**
 * MidiExport — converts image analysis score to Standard MIDI File.
 *
 * Usage:
 *   const blob = MidiExport.toBlob(score, { bpm: 100 });
 *   MidiExport.download(blob, "my-image.mid");
 */

export class MidiExport {
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
