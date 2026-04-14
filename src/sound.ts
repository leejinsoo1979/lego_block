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

  // ==================================================================
  //                         PAC-MAN SOUNDS
  // ==================================================================
  // All synthesized via Web Audio — no samples needed. Pitches are
  // based on the classic arcade tunes, simplified but recognisable.

  /** The "wakka" alternates between two toggling frequencies. Each call
   *  plays ONE wakka (the next half of the pair), so chomps during rapid
   *  pellet collection sound like the continuous waka-waka-waka-waka. */
  private wakaToggle = false;
  playPacmanChomp() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.09;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    // Alternating "wa" (low) / "ka" (high) — two different pitches per pair
    const hi = 880;
    const lo = 440;
    if (this.wakaToggle) {
      osc.frequency.setValueAtTime(lo, now);
      osc.frequency.linearRampToValueAtTime(hi, now + dur);
    } else {
      osc.frequency.setValueAtTime(hi, now);
      osc.frequency.linearRampToValueAtTime(lo, now + dur);
    }
    this.wakaToggle = !this.wakaToggle;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Power-pellet eaten — a deeper, slower "wa-ka" than the regular chomp. */
  playPacmanPower() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.24;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(660, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.setValueAtTime(0.22, now + dur - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Ghost eaten — short upward glissando, bright. */
  playPacmanGhostEaten() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.35;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(330, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Classic Pac-Man death — descending warble (pitch drop with vibrato). */
  playPacmanDeath() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 1.5;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    // Descending pitch with wobble
    osc.frequency.setValueAtTime(660, now);
    // Stepwise descent
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const t = now + (i / steps) * dur;
      const f = 660 * Math.pow(0.1, i / steps);
      osc.frequency.setValueAtTime(f, t);
    }

    // Vibrato LFO
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 14;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 45;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.04);
    gain.gain.setValueAtTime(0.22, now + dur - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur + 0.05);
    lfo.stop(now + dur + 0.05);
  }

  /** Extra-life / victory jingle — short rising arpeggio. */
  playPacmanJingle() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Notes (approx): C6 E6 G6 C7 — rising major arpeggio
    const notes = [1047, 1319, 1568, 2093];
    const noteDur = 0.12;
    for (let i = 0; i < notes.length; i++) {
      const t = now + i * noteDur;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(notes[i], t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteDur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteDur + 0.02);
    }
  }

  /** Short victory fanfare (after clearing all pellets). */
  playPacmanVictory() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // G5 C6 E6 G6 C7 — bright fanfare
    const notes = [784, 1047, 1319, 1568, 2093];
    const noteDur = 0.16;
    for (let i = 0; i < notes.length; i++) {
      const t = now + i * noteDur;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(notes[i], t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteDur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteDur + 0.02);
    }
  }

  // ---- Iconic Pac-Man intro melody ----
  // Simplified transcription of the arcade intro, playable with a
  // 2-oscillator lead + bass. ~4 seconds. Returns the estimated
  // duration so callers can chain the siren after it finishes.
  playPacmanIntro(): number {
    if (!this.enabled) return 0;
    const ctx = this.ensureContext();
    if (!ctx) return 0;
    const now = ctx.currentTime;
    // Phrase: the famous opening.
    // Rhythm: sixteenth-note pattern, ~168 bpm → each 16th ≈ 0.089s.
    const u = 0.089; // unit = 1/16 note
    type Note = { f: number; t: number; d: number };
    // Melody voice (lead)
    const lead: Note[] = [
      // "C5 C6 G5 E5 C6 G5 E5"
      { f: 523, t: 0,       d: u },
      { f: 1047, t: u,      d: u },
      { f: 784, t: u * 2,   d: u },
      { f: 659, t: u * 3,   d: u * 2 },
      { f: 1047, t: u * 5,  d: u * 0.5 },
      { f: 784, t: u * 6,   d: u * 1.5 },
      { f: 659, t: u * 7.5, d: u * 2 },
      // Second half: "C#5 C#6 G#5 F5 C#6 G#5 F5"
      { f: 554, t: u * 10,  d: u },
      { f: 1109, t: u * 11, d: u },
      { f: 831, t: u * 12,  d: u },
      { f: 698, t: u * 13,  d: u * 2 },
      { f: 1109, t: u * 15, d: u * 0.5 },
      { f: 831, t: u * 16,  d: u * 1.5 },
      { f: 698, t: u * 17.5, d: u * 2 },
      // Final: chromatic run up + landing
      { f: 659, t: u * 20,  d: u },
      { f: 698, t: u * 21,  d: u },
      { f: 740, t: u * 22,  d: u },
      { f: 784, t: u * 23,  d: u * 2 },
      { f: 880, t: u * 25,  d: u * 4 },
    ];
    const totalDur = u * 30;
    for (const n of lead) {
      const t0 = now + n.t;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(n.f, t0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.008);
      gain.gain.setValueAtTime(0.16, t0 + n.d - 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + n.d);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + n.d + 0.01);
    }
    return totalDur;
  }

  // ---- Siren loop (ghost chase background) ----
  // Plays a repeating rising-falling tone that loops until stopped. Call
  // stopPacmanSiren() to cancel.
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  playPacmanSiren(level = 1) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopPacmanSiren();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    const gain = ctx.createGain();
    gain.gain.value = 0.06; // quiet background

    // Each "cycle" rises from base to base*1.5 then back down — 0.5s loop.
    // Higher levels speed it up and raise the base pitch, matching arcade.
    const base = 180 + (level - 1) * 25;
    const cycle = Math.max(0.28, 0.5 - (level - 1) * 0.04);
    const cycles = 600; // enough for ~5 minutes at cycle=0.5
    for (let i = 0; i < cycles; i++) {
      const t = now + i * cycle;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base * 1.5, t + cycle * 0.5);
      osc.frequency.linearRampToValueAtTime(base, t + cycle);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    this.sirenOsc = osc;
    this.sirenGain = gain;
  }
  stopPacmanSiren() {
    if (!this.ctx || !this.sirenOsc || !this.sirenGain) {
      this.sirenOsc = null;
      this.sirenGain = null;
      return;
    }
    const now = this.ctx.currentTime;
    try {
      this.sirenGain.gain.cancelScheduledValues(now);
      this.sirenGain.gain.setValueAtTime(this.sirenGain.gain.value, now);
      this.sirenGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      this.sirenOsc.stop(now + 0.1);
    } catch {
      /* already stopped */
    }
    this.sirenOsc = null;
    this.sirenGain = null;
  }
}
