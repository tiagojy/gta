import test from 'node:test';
import assert from 'node:assert/strict';
import { rollPedestrianCash } from '../src/combat/cash-drops.js';

test('dinheiro dropado varia entre NPCs e fica dentro dos limites', () => {
  const values = new Set();
  for (let i = 0; i < 500; i++) {
    const v = rollPedestrianCash();
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 15 && v <= 400, `valor fora do limite: ${v}`);
    values.add(v);
  }
  assert.ok(values.size > 10, 'esperava valores variados');
});

test('rollPedestrianCash é determinístico com um random fixo', () => {
  assert.equal(rollPedestrianCash(() => 0.5), rollPedestrianCash(() => 0.5));
  // 1º sorteio decide se é um NPC "rico"; o 2º define o valor.
  const seq = (...nums) => { let i = 0; return () => nums[i++ % nums.length]; };
  assert.equal(rollPedestrianCash(seq(0.99, 0)), 15);
  assert.equal(rollPedestrianCash(seq(0.99, 0.999)), 120);
  assert.equal(rollPedestrianCash(seq(0.01, 0.999)), 400);
});
