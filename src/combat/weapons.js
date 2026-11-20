// Sistema de armas e projéteis.
// Funções puras (sem DOM, sem WebGL) para poderem ser testadas com node:test.
// O engine decide o que fazer com cada evento de impacto (dano, sangue, faíscas).

export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'Pistola',
    shortName: 'Pistola',
    damage: 34,
    pellets: 1, // projéteis por disparo
    fireInterval: 0.28, // segundos entre tiros
    bulletSpeed: 820, // px/s
    range: 560, // px
    magSize: 12,
    maxReserve: 120, // máximo de balas guardadas fora do carregador
    reloadTime: 1.2, // segundos
    spread: 0.03, // dispersão aleatória (radianos)
    spawnOffset: 6, // a bala nasce dentro do corpo do jogador, para nunca atravessar uma parede colada
    flashTime: 0.06,
    visualLength: 11 // tamanho da arma desenhada na mão do personagem
  },
  smg: {
    id: 'smg',
    name: 'Submetralhadora',
    shortName: 'SMG',
    damage: 18,
    pellets: 1,
    fireInterval: 0.085,
    bulletSpeed: 900,
    range: 520,
    magSize: 30,
    maxReserve: 180,
    reloadTime: 1.6,
    spread: 0.09,
    spawnOffset: 6,
    flashTime: 0.05,
    visualLength: 15
  },
  shotgun: {
    id: 'shotgun',
    name: 'Escopeta',
    shortName: 'Escopeta',
    damage: 22, // por projétil (cada tiro lança vários)
    pellets: 6,
    fireInterval: 0.85,
    bulletSpeed: 780,
    range: 300,
    magSize: 6,
    maxReserve: 48,
    reloadTime: 2.2,
    spread: 0.34,
    spawnOffset: 6,
    flashTime: 0.08,
    visualLength: 22
  }
};

// Ordem usada nas teclas 1, 2, 3... e na roda do mouse.
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun'];

export function getWeaponDef(weaponId) {
  const def = WEAPONS[weaponId];
  if (!def) {
    throw new Error(`Arma desconhecida: ${weaponId}`);
  }
  return def;
}

export function createWeaponState(weaponId = 'pistol', { reserve = 36 } = {}) {
  const def = getWeaponDef(weaponId);
  return {
    id: def.id,
    ammoInMag: def.magSize,
    ammoReserve: Math.max(0, Math.floor(reserve)),
    cooldown: 0,
    reloadTimer: 0,
    flashTimer: 0,
    visualLength: def.visualLength
  };
}

// Recria o estado da arma a partir de um save (dados antigos, ausentes ou inválidos viram a pistola padrão).
export function restoreWeaponState(saved, fallbackReserve = 36) {
  if (!saved || typeof saved !== 'object' || !WEAPONS[saved.id]) {
    return createWeaponState('pistol', { reserve: fallbackReserve });
  }
  const def = WEAPONS[saved.id];
  const state = createWeaponState(def.id, { reserve: 0 });
  const mag = Math.floor(Number(saved.ammoInMag));
  const reserve = Math.floor(Number(saved.ammoReserve));
  state.ammoInMag = Number.isFinite(mag) ? Math.max(0, Math.min(def.magSize, mag)) : def.magSize;
  state.ammoReserve = Number.isFinite(reserve) ? Math.max(0, reserve) : fallbackReserve;
  return state;
}

export function isReloading(state) {
  return state.reloadTimer > 0;
}

// Soma munição à reserva respeitando o máximo da arma. Devolve quantas balas realmente entraram.
export function addAmmo(state, amount) {
  if (!state || !(amount > 0)) return 0;
  const def = getWeaponDef(state.id);
  const room = Math.max(0, def.maxReserve - state.ammoReserve);
  const added = Math.min(room, Math.floor(amount));
  state.ammoReserve += added;
  return added;
}

export function cancelReload(state) {
  if (state) state.reloadTimer = 0;
}

function finishReload(state) {
  const def = getWeaponDef(state.id);
  const missing = def.magSize - state.ammoInMag;
  const moved = Math.min(missing, state.ammoReserve);
  state.ammoInMag += moved;
  state.ammoReserve -= moved;
}

export function startReload(state) {
  const def = getWeaponDef(state.id);
  if (isReloading(state)) return false;
  if (state.ammoInMag >= def.magSize) return false;
  if (state.ammoReserve <= 0) return false;
  state.reloadTimer = def.reloadTime;
  return true;
}

export function updateWeaponState(state, dt) {
  if (!state) return;
  if (state.cooldown > 0) {
    state.cooldown = Math.max(0, state.cooldown - dt);
  }
  if (state.flashTimer > 0) {
    state.flashTimer = Math.max(0, state.flashTimer - dt);
  }
  if (state.reloadTimer > 0) {
    state.reloadTimer -= dt;
    if (state.reloadTimer <= 0) {
      state.reloadTimer = 0;
      finishReload(state);
    }
  }
}

// Tenta atirar. Devolve a bala criada ou null (em recarga, em intervalo ou sem munição).
// Com o carregador vazio, dispara a recarga automaticamente (se houver munição de reserva).
export function tryFireBullets(state, x, y, angle, rng = Math.random) {
  if (!state) return [];
  const def = getWeaponDef(state.id);
  if (isReloading(state) || state.cooldown > 0) return [];
  if (state.ammoInMag <= 0) {
    startReload(state);
    return [];
  }
  state.ammoInMag -= 1;
  state.cooldown = def.fireInterval;
  state.flashTimer = def.flashTime;
  const bullets = [];
  for (let i = 0; i < (def.pellets || 1); i++) {
    const shotAngle = angle + (rng() - 0.5) * def.spread;
    bullets.push(createBullet(def, x, y, shotAngle));
  }
  return bullets;
}

// Versão simples: devolve só o primeiro projétil (ou null). Boa para armas de um tiro por disparo.
export function tryFire(state, x, y, angle, rng = Math.random) {
  const bullets = tryFireBullets(state, x, y, angle, rng);
  return bullets.length > 0 ? bullets[0] : null;
}

export function createBullet(def, x, y, angle) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  return {
    x: x + dirX * def.spawnOffset,
    y: y + dirY * def.spawnOffset,
    angle,
    dirX,
    dirY,
    vx: dirX * def.bulletSpeed,
    vy: dirY * def.bulletSpeed,
    speed: def.bulletSpeed,
    remaining: def.range,
    damage: def.damage
  };
}

// --- Geometria de interseção (segmento contra retângulo e contra círculo) ---

// Devolve o parâmetro t (0..1) onde o segmento entra no retângulo, ou null se não cruza.
export function segmentRectIntersection(x0, y0, x1, y1, rect) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dx) < 1e-9) {
    if (x0 < rect.x || x0 > rect.x + rect.w) return null;
  } else {
    let t1 = (rect.x - x0) / dx;
    let t2 = (rect.x + rect.w - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (Math.abs(dy) < 1e-9) {
    if (y0 < rect.y || y0 > rect.y + rect.h) return null;
  } else {
    let t1 = (rect.y - y0) / dy;
    let t2 = (rect.y + rect.h - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin;
}

// Devolve o parâmetro t (0..1) onde o segmento entra no círculo, ou null se não cruza.
export function segmentCircleIntersection(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - radius * radius;

  if (a < 1e-9) {
    return c <= 0 ? 0 : null;
  }
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t1 < 0 && t2 >= 0) return 0; // a bala já começou dentro do alvo
  return null;
}

const VEHICLE_SAMPLE_STEP = 6;

// Procura o primeiro objeto que a bala atinge no trecho (x0,y0) -> (x1,y1).
// world = { colliders: [{x,y,w,h}], pedestrians: [{x,y,radius,state}], vehicleAt?: (x, y) => veículo | null }
export function findBulletHit(x0, y0, x1, y1, world = {}) {
  let best = null;
  const consider = (t, kind, target) => {
    if (t === null || t === undefined) return;
    if (!best || t < best.t) best = { t, kind, target };
  };

  for (const rect of world.colliders || []) {
    consider(segmentRectIntersection(x0, y0, x1, y1, rect), 'wall', rect);
  }

  for (const ped of world.pedestrians || []) {
    if (ped.state === 'downed') continue;
    consider(
      segmentCircleIntersection(x0, y0, x1, y1, ped.x, ped.y, ped.radius || 10),
      'pedestrian',
      ped
    );
  }

  if (typeof world.vehicleAt === 'function') {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const samples = Math.max(1, Math.ceil(length / VEHICLE_SAMPLE_STEP));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      if (best && t >= best.t) break;
      const vehicle = world.vehicleAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (vehicle) {
        consider(t, 'vehicle', vehicle);
        break;
      }
    }
  }

  if (!best) return null;
  return {
    kind: best.kind,
    target: best.target,
    t: best.t,
    x: x0 + (x1 - x0) * best.t,
    y: y0 + (y1 - y0) * best.t
  };
}

// Avança todas as balas. Remove as que acertaram algo ou esgotaram o alcance.
// Devolve a lista de impactos: { type: 'wall'|'pedestrian'|'vehicle', x, y, bullet, target }
export function updateBullets(bullets, dt, world = {}) {
  const events = [];
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    const step = Math.min(bullet.remaining, bullet.speed * dt);
    const nextX = bullet.x + bullet.dirX * step;
    const nextY = bullet.y + bullet.dirY * step;

    const hit = findBulletHit(bullet.x, bullet.y, nextX, nextY, world);
    if (hit) {
      events.push({ type: hit.kind, x: hit.x, y: hit.y, bullet, target: hit.target });
      bullets.splice(i, 1);
      continue;
    }

    bullet.x = nextX;
    bullet.y = nextY;
    bullet.remaining -= step;
    if (bullet.remaining <= 0.01) {
      bullets.splice(i, 1);
    }
  }
  return events;
}
