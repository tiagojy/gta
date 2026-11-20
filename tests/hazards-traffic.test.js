import test from 'node:test';
import assert from 'node:assert/strict';
import { CityMap } from '../src/world/city-map.js';
import { TrafficManager } from '../src/world/traffic-manager.js';
import { isInWater, resolveVehiclePairCollision } from '../src/physics/collision.js';
import {
  applyPedestrianDamage,
  applyVehicleDamage,
  createVehicleEntity,
  evaluateVehicleImpact,
  findNearestVehicle,
  updateEjectedPlayer,
  updateVehicle
} from '../src/physics/vehicle-physics.js';

test('detecta queda na água ao ultrapassar os limites da ilha', () => {
  const map = new CityMap();
  assert.equal(isInWater(100, 100, map), false);
  assert.equal(isInWater(-5, 100, map), true);
  assert.equal(isInWater(100, map.worldHeight + 5, map), true);
});

test('colisão veículo-veículo calcula impacto e só ejeta/machuca em impactos fortes', () => {
  const vA = createVehicleEntity({ id: 'a', kind: 'car', model: 'Sedan', color: '#f00', x: 500, y: 500, angle: 0 });
  const vB = createVehicleEntity({ id: 'b', kind: 'van', model: 'Van', color: '#00f', x: 520, y: 500, angle: Math.PI });
  vA.vx = 350;
  vB.vx = -120;

  const col = resolveVehiclePairCollision(vA, vB);
  assert.equal(col.collided, true);
  assert.ok(col.impactSpeed >= 400);

  const strong = evaluateVehicleImpact(col.impactSpeed);
  assert.equal(strong.eject, true);
  assert.ok(strong.damage > 0);

  const mild = evaluateVehicleImpact(80);
  assert.equal(mild.eject, false);
  assert.equal(mild.damage, 0);
});

test('todos os veículos iniciam com motorista NPC, sem carros parados vazios, e retira motorista ao tomar veículo', () => {
  const map = new CityMap();
  const parked = map.vehicleSpawns.filter((v) => v.isParked || !v.driver);
  const trafficSpawns = map.vehicleSpawns.filter((v) => v.driver === 'npc');
  assert.equal(parked.length, 0);
  assert.equal(trafficSpawns.length, map.vehicleSpawns.length);
  assert.equal(trafficSpawns.length, map.gridBlocks * map.gridBlocks * 2);

  const vehicles = map.vehicleSpawns.map(createVehicleEntity);
  const traffic = new TrafficManager(map);
  const player = { x: trafficSpawns[0].x, y: trafficSpawns[0].y, inVehicleId: null, radius: 11 };

  const targetVehicle = vehicles.find((v) => v.driver === 'npc');
  const startX = targetVehicle.x;
  const startY = targetVehicle.y;
  traffic.update(0.1, player, vehicles);
  assert.ok(targetVehicle.x !== startX || targetVehicle.y !== startY);

  const evicted = traffic.evictDriver(targetVehicle, player.radius);
  assert.equal(targetVehicle.driver, null);
  assert.equal(evicted.state, 'walking');
  assert.equal(evicted.health, 100);
  assert.ok(evicted.returnTarget);
});

test('jogador ejetado arrasta na direção do movimento e sofre dano extra ao bater em obstáculo', () => {
  const map = new CityMap();
  const casa = map.resolveLocationCode('CASA-01');
  const wall = casa.interior.walls[0];

  const player = {
    x: wall.x + wall.w * 0.5,
    y: wall.y - 25,
    radius: 11,
    speed: 0,
    ejected: { active: true, vx: 0, vy: 320, hitCooldown: 0, graceTimer: 0, sourceVehicleId: null }
  };

  let totalExtra = 0;
  for (let i = 0; i < 40; i++) {
    const res = updateEjectedPlayer(player, 0.016, map, []);
    totalExtra += res.extraDamage;
  }

  assert.ok(totalExtra > 0);
});

test('veículo sofre dano proporcional ao impacto, sinaliza explosão ao zerar barra e não se move destruído', () => {
  const map = new CityMap();
  const v = createVehicleEntity({ id: 'car-1', kind: 'car', model: 'Sedan', color: '#f00', x: 500, y: 500, angle: 0 });
  assert.equal(v.health, 100);

  const light = applyVehicleDamage(v, 40);
  assert.equal(light.damaged, false);
  assert.equal(v.health, 100);

  const med = applyVehicleDamage(v, 180);
  assert.equal(med.damaged, true);
  assert.equal(med.exploded, false);
  assert.ok(v.health < 100 && v.health > 0);

  applyVehicleDamage(v, 500);
  const finalHit = applyVehicleDamage(v, 500);
  assert.equal(finalHit.exploded, true);
  assert.equal(v.health, 0);

  v.destroyed = true;
  v.driver = 'player';
  const moveRes = updateVehicle(v, { moveX: 0, moveY: -1, actionPressed: true, secondaryPressed: false }, 0.05, map);
  assert.equal(moveRes.collided, false);
  assert.equal(v.speed, 0);
  assert.equal(findNearestVehicle(500, 500, [v]), null);
});

test('pessoas fogem acelerando de veículos próximos e giram para atravessar ruas', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const ped = traffic.pedestrians[0];
  const player = { x: ped.x, y: ped.y, inVehicleId: null, radius: 11 };

  const initDirX = ped.dirX;
  const initDirY = ped.dirY;
  ped.crossTimer = 0.05;
  traffic.update(0.1, player, []);
  assert.ok(ped.dirX !== initDirX || ped.dirY !== initDirY);

  const v = createVehicleEntity({ id: 'v-threat', kind: 'car', model: 'Sedan', color: '#f00', x: ped.x - 50, y: ped.y, angle: 0 });
  v.vx = 140;
  v.vy = 0;
  v.speed = 140;
  traffic.update(0.2, player, [v]);
  assert.equal(ped.state, 'fleeing');
  assert.ok(ped.speed > 90);
});

test('veículos e lixeiras causam dano em pedestres na rua', () => {
  const ped = { id: 'PED-T', health: 100, state: 'walking', hitCooldown: 0, dirX: 1, dirY: 0, angle: 0 };
  const hit1 = applyPedestrianDamage(ped, 40, 200, 0);
  assert.equal(hit1.damaged, true);
  assert.equal(hit1.downed, false);
  assert.equal(ped.health, 60);
  assert.equal(ped.state, 'fleeing');

  ped.hitCooldown = 0;
  const hit2 = applyPedestrianDamage(ped, 70, 250, 0);
  assert.equal(hit2.damaged, true);
  assert.equal(hit2.downed, true);
  assert.equal(ped.health, 0);
  assert.equal(ped.state, 'downed');
});

test('pedestres dão um passo para trás e desviam ao colidir com jogador ou outros pedestres', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const road = map.resolveLocationCode('RUA-01');
  const pedA = traffic.pedestrians[0];
  const pedB = traffic.pedestrians[1];

  // Colisão jogador <-> pedestre
  pedA.x = road.bounds.x + 120;
  pedA.y = road.bounds.y + 64;
  pedA.dirX = -1;
  pedA.dirY = 0;
  const player = { x: pedA.x - 8, y: pedA.y, inVehicleId: null, isDead: false, radius: 11 };

  traffic.update(0.016, player, []);
  const distPlayerPed = Math.hypot(pedA.x - player.x, pedA.y - player.y);
  assert.ok(distPlayerPed >= 21);
  assert.ok(pedA.dirX > 0);
  assert.notEqual(pedA.dirY, 0);

  // Colisão pedestre <-> pedestre
  pedA.x = road.bounds.x + 240;
  pedA.y = road.bounds.y + 64;
  pedB.x = pedA.x + 6;
  pedB.y = pedA.y;
  pedA.dirX = 1;
  pedA.dirY = 0;
  pedB.dirX = -1;
  pedB.dirY = 0;

  traffic.update(0.016, player, []);
  const distPedPed = Math.hypot(pedB.x - pedA.x, pedB.y - pedA.y);
  assert.ok(distPedPed >= 20);
  assert.ok(pedA.dirX < 0);
  assert.ok(pedB.dirX > 0);
});

test('pedestres colidem com veículos estacionados e não colidem com lixeiras paradas ao caminhar', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const road = map.resolveLocationCode('RUA-01');
  const ped = traffic.pedestrians[0];
  const player = { x: road.bounds.x + 100, y: road.bounds.y + 100, inVehicleId: null, isDead: false, radius: 11 };

  // Lixeira parada no caminho não bloqueia nem desvia o pedestre caminhando
  ped.x = road.bounds.x + 200;
  ped.y = road.bounds.y + 64;
  ped.dirX = 1;
  ped.dirY = 0;
  const bin = { id: 'bin-obs', x: ped.x + 8, y: ped.y, vx: 0, vy: 0, radius: 7 };
  traffic.update(0.05, player, [], [bin]);
  assert.equal(ped.dirX, 1);
  assert.equal(ped.dirY, 0);
  assert.ok(ped.x > road.bounds.x + 200);

  // Veículo estacionado bloqueia passagem e faz o pedestre desviar
  const parked = createVehicleEntity({ id: 'v-park', kind: 'car', model: 'Sedan', color: '#f00', x: road.bounds.x + 320, y: road.bounds.y + 64, angle: 0 });
  ped.x = parked.x - parked.length * 0.5 - 8;
  ped.y = parked.y;
  ped.dirX = 1;
  ped.dirY = 0;
  traffic.update(0.05, player, [parked], []);
  assert.ok(ped.x <= parked.x - parked.length * 0.5 - (ped.radius || 10) + 0.5);
  assert.ok(ped.dirX < 0);
});

test('pedestre atravessa rua perpendicularmente à calçada até o quarteirão oposto', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const ped = traffic.pedestrians[0];
  const block = map.blocks[0][0];
  ped.bx = 0;
  ped.by = 0;
  ped.side = 'south';
  ped.cw = 1;
  ped.x = block.bounds.x + block.bounds.w * 0.5;
  ped.y = block.bounds.y + block.bounds.h - 13;
  ped.crossCooldown = 0;
  ped.crossTimer = 0.02;
  const player = { x: ped.x + 120, y: ped.y + 120, inVehicleId: null, isDead: false, radius: 11 };

  traffic.update(0.05, player, [], []);
  assert.equal(ped.state, 'crossing');
  assert.equal(ped.dirX, 0);
  assert.equal(ped.dirY, 1);

  for (let i = 0; i < 120 && ped.state === 'crossing'; i++) {
    traffic.update(0.05, player, [], []);
  }
  assert.equal(ped.state, 'walking');
  assert.equal(ped.by, 1);
  assert.equal(ped.side, 'north');
});

test('pedestre em fuga derruba lixeiras e volta ao comportamento padrão quando o perigo passa', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const ped = traffic.pedestrians[0];
  const block = map.blocks[1][1];
  ped.bx = 1;
  ped.by = 1;
  ped.side = 'north';
  ped.x = block.bounds.x + 80;
  ped.y = block.bounds.y + 13;

  const v = createVehicleEntity({ id: 'v-flee', kind: 'car', model: 'Sedan', color: '#f00', x: ped.x - 45, y: ped.y, angle: 0 });
  v.vx = 160;
  v.vy = 0;
  v.speed = 160;
  const bin = { id: 'bin-flee', x: ped.x + 16, y: ped.y, vx: 0, vy: 0, angVel: 0, angle: 0, radius: 7 };
  const player = { x: ped.x + 120, y: ped.y + 120, inVehicleId: null, isDead: false, radius: 11 };

  for (let i = 0; i < 8; i++) {
    traffic.update(0.05, player, [v], [bin]);
  }
  assert.equal(ped.state, 'fleeing');
  assert.ok(Math.hypot(bin.vx, bin.vy) > 30);

  // Afasta a ameaça e simula tempo até o perigo passar
  v.x = ped.x - 500;
  v.speed = 0;
  for (let i = 0; i < 70; i++) {
    traffic.update(0.05, player, [v], []);
  }
  assert.equal(ped.state, 'walking');
});

test('pedestre entra em estabelecimento, permanece um tempo e sai de volta para a calçada', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const ped = traffic.pedestrians[0];
  let commerce = null;
  let cBx = 0;
  let cBy = 0;
  for (let by = 0; by < map.gridBlocks && !commerce; by++) {
    for (let bx = 0; bx < map.gridBlocks && !commerce; bx++) {
      const found = map.blocks[by][bx].buildings.find((b) => b.type === 'commerce');
      if (found) {
        commerce = found;
        cBx = bx;
        cBy = by;
      }
    }
  }
  assert.ok(commerce);

  ped.bx = cBx;
  ped.by = cBy;
  ped.substate = 'entering_building';
  ped.targetBuilding = commerce;
  ped.visitStep = 0;
  ped.x = commerce.spawnPoint.x;
  ped.y = commerce.spawnPoint.y;
  const player = { x: ped.x + 120, y: ped.y + 120, inVehicleId: null, isDead: false, radius: 11 };

  let entered = false;
  for (let i = 0; i < 40; i++) {
    traffic.update(0.05, player, [], []);
    if (ped.substate === 'inside_building') {
      entered = true;
      break;
    }
  }
  assert.equal(entered, true);

  // Avança tempo dentro do estabelecimento até sair e retornar à calçada
  let exited = false;
  for (let i = 0; i < 200; i++) {
    traffic.update(0.05, player, [], []);
    if (ped.substate === null && ped.targetBuilding === null) {
      exited = true;
      break;
    }
  }
  assert.equal(exited, true);
});

test('faixas de pedestre e semáforos alternam verde/vermelho e pedestre espera sinal abrir para atravessar', () => {
  const map = new CityMap();
  assert.ok(map.crosswalks.length > 0);
  assert.ok(map.trafficLights.length > 0);
  // Não deve gerar faixa em todos os cruzamentos internos (seriam (29*29)*4 = 3364)
  assert.ok(map.crosswalks.length < (map.gridBlocks - 1) * (map.gridBlocks - 1) * 4);
  // Esquinas com semáforos não devem ter lixeiras
  const hasBinNearLight = map.trashBinSpawns.some((bin) =>
    map.trafficLights.some((light) => Math.hypot(bin.x - light.x, bin.y - light.y) < 32)
  );
  assert.equal(hasBinNearLight, false);

  const cw = map.crosswalks.find((c) => c.id.endsWith('-e'));
  assert.ok(cw);
  // Encontra um instante em que o semáforo dessa faixa esteja vermelho e outro em que esteja verde
  let redTime = 0;
  let greenTime = 0;
  for (let t = 0; t < 24; t += 0.5) {
    const st = map.getTrafficLightState(cw, t);
    if (st === 'red') redTime = t;
    if (st === 'green') greenTime = t;
  }
  assert.equal(map.getTrafficLightState(cw, redTime), 'red');
  assert.equal(map.getTrafficLightState(cw, greenTime), 'green');

  const traffic = new TrafficManager(map);
  const ped = traffic.pedestrians[0];
  // Posiciona o pedestre na calçada sul do quarteirão imediatamente acima da faixa vertical (row - 1, col)
  const bx = cw.col;
  const by = cw.row - 1;
  const block = map.blocks[by][bx];
  ped.bx = bx;
  ped.by = by;
  ped.side = 'south';
  ped.substate = null;
  ped.crossCooldown = 0;
  ped.crossTimer = 0.02;
  ped.x = cw.x + cw.w * 0.5;
  ped.y = block.bounds.y + block.bounds.h - 13;
  const player = { x: ped.x + 120, y: ped.y + 120, inVehicleId: null, isDead: false, radius: 11 };

  // No sinal vermelho, o pedestre para e aguarda abrir
  traffic.update(0.05, player, [], [], redTime);
  assert.equal(ped.state, 'waiting_light');
  assert.equal(ped.speed, 0);

  // Quando o sinal fica verde, o pedestre inicia a travessia
  traffic.update(0.05, player, [], [], greenTime);
  assert.equal(ped.state, 'crossing');
});

test('veículos em mão e contra-mão passam sem travar e destravam se ficarem frente a frente', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const roadY = map.roadYOffsets[2];
  const centerX = map.roadXOffsets[2] + map.roadWidth * 0.5 + 180;

  const vEast = createVehicleEntity({
    id: 'v-east',
    kind: 'car',
    model: 'Sedan',
    color: '#f00',
    x: centerX - 110,
    y: roadY + map.roadWidth * 0.72,
    angle: 0,
    driver: 'npc'
  });
  const vWest = createVehicleEntity({
    id: 'v-west',
    kind: 'car',
    model: 'Hatch',
    color: '#0af',
    x: centerX + 110,
    y: roadY + map.roadWidth * 0.28,
    angle: Math.PI,
    driver: 'npc'
  });
  const player = { x: centerX, y: roadY, inVehicleId: 'p-veh', isDead: false, radius: 11 };

  for (let i = 0; i < 40; i++) {
    traffic.update(0.05, player, [vEast, vWest], [], 0);
  }
  assert.ok(vEast.x > centerX + 40, 'veículo na mão direita deve cruzar sem travar com a contra-mão');
  assert.ok(vWest.x < centerX - 40, 'veículo na contra-mão deve cruzar sem travar');

  // Força dois veículos frente a frente na mesma faixa e verifica recuperação
  const stuckA = createVehicleEntity({
    id: 'stuck-a',
    kind: 'car',
    model: 'Sedan',
    color: '#f00',
    x: centerX - 24,
    y: roadY + map.roadWidth * 0.72,
    angle: 0,
    driver: 'npc'
  });
  const stuckB = createVehicleEntity({
    id: 'stuck-b',
    kind: 'car',
    model: 'Hatch',
    color: '#0af',
    x: centerX + 24,
    y: roadY + map.roadWidth * 0.72,
    angle: Math.PI,
    driver: 'npc'
  });

  for (let i = 0; i < 90; i++) {
    traffic.update(0.05, player, [stuckA, stuckB], [], 0);
  }
  assert.ok(Math.hypot(stuckA.x - stuckB.x, stuckA.y - stuckB.y) > 55, 'veículos frente a frente devem destravar e se separar');
});

test('veículo dando conversão à esquerda no cruzamento dá preferência ao tráfego em sentido contrário', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const col = 3;
  const row = 3;
  const cx = map.roadXOffsets[col] + map.roadWidth * 0.5;
  const roadY = map.roadYOffsets[row];

  const turningLeft = createVehicleEntity({
    id: 'turn-left',
    kind: 'car',
    model: 'Sedan',
    color: '#f00',
    x: cx - map.roadWidth * 0.65,
    y: roadY + map.roadWidth * 0.72,
    angle: 0,
    driver: 'npc'
  });
  turningLeft.npcTurn = {
    col,
    row,
    fromDx: 1,
    fromDy: 0,
    turn: 'left',
    targetDx: 0,
    targetDy: -1,
    executed: false
  };

  const oncoming = createVehicleEntity({
    id: 'oncoming',
    kind: 'car',
    model: 'Coupe',
    color: '#0f0',
    x: cx + 95,
    y: roadY + map.roadWidth * 0.28,
    angle: Math.PI,
    driver: 'npc'
  });
  oncoming.npcTurn = {
    col,
    row,
    fromDx: -1,
    fromDy: 0,
    turn: 'straight',
    targetDx: -1,
    targetDy: 0,
    executed: false
  };

  const player = { x: cx, y: roadY, inVehicleId: 'p-veh', isDead: false, radius: 11 };

  const hLight = map.trafficLights.find(
    (l) => l.axis === 'h' && Math.abs(l.x - cx) < 88 && Math.abs(l.y - (roadY + map.roadWidth * 0.5)) < 88
  );
  const greenTime = hLight
    ? (hLight.cycleDuration || 12) * 0.75 - (hLight.phaseOffset || 0)
    : 0;

  // Enquanto o veículo contrário está próximo, o carro que vira à esquerda aguarda sem executar a curva
  for (let i = 0; i < 12; i++) {
    traffic.update(0.05, player, [turningLeft, oncoming], [], greenTime);
  }
  assert.ok(Math.abs(turningLeft.angle) < 0.01, 'deve aguardar na faixa antes de virar');

  // Após o veículo contrário passar do cruzamento, o carro conclui a conversão à esquerda (passa a ir para Norte: -PI/2)
  for (let i = 0; i < 100; i++) {
    traffic.update(0.05, player, [turningLeft, oncoming], [], greenTime);
  }
  assert.ok(Math.abs(turningLeft.angle + Math.PI * 0.5) < 0.01, 'deve concluir a conversão à esquerda após passagem do sentido contrário');
  assert.ok(turningLeft.y < roadY, 'deve entrar na via perpendicular à direita');
});

test('pedestre próximo assume veículo deixado sem motorista e passa a dirigir', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const roadY = map.roadYOffsets[1];
  const vx = map.roadXOffsets[1] + map.roadWidth + 140;
  const vy = roadY + map.roadWidth * 0.72;

  const emptyCar = createVehicleEntity({
    id: 'empty-1',
    kind: 'car',
    model: 'Sedan',
    color: '#fff',
    x: vx,
    y: vy,
    angle: 0,
    driver: null
  });

  const ped = traffic.pedestrians[0];
  ped.state = 'walking';
  ped.substate = null;
  ped.x = vx - 35;
  ped.y = vy + 20;

  const player = { x: vx + 400, y: vy + 400, inVehicleId: null, isDead: false, radius: 11 };

  for (let i = 0; i < 40; i++) {
    traffic.update(0.05, player, [emptyCar], [], 0);
  }

  assert.equal(emptyCar.driver, 'npc');
  assert.ok(emptyCar.speed > 10);
});

test('normalizeTrafficAtMissionStart separa veículos amontoados e garante todos em movimento fora de cruzamentos', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const player = { x: 100, y: 100, inVehicleId: null, isDead: false, radius: 11 };

  // Simula 3 veículos amontoados e parados dentro de um cruzamento
  const cx = map.roadXOffsets[2] + map.roadWidth * 0.5;
  const cy = map.roadYOffsets[2] + map.roadWidth * 0.5;
  const vehicles = map.vehicleSpawns.slice(0, 6).map(createVehicleEntity);
  for (let i = 0; i < 3; i++) {
    vehicles[i].x = cx + i * 8;
    vehicles[i].y = cy;
    vehicles[i].speed = 0;
    vehicles[i].vx = 0;
    vehicles[i].vy = 0;
  }

  traffic.normalizeTrafficAtMissionStart(vehicles, player);

  for (let i = 0; i < vehicles.length; i++) {
    assert.ok(vehicles[i].speed > 80, 'todos os veículos devem iniciar em movimento');
    for (let j = i + 1; j < vehicles.length; j++) {
      const dist = Math.hypot(vehicles[i].x - vehicles[j].x, vehicles[i].y - vehicles[j].y);
      assert.ok(dist >= 119, `veículos não podem iniciar amontoados (dist=${dist})`);
    }
  }
});

test('veículos NPC fazem curvas fluidas nas esquinas com ângulos intermediários suaves', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const rw = map.roadWidth;
  const cx = map.roadXOffsets[3] + rw * 0.5;
  const cy = map.roadYOffsets[3] + rw * 0.5;

  const v = createVehicleEntity({
    id: 'VEH-CURVE',
    kind: 'carro',
    model: 'Sedan Clássico',
    color: [0.8, 0.2, 0.2, 1],
    x: cx - rw * 0.65,
    y: map.roadYOffsets[3] + rw * 0.72,
    angle: 0,
    isParked: false,
    driver: 'npc',
  });
  v.vx = 135;
  v.speed = 135;
  v.npcTurn = {
    col: 3,
    row: 3,
    fromDx: 1,
    fromDy: 0,
    turn: 'right',
    targetDx: 0,
    targetDy: 1,
    executed: false,
  };

  const player = { x: cx + 200, y: cy + 200, inVehicleId: null, isDead: false, radius: 11 };
  const observedAngles = [];
  for (let step = 0; step < 30; step += 1) {
    traffic.update(0.05, player, [v], [], 0);
    observedAngles.push(v.angle);
  }

  // Deve haver ângulos intermediários entre 0 e PI/2 durante a curva (sem salto seco de 90 graus)
  const hasIntermediate = observedAngles.some((a) => a > 0.15 && a < Math.PI * 0.5 - 0.15);
  assert.equal(hasIntermediate, true);
  assert.ok(Math.abs(v.angle - Math.PI * 0.5) < 0.05);
});

test('veículo NPC freia quando o jogador a pé entra na frente dele', () => {
  const map = new CityMap();
  const traffic = new TrafficManager(map);
  const rw = map.roadWidth;
  const laneY = map.roadYOffsets[2] + rw * 0.72;
  const startX = map.roadXOffsets[1] + rw * 1.6;

  const v = createVehicleEntity({
    id: 'VEH-BRAKE',
    kind: 'carro',
    model: 'Sedan Clássico',
    color: [0.8, 0.2, 0.2, 1],
    x: startX,
    y: laneY,
    angle: 0,
    isParked: false,
    driver: 'npc',
  });
  v.vx = 140;
  v.speed = 140;
  v.npcSpeed = 140;

  const player = { x: startX + 55, y: laneY, inVehicleId: null, isDead: false, radius: 12 };
  traffic.update(0.1, player, [v], [], 0);
  assert.ok(v.speed < 100, `veículo deve frear diante do jogador (speed=${v.speed})`);
});
