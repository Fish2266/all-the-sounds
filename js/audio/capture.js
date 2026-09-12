/* ============================================================================
   Capture — microphone to AudioBuffer, sample-exact.

   Frame & Groove records with MediaRecorder, which is right for a three-minute
   disc and wrong for a cow: the browser's compressed container starts a beat
   late and hands back Opus that has to be decoded again. Here the samples come
   straight off an AudioWorklet (capture-worklet.js) with a quarter-second
   pre-roll, and the take is stored as lossless WAV until the one Vorbis pass
   that ships.

   The same small API as Frame & Groove's Recorder: arm, start, stop, disarm,
   and onLevel / onState / onTime for the meter.
   ========================================================================= */

import { audioCtx } from './engine.js';
import { clamp } from '../core/util.js';

const WORKLET = new URL('./capture-worklet.js', import.meta.url).href;
const PRE_ROLL = 0.25;
const loaded = new WeakSet();

export const canCapture = () =>
  !!(navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined');

export class Capture {
  constructor() {
    this.state = 'idle';             // idle | ready | recording
    this.stream = null; this.source = null; this.analyser = null;
    this.node = null; this.sink = null;
    this.onLevel = null; this.onState = null; this.onTime = null;
    this.startedAt = 0; this.clipped = false; this.deviceId = null;
    this._chunks = []; this._pre = 0; this._done = null;
    this._raf = null; this._peakHold = 0;
  }

  async devices() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); }
    catch { return []; }
  }

  async arm({ deviceId = null, echoCancellation = false, noiseSuppression = false, autoGainControl = false } = {}) {
    if (this.state !== 'idle') await this.disarm();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation, noiseSuppression, autoGainControl,
      },
    });
    const ctx = audioCtx();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (!loaded.has(ctx)) { await ctx.audioWorklet.addModule(WORKLET); loaded.add(ctx); }

    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.node = new AudioWorkletNode(ctx, 'ats-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { preRoll: Math.round(ctx.sampleRate * PRE_ROLL) },
    });
    // A worklet only runs while something pulls on it, so it feeds a muted
    // gain into the destination. The microphone never reaches the speakers.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.analyser);
    this.source.connect(this.node);
    this.node.connect(this.sink).connect(ctx.destination);
    this.node.port.onmessage = e => this._message(e.data);

    this.deviceId = this.stream.getAudioTracks()[0]?.getSettings?.().deviceId || deviceId;
    this._set('ready');
    this._meter();
    return this;
  }

  _message(m) {
    if (m.type === 'chunk') {
      if (m.pre) this._pre = m.samples.length;
      this._chunks.push(m.samples);
    } else if (m.type === 'done') {
      const r = this._done; this._done = null; r?.();
    }
  }

  start() {
    if (this.state !== 'ready') throw new Error('The microphone is not armed.');
    this._chunks = []; this._pre = 0; this.clipped = false;
    this.node.port.postMessage({ type: 'start' });
    this.startedAt = performance.now();
    this._set('recording');
  }

  /** Stop and hand back { buffer, preRoll, clipped }, or null if nothing came through. */
  async stop() {
    if (this.state !== 'recording') return null;
    const done = new Promise(r => { this._done = r; setTimeout(r, 1500); });
    this.node.port.postMessage({ type: 'stop' });
    await done;
    this._set('ready');
    const total = this._chunks.reduce((n, c) => n + c.length, 0);
    const pre = this._pre;
    const chunks = this._chunks;
    this._chunks = [];
    if (total - pre < 64) return null;
    const ctx = audioCtx();
    const buffer = ctx.createBuffer(1, total, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    let o = 0;
    for (const c of chunks) { d.set(c, o); o += c.length; }
    return { buffer, preRoll: pre / ctx.sampleRate, clipped: this.clipped };
  }

  /** Stop and throw the take away. */
  async cancel() {
    if (this.state !== 'recording') return;
    await this.stop();
  }

  async disarm() {
    if (this.state === 'recording') await this.stop();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    try { this.source?.disconnect(); this.node?.disconnect(); this.sink?.disconnect(); } catch {}
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.source = null; this.analyser = null; this.node = null; this.sink = null;
    this._set('idle');
  }

  get elapsed() {
    return this.state === 'recording' ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  _set(s) { this.state = s; this.onState?.(s); }

  _meter() {
    const time = new Float32Array(this.analyser.fftSize);
    const freq = new Uint8Array(this.analyser.frequencyBinCount);
    const BARS = 28;
    const bars = new Float32Array(BARS);
    const loop = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(time);
      let sum = 0, peak = 0;
      for (let i = 0; i < time.length; i++) {
        const v = time[i];
        sum += v * v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      if (this.state === 'recording' && peak >= 0.985) this.clipped = true;
      const rms = Math.sqrt(sum / time.length);
      this._peakHold = Math.max(peak, this._peakHold * 0.94);
      this.analyser.getByteFrequencyData(freq);
      for (let b = 0; b < BARS; b++) {
        const lo = Math.floor(Math.pow(b / BARS, 2.1) * freq.length);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((b + 1) / BARS, 2.1) * freq.length));
        let m = 0;
        for (let i = lo; i < hi; i++) m = Math.max(m, freq[i]);
        bars[b] = clamp(m / 255, 0, 1);
      }
      this.onLevel?.(rms, this._peakHold, bars);
      if (this.state === 'recording') this.onTime?.(this.elapsed);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
}

/** dBFS from a linear amplitude, floored for display. */
export function toDb(v) {
  if (v <= 0.00001) return -100;
  return clamp(20 * Math.log10(v), -100, 6);
}
