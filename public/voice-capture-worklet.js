class TongpinCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = 0;
    this.carry = 0;
    this.chunk = [];
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    const ratio = sampleRate / 16000;
    for (let index = 0; index < input.length; index++) {
      this.carry += input[index];
      this.pending += 1;
      if (this.pending >= ratio) {
        this.chunk.push(this.carry / this.pending);
        this.carry = 0;
        this.pending = 0;
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
