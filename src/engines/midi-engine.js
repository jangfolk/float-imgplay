export class MidiEngine {
  canHandle(source, meta) {
    return !!(meta && meta.midi);
  }

  async analyze(source, audioOpts) {
    throw new Error("[FloatImgPlay] MidiEngine not implemented yet");
  }

  play(score, audioCtx, audioOpts) {
    throw new Error("[FloatImgPlay] MidiEngine not implemented yet");
  }

  stop(handle) {
    throw new Error("[FloatImgPlay] MidiEngine not implemented yet");
  }
}
