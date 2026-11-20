export class RoadPathfinder {
  constructor(cityMap) {
    this.cityMap = cityMap;
    this.nodesPerAxis = cityMap.gridBlocks + 1;
  }

  nodeToWorld(ix, iy) {
    const halfRoad = this.cityMap.roadWidth / 2;
    return {
      x: this.cityMap.roadXOffsets[ix] + halfRoad,
      y: this.cityMap.roadYOffsets[iy] + halfRoad
    };
  }

  nearestNode(x, y) {
    const halfRoad = this.cityMap.roadWidth / 2;
    const findClosest = (offsets, target) => {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < offsets.length; i++) {
        const d = Math.abs(offsets[i] + halfRoad - target);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    };
    return {
      ix: findClosest(this.cityMap.roadXOffsets, x),
      iy: findClosest(this.cityMap.roadYOffsets, y)
    };
  }

  findRoute(fromX, fromY, targetCode) {
    if (!targetCode) {
      return [];
    }

    const target = this.cityMap.resolveLocationCode(targetCode);
    return this.findRouteToPoint(fromX, fromY, target.spawnPoint.x, target.spawnPoint.y);
  }

  // Rota pelas ruas até uma coordenada qualquer do mapa (ex.: destino marcado no mapa).
  findRouteToPoint(fromX, fromY, goalX, goalY) {
    const goalPos = { x: goalX, y: goalY };
    const start = this.nearestNode(fromX, fromY);
    const goal = this.nearestNode(goalPos.x, goalPos.y);

    const key = (ix, iy) => iy * this.nodesPerAxis + ix;
    const startKey = key(start.ix, start.iy);
    const goalKey = key(goal.ix, goal.iy);

    if (startKey === goalKey) {
      return [{ x: fromX, y: fromY }, { x: goalPos.x, y: goalPos.y }];
    }

    const open = new Set([startKey]);
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const fScore = new Map([[startKey, Math.abs(goal.ix - start.ix) + Math.abs(goal.iy - start.iy)]]);

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    while (open.size > 0) {
      let currentKey = -1;
      let bestF = Infinity;
      for (const k of open) {
        const f = fScore.get(k) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          currentKey = k;
        }
      }

      if (currentKey === goalKey) {
        const path = [];
        let trace = currentKey;
        while (trace !== undefined) {
          const ix = trace % this.nodesPerAxis;
          const iy = Math.floor(trace / this.nodesPerAxis);
          path.push(this.nodeToWorld(ix, iy));
          trace = cameFrom.get(trace);
        }
        path.reverse();
        return [{ x: fromX, y: fromY }, ...path, { x: goalPos.x, y: goalPos.y }];
      }

      open.delete(currentKey);
      const cx = currentKey % this.nodesPerAxis;
      const cy = Math.floor(currentKey / this.nodesPerAxis);

      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.nodesPerAxis || ny >= this.nodesPerAxis) {
          continue;
        }
        const nKey = key(nx, ny);
        const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;
        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, currentKey);
          gScore.set(nKey, tentativeG);
          const h = Math.abs(goal.ix - nx) + Math.abs(goal.iy - ny);
          fScore.set(nKey, tentativeG + h);
          open.add(nKey);
        }
      }
    }

    return [{ x: fromX, y: fromY }, { x: goalPos.x, y: goalPos.y }];
  }
}
