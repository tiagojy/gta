import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ARMOR, absorbDamage, addArmor, sanitizeArmor } from '../src/combat/armor.js';
import { addWeapon, createArsenal, equipWeapon, getEquipped } from '../src/combat/arsenal.js';
import { WEAPONS } from '../src/combat/weapons.js';
import {
  PICKUP_CONFIG,
  PICKUP_TYPES,
  applyPickupEffect,
  createPickupState,
  findPickupsInReach,
  removePickup,
  rollPickupType,
  updatePickups
} from '../src/combat/pickups.js';

const always = () => true;

test('colete absorve o dano primeiro e a vida leva só o que sobrar', () => {
  assert.deepEqual(absorbDamage(50, 20), { armor: 30, healthDamage: 0, absorbed: 20 });
  assert.deepEqual(absorbDamage(10, 25), { armor: 0, healthDamage: 15, absorbed: 10 });
  assert.deepEqual(absorbDamage(0, 12), { armor: 0, healthDamage: 12, absorbed: 0 });
});

test('colete respeita limites e valores inválidos', () => {
  assert.equal(addArmor(80, 50), MAX_ARMOR);
  assert.equal(sanitizeArmor(-5), 0);
  assert.equal(sanitizeArmor('abc'), 0);
  assert.equal(sanitizeArmor(999), MAX_ARMOR);
});

test('rollPickupType sorteia só tipos válidos e respeita os pesos nas pontas', () => {
  assert.ok(PICKUP_TYPES[rollPickupType(() => 0)]);
  assert.equal(rollPickupType(() => 0), 'ammo');
  assert.equal(rollPickupType(() => 0.999), 'armor');
});

test('o gerador cria itens longe do jogador e para ao atingir a meta', () => {
  const state = createPickupState();
  const ctx = { px: 1000, py: 1000, isValidPoint: always, rng: Math.random };
  for (let i = 0; i < 200; i++) updatePickups(state, 1.3, ctx);

  assert.equal(state.items.length, PICKUP_CONFIG.target);
  for (const item of state.items) {
    const d = Math.hypot(item.x - 1000, item.y - 1000);
    assert.ok(d >= PICKUP_CONFIG.minDist - 1 && d <= PICKUP_CONFIG.maxDist + 1, `distância ${d}`);
  }
});

test('pontos inválidos (parede, rua) não geram item', () => {
  const state = createPickupState();
  for (let i = 0; i < 20; i++) updatePickups(state, 1.3, { px: 0, py: 0, isValidPoint: () => false });
  assert.equal(state.items.length, 0);
});

test('itens velhos ou muito distantes são removidos', () => {
  const state = createPickupState();
  state.items.push({ id: 1, type: 'ammo', x: 0, y: 0, age: 0 });
  state.items.push({ id: 2, type: 'ammo', x: 100, y: 0, age: PICKUP_CONFIG.lifetime - 0.1 });
  state.spawnTimer = 99;
  updatePickups(state, 0.5, { px: 100, py: 0, isValidPoint: always });
  assert.deepEqual(state.items.map((i) => i.id), [1]); // o 2 envelheceu demais

  updatePickups(state, 0.1, { px: 5000, py: 0, isValidPoint: always });
  assert.equal(state.items.length, 0); // o 1 ficou longe demais
});

test('findPickupsInReach ordena por distância e removePickup tira o item', () => {
  const state = createPickupState();
  const far = { id: 1, type: 'medkit', x: 20, y: 0, age: 0 };
  const near = { id: 2, type: 'ammo', x: 5, y: 0, age: 0 };
  state.items.push(far, near);
  assert.deepEqual(findPickupsInReach(state, 0, 0, 24).map((i) => i.id), [2, 1]);
  assert.equal(findPickupsInReach(state, 0, 0, 10).length, 1);
  removePickup(state, near);
  assert.equal(state.items.length, 1);
});

test('kit médico cura até 100 e não é consumido com a vida cheia', () => {
  const arsenal = createArsenal();
  let r = applyPickupEffect('medkit', { arsenal, health: 30, armor: 0 });
  assert.equal(r.consumed, true);
  assert.equal(r.health, 80);

  r = applyPickupEffect('medkit', { arsenal, health: 80, armor: 0 });
  assert.equal(r.health, 100);

  r = applyPickupEffect('medkit', { arsenal, health: 100, armor: 0 });
  assert.equal(r.consumed, false);
});

test('colete soma até o máximo e não é consumido com colete cheio', () => {
  const arsenal = createArsenal();
  let r = applyPickupEffect('armor', { arsenal, health: 100, armor: 0 });
  assert.equal(r.armor, 50);
  r = applyPickupEffect('armor', { arsenal, health: 100, armor: 70 });
  assert.equal(r.armor, MAX_ARMOR);
  r = applyPickupEffect('armor', { arsenal, health: 100, armor: MAX_ARMOR });
  assert.equal(r.consumed, false);
});

test('caixa de munição enche a arma da mão; se estiver cheia, tenta outra arma', () => {
  const arsenal = createArsenal();
  addWeapon(arsenal, 'shotgun', { reserve: 0 });
  equipWeapon(arsenal, 'shotgun');

  let r = applyPickupEffect('ammo', { arsenal, health: 100, armor: 0 });
  assert.equal(r.consumed, true);
  assert.equal(arsenal.weapons.shotgun.ammoReserve, WEAPONS.shotgun.pickupAmmo);

  arsenal.weapons.shotgun.ammoReserve = WEAPONS.shotgun.maxReserve; // escopeta cheia
  r = applyPickupEffect('ammo', { arsenal, health: 100, armor: 0 });
  assert.equal(r.consumed, true); // foi para a pistola
  assert.ok(arsenal.weapons.pistol.ammoReserve > 36);
  assert.equal(getEquipped(arsenal).id, 'shotgun');

  arsenal.weapons.pistol.ammoReserve = WEAPONS.pistol.maxReserve;
  r = applyPickupEffect('ammo', { arsenal, health: 100, armor: 0 });
  assert.equal(r.consumed, false); // tudo cheio
});
