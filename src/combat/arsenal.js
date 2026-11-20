// Conjunto de armas que o jogador possui e qual está na mão. Lógica pura, sem DOM.

import {
  WEAPON_ORDER,
  WEAPONS,
  cancelReload,
  createWeaponState,
  restoreWeaponState
} from './weapons.js';

export function createArsenal() {
  return {
    equippedId: 'pistol',
    weapons: { pistol: createWeaponState('pistol', { reserve: 36 }) }
  };
}

export function hasWeapon(arsenal, weaponId) {
  return Boolean(arsenal?.weapons?.[weaponId]);
}

export function getEquipped(arsenal) {
  return arsenal?.weapons?.[arsenal.equippedId] || null;
}

// Ids das armas que o jogador tem, na ordem fixa das teclas 1, 2, 3...
export function ownedWeaponIds(arsenal) {
  return WEAPON_ORDER.filter((id) => hasWeapon(arsenal, id));
}

// Adiciona uma arma nova. Devolve false se já possui ou se o id não existe.
export function addWeapon(arsenal, weaponId, { reserve = 0 } = {}) {
  if (!WEAPONS[weaponId] || hasWeapon(arsenal, weaponId)) return false;
  arsenal.weapons[weaponId] = createWeaponState(weaponId, { reserve });
  return true;
}

// Coloca a arma na mão (cancela a recarga da arma anterior). Devolve o estado da arma ou null.
export function equipWeapon(arsenal, weaponId) {
  if (!hasWeapon(arsenal, weaponId)) return null;
  if (arsenal.equippedId !== weaponId) {
    cancelReload(getEquipped(arsenal));
    arsenal.equippedId = weaponId;
  }
  return getEquipped(arsenal);
}

// Tecla de número: slotIndex 0 = primeira arma da ordem, e assim por diante.
export function equipSlot(arsenal, slotIndex) {
  const id = WEAPON_ORDER[slotIndex];
  if (!id || !hasWeapon(arsenal, id)) return null;
  return equipWeapon(arsenal, id);
}

// Roda do mouse: direction = +1 (próxima) ou -1 (anterior), só entre as armas que possui.
export function cycleWeapon(arsenal, direction) {
  const ids = ownedWeaponIds(arsenal);
  if (ids.length <= 1) return getEquipped(arsenal);
  const current = Math.max(0, ids.indexOf(arsenal.equippedId));
  const step = direction < 0 ? -1 : 1;
  const next = ids[(current + step + ids.length) % ids.length];
  return equipWeapon(arsenal, next);
}

export function serializeArsenal(arsenal) {
  if (!arsenal) return null;
  return {
    equipped: arsenal.equippedId,
    owned: ownedWeaponIds(arsenal).map((id) => {
      const w = arsenal.weapons[id];
      return { id, ammoInMag: w.ammoInMag, ammoReserve: w.ammoReserve };
    })
  };
}

// Recria o arsenal a partir de um save. Aceita o formato novo ({ equipped, owned })
// e o antigo (uma única arma em "legacyWeapon"). Dados ausentes ou inválidos viram o arsenal padrão.
export function restoreArsenal(saved, legacyWeapon = null) {
  const entries = Array.isArray(saved?.owned)
    ? saved.owned
    : legacyWeapon
      ? [legacyWeapon]
      : [];

  const arsenal = { equippedId: null, weapons: {} };
  for (const entry of entries) {
    if (!entry || !WEAPONS[entry.id] || arsenal.weapons[entry.id]) continue;
    arsenal.weapons[entry.id] = restoreWeaponState(entry);
  }

  const owned = ownedWeaponIds(arsenal);
  if (owned.length === 0) return createArsenal();
  arsenal.equippedId = owned.includes(saved?.equipped) ? saved.equipped : owned[0];
  return arsenal;
}
