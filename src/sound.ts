import dogBarkUrl from './sounds/dog-bark.mp3?url';

/**
 * Synthesizes short UI sounds via Web Audio API. One-shot sample
 * playback (currently just the dog bark) is supported as well — the
 * sample is fetched once, decoded, and cached; each `playBark()` call
 * creates a fresh `AudioBufferSourceNode` so overlapping plays work.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  enabled = true;
  /** Decoded dog-bark sample, or null until the fetch/decode resolves. */
  private barkBuffer: AudioBuffer | null = null;
  /** True once we've kicked off the fetch — avoids racing multiple loads. */
  private barkLoadStarted = false;

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** Fetches and decodes the dog-bark MP3 the first time it's called.
   *  Subsequent calls are no-ops. */
  private loadBarkSample() {
    if (this.barkBuffer || this.barkLoadStarted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.barkLoadStarted = true;
    fetch(dogBarkUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => {
        this.barkBuffer = audio;
      })
      .catch((err) => {
        console.warn('[SoundManager] failed to load dog bark sample:', err);
        this.barkLoadStarted = false; // allow a retry
      });
  }

  /**
   * Plays a brief plastic-snap sound: a filtered noise burst (the clack)
   * mixed with a fast-decaying pitched transient (the body of the click).
   */
  playClick() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // --- Noise burst (plastic clack) ---
    const noiseLen = Math.floor(0.05 * ctx.sampleRate);
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      // Decaying white noise
      const env = Math.pow(1 - i / noiseLen, 3);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseHigh = ctx.createBiquadFilter();
    noiseHigh.type = 'highpass';
    noiseHigh.frequency.value = 1800;

    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 3500;
    noiseBand.Q.value = 0.9;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    noiseSource.connect(noiseHigh);
    noiseHigh.connect(noiseBand);
    noiseBand.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start(now);
    noiseSource.stop(now + 0.06);

    // --- Pitched transient (the "tock" body) ---
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.035);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.18, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /** Soft thud for block removal — a muted low-pitched blip. */
  playRemove() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /**
   * Two-note dog whistle — a short high-pitched tone that steps up in
   * frequency mid-way, mimicking a two-tone whistle call. Square-ish
   * harmonics give it a "pea whistle" grain instead of a pure sine.
   */
  playWhistle() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = 0.55;

    // Main tone (triangle ≈ soft pea-whistle). Starts at 2200 Hz,
    // steps up to 2700 Hz halfway through for a "FWEET-fweet" shape.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.setValueAtTime(2200, now + 0.22);
    osc.frequency.linearRampToValueAtTime(2700, now + 0.28);
    osc.frequency.setValueAtTime(2700, now + dur);

    // Slight vibrato for a more natural whistle (LFO → osc.frequency).
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 55; // ±55 Hz wobble
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Amplitude envelope — quick attack, sustain, slight fade
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.setValueAtTime(0.25, now + dur - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    // Band-pass the whistle so it sits where a real whistle lives.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    bp.Q.value = 2.5;

    osc.connect(bp);
    bp.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur + 0.02);
    lfo.stop(now + dur + 0.02);
  }

  /**
   * Plays the dog bark sample (`src/sounds/dog-bark.mp3`). Each call
   * creates a fresh `AudioBufferSourceNode` so multiple dogs can bark
   * simultaneously without clipping each other. The sample is lazily
   * loaded on the first call and cached thereafter. If the fetch/decode
   * is still in flight, the call is silently dropped.
   */
  playBark() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    // Kick off the load on first use (requires an already-unlocked
    // AudioContext on most browsers — guaranteed because every play
    // mode entry is behind a user click).
    if (!this.barkBuffer) {
      this.loadBarkSample();
      return; // sample not ready yet
    }
    const source = ctx.createBufferSource();
    source.buffer = this.barkBuffer;
    // Slight per-play pitch variation (±6%) so multiple dogs don't all
    // sound like a single echo.
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = ctx.createGain();
    gain.gain.value = 0.65;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }
}
