import { NPC_VEHICLE_CRUISE_SPEED, findSafeExitPosition, hitTrashBin, resolvePedestrianEnvironmentCollisions } from '../physics/vehicle-physics.js?v=19';

// Velocidades dos NPCs (px/s). Valores menores deixam o trânsito e as calçadas mais calmos.
const PED_WALK_SPEED = 45;
const PED_FLEE_SPEED = 120;
const PED_EJECT_SPEED = 90;
const PED_TO_VEHICLE_SPEED = 66;
const NPC_CURVE_SPEED = 68;
const NPC_UTURN_SPEED = 58;
import { resolveEntityCollisions } from '../physics/collision.js';
import { SIDEWALK_WIDTH } from './city-layout.js';

const PED_COLORS = [
  [0.25, 0.55, 0.85, 1],
  [0.82, 0.32, 0.35, 1],
  [0.32, 0.72, 0.45, 1],
  [0.72, 0.45, 0.82, 1],
  [0.88, 0.65, 0.25, 1],
  [0.18, 0.72, 0.74, 1],
  [0.9, 0.44, 0.22, 1]
];

const SKIN_COLORS = [
  [0.96, 0.8, 0.66, 1],
  [0.92, 0.72, 0.52, 1],
  [0.82, 0.6, 0.42, 1],
  [0.64, 0.42, 0.28, 1],
  [0.44, 0.28, 0.18, 1]
];

const HAIR_COLORS = [
  [0.1, 0.09, 0.09, 1],
  [0.28, 0.17, 0.1, 1],
  [0.52, 0.32, 0.16, 1],
  [0.86, 0.72, 0.32, 1],
  [0.72, 0.28, 0.14, 1],
  [0.68, 0.7, 0.74, 1]
];

const PANTS_COLORS = [
  [0.15, 0.22, 0.35, 1],
  [0.14, 0.15, 0.18, 1],
  [0.22, 0.34, 0.52, 1],
  [0.42, 0.36, 0.26, 1],
  [0.2, 0.28, 0.22, 1]
];

const SIDEWALK_MID = SIDEWALK_WIDTH * 0.5;

export class TrafficManager {
  constructor(cityMap, { chunkManaged = false } = {}) {
    this.cityMap = cityMap;
    this.chunkManaged = chunkManaged;
    this.pedestrians = [];
    this.nextPedId = 1;
    if (!chunkManaged) {
      this.#spawnInitialPedestrians();
    }
  }

  syncPedestrianChunks(activeChunks, nextKeys, player, previousKeys = new Set()) {
    if (this.pedestrians.length > 0) {
      this.pedestrians = this.pedestrians.filter((ped) => {
        if (nextKeys.has(ped.chunkKey)) return true;
        if (typeof this.cityMap.getChunkCoordsAt === 'function') {
          const posChunk = this.cityMap.getChunkCoordsAt(ped.x, ped.y);
          if (nextKeys.has(posChunk.key)) return true;
        }
        return player ? Math.hypot(ped.x - player.x, ped.y - player.y) < 1100 : false;
      });
    }

    const sides = ['south', 'east', 'north', 'west'];
    for (const chunk of activeChunks) {
      if (previousKeys.has(chunk.key)) continue;
      for (const block of chunk.blocks) {
        const sw = this.#getSidewalkBounds(block);
        const idx = block.bx * 3 + block.by * 5;
        const primarySide = sides[(block.bx + block.by) % sides.length];
        const prevLen = this.pedestrians.length;
        this.#spawnSidewalkPedestrian(block.bx, block.by, sw, primarySide, idx);
        for (let i = prevLen; i < this.pedestrians.length; i += 1) {
          this.pedestrians[i].chunkKey = chunk.key;
        }
      }
    }
  }

  #nextRand(ped) {
    ped.rngState = ((ped.rngState * 1664525 + 1013904223) >>> 0);
    return ped.rngState / 4294967296;
  }

  #getSidewalkBounds(block) {
    const b = block.bounds;
    return {
      northY: b.y + SIDEWALK_MID,
      southY: b.y + b.h - SIDEWALK_MID,
      westX: b.x + SIDEWALK_MID,
      eastX: b.x + b.w - SIDEWALK_MID
    };
  }

  #getSidewalkDirection(side, cw) {
    if (side === 'north') return { x: cw, y: 0 };
    if (side === 'east') return { x: 0, y: cw };
    if (side === 'south') return { x: -cw, y: 0 };
    return { x: 0, y: -cw };
  }

  #isOnSidewalk(ped) {
    const block = this.cityMap.blocks[ped.by]?.[ped.bx];
    if (!block) return false;
    const sw = this.#getSidewalkBounds(block);
    return (
      ped.x >= block.bounds.x - 6 &&
      ped.x <= block.bounds.x + block.bounds.w + 6 &&
      ped.y >= block.bounds.y - 6 &&
      ped.y <= block.bounds.y + block.bounds.h + 6 &&
      (Math.abs(ped.y - sw.northY) <= 18 ||
        Math.abs(ped.y - sw.southY) <= 18 ||
        Math.abs(ped.x - sw.westX) <= 18 ||
        Math.abs(ped.x - sw.eastX) <= 18)
    );
  }

  #spawnSidewalkPedestrian(bx, by, sw, side, idx) {
    const color = PED_COLORS[idx % PED_COLORS.length];
    const skinColor = SKIN_COLORS[(idx + 1) % SKIN_COLORS.length];
    const hairColor = HAIR_COLORS[(idx + 2) % HAIR_COLORS.length];
    const pantsColor = PANTS_COLORS[(idx + 3) % PANTS_COLORS.length];
    const cw = (idx % 2 === 0) ? 1 : -1;
    const dir = this.#getSidewalkDirection(side, cw);
    const offsetFrac = 0.25 + ((idx % 5) * 0.125);
    const startX = (side === 'south' || side === 'north')
      ? sw.westX + (sw.eastX - sw.westX) * offsetFrac
      : (side === 'east' ? sw.eastX : sw.westX);
    const startY = (side === 'south' || side === 'north')
      ? (side === 'south' ? sw.southY : sw.northY)
      : sw.northY + (sw.southY - sw.northY) * offsetFrac;
    const idNum = this.nextPedId++;

    this.pedestrians.push({
      id: `PED-${idNum}`,
      x: startX,
      y: startY,
      dirX: dir.x,
      dirY: dir.y,
      angle: Math.atan2(dir.y, dir.x),
      speed: PED_WALK_SPEED,
      baseSpeed: PED_WALK_SPEED,
      health: 100,
      radius: 10,
      hitCooldown: 0,
      fleeTimer: 0,
      crossTimer: 2.2 + ((bx + by + idx) % 4) * 1.1,
      crossCooldown: 0,
      visitCooldown: 3 + (idx % 5),
      walkPhase: (bx + by + idx) * 0.7,
      color,
      skinColor,
      hairColor,
      pantsColor,
      state: 'walking',
      substate: null,
      bx,
      by,
      side,
      cw,
      rngState: ((idNum * 2654435761) >>> 0) || 1,
      crossTarget: null,
      targetBuilding: null,
      visitStep: 0,
      insideTimer: 0,
      plazaTarget: null,
      plazaVisitsLeft: 0,
      returnTarget: null,
      stuckTimer: 0,
      lastCheckX: startX,
      lastCheckY: startY
    });
  }

  #spawnInitialPedestrians() {
    const sides = ['south', 'east', 'north', 'west'];
    const cols = this.cityMap.gridBlocks;
    const totalBlocks = cols * cols;
    const targetCount = 200;

    for (let k = 0; k < targetCount; k += 1) {
      const blockIndex = Math.floor((k * totalBlocks) / targetCount);
      const by = Math.floor(blockIndex / cols);
      const bx = blockIndex % cols;
      const block = this.cityMap.blocks[by][bx];
      const sw = this.#getSidewalkBounds(block);
      const idx = bx * 3 + by * 5;
      const primarySide = sides[(bx + by) % sides.length];
      this.#spawnSidewalkPedestrian(bx, by, sw, primarySide, idx);
    }
  }

  evictDriver(vehicle, playerRadius) {
    if (vehicle.driver !== 'npc') {
      return null;
    }
    const pos = findSafeExitPosition(vehicle, playerRadius, this.cityMap);
    vehicle.driver = null;
    const idNum = this.nextPedId++;
    const nearest = this.#findNearestSidewalkPoint(pos.x, pos.y);
    const dx = nearest.x - pos.x;
    const dy = nearest.y - pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const dirX = dx / d;
    const dirY = dy / d;
    const npc = {
      id: `PED-${idNum}`,
      x: vehicle.x,
      y: vehicle.y,
      dirX,
      dirY,
      angle: Math.atan2(dirY, dirX),
      speed: PED_EJECT_SPEED,
      baseSpeed: PED_WALK_SPEED,
      health: 100,
      radius: 10,
      hitCooldown: 0,
      fleeTimer: 1.8,
      ejectAnim: {
        fromX: vehicle.x,
        fromY: vehicle.y,
        toX: pos.x,
        toY: pos.y,
        timer: 0,
        duration: 0.34,
      },
      hopScale: 1,
      crossTimer: 4.0,
      crossCooldown: 1.5,
      visitCooldown: 6,
      binReactCooldown: 0,
      walkPhase: 0,
      color: PED_COLORS[idNum % PED_COLORS.length],
      skinColor: SKIN_COLORS[idNum % SKIN_COLORS.length],
      hairColor: HAIR_COLORS[idNum % HAIR_COLORS.length],
      pantsColor: PANTS_COLORS[idNum % PANTS_COLORS.length],
      state: 'walking',
      substate: 'returning_to_sidewalk',
      bx: nearest.bx,
      by: nearest.by,
      side: nearest.side,
      cw: idNum % 2 === 0 ? 1 : -1,
      rngState: ((idNum * 2654435761) >>> 0) || 1,
      crossTarget: null,
      targetBuilding: null,
      visitStep: 0,
      insideTimer: 0,
      plazaTarget: null,
      plazaVisitsLeft: 0,
      returnTarget: nearest,
      stuckTimer: 0,
      lastCheckX: pos.x,
      lastCheckY: pos.y
    };
    this.pedestrians.push(npc);
    return npc;
  }

  update(dt, player, vehicles, trashBins = [], time = 0) {
    const activeRadius = 1500;

    // Atualiza veículos de tráfego próximos ao jogador
    for (const v of vehicles) {
      if (v.driver !== 'npc') continue;
      if (Math.abs(v.x - player.x) > activeRadius || Math.abs(v.y - player.y) > activeRadius) {
        continue;
      }
      this.#updateTrafficVehicle(v, dt, player, vehicles, time);
    }

    this.#assignPedestriansToEmptyVehicles(vehicles, player, activeRadius);

    // Atualiza pedestres caminhando, atravessando ruas, visitando locais e fugindo de veículos
    for (const ped of this.pedestrians) {
      if (ped.hitCooldown > 0) {
        ped.hitCooldown = Math.max(0, ped.hitCooldown - dt);
      }
      if (ped.crossCooldown > 0) {
        ped.crossCooldown = Math.max(0, ped.crossCooldown - dt);
      }
      if (ped.visitCooldown > 0) {
        ped.visitCooldown = Math.max(0, ped.visitCooldown - dt);
      }
      if (ped.binReactCooldown > 0) {
        ped.binReactCooldown = Math.max(0, ped.binReactCooldown - dt);
      }
      if (ped.state === 'downed') continue;
      if (ped.ejectAnim) {
        ped.ejectAnim.timer += dt;
        const t = Math.min(1, ped.ejectAnim.timer / ped.ejectAnim.duration);
        const ease = 1 - Math.pow(1 - t, 2);
        ped.x = ped.ejectAnim.fromX + (ped.ejectAnim.toX - ped.ejectAnim.fromX) * ease;
        ped.y = ped.ejectAnim.fromY + (ped.ejectAnim.toY - ped.ejectAnim.fromY) * ease;
        ped.hopScale = 1 + Math.sin(t * Math.PI) * 0.28;
        ped.walkPhase += dt * 24;
        if (t >= 1) {
          ped.ejectAnim = null;
          ped.hopScale = 1;
        }
        continue;
      }
      if (Math.abs(ped.x - player.x) > activeRadius || Math.abs(ped.y - player.y) > activeRadius) {
        continue;
      }

      // Verifica se há veículo em movimento se aproximando perto do pedestre
      let threat = null;
      let threatDist = 115;
      for (const v of vehicles) {
        if (v.destroyed || v.speed < 25) continue;
        const dx = ped.x - v.x;
        const dy = ped.y - v.y;
        const d = Math.hypot(dx, dy);
        if (d < threatDist) {
          const approaching = dx * v.vx + dy * v.vy > 0 || d < 65;
          if (approaching) {
            threatDist = d;
            threat = v;
          }
        }
      }

      if (threat) {
        ped.state = 'fleeing';
        ped.fleeTimer = 2.6;
        ped.substate = null;
        ped.crossTarget = null;
        ped.waitingCrosswalk = null;
        ped.targetBuilding = null;
        ped.plazaTarget = null;
        ped.returnTarget = null;
        const dx = ped.x - threat.x;
        const dy = ped.y - threat.y;
        const d = Math.hypot(dx, dy) || 1;
        ped.dirX = dx / d;
        ped.dirY = dy / d;
        ped.angle = Math.atan2(ped.dirY, ped.dirX);
      } else if (ped.state === 'fleeing') {
        ped.fleeTimer = Math.max(0, (ped.fleeTimer || 0) - dt);
        if (ped.fleeTimer <= 0) {
          ped.state = 'walking';
          ped.substate = 'returning_to_sidewalk';
          ped.returnTarget = this.#findNearestSidewalkPoint(ped.x, ped.y);
          ped.crossCooldown = 2.0;
        }
      }

      if (ped.state === 'walking' && ped.substate === 'boarding_vehicle') {
        this.#updateBoardingPedestrian(ped, dt, vehicles);
        continue;
      }

      if (ped.state === 'walking' && ped.substate === 'inside_building') {
        ped.insideTimer = Math.max(0, (ped.insideTimer || 0) - dt);
        ped.speed = 0;
        if (ped.insideTimer <= 0) {
          ped.substate = 'exiting_building';
          ped.visitStep = 0;
        }
        continue;
      }

      if (ped.avoidTimer > 0) {
        ped.avoidTimer = Math.max(0, ped.avoidTimer - dt);
      }

      if (ped.state === 'waiting_light') {
        const lightState = ped.waitingCrosswalk && this.cityMap.getTrafficLightState
          ? this.cityMap.getTrafficLightState(ped.waitingCrosswalk, time)
          : 'green';
        if (lightState === 'green') {
          ped.waitingCrosswalk = null;
          ped.state = 'crossing';
        } else {
          ped.speed = 0;
          continue;
        }
      }

      if (ped.state === 'crossing') {
        this.#updateCrossingPedestrian(ped);
      } else if (ped.state === 'walking') {
        this.#updateWalkingPedestrian(ped, dt, time);
      }

      if (ped.state === 'waiting_light') {
        ped.speed = 0;
        continue;
      }

      const pedRadius = ped.radius || 10;

      // Em fuga, pedestre derruba lixeiras no caminho; caminhando, não colide com lixeiras
      if (ped.state === 'fleeing') {
        for (const bin of trashBins) {
          const dx = ped.x - bin.x;
          const dy = ped.y - bin.y;
          const minBinDist = pedRadius + (bin.radius || 7);
          if (Math.abs(dx) < minBinDist + 4 && Math.abs(dy) < minBinDist + 4) {
            const d = Math.hypot(dx, dy);
            if (d < minBinDist + 3) {
              hitTrashBin(
                bin,
                ped.dirX * Math.max(ped.speed, 110) * 0.9,
                ped.dirY * Math.max(ped.speed, 110) * 0.9,
                ped.x,
                ped.y,
                85
              );
            }
          }
        }
      }

      const targetSpeed = ped.state === 'fleeing' ? PED_FLEE_SPEED : (ped.baseSpeed || PED_WALK_SPEED);
      ped.speed += (targetSpeed - ped.speed) * Math.min(1, dt * (ped.state === 'fleeing' ? 7 : 4));

      const nextX = ped.x + ped.dirX * ped.speed * dt;
      const nextY = ped.y + ped.dirY * ped.speed * dt;
      const res = resolvePedestrianEnvironmentCollisions(nextX, nextY, pedRadius, this.cityMap, vehicles);

      const nearEdge =
        res.x < 40 ||
        res.y < 40 ||
        res.x > this.cityMap.worldWidth - 40 ||
        res.y > this.cityMap.worldHeight - 40;

      if (res.hitVehicle && res.hitVehicle.speed <= 18) {
        ped.x = res.x;
        ped.y = res.y;
        const dx = ped.x - res.hitVehicle.x;
        const dy = ped.y - res.hitVehicle.y;
        const d = Math.hypot(dx, dy) || 1;
        ped.avoidTimer = 0.45;
        this.#steerPedestrianAvoidance(ped, dx / d, dy / d, 1);
      } else if (res.collided || nearEdge) {
        if (ped.state === 'fleeing' || ped.substate === 'returning_to_sidewalk' || ped.state === 'crossing') {
          ped.avoidTimer = 0.55;
          this.#pickFreeFleeDirection(ped, pedRadius, vehicles);
        } else if (ped.substate === 'entering_building' || ped.substate === 'exiting_building') {
          ped.substate = 'returning_to_sidewalk';
          ped.targetBuilding = null;
          ped.visitCooldown = 12;
          ped.returnTarget = this.#findNearestSidewalkPoint(ped.x, ped.y);
        } else if (ped.substate === 'plaza') {
          this.#pickNextPlazaTarget(ped);
        } else {
          ped.dirX = -ped.dirX;
          ped.dirY = -ped.dirY;
          ped.angle = Math.atan2(ped.dirY, ped.dirX);
          if (ped.state === 'walking' && ped.substate === null) {
            ped.cw = -(ped.cw || 1);
          }
        }
      } else {
        ped.x = res.x;
        ped.y = res.y;
        ped.walkPhase += dt * (ped.state === 'fleeing' ? 18 : 9);
      }

      // Anti-travamento: se percorrer quase nada por mais de 1.2s, recalcula rota
      ped.stuckTimer = (ped.stuckTimer || 0) + dt;
      if (ped.stuckTimer >= 1.2) {
        const moved = Math.hypot(ped.x - (ped.lastCheckX ?? ped.x), ped.y - (ped.lastCheckY ?? ped.y));
        ped.lastCheckX = ped.x;
        ped.lastCheckY = ped.y;
        ped.stuckTimer = 0;
        if (moved < 10 && ped.state !== 'fleeing') {
          ped.state = 'walking';
          ped.crossTarget = null;
          ped.targetBuilding = null;
          ped.substate = 'returning_to_sidewalk';
          ped.returnTarget = this.#findNearestSidewalkPoint(ped.x, ped.y);
        }
      }
    }

    // Colisão jogador <-> pedestre e pedestre <-> pedestre: dão um passo para trás e desviam
    const standing = this.pedestrians.filter(
      (p) =>
        p.state !== 'downed' &&
        Math.abs(p.x - player.x) <= activeRadius &&
        Math.abs(p.y - player.y) <= activeRadius
    );

    if (!player.inVehicleId && !player.isDead) {
      const pRadius = player.radius || 11;
      for (const ped of standing) {
        const pedRadius = ped.radius || 10;
        const minDist = pRadius + pedRadius;
        const dx = ped.x - player.x;
        const dy = ped.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist) {
          const nx = dist > 1e-4 ? dx / dist : 1;
          const ny = dist > 1e-4 ? dy / dist : 0;
          const stepBack = minDist - dist + 3;
          const target = resolveEntityCollisions(
            ped.x + nx * stepBack,
            ped.y + ny * stepBack,
            pedRadius,
            this.cityMap.getCollidersAround(ped.x, ped.y, 60)
          );
          ped.x = target.x;
          ped.y = target.y;
          this.#steerPedestrianAvoidance(ped, nx, ny, 1);
        }
      }
    }

    for (let i = 0; i < standing.length; i++) {
      const pedA = standing[i];
      const radA = pedA.radius || 10;
      for (let j = i + 1; j < standing.length; j++) {
        const pedB = standing[j];
        const radB = pedB.radius || 10;
        const minDist = radA + radB;
        const dx = pedB.x - pedA.x;
        const dy = pedB.y - pedA.y;
        if (Math.abs(dx) >= minDist || Math.abs(dy) >= minDist) continue;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist) {
          const nx = dist > 1e-4 ? dx / dist : 1;
          const ny = dist > 1e-4 ? dy / dist : 0;
          const push = (minDist - dist) * 0.5 + 1.5;

          const resA = resolveEntityCollisions(
            pedA.x - nx * push,
            pedA.y - ny * push,
            radA,
            this.cityMap.getCollidersAround(pedA.x, pedA.y, 60)
          );
          const resB = resolveEntityCollisions(
            pedB.x + nx * push,
            pedB.y + ny * push,
            radB,
            this.cityMap.getCollidersAround(pedB.x, pedB.y, 60)
          );
          pedA.x = resA.x;
          pedA.y = resA.y;
          pedB.x = resB.x;
          pedB.y = resB.y;
          this.#steerPedestrianAvoidance(pedA, -nx, -ny, 1);
          this.#steerPedestrianAvoidance(pedB, nx, ny, 1);
        }
      }
    }
  }

  #steerToward(ped, tx, ty) {
    const dx = tx - ped.x;
    const dy = ty - ped.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return 0;
    ped.dirX = dx / dist;
    ped.dirY = dy / dist;
    ped.angle = Math.atan2(ped.dirY, ped.dirX);
    return dist;
  }

  #findNearestSidewalkPoint(x, y) {
    let bestBx = 0;
    let bestBy = 0;
    let bestDist = Infinity;

    for (let by = 0; by < this.cityMap.gridBlocks; by++) {
      const ry = this.cityMap.blockYOffsets[by];
      const rh = this.cityMap.rowHeights[by];
      const cy = Math.max(ry + SIDEWALK_MID, Math.min(ry + rh - SIDEWALK_MID, y));
      const dy = y - cy;
      if (Math.abs(dy) > bestDist) continue;
      for (let bx = 0; bx < this.cityMap.gridBlocks; bx++) {
        const rx = this.cityMap.blockXOffsets[bx];
        const rw = this.cityMap.colWidths[bx];
        const cx = Math.max(rx + SIDEWALK_MID, Math.min(rx + rw - SIDEWALK_MID, x));
        const d = Math.hypot(x - cx, dy);
        if (d < bestDist) {
          bestDist = d;
          bestBx = bx;
          bestBy = by;
        }
      }
    }

    const block = this.cityMap.blocks[bestBy][bestBx];
    const sw = this.#getSidewalkBounds(block);
    const clampedX = Math.max(sw.westX, Math.min(sw.eastX, x));
    const clampedY = Math.max(sw.northY, Math.min(sw.southY, y));
    const candidates = [
      { side: 'north', x: clampedX, y: sw.northY },
      { side: 'south', x: clampedX, y: sw.southY },
      { side: 'west', x: sw.westX, y: clampedY },
      { side: 'east', x: sw.eastX, y: clampedY }
    ];

    let best = candidates[0];
    let minD = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < minD) {
        minD = d;
        best = c;
      }
    }

    return { bx: bestBx, by: bestBy, side: best.side, x: best.x, y: best.y };
  }

  #getBuildingDoorTargets(building) {
    const ent = building.entrance;
    const sp = building.spawnPoint;
    const b = building.bounds;
    const doorCx = ent.x + ent.w * 0.5;
    const doorCy = ent.y + ent.h * 0.5;

    // Ponto interno seguro logo após a soleira da porta
    let insideX = doorCx;
    let insideY = doorCy;
    if (sp.y > b.y + b.h) {
      insideY = b.y + b.h - 38;
    } else if (sp.y < b.y) {
      insideY = b.y + 38;
    } else if (sp.x < b.x) {
      insideX = b.x + 38;
    } else {
      insideX = b.x + b.w - 38;
    }

    const safeInside = resolveEntityCollisions(
      insideX,
      insideY,
      10,
      this.cityMap.getCollidersAround(insideX, insideY, 60)
    );

    return {
      outside: { x: sp.x, y: sp.y },
      inside: { x: safeInside.x, y: safeInside.y }
    };
  }

  #startPerpendicularCrossing(ped, time = 0) {
    const { bx, by, side } = ped;
    const grid = this.cityMap.gridBlocks;
    let targetBx = bx;
    let targetBy = by;
    let targetSide = side;
    let dirX = 0;
    let dirY = 0;

    if (side === 'north' && by > 0) {
      targetBy = by - 1;
      targetSide = 'south';
      dirY = -1;
    } else if (side === 'south' && by < grid - 1) {
      targetBy = by + 1;
      targetSide = 'north';
      dirY = 1;
    } else if (side === 'west' && bx > 0) {
      targetBx = bx - 1;
      targetSide = 'east';
      dirX = -1;
    } else if (side === 'east' && bx < grid - 1) {
      targetBx = bx + 1;
      targetSide = 'west';
      dirX = 1;
    } else {
      return false;
    }

    const targetBlock = this.cityMap.blocks[targetBy][targetBx];
    const tsw = this.#getSidewalkBounds(targetBlock);
    const targetX = dirX === 0 ? Math.max(tsw.westX + 12, Math.min(tsw.eastX - 12, ped.x)) : (dirX > 0 ? tsw.westX : tsw.eastX);
    const targetY = dirY === 0 ? Math.max(tsw.northY + 12, Math.min(tsw.southY - 12, ped.y)) : (dirY > 0 ? tsw.northY : tsw.southY);
    const axis = dirX === 0 ? 'v' : 'h';

    ped.substate = null;
    ped.dirX = dirX;
    ped.dirY = dirY;
    ped.angle = Math.atan2(dirY, dirX);
    ped.crossTarget = {
      x: targetX,
      y: targetY,
      bx: targetBx,
      by: targetBy,
      side: targetSide,
      axis
    };

    const nearbyCw = this.cityMap.findNearbyCrosswalk?.(ped.x, ped.y, axis, 58);
    if (nearbyCw && this.cityMap.getTrafficLightState?.(nearbyCw, time) === 'red') {
      ped.state = 'waiting_light';
      ped.waitingCrosswalk = nearbyCw;
      ped.speed = 0;
      return true;
    }

    ped.state = 'crossing';
    ped.waitingCrosswalk = null;
    return true;
  }

  #updateCrossingPedestrian(ped) {
    const ct = ped.crossTarget;
    if (!ct) {
      ped.state = 'walking';
      return;
    }

    // Mantém travessia estritamente perpendicular à calçada (exceto durante desvio momentâneo de obstáculo)
    if (ct.axis === 'v') {
      const signY = ct.y >= ped.y ? 1 : -1;
      if ((ped.avoidTimer || 0) <= 0) {
        ped.dirX = 0;
        ped.dirY = signY;
        ped.angle = Math.atan2(ped.dirY, ped.dirX);
      }
      if (Math.abs(ped.y - ct.y) <= 8) {
        ped.y = ct.y;
        ped.bx = ct.bx;
        ped.by = ct.by;
        ped.side = ct.side;
        ped.cw = this.#nextRand(ped) < 0.5 ? 1 : -1;
        ped.state = 'walking';
        ped.crossTarget = null;
        ped.crossCooldown = 3.5;
        ped.crossTimer = 4.0 + this.#nextRand(ped) * 5.0;
        const dir = this.#getSidewalkDirection(ped.side, ped.cw);
        ped.dirX = dir.x;
        ped.dirY = dir.y;
        ped.angle = Math.atan2(dir.y, dir.x);
      }
    } else {
      const signX = ct.x >= ped.x ? 1 : -1;
      if ((ped.avoidTimer || 0) <= 0) {
        ped.dirX = signX;
        ped.dirY = 0;
        ped.angle = Math.atan2(ped.dirY, ped.dirX);
      }
      if (Math.abs(ped.x - ct.x) <= 8) {
        ped.x = ct.x;
        ped.bx = ct.bx;
        ped.by = ct.by;
        ped.side = ct.side;
        ped.cw = this.#nextRand(ped) < 0.5 ? 1 : -1;
        ped.state = 'walking';
        ped.crossTarget = null;
        ped.crossCooldown = 3.5;
        ped.crossTimer = 4.0 + this.#nextRand(ped) * 5.0;
        const dir = this.#getSidewalkDirection(ped.side, ped.cw);
        ped.dirX = dir.x;
        ped.dirY = dir.y;
        ped.angle = Math.atan2(dir.y, dir.x);
      }
    }
  }

  #pickNextPlazaTarget(ped) {
    const block = this.cityMap.blocks[ped.by]?.[ped.bx];
    if (!block?.plaza) {
      ped.substate = 'returning_to_sidewalk';
      ped.returnTarget = this.#findNearestSidewalkPoint(ped.x, ped.y);
      return;
    }

    if ((ped.plazaVisitsLeft || 0) <= 0) {
      ped.substate = 'returning_to_sidewalk';
      ped.plazaTarget = null;
      ped.returnTarget = this.#findNearestSidewalkPoint(ped.x, ped.y);
      ped.visitCooldown = 10;
      return;
    }

    const pb = block.plaza.bounds;
    const margin = 22;
    for (let attempt = 0; attempt < 6; attempt++) {
      const tx = pb.x + margin + this.#nextRand(ped) * Math.max(20, pb.w - margin * 2);
      const ty = pb.y + margin + this.#nextRand(ped) * Math.max(20, pb.h - margin * 2);
      const test = resolveEntityCollisions(tx, ty, ped.radius || 10, this.cityMap.getCollidersAround(tx, ty, 40));
      if (!test.collided) {
        ped.plazaTarget = { x: tx, y: ty };
        ped.plazaVisitsLeft -= 1;
        return;
      }
    }

    ped.substate = 'returning_to_sidewalk';
    ped.returnTarget = this.#findNearestSidewalkPoint(ped.x, ped.y);
  }

  #updateWalkingPedestrian(ped, dt, time = 0) {
    if (ped.substate === 'returning_to_sidewalk') {
      const rt = ped.returnTarget || this.#findNearestSidewalkPoint(ped.x, ped.y);
      ped.returnTarget = rt;
      const dist = (ped.avoidTimer || 0) > 0 ? Math.hypot(rt.x - ped.x, rt.y - ped.y) : this.#steerToward(ped, rt.x, rt.y);
      if (dist <= 12) {
        ped.x = rt.x;
        ped.y = rt.y;
        ped.bx = rt.bx;
        ped.by = rt.by;
        ped.side = rt.side;
        ped.cw = this.#nextRand(ped) < 0.5 ? 1 : -1;
        ped.substate = null;
        ped.returnTarget = null;
        const dir = this.#getSidewalkDirection(ped.side, ped.cw);
        ped.dirX = dir.x;
        ped.dirY = dir.y;
        ped.angle = Math.atan2(dir.y, dir.x);
      }
      return;
    }

    if (ped.substate === 'entering_building' && ped.targetBuilding) {
      const targets = this.#getBuildingDoorTargets(ped.targetBuilding);
      const goal = ped.visitStep === 0 ? targets.outside : targets.inside;
      const dist = this.#steerToward(ped, goal.x, goal.y);
      if (dist <= 10) {
        if (ped.visitStep === 0) {
          ped.visitStep = 1;
        } else {
          ped.substate = 'inside_building';
          ped.insideTimer = 2.5 + this.#nextRand(ped) * 3.0;
          ped.speed = 0;
        }
      }
      return;
    }

    if (ped.substate === 'exiting_building' && ped.targetBuilding) {
      const targets = this.#getBuildingDoorTargets(ped.targetBuilding);
      const goal = ped.visitStep === 0 ? targets.inside : targets.outside;
      const dist = this.#steerToward(ped, goal.x, goal.y);
      if (dist <= 10) {
        if (ped.visitStep === 0) {
          ped.visitStep = 1;
        } else {
          ped.substate = 'returning_to_sidewalk';
          ped.targetBuilding = null;
          ped.visitCooldown = 18;
          ped.returnTarget = this.#findNearestSidewalkPoint(ped.x, ped.y);
        }
      }
      return;
    }

    if (ped.substate === 'plaza') {
      if (!ped.plazaTarget) {
        this.#pickNextPlazaTarget(ped);
      }
      if (ped.plazaTarget) {
        const dist = this.#steerToward(ped, ped.plazaTarget.x, ped.plazaTarget.y);
        if (dist <= 12) {
          this.#pickNextPlazaTarget(ped);
        }
      }
      return;
    }

    // Se o pedestre está fora da calçada (ex.: posicionado manualmente na rua), preserva direção
    // e só aplica travessia/virada se o timer expirar
    const block = this.cityMap.blocks[ped.by]?.[ped.bx];
    if (!block) return;

    const sw = this.#getSidewalkBounds(block);
    const onBlockPerimeter =
      ped.x >= block.bounds.x - 6 &&
      ped.x <= block.bounds.x + block.bounds.w + 6 &&
      ped.y >= block.bounds.y - 6 &&
      ped.y <= block.bounds.y + block.bounds.h + 6 &&
      (Math.abs(ped.y - sw.northY) <= 18 ||
        Math.abs(ped.y - sw.southY) <= 18 ||
        Math.abs(ped.x - sw.westX) <= 18 ||
        Math.abs(ped.x - sw.eastX) <= 18);

    ped.crossTimer = (ped.crossTimer ?? 3.5) - dt;

    if (!onBlockPerimeter) {
      if (ped.crossTimer <= 0) {
        ped.crossTimer = 3.5 + this.#nextRand(ped) * 3.5;
        const turnSign = this.#nextRand(ped) < 0.5 ? 1 : -1;
        const nx = -ped.dirY * turnSign;
        const ny = ped.dirX * turnSign;
        ped.dirX = nx;
        ped.dirY = ny;
        ped.angle = Math.atan2(ped.dirY, ped.dirX);
      }
      return;
    }

    // Verifica se há estabelecimento próximo na calçada para entrar
    if ((ped.visitCooldown || 0) <= 0 && !block.isPlaza && block.buildings.length > 0) {
      for (const b of block.buildings) {
        if (b.type !== 'commerce' || !b.spawnPoint || !b.entrance) continue;
        const sp = b.spawnPoint;
        if (Math.hypot(ped.x - sp.x, ped.y - sp.y) < 75) {
          ped.visitCooldown = 8;
          if (this.#nextRand(ped) < 0.4) {
            ped.substate = 'entering_building';
            ped.targetBuilding = b;
            ped.visitStep = 0;
            return;
          }
        }
      }
    }

    // Se o timer de travessia expirou na calçada, atravessa a rua perpendicularmente
    if (ped.crossTimer <= 0 && (ped.crossCooldown || 0) <= 0) {
      ped.crossTimer = 4.0 + this.#nextRand(ped) * 4.5;
      if (this.#startPerpendicularCrossing(ped, time)) {
        return;
      }
    }

    // Caminha ao longo da faixa da calçada e decide nas esquinas sem entrar em loop
    const cw = ped.cw || 1;
    const cornerEps = 8;
    let atCorner = false;
    let nextSide = ped.side;

    if (ped.side === 'north') {
      ped.y += (sw.northY - ped.y) * Math.min(1, dt * 6);
      if (cw > 0 && ped.x >= sw.eastX - cornerEps) {
        ped.x = sw.eastX;
        atCorner = true;
        nextSide = 'east';
      } else if (cw < 0 && ped.x <= sw.westX + cornerEps) {
        ped.x = sw.westX;
        atCorner = true;
        nextSide = 'west';
      }
    } else if (ped.side === 'east') {
      ped.x += (sw.eastX - ped.x) * Math.min(1, dt * 6);
      if (cw > 0 && ped.y >= sw.southY - cornerEps) {
        ped.y = sw.southY;
        atCorner = true;
        nextSide = 'south';
      } else if (cw < 0 && ped.y <= sw.northY + cornerEps) {
        ped.y = sw.northY;
        atCorner = true;
        nextSide = 'north';
      }
    } else if (ped.side === 'south') {
      ped.y += (sw.southY - ped.y) * Math.min(1, dt * 6);
      if (cw > 0 && ped.x <= sw.westX + cornerEps) {
        ped.x = sw.westX;
        atCorner = true;
        nextSide = 'west';
      } else if (cw < 0 && ped.x >= sw.eastX - cornerEps) {
        ped.x = sw.eastX;
        atCorner = true;
        nextSide = 'east';
      }
    } else {
      ped.x += (sw.westX - ped.x) * Math.min(1, dt * 6);
      if (cw > 0 && ped.y <= sw.northY + cornerEps) {
        ped.y = sw.northY;
        atCorner = true;
        nextSide = 'north';
      } else if (cw < 0 && ped.y >= sw.southY - cornerEps) {
        ped.y = sw.southY;
        atCorner = true;
        nextSide = 'south';
      }
    }

    if (atCorner) {
      const roll = this.#nextRand(ped);
      if (block.isPlaza && (ped.visitCooldown || 0) <= 0 && roll < 0.35) {
        ped.substate = 'plaza';
        ped.plazaVisitsLeft = 1 + Math.floor(this.#nextRand(ped) * 3);
        this.#pickNextPlazaTarget(ped);
        return;
      }
      if ((ped.crossCooldown || 0) <= 0 && roll < 0.55 && this.#startPerpendicularCrossing(ped, time)) {
        return;
      }
      ped.side = nextSide;
    }

    const dir = this.#getSidewalkDirection(ped.side, cw);
    ped.dirX = dir.x;
    ped.dirY = dir.y;
    ped.angle = Math.atan2(dir.y, dir.x);
  }

  #pickFreeFleeDirection(ped, pedRadius, vehicles) {
    const baseAngle = Math.atan2(ped.dirY, ped.dirX);
    const offsets = [Math.PI * 0.35, -Math.PI * 0.35, Math.PI * 0.65, -Math.PI * 0.65, Math.PI];
    for (const off of offsets) {
      const ang = baseAngle + off;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const probe = resolvePedestrianEnvironmentCollisions(
        ped.x + dx * 16,
        ped.y + dy * 16,
        pedRadius,
        this.cityMap,
        vehicles
      );
      if (!probe.collided) {
        ped.dirX = dx;
        ped.dirY = dy;
        ped.angle = ang;
        return;
      }
    }
    ped.dirX = -ped.dirX;
    ped.dirY = -ped.dirY;
    ped.angle = Math.atan2(ped.dirY, ped.dirX);
  }

  #steerPedestrianAvoidance(ped, awayX, awayY, side = 1) {
    // Combina passo para trás (away) com desvio lateral perpendicular
    const sx = awayX * 0.65 - awayY * 0.76 * side;
    const sy = awayY * 0.65 + awayX * 0.76 * side;
    const len = Math.hypot(sx, sy) || 1;
    ped.dirX = sx / len;
    ped.dirY = sy / len;
    ped.angle = Math.atan2(ped.dirY, ped.dirX);
    ped.crossTimer = Math.max(ped.crossTimer || 0, 1.2);
  }

  #getCardinalHeading(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (Math.abs(cos) >= Math.abs(sin)) {
      const dx = cos >= 0 ? 1 : -1;
      return { dx, dy: 0, axis: 'h', angle: dx > 0 ? 0 : Math.PI };
    }
    const dy = sin >= 0 ? 1 : -1;
    return { dx: 0, dy, axis: 'v', angle: dy > 0 ? Math.PI * 0.5 : -Math.PI * 0.5 };
  }

  #findNearestRoadIndex(offsets, coord) {
    const halfRoad = this.cityMap.roadWidth * 0.5;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < offsets.length; i++) {
      const d = Math.abs(offsets[i] + halfRoad - coord);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  #getRightHandLaneCoord(roadOffset, dx, dy) {
    const rw = this.cityMap.roadWidth;
    const center = roadOffset + rw * 0.5;
    const laneOffset = rw * 0.22;
    if (dx !== 0) {
      return center + dx * laneOffset;
    }
    return center - dy * laneOffset;
  }

  #findNextIntersection(v, heading) {
    const rw = this.cityMap.roadWidth;
    const halfRoad = rw * 0.5;
    const rowOffsets = this.cityMap.roadYOffsets;
    const colOffsets = this.cityMap.roadXOffsets;

    if (heading.axis === 'h') {
      const row = this.#findNearestRoadIndex(rowOffsets, v.y);
      const cy = rowOffsets[row] + halfRoad;
      const step = heading.dx;
      const start = step > 0 ? 0 : colOffsets.length - 1;
      const end = step > 0 ? colOffsets.length : -1;
      for (let col = start; col !== end; col += step) {
        const cx = colOffsets[col] + halfRoad;
        const dist = (cx - v.x) * step;
        if (dist >= -rw * 0.35) {
          return { col, row, cx, cy, dist };
        }
      }
      return null;
    }

    const col = this.#findNearestRoadIndex(colOffsets, v.x);
    const cx = colOffsets[col] + halfRoad;
    const step = heading.dy;
    const start = step > 0 ? 0 : rowOffsets.length - 1;
    const end = step > 0 ? rowOffsets.length : -1;
    for (let row = start; row !== end; row += step) {
      const cy = rowOffsets[row] + halfRoad;
      const dist = (cy - v.y) * step;
      if (dist >= -rw * 0.35) {
        return { col, row, cx, cy, dist };
      }
    }
    return null;
  }

  #chooseTurnAtIntersection(v, intersection, heading) {
    if (
      v.npcTurn &&
      v.npcTurn.col === intersection.col &&
      v.npcTurn.row === intersection.row &&
      v.npcTurn.fromDx === heading.dx &&
      v.npcTurn.fromDy === heading.dy
    ) {
      return v.npcTurn;
    }

    const maxIdx = this.cityMap.gridBlocks;
    const options = [];
    const nextCol = intersection.col + heading.dx;
    const nextRow = intersection.row + heading.dy;
    if (nextCol >= 0 && nextCol <= maxIdx && nextRow >= 0 && nextRow <= maxIdx) {
      options.push({ turn: 'straight', targetDx: heading.dx, targetDy: heading.dy });
    }

    const rightDx = -heading.dy;
    const rightDy = heading.dx;
    if (
      intersection.col + rightDx >= 0 &&
      intersection.col + rightDx <= maxIdx &&
      intersection.row + rightDy >= 0 &&
      intersection.row + rightDy <= maxIdx
    ) {
      options.push({ turn: 'right', targetDx: rightDx, targetDy: rightDy });
    }

    const leftDx = heading.dy;
    const leftDy = -heading.dx;
    if (
      intersection.col + leftDx >= 0 &&
      intersection.col + leftDx <= maxIdx &&
      intersection.row + leftDy >= 0 &&
      intersection.row + leftDy <= maxIdx
    ) {
      options.push({ turn: 'left', targetDx: leftDx, targetDy: leftDy });
    }

    let picked = options[0] || { turn: 'uturn', targetDx: -heading.dx, targetDy: -heading.dy };
    if (options.length > 1) {
      v.npcTurnCount = (v.npcTurnCount || 0) + 1;
      const idHash = String(v.id || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const roll = (idHash + v.npcTurnCount * 7 + intersection.col * 3 + intersection.row * 5) % 10;
      const straightOpt = options.find((o) => o.turn === 'straight');
      const rightOpt = options.find((o) => o.turn === 'right');
      const leftOpt = options.find((o) => o.turn === 'left');
      if (straightOpt && roll < 5) picked = straightOpt;
      else if (rightOpt && (!leftOpt || roll < 8)) picked = rightOpt;
      else if (leftOpt) picked = leftOpt;
    }

    v.npcTurn = {
      col: intersection.col,
      row: intersection.row,
      fromDx: heading.dx,
      fromDy: heading.dy,
      turn: picked.turn,
      targetDx: picked.targetDx,
      targetDy: picked.targetDy,
      executed: false
    };
    return v.npcTurn;
  }

  #isIntersectionRedLight(intersection, axis, time) {
    for (const light of this.cityMap.trafficLights) {
      if (light.axis !== axis) continue;
      if (Math.abs(light.x - intersection.cx) < 88 && Math.abs(light.y - intersection.cy) < 88) {
        return this.cityMap.getTrafficLightState(light, time) === 'red';
      }
    }
    return false;
  }

  #shouldYieldAtIntersection(v, intersection, heading, turnInfo, vehicles, time) {
    const rw = this.cityMap.roadWidth;
    const halfBox = rw * 0.52;
    const dist = intersection.dist;

    // Aguarda semáforo vermelho antes da linha de parada
    if (dist > halfBox + 4 && dist < halfBox + 44) {
      if (this.#isIntersectionRedLight(intersection, heading.axis, time)) {
        return { yield: true, atRedLight: true };
      }
    }

    // Conversão à esquerda dá preferência ao tráfego na mão contrária
    if (turnInfo.turn === 'left' && dist > -12 && dist < halfBox + 38) {
      for (const other of vehicles) {
        if (other.id === v.id || other.destroyed || other.isParked) continue;
        const oCos = Math.cos(other.angle);
        const oSin = Math.sin(other.angle);
        const dot = heading.dx * oCos + heading.dy * oSin;
        if (dot > -0.7) continue;

        const sameCorridor =
          heading.axis === 'h'
            ? Math.abs(other.y - intersection.cy) < halfBox
            : Math.abs(other.x - intersection.cx) < halfBox;
        if (!sameCorridor) continue;

        const otherDistToCenter =
          heading.axis === 'h'
            ? (other.x - intersection.cx) * heading.dx
            : (other.y - intersection.cy) * heading.dy;

        if (otherDistToCenter > -18 && otherDistToCenter < 150) {
          return { yield: true, atRedLight: false };
        }
      }
    }

    // Antes de entrar no cruzamento, dá preferência a quem já está cruzando dentro dele
    if (dist > halfBox - 4 && dist < halfBox + 36) {
      for (const other of vehicles) {
        if (other.id === v.id || other.destroyed || other.isParked) continue;
        const inBox =
          Math.abs(other.x - intersection.cx) < halfBox - 8 &&
          Math.abs(other.y - intersection.cy) < halfBox - 8;
        if (!inBox) continue;

        const oCos = Math.cos(other.angle);
        const oSin = Math.sin(other.angle);
        const dot = heading.dx * oCos + heading.dy * oSin;
        if (dot < 0.7 || other.speed < 25) {
          return { yield: true, atRedLight: false };
        }
      }
    }

    return { yield: false, atRedLight: false };
  }

  #lerpAngle(current, target, alpha) {
    const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + diff * Math.min(1, Math.max(0, alpha));
  }

  #startNpcCurve(v, intersection, heading, turnInfo, rw) {
    const targetOffset =
      turnInfo.targetDx !== 0
        ? this.cityMap.roadYOffsets[intersection.row]
        : this.cityMap.roadXOffsets[intersection.col];
    const targetLaneCoord = this.#getRightHandLaneCoord(targetOffset, turnInfo.targetDx, turnInfo.targetDy);
    const exitDist = rw * 0.48;

    const p0x = v.x;
    const p0y = v.y;
    const p1x = turnInfo.targetDx !== 0
      ? intersection.cx + turnInfo.targetDx * exitDist
      : targetLaneCoord;
    const p1y = turnInfo.targetDy !== 0
      ? intersection.cy + turnInfo.targetDy * exitDist
      : targetLaneCoord;

    const isUturn = turnInfo.turn === 'uturn';
    let c1x;
    let c1y;
    let c2x;
    let c2y;
    if (isUturn) {
      const loopReach = rw * 0.56;
      c1x = p0x + heading.dx * loopReach;
      c1y = p0y + heading.dy * loopReach;
      c2x = p1x + heading.dx * loopReach;
      c2y = p1y + heading.dy * loopReach;
    } else if (heading.axis === 'h') {
      c1x = p1x;
      c1y = p0y;
      c2x = p1x;
      c2y = p0y;
    } else {
      c1x = p0x;
      c1y = p1y;
      c2x = p0x;
      c2y = p1y;
    }

    // Estima o comprimento do arco para manter velocidade constante na curva
    let length = 0;
    let prevX = p0x;
    let prevY = p0y;
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const mt = 1 - t;
      const ptX = isUturn
        ? mt * mt * mt * p0x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * p1x
        : mt * mt * p0x + 2 * mt * t * c1x + t * t * p1x;
      const ptY = isUturn
        ? mt * mt * mt * p0y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * p1y
        : mt * mt * p0y + 2 * mt * t * c1y + t * t * p1y;
      length += Math.hypot(ptX - prevX, ptY - prevY);
      prevX = ptX;
      prevY = ptY;
    }

    v.npcCurve = {
      isUturn,
      p0x,
      p0y,
      c1x,
      c1y,
      c2x,
      c2y,
      p1x,
      p1y,
      t: 0,
      length: Math.max(24, length),
      targetAngle: Math.atan2(turnInfo.targetDy, turnInfo.targetDx)
    };
  }

  #evalNpcCurve(curve, t) {
    const clamped = Math.max(0, Math.min(1, t));
    const mt = 1 - clamped;
    if (curve.isUturn) {
      const x = mt * mt * mt * curve.p0x + 3 * mt * mt * clamped * curve.c1x + 3 * mt * clamped * clamped * curve.c2x + clamped * clamped * clamped * curve.p1x;
      const y = mt * mt * mt * curve.p0y + 3 * mt * mt * clamped * curve.c1y + 3 * mt * clamped * clamped * curve.c2y + clamped * clamped * clamped * curve.p1y;
      const dx = 3 * mt * mt * (curve.c1x - curve.p0x) + 6 * mt * clamped * (curve.c2x - curve.c1x) + 3 * clamped * clamped * (curve.p1x - curve.c2x);
      const dy = 3 * mt * mt * (curve.c1y - curve.p0y) + 6 * mt * clamped * (curve.c2y - curve.c1y) + 3 * clamped * clamped * (curve.p1y - curve.c2y);
      return { x, y, dx, dy };
    }
    const x = mt * mt * curve.p0x + 2 * mt * clamped * curve.c1x + clamped * clamped * curve.p1x;
    const y = mt * mt * curve.p0y + 2 * mt * clamped * curve.c1y + clamped * clamped * curve.p1y;
    const dx = 2 * mt * (curve.c1x - curve.p0x) + 2 * clamped * (curve.p1x - curve.c1x);
    const dy = 2 * mt * (curve.c1y - curve.p0y) + 2 * clamped * (curve.p1y - curve.c1y);
    return { x, y, dx, dy };
  }

  #updateTrafficVehicle(v, dt, player, vehicles, time) {
    const rw = this.cityMap.roadWidth;

    if (v.npcCurve) {
      const curve = v.npcCurve;
      const cos = Math.cos(v.angle);
      const sin = Math.sin(v.angle);
      let blocked = false;
      let playerAhead = false;
      if (!player.inVehicleId) {
        const pFwd = (player.x - v.x) * cos + (player.y - v.y) * sin;
        const pLat = Math.abs(-(player.x - v.x) * sin + (player.y - v.y) * cos);
        const latThreshold = (v.width || 24) * 0.5 + (player.radius || 12) + 4;
        if (pFwd > 0 && pFwd < 72 && pLat < latThreshold) {
          blocked = true;
          playerAhead = true;
        }
      }
      if (!blocked) {
        for (const other of vehicles) {
          if (other.id === v.id) continue;
          const dx = other.x - v.x;
          const dy = other.y - v.y;
          const fwd = dx * cos + dy * sin;
          const lat = Math.abs(-dx * sin + dy * cos);
          if (fwd > 0 && fwd < 58 && lat < 22) {
            blocked = true;
            break;
          }
        }
      }

      const targetSpeed = blocked ? 0 : (curve.isUturn ? NPC_UTURN_SPEED : NPC_CURVE_SPEED);
      const currentSpeed = Math.hypot(v.vx, v.vy);
      const accelRate = playerAhead ? 6.5 : 5;
      const nextSpeed = currentSpeed + (targetSpeed - currentSpeed) * Math.min(1, dt * accelRate);
      curve.t = Math.min(1, curve.t + (nextSpeed * dt) / curve.length);

      const sample = this.#evalNpcCurve(curve, curve.t);
      v.x = sample.x;
      v.y = sample.y;
      const tangentAngle = Math.hypot(sample.dx, sample.dy) > 0.001
        ? Math.atan2(sample.dy, sample.dx)
        : curve.targetAngle;
      v.angle = this.#lerpAngle(v.angle, tangentAngle, dt * 14);
      v.vx = Math.cos(v.angle) * nextSpeed;
      v.vy = Math.sin(v.angle) * nextSpeed;
      v.speed = nextSpeed;

      if (curve.t >= 1) {
        v.x = curve.p1x;
        v.y = curve.p1y;
        v.angle = curve.targetAngle;
        v.npcCurve = null;
      }
      return;
    }

    const heading = this.#getCardinalHeading(v.angle);
    const intersection = this.#findNextIntersection(v, heading);

    let activeHeading = heading;
    let yielding = false;
    let atRedLight = false;

    if (intersection) {
      const turnInfo = this.#chooseTurnAtIntersection(v, intersection, heading);
      const yieldRes = this.#shouldYieldAtIntersection(v, intersection, heading, turnInfo, vehicles, time);
      yielding = yieldRes.yield;
      atRedLight = yieldRes.atRedLight;

      if (!turnInfo.executed && turnInfo.turn !== 'straight' && !yielding) {
        const triggerCoord = heading.axis === 'h' ? intersection.cx : intersection.cy;
        const entryLead = turnInfo.turn === 'right'
          ? rw * 0.44
          : turnInfo.turn === 'left'
            ? rw * 0.24
            : rw * 0.14;
        const turnStartCoord = triggerCoord - (heading.axis === 'h' ? heading.dx : heading.dy) * entryLead;
        const posAlong = heading.axis === 'h' ? v.x : v.y;
        const dirSign = heading.axis === 'h' ? heading.dx : heading.dy;
        if ((posAlong - turnStartCoord) * dirSign >= 0) {
          turnInfo.executed = true;
          this.#startNpcCurve(v, intersection, heading, turnInfo, rw);
          return;
        }
      }
    }

    // Alinha suavemente o veículo à sua faixa de mão direita
    const laneOffset =
      activeHeading.axis === 'h'
        ? this.cityMap.roadYOffsets[this.#findNearestRoadIndex(this.cityMap.roadYOffsets, v.y)]
        : this.cityMap.roadXOffsets[this.#findNearestRoadIndex(this.cityMap.roadXOffsets, v.x)];
    const desiredLane = this.#getRightHandLaneCoord(laneOffset, activeHeading.dx, activeHeading.dy);
    if (activeHeading.axis === 'h') {
      v.y += (desiredLane - v.y) * Math.min(1, dt * 4.5);
    } else {
      v.x += (desiredLane - v.x) * Math.min(1, dt * 4.5);
    }
    v.angle = this.#lerpAngle(v.angle, activeHeading.angle, dt * 10);

    const cos = Math.cos(v.angle);
    const sin = Math.sin(v.angle);
    let blocked = yielding;
    let headOnBlocked = false;
    let playerAhead = false;

    if (!blocked && !player.inVehicleId) {
      const pFwd = (player.x - v.x) * cos + (player.y - v.y) * sin;
      const pLat = Math.abs(-(player.x - v.x) * sin + (player.y - v.y) * cos);
      const latThreshold = (v.width || 24) * 0.5 + (player.radius || 12) + 4;
      if (pFwd > 0 && pFwd < 78 && pLat < latThreshold) {
        blocked = true;
        playerAhead = true;
      }
    }

    if (!blocked) {
      for (const other of vehicles) {
        if (other.id === v.id) continue;
        const dx = other.x - v.x;
        const dy = other.y - v.y;
        const fwd = dx * cos + dy * sin;
        const lat = Math.abs(-dx * sin + dy * cos);
        if (fwd > 0 && fwd < 68 && lat < 23) {
          blocked = true;
          const dot = cos * Math.cos(other.angle) + sin * Math.sin(other.angle);
          if (dot < -0.5) {
            headOnBlocked = true;
          }
          break;
        }
      }
    }

    if (blocked && !atRedLight) {
      v.stuckTimer = (v.stuckTimer || 0) + dt;
      // Recuperação anti-travamento se dois veículos ficarem frente a frente ou bloqueados por muito tempo
      if (v.stuckTimer > (headOnBlocked ? 1.4 : 2.6)) {
        const rightX = -sin;
        const rightY = cos;
        v.x += (rightX * 26 - cos * 22) * dt;
        v.y += (rightY * 26 - sin * 22) * dt;
        if (v.stuckTimer > 3.5) {
          v.angle += Math.PI;
          v.npcTurn = null;
          v.stuckTimer = 0;
        }
      }
    } else {
      v.stuckTimer = 0;
    }

    const targetSpeed = blocked ? 0 : NPC_VEHICLE_CRUISE_SPEED;
    const currentSpeed = Math.hypot(v.vx, v.vy);
    const accelRate = playerAhead ? 6.5 : 4.5;
    const nextSpeed = currentSpeed + (targetSpeed - currentSpeed) * Math.min(1, dt * accelRate);
    v.vx = cos * nextSpeed;
    v.vy = sin * nextSpeed;
    v.speed = nextSpeed;

    v.x += v.vx * dt;
    v.y += v.vy * dt;

    // Garantia final de permanência dentro da ilha na faixa de mão correta
    const margin = rw * 0.25;
    if (
      v.x < margin ||
      v.y < margin ||
      v.x > this.cityMap.worldWidth - margin ||
      v.y > this.cityMap.worldHeight - margin
    ) {
      v.angle += Math.PI;
      v.npcTurn = null;
      v.x = Math.max(margin, Math.min(this.cityMap.worldWidth - margin, v.x));
      v.y = Math.max(margin, Math.min(this.cityMap.worldHeight - margin, v.y));
    }
  }

  normalizeTrafficAtMissionStart(vehicles, player) {
    const rw = this.cityMap.roadWidth;
    const halfBox = rw * 0.58;
    const minSpacing = 135;
    const cellSize = minSpacing;
    const grid = new Map();

    const isInsideIntersection = (x, y) => {
      const col = this.#findNearestRoadIndex(this.cityMap.roadXOffsets, x);
      const row = this.#findNearestRoadIndex(this.cityMap.roadYOffsets, y);
      const cx = this.cityMap.roadXOffsets[col] + rw * 0.5;
      const cy = this.cityMap.roadYOffsets[row] + rw * 0.5;
      return Math.abs(x - cx) < halfBox && Math.abs(y - cy) < halfBox;
    };

    const isSpotFree = (x, y) => {
      if (player && Math.hypot(x - player.x, y - player.y) < minSpacing) {
        return false;
      }
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const bucket = grid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (Math.hypot(x - other.x, y - other.y) < minSpacing) {
              return false;
            }
          }
        }
      }
      return true;
    };

    const registerPlaced = (v) => {
      const key = `${Math.floor(v.x / cellSize)},${Math.floor(v.y / cellSize)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(v);
    };

    const spawns = this.cityMap.vehicleSpawns || [];

    for (let idx = 0; idx < vehicles.length; idx += 1) {
      const v = vehicles[idx];
      if (v.destroyed || v.id === player?.inVehicleId) continue;

      if (!v.driver) {
        v.driver = 'npc';
        v.isParked = false;
      }

      v.npcTurn = null;
      v.npcCurve = null;
      v.stuckTimer = 0;
      v.claimedByPedId = null;
      v.emptyTimer = 0;

      const heading = this.#getCardinalHeading(v.angle);
      v.angle = heading.angle;

      if (isInsideIntersection(v.x, v.y) || !isSpotFree(v.x, v.y)) {
        const homeSpawn = spawns.find((s) => s.id === v.id);
        let relocated = false;
        if (homeSpawn && !isInsideIntersection(homeSpawn.x, homeSpawn.y) && isSpotFree(homeSpawn.x, homeSpawn.y)) {
          v.x = homeSpawn.x;
          v.y = homeSpawn.y;
          v.angle = homeSpawn.angle;
          relocated = true;
        } else if (spawns.length > 0) {
          const startOffset = (idx * 37) % spawns.length;
          for (let step = 0; step < spawns.length; step += 1) {
            const s = spawns[(startOffset + step) % spawns.length];
            if (!isInsideIntersection(s.x, s.y) && isSpotFree(s.x, s.y)) {
              v.x = s.x;
              v.y = s.y;
              v.angle = s.angle;
              relocated = true;
              break;
            }
          }
        }
        if (!relocated) {
          const finalHeading = this.#getCardinalHeading(v.angle);
          v.angle = finalHeading.angle;
        }
      }

      const finalHeading = this.#getCardinalHeading(v.angle);
      v.angle = finalHeading.angle;
      v.vx = Math.cos(v.angle) * NPC_VEHICLE_CRUISE_SPEED;
      v.vy = Math.sin(v.angle) * NPC_VEHICLE_CRUISE_SPEED;
      v.speed = NPC_VEHICLE_CRUISE_SPEED;
      registerPlaced(v);
    }
  }

  #assignPedestriansToEmptyVehicles(vehicles, player, activeRadius) {
    let hasBoarded = false;
    for (const ped of this.pedestrians) {
      if (ped.boarded) {
        hasBoarded = true;
        break;
      }
    }
    if (hasBoarded) {
      this.pedestrians = this.pedestrians.filter((p) => !p.boarded);
    }

    for (const v of vehicles) {
      if (v.driver || v.destroyed || (v.speed || 0) >= 25) {
        v.emptyTimer = 0;
        continue;
      }
      if (Math.abs(v.x - player.x) > activeRadius || Math.abs(v.y - player.y) > activeRadius) continue;

      v.emptyTimer = (v.emptyTimer || 0) + 0.05;
      if (v.emptyTimer < 0.25) continue;

      if (v.claimedByPedId) {
        const claimer = this.pedestrians.find(
          (p) => p.id === v.claimedByPedId && p.state === 'walking' && p.substate === 'boarding_vehicle' && p.targetVehicleId === v.id
        );
        if (claimer) continue;
        v.claimedByPedId = null;
      }

      let bestPed = null;
      let bestDist = 360;
      for (const ped of this.pedestrians) {
        if (ped.state !== 'walking' || ped.substate) continue;
        const d = Math.hypot(ped.x - v.x, ped.y - v.y);
        if (d < bestDist) {
          bestDist = d;
          bestPed = ped;
        }
      }

      if (bestPed) {
        bestPed.substate = 'boarding_vehicle';
        bestPed.targetVehicleId = v.id;
        v.claimedByPedId = bestPed.id;
      }
    }
  }

  #updateBoardingPedestrian(ped, dt, vehicles) {
    const vehicle = vehicles.find((v) => v.id === ped.targetVehicleId);
    if (!vehicle || vehicle.driver || vehicle.destroyed) {
      ped.substate = null;
      ped.targetVehicleId = null;
      if (vehicle && vehicle.claimedByPedId === ped.id) {
        vehicle.claimedByPedId = null;
      }
      return;
    }

    const dx = vehicle.x - ped.x;
    const dy = vehicle.y - ped.y;
    const dist = Math.hypot(dx, dy);
    const enterRadius = (vehicle.radius || 18) + (ped.radius || 10) + 8;

    if (dist <= enterRadius) {
      vehicle.driver = 'npc';
      vehicle.isParked = false;
      vehicle.claimedByPedId = null;
      vehicle.npcTurn = null;
      ped.substate = null;
      ped.targetVehicleId = null;
      ped.boarded = true;
      ped.speed = 0;
      return;
    }

    const dirX = dx / dist;
    const dirY = dy / dist;
    const walkSpeed = PED_TO_VEHICLE_SPEED;
    ped.dirX = dirX;
    ped.dirY = dirY;
    ped.angle = Math.atan2(dirY, dirX);
    ped.speed = walkSpeed;
    ped.walkPhase = (ped.walkPhase || 0) + dt * 11;
    ped.x += dirX * walkSpeed * dt;
    ped.y += dirY * walkSpeed * dt;
  }
}
