export class AudioEngine {
  canHandle(source, meta) {
    return !!(meta && meta.audio);
  }

  async analyze(source, audioOpts) {
    throw new Error("[FloatImgPlay] AudioEngine not implemented yet");
  }

  play(score, audioCtx, audioOpts) {
    throw new Error("[FloatImgPlay] AudioEngine not implemented yet");
  }

  stop(handle) {
    throw new Error("[FloatImgPlay] AudioEngine not implemented yet");
  }
}
