// Cápsulas de bala caindo no chão ao atirar. Lógica pura.

export const CASING_LIFETIME = 4;
export const CASING_MAX = 60;

// Joga a cápsula para o lado direito de quem atira (perpendicular à mira), com um pouco de aleatoriedade.
export function spawnCasing(list, x, y, aimAngle, color, rng = Math.random) {
  const side = aimAngle + Math.PI / 2;
  const speed = 70 + rng() * 50;
  const spread = (rng() - 0.5) * 0.9;
  list.push({
    x: x + Math.cos(aimAngle) * 8,
    y: y + Math.sin(aimAngle) * 8,
    vx: Math.cos(side + spread) * speed,
    vy: Math.sin(side + spread) * speed,
    angle: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 18,
    age: 0,
    color
  });
  while (list.length > CASING_MAX) list.shift();
}

export function updateCasings(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    c.age += dt;
    if (c.age >= CASING_LIFETIME) {
      list.splice(i, 1);
      continue;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    const drag = Math.max(0, 1 - 7 * dt);
    c.vx *= drag;
    c.vy *= drag;
    c.angle += c.spin * dt;
    c.spin *= drag;
  }
}
