import test from 'node:test';
import assert from 'node:assert/strict';
import { CityMap } from '../src/world/city-map.js';
import { resolveCircleStaticObstacle } from '../src/physics/collision.js';
import {
  computeShockwaveDamage,
  computeShockwaveFalloff,
  createTrashBinEntity,
  createVehicleEntity,
  findSafeExitPosition,
  hitTrashBin,
  isTouchingVehicle,
  updatePedestrian,
  updateTrashBin,
  updateVehicle,
  updateVehicleCriticalState
} from '../src/physics/vehicle-physics.js';

test('colisão sólida impede jogador a pé de atravessar parede de edificação', () => {
  const map = new CityMap();
  const casa = map.resolveLocationCode('CASA-01');
  const wall = casa.interior.walls[0];

  const player = {
    x: wall.x + wall.w * 0.5,
    y: wall.y - 12,
    angle: 0,
    speed: 0,
    radius: 11
  };

  for (let i = 0; i < 20; i++) {
    updatePedestrian(player, { moveX: 0, moveY: 1 }, 0.016, map);
  }

  assert.ok(player.y <= wall.y - player.radius + 0.01);
});

test('carros, motos e vans têm resposta distinta e ativam drift em curvas em velocidade', () => {
  const map = new CityMap();
  const road = map.resolveLocationCode('RUA-01');

  const car = createVehicleEntity({ id: 'v1', kind: 'car', model: 'Sedan', color: '#f00', x: 500, y: road.bounds.y + 64, angle: 0 });
  const moto = createVehicleEntity({ id: 'v2', kind: 'moto', model: 'Street', color: '#0f0', x: 900, y: road.bounds.y + 64, angle: 0 });
  const van = createVehicleEntity({ id: 'v3', kind: 'van', model: 'Carga', color: '#00f', x: 1300, y: road.bounds.y + 64, angle: 0 });

  car.driver = 'player';
  moto.driver = 'player';
  van.driver = 'player';

  const accelInput = { moveX: 0, moveY: 0, actionPressed: true, secondaryPressed: false };
  for (let i = 0; i < 60; i++) {
    updateVehicle(car, accelInput, 0.016, map);
    updateVehicle(moto, accelInput, 0.016, map);
    updateVehicle(van, accelInput, 0.016, map);
  }

  assert.ok(moto.speed > car.speed);
  assert.ok(car.speed > van.speed);

  const steerInput = { moveX: 1, moveY: 0, actionPressed: true, secondaryPressed: false };
  for (let i = 0; i < 15; i++) {
    updateVehicle(car, steerInput, 0.016, map);
  }

  assert.equal(car.isDrifting, true);
  assert.ok(car.driftIntensity > 0);
});

test('saída do veículo posiciona o jogador em local livre adjacente', () => {
  const map = new CityMap();
  const road = map.resolveLocationCode('RUA-01');
  const car = createVehicleEntity({ id: 'v1', kind: 'car', model: 'Sedan', color: '#f00', x: 600, y: road.bounds.y + 64, angle: 0 });

  const exitPos = findSafeExitPosition(car, 11, map);
  assert.ok(Math.hypot(exitPos.x - car.x, exitPos.y - car.y) > 15);
});

test('jogador a pé colide de forma sólida com veículos e não passa por cima deles', () => {
  const map = new CityMap();
  const road = map.resolveLocationCode('RUA-01');
  const car = createVehicleEntity({ id: 'v1', kind: 'car', model: 'Sedan', color: '#f00', x: 700, y: road.bounds.y + 64, angle: 0 });
  const player = { x: car.x - 40, y: car.y, angle: 0, speed: 0, radius: 11 };

  for (let i = 0; i < 30; i++) {
    updatePedestrian(player, { moveX: 1, moveY: 0 }, 0.016, map, [car]);
  }

  assert.ok(player.x <= car.x - car.length * 0.5 - player.radius + 0.5);
});

test('veículo não pode entrar pela porta de uma construção', () => {
  const map = new CityMap();
  const house = map.resolveLocationCode('CASA-01');
  const doorCenterX = house.entrance.x + house.entrance.w * 0.5;
  const moto = createVehicleEntity({
    id: 'm1',
    kind: 'moto',
    model: 'Moto',
    color: '#0f0',
    x: doorCenterX,
    y: house.bounds.y + house.bounds.h + 26,
    angle: -Math.PI * 0.5
  });
  moto.driver = 'player';

  const input = { moveX: 0, moveY: 0, actionPressed: true, secondaryPressed: false };
  for (let i = 0; i < 30; i++) {
    updateVehicle(moto, input, 0.016, map);
  }

  assert.ok(moto.y >= house.bounds.y + house.bounds.h + moto.radius - 0.5);
});

test('veículo com até 30% de integridade solta fumaça por 10s e explode automaticamente', () => {
  const car = createVehicleEntity({ id: 'v-crit', kind: 'car', model: 'Sedan', color: '#f00', x: 0, y: 0, angle: 0 });
  car.health = 31;
  assert.deepEqual(updateVehicleCriticalState(car, 5), { smokingCritical: false, shouldExplode: false });

  car.health = 30;
  const at5s = updateVehicleCriticalState(car, 5);
  assert.equal(at5s.smokingCritical, true);
  assert.equal(at5s.shouldExplode, false);

  const at9s = updateVehicleCriticalState(car, 4.5);
  assert.equal(at9s.smokingCritical, true);
  assert.equal(at9s.shouldExplode, false);

  const at10s = updateVehicleCriticalState(car, 0.5);
  assert.equal(at10s.smokingCritical, true);
  assert.equal(at10s.shouldExplode, true);
});

test('deslocamento de ar da explosão enfraquece e causa menos dano conforme se espalha', () => {
  const maxRadius = 215;
  const maxDamage = 95;
  const dmgNear = computeShockwaveDamage(20, maxRadius, maxDamage);
  const dmgMid = computeShockwaveDamage(105, maxRadius, maxDamage);
  const dmgFar = computeShockwaveDamage(190, maxRadius, maxDamage);
  const dmgOut = computeShockwaveDamage(220, maxRadius, maxDamage);

  assert.ok(dmgNear > dmgMid);
  assert.ok(dmgMid > dmgFar);
  assert.ok(dmgFar > 0);
  assert.equal(dmgOut, 0);
  assert.ok(computeShockwaveFalloff(50, maxRadius) > computeShockwaveFalloff(150, maxRadius));
});

test('detecta contato com veículo destruído em chamas para causar dano', () => {
  const car = createVehicleEntity({ id: 'v-burn', kind: 'car', model: 'Sedan', color: '#f00', x: 100, y: 100, angle: 0 });
  assert.equal(isTouchingVehicle(100 + car.length * 0.5 + 8, 100, 11, car, 7), true);
  assert.equal(isTouchingVehicle(100 + car.length * 0.5 + 35, 100, 11, car, 7), false);
});

test('lixeiras substituem postes, são arremessadas, rebatem em obstáculos e não danificam veículos', () => {
  const map = new CityMap();
  const hasLamp = map.blocks.flat().some((b) => b.obstacles.some((o) => o.kind === 'lamp'));
  assert.equal(hasLamp, false);
  assert.ok(map.trashBinSpawns.length > 0);

  const car = createVehicleEntity({ id: 'v-bin', kind: 'car', model: 'Sedan', color: '#f00', x: 500, y: 500, angle: 0 });
  car.vx = 240;
  car.speed = 240;
  const bin = createTrashBinEntity({ id: 'bin-test', x: 520, y: 500 });
  hitTrashBin(bin, car.vx, car.vy, car.x, car.y);
  assert.ok(bin.vx > 200);
  assert.equal(car.health, 100);

  // Testa rebote contra parede de uma construção
  const house = map.resolveLocationCode('CASA-01');
  const bounceBin = createTrashBinEntity({
    id: 'bin-bounce',
    x: house.bounds.x - 10,
    y: house.bounds.y + house.bounds.h * 0.5
  });
  bounceBin.vx = 300;
  bounceBin.vy = 0;
  const res = updateTrashBin(bounceBin, 0.03, map);
  assert.equal(res.bounced, true);
  assert.ok(bounceBin.vx < 0);
});

test('colisão com personagem de missão bloqueia o jogador sem empurrar o NPC', () => {
  const npc = { x: 400, y: 300, radius: 11 };
  const playerRadius = 11;

  const far = resolveCircleStaticObstacle(400, 340, playerRadius, npc.x, npc.y, npc.radius);
  assert.equal(far.collided, false);
  assert.equal(far.y, 340);

  const hit = resolveCircleStaticObstacle(400, 310, playerRadius, npc.x, npc.y, npc.radius);
  assert.equal(hit.collided, true);
  assert.equal(hit.x, 400);
  assert.equal(hit.y, 322);
  assert.equal(npc.x, 400);
  assert.equal(npc.y, 300);
});

test('aceleração do veículo cresce progressivamente conforme o tempo segurando o acelerador', () => {
  const map = new CityMap();
  const road = map.resolveLocationCode('RUA-01');
  const car = createVehicleEntity({
    id: 'CAR-ACCEL',
    kind: 'car',
    model: 'Sedan',
    color: '#f00',
    x: 500,
    y: road.bounds.y + 64,
    angle: 0,
    driver: 'player',
  });
  const accelInput = { moveX: 0, moveY: 0, actionPressed: true, secondaryPressed: false };

  for (let i = 0; i < 10; i += 1) {
    updateVehicle(car, accelInput, 0.02, map);
  }
  const earlyGain = car.speed;
  assert.ok(earlyGain < 45, `arrancada inicial deve ser suave (earlyGain=${earlyGain})`);

  for (let i = 0; i < 35; i += 1) {
    updateVehicle(car, accelInput, 0.02, map);
  }
  const speedBeforeLate = car.speed;
  for (let i = 0; i < 10; i += 1) {
    updateVehicle(car, accelInput, 0.02, map);
  }
  const lateGain = car.speed - speedBeforeLate;
  assert.ok(lateGain > earlyGain * 1.8, `ganho contínuo deve ser maior após manter pressionado (early=${earlyGain}, late=${lateGain})`);
});

test('W/S dirigem: throttlePressed acelera, brakePressed dá ré e Espaço (actionPressed) sozinho não acelera', async () => {
  const { createVehicleEntity, updateVehicle } = await import('../src/physics/vehicle-physics.js');
  const map = { getCollidersAround: () => [], worldWidth: 10000, worldHeight: 10000, isRoadAt: () => true };
  const mk = () => {
    const v = createVehicleEntity({ id: 'T', kind: 'car', model: 'x', color: '#fff', x: 500, y: 500, angle: 0 });
    v.driver = 'player';
    return v;
  };

  const space = mk();
  for (let i = 0; i < 20; i++) {
    updateVehicle(space, { moveX: 0, moveY: 0, actionPressed: true, secondaryPressed: false, throttlePressed: false, brakePressed: false }, 0.05, map);
  }
  assert.ok(space.speed < 1, 'Espaço não deve acelerar');

  const gas = mk();
  for (let i = 0; i < 20; i++) {
    updateVehicle(gas, { moveX: 0, moveY: 0, actionPressed: false, secondaryPressed: false, throttlePressed: true, brakePressed: false }, 0.05, map);
  }
  assert.ok(gas.vx > 50, 'W deve acelerar para frente');

  const reverse = mk();
  for (let i = 0; i < 20; i++) {
    updateVehicle(reverse, { moveX: 0, moveY: 0, actionPressed: false, secondaryPressed: false, throttlePressed: false, brakePressed: true }, 0.05, map);
  }
  assert.ok(reverse.vx < -20, 'S deve dar ré');
});
