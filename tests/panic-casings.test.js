import test from 'node:test';
import assert from 'node:assert/strict';
import { scareNearbyPedestrians, scarePedestrian } from '../src/combat/panic.js';
import { CASING_LIFETIME, CASING_MAX, spawnCasing, updateCasings } from '../src/combat/casings.js';

function ped(x, y, extra = {}) {
  return { x, y, state: 'walking', substate: null, ...extra };
}

test('scarePedestrian faz o pedestre fugir na direção oposta ao tiro', () => {
  const p = ped(100, 0, { substate: 'crossing', targetBuilding: {}, returnTarget: {} });
  assert.equal(scarePedestrian(p, 0, 0, 4), true);
  assert.equal(p.state, 'fleeing');
  assert.equal(p.fleeTimer, 4);
  assert.ok(p.dirX > 0.99 && Math.abs(p.dirY) < 1e-6);
  assert.equal(p.substate, null);
  assert.equal(p.targetBuilding, null);
});

test('não assusta pedestre caído, dentro de prédio ou entrando em veículo', () => {
  assert.equal(scarePedestrian(ped(10, 0, { state: 'downed' }), 0, 0), false);
  assert.equal(scarePedestrian(ped(10, 0, { substate: 'inside_building' }), 0, 0), false);
  assert.equal(scarePedestrian(ped(10, 0, { substate: 'boarding_vehicle' }), 0, 0), false);
});

test('quem está bem perto sempre foge, quem está além do raio não', () => {
  const close = ped(50, 0);
  const far = ped(900, 0);
  const n = scareNearbyPedestrians([close, far], 0, 0, 420, () => 0.99);
  assert.equal(n, 1);
  assert.equal(close.state, 'fleeing');
  assert.equal(far.state, 'walking');
});

test('na zona intermediária a chance cai com a distância', () => {
  const mid = () => ped(300, 0); // entre 40% e 100% do raio de 420
  const unlucky = mid();
  assert.equal(scareNearbyPedestrians([unlucky], 0, 0, 420, () => 0.99), 0);
  const lucky = mid();
  assert.equal(scareNearbyPedestrians([lucky], 0, 0, 420, () => 0.01), 1);
});

test('fuga mais perto dura mais e nunca encurta uma fuga em andamento', () => {
  const near = ped(20, 0);
  const farther = ped(350, 0);
  scareNearbyPedestrians([near, farther], 0, 0, 420, () => 0);
  assert.ok(near.fleeTimer > farther.fleeTimer);

  const longFlee = ped(10, 0, { state: 'fleeing', fleeTimer: 9 });
  scarePedestrian(longFlee, 0, 0, 3);
  assert.equal(longFlee.fleeTimer, 9);
});

test('cápsula sai para o lado, perde velocidade e some depois do tempo de vida', () => {
  const list = [];
  spawnCasing(list, 0, 0, 0, [1, 1, 0], () => 0.5);
  assert.equal(list.length, 1);
  const c = list[0];
  assert.ok(c.vy > 0 && Math.abs(c.vx) < 1e-6); // mira para a direita, cápsula cai para baixo (lado)

  const speed0 = Math.hypot(c.vx, c.vy);
  updateCasings(list, 0.1);
  assert.ok(Math.hypot(c.vx, c.vy) < speed0);

  updateCasings(list, CASING_LIFETIME);
  assert.equal(list.length, 0);
});

test('lista de cápsulas tem tamanho máximo', () => {
  const list = [];
  for (let i = 0; i < CASING_MAX + 25; i++) spawnCasing(list, 0, 0, 0, [1, 1, 1]);
  assert.equal(list.length, CASING_MAX);
});
