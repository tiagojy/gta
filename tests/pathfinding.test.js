import test from 'node:test';
import assert from 'node:assert/strict';
import { CityMap } from '../src/world/city-map.js';
import { RoadPathfinder } from '../src/world/pathfinding.js';

test('calcula rota pelas ruas até o código de local alvo', () => {
  const map = new CityMap();
  const pathfinder = new RoadPathfinder(map);
  const start = map.resolveLocationCode('CASA-01').spawnPoint;

  const route = pathfinder.findRoute(start.x, start.y, 'PRACA-01');
  assert.ok(route.length >= 3);

  const dest = map.resolveLocationCode('PRACA-01').spawnPoint;
  const last = route[route.length - 1];
  assert.equal(last.x, dest.x);
  assert.equal(last.y, dest.y);
});

test('retorna lista vazia quando não há objetivo ativo', () => {
  const map = new CityMap();
  const pathfinder = new RoadPathfinder(map);
  const route = pathfinder.findRoute(100, 100, null);
  assert.deepEqual(route, []);
});

test('findRouteToPoint traça rota pelas ruas até uma coordenada qualquer e termina no ponto', async () => {
  const { CityMap } = await import('../src/world/city-map.js');
  const { RoadPathfinder } = await import('../src/world/pathfinding.js');
  const map = new CityMap();
  const finder = new RoadPathfinder(map);
  const from = { x: map.worldWidth * 0.1, y: map.worldHeight * 0.1 };
  const goal = { x: map.worldWidth * 0.8, y: map.worldHeight * 0.7 };
  const route = finder.findRouteToPoint(from.x, from.y, goal.x, goal.y);
  assert.ok(route.length >= 3);
  assert.deepEqual(route[0], from);
  assert.deepEqual(route[route.length - 1], goal);
});
