import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CityMap } from '../src/world/city-map.js';
import { addWeapon, createArsenal, getEquipped } from '../src/combat/arsenal.js';
import { WEAPONS, addAmmo, createWeaponState, tryFireBullets, WEAPON_ORDER } from '../src/combat/weapons.js';
import { GUN_SHOP_CODE, GUN_SHOP_NAME, SHOP_ITEMS, describeOffers, purchaseItem } from '../src/shop/shop-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixedMid = () => 0.5;

test('a armaria existe no mapa como comércio com balcão e nome certo', () => {
  const map = new CityMap();
  const shop = map.resolveLocationCode(GUN_SHOP_CODE);
  assert.ok(shop);
  assert.equal(shop.type, 'commerce');
  assert.ok(shop.interior.props.some((p) => p.kind === 'counter'));
  assert.equal(shop.roofColor, '#7f1d1d');

  const mapMd = fs.readFileSync(path.join(__dirname, '../story/map/map.md'), 'utf8');
  assert.match(mapMd, new RegExp(`^${GUN_SHOP_CODE}: ${GUN_SHOP_NAME}$`, 'm'));
});

test('a armaria não é local de nenhuma missão ou item da história', () => {
  const dirs = ['missions', 'items'].map((d) => path.join(__dirname, '../story', d));
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      assert.equal(text.includes(GUN_SHOP_CODE), false, `${file} usa ${GUN_SHOP_CODE}`);
    }
  }
});

test('compra de arma desconta o dinheiro, entrega a arma com munição e já equipa', () => {
  const arsenal = createArsenal();
  const smg = SHOP_ITEMS.find((i) => i.id === 'weapon-smg');
  const result = purchaseItem('weapon-smg', arsenal, smg.price + 40);

  assert.equal(result.ok, true);
  assert.equal(result.money, 40);
  assert.equal(arsenal.weapons.smg.ammoReserve, smg.startingAmmo);
  assert.equal(getEquipped(arsenal).id, 'smg');
});

test('sem dinheiro, nada é vendido e o saldo não muda', () => {
  const arsenal = createArsenal();
  const result = purchaseItem('weapon-shotgun', arsenal, 10);
  assert.equal(result.ok, false);
  assert.equal(result.money, 10);
  assert.equal(arsenal.weapons.shotgun, undefined);
});

test('não vende a mesma arma duas vezes nem item inexistente', () => {
  const arsenal = createArsenal();
  addWeapon(arsenal, 'smg');
  assert.equal(purchaseItem('weapon-smg', arsenal, 9999).ok, false);
  assert.equal(purchaseItem('item-fantasma', arsenal, 9999).ok, false);
});

test('munição só é vendida para arma que o jogador possui', () => {
  const arsenal = createArsenal();
  const result = purchaseItem('ammo-shotgun', arsenal, 9999);
  assert.equal(result.ok, false);
  assert.equal(result.money, 9999);
});

test('munição soma na reserva e cobra o preço do pacote', () => {
  const arsenal = createArsenal();
  const pack = SHOP_ITEMS.find((i) => i.id === 'ammo-pistol');
  const before = arsenal.weapons.pistol.ammoReserve;
  const result = purchaseItem('ammo-pistol', arsenal, 100);
  assert.equal(result.ok, true);
  assert.equal(arsenal.weapons.pistol.ammoReserve, before + pack.amount);
  assert.equal(result.money, 100 - pack.price);
});

test('perto do limite da reserva, cobra só pelas balas que cabem', () => {
  const arsenal = createArsenal();
  const pack = SHOP_ITEMS.find((i) => i.id === 'ammo-pistol');
  arsenal.weapons.pistol.ammoReserve = WEAPONS.pistol.maxReserve - 6; // cabem 6 de 12
  const result = purchaseItem('ammo-pistol', arsenal, 100);
  assert.equal(result.ok, true);
  assert.equal(arsenal.weapons.pistol.ammoReserve, WEAPONS.pistol.maxReserve);
  assert.equal(result.money, 100 - Math.ceil(pack.price * 6 / pack.amount));
});

test('reserva cheia: compra de munição é recusada', () => {
  const arsenal = createArsenal();
  arsenal.weapons.pistol.ammoReserve = WEAPONS.pistol.maxReserve;
  const result = purchaseItem('ammo-pistol', arsenal, 500);
  assert.equal(result.ok, false);
  assert.equal(result.money, 500);
});

test('describeOffers marca corretamente o que está liberado', () => {
  const arsenal = createArsenal();
  let offers = describeOffers(arsenal, 0);
  assert.equal(offers.find((o) => o.id === 'weapon-smg').enabled, false);
  assert.equal(offers.find((o) => o.id === 'ammo-smg').enabled, false); // sem a arma
  assert.equal(offers.find((o) => o.id === 'ammo-pistol').enabled, false); // sem dinheiro

  offers = describeOffers(arsenal, 5000);
  assert.equal(offers.find((o) => o.id === 'weapon-smg').enabled, true);
  assert.equal(offers.find((o) => o.id === 'ammo-pistol').enabled, true);

  addWeapon(arsenal, 'smg');
  offers = describeOffers(arsenal, 5000);
  assert.equal(offers.find((o) => o.id === 'weapon-smg').enabled, false); // já tem
  assert.equal(offers.find((o) => o.id === 'ammo-smg').enabled, true);
});

test('todo item da loja aponta para uma arma que existe', () => {
  for (const item of SHOP_ITEMS) {
    assert.ok(WEAPONS[item.weaponId], item.id);
    assert.ok(item.price > 0);
  }
  for (const id of WEAPON_ORDER) assert.ok(WEAPONS[id].shortName);
});

test('escopeta dispara vários projéteis em leque; submetralhadora um por tiro e mais rápido', () => {
  const shotgun = createWeaponState('shotgun');
  const pellets = tryFireBullets(shotgun, 0, 0, 0, fixedMid);
  assert.equal(pellets.length, WEAPONS.shotgun.pellets);
  assert.equal(shotgun.ammoInMag, WEAPONS.shotgun.magSize - 1); // um cartucho por tiro

  let seed = 0;
  const spreadRng = () => { seed = (seed + 0.37) % 1; return seed; };
  const cone = tryFireBullets(createWeaponState('shotgun'), 0, 0, 0, spreadRng);
  const angles = new Set(cone.map((b) => b.angle.toFixed(4)));
  assert.ok(angles.size > 1);
  for (const b of cone) assert.ok(Math.abs(b.angle) <= WEAPONS.shotgun.spread / 2 + 1e-9);

  const smg = createWeaponState('smg');
  assert.equal(tryFireBullets(smg, 0, 0, 0, fixedMid).length, 1);
  assert.ok(WEAPONS.smg.fireInterval < WEAPONS.pistol.fireInterval);
});

test('tryFireBullets devolve lista vazia em intervalo, e addAmmo respeita o máximo da arma', () => {
  const state = createWeaponState('pistol');
  assert.equal(tryFireBullets(state, 0, 0, 0, fixedMid).length, 1);
  assert.deepEqual(tryFireBullets(state, 0, 0, 0, fixedMid), []);

  state.ammoReserve = WEAPONS.pistol.maxReserve - 5;
  assert.equal(addAmmo(state, 60), 5);
  assert.equal(state.ammoReserve, WEAPONS.pistol.maxReserve);
  assert.equal(addAmmo(state, 10), 0);
});
