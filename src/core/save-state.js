export const SAVE_STORAGE_KEY = 'gta-cv-save-v1';

function getDefaultStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function sanitizeSlot(slot) {
  if (!slot || typeof slot !== 'object' || !slot.id) return null;
  return {
    id: String(slot.id),
    name: String(slot.name || slot.id),
    description: String(slot.description || ''),
    imageUrl: String(slot.imageUrl || ''),
    category: String(slot.category || 'missao'),
    rarity: String(slot.rarity || ''),
  };
}

function sanitizeMoney(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(999999999, n)) : 0;
}

function sanitizeWeapon(weapon) {
  if (!weapon || typeof weapon !== 'object' || !weapon.id) return null;
  const mag = Math.floor(Number(weapon.ammoInMag));
  const reserve = Math.floor(Number(weapon.ammoReserve));
  return {
    id: String(weapon.id),
    ammoInMag: Number.isFinite(mag) ? Math.max(0, mag) : 0,
    ammoReserve: Number.isFinite(reserve) ? Math.max(0, reserve) : 0,
  };
}

function normalizeUnlockedMissionIndices(indices, fallbackMaxIndex = 0) {
  const set = new Set([0]);
  if (Array.isArray(indices)) {
    for (const rawIdx of indices) {
      const n = Math.floor(Number(rawIdx));
      if (Number.isFinite(n) && n >= 0) set.add(n);
    }
  } else if (Number.isFinite(fallbackMaxIndex) && fallbackMaxIndex > 0) {
    for (let i = 0; i <= fallbackMaxIndex; i += 1) {
      set.add(i);
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function createSaveSnapshot({
  storyKey = 'default',
  currentMissionIndex = 0,
  unlockedMissionIndices = [0],
  freeRoamMode = false,
  itemPickedUp = false,
  inventorySlots = [],
  collectedExtraIds = [],
  completedNpcPoints = [],
  money = 0,
  weapon = null,
  player = {},
} = {}) {
  const health = Number.isFinite(player.health) ? Math.max(1, Math.min(100, player.health)) : 100;
  const missionIdx = Math.max(0, Math.floor(Number(currentMissionIndex) || 0));
  const unlocked = normalizeUnlockedMissionIndices(unlockedMissionIndices);
  if (!freeRoamMode) {
    if (!unlocked.includes(missionIdx)) {
      unlocked.push(missionIdx);
      unlocked.sort((a, b) => a - b);
    }
  }
  return {
    version: 1,
    money: sanitizeMoney(money),
    weapon: sanitizeWeapon(weapon),
    storyKey: String(storyKey || 'default'),
    currentMissionIndex: missionIdx,
    unlockedMissionIndices: unlocked,
    freeRoamMode: Boolean(freeRoamMode),
    itemPickedUp: Boolean(itemPickedUp),
    inventorySlots: Array.isArray(inventorySlots) ? inventorySlots.map(sanitizeSlot) : [],
    collectedExtraIds: Array.isArray(collectedExtraIds)
      ? [...new Set(collectedExtraIds.map((id) => String(id)).filter(Boolean))]
      : [],
    completedNpcPoints: Array.isArray(completedNpcPoints)
      ? completedNpcPoints
        .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
        .map((pt) => ({ x: pt.x, y: pt.y }))
      : [],
    player: {
      x: Number.isFinite(player.x) ? player.x : 0,
      y: Number.isFinite(player.y) ? player.y : 0,
      angle: Number.isFinite(player.angle) ? player.angle : 0,
      health,
    },
    updatedAt: Date.now(),
  };
}

export function saveGameState(snapshot, storage = getDefaultStorage()) {
  if (!storage || !snapshot) return false;
  try {
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function loadGameState(storyKey = 'default', storage = getDefaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    if (storyKey && parsed.storyKey && parsed.storyKey !== String(storyKey)) {
      return null;
    }
    if (!parsed.player || !Number.isFinite(parsed.player.x) || !Number.isFinite(parsed.player.y)) {
      return null;
    }
    const currentMissionIndex = Math.max(0, Math.floor(Number(parsed.currentMissionIndex) || 0));
    const freeRoamMode = Boolean(parsed.freeRoamMode);
    const unlockedMissionIndices = normalizeUnlockedMissionIndices(
      parsed.unlockedMissionIndices,
      currentMissionIndex,
    );
    if (!freeRoamMode && !unlockedMissionIndices.includes(currentMissionIndex)) {
      unlockedMissionIndices.push(currentMissionIndex);
      unlockedMissionIndices.sort((a, b) => a - b);
    }
    return {
      ...parsed,
      money: sanitizeMoney(parsed.money),
      weapon: sanitizeWeapon(parsed.weapon),
      currentMissionIndex,
      unlockedMissionIndices,
      freeRoamMode,
      itemPickedUp: Boolean(parsed.itemPickedUp),
      inventorySlots: Array.isArray(parsed.inventorySlots) ? parsed.inventorySlots.map(sanitizeSlot) : [],
      collectedExtraIds: Array.isArray(parsed.collectedExtraIds)
        ? parsed.collectedExtraIds.map((id) => String(id)).filter(Boolean)
        : [],
      completedNpcPoints: Array.isArray(parsed.completedNpcPoints)
        ? parsed.completedNpcPoints.filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
        : [],
      player: {
        x: parsed.player.x,
        y: parsed.player.y,
        angle: Number.isFinite(parsed.player.angle) ? parsed.player.angle : 0,
        health: Number.isFinite(parsed.player.health) ? Math.max(1, Math.min(100, parsed.player.health)) : 100,
      },
    };
  } catch {
    return null;
  }
}

export function clearGameState(storage = getDefaultStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(SAVE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function formatContinueLabel(savedState) {
  if (!savedState) return 'Entrar na Cidade';
  if (savedState.freeRoamMode) {
    return 'Continuar (Modo Livre)';
  }
  const missionNum = Math.max(1, (savedState.currentMissionIndex || 0) + 1);
  return `Continuar (Missão ${missionNum})`;
}
