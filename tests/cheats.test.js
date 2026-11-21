import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEAT_AMMO_AMOUNT,
  CHEAT_MONEY_AMOUNT,
  applyCheat,
  listCheatCodes,
  normalizeCheatCode
} from '../src/core/cheats.js';

function createApi() {
  const calls = { money: 0, ammo: 0, heal: 0, armor: 0, mute: 0 };
  return {
    calls,
    api: {
      addMoney: (n) => { calls.money += n; },
      addAmmo: (n) => { calls.ammo += n; },
      healPlayer: () => { calls.heal += 1; },
      fillArmor: () => { calls.armor += 1; },
      toggleMute: () => { calls.mute += 1; return calls.mute % 2 === 1; }
    }
  };
}

test('normalizeCheatCode ignora caixa, acentos, espaços e símbolos', () => {
  assert.equal(normalizeCheatCode('  MUNIÇÃO! '), 'municao');
  assert.equal(normalizeCheatCode('Dinheiro'), 'dinheiro');
  assert.equal(normalizeCheatCode(null), '');
});

test('código "dinheiro" soma o valor configurado', () => {
  const { api, calls } = createApi();
  const result = applyCheat('Dinheiro', api);
  assert.equal(result.ok, true);
  assert.equal(calls.money, CHEAT_MONEY_AMOUNT);
  assert.match(result.message, /R\$/);
});

test('código "municao" adiciona munição de reserva', () => {
  const { api, calls } = createApi();
  const result = applyCheat('MUNIÇÃO', api);
  assert.equal(result.ok, true);
  assert.equal(calls.ammo, CHEAT_AMMO_AMOUNT);
});

test('código "vida" cura o jogador', () => {
  const { api, calls } = createApi();
  assert.equal(applyCheat('vida', api).ok, true);
  assert.equal(calls.heal, 1);
});

test('código desconhecido ou vazio não altera nada e devolve erro', () => {
  const { api, calls } = createApi();
  assert.equal(applyCheat('xpto', api).ok, false);
  assert.equal(applyCheat('   ', api).ok, false);
  assert.deepEqual(calls, { money: 0, ammo: 0, heal: 0, armor: 0, mute: 0 });
});

test('"ajuda" lista os códigos disponíveis', () => {
  const { api } = createApi();
  const result = applyCheat('ajuda', api);
  assert.equal(result.ok, true);
  for (const { code } of listCheatCodes()) {
    assert.ok(result.message.includes(code));
  }
});

test('código "colete" enche o colete', () => {
  const { api, calls } = createApi();
  assert.equal(applyCheat('Colete', api).ok, true);
  assert.equal(calls.armor, 1);
});

test('código "mudo" alterna o som e informa o estado', () => {
  const { api, calls } = createApi();
  assert.match(applyCheat('mudo', api).message, /desligado/);
  assert.match(applyCheat('mudo', api).message, /ligado/);
  assert.equal(calls.mute, 2);
});

test('"municao" avisa quando a reserva já está cheia', () => {
  const full = { addAmmo: () => 0, addMoney() {}, healPlayer() {}, fillArmor() {}, toggleMute() {} };
  assert.match(applyCheat('municao', full).message, /cheia/);
});
