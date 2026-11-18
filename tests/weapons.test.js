import test from 'node:test';
import assert from 'node:assert/strict';
import { CityMap } from '../src/world/city-map.js';
import {
  WEAPONS,
  addAmmo,
  createWeaponState,
  findBulletHit,
  isReloading,
  segmentCircleIntersection,
  segmentRectIntersection,
  startReload,
  tryFire,
  updateBullets,
  updateWeaponState
} from '../src/combat/weapons.js';

const noSpread = () => 0.5;

test('createWeaponState cria pistola com carregador cheio e reserva', () => {
  const state = createWeaponState('pistol', { reserve: 24 });
  assert.equal(state.ammoInMag, WEAPONS.pistol.magSize);
  assert.equal(state.ammoReserve, 24);
  assert.equal(state.cooldown, 0);
  assert.equal(isReloading(state), false);
});

test('createWeaponState rejeita arma desconhecida', () => {
  assert.throws(() => createWeaponState('bazuca'), /desconhecida/);
});

test('tryFire gasta munição, cria bala na direção do tiro e aplica intervalo', () => {
  const state = createWeaponState('pistol');
  const bullet = tryFire(state, 100, 200, 0, noSpread);

  assert.ok(bullet);
  assert.equal(state.ammoInMag, WEAPONS.pistol.magSize - 1);
  assert.ok(bullet.vx > 0);
  assert.ok(Math.abs(bullet.vy) < 1e-6);
  assert.equal(bullet.damage, WEAPONS.pistol.damage);
  assert.ok(state.flashTimer > 0);

  // Dentro do intervalo entre tiros não dispara de novo
  assert.equal(tryFire(state, 100, 200, 0, noSpread), null);
  assert.equal(state.ammoInMag, WEAPONS.pistol.magSize - 1);

  updateWeaponState(state, WEAPONS.pistol.fireInterval + 0.01);
  assert.ok(tryFire(state, 100, 200, 0, noSpread));
});

test('bala nasce dentro do corpo do jogador, não além do raio', () => {
  const state = createWeaponState('pistol');
  const bullet = tryFire(state, 0, 0, Math.PI / 2, noSpread);
  assert.ok(Math.hypot(bullet.x, bullet.y) <= 11);
});

test('carregador vazio dispara recarga automática e não atira', () => {
  const state = createWeaponState('pistol', { reserve: 5 });
  state.ammoInMag = 0;

  assert.equal(tryFire(state, 0, 0, 0, noSpread), null);
  assert.ok(isReloading(state));

  // Durante a recarga também não atira
  assert.equal(tryFire(state, 0, 0, 0, noSpread), null);

  updateWeaponState(state, WEAPONS.pistol.reloadTime + 0.05);
  assert.equal(isReloading(state), false);
  assert.equal(state.ammoInMag, 5);
  assert.equal(state.ammoReserve, 0);
});

test('recarga só transfere o que falta no carregador', () => {
  const state = createWeaponState('pistol', { reserve: 30 });
  state.ammoInMag = 10;

  assert.ok(startReload(state));
  updateWeaponState(state, WEAPONS.pistol.reloadTime + 0.05);

  assert.equal(state.ammoInMag, WEAPONS.pistol.magSize);
  assert.equal(state.ammoReserve, 28);
});

test('não recarrega com carregador cheio, sem reserva ou já recarregando', () => {
  const full = createWeaponState('pistol', { reserve: 10 });
  assert.equal(startReload(full), false);

  const noReserve = createWeaponState('pistol', { reserve: 0 });
  noReserve.ammoInMag = 3;
  assert.equal(startReload(noReserve), false);

  const reloading = createWeaponState('pistol', { reserve: 10 });
  reloading.ammoInMag = 3;
  assert.ok(startReload(reloading));
  assert.equal(startReload(reloading), false);
});

test('sem munição nenhuma, tryFire não faz nada', () => {
  const state = createWeaponState('pistol', { reserve: 0 });
  state.ammoInMag = 0;
  assert.equal(tryFire(state, 0, 0, 0, noSpread), null);
  assert.equal(isReloading(state), false);
});

test('addAmmo aumenta a reserva', () => {
  const state = createWeaponState('pistol', { reserve: 0 });
  addAmmo(state, 24);
  assert.equal(state.ammoReserve, 24);
  addAmmo(state, -5);
  assert.equal(state.ammoReserve, 24);
});

test('segmentRectIntersection detecta cruzamento, ausência e início dentro', () => {
  const rect = { x: 50, y: -5, w: 10, h: 10 };
  const t = segmentRectIntersection(0, 0, 100, 0, rect);
  assert.ok(Math.abs(t - 0.5) < 1e-9);

  assert.equal(segmentRectIntersection(0, 20, 100, 20, rect), null);
  assert.equal(segmentRectIntersection(0, 0, 40, 0, rect), null);
  assert.equal(segmentRectIntersection(55, 0, 100, 0, rect), 0);
});

test('segmentCircleIntersection detecta cruzamento, ausência e início dentro', () => {
  const t = segmentCircleIntersection(0, 0, 100, 0, 50, 0, 10);
  assert.ok(Math.abs(t - 0.4) < 1e-9);

  assert.equal(segmentCircleIntersection(0, 0, 100, 0, 50, 30, 10), null);
  assert.equal(segmentCircleIntersection(0, 0, 30, 0, 50, 0, 10), null);
  assert.equal(segmentCircleIntersection(48, 0, 100, 0, 50, 0, 10), 0);
});

test('findBulletHit escolhe o alvo mais próximo entre parede e pedestre', () => {
  const wall = { x: 200, y: -20, w: 10, h: 40 };
  const ped = { x: 100, y: 0, radius: 10, state: 'walking' };
  const hit = findBulletHit(0, 0, 300, 0, { colliders: [wall], pedestrians: [ped] });

  assert.equal(hit.kind, 'pedestrian');
  assert.equal(hit.target, ped);
  assert.ok(Math.abs(hit.x - 90) < 1e-6);
});

test('bala acerta pedestre e é removida', () => {
  const state = createWeaponState('pistol');
  const bullets = [tryFire(state, 0, 0, 0, noSpread)];
  const ped = { x: 80, y: 0, radius: 10, state: 'walking' };

  let events = [];
  for (let i = 0; i < 30 && bullets.length > 0; i++) {
    events = events.concat(updateBullets(bullets, 1 / 60, { pedestrians: [ped] }));
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'pedestrian');
  assert.equal(events[0].target, ped);
  assert.equal(bullets.length, 0);
});

test('bala passa por cima de pedestre caído', () => {
  const state = createWeaponState('pistol');
  const bullets = [tryFire(state, 0, 0, 0, noSpread)];
  const downed = { x: 80, y: 0, radius: 10, state: 'downed' };

  let events = [];
  for (let i = 0; i < 120 && bullets.length > 0; i++) {
    events = events.concat(updateBullets(bullets, 1 / 60, { pedestrians: [downed] }));
  }

  assert.equal(events.length, 0);
});

test('bala para na parede mesmo com passo de tempo grande (sem atravessar)', () => {
  const state = createWeaponState('pistol');
  const bullets = [tryFire(state, 0, 0, 0, noSpread)];
  const thinWall = { x: 100, y: -30, w: 3, h: 60 };

  const events = updateBullets(bullets, 0.5, { colliders: [thinWall] });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wall');
  assert.ok(events[0].x >= 99 && events[0].x <= 101);
  assert.equal(bullets.length, 0);
});

test('bala some ao esgotar o alcance', () => {
  const state = createWeaponState('pistol');
  const bullets = [tryFire(state, 0, 0, 0, noSpread)];

  let frames = 0;
  while (bullets.length > 0 && frames < 600) {
    updateBullets(bullets, 1 / 60, {});
    frames++;
  }

  assert.equal(bullets.length, 0);
  assert.ok(frames < 600);
});

test('bala é bloqueada por veículo informado em vehicleAt', () => {
  const state = createWeaponState('pistol');
  const bullets = [tryFire(state, 0, 0, 0, noSpread)];
  const car = { id: 'car-1' };
  const vehicleAt = (x) => (x >= 120 && x <= 150 ? car : null);

  let events = [];
  for (let i = 0; i < 60 && bullets.length > 0; i++) {
    events = events.concat(updateBullets(bullets, 1 / 60, { vehicleAt }));
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'vehicle');
  assert.equal(events[0].target, car);
});

test('bala disparada contra parede real de edificação é barrada', () => {
  const map = new CityMap();
  const casa = map.resolveLocationCode('CASA-01');
  const wall = casa.interior.walls[0];

  // Atira de fora em direção ao centro do primeiro trecho de parede
  const startX = wall.x + wall.w * 0.5;
  const startY = wall.y - 60;
  const state = createWeaponState('pistol');
  const bullets = [tryFire(state, startX, startY, Math.PI / 2, noSpread)];
  const colliders = map.getCollidersAround(startX, startY, 200);

  let events = [];
  for (let i = 0; i < 120 && bullets.length > 0; i++) {
    events = events.concat(updateBullets(bullets, 1 / 60, { colliders }));
  }

  assert.ok(events.length >= 1);
  assert.equal(events[0].type, 'wall');
  assert.ok(events[0].y < wall.y + wall.h + 40);
});
