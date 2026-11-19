import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CityMap } from '../src/world/city-map.js';
import { parseMissionMarkdown } from '../src/story/story-parser.js';
import { SAVE_STORAGE_KEY, createSaveSnapshot, loadGameState, saveGameState } from '../src/core/save-state.js';
import { createWeaponState, restoreWeaponState, WEAPONS } from '../src/combat/weapons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

test('save guarda e restaura dinheiro e arma', () => {
  const storage = createMemoryStorage();
  const snapshot = createSaveSnapshot({
    storyKey: 'hist',
    money: 1250,
    weapon: { id: 'pistol', ammoInMag: 7, ammoReserve: 20 },
    player: { x: 10, y: 20, angle: 0, health: 80 },
  });
  assert.ok(saveGameState(snapshot, storage));

  const loaded = loadGameState('hist', storage);
  assert.equal(loaded.money, 1250);
  assert.deepEqual(loaded.weapon, { id: 'pistol', ammoInMag: 7, ammoReserve: 20 });
});

test('save antigo (sem dinheiro nem arma) continua válido, com dinheiro 0 e arma nula', () => {
  const storage = createMemoryStorage();
  storage.setItem(SAVE_STORAGE_KEY, JSON.stringify({
    version: 1,
    storyKey: 'hist',
    currentMissionIndex: 0,
    unlockedMissionIndices: [0],
    player: { x: 1, y: 2, angle: 0, health: 100 },
  }));
  const loaded = loadGameState('hist', storage);
  assert.ok(loaded);
  assert.equal(loaded.money, 0);
  assert.equal(loaded.weapon, null);
});

test('valores inválidos de dinheiro e munição são corrigidos', () => {
  const snapshot = createSaveSnapshot({
    money: -50,
    weapon: { id: 'pistol', ammoInMag: -3, ammoReserve: 'abc' },
    player: { x: 0, y: 0 },
  });
  assert.equal(snapshot.money, 0);
  assert.deepEqual(snapshot.weapon, { id: 'pistol', ammoInMag: 0, ammoReserve: 0 });
  assert.equal(createSaveSnapshot({ money: 99.9, player: {} }).money, 99);
});

test('restoreWeaponState recupera munição salva, respeitando o tamanho do carregador', () => {
  const state = restoreWeaponState({ id: 'pistol', ammoInMag: 5, ammoReserve: 11 });
  assert.equal(state.ammoInMag, 5);
  assert.equal(state.ammoReserve, 11);
  assert.equal(state.cooldown, 0);

  const capped = restoreWeaponState({ id: 'pistol', ammoInMag: 999, ammoReserve: 4 });
  assert.equal(capped.ammoInMag, WEAPONS.pistol.magSize);
});

test('restoreWeaponState com dado ausente ou inválido volta à pistola padrão', () => {
  const fresh = createWeaponState('pistol', { reserve: 36 });
  assert.deepEqual(restoreWeaponState(null), fresh);
  assert.deepEqual(restoreWeaponState({ id: 'bazuca', ammoInMag: 3 }), fresh);
});

test('missão aceita campo opcional "reward" numérico; sem ele fica nulo', () => {
  const cityMap = new CityMap();
  const file = 'missions/01-caixa-secreta.md';
  const original = fs.readFileSync(path.join(__dirname, '../story', file), 'utf8');

  assert.equal(parseMissionMarkdown(original, file, cityMap).reward, null);

  const withReward = original.replace(/^---\n/, '---\nreward: 250\n');
  assert.equal(parseMissionMarkdown(withReward, file, cityMap).reward, 250);

  const bad = original.replace(/^---\n/, '---\nreward: muito\n');
  assert.equal(parseMissionMarkdown(bad, file, cityMap).reward, null);

  const negative = original.replace(/^---\n/, '---\nreward: -5\n');
  assert.equal(parseMissionMarkdown(negative, file, cityMap).reward, null);
});
