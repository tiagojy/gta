import { isPositionFree, resolveCircleOBB, resolveEntityCollisions } from './collision.js';

// Velocidade de cruzeiro dos veículos controlados por NPCs (px/s).
export const NPC_VEHICLE_CRUISE_SPEED = 95;

export const VEHICLE_PROFILES = {
  car: {
    maxSpeed: 420,
    reverseMax: 165,
    accel: 430,
    brake: 650,
    turnRate: 3.2,
    lateralGrip: 9.0,
    driftGrip: 4.5,
    length: 44,
    width: 24,
    radius: 17
  },
  moto: {
    maxSpeed: 480,
    reverseMax: 115,
    accel: 540,
    brake: 680,
    turnRate: 3.9,
    lateralGrip: 10.5,
    driftGrip: 5.5,
    length: 34,
    width: 16,
    radius: 12
  },
  van: {
    maxSpeed: 340,
    reverseMax: 145,
    accel: 320,
    brake: 540,
    turnRate: 2.6,
    lateralGrip: 7.8,
    driftGrip: 3.8,
    length: 54,
    width: 28,
    radius: 20
  }
};

export function createVehicleEntity(spawn) {
  const profile = VEHICLE_PROFILES[spawn.kind] || VEHICLE_PROFILES.car;
  const angle = spawn.angle || 0;
  const initialSpeed = spawn.driver === 'npc' ? NPC_VEHICLE_CRUISE_SPEED : 0;
  return {
    id: spawn.id,
    kind: spawn.kind,
    model: spawn.model,
    color: spawn.color,
    x: spawn.x,
    y: spawn.y,
    vx: Math.cos(angle) * initialSpeed,
    vy: Math.sin(angle) * initialSpeed,
    angle,
    speed: initialSpeed,
    isDrifting: false,
    driftIntensity: 0,
    length: profile.length,
    width: profile.width,
    radius: profile.radius,
    isParked: Boolean(spawn.isParked),
    driver: spawn.driver || null,
    health: 100,
    destroyed: false
  };
}

export function resolvePedestrianEnvironmentCollisions(x, y, radius, cityMap, vehicles = []) {
  const colliders = cityMap.getCollidersAround(x, y, 100);
  const env = resolveEntityCollisions(x, y, radius, colliders);
  let nx = env.x;
  let ny = env.y;
  let collided = env.collided;
  let hitVehicle = null;

  for (const v of vehicles) {
    if (Math.abs(v.x - nx) > 80 || Math.abs(v.y - ny) > 80) continue;
    const hit = resolveCircleOBB(nx, ny, radius, v);
    if (hit.collided) {
      nx = hit.x;
      ny = hit.y;
      collided = true;
      hitVehicle = v;
    }
  }

  return { x: nx, y: ny, collided, hitVehicle };
}

export function updatePedestrian(player, input, dt, cityMap, vehicles = []) {
  const walkSpeed = 175;
  const mx = input.moveX;
  const my = input.moveY;

  if (Math.hypot(mx, my) > 0.05) {
    player.angle = Math.atan2(my, mx);
    player.speed = walkSpeed;
  } else {
    player.speed = 0;
  }

  const nextX = player.x + mx * walkSpeed * dt;
  const nextY = player.y + my * walkSpeed * dt;
  const resolved = resolvePedestrianEnvironmentCollisions(nextX, nextY, player.radius, cityMap, vehicles);

  player.x = resolved.x;
  player.y = resolved.y;
}

export function updateVehicle(vehicle, input, dt, cityMap) {
  if (vehicle.destroyed) {
    vehicle.vx = 0;
    vehicle.vy = 0;
    vehicle.speed = 0;
    vehicle.isDrifting = false;
    vehicle.driftIntensity = 0;
    return { collided: false, impactSpeed: 0 };
  }
  const profile = VEHICLE_PROFILES[vehicle.kind] || VEHICLE_PROFILES.car;

  if (vehicle.driver === 'player') {
    const prevCos = Math.cos(vehicle.angle);
    const prevSin = Math.sin(vehicle.angle);
    const prevForward = vehicle.vx * prevCos + vehicle.vy * prevSin;
    const rawSpeed = Math.abs(prevForward);
    const speedFactor = rawSpeed > 4 ? Math.min(1, Math.max(0.32, rawSpeed / 65)) : 0;
    const directionSign = prevForward >= -5 ? 1 : -1;
    const rawSteer = input.moveX;
    const targetSteer = Math.sign(rawSteer) * Math.pow(Math.abs(rawSteer), 1.15);
    const prevSteer = Number.isFinite(vehicle.steerInput) ? vehicle.steerInput : 0;
    const steer = prevSteer + (targetSteer - prevSteer) * Math.min(1, 10 * dt);
    vehicle.steerInput = steer;
    const highSpeedDamp = 1 - 0.22 * Math.min(1, rawSpeed / profile.maxSpeed);
    vehicle.angle += steer * profile.turnRate * speedFactor * highSpeedDamp * directionSign * dt;

    const cos = Math.cos(vehicle.angle);
    const sin = Math.sin(vehicle.angle);
    let forwardSpeed = vehicle.vx * cos + vehicle.vy * sin;
    let lateralSpeed = -vehicle.vx * sin + vehicle.vy * cos;

    // W/↑ acelera, S/↓ freia e dá ré. Entradas antigas (actionPressed/secondaryPressed)
    // continuam valendo quando throttlePressed/brakePressed não vêm no input.
    const throttle = Boolean(input.throttlePressed ?? input.actionPressed);
    const brake = Boolean(input.brakePressed ?? input.secondaryPressed);

    if (throttle && !brake) {
      vehicle.accelHoldTime = (vehicle.accelHoldTime || 0) + dt;
      const ramp = Math.min(1, vehicle.accelHoldTime / 1.4);
      const accelFactor = 0.25 + 0.75 * Math.pow(ramp, 1.15);
      forwardSpeed += profile.accel * accelFactor * dt;
    } else if (brake && !throttle) {
      vehicle.accelHoldTime = 0;
      if (forwardSpeed > 25) {
        forwardSpeed -= profile.brake * dt;
      } else {
        forwardSpeed -= profile.accel * 0.65 * dt;
      }
    } else {
      vehicle.accelHoldTime = Math.max(0, (vehicle.accelHoldTime || 0) - dt * 2.5);
      const drag = Math.exp(-2.8 * dt);
      forwardSpeed *= drag;
    }

    forwardSpeed = Math.max(-profile.reverseMax, Math.min(profile.maxSpeed, forwardSpeed));

    const drifting =
      Math.abs(forwardSpeed) > profile.maxSpeed * 0.62 &&
      Math.abs(steer) > 0.55;

    const grip = drifting ? profile.driftGrip : profile.lateralGrip;
    lateralSpeed *= Math.exp(-grip * dt);

    vehicle.isDrifting = drifting || Math.abs(lateralSpeed) > 45;
    vehicle.driftIntensity = Math.min(1, Math.abs(lateralSpeed) / 140);

    vehicle.vx = forwardSpeed * cos - lateralSpeed * sin;
    vehicle.vy = forwardSpeed * sin + lateralSpeed * cos;
  } else {
    const cos = Math.cos(vehicle.angle);
    const sin = Math.sin(vehicle.angle);
    const idleDrag = Math.exp(-4.0 * dt);
    const forwardSpeed = (vehicle.vx * cos + vehicle.vy * sin) * idleDrag;
    const lateralSpeed = (-vehicle.vx * sin + vehicle.vy * cos) * idleDrag;
    vehicle.isDrifting = false;
    vehicle.driftIntensity = 0;
    vehicle.vx = forwardSpeed * cos - lateralSpeed * sin;
    vehicle.vy = forwardSpeed * sin + lateralSpeed * cos;
  }
  vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);

  const nextX = vehicle.x + vehicle.vx * dt;
  const nextY = vehicle.y + vehicle.vy * dt;
  const colliders = cityMap.getCollidersAround(nextX, nextY, 120, true);
  const resolved = resolveEntityCollisions(nextX, nextY, vehicle.radius, colliders);

  let impactSpeed = 0;
  if (resolved.collided) {
    impactSpeed = Math.hypot(vehicle.vx, vehicle.vy);
    vehicle.vx *= 0.35;
    vehicle.vy *= 0.35;
    vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);
  }

  vehicle.x = resolved.x;
  vehicle.y = resolved.y;
  return { collided: resolved.collided, impactSpeed };
}

export function evaluateVehicleImpact(impactSpeed, threshold = 270) {
  if (impactSpeed < threshold) {
    return { eject: false, damage: 0 };
  }
  const damage = Math.min(85, Math.round((impactSpeed - threshold) * 0.35 + 22));
  return { eject: true, damage };
}

export function applyVehicleDamage(vehicle, impactSpeed, minImpact = 95) {
  if (!vehicle || vehicle.destroyed || impactSpeed < minImpact) {
    return { damaged: false, exploded: false, damage: 0 };
  }
  const damage = Math.min(50, Math.max(3, Math.round((impactSpeed - minImpact) * 0.12 + 4)));
  vehicle.health = Math.max(0, (vehicle.health ?? 100) - damage);
  return {
    damaged: true,
    exploded: vehicle.health <= 0,
    damage
  };
}

export function updateVehicleCriticalState(vehicle, dt) {
  if (!vehicle || vehicle.destroyed) {
    return { smokingCritical: false, shouldExplode: false };
  }
  const health = vehicle.health ?? 100;
  if (health <= 0) {
    return { smokingCritical: false, shouldExplode: true };
  }
  if (health > 30) {
    vehicle.criticalTimer = null;
    return { smokingCritical: false, shouldExplode: false };
  }
  if (typeof vehicle.criticalTimer !== 'number') {
    vehicle.criticalTimer = 10;
  }
  vehicle.criticalTimer = Math.max(0, vehicle.criticalTimer - dt);
  return {
    smokingCritical: true,
    shouldExplode: vehicle.criticalTimer <= 0
  };
}

export function computeShockwaveFalloff(distance, maxRadius) {
  if (maxRadius <= 0 || distance >= maxRadius) {
    return 0;
  }
  const ratio = Math.max(0, Math.min(1, distance / maxRadius));
  return Math.pow(1 - ratio, 1.35);
}

export function computeShockwaveDamage(distance, maxRadius, maxDamage) {
  const strength = computeShockwaveFalloff(distance, maxRadius);
  if (strength <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(maxDamage * strength));
}

export function isTouchingVehicle(entityX, entityY, entityRadius, vehicle, margin = 6) {
  if (!vehicle) return false;
  const dx = entityX - vehicle.x;
  const dy = entityY - vehicle.y;
  const cos = Math.cos(-(vehicle.angle || 0));
  const sin = Math.sin(-(vehicle.angle || 0));
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const halfLen = (vehicle.length || 44) * 0.5 + entityRadius + margin;
  const halfWid = (vehicle.width || 24) * 0.5 + entityRadius + margin;
  return Math.abs(localX) <= halfLen && Math.abs(localY) <= halfWid;
}

export function updateEjectedPlayer(player, dt, cityMap, vehicles = []) {
  const ej = player.ejected;
  if (!ej || !ej.active) {
    return { extraDamage: 0 };
  }

  if (ej.hitCooldown > 0) {
    ej.hitCooldown = Math.max(0, ej.hitCooldown - dt);
  }

  const nextX = player.x + ej.vx * dt;
  const nextY = player.y + ej.vy * dt;
  const colliders = cityMap.getCollidersAround(nextX, nextY, 100);
  let resolved = resolveEntityCollisions(nextX, nextY, player.radius, colliders);
  let hitObstacle = resolved.collided;

  for (const v of vehicles) {
    if (v.id === ej.sourceVehicleId && ej.graceTimer > 0) continue;
    if (Math.abs(v.x - resolved.x) > 80 || Math.abs(v.y - resolved.y) > 80) continue;
    const hit = resolveCircleOBB(resolved.x, resolved.y, player.radius, v);
    if (hit.collided) {
      resolved = hit;
      hitObstacle = true;
    }
  }

  if (ej.graceTimer > 0) {
    ej.graceTimer = Math.max(0, ej.graceTimer - dt);
  }

  player.x = resolved.x;
  player.y = resolved.y;

  let extraDamage = 0;
  const speed = Math.hypot(ej.vx, ej.vy);
  if (hitObstacle) {
    if (ej.hitCooldown <= 0 && speed > 45) {
      extraDamage = Math.min(35, Math.max(10, Math.round(speed * 0.08)));
      ej.hitCooldown = 0.25;
    }
    ej.vx *= -0.45;
    ej.vy *= -0.45;
  }

  const drag = Math.exp(-3.6 * dt);
  ej.vx *= drag;
  ej.vy *= drag;
  player.speed = Math.hypot(ej.vx, ej.vy);

  if (player.speed < 22) {
    ej.active = false;
    ej.vx = 0;
    ej.vy = 0;
    player.speed = 0;
  }

  return { extraDamage };
}

export function findNearestVehicle(x, y, vehicles, maxDist = 52) {
  let nearest = null;
  let bestDist = maxDist;
  for (const v of vehicles) {
    if (v.destroyed) continue;
    const dist = Math.hypot(v.x - x, v.y - y);
    if (dist <= bestDist) {
      bestDist = dist;
      nearest = v;
    }
  }
  return nearest;
}

export function findSafeExitPosition(vehicle, playerRadius, cityMap) {
  const offset = vehicle.width / 2 + playerRadius + 10;
  const cos = Math.cos(vehicle.angle);
  const sin = Math.sin(vehicle.angle);

  const candidates = [
    { x: vehicle.x - sin * offset, y: vehicle.y + cos * offset },
    { x: vehicle.x + sin * offset, y: vehicle.y - cos * offset },
    { x: vehicle.x - cos * (vehicle.length / 2 + playerRadius + 8), y: vehicle.y - sin * (vehicle.length / 2 + playerRadius + 8) },
    { x: vehicle.x + cos * (vehicle.length / 2 + playerRadius + 8), y: vehicle.y + sin * (vehicle.length / 2 + playerRadius + 8) }
  ];

  const colliders = cityMap.getCollidersAround(vehicle.x, vehicle.y, 120);
  for (const pos of candidates) {
    if (isPositionFree(pos.x, pos.y, playerRadius, colliders, cityMap)) {
      return pos;
    }
  }
  return { x: vehicle.x, y: vehicle.y };
}

export function createTrashBinEntity(spawn) {
  return {
    id: spawn.id,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: 0,
    angVel: 0,
    radius: 7,
    size: 14
  };
}

export function hitTrashBin(bin, impactVx, impactVy, sourceX, sourceY, launchBoost = 135) {
  if (!bin) return;
  const dx = bin.x - sourceX;
  const dy = bin.y - sourceY;
  const dist = Math.hypot(dx, dy) || 1;
  const dirX = dx / dist;
  const dirY = dy / dist;

  const vx = impactVx * 1.45 + dirX * launchBoost;
  const vy = impactVy * 1.45 + dirY * launchBoost;
  const speed = Math.hypot(vx, vy);
  const maxSpeed = 580;
  const scale = speed > maxSpeed ? maxSpeed / speed : 1;

  bin.vx = vx * scale;
  bin.vy = vy * scale;
  bin.angVel = ((bin.vx - bin.vy) * 0.04) || 6;
  // Separa levemente do ponto de impacto para não re-engatilhar no mesmo frame
  bin.x += dirX * 4;
  bin.y += dirY * 4;
}

export function updateTrashBin(bin, dt, cityMap) {
  const speed = Math.hypot(bin.vx, bin.vy);
  if (speed < 3 && Math.abs(bin.angVel) < 0.05) {
    bin.vx = 0;
    bin.vy = 0;
    bin.angVel = 0;
    return { bounced: false };
  }

  const damp = Math.exp(-2.6 * dt);
  bin.vx *= damp;
  bin.vy *= damp;
  bin.angVel *= Math.exp(-3.0 * dt);

  const nextX = bin.x + bin.vx * dt;
  const nextY = bin.y + bin.vy * dt;
  bin.angle += bin.angVel * dt;

  const colliders = cityMap.getCollidersAround(nextX, nextY, 48, true);
  const resolved = resolveEntityCollisions(nextX, nextY, bin.radius, colliders);
  let bounced = false;

  if (resolved.collided) {
    const pushX = resolved.x - nextX;
    const pushY = resolved.y - nextY;
    const pushLen = Math.hypot(pushX, pushY);
    if (pushLen > 1e-4) {
      const nx = pushX / pushLen;
      const ny = pushY / pushLen;
      const dot = bin.vx * nx + bin.vy * ny;
      if (dot < 0) {
        const restitution = 0.7;
        bin.vx -= (1 + restitution) * dot * nx;
        bin.vy -= (1 + restitution) * dot * ny;
        bin.angVel = -bin.angVel * 0.75;
        bounced = true;
      }
    }
  }

  bin.x = resolved.x;
  bin.y = resolved.y;
  return { bounced };
}

export function applyPedestrianDamage(ped, damage, impactVx = 0, impactVy = 0) {
  if (!ped || ped.state === 'downed' || (ped.hitCooldown || 0) > 0 || damage <= 0) {
    return { damaged: false, downed: false };
  }
  ped.health = Math.max(0, (ped.health ?? 100) - damage);
  ped.hitCooldown = 0.35;
  ped.vx = impactVx * 0.7;
  ped.vy = impactVy * 0.7;

  if (ped.health <= 0) {
    ped.state = 'downed';
    ped.runOver = true;
    return { damaged: true, downed: true };
  }

  const len = Math.hypot(impactVx, impactVy);
  if (len > 1) {
    ped.dirX = impactVx / len;
    ped.dirY = impactVy / len;
    ped.angle = Math.atan2(ped.dirY, ped.dirX);
  }
  ped.state = 'fleeing';
  ped.fleeTimer = 3.5;
  return { damaged: true, downed: false };
}
