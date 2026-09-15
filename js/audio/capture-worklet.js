/* ============================================================================
   Capture worklet — raw samples off the microphone, with a pre-roll.

   A game sound is often a quarter of a second long, and the press that starts
   a recording lands a moment after you have started making the noise. So
   while the microphone is armed this keeps the last quarter-second in a ring
   buffer, and hands it over first when recording starts. The attack is never
   lost; the auto-trim cuts whatever silence the pre-roll brings with it.

   Channels are folded to mono here, because a mono file is what Minecraft
   needs for positional audio and there is no reason to carry two.
   ========================================================================= */

class AtsCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const n = (options && options.processorOptions && options.processorOptions.preRoll) | 0;
    this.ring = new Float32Array(Math.max(1, n));
    this.ringPos = 0;
    this.ringFull = false;
    this.recording = false;
    this.buf = new Float32Array(8192);
    this.len = 0;
    /* The loudest raw sample of the take, on any channel, before the fold to
       mono can halve it. The meter only looks once a frame and can miss a
       clip a few samples long; this sees every one. */
    this.peak = 0;
    this.port.onmessage = e => {
      if (e.data.type === 'start') this.begin();
      else if (e.data.type === 'stop') this.end();
    };
  }

  begin() {
    const n = this.ringFull ? this.ring.length : this.ringPos;
    if (n) {
      // Oldest sample first.
      const pre = new Float32Array(n);
      if (this.ringFull) {
        pre.set(this.ring.subarray(this.ringPos));
        pre.set(this.ring.subarray(0, this.ringPos), this.ring.length - this.ringPos);
      } else {
        pre.set(this.ring.subarray(0, n));
      }
      this.port.postMessage({ type: 'chunk', samples: pre, pre: true }, [pre.buffer]);
    }
    this.len = 0;
    this.peak = this.prePeak();
    this.recording = true;
  }

  /** The pre-roll ships with the take, so a clip in it counts too. */
  prePeak() {
    let p = 0;
    const n = this.ringFull ? this.ring.length : this.ringPos;
    for (let i = 0; i < n; i++) { const a = Math.abs(this.ring[i]); if (a > p) p = a; }
    return p;
  }

  end() {
    this.flush();
    this.recording = false;
    this.ringPos = 0;
    this.ringFull = false;
    this.port.postMessage({ type: 'done', peak: this.peak });
  }

  flush() {
    if (!this.len) return;
    const out = this.buf.slice(0, this.len);
    this.port.postMessage({ type: 'chunk', samples: out }, [out.buffer]);
    this.len = 0;
  }

  process(inputs) {
    const chans = inputs[0];
    if (!chans || !chans.length) return true;
    const n = chans[0].length, k = chans.length;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let c = 0; c < k; c++) {
        const s = chans[c][i];
        v += s;
        if (this.recording) { const a = s < 0 ? -s : s; if (a > this.peak) this.peak = a; }
      }
      v /= k;
      if (this.recording) {
        this.buf[this.len++] = v;
        if (this.len === this.buf.length) this.flush();
      } else {
        this.ring[this.ringPos++] = v;
        if (this.ringPos === this.ring.length) { this.ringPos = 0; this.ringFull = true; }
      }
    }
    return true;
  }
}

registerProcessor('ats-capture', AtsCapture);
