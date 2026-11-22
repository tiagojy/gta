import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_LINES, RECENT_SHOT_WINDOW, pickChatLine } from '../src/story/chat-lines.js';

const general = ['Fala geral 1', 'Fala geral 2'];
const calm = { secondsSinceShot: Infinity, health: 100, armor: 0, insideShop: false, money: 0 };

test('todas as frases cabem no balão (até 60 caracteres)', () => {
  for (const [key, lines] of Object.entries(CONTEXT_LINES)) {
    assert.ok(lines.length >= 3, key);
    for (const line of lines) assert.ok(line.length <= 60, `${key}: ${line}`);
  }
});

test('depois de atirar há pouco, o pedestre fica assustado e foge', () => {
  const r = pickChatLine({ ...calm, secondsSinceShot: 3 }, general, () => 0);
  assert.equal(r.scared, true);
  assert.ok(CONTEXT_LINES.recentShots.includes(r.line));
});

test('passada a janela de tiro, a conversa volta ao normal', () => {
  const r = pickChatLine({ ...calm, secondsSinceShot: RECENT_SHOT_WINDOW + 1 }, general, () => 0.99);
  assert.equal(r.scared, false);
  assert.ok(general.includes(r.line));
});

test('vida baixa, colete, loja e dinheiro puxam falas próprias', () => {
  const rng = () => 0; // sempre cai na fala de contexto
  assert.ok(CONTEXT_LINES.lowHealth.includes(pickChatLine({ ...calm, health: 20 }, general, rng).line));
  assert.ok(CONTEXT_LINES.armored.includes(pickChatLine({ ...calm, armor: 40 }, general, rng).line));
  assert.ok(CONTEXT_LINES.gunShop.includes(pickChatLine({ ...calm, insideShop: true }, general, rng).line));
  assert.ok(CONTEXT_LINES.rich.includes(pickChatLine({ ...calm, money: 5000 }, general, rng).line));
});

test('sem nenhum contexto especial usa só as falas gerais', () => {
  for (let i = 0; i < 20; i++) {
    const r = pickChatLine(calm, general);
    assert.equal(r.scared, false);
    assert.ok(general.includes(r.line));
  }
});
