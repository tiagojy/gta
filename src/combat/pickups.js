// Itens espalhados pela cidade: caixa de munição, kit médico e colete. Lógica pura (sem DOM).
// O engine dá a posição do jogador e uma função que diz se um ponto é válido (calçada livre).

import { addAmmo, getWeaponDef } from './weapons.js?v=4';
import { getEquipped, ownedWeaponIds } from './arsenal.js?v=2';
import { MAX_ARMOR, addArmor } from './armor.js?v=1';

export const PICKUP_TYPES = {
  ammo: { id: 'ammo', weight: 5 },
  medkit: { id: 'medkit', weight: 3, heal: 50 },
  armor: { id: 'armor', weight: 2, armor: 50 }
};

export const PICKUP_CONFIG = {
  target: 8, // quantos itens ficam no mundo ao mesmo tempo
  minDist: 380, // não nascem em cima do jogador nem na tela
  maxDist: 900,
  despawnDist: 1500, // some quando o jogador se afasta demais
  lifetime: 150, // segundos
  spawnInterval: 1.2,
  pickupRadius: 24,
  spawnTries: 14
};

export function createPickupState() {
  return { items: [], spawnTimer: 0, nextId: 1 };
}

export function rollPickupType(rng = Math.random) {
  const entries = Object.values(PICKUP_TYPES);
  const total = entries.reduce((sum, t) => sum + t.weight, 0);
  let roll = rng() * total;
  for (const t of entries) {
    roll -= t.weight;
    if (roll < 0) return t.id;
  }
  return entries[entries.length - 1].id;
}

// Envelhece os itens, remove os velhos ou distantes e, de tempos em tempos, cria um novo.
// ctx = { px, py, isValidPoint(x, y), rng? }
export function updatePickups(state, dt, ctx, config = PICKUP_CONFIG) {
  const rng = ctx.rng || Math.random;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    item.age += dt;
    const far = Math.hypot(item.x - ctx.px, item.y - ctx.py) > config.despawnDist;
    if (item.age > config.lifetime || far) state.items.splice(i, 1);
  }

  state.spawnTimer -= dt;
  if (state.spawnTimer > 0 || state.items.length >= config.target) return null;
  state.spawnTimer = config.spawnInterval;

  for (let attempt = 0; attempt < config.spawnTries; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = config.minDist + rng() * (config.maxDist - config.minDist);
    const x = ctx.px + Math.cos(angle) * dist;
    const y = ctx.py + Math.sin(angle) * dist;
    if (!ctx.isValidPoint(x, y)) continue;
    const item = { id: state.nextId++, type: rollPickupType(rng), x, y, age: 0 };
    state.items.push(item);
    return item;
  }
  return null;
}

// Itens ao alcance de quem está coletando (a pé ou de carro), do mais perto ao mais longe.
export function findPickupsInReach(state, x, y, radius = PICKUP_CONFIG.pickupRadius) {
  return state.items
    .map((item) => ({ item, d: Math.hypot(item.x - x, item.y - y) }))
    .filter((e) => e.d <= radius)
    .sort((a, b) => a.d - b.d)
    .map((e) => e.item);
}

export function removePickup(state, item) {
  const idx = state.items.indexOf(item);
  if (idx >= 0) state.items.splice(idx, 1);
}

// Efeito do item. Devolve { consumed, message, health, armor }; se nada mudaria
// (vida cheia, colete cheio, munição cheia), não consome e o item continua lá.
export function applyPickupEffect(type, { arsenal, health, armor }) {
  if (type === 'medkit') {
    if (health >= 100) return { consumed: false, message: 'Vida já está cheia.', health, armor };
    const healed = Math.min(100, health + PICKUP_TYPES.medkit.heal);
    return { consumed: true, message: `Kit médico +${healed - health}`, health: healed, armor };
  }

  if (type === 'armor') {
    if (armor >= MAX_ARMOR) return { consumed: false, message: 'Colete já está cheio.', health, armor };
    const next = addArmor(armor, PICKUP_TYPES.armor.armor);
    return { consumed: true, message: `Colete +${next - armor}`, health, armor: next };
  }

  if (type === 'ammo') {
    const equipped = getEquipped(arsenal);
    const order = [equipped?.id, ...ownedWeaponIds(arsenal)].filter(Boolean);
    for (const id of order) {
      const state = arsenal.weapons[id];
      const added = addAmmo(state, getWeaponDef(id).pickupAmmo);
      if (added > 0) {
        return { consumed: true, message: `Munição de ${getWeaponDef(id).shortName.toLowerCase()} +${added}`, health, armor };
      }
    }
    return { consumed: false, message: 'Munição já está cheia.', health, armor };
  }

  return { consumed: false, message: '', health, armor };
}
