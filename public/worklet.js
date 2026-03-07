class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Downsample from native rate (e.g. 44100 on iOS) to target 16000 Hz
    this._ratio = sampleRate / (options.processorOptions?.targetRate || 16000);
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    if (this._ratio <= 1.001) {
      // Native rate already matches target
      const i16 = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++)
        i16[i] = Math.max(-32768, Math.min(32767, ch[i] * 32768));
      this.port.postMessage(i16.buffer, [i16.buffer]);
    } else {
      // Linear interpolation downsample
      const outLen = Math.floor(ch.length / this._ratio);
      const i16 = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = i * this._ratio;
        const i0 = Math.floor(s);
        const i1 = Math.min(i0 + 1, ch.length - 1);
        const f = s - i0;
        i16[i] = Math.max(-32768, Math.min(32767, (ch[i0] * (1 - f) + ch[i1] * f) * 32768));
      }
      this.port.postMessage(i16.buffer, [i16.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-proc', PCMProcessor);
