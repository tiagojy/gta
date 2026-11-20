// Dinheiro solto por NPCs que morrem. Cada NPC rende um valor diferente (R$).
// A maioria carrega pouco; alguns poucos carregam bem mais.
const MIN_CASH = 15;
const COMMON_MAX = 120;
const RICH_MAX = 400;
const RICH_CHANCE = 0.1;

export function rollPedestrianCash(random = Math.random) {
  const rich = random() < RICH_CHANCE;
  const min = rich ? COMMON_MAX : MIN_CASH;
  const max = rich ? RICH_MAX : COMMON_MAX;
  const raw = min + random() * (max - min);
  return Math.max(MIN_CASH, Math.round(raw / 5) * 5);
}
