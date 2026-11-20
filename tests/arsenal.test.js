import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addWeapon,
  createArsenal,
  cycleWeapon,
  equipSlot,
  equipWeapon,
  getEquipped,
  hasWeapon,
  ownedWeaponIds,
  restoreArsenal,
  serializeArsenal
} from '../src/combat/arsenal.js';
import { startReload } from '../src/combat/weapons.js';

test('arsenal começa só com a pistola na mão', () => {
  const arsenal = createArsenal();
  assert.deepEqual(ownedWeaponIds(arsenal), ['pistol']);
  assert.equal(getEquipped(arsenal).id, 'pistol');
  assert.equal(getEquipped(arsenal).ammoReserve, 36);
});

test('addWeapon adiciona arma nova, recusa repetida ou inexistente', () => {
  const arsenal = createArsenal();
  assert.equal(addWeapon(arsenal, 'smg', { reserve: 30 }), true);
  assert.equal(arsenal.weapons.smg.ammoReserve, 30);
  assert.equal(addWeapon(arsenal, 'smg'), false);
  assert.equal(addWeapon(arsenal, 'bazuca'), false);
  assert.deepEqual(ownedWeaponIds(arsenal), ['pistol', 'smg']);
});

test('equipSlot usa a ordem das teclas e só equipa arma que possui', () => {
  const arsenal = createArsenal();
  addWeapon(arsenal, 'shotgun');
  assert.equal(equipSlot(arsenal, 1), null); // smg não comprada
  assert.equal(equipSlot(arsenal, 2).id, 'shotgun');
  assert.equal(arsenal.equippedId, 'shotgun');
  assert.equal(equipSlot(arsenal, 0).id, 'pistol');
  assert.equal(equipSlot(arsenal, 9), null);
});

test('trocar de arma cancela a recarga da arma anterior', () => {
  const arsenal = createArsenal();
  addWeapon(arsenal, 'smg');
  getEquipped(arsenal).ammoInMag = 3;
  assert.ok(startReload(getEquipped(arsenal)));
  equipWeapon(arsenal, 'smg');
  assert.equal(arsenal.weapons.pistol.reloadTimer, 0);
});

test('cycleWeapon percorre só as armas que o jogador tem, em ambos os sentidos', () => {
  const arsenal = createArsenal();
  assert.equal(cycleWeapon(arsenal, 1).id, 'pistol'); // só uma arma: não muda
  addWeapon(arsenal, 'smg');
  addWeapon(arsenal, 'shotgun');
  assert.equal(cycleWeapon(arsenal, 1).id, 'smg');
  assert.equal(cycleWeapon(arsenal, 1).id, 'shotgun');
  assert.equal(cycleWeapon(arsenal, 1).id, 'pistol'); // volta ao início
  assert.equal(cycleWeapon(arsenal, -1).id, 'shotgun');
});

test('serializeArsenal e restoreArsenal preservam armas, munição e arma da mão', () => {
  const arsenal = createArsenal();
  addWeapon(arsenal, 'shotgun', { reserve: 20 });
  arsenal.weapons.shotgun.ammoInMag = 2;
  equipWeapon(arsenal, 'shotgun');

  const restored = restoreArsenal(serializeArsenal(arsenal));
  assert.deepEqual(ownedWeaponIds(restored), ['pistol', 'shotgun']);
  assert.equal(restored.equippedId, 'shotgun');
  assert.equal(restored.weapons.shotgun.ammoInMag, 2);
  assert.equal(restored.weapons.shotgun.ammoReserve, 20);
});

test('restoreArsenal aceita o save antigo de arma única e dados inválidos', () => {
  const legacy = restoreArsenal(null, { id: 'pistol', ammoInMag: 4, ammoReserve: 9 });
  assert.equal(legacy.equippedId, 'pistol');
  assert.equal(legacy.weapons.pistol.ammoInMag, 4);
  assert.equal(legacy.weapons.pistol.ammoReserve, 9);

  assert.deepEqual(ownedWeaponIds(restoreArsenal(null)), ['pistol']);
  assert.deepEqual(ownedWeaponIds(restoreArsenal({ owned: [{ id: 'bazuca' }] })), ['pistol']);

  const fallbackEquip = restoreArsenal({ equipped: 'smg', owned: [{ id: 'pistol', ammoInMag: 1, ammoReserve: 1 }] });
  assert.equal(fallbackEquip.equippedId, 'pistol');
  assert.equal(hasWeapon(fallbackEquip, 'smg'), false);
});
