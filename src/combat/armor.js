// Colete: absorve dano antes da vida. Lógica pura.

export const MAX_ARMOR = 100;

export function sanitizeArmor(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_ARMOR, n)) : 0;
}

// O colete leva o dano primeiro; o que sobrar vai para a vida.
export function absorbDamage(armor, damage) {
  const current = sanitizeArmor(armor);
  const incoming = Math.max(0, Math.round(damage));
  const absorbed = Math.min(current, incoming);
  return { armor: current - absorbed, healthDamage: incoming - absorbed, absorbed };
}

export function addArmor(armor, amount) {
  return sanitizeArmor(sanitizeArmor(armor) + Math.max(0, Math.round(amount)));
}
