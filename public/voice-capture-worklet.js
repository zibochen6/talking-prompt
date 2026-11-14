class TongpinCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.filled = 0;
    this.total = 0;
    this.chunk = [];
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    const step = sampleRate / 16000;
    for (let index = 0; index < input.length; index++) {
      let remaining = 1;
      const sample = input[index];
      while (remaining > 1e-12) {
        const take = Math.min(step - this.filled, remaining);
        this.total += sample * take;
        this.filled += take;
        remaining -= take;
        if (this.filled >= step - 1e-9) {
          this.chunk.push(this.total / step);
          this.total = 0;
          this.filled = 0;
        }
      }
    }
    if (this.chunk.length >= 1600) {
      this.port.postMessage(new Float32Array(this.chunk));
      this.chunk = [];
    }
    return true;
  }
}
registerProcessor('tongpin-capture', TongpinCapture);
