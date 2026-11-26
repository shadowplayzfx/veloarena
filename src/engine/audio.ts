import type { AudioSettings } from '../shared/types.ts';

export class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private boostNoiseNode: AudioBufferSourceNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;
  private boostGain: GainNode | null = null;

  private squealNoiseNode: AudioBufferSourceNode | null = null;
  private squealFilter: BiquadFilterNode | null = null;
  private squealGain: GainNode | null = null;

  private musicTimer: number | null = null;
  private musicStep = 0;

  private settings: AudioSettings = {
    masterVolume: 0.75,
    sfxVolume: 0.85,
    musicVolume: 0.45,
  };

  private unlocked = false;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();

      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.applyVolumes();
      this.setupContinuousLoops();
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.unlocked = true;
  }

  public updateSettings(settings: AudioSettings): void {
    this.settings = { ...settings };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.masterGain || !this.sfxGain || !this.musicGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.settings.masterVolume, now, 0.03);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfxVolume, now, 0.03);
    this.musicGain.gain.setTargetAtTime(this.settings.musicVolume, now, 0.03);
  }

  private createNoiseBuffer(seconds = 2): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private setupContinuousLoops(): void {
    if (!this.ctx || !this.sfxGain) return;

    // Engine hum
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 110;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 260;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxGain);

    this.engineOsc.start();
    this.engineOsc2.start();

    // Boost rocket roar
    const noiseBuf = this.createNoiseBuffer(2);
    if (noiseBuf) {
      this.boostNoiseNode = this.ctx.createBufferSource();
      this.boostNoiseNode.buffer = noiseBuf;
      this.boostNoiseNode.loop = true;

      this.boostFilter = this.ctx.createBiquadFilter();
      this.boostFilter.type = 'bandpass';
      this.boostFilter.frequency.value = 420;
      this.boostFilter.Q.value = 0.8;

      this.boostGain = this.ctx.createGain();
      this.boostGain.gain.value = 0;

      this.boostNoiseNode.connect(this.boostFilter);
      this.boostFilter.connect(this.boostGain);
      this.boostGain.connect(this.sfxGain);
      this.boostNoiseNode.start();

      // Tire drift squeal loop
      this.squealNoiseNode = this.ctx.createBufferSource();
      this.squealNoiseNode.buffer = noiseBuf;
      this.squealNoiseNode.loop = true;

      this.squealFilter = this.ctx.createBiquadFilter();
      this.squealFilter.type = 'bandpass';
      this.squealFilter.frequency.value = 1480;
      this.squealFilter.Q.value = 7.5;

      this.squealGain = this.ctx.createGain();
      this.squealGain.gain.value = 0;

      this.squealNoiseNode.connect(this.squealFilter);
      this.squealFilter.connect(this.squealGain);
      this.squealGain.connect(this.sfxGain);
      this.squealNoiseNode.start();
    }
  }

  public updateVehicleAudio(
    active: boolean,
    speed: number,
    throttle: number,
    isBoosting: boolean,
    driftIntensity = 0
  ): void {
    if (!this.ctx || !this.unlocked || !this.engineGain || !this.engineOsc || !this.engineOsc2 || !this.engineFilter) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      if (this.boostGain) this.boostGain.gain.setTargetAtTime(0, now, 0.06);
      if (this.squealGain) this.squealGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const rpmRatio = Math.min(1, speed / 42);
    const pitch = 48 + rpmRatio * 98 + Math.abs(throttle) * 18 + (isBoosting ? 24 : 0);
    this.engineOsc.frequency.setTargetAtTime(pitch, now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(pitch * 1.98, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(220 + rpmRatio * 540 + Math.abs(throttle) * 180, now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.045 + Math.abs(throttle) * 0.035 + rpmRatio * 0.025, now, 0.06);

    if (this.boostGain && this.boostFilter) {
      this.boostGain.gain.setTargetAtTime(isBoosting ? 0.19 : 0, now, 0.04);
      this.boostFilter.frequency.setTargetAtTime(isBoosting ? 580 + rpmRatio * 340 : 300, now, 0.05);
    }

    if (this.squealGain && this.squealFilter) {
      const squealLevel = driftIntensity > 0.18 ? Math.min(0.14, (driftIntensity - 0.18) * 0.2) : 0;
      this.squealGain.gain.setTargetAtTime(squealLevel, now, 0.04);
      this.squealFilter.frequency.setTargetAtTime(1250 + rpmRatio * 480, now, 0.05);
    }
  }

  public playJump(): void {
    if (!this.ctx || !this.sfxGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.14);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playBallImpact(intensity = 0.6): void {
    if (!this.ctx || !this.sfxGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0.15, Math.min(1, intensity));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 + clamped * 60, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);

    gain.gain.setValueAtTime(0.32 * clamped, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playBoostPickup(): void {
    if (!this.ctx || !this.sfxGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playCountdown(isGo = false): void {
    if (!this.ctx || !this.sfxGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isGo ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
    if (isGo) {
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.25);
    }
    gain.gain.setValueAtTime(isGo ? 0.22 : 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.35 : 0.18));
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.36 : 0.2));
  }

  public playDemolition(): void {
    if (!this.ctx || !this.sfxGain || !this.unlocked) return;
    const now = this.ctx.currentTime;

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(165, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.55);
    subGain.gain.setValueAtTime(0.42, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.62);

    const buf = this.createNoiseBuffer(0.65);
    if (buf) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1600, now);
      lp.frequency.exponentialRampToValueAtTime(180, now + 0.6);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.32, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
      noise.connect(lp);
      lp.connect(ng);
      ng.connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 0.64);
    }
  }

  public playGoal(): void {
    if (!this.ctx || !this.sfxGain || !this.unlocked) return;
    const now = this.ctx.currentTime;

    // Deep explosion punch
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.9);
    subGain.gain.setValueAtTime(0.45, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.98);

    // Stadium victory horn chord
    const freqs = [220, 277.18, 329.63, 440];
    freqs.forEach((f) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now + 0.05);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.45);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + 0.05);
      osc.stop(now + 1.5);
    });

    // Crowd cheer swell (filtered noise)
    const buf = this.createNoiseBuffer(1.8);
    if (buf) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 950;
      bp.Q.value = 0.7;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.001, now);
      ng.gain.linearRampToValueAtTime(0.18, now + 0.25);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 1.75);
      noise.connect(bp);
      bp.connect(ng);
      ng.connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 1.8);
    }
  }

  public startMenuMusic(): void {
    if (this.musicTimer !== null) return;
    const notes = [130.81, 164.81, 196.0, 246.94, 196.0, 164.81, 146.83, 196.0];
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || !this.unlocked || this.settings.musicVolume <= 0.01) return;
      const now = this.ctx.currentTime;
      const freq = notes[this.musicStep % notes.length];
      this.musicStep++;

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(780, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 0.7);
    }, 450);
  }

  public stopMenuMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  public dispose(): void {
    this.stopMenuMusic();
    try {
      this.engineOsc?.stop();
      this.engineOsc2?.stop();
      this.boostNoiseNode?.stop();
      this.squealNoiseNode?.stop();
      void this.ctx?.close();
    } catch {
      // ignore cleanup errors
    }
    this.ctx = null;
  }
}
