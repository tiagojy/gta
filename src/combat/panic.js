// Pânico dos pedestres ao ouvir tiros. Lógica pura: só mexe nos campos do pedestre.

const IGNORED_SUBSTATES = ['inside_building', 'boarding_vehicle'];

// Faz o pedestre fugir para longe do ponto (fromX, fromY). Devolve true se ele entrou em pânico.
export function scarePedestrian(ped, fromX, fromY, duration = 4) {
  if (!ped || ped.state === 'downed' || IGNORED_SUBSTATES.includes(ped.substate)) return false;
  const dx = ped.x - fromX;
  const dy = ped.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  ped.state = 'fleeing';
  ped.fleeTimer = Math.max(ped.fleeTimer || 0, duration);
  ped.substate = null;
  ped.crossTarget = null;
  ped.waitingCrosswalk = null;
  ped.targetBuilding = null;
  ped.plazaTarget = null;
  ped.returnTarget = null;
  ped.dirX = dx / d;
  ped.dirY = dy / d;
  ped.angle = Math.atan2(ped.dirY, ped.dirX);
  return true;
}

// Barulho de tiro: quem está bem perto sempre foge; mais longe, a chance cai até zero no limite do raio.
// Devolve quantos pedestres entraram em pânico.
export function scareNearbyPedestrians(peds, x, y, radius, rng = Math.random) {
  let scared = 0;
  for (const ped of peds || []) {
    const d = Math.hypot(ped.x - x, ped.y - y);
    if (d > radius) continue;
    const certainZone = radius * 0.4;
    const chance = d <= certainZone ? 1 : 1 - (d - certainZone) / (radius - certainZone);
    if (rng() > chance) continue;
    const duration = 3 + 3 * (1 - d / radius);
    if (scarePedestrian(ped, x, y, duration)) scared++;
  }
  return scared;
}
