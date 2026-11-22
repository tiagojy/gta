import {
  GRID_BLOCKS,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  VEHICLE_VARIANTS,
  buildGridMetrics,
  createBuildingWithInterior,
  formatCode,
  hashBlock
} from './city-layout.js?v=22';

export const CHUNK_BLOCK_SIZE = 3;

export class CityMap {
  constructor() {
    this.gridBlocks = GRID_BLOCKS;
    this.roadWidth = ROAD_WIDTH;
    this.chunkBlockSize = CHUNK_BLOCK_SIZE;
    this.chunkCols = Math.ceil(this.gridBlocks / this.chunkBlockSize);
    this.chunkRows = Math.ceil(this.gridBlocks / this.chunkBlockSize);

    const metrics = buildGridMetrics();
    this.colWidths = metrics.colWidths;
    this.rowHeights = metrics.rowHeights;
    this.roadXOffsets = metrics.roadXOffsets;
    this.blockXOffsets = metrics.blockXOffsets;
    this.roadYOffsets = metrics.roadYOffsets;
    this.blockYOffsets = metrics.blockYOffsets;
    this.worldWidth = metrics.worldWidth;
    this.worldHeight = metrics.worldHeight;
    this.worldSize = Math.max(this.worldWidth, this.worldHeight);

    this.locationsByCode = new Map();
    this.horizontalRoads = [];
    this.verticalRoads = [];
    this.blocks = [];
    this.vehicleSpawns = [];
    this.trashBinSpawns = [];
    this.crosswalks = [];
    this.trafficLights = [];
    this.chunks = [];
    this.chunksByKey = new Map();

    this.#buildRoads();
    this.#buildBlocks();
    this.#buildCrosswalksAndLights();
    this.#buildVehicleSpawns();
    this.#buildChunks();
  }

  #buildRoads() {
    let roadIndex = 1;
    for (let row = 0; row <= this.gridBlocks; row++) {
      const y = this.roadYOffsets[row];
      const code = formatCode('RUA', roadIndex++);
      const road = {
        code,
        type: 'road',
        axis: 'h',
        index: row,
        bounds: { x: 0, y, w: this.worldWidth, h: this.roadWidth },
        spawnPoint: { x: this.worldWidth / 2, y: y + this.roadWidth / 2 }
      };
      this.horizontalRoads.push(road);
      this.locationsByCode.set(code, road);
    }

    for (let col = 0; col <= this.gridBlocks; col++) {
      const x = this.roadXOffsets[col];
      const code = formatCode('RUA', roadIndex++);
      const road = {
        code,
        type: 'road',
        axis: 'v',
        index: col,
        bounds: { x, y: 0, w: this.roadWidth, h: this.worldHeight },
        spawnPoint: { x: x + this.roadWidth / 2, y: this.worldHeight / 2 }
      };
      this.verticalRoads.push(road);
      this.locationsByCode.set(code, road);
    }
  }

  #buildBlocks() {
    let houseIdx = 1;
    let commerceIdx = 1;
    let plazaIdx = 1;

    const nextCode = (type) => (type === 'commerce'
      ? formatCode('COM', commerceIdx++)
      : formatCode('CASA', houseIdx++));

    for (let by = 0; by < this.gridBlocks; by++) {
      const row = [];
      for (let bx = 0; bx < this.gridBlocks; bx++) {
        const blockX = this.blockXOffsets[bx];
        const blockY = this.blockYOffsets[by];
        const bw = this.colWidths[bx];
        const bh = this.rowHeights[by];
        const seed = hashBlock(bx, by);
        const isPlaza = bx % 5 === 2 && by % 5 === 2;

        const block = {
          bx,
          by,
          bounds: { x: blockX, y: blockY, w: bw, h: bh },
          isPlaza,
          buildings: [],
          plaza: null,
          obstacles: []
        };
        const binChunkKey = `${Math.floor(bx / this.chunkBlockSize)},${Math.floor(by / this.chunkBlockSize)}`;
        this.trashBinSpawns.push(
          { id: `bin-${bx}-${by}-nw`, x: blockX + 13, y: blockY + 13, chunkKey: binChunkKey },
          { id: `bin-${bx}-${by}-se`, x: blockX + bw - 13, y: blockY + bh - 13, chunkKey: binChunkKey }
        );

        if (isPlaza) {
          const code = formatCode('PRACA', plazaIdx++);
          const innerX = blockX + SIDEWALK_WIDTH;
          const innerY = blockY + SIDEWALK_WIDTH;
          const innerW = bw - SIDEWALK_WIDTH * 2;
          const innerH = bh - SIDEWALK_WIDTH * 2;
          const fountainSize = Math.min(68, Math.floor(Math.min(innerW, innerH) * 0.28));
          const plaza = {
            code,
            type: 'plaza',
            bounds: { x: innerX, y: innerY, w: innerW, h: innerH },
            props: [
              {
                x: innerX + innerW / 2 - fountainSize / 2,
                y: innerY + innerH / 2 - fountainSize / 2,
                w: fountainSize,
                h: fountainSize,
                kind: 'fountain'
              },
              { x: innerX + 22, y: innerY + 22, w: 42, h: 14, kind: 'bench' },
              { x: innerX + innerW - 64, y: innerY + innerH - 36, w: 42, h: 14, kind: 'bench' }
            ],
            spawnPoint: { x: innerX + innerW / 2, y: innerY + 46 }
          };
          block.plaza = plaza;
          this.locationsByCode.set(code, plaza);
        } else {
          const pad = SIDEWALK_WIDTH + 6;
          const innerW = bw - pad * 2;
          const innerH = bh - pad * 2;
          const layoutStyle = seed % 4;

          if (layoutStyle === 0 && innerW >= 180 && innerH >= 180) {
            // 1 grande edificação com recuo assimétrico
            const bType = (seed >>> 2) % 2 === 0 ? 'commerce' : 'house';
            const bW = Math.floor(innerW * 0.78);
            const bH = Math.floor(innerH * 0.72);
            const offsetX = (seed % 3 === 0) ? 0 : innerW - bW;
            const b = createBuildingWithInterior({
              code: nextCode(bType),
              type: bType,
              x: blockX + pad + offsetX,
              y: blockY + pad,
              w: bW,
              h: bH,
              doorSide: (seed % 2 === 0) ? 'south' : 'north',
              seed
            });
            block.buildings.push(b);
            this.locationsByCode.set(b.code, b);
          } else if (layoutStyle === 1 && innerW >= 260) {
            // 3 edificações assimétricas: duas menores em cima e uma maior embaixo
            const gap = 16;
            const topH = Math.floor((innerH - gap) * 0.45);
            const botH = innerH - gap - topH;
            const leftW = Math.floor((innerW - gap) * 0.44);
            const rightW = innerW - gap - leftW;

            const b1 = createBuildingWithInterior({
              code: nextCode('house'),
              type: 'house',
              x: blockX + pad,
              y: blockY + pad,
              w: leftW,
              h: topH,
              doorSide: 'north',
              seed
            });
            const b2 = createBuildingWithInterior({
              code: nextCode('commerce'),
              type: 'commerce',
              x: blockX + pad + leftW + gap,
              y: blockY + pad,
              w: rightW,
              h: topH,
              doorSide: 'east',
              seed: seed >>> 3
            });
            const b3 = createBuildingWithInterior({
              code: nextCode((seed >>> 4) % 2 === 0 ? 'commerce' : 'house'),
              type: (seed >>> 4) % 2 === 0 ? 'commerce' : 'house',
              x: blockX + pad,
              y: blockY + pad + topH + gap,
              w: innerW,
              h: botH,
              doorSide: 'south',
              seed: seed >>> 5
            });
            block.buildings.push(b1, b2, b3);
            this.locationsByCode.set(b1.code, b1);
            this.locationsByCode.set(b2.code, b2);
            this.locationsByCode.set(b3.code, b3);
          } else if (layoutStyle === 2) {
            // 2 edificações lado a lado (oeste/leste) com larguras distintas
            const gap = 16;
            const leftW = Math.floor((innerW - gap) * 0.56);
            const rightW = innerW - gap - leftW;
            const b1 = createBuildingWithInterior({
              code: nextCode('commerce'),
              type: 'commerce',
              x: blockX + pad,
              y: blockY + pad,
              w: leftW,
              h: innerH,
              doorSide: 'west',
              seed
            });
            const b2 = createBuildingWithInterior({
              code: nextCode('house'),
              type: 'house',
              x: blockX + pad + leftW + gap,
              y: blockY + pad + 14,
              w: rightW,
              h: innerH - 28,
              doorSide: 'east',
              seed: seed >>> 3
            });
            block.buildings.push(b1, b2);
            this.locationsByCode.set(b1.code, b1);
            this.locationsByCode.set(b2.code, b2);
          } else {
            // 2 edificações norte/sul com alturas e recuos distintos
            const gap = 18;
            const topH = Math.floor((innerH - gap) * 0.44);
            const botH = innerH - gap - topH;
            const topType = seed % 3 === 0 ? 'commerce' : 'house';
            const botType = (seed >>> 2) % 2 === 0 ? 'commerce' : 'house';

            const b1 = createBuildingWithInterior({
              code: nextCode(topType),
              type: topType,
              x: blockX + pad + 12,
              y: blockY + pad,
              w: innerW - 24,
              h: topH,
              doorSide: 'north',
              seed
            });
            const b2 = createBuildingWithInterior({
              code: nextCode(botType),
              type: botType,
              x: blockX + pad,
              y: blockY + pad + topH + gap,
              w: innerW,
              h: botH,
              doorSide: 'south',
              seed: seed >>> 3
            });
            block.buildings.push(b1, b2);
            this.locationsByCode.set(b1.code, b1);
            this.locationsByCode.set(b2.code, b2);
          }
        }

        row.push(block);
      }
      this.blocks.push(row);
    }

    this.#placeHospitals();
  }

  #placeHospitals() {
    const protectedCodes = new Set([
      'CASA-01', 'CASA-02', 'COM-01', 'COM-24',
      'COM-320', 'CASA-353', 'COM-554', 'CASA-656'
    ]);
    const offsets = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
    const usedBlocks = new Set();
    const cols = 8;
    const rows = 5;
    let hospIdx = 1;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const baseBx = Math.floor(((col + 0.5) * this.gridBlocks) / cols);
        const baseBy = Math.floor(((row + 0.5) * this.gridBlocks) / rows);
        let placed = false;

        for (const [dx, dy] of offsets) {
          const bx = baseBx + dx;
          const by = baseBy + dy;
          const key = `${bx},${by}`;
          if (usedBlocks.has(key)) continue;

          const block = this.blocks[by]?.[bx];
          if (!block || block.isPlaza || block.buildings.length === 0) continue;

          let targetIdx = -1;
          let bestArea = -1;
          for (let i = 0; i < block.buildings.length; i++) {
            const candidate = block.buildings[i];
            if (protectedCodes.has(candidate.code)) continue;
            const area = candidate.bounds.w * candidate.bounds.h;
            if (area > bestArea) {
              bestArea = area;
              targetIdx = i;
            }
          }
          if (targetIdx === -1) continue;

          const orig = block.buildings[targetIdx];
          const hosp = createBuildingWithInterior({
            code: formatCode('HOSP', hospIdx++),
            type: 'hospital',
            x: orig.bounds.x,
            y: orig.bounds.y,
            w: orig.bounds.w,
            h: orig.bounds.h,
            doorSide: orig.doorSide,
            seed: hashBlock(bx, by)
          });
          block.buildings[targetIdx] = hosp;
          this.locationsByCode.delete(orig.code);
          this.locationsByCode.set(hosp.code, hosp);
          usedBlocks.add(key);
          placed = true;
          break;
        }

        if (!placed) {
          // Fallback varrendo a grade caso algum setor fique sem bloco elegível
          for (let by = 0; by < this.gridBlocks && !placed; by++) {
            for (let bx = 0; bx < this.gridBlocks && !placed; bx++) {
              const key = `${bx},${by}`;
              if (usedBlocks.has(key)) continue;
              const block = this.blocks[by]?.[bx];
              if (!block || block.isPlaza || block.buildings.length === 0) continue;
              const idx = block.buildings.findIndex((b) => !protectedCodes.has(b.code));
              if (idx === -1) continue;
              const orig = block.buildings[idx];
              const hosp = createBuildingWithInterior({
                code: formatCode('HOSP', hospIdx++),
                type: 'hospital',
                x: orig.bounds.x,
                y: orig.bounds.y,
                w: orig.bounds.w,
                h: orig.bounds.h,
                doorSide: orig.doorSide,
                seed: hashBlock(bx, by)
              });
              block.buildings[idx] = hosp;
              this.locationsByCode.delete(orig.code);
              this.locationsByCode.set(hosp.code, hosp);
              usedBlocks.add(key);
              placed = true;
            }
          }
        }
      }
    }
  }

  #buildCrosswalksAndLights() {
    const rw = this.roadWidth;
    const cycleDuration = 12;

    for (let row = 1; row < this.gridBlocks; row++) {
      for (let col = 1; col < this.gridBlocks; col++) {
        if ((col + row) % 3 !== 0) continue;

        const ix = this.roadXOffsets[col];
        const iy = this.roadYOffsets[row];
        const phaseOffset = ((col * 3 + row * 5) % 6) * 1.5;
        const baseId = `cw-${col}-${row}`;

        // 4 faixas de pedestre ao redor do cruzamento selecionado
        this.crosswalks.push(
          { id: `${baseId}-n`, col, row, x: ix + 4, y: iy - 24, w: rw - 8, h: 20, axis: 'h', phaseOffset, cycleDuration },
          { id: `${baseId}-s`, col, row, x: ix + 4, y: iy + rw + 4, w: rw - 8, h: 20, axis: 'h', phaseOffset, cycleDuration },
          { id: `${baseId}-w`, col, row, x: ix - 24, y: iy + 4, w: 20, h: rw - 8, axis: 'v', phaseOffset, cycleDuration },
          { id: `${baseId}-e`, col, row, x: ix + rw + 4, y: iy + 4, w: 20, h: rw - 8, axis: 'v', phaseOffset, cycleDuration }
        );

        // 4 semáforos nas quinas do cruzamento, alinhados às faixas
        this.trafficLights.push(
          { id: `tl-${col}-${row}-nw`, col, row, x: ix - 10, y: iy - 10, axis: 'v', phaseOffset, cycleDuration },
          { id: `tl-${col}-${row}-ne`, col, row, x: ix + rw + 10, y: iy - 10, axis: 'h', phaseOffset, cycleDuration },
          { id: `tl-${col}-${row}-se`, col, row, x: ix + rw + 10, y: iy + rw + 10, axis: 'v', phaseOffset, cycleDuration },
          { id: `tl-${col}-${row}-sw`, col, row, x: ix - 10, y: iy + rw + 10, axis: 'h', phaseOffset, cycleDuration }
        );
      }
    }

    // Remove lixeiras das esquinas que possuem semáforos
    this.trashBinSpawns = this.trashBinSpawns.filter((bin) => {
      for (const light of this.trafficLights) {
        if (Math.abs(bin.x - light.x) < 32 && Math.abs(bin.y - light.y) < 32) {
          return false;
        }
      }
      return true;
    });
  }

  getTrafficLightState(item, time = 0) {
    const dur = item.cycleDuration || 12;
    const t = (((time + (item.phaseOffset || 0)) % dur) + dur) % dur;
    const isGreen = item.axis === 'v' ? t < dur * 0.5 : t >= dur * 0.5;
    return isGreen ? 'green' : 'red';
  }

  findNearbyCrosswalk(x, y, axis, maxDist = 58) {
    let best = null;
    let bestDist = Infinity;
    for (const cw of this.crosswalks) {
      if (cw.axis !== axis) continue;
      const cx = Math.max(cw.x, Math.min(cw.x + cw.w, x));
      const cy = Math.max(cw.y, Math.min(cw.y + cw.h, y));
      const d = Math.hypot(x - cx, y - cy);
      if (d <= maxDist && d < bestDist) {
        bestDist = d;
        best = cw;
      }
    }
    return best;
  }

  #buildVehicleSpawns() {
    let idCounter = 1;
    const cols = this.gridBlocks;

    // Cerca de 2 veículos variados por quarteirão, sempre dirigidos por NPCs por padrão
    for (let by = 0; by < cols; by += 1) {
      for (let bx = 0; bx < cols; bx += 1) {
        const cx = Math.floor(bx / this.chunkBlockSize);
        const cy = Math.floor(by / this.chunkBlockSize);
        const chunkKey = `${cx},${cy}`;

        for (let slot = 0; slot < 2; slot += 1) {
          const seed = hashBlock(bx * 3 + slot * 17 + 7, by * 5 + slot * 23 + 13);
          const variant = VEHICLE_VARIANTS[(seed + slot * 3) % VEHICLE_VARIANTS.length];
          const horizontal = slot === 0;
          const reverseLane = (bx + by + slot) % 2 === 1;
          const hLaneFactor = reverseLane ? 0.28 : 0.72;
          const vLaneFactor = reverseLane ? 0.72 : 0.28;
          const alongRatio = 0.28 + ((seed >>> 3) % 5) * 0.11;

          const tx = horizontal
            ? this.blockXOffsets[bx] + this.colWidths[bx] * alongRatio
            : this.roadXOffsets[bx] + this.roadWidth * vLaneFactor;
          const ty = horizontal
            ? this.roadYOffsets[by] + this.roadWidth * hLaneFactor
            : this.blockYOffsets[by] + this.rowHeights[by] * alongRatio;
          const angle = horizontal
            ? (reverseLane ? Math.PI : 0)
            : (reverseLane ? -Math.PI / 2 : Math.PI / 2);

          this.vehicleSpawns.push({
            id: `VEH-${String(idCounter++).padStart(4, '0')}`,
            kind: variant.kind,
            model: variant.model,
            color: variant.color,
            x: tx,
            y: ty,
            angle,
            isParked: false,
            driver: 'npc',
            blockX: bx,
            blockY: by,
            chunkKey
          });
        }
      }
    }
  }

  #buildChunks() {
    const spawnsByChunk = new Map();
    for (const spawn of this.vehicleSpawns) {
      if (!spawnsByChunk.has(spawn.chunkKey)) {
        spawnsByChunk.set(spawn.chunkKey, []);
      }
      spawnsByChunk.get(spawn.chunkKey).push(spawn);
    }

    const trashBinsByChunk = new Map();
    for (const bin of this.trashBinSpawns) {
      if (!trashBinsByChunk.has(bin.chunkKey)) {
        trashBinsByChunk.set(bin.chunkKey, []);
      }
      trashBinsByChunk.get(bin.chunkKey).push(bin);
    }

    for (let cy = 0; cy < this.chunkRows; cy += 1) {
      const row = [];
      for (let cx = 0; cx < this.chunkCols; cx += 1) {
        const startBx = cx * this.chunkBlockSize;
        const endBx = Math.min(this.gridBlocks - 1, startBx + this.chunkBlockSize - 1);
        const startBy = cy * this.chunkBlockSize;
        const endBy = Math.min(this.gridBlocks - 1, startBy + this.chunkBlockSize - 1);

        const minX = this.roadXOffsets[startBx];
        const maxX = this.roadXOffsets[endBx + 1] + this.roadWidth;
        const minY = this.roadYOffsets[startBy];
        const maxY = this.roadYOffsets[endBy + 1] + this.roadWidth;

        const blocks = [];
        for (let by = startBy; by <= endBy; by += 1) {
          for (let bx = startBx; bx <= endBx; bx += 1) {
            blocks.push(this.blocks[by][bx]);
          }
        }

        const roadXIndices = [];
        for (let rx = startBx; rx <= endBx + 1; rx += 1) {
          roadXIndices.push(rx);
        }
        const roadYIndices = [];
        for (let ry = startBy; ry <= endBy + 1; ry += 1) {
          roadYIndices.push(ry);
        }

        const crosswalks = [];
        for (const cw of this.crosswalks) {
          const cwx = cw.x + cw.w * 0.5;
          const cwy = cw.y + cw.h * 0.5;
          if (cwx >= minX && cwx <= maxX && cwy >= minY && cwy <= maxY) {
            crosswalks.push(cw);
          }
        }

        const key = `${cx},${cy}`;
        const chunk = {
          cx,
          cy,
          key,
          startBx,
          endBx,
          startBy,
          endBy,
          bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
          blocks,
          roadXIndices,
          roadYIndices,
          crosswalks,
          vehicleSpawns: spawnsByChunk.get(key) || [],
          trashBinSpawns: trashBinsByChunk.get(key) || []
        };
        row.push(chunk);
        this.chunksByKey.set(key, chunk);
      }
      this.chunks.push(row);
    }
  }

  getChunkCoordsAt(x, y) {
    let cx = this.chunkCols - 1;
    for (let i = 0; i < this.chunkCols; i += 1) {
      const b = this.chunks[0][i].bounds;
      if (x < b.x + b.w) {
        cx = i;
        break;
      }
    }
    let cy = this.chunkRows - 1;
    for (let j = 0; j < this.chunkRows; j += 1) {
      const b = this.chunks[j][0].bounds;
      if (y < b.y + b.h) {
        cy = j;
        break;
      }
    }
    cx = Math.max(0, Math.min(this.chunkCols - 1, cx));
    cy = Math.max(0, Math.min(this.chunkRows - 1, cy));
    return { cx, cy, key: `${cx},${cy}` };
  }

  getChunkAt(x, y) {
    const { cx, cy } = this.getChunkCoordsAt(x, y);
    return this.chunks[cy][cx];
  }

  getActiveChunks(minX, minY, maxX, maxY, marginChunks = 0) {
    let startCx = this.chunkCols - 1;
    let endCx = 0;
    for (let cx = 0; cx < this.chunkCols; cx += 1) {
      const b = this.chunks[0][cx].bounds;
      if (b.x + b.w >= minX && cx < startCx) startCx = cx;
      if (b.x <= maxX && cx > endCx) endCx = cx;
    }
    let startCy = this.chunkRows - 1;
    let endCy = 0;
    for (let cy = 0; cy < this.chunkRows; cy += 1) {
      const b = this.chunks[cy][0].bounds;
      if (b.y + b.h >= minY && cy < startCy) startCy = cy;
      if (b.y <= maxY && cy > endCy) endCy = cy;
    }

    startCx = Math.max(0, startCx - marginChunks);
    endCx = Math.min(this.chunkCols - 1, endCx + marginChunks);
    startCy = Math.max(0, startCy - marginChunks);
    endCy = Math.min(this.chunkRows - 1, endCy + marginChunks);

    const active = [];
    for (let cy = startCy; cy <= endCy; cy += 1) {
      for (let cx = startCx; cx <= endCx; cx += 1) {
        active.push(this.chunks[cy][cx]);
      }
    }
    return active;
  }

  resolveLocationCode(code) {
    if (typeof code !== 'string' || !code.trim()) {
      throw new Error(`[CityMap] Código de local inválido: "${String(code)}"`);
    }
    const normalized = code.trim().toUpperCase();
    const location = this.locationsByCode.get(normalized);
    if (!location) {
      throw new Error(`[CityMap] Código de local inexistente: "${normalized}"`);
    }
    return location;
  }

  resolveItemLocation(locationStr) {
    if (typeof locationStr !== 'string' || !locationStr.trim()) {
      throw new Error(`[CityMap] Posição de item inválida: "${String(locationStr)}"`);
    }
    const trimmed = locationStr.trim().toUpperCase();
    const cornerMatch = trimmed.match(/^(RUA-\d+)\s*[X×,]\s*(RUA-\d+)(?:\s+(NO|NE|SO|SE|NW|SW))?$/);
    if (cornerMatch) {
      const roadA = this.resolveLocationCode(cornerMatch[1]);
      const roadB = this.resolveLocationCode(cornerMatch[2]);
      if (roadA.type !== 'road' || roadB.type !== 'road') {
        throw new Error(`[CityMap] Esquina inválida para item: "${locationStr}"`);
      }
      const horiz = roadA.bounds.w > roadA.bounds.h ? roadA : roadB;
      const vert = roadA.bounds.h > roadA.bounds.w ? roadA : roadB;
      if (horiz === vert) {
        throw new Error(`[CityMap] As ruas "${cornerMatch[1]}" e "${cornerMatch[2]}" são paralelas e não formam esquina.`);
      }
      const dir = cornerMatch[3] || 'SE';
      const rx = vert.bounds.x;
      const ry = horiz.bounds.y;
      const rw = this.roadWidth;
      const pad = 18;
      let x = rx + rw + pad;
      let y = ry + rw + pad;
      if (dir === 'NO' || dir === 'NW') {
        x = rx - pad;
        y = ry - pad;
      } else if (dir === 'NE') {
        x = rx + rw + pad;
        y = ry - pad;
      } else if (dir === 'SO' || dir === 'SW') {
        x = rx - pad;
        y = ry + rw + pad;
      }
      return { x, y, kind: 'corner', code: `${horiz.code} x ${vert.code}` };
    }

    const loc = this.resolveLocationCode(trimmed);
    if (loc.type === 'house' || loc.type === 'commerce' || loc.type === 'hospital') {
      const point = this.#computeIndoorOppositePoint(loc);
      return {
        x: point.x,
        y: point.y,
        kind: 'interior',
        code: loc.code
      };
    }
    if (loc.type === 'plaza') {
      return { x: loc.spawnPoint.x, y: loc.spawnPoint.y, kind: 'plaza', code: loc.code };
    }
    return { x: loc.spawnPoint.x, y: loc.spawnPoint.y, kind: loc.type, code: loc.code };
  }

  #computeIndoorOppositePoint(loc) {
    const { x: bx, y: by, w: bw, h: bh } = loc.bounds;
    const wallOffset = 28;
    let ix = bx + bw * 0.5;
    let iy = by + bh * 0.5;

    if (loc.doorSide === 'north') {
      iy = by + bh - wallOffset;
    } else if (loc.doorSide === 'south') {
      iy = by + wallOffset;
    } else if (loc.doorSide === 'west') {
      ix = bx + bw - wallOffset;
    } else if (loc.doorSide === 'east') {
      ix = bx + wallOffset;
    }

    const props = loc.interior?.props || [];
    for (const prop of props) {
      const pad = 12;
      if (
        ix >= prop.x - pad &&
        ix <= prop.x + prop.w + pad &&
        iy >= prop.y - pad &&
        iy <= prop.y + prop.h + pad
      ) {
        if (loc.doorSide === 'south' || loc.doorSide === 'east') {
          iy = Math.min(by + bh - wallOffset, prop.y + prop.h + pad);
        }
      }
    }

    return { x: ix, y: iy };
  }

  resolveIndoorOppositePosition(code) {
    const loc = this.resolveLocationCode(String(code || '').trim());
    if (loc.type !== 'house' && loc.type !== 'commerce' && loc.type !== 'hospital') {
      throw new Error(`Local "${code}" não é uma construção com interior.`);
    }
    const { x, y } = this.#computeIndoorOppositePoint(loc);
    let angle = Math.PI * 0.5;
    if (loc.doorSide === 'north') angle = -Math.PI * 0.5;
    else if (loc.doorSide === 'east') angle = 0;
    else if (loc.doorSide === 'west') angle = Math.PI;
    return { x, y, angle, building: loc };
  }

  #findIndexRange(offsets, sizes, minVal, maxVal) {
    let start = 0;
    while (start < offsets.length && offsets[start] + sizes[start] < minVal) {
      start++;
    }
    let end = start;
    while (end < offsets.length && offsets[end] <= maxVal) {
      end++;
    }
    return [start, Math.min(offsets.length - 1, end)];
  }

  getVisibleBlocks(minX, minY, maxX, maxY) {
    const [startBx, endBx] = this.#findIndexRange(this.blockXOffsets, this.colWidths, minX, maxX);
    const [startBy, endBy] = this.#findIndexRange(this.blockYOffsets, this.rowHeights, minY, maxY);

    const visible = [];
    for (let by = startBy; by <= endBy; by++) {
      for (let bx = startBx; bx <= endBx; bx++) {
        visible.push(this.blocks[by][bx]);
      }
    }
    return visible;
  }

  getBlockAt(x, y) {
    for (let bx = 0; bx < this.gridBlocks; bx++) {
      const rx = this.blockXOffsets[bx];
      if (x >= rx && x <= rx + this.colWidths[bx]) {
        for (let by = 0; by < this.gridBlocks; by++) {
          const ry = this.blockYOffsets[by];
          if (y >= ry && y <= ry + this.rowHeights[by]) {
            return this.blocks[by][bx];
          }
        }
        return null;
      }
    }
    return null;
  }

  getLocationAt(x, y) {
    const block = this.getBlockAt(x, y);
    if (block) {
      if (block.plaza) {
        const pb = block.plaza.bounds;
        if (x >= pb.x && x <= pb.x + pb.w && y >= pb.y && y <= pb.y + pb.h) {
          return block.plaza;
        }
      }
      for (const building of block.buildings) {
        const bb = building.bounds;
        if (x >= bb.x && x <= bb.x + bb.w && y >= bb.y && bb.y + bb.h >= y && y >= bb.y) {
          return building;
        }
      }
    }

    for (const road of this.horizontalRoads) {
      if (y >= road.bounds.y && y <= road.bounds.y + road.bounds.h) {
        return road;
      }
    }
    for (const road of this.verticalRoads) {
      if (x >= road.bounds.x && x <= road.bounds.x + road.bounds.w) {
        return road;
      }
    }

    if (block) {
      const rx = this.blockXOffsets[block.bx];
      const ry = this.blockYOffsets[block.by];
      const rw = this.colWidths[block.bx];
      const rh = this.rowHeights[block.by];
      const candidates = [
        { dist: Math.abs(y - ry), road: this.horizontalRoads[block.by] },
        { dist: Math.abs(ry + rh - y), road: this.horizontalRoads[block.by + 1] },
        { dist: Math.abs(x - rx), road: this.verticalRoads[block.bx] },
        { dist: Math.abs(rx + rw - x), road: this.verticalRoads[block.bx + 1] },
      ].filter((c) => Boolean(c.road));
      candidates.sort((a, b) => a.dist - b.dist);
      if (candidates[0]?.road) {
        return candidates[0].road;
      }
    }
    return null;
  }

  getSurfaceAt(x, y) {
    const block = this.getBlockAt(x, y);
    if (block) {
      if (block.plaza) {
        const pb = block.plaza.bounds;
        if (x >= pb.x && x <= pb.x + pb.w && y >= pb.y && y <= pb.y + pb.h) {
          return 'grass';
        }
      }
      return 'sidewalk';
    }
    return 'asphalt';
  }

  getCollidersAround(x, y, margin = 120, forVehicle = false) {
    const blocks = this.getVisibleBlocks(x - margin, y - margin, x + margin, y + margin);
    const colliders = [];
    for (const block of blocks) {
      for (const obs of block.obstacles) {
        colliders.push(obs);
      }
      if (block.plaza) {
        for (const prop of block.plaza.props) {
          colliders.push(prop);
        }
      }
      for (const building of block.buildings) {
        if (forVehicle) {
          colliders.push(building.bounds);
          continue;
        }
        for (const wall of building.interior.walls) {
          colliders.push(wall);
        }
        for (const prop of building.interior.props) {
          colliders.push(prop);
        }
      }
    }
    return colliders;
  }
}
