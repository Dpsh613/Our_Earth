import * as THREE from 'three';
import { clamp } from '../world/noise';
import { getLivingRiverInfo, getVitality, WATERFALL_BOTTOM } from '../world/terrainData';

export class AmbientSoundscape {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private waterGain: GainNode | null = null;
  private waterFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;

  public enabled = false;
  private nextBirdTime = 3.0;

  public toggle(): boolean {
    if (!this.ctx) {
      this.init();
    }
    this.enabled = !this.enabled;
    if (this.ctx && this.masterGain) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.42 : 0.0, now, 0.65);
    }
    return this.enabled;
  }

  public startIfNotStarted() {
    if (!this.ctx) {
      this.init();
    }
    if (!this.enabled) {
      this.enabled = true;
      if (this.ctx && this.masterGain) {
        if (this.ctx.state === 'suspended') void this.ctx.resume();
        const now = this.ctx.currentTime;
        this.masterGain.gain.setTargetAtTime(0.42, now, 1.4);
      }
    }
  }

  private createNoiseBuffer(ctx: AudioContext, seconds = 4): AudioBuffer {
    const length = ctx.sampleRate * seconds;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Warm pink/brown-weighted noise
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.015) * 1.4;
    }
    return buffer;
  }

  private init() {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.masterGain = master;

    const noiseBuf = this.createNoiseBuffer(ctx, 4);

    // 1. Living / Scarred Wind layer
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 340;
    windFilter.Q.value = 1.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.24;
    windSrc.connect(windFilter).connect(windGain).connect(master);
    windSrc.start();
    this.windFilter = windFilter;
    this.windGain = windGain;

    // 2. Waterfall & Flowing River layer
    const waterSrc = ctx.createBufferSource();
    waterSrc.buffer = noiseBuf;
    waterSrc.loop = true;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'lowpass';
    waterFilter.frequency.value = 950;
    const waterGain = ctx.createGain();
    waterGain.gain.value = 0.08;
    waterSrc.connect(waterFilter).connect(waterGain).connect(master);
    waterSrc.start();
    this.waterFilter = waterFilter;
    this.waterGain = waterGain;

    // 3. Subtle warm emotional harmonic pad (two gentle detuned fifth/octave sine-triangle voices)
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.042;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 380;
    droneGain.connect(droneFilter).connect(master);

    const freqs = [110.0, 164.81, 220.0]; // A2, E3, A3 — warm, contemplative, open
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freqs[i];
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.22;
      osc.connect(g).connect(droneGain);
      osc.start();
    }
    this.droneGain = droneGain;
  }

  private triggerBirdNote(vitality: number) {
    if (!this.ctx || !this.masterGain || !this.enabled || vitality < 0.45) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Soft natural woodland songbird whistle
    const baseFreq = 1850 + Math.random() * 1450;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * (1.16 + Math.random() * 0.14), now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.94, now + 0.22);

    const peak = 0.022 * clamp(vitality, 0, 1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public update(time: number, cameraPos: THREE.Vector3) {
    if (!this.ctx || !this.enabled || !this.windFilter || !this.windGain || !this.waterGain || !this.waterFilter) {
      return;
    }

    const now = this.ctx.currentTime;
    const vit = getVitality(cameraPos.x, cameraPos.z);

    // Distance to waterfall & living river modulates water rush naturally!
    const wfDist = cameraPos.distanceTo(WATERFALL_BOTTOM);
    const riv = getLivingRiverInfo(cameraPos.x, cameraPos.z);
    const wfProximity = clamp(1 - wfDist / 92, 0, 1);
    const rivProximity = clamp(1 - riv.dist / 42, 0, 1);

    const targetWater = 0.03 + wfProximity * wfProximity * 0.34 + rivProximity * 0.12;
    this.waterGain.gain.setTargetAtTime(targetWater, now, 0.25);
    this.waterFilter.frequency.setTargetAtTime(520 + wfProximity * 1400 + rivProximity * 450, now, 0.25);

    // Wind: warm rustling leaves on living side vs deeper hollow desolate wind on scarred basin
    const gust = Math.sin(time * 0.38) * 0.5 + 0.5;
    const windFreq = 210 + vit * 260 + gust * 180;
    const windAmp = 0.16 + (1 - vit) * 0.14 + gust * 0.08;
    this.windFilter.frequency.setTargetAtTime(windFreq, now, 0.35);
    this.windGain.gain.setTargetAtTime(windAmp, now, 0.35);

    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0.034 + vit * 0.018, now, 0.5);
    }

    // Occasional distant woodland birdsong on the living side
    if (time > this.nextBirdTime) {
      this.nextBirdTime = time + 2.8 + Math.random() * 5.2;
      if (vit > 0.48) {
        this.triggerBirdNote(vit);
      }
    }
  }
}
