class PlaybackOutputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stream = 0;
    this.native = false;
    this.samples = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      this.native = data.native === true;
      this.stream = data.stream || 0;
      this.offset = 0;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length) return true;
    for (let frame = 0; frame < input[0].length; frame++) {
      const left = input[0][frame];
      const right = (input[1] || input[0])[frame];
      if (!this.native) {
        output[0][frame] = left;
        if (output[1]) output[1][frame] = right;
      } else if (this.stream) {
        this.samples[this.offset++] = left;
        this.samples[this.offset++] = right;
        if (this.offset === this.samples.length) {
          this.port.postMessage({ stream: this.stream, pcm: this.samples.buffer }, [this.samples.buffer]);
          this.samples = new Float32Array(2048);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('lira-playback-output', PlaybackOutputProcessor);
