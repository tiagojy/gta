// Sons gerados por código (Web Audio), sem arquivos de áudio.
// O navegador só libera som depois do primeiro clique ou tecla do jogador.

export const SOUND_RECIPES = {
  pistol: { type: 'shot', noiseTime: 0.16, filterFreq: 2600, thumpFreq: [190, 55], thumpTime: 0.12, gain: 0.5 },
  smg: { type: 'shot', noiseTime: 0.09, filterFreq: 3200, thumpFreq: [230, 80], thumpTime: 0.07, gain: 0.36 },
  shotgun: { type: 'shot', noiseTime: 0.34, filterFreq: 1500, thumpFreq: [140, 38], thumpTime: 0.22, gain: 0.8 },
  explosion: { type: 'shot', noiseTime: 1.1, filterFreq: 700, thumpFreq: [110, 28], thumpTime: 0.6, gain: 0.95 },
  reload: {
    type: 'clicks', gain: 0.3,
    clicks: [{ t: 0, freq: 1700, dur: 0.035 }, { t: 0.32, freq: 1100, dur: 0.05 }, { t: 0.62, freq: 1900, dur: 0.03 }]
  },
  empty: { type: 'clicks', gain: 0.3, clicks: [{ t: 0, freq: 1300, dur: 0.03 }] },
  switch: { type: 'clicks', gain: 0.22, clicks: [{ t: 0, freq: 900, dur: 0.03 }, { t: 0.07, freq: 1400, dur: 0.03 }] },
  pickup: { type: 'notes', gain: 0.25, notes: [{ t: 0, freq: 660, dur: 0.12 }, { t: 0.09, freq: 990, dur: 0.2 }] }
};

export const MUTE_STORAGE_KEY = 'gta-cv-muted';
const MIN_REPEAT_SECONDS = 0.025;

function defaultContextFactory() {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

function readMuted(storage) {
  try {
    return storage?.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export class SoundManager {
  constructor({ contextFactory = defaultContextFactory, storage = globalThis.localStorage } = {}) {
    this.contextFactory = contextFactory;
    this.storage = storage;
    this.muted = readMuted(storage);
    this.ctx = null;
    this.noiseBuffer = null;
    this.lastPlayed = new Map();
    this.unlockHandler = null;
    this.unlockTarget = null;
  }

  // Cria o contexto de áudio no primeiro gesto do jogador (exigência dos navegadores).
  attachUnlock(target = globalThis.window) {
    if (!target?.addEventListener) return;
    this.unlockTarget = target;
    this.unlockHandler = () => {
      this.#ensureContext();
      if (this.ctx) this.#detachUnlock();
    };
    target.addEventListener('pointerdown', this.unlockHandler);
    target.addEventListener('keydown', this.unlockHandler);
  }

  #detachUnlock() {
    if (!this.unlockTarget || !this.unlockHandler) return;
    this.unlockTarget.removeEventListener?.('pointerdown', this.unlockHandler);
    this.unlockTarget.removeEventListener?.('keydown', this.unlockHandler);
    this.unlockHandler = null;
  }

  #ensureContext() {
    if (!this.ctx) {
      try {
        this.ctx = this.contextFactory();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume?.();
    return this.ctx;
  }

  isMuted() {
    return this.muted;
  }

  setMuted(value) {
    this.muted = Boolean(value);
    try {
      this.storage?.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // sem armazenamento: o mudo vale só nesta sessão
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  // Toca um som. volume vai de 0 a 1 (use para atenuar pela distância).
  play(name, volume = 1) {
    const recipe = SOUND_RECIPES[name];
    if (!recipe || this.muted || !(volume > 0)) return false;
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return false; // ainda sem gesto do jogador
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < MIN_REPEAT_SECONDS) return false;
    this.lastPlayed.set(name, now);

    const gain = recipe.gain * Math.max(0, Math.min(1, volume));
    if (recipe.type === 'shot') this.#playShot(ctx, recipe, gain, now);
    else if (recipe.type === 'clicks') this.#playTones(ctx, recipe.clicks, 'square', gain, now);
    else if (recipe.type === 'notes') this.#playTones(ctx, recipe.notes, 'sine', gain, now);
    return true;
  }

  #getNoise(ctx) {
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 1.3);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  #playShot(ctx, recipe, gain, now) {
    // estalo: ruído filtrado que some rápido
    const noise = ctx.createBufferSource();
    noise.buffer = this.#getNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(recipe.filterFreq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, recipe.filterFreq * 0.25), now + recipe.noiseTime);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(gain, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + recipe.noiseTime);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + recipe.noiseTime + 0.05);

    // corpo: tom grave que desce rápido
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(recipe.thumpFreq[0], now);
    osc.frequency.exponentialRampToValueAtTime(recipe.thumpFreq[1], now + recipe.thumpTime);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(gain * 0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + recipe.thumpTime);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + recipe.thumpTime + 0.05);
  }

  #playTones(ctx, tones, wave, gain, now) {
    for (const tone of tones) {
      const start = now + tone.t;
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(tone.freq, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + tone.dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + tone.dur + 0.03);
    }
  }

  destroy() {
    this.#detachUnlock();
    try {
      this.ctx?.close?.();
    } catch {
      // ignorar
    }
    this.ctx = null;
  }
}
