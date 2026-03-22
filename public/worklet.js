class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ratio = sampleRate / (options.processorOptions?.targetRate || 16000);
    // Buffer ~100ms of 16kHz audio before posting (1600 samples)
    this._chunkSize = options.processorOptions?.chunkSamples || 1600;
    this._buf = new Int16Array(this._chunkSize);
    this._bufLen = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const outLen = this._ratio <= 1.001 ? ch.length : Math.floor(ch.length / this._ratio);
    for (let i = 0; i < outLen; i++) {
      let sample;
      if (this._ratio <= 1.001) {
        sample = ch[i];
      } else {
        const s = i * this._ratio;
        const i0 = Math.floor(s);
        const i1 = Math.min(i0 + 1, ch.length - 1);
        const f = s - i0;
        sample = ch[i0] * (1 - f) + ch[i1] * f;
      }
      this._buf[this._bufLen++] = Math.max(-32768, Math.min(32767, sample * 32768));
      if (this._bufLen >= this._chunkSize) {
        this.port.postMessage(this._buf.buffer.slice(0));
        this._bufLen = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-proc', PCMProcessor);
