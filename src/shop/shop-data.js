// Armaria: onde fica, o que vende e as regras de compra. Lógica pura, sem DOM.

import { WEAPONS, addAmmo, getWeaponDef } from '../combat/weapons.js';
import { addWeapon, equipWeapon, getEquipped, hasWeapon } from '../combat/arsenal.js';

export { GUN_SHOP_CODE, GUN_SHOP_NAME } from './shop-location.js';

// Para mudar preços, quantidades ou o que a loja vende, edite esta lista.
export const SHOP_ITEMS = [
  { id: 'ammo-pistol', kind: 'ammo', weaponId: 'pistol', amount: 12, price: 25 },
  { id: 'weapon-smg', kind: 'weapon', weaponId: 'smg', price: 600, startingAmmo: 30 },
  { id: 'ammo-smg', kind: 'ammo', weaponId: 'smg', amount: 30, price: 60 },
  { id: 'weapon-shotgun', kind: 'weapon', weaponId: 'shotgun', price: 450, startingAmmo: 12 },
  { id: 'ammo-shotgun', kind: 'ammo', weaponId: 'shotgun', amount: 8, price: 40 }
];

export function formatMoney(value) {
  return `R$ ${Math.max(0, Math.floor(value)).toLocaleString('pt-BR')}`;
}

function findItem(itemId) {
  return SHOP_ITEMS.find((item) => item.id === itemId) || null;
}

function ammoCost(item, added) {
  return Math.ceil((item.price * added) / item.amount);
}

// Monta a lista que o menu mostra: nome, detalhe, preço e se o botão de comprar está liberado.
export function describeOffers(arsenal, money) {
  return SHOP_ITEMS.map((item) => {
    const def = getWeaponDef(item.weaponId);
    const owned = hasWeapon(arsenal, item.weaponId);
    const offer = { id: item.id, price: item.price, enabled: false, buttonLabel: formatMoney(item.price), note: '' };

    if (item.kind === 'weapon') {
      offer.name = def.name;
      offer.detail = `Dano ${def.damage}${def.pellets > 1 ? ` x${def.pellets}` : ''} · Pente ${def.magSize} · Alcance ${def.range}`;
      if (owned) {
        offer.buttonLabel = 'Você já tem';
        offer.note = 'Na mão com a tecla do número';
      } else if (money < item.price) {
        offer.note = 'Dinheiro insuficiente';
      } else {
        offer.enabled = true;
      }
      return offer;
    }

    offer.name = `Munição de ${def.name.toLowerCase()}`;
    if (!owned) {
      offer.detail = `+${item.amount} balas`;
      offer.buttonLabel = 'Sem a arma';
      offer.note = `Compre a ${def.name.toLowerCase()} primeiro`;
      return offer;
    }
    const state = arsenal.weapons[item.weaponId];
    offer.detail = `+${item.amount} balas · Reserva ${state.ammoReserve}/${def.maxReserve}`;
    if (state.ammoReserve >= def.maxReserve) {
      offer.buttonLabel = 'Cheio';
      offer.note = 'Reserva no máximo';
    } else if (money < ammoCost(item, Math.min(item.amount, def.maxReserve - state.ammoReserve))) {
      offer.note = 'Dinheiro insuficiente';
    } else {
      offer.enabled = true;
    }
    return offer;
  });
}

// Executa a compra. Altera o arsenal e devolve { ok, message, money } com o saldo novo.
export function purchaseItem(itemId, arsenal, money) {
  const item = findItem(itemId);
  if (!item) return { ok: false, message: 'Item inexistente.', money };

  const def = WEAPONS[item.weaponId];

  if (item.kind === 'weapon') {
    if (hasWeapon(arsenal, item.weaponId)) return { ok: false, message: `Você já tem a ${def.name.toLowerCase()}.`, money };
    if (money < item.price) return { ok: false, message: 'Dinheiro insuficiente.', money };
    addWeapon(arsenal, item.weaponId, { reserve: item.startingAmmo || 0 });
    equipWeapon(arsenal, item.weaponId);
    return { ok: true, message: `Você comprou: ${def.name}.`, money: money - item.price };
  }

  if (!hasWeapon(arsenal, item.weaponId)) {
    return { ok: false, message: `Compre a ${def.name.toLowerCase()} primeiro.`, money };
  }
  const state = arsenal.weapons[item.weaponId];
  const room = def.maxReserve - state.ammoReserve;
  if (room <= 0) return { ok: false, message: 'Sua reserva já está no máximo.', money };
  const added = Math.min(item.amount, room);
  const cost = ammoCost(item, added);
  if (money < cost) return { ok: false, message: 'Dinheiro insuficiente.', money };
  addAmmo(state, added);
  return { ok: true, message: `+${added} balas de ${def.name.toLowerCase()}.`, money: money - cost };
}

// Ajuda para quem usa a arma equipada em mensagens do HUD.
export function equippedName(arsenal) {
  const state = getEquipped(arsenal);
  return state ? getWeaponDef(state.id).name : '';
}
