import test from 'node:test';
import assert from 'node:assert/strict';
import { MUTE_STORAGE_KEY, SOUND_RECIPES, SoundManager } from '../src/audio/sound-manager.js';

function fakeContext() {
  const log = { sources: 0, oscillators: 0, gains: 0, started: 0 };
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect() {}, ...extra });
  const ctx = {
    state: 'running', currentTime: 1, sampleRate: 8000, destination: {},
    log,
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => { log.sources++; return node({ start() { log.started++; }, stop() {} }); },
    createBiquadFilter: () => node({ frequency: param() }),
    createGain: () => { log.gains++; return node({ gain: param() }); },
    createOscillator: () => { log.oscillators++; return node({ frequency: param(), start() { log.started++; }, stop() {} }); },
    resume() { this.state = 'running'; },
    close() { this.state = 'closed'; }
  };
  return ctx;
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

function createManager(options = {}) {
  const ctx = fakeContext();
  const manager = new SoundManager({ contextFactory: () => ctx, storage: memoryStorage(), ...options });
  return { manager, ctx };
}

function unlock(manager) {
  const handlers = {};
  manager.attachUnlock({
    addEventListener: (type, fn) => { handlers[type] = fn; },
    removeEventListener: (type) => { delete handlers[type]; }
  });
  return handlers;
}

test('sem gesto do jogador nada toca e nada quebra', () => {
  const { manager, ctx } = createManager();
  assert.equal(manager.play('pistol'), false);
  assert.equal(ctx.log.started, 0);
});

test('o primeiro clique ou tecla libera o áudio e o contexto é criado uma vez', () => {
  const { manager } = createManager();
  const handlers = unlock(manager);
  assert.ok(handlers.pointerdown && handlers.keydown);
  handlers.keydown();
  assert.ok(manager.ctx);
  assert.deepEqual(Object.keys(handlers), []); // ouvintes removidos depois de liberar
  assert.equal(manager.play('pistol'), true);
});

test('cada tipo de som agenda os nós esperados', () => {
  const { manager, ctx } = createManager();
  unlock(manager).keydown();

  ctx.currentTime = 2; manager.play('shotgun');
  assert.equal(ctx.log.sources, 1);
  assert.equal(ctx.log.oscillators, 1);

  ctx.currentTime = 3; manager.play('reload');
  assert.equal(ctx.log.oscillators, 1 + SOUND_RECIPES.reload.clicks.length);

  ctx.currentTime = 4; manager.play('pickup');
  assert.equal(ctx.log.oscillators, 1 + SOUND_RECIPES.reload.clicks.length + SOUND_RECIPES.pickup.notes.length);
});

test('som repetido em intervalo mínimo é ignorado (não empilha)', () => {
  const { manager, ctx } = createManager();
  unlock(manager).keydown();
  ctx.currentTime = 5;
  assert.equal(manager.play('smg'), true);
  ctx.currentTime = 5.01;
  assert.equal(manager.play('smg'), false);
  ctx.currentTime = 5.1;
  assert.equal(manager.play('smg'), true);
});

test('mudo silencia e fica salvo; volume zero e som inexistente não tocam', () => {
  const storage = memoryStorage();
  const { manager, ctx } = createManager({ storage });
  unlock(manager).keydown();

  assert.equal(manager.toggleMute(), true);
  assert.equal(storage.getItem(MUTE_STORAGE_KEY), '1');
  assert.equal(manager.play('pistol'), false);

  manager.setMuted(false);
  ctx.currentTime = 9;
  assert.equal(manager.play('naoexiste'), false);
  assert.equal(manager.play('pistol', 0), false);
  assert.equal(manager.play('pistol', 0.5), true);

  const again = new SoundManager({ contextFactory: () => ctx, storage: memoryStorage({ [MUTE_STORAGE_KEY]: '1' }) });
  assert.equal(again.isMuted(), true);
});

test('sem suporte a áudio no navegador, tudo segue funcionando em silêncio', () => {
  const manager = new SoundManager({ contextFactory: () => null, storage: memoryStorage() });
  unlock(manager).pointerdown();
  assert.equal(manager.play('pistol'), false);
  manager.destroy();
});
