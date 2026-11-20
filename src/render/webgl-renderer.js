import { createTextureAtlas } from './texture-atlas.js?v=17';

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  attribute vec4 a_color;

  uniform vec2 u_resolution;
  uniform vec2 u_camera;
  uniform float u_zoom;

  varying vec2 v_texCoord;
  varying vec4 v_color;

  void main() {
    vec2 screenPos = (a_position - u_camera) * u_zoom + u_resolution * 0.5;
    vec2 clipSpace = (screenPos / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
    v_texCoord = a_texCoord;
    v_color = a_color;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D u_image;
  varying vec2 v_texCoord;
  varying vec4 v_color;

  void main() {
    gl_FragColor = texture2D(u_image, v_texCoord) * v_color;
  }
`;

function hexToRgba(hex = '#ffffff', alpha = 1) {
  const clean = String(hex || '#ffffff').replace('#', '');
  const num = parseInt(clean, 16) || 0;
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255,
    alpha
  ];
}

export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false }) ||
               canvas.getContext('experimental-webgl', { alpha: false, antialias: false });

    if (!gl) {
      throw new Error('[WebGL] WebGL não está disponível neste navegador ou dispositivo.');
    }

    this.gl = gl;
    this.maxQuads = 12000;
    this.floatsPerVertex = 8;
    this.vertexData = new Float32Array(this.maxQuads * 6 * this.floatsPerVertex);
    this.quadCount = 0;

    this.#initShaders();
    this.#initBuffers();
    this.#initAtlas();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  #compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`[WebGL] Falha ao compilar shader: ${info}`);
    }
    return shader;
  }

  #initShaders() {
    const gl = this.gl;
    const vs = this.#compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.#compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`[WebGL] Falha ao linkar programa: ${gl.getProgramInfoLog(program)}`);
    }

    gl.useProgram(program);
    this.program = program;
    this.locPos = gl.getAttribLocation(program, 'a_position');
    this.locTex = gl.getAttribLocation(program, 'a_texCoord');
    this.locCol = gl.getAttribLocation(program, 'a_color');
    this.locResolution = gl.getUniformLocation(program, 'u_resolution');
    this.locCamera = gl.getUniformLocation(program, 'u_camera');
    this.locZoom = gl.getUniformLocation(program, 'u_zoom');
    this.zoom = 1.22;
  }

  #initBuffers() {
    const gl = this.gl;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

    const stride = this.floatsPerVertex * 4;
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.locTex);
    gl.vertexAttribPointer(this.locTex, 2, gl.FLOAT, false, stride, 8);

    gl.enableVertexAttribArray(this.locCol);
    gl.vertexAttribPointer(this.locCol, 4, gl.FLOAT, false, stride, 16);
  }

  #initAtlas() {
    const gl = this.gl;
    const atlas = createTextureAtlas();
    this.uvs = atlas.uvs;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    this.customTextures = new Map();
  }

  #getOrLoadLogoTexture(url) {
    if (!url) return null;
    const existing = this.customTextures.get(url);
    if (existing) return existing;
    const gl = this.gl;
    const entry = { texture: null, loaded: false, failed: false, width: 1, height: 1 };
    this.customTextures.set(url, entry);
    const img = new Image();
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      entry.texture = tex;
      entry.width = img.naturalWidth || img.width || 1;
      entry.height = img.naturalHeight || img.height || 1;
      entry.loaded = true;
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = url;
    return entry;
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.viewWidth = width;
    this.viewHeight = height;
  }

  #pushQuad(x, y, w, h, angle, uvName, rgba) {
    if (this.quadCount >= this.maxQuads) {
      return;
    }
    const uv = this.uvs[uvName] || this.uvs.solid;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const hw = w * 0.5;
    const hh = h * 0.5;
    const cos = angle ? Math.cos(angle) : 1;
    const sin = angle ? Math.sin(angle) : 0;

    const p0x = cx + (-hw * cos - -hh * sin);
    const p0y = cy + (-hw * sin + -hh * cos);
    const p1x = cx + (hw * cos - -hh * sin);
    const p1y = cy + (hw * sin + -hh * cos);
    const p2x = cx + (hw * cos - hh * sin);
    const p2y = cy + (hw * sin + hh * cos);
    const p3x = cx + (-hw * cos - hh * sin);
    const p3y = cy + (-hw * sin + hh * cos);

    const [r, g, b, a] = rgba;
    const d = this.vertexData;
    let i = this.quadCount * 6 * this.floatsPerVertex;

    const writeVert = (vx, vy, u, v) => {
      d[i++] = vx; d[i++] = vy;
      d[i++] = u; d[i++] = v;
      d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = a;
    };

    writeVert(p0x, p0y, uv.u0, uv.v0);
    writeVert(p1x, p1y, uv.u1, uv.v0);
    writeVert(p2x, p2y, uv.u1, uv.v1);

    writeVert(p0x, p0y, uv.u0, uv.v0);
    writeVert(p2x, p2y, uv.u1, uv.v1);
    writeVert(p3x, p3y, uv.u0, uv.v1);

    this.quadCount++;
  }

  #drawNpcWaves(x, y, time) {
    const cycle = 1.9;
    for (let i = 0; i < 3; i++) {
      const phase = ((time / cycle) + i / 3) % 1;
      const waveSize = 32 + phase * 156;
      const alpha = (1 - phase) * (1 - phase) * 0.72;
      this.#pushQuad(
        x - waveSize * 0.5,
        y - waveSize * 0.5,
        waveSize,
        waveSize,
        0,
        'shockwave',
        [0.98, 0.78, 0.2, alpha]
      );
    }
  }

  #drawStoryNpc(x, y, time, withHalo = false) {
    if (withHalo) {
      const pulse = 1 + Math.sin(time * 5) * 0.14;
      const ringSize = 36 * pulse;
      this.#pushQuad(
        x - ringSize * 0.5,
        y - ringSize * 0.5,
        ringSize,
        ringSize,
        0,
        'circle',
        [0.98, 0.78, 0.18, 0.75]
      );
    }
    // Braços e sombra no chão
    this.#pushQuad(x - 13, y - 2, 6, 7, 0, 'solid', [0.95, 0.78, 0.65, 1]);
    this.#pushQuad(x + 7, y - 2, 6, 7, 0, 'solid', [0.95, 0.78, 0.65, 1]);
    this.#pushQuad(x - 10, y - 9, 22, 22, 0, 'disc', [0, 0, 0, 0.35]);
    // Ombros, camisa, rosto e cabelo nítidos
    this.#pushQuad(x - 11, y - 11, 22, 22, 0, 'disc', [0.12, 0.16, 0.22, 1]);
    this.#pushQuad(x - 8, y - 7, 16, 16, 0, 'disc', [0.92, 0.25, 0.25, 1]);
    this.#pushQuad(x - 5, y + 1, 10, 10, 0, 'disc', [0.95, 0.78, 0.65, 1]);
    this.#pushQuad(x - 4.5, y - 2, 9, 9, 0, 'disc', [0.22, 0.14, 0.08, 1]);
  }

  renderFrame({ camera, cityMap, vehicles, boats = [], trashBins = [], pedestrians = [], player, skidMarks, bloodMarks = [], cashDrops = [], bullets = [], lockTarget = null, smokeParticles = [], explosions = [], worldCollectibles = [], objectivePoint, objectiveNpcPoint, completedNpcPoints = [], encounterLocations = null, emitNpcWaves = false, time }) {
    const gl = this.gl;
    this.quadCount = 0;

    const halfW = ((this.viewWidth || 800) * 0.5) / this.zoom + 140;
    const halfH = ((this.viewHeight || 600) * 0.5) / this.zoom + 140;
    const minX = camera.x - halfW;
    const maxX = camera.x + halfW;
    const minY = camera.y - halfH;
    const maxY = camera.y + halfH;

    // Mar ao redor da ilha e asfalto apenas dentro dos limites da cidade
    const tileStep = 128;
    const tx0 = Math.floor(minX / tileStep) * tileStep;
    const ty0 = Math.floor(minY / tileStep) * tileStep;
    for (let ty = ty0; ty < maxY; ty += tileStep) {
      for (let tx = tx0; tx < maxX; tx += tileStep) {
        const insideIsland =
          tx + tileStep > 0 &&
          ty + tileStep > 0 &&
          tx < cityMap.worldWidth &&
          ty < cityMap.worldHeight;
        this.#pushQuad(tx, ty, tileStep, tileStep, 0, insideIsland ? 'asphalt' : 'water', [1, 1, 1, 1]);
      }
    }

    // Borda costeira (areia/cais) ao redor da ilha quando visível
    const shore = 18;
    if (minX < shore) {
      this.#pushQuad(-shore, Math.max(0, minY), shore, Math.min(cityMap.worldHeight, maxY) - Math.max(0, minY), 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }
    if (maxX > cityMap.worldWidth - shore) {
      this.#pushQuad(cityMap.worldWidth, Math.max(0, minY), shore, Math.min(cityMap.worldHeight, maxY) - Math.max(0, minY), 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }
    if (minY < shore) {
      this.#pushQuad(Math.max(-shore, minX), -shore, Math.min(cityMap.worldWidth + shore, maxX) - Math.max(-shore, minX), shore, 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }
    if (maxY > cityMap.worldHeight - shore) {
      this.#pushQuad(Math.max(-shore, minX), cityMap.worldHeight, Math.min(cityMap.worldWidth + shore, maxX) - Math.max(-shore, minX), shore, 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }

    // Chunks visíveis na área da câmera (evita varrer o mapa inteiro por frame)
    const activeChunks = typeof cityMap.getActiveChunks === 'function'
      ? cityMap.getActiveChunks(minX, minY, maxX, maxY, 0)
      : [];
    const seenRoadY = new Set();
    const seenRoadX = new Set();
    const seenCrosswalks = new Set();
    const visibleBlocks = [];

    if (activeChunks.length > 0) {
      for (const chunk of activeChunks) {
        for (const ryIdx of chunk.roadYIndices) seenRoadY.add(ryIdx);
        for (const rxIdx of chunk.roadXIndices) seenRoadX.add(rxIdx);
        for (const cw of chunk.crosswalks) seenCrosswalks.add(cw);
        for (const block of chunk.blocks) {
          const b = block.bounds;
          if (b.x + b.w < minX || b.x > maxX || b.y + b.h < minY || b.y > maxY) continue;
          visibleBlocks.push(block);
        }
      }
    } else {
      for (let i = 0; i < cityMap.roadYOffsets.length; i += 1) seenRoadY.add(i);
      for (let i = 0; i < cityMap.roadXOffsets.length; i += 1) seenRoadX.add(i);
      for (const cw of cityMap.crosswalks || []) seenCrosswalks.add(cw);
      visibleBlocks.push(...cityMap.getVisibleBlocks(minX, minY, maxX, maxY));
    }

    // Faixas amarelas nas ruas dos chunks visíveis
    const stripeColor = [0.95, 0.78, 0.22, 0.85];
    const clampMinX = Math.max(0, Math.floor(minX / 64) * 64);
    const clampMaxX = Math.min(cityMap.worldWidth - 34, maxX);
    for (const ryIdx of seenRoadY) {
      const roadY = cityMap.roadYOffsets[ryIdx];
      if (roadY + cityMap.roadWidth < minY || roadY > maxY) continue;
      const ry = roadY + cityMap.roadWidth * 0.5 - 2;
      for (let sx = clampMinX; sx < clampMaxX; sx += 64) {
        this.#pushQuad(sx, ry, 34, 4, 0, 'solid', stripeColor);
      }
    }
    const clampMinY = Math.max(0, Math.floor(minY / 64) * 64);
    const clampMaxY = Math.min(cityMap.worldHeight - 34, maxY);
    for (const rxIdx of seenRoadX) {
      const roadX = cityMap.roadXOffsets[rxIdx];
      if (roadX + cityMap.roadWidth < minX || roadX > maxX) continue;
      const rx = roadX + cityMap.roadWidth * 0.5 - 2;
      for (let sy = clampMinY; sy < clampMaxY; sy += 64) {
        this.#pushQuad(rx, sy, 4, 34, 0, 'solid', stripeColor);
      }
    }

    // Faixas de pedestre nos cruzamentos dos chunks visíveis
    if (seenCrosswalks.size > 0) {
      const cwColor = [0.94, 0.95, 0.97, 0.86];
      for (const cw of seenCrosswalks) {
        if (cw.x + cw.w < minX || cw.x > maxX || cw.y + cw.h < minY || cw.y > maxY) continue;
        if (cw.axis === 'h') {
          for (let sx = cw.x + 4; sx <= cw.x + cw.w - 10; sx += 14) {
            this.#pushQuad(sx, cw.y, 7, cw.h, 0, 'solid', cwColor);
          }
        } else {
          for (let sy = cw.y + 4; sy <= cw.y + cw.h - 10; sy += 14) {
            this.#pushQuad(cw.x, sy, cw.w, 7, 0, 'solid', cwColor);
          }
        }
      }
    }

    // Quarteirões visíveis: primeiro o piso (calçadas e gramado das praças)
    const closedRoofs = [];
    for (const block of visibleBlocks) {
      const b = block.bounds;
      // Sombra de meio-fio e calçada
      this.#pushQuad(b.x - 4, b.y - 4, b.w + 8, b.h + 8, 0, 'solid', [0.16, 0.18, 0.22, 1]);
      this.#pushQuad(b.x, b.y, b.w, b.h, 0, 'sidewalk', [1, 1, 1, 1]);

      if (block.plaza) {
        const pb = block.plaza.bounds;
        this.#pushQuad(pb.x, pb.y, pb.w, pb.h, 0, 'grass', [1, 1, 1, 1]);
      }
    }

    // Marcas de drift (sobre asfalto, calçada e gramado)
    for (const mark of skidMarks) {
      if (mark.x < minX || mark.x > maxX || mark.y < minY || mark.y > maxY) continue;
      const len = mark.length || 8;
      const wid = (mark.width || 5) + (mark.surface === 'grass' ? 1.5 : 0);
      const color = mark.surface === 'grass'
        ? [0.28, 0.19, 0.09, Math.min(0.85, mark.alpha * 1.35)]
        : mark.surface === 'sidewalk'
          ? [0.18, 0.17, 0.16, mark.alpha * 0.85]
          : [0.04, 0.04, 0.05, mark.alpha];
      this.#pushQuad(mark.x - len * 0.5, mark.y - wid * 0.5, len, wid, mark.angle, 'solid', color);
    }

    // Marcas de sangue de arrasto e impacto (sobre asfalto, calçada e gramado)
    for (const mark of bloodMarks) {
      if (mark.x < minX || mark.x > maxX || mark.y < minY || mark.y > maxY) continue;
      const len = mark.length || mark.size || 8;
      const wid = mark.width || mark.size || 8;
      this.#pushQuad(mark.x - len * 0.5, mark.y - wid * 0.5, len, wid, mark.angle || 0, 'solid', [0.58, 0.04, 0.05, mark.alpha]);
    }

    // Dinheiro solto por NPCs mortos (nota verde que pulsa levemente)
    for (const drop of cashDrops) {
      if (drop.x < minX || drop.x > maxX || drop.y < minY || drop.y > maxY) continue;
      const pulse = 1 + 0.12 * Math.sin((time || 0) * 5 + drop.x * 0.05);
      const bw = 14 * pulse;
      const bh = 8 * pulse;
      this.#pushQuad(drop.x - bw * 0.5 - 1, drop.y - bh * 0.5 - 1, bw + 2, bh + 2, 0.2, 'solid', [0.05, 0.2, 0.08, 1]);
      this.#pushQuad(drop.x - bw * 0.5, drop.y - bh * 0.5, bw, bh, 0.2, 'solid', [0.35, 0.82, 0.38, 1]);
      this.#pushQuad(drop.x - 2, drop.y - 2, 4, 4, 0.2, 'solid', [0.88, 1, 0.82, 1]);
    }

    // Mobiliário de praça, obstáculos e edificações
    for (const block of visibleBlocks) {
      if (block.plaza) {
        for (const prop of block.plaza.props) {
          if (prop.kind === 'fountain') {
            this.#pushQuad(prop.x - 4, prop.y - 4, prop.w + 8, prop.h + 8, 0, 'solid', [0.75, 0.77, 0.8, 1]);
            this.#pushQuad(prop.x, prop.y, prop.w, prop.h, 0, 'water', [1, 1, 1, 1]);
          } else {
            this.#pushQuad(prop.x, prop.y, prop.w, prop.h, 0, 'solid', [0.55, 0.36, 0.2, 1]);
          }
        }
      }

      for (const obs of block.obstacles) {
        this.#pushQuad(obs.x, obs.y, obs.w, obs.h, 0, 'solid', [0.22, 0.24, 0.28, 1]);
      }

      for (const building of block.buildings) {
        const bb = building.bounds;
        const isInside = player.insideLocationCode === building.code;

        // Sombra suave da edificação
        this.#pushQuad(bb.x + 6, bb.y + 6, bb.w, bb.h, 0, 'solid', [0, 0, 0, 0.28]);

        // Interior sempre desenhado por baixo
        this.#pushQuad(bb.x, bb.y, bb.w, bb.h, 0, 'floor', hexToRgba(building.floorColor));
        for (const wall of building.interior.walls) {
          this.#pushQuad(wall.x, wall.y, wall.w, wall.h, 0, 'solid', [0.2, 0.22, 0.26, 1]);
        }
        for (const prop of building.interior.props) {
          const pCol = prop.kind === 'counter' ? [0.45, 0.28, 0.16, 1] : [0.6, 0.45, 0.3, 1];
          this.#pushQuad(prop.x, prop.y, prop.w, prop.h, 0, 'solid', pCol);
        }

        // Cobertura superior com fade suave ao entrar/sair (desenhada após pedestres)
        const roofAlpha = building.roofAlpha ?? (isInside ? 0 : 1);
        if (roofAlpha > 0.01) {
          const encounterMeta = encounterLocations instanceof Map
            ? encounterLocations.get(building.code)
            : (encounterLocations?.has?.(building.code) ? {} : null);
          const isEncounter = Boolean(encounterMeta);
          const baseRoofColor = isEncounter
            ? hexToRgba(encounterMeta.roofColor || '#d6282e')
            : hexToRgba(building.roofColor);
          closedRoofs.push({
            x: bb.x,
            y: bb.y,
            w: bb.w,
            h: bb.h,
            color: [baseRoofColor[0], baseRoofColor[1], baseRoofColor[2], baseRoofColor[3] * roofAlpha],
            alpha: roofAlpha,
            isHospital: building.type === 'hospital',
            isEncounter,
            roofLogo: encounterMeta?.roofLogo || '',
          });
        }

        // Indicação discreta da porta de entrada (soleira) e folha da porta animada
        if (building.doormat) {
          const dm = building.doormat;
          const isVertical = building.doorSide === 'west' || building.doorSide === 'east';
          const matAngle = isVertical ? Math.PI * 0.5 : 0;
          const matW = isVertical ? Math.max(dm.h, 46) : Math.max(dm.w, 46);
          const matH = isVertical ? Math.max(dm.w, 18) : Math.max(dm.h, 18);
          this.#pushQuad(
            dm.x + dm.w * 0.5 - matW * 0.5,
            dm.y + dm.h * 0.5 - matH * 0.5,
            matW,
            matH,
            matAngle,
            'doormat',
            [1, 1, 1, 0.92],
          );
        }

        const ent = building.entrance;
        const openAmt = building.doorOpen || 0;
        const doorLen = 42;
        const doorThick = 6;
        let baseAngle = 0;
        let hingeX = ent.x;
        let hingeY = ent.y;
        let swingDir = 1;

        if (building.doorSide === 'south') {
          hingeX = ent.x + 2;
          hingeY = bb.y + bb.h - 7;
          baseAngle = 0;
          swingDir = -1;
        } else if (building.doorSide === 'north') {
          hingeX = ent.x + 2;
          hingeY = bb.y + 7;
          baseAngle = 0;
          swingDir = 1;
        } else if (building.doorSide === 'west') {
          hingeX = bb.x + 7;
          hingeY = ent.y + 2;
          baseAngle = Math.PI * 0.5;
          swingDir = -1;
        } else {
          hingeX = bb.x + bb.w - 7;
          hingeY = ent.y + 2;
          baseAngle = Math.PI * 0.5;
          swingDir = 1;
        }

        const doorAngle = baseAngle + swingDir * openAmt * 1.45;
        const doorCenterX = hingeX + Math.cos(doorAngle) * (doorLen * 0.5);
        const doorCenterY = hingeY + Math.sin(doorAngle) * (doorLen * 0.5);
        this.#pushQuad(
          doorCenterX - doorLen * 0.5,
          doorCenterY - doorThick * 0.5,
          doorLen,
          doorThick,
          doorAngle,
          'solid',
          [0.45, 0.28, 0.14, 1]
        );
      }
    }

    // Seta grossa vermelha no chão apontando diretamente para a entrada do destino
    if (objectivePoint) {
      let angle = Math.PI * 0.5;
      if (objectivePoint.doorSide === 'south') angle = -Math.PI * 0.5;
      else if (objectivePoint.doorSide === 'north') angle = Math.PI * 0.5;
      else if (objectivePoint.doorSide === 'west') angle = 0;
      else if (objectivePoint.doorSide === 'east') angle = Math.PI;

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const bounce = Math.sin(time * 6) * 4;
      const cx = objectivePoint.x + cos * bounce;
      const cy = objectivePoint.y + sin * bounce;
      const arrowColor = [0.94, 0.16, 0.16, 0.62];

      const pushArrowPart = (lx, ly, w, h, rotOffset) => {
        const wx = cx + lx * cos - ly * sin;
        const wy = cy + lx * sin + ly * cos;
        this.#pushQuad(wx - w * 0.5, wy - h * 0.5, w, h, angle + rotOffset, 'solid', arrowColor);
      };

      pushArrowPart(-8, 0, 26, 13, 0);
      pushArrowPart(5, -7, 22, 10, 0.68);
      pushArrowPart(5, 7, 22, 10, -0.68);
      pushArrowPart(10, 0, 12, 12, Math.PI * 0.25);
    }

    // Aura luminosa sob itens colecionáveis espalhados pelo mapa (cor por raridade)
    for (const c of worldCollectibles) {
      if (c.collected) continue;
      if (c.kind === 'interior' && player.insideLocationCode !== c.locationCode) continue;
      if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
      const ringSize = 36 + Math.sin(time * 4 + c.x) * 4;
      const auraColor = c.rarity === 'lendario'
        ? [0.98, 0.78, 0.16, 0.36]
        : c.rarity === 'especial'
          ? [0.72, 0.38, 0.98, 0.32]
          : [0.22, 0.82, 0.98, 0.28];
      this.#pushQuad(
        c.x - ringSize * 0.5,
        c.y - ringSize * 0.5,
        ringSize,
        ringSize,
        0,
        'circle',
        auraColor
      );
    }

    // Lixeiras dinâmicas nas esquinas (podem ser arremessadas e rebater)
    for (const bin of trashBins) {
      if (bin.x < minX || bin.x > maxX || bin.y < minY || bin.y > maxY) continue;
      const sz = bin.size || 14;
      this.#pushQuad(bin.x - sz * 0.5, bin.y - sz * 0.5, sz, sz, bin.angle || 0, 'trashbin', [1, 1, 1, 1]);
    }

    // Barcos decorativos circulando ao redor da ilha (sempre na água)
    for (const boat of boats) {
      if (boat.x < minX - 40 || boat.x > maxX + 40 || boat.y < minY - 40 || boat.y > maxY + 40) continue;
      const cos = Math.cos(boat.angle);
      const sin = Math.sin(boat.angle);
      const wakePulse = 0.85 + Math.sin(time * 7 + boat.distance * 0.05) * 0.15;
      const wakeX = boat.x - cos * (boat.length * 0.58);
      const wakeY = boat.y - sin * (boat.length * 0.58);
      this.#pushQuad(
        wakeX - 12 * wakePulse,
        wakeY - 5 * wakePulse,
        24 * wakePulse,
        10 * wakePulse,
        boat.angle,
        'solid',
        [0.85, 0.95, 1, 0.32]
      );
      this.#pushQuad(
        boat.x - boat.length * 0.5,
        boat.y - boat.width * 0.5,
        boat.length,
        boat.width,
        boat.angle,
        'boat',
        hexToRgba(boat.color || '#f8fafc', 1)
      );
    }

    // Veículos visíveis (com escala/transparência ao afundar na água)
    for (const v of vehicles) {
      if (v.x < minX || v.x > maxX || v.y < minY || v.y > maxY) continue;
      const sinkScale = v.sinkScale ?? 1;
      const entryPulse = v.entryPulseTimer > 0 ? Math.sin((v.entryPulseTimer / 0.28) * Math.PI) : 0;
      const pulseScale = sinkScale * (1 + entryPulse * 0.06);
      const vHealth = v.health ?? 100;
      const baseRgba = hexToRgba(v.color, v.sinkAlpha ?? 1);
      const shade = v.destroyed ? 0.22 : 0.45 + 0.55 * (vHealth / 100);
      const rgba = [baseRgba[0] * shade, baseRgba[1] * shade, baseRgba[2] * shade, baseRgba[3]];
      if (v.sinkProgress > 0) {
        const ring = 24 + v.sinkProgress * 34;
        this.#pushQuad(v.x - ring * 0.5, v.y - ring * 0.5, ring, ring, 0, 'solid', [0.75, 0.92, 1, (1 - v.sinkProgress) * 0.45]);
      }
      const dentWidth = vHealth < 75 ? v.width * (0.9 + 0.1 * (vHealth / 100)) : v.width;
      const dentLength = vHealth < 75 ? v.length * (0.93 + 0.07 * (vHealth / 100)) : v.length;
      if (entryPulse > 0.02 && !v.destroyed) {
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const frontOffset = dentLength * 0.5 + 10;
        const sideSpread = dentWidth * 0.28;
        for (const side of [-1, 1]) {
          const hx = v.x + cos * frontOffset - sin * sideSpread * side;
          const hy = v.y + sin * frontOffset + cos * sideSpread * side;
          this.#pushQuad(hx - 12, hy - 5, 24, 10, v.angle, 'circle', [1.0, 0.94, 0.55, entryPulse * 0.7]);
        }
      }
      this.#pushQuad(
        v.x - dentLength * 0.5 * pulseScale,
        v.y - dentWidth * 0.5 * pulseScale,
        dentLength * pulseScale,
        dentWidth * pulseScale,
        v.angle,
        v.kind,
        rgba
      );
      if (vHealth < 75 && !v.destroyed) {
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const fx = v.x + cos * (v.length * 0.26);
        const fy = v.y + sin * (v.length * 0.26);
        this.#pushQuad(fx - 6, fy - 4, 12, 8, v.angle + 0.25, 'solid', [0.1, 0.1, 0.12, 0.55]);
        if (vHealth < 40) {
          const rx = v.x - cos * (v.length * 0.22);
          const ry = v.y - sin * (v.length * 0.22);
          this.#pushQuad(rx - 7, ry - 4, 14, 8, v.angle - 0.3, 'solid', [0.08, 0.08, 0.1, 0.65]);
        }
      }
      if (v.destroyed && v.burning) {
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const glowSize = Math.max(v.length, v.width) * (1.34 + Math.sin(time * 11 + v.x) * 0.12);
        this.#pushQuad(
          v.x - glowSize * 0.5,
          v.y - glowSize * 0.5,
          glowSize,
          glowSize,
          0,
          'circle',
          [0.95, 0.14, 0.04, 0.52]
        );
        const offsets = [-0.26, 0.0, 0.25];
        for (let fi = 0; fi < offsets.length; fi++) {
          const dist = v.length * offsets[fi];
          const wobble = Math.sin(time * 15 + fi * 2.1 + v.y) * 3.5;
          const fx = v.x + cos * dist - sin * wobble;
          const fy = v.y + sin * dist + cos * wobble;
          const outerSize = (22 + Math.sin(time * 16 + fi * 1.7) * 5) * sinkScale;
          const midSize = outerSize * 0.76;
          const coreSize = outerSize * 0.48;
          this.#pushQuad(fx - outerSize * 0.5, fy - outerSize * 0.5, outerSize, outerSize, 0, 'circle', [0.96, 0.16, 0.04, 0.9]);
          this.#pushQuad(fx - midSize * 0.5, fy - midSize * 0.5, midSize, midSize, 0, 'circle', [1, 0.48, 0.05, 0.94]);
          this.#pushQuad(fx - coreSize * 0.5, fy - coreSize * 0.5, coreSize, coreSize, 0, 'circle', [1, 0.92, 0.22, 0.96]);
        }
      }
      if (v.kind === 'moto' && v.driver === 'npc') {
        const riderScale = sinkScale;
        const riderAlpha = v.sinkAlpha ?? 1;
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const seed = (v.id?.charCodeAt(v.id.length - 1) || 0) + (v.id?.charCodeAt(v.id.length - 2) || 0);
        const jacketPalette = [
          [0.14, 0.16, 0.2, riderAlpha],
          [0.52, 0.14, 0.16, riderAlpha],
          [0.18, 0.34, 0.56, riderAlpha],
          [0.24, 0.32, 0.22, riderAlpha],
          [0.42, 0.26, 0.14, riderAlpha]
        ];
        const helmetPalette = [
          [0.92, 0.94, 0.97, riderAlpha],
          [0.12, 0.13, 0.16, riderAlpha],
          [0.88, 0.2, 0.18, riderAlpha],
          [0.95, 0.74, 0.16, riderAlpha],
          [0.2, 0.56, 0.88, riderAlpha]
        ];
        const jacketColor = jacketPalette[seed % jacketPalette.length];
        const helmetColor = helmetPalette[(seed * 3) % helmetPalette.length];
        const drawRiderPart = (fwd, side, w, h, tex, col) => {
          const px = v.x + (cos * fwd - sin * side) * riderScale;
          const py = v.y + (sin * fwd + cos * side) * riderScale;
          this.#pushQuad(px - w * 0.5 * riderScale, py - h * 0.5 * riderScale, w * riderScale, h * riderScale, v.angle, tex, col);
        };

        // Farol dianteiro sutil
        drawRiderPart(v.length * 0.52, 0, 12, 10, 'circle', [1, 0.94, 0.72, 0.28 * riderAlpha]);
        // Pernas apoiadas nas laterais da moto
        drawRiderPart(1, -6.5, 9, 4.5, 'solid', [0.12, 0.15, 0.22, riderAlpha]);
        drawRiderPart(1, 6.5, 9, 4.5, 'solid', [0.12, 0.15, 0.22, riderAlpha]);
        // Braços estendidos até o guidão
        drawRiderPart(6.5, -6, 9, 3.8, 'solid', jacketColor);
        drawRiderPart(6.5, 6, 9, 3.8, 'solid', jacketColor);
        // Luvas no guidão
        drawRiderPart(10.5, -6.2, 4, 3.8, 'disc', [0.1, 0.1, 0.12, riderAlpha]);
        drawRiderPart(10.5, 6.2, 4, 3.8, 'disc', [0.1, 0.1, 0.12, riderAlpha]);
        // Tronco e ombros arredondados (jaqueta)
        drawRiderPart(-1.5, 0, 14, 17, 'disc', jacketColor);
        // Capacete e viseira frontal escura
        drawRiderPart(1.5, 0, 11.5, 11.5, 'disc', helmetColor);
        drawRiderPart(5.2, 0, 4.5, 8.2, 'disc', [0.08, 0.11, 0.16, riderAlpha]);
      }
    }

    // Pedestres NPC (mesma silhueta do jogador com braços/pernas animados e cores variadas)
    for (const ped of pedestrians) {
      if (ped.x < minX || ped.x > maxX || ped.y < minY || ped.y > maxY) continue;
      const skin = ped.skinColor || [0.92, 0.72, 0.52, 1];
      const hair = ped.hairColor || [0.16, 0.12, 0.1, 1];
      const pants = ped.pantsColor || [0.15, 0.22, 0.35, 1];
      const cos = Math.cos(ped.angle);
      const sin = Math.sin(ped.angle);
      if (ped.state === 'downed') {
        const drawDownedPart = (fwd, side, w, h, rotOffset, tex, col) => {
          const px = ped.x + cos * fwd - sin * side;
          const py = ped.y + sin * fwd + cos * side;
          this.#pushQuad(px - w * 0.5, py - h * 0.5, w, h, ped.angle + rotOffset, tex, col);
        };
        const shoeCol = [0.1, 0.1, 0.12, 1];
        const outlineCol = [0.12, 0.16, 0.22, 1];
        // Sombra suave no chão
        drawDownedPart(-1, 0, 34, 18, 0, 'circle', [0, 0, 0, 0.28]);
        // Pernas levemente abertas e sapatos
        drawDownedPart(-8.5, -3.4, 12, 4.8, 0.18, 'solid', pants);
        drawDownedPart(-14.2, -4.4, 4.8, 4.2, 0.18, 'disc', shoeCol);
        drawDownedPart(-8.2, 3.6, 12, 4.8, -0.22, 'solid', pants);
        drawDownedPart(-13.8, 4.8, 4.8, 4.2, -0.22, 'disc', shoeCol);
        // Braços esparramados nas laterais com mãos
        drawDownedPart(3.5, -7.8, 9.5, 3.8, -0.65, 'solid', skin);
        drawDownedPart(6.5, -10.6, 4.2, 4.2, 0, 'disc', skin);
        drawDownedPart(2.0, 8.0, 9.5, 3.8, 0.55, 'solid', skin);
        drawDownedPart(5.2, 10.6, 4.2, 4.2, 0, 'disc', skin);
        // Tronco (camisa) com contorno
        drawDownedPart(0.8, 0, 14.5, 13.5, 0, 'disc', outlineCol);
        drawDownedPart(0.8, 0, 12.5, 11.5, 0, 'disc', ped.color);
        // Cabeça tombada e cabelo
        drawDownedPart(9.8, 0.4, 9.6, 9.6, 0, 'disc', outlineCol);
        drawDownedPart(10.0, 0.4, 8.2, 8.2, 0, 'disc', skin);
        drawDownedPart(8.6, -0.6, 7.2, 7.0, 0, 'disc', hair);
      } else {
        const swing = Math.sin(ped.walkPhase || 0) * 6;
        const drawPedLimb = (forwardOffset, sideOffset, w, h, col) => {
          const lx = ped.x + (cos * forwardOffset - sin * sideOffset);
          const ly = ped.y + (sin * forwardOffset + cos * sideOffset);
          this.#pushQuad(lx - w * 0.5, ly - h * 0.5, w, h, ped.angle, 'solid', col);
        };
        // Pernas alternadas
        drawPedLimb(swing, -5, 9, 6, pants);
        drawPedLimb(-swing, 5, 9, 6, pants);
        // Braços alternados (opostos às pernas)
        drawPedLimb(-swing * 0.85 + 2, -11, 8, 5, skin);
        drawPedLimb(swing * 0.85 + 2, 11, 8, 5, skin);
        const hs = ped.hopScale ?? 1;
        // Sombra, contorno dos ombros, camisa, rosto e cabelo
        this.#pushQuad(ped.x - 9, ped.y - 9, 20, 20, 0, 'circle', [0, 0, 0, 0.35]);
        this.#pushQuad(ped.x - 9.5 * hs, ped.y - 9.5 * hs, 19 * hs, 19 * hs, 0, 'circle', [0.12, 0.16, 0.22, 1]);
        this.#pushQuad(ped.x + cos * 2 - 6.5 * hs, ped.y + sin * 2 - 6.5 * hs, 13 * hs, 13 * hs, 0, 'circle', ped.color);
        this.#pushQuad(ped.x + cos * 5.2 - 3.8 * hs, ped.y + sin * 5.2 - 3.8 * hs, 7.6 * hs, 7.6 * hs, 0, 'circle', skin);
        this.#pushQuad(ped.x + cos * 4.0 - 3.6 * hs, ped.y + sin * 4.0 - 3.6 * hs, 7.2 * hs, 7.2 * hs, 0, 'circle', hair);
      }
    }

    // Personagens de missões já concluídas e NPCs fixos de encontros extras
    for (const pt of completedNpcPoints) {
      if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue;
      const isPlayerInsideEncounter = Boolean(
        !player.inVehicleId && pt.location && player.insideLocationCode === pt.location,
      );
      this.#drawStoryNpc(pt.x, pt.y, time, isPlayerInsideEncounter);
      if (isPlayerInsideEncounter) {
        this.#drawNpcWaves(pt.x, pt.y, time);
      }
    }

    // Boneco do personagem de destino (dentro do estabelecimento ou no ponto de encontro)
    const npcMarker = objectiveNpcPoint || objectivePoint;
    if (npcMarker) {
      this.#drawStoryNpc(npcMarker.x, npcMarker.y, time, true);
    }

    // Telhados fechados cobrem pessoas dentro dos prédios quando o jogador está fora
    const pendingRoofLogos = [];
    for (const roof of closedRoofs) {
      const ra = roof.alpha ?? 1;
      this.#pushQuad(roof.x, roof.y, roof.w, roof.h, 0, 'roof', roof.color);
      if (roof.isHospital) {
        const crossLen = Math.min(roof.w, roof.h) * 0.56;
        const armThick = Math.max(10, Math.round(crossLen * 0.3));
        const cx = roof.x + roof.w * 0.5;
        const cy = roof.y + roof.h * 0.5;
        const red = [0.88, 0.14, 0.18, ra];
        this.#pushQuad(cx - armThick * 0.5, cy - crossLen * 0.5, armThick, crossLen, 0, 'solid', red);
        this.#pushQuad(cx - crossLen * 0.5, cy - armThick * 0.5, crossLen, armThick, 0, 'solid', red);
      } else if (roof.isEncounter) {
        const logoEntry = roof.roofLogo ? this.#getOrLoadLogoTexture(roof.roofLogo) : null;
        if (logoEntry && logoEntry.loaded && logoEntry.texture) {
          pendingRoofLogos.push({ roof, entry: logoEntry, alpha: ra });
        } else {
          const cx = roof.x + roof.w * 0.5;
          const cy = roof.y + roof.h * 0.5;
          const markH = Math.min(roof.w, roof.h) * 0.52;
          const thick = Math.max(8, Math.round(markH * 0.22));
          const barH = Math.max(12, Math.round(markH * 0.62));
          const dotSize = Math.max(8, Math.round(thick * 1.05));
          const gap = Math.max(5, Math.round(markH * 0.1));
          const totalH = barH + gap + dotSize;
          const topY = cy - totalH * 0.5;
          const white = [1, 1, 1, ra];
          this.#pushQuad(cx - thick * 0.5, topY, thick, barH, 0, 'solid', white);
          this.#pushQuad(cx - dotSize * 0.5, topY + barH + gap, dotSize, dotSize, 0, 'disc', white);
        }
      }
    }

    // Ondas circulares estilo sinal Wi-Fi ao redor do personagem de destino (visíveis mesmo com teto fechado)
    if (npcMarker && emitNpcWaves) {
      this.#drawNpcWaves(npcMarker.x, npcMarker.y, time);
    }

    // Jogador a pé ou montado em moto (que não possui teto)
    const playerVehicle = player.inVehicleId ? vehicles.find((v) => v.id === player.inVehicleId) : null;
    const ridingMoto = Boolean(playerVehicle && playerVehicle.kind === 'moto');

    if (!player.inVehicleId || ridingMoto) {
      const pScale = ridingMoto
        ? (playerVehicle.sinkScale ?? 1)
        : (player.sinkScale ?? 1) * (player.entryScale ?? 1);
      const pAlpha = ridingMoto
        ? (playerVehicle.sinkAlpha ?? 1)
        : (player.sinkAlpha ?? 1) * (player.entryAlpha ?? 1);
      if (!ridingMoto && player.sinkProgress > 0) {
        const ring = 20 + player.sinkProgress * 28;
        this.#pushQuad(player.x - ring * 0.5, player.y - ring * 0.5, ring, ring, 0, 'solid', [0.75, 0.92, 1, (1 - player.sinkProgress) * 0.5]);
      }
      const swing = !ridingMoto && player.speed > 5 && !player.ejected?.active ? Math.sin(player.walkPhase || 0) * 6 : 0;
      const cos = Math.cos(player.angle);
      const sin = Math.sin(player.angle);
      const drawLimb = (forwardOffset, sideOffset, w, h, color) => {
        const lx = player.x + (cos * forwardOffset - sin * sideOffset) * pScale;
        const ly = player.y + (sin * forwardOffset + cos * sideOffset) * pScale;
        this.#pushQuad(lx - w * 0.5 * pScale, ly - h * 0.5 * pScale, w * pScale, h * pScale, player.angle, 'solid', [color[0], color[1], color[2], pAlpha]);
      };

      if (ridingMoto) {
        // Braços estendidos segurando o guidão
        drawLimb(8, -7, 9, 4, [0.92, 0.72, 0.52]);
        drawLimb(8, 7, 9, 4, [0.92, 0.72, 0.52]);
      } else {
        // Pernas alternadas
        drawLimb(swing, -5, 9, 6, [0.15, 0.22, 0.35]);
        drawLimb(-swing, 5, 9, 6, [0.15, 0.22, 0.35]);
        // Braços alternados (opostos às pernas)
        drawLimb(-swing * 0.85 + 2, -11, 8, 5, [0.92, 0.72, 0.52]);
        drawLimb(swing * 0.85 + 2, 11, 8, 5, [0.92, 0.72, 0.52]);
      }

      this.#pushQuad(player.x - 14 * pScale, player.y - 14 * pScale, 28 * pScale, 28 * pScale, player.angle, 'player', [1, 1, 1, pAlpha]);

      // Pistola na mão direita + clarão do disparo
      if (!ridingMoto && player.weapon && !player.isDead) {
        drawLimb(16, 6, 11, 4, [0.1, 0.11, 0.14]);
        drawLimb(11, 6, 5, 5, [0.92, 0.72, 0.52]);
        if (player.weapon.flashTimer > 0) {
          drawLimb(25, 6, 11, 11, [1, 0.92, 0.55]);
        }
      }
    }

    // Semáforos com luz sutil verde/vermelha emanando dos dois lados
    if (cityMap.trafficLights) {
      for (const light of cityMap.trafficLights) {
        if (light.x + 24 < minX || light.x - 24 > maxX || light.y + 24 < minY || light.y - 24 > maxY) continue;
        const state = cityMap.getTrafficLightState(light, time);
        const isGreen = state === 'green';
        const glowColor = isGreen ? [0.18, 0.95, 0.42, 0.22] : [0.98, 0.22, 0.18, 0.22];
        const coreColor = isGreen ? [0.32, 1.0, 0.52, 0.72] : [1.0, 0.32, 0.26, 0.72];

        // Luz sutil saindo dos dois lados do semáforo
        if (light.axis === 'v') {
          this.#pushQuad(light.x - 9, light.y - 19, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x - 9, light.y + 1, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x - 2, light.y - 7, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x - 2, light.y + 3, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x - 5, light.y - 4, 10, 8, 0, 'solid', [0.14, 0.16, 0.2, 1]);
        } else {
          this.#pushQuad(light.x - 19, light.y - 9, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x + 1, light.y - 9, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x - 7, light.y - 2, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x + 3, light.y - 2, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x - 4, light.y - 5, 8, 10, 0, 'solid', [0.14, 0.16, 0.2, 1]);
        }
      }
    }

    // Fumaça (cinza/preta) e partículas de fogo (amarelo/laranja/vermelho)
    for (const p of smokeParticles) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const fade = 1 - p.life / p.maxLife;
      const rgba = p.color
        ? [p.color[0], p.color[1], p.color[2], p.alpha * fade]
        : [p.dark, p.dark, p.dark, p.alpha * fade];
      this.#pushQuad(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size, p.life * 2, 'circle', rgba);
    }

    // Marcador do alvo fixado: 4 colchetes vermelhos girando em volta do pedestre
    if (lockTarget) {
      const ringR = 19 + Math.sin(time * 6) * 1.5;
      for (let i = 0; i < 4; i++) {
        const a = time * 1.6 + i * (Math.PI / 2);
        const mx = lockTarget.x + Math.cos(a) * ringR;
        const my = lockTarget.y + Math.sin(a) * ringR;
        this.#pushQuad(mx - 5, my - 1.5, 10, 3, a + Math.PI / 2, 'solid', [1, 0.18, 0.18, 0.95]);
      }
    }

    // Projéteis (traço curto e brilhante na direção do voo)
    for (const b of bullets) {
      this.#pushQuad(b.x - 7, b.y - 1.5, 14, 3, b.angle, 'solid', [1, 0.78, 0.3, 0.55]);
      this.#pushQuad(b.x - 4, b.y - 1, 8, 2, b.angle, 'solid', [1, 0.96, 0.75, 1]);
    }

    for (const ex of explosions) {
      const progress = Math.min(1, ex.timer / ex.duration);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const alpha = 1 - progress;

      // Círculo de deslocamento de ar (onda de choque que se expande e se desfaz)
      const shockDuration = ex.shockDuration || ex.duration * 0.65;
      const shockProgress = Math.min(1, ex.timer / shockDuration);
      if (shockProgress < 1) {
        const shockRadius = ex.shockRadius || (ex.shockMaxRadius || ex.radius * 1.6) * (1 - Math.pow(1 - shockProgress, 2.2));
        const shockDiameter = shockRadius * 2;
        const shockAlpha = Math.pow(1 - shockProgress, 1.35) * 0.88;
        this.#pushQuad(
          ex.x - shockRadius,
          ex.y - shockRadius,
          shockDiameter,
          shockDiameter,
          0,
          'shockwave',
          [1, 0.92, 0.78, shockAlpha]
        );
        // Anel interno de pressão secundário
        if (shockProgress > 0.08) {
          const innerR = shockRadius * 0.74;
          this.#pushQuad(
            ex.x - innerR,
            ex.y - innerR,
            innerR * 2,
            innerR * 2,
            0,
            'shockwave',
            [1, 0.68, 0.3, shockAlpha * 0.52]
          );
        }
      }

      // Clarão inicial quente
      if (progress < 0.32) {
        const flashAlpha = (1 - progress / 0.32) * 0.78;
        const flashSize = ex.radius * (0.9 + progress * 2.2);
        this.#pushQuad(
          ex.x - flashSize * 0.5,
          ex.y - flashSize * 0.5,
          flashSize,
          flashSize,
          0,
          'circle',
          [1, 0.88, 0.45, flashAlpha]
        );
      }

      // Bolas de fogo dinâmicas que se expandem e esfriam para fumaça escura
      const lobes = ex.lobes || [
        { angle: 0.2, distScale: 0.35, sizeScale: 0.85, delay: 0 },
        { angle: 1.7, distScale: 0.38, sizeScale: 0.8, delay: 0.04 },
        { angle: 3.3, distScale: 0.34, sizeScale: 0.85, delay: 0.08 },
        { angle: 4.9, distScale: 0.4, sizeScale: 0.75, delay: 0.03 }
      ];
      for (const lobe of lobes) {
        const lp = Math.max(0, Math.min(1, (progress - lobe.delay) / (1 - lobe.delay)));
        if (lp <= 0 || lp >= 1) continue;
        const lEase = 1 - Math.pow(1 - lp, 2.4);
        const offset = ex.radius * lobe.distScale * lEase;
        const fx = ex.x + Math.cos(lobe.angle) * offset;
        const fy = ex.y + Math.sin(lobe.angle) * offset;
        const lobeSize = ex.radius * lobe.sizeScale * Math.sin(lp * Math.PI);
        if (lobeSize > 2) {
          const cool = Math.min(1, lp * 1.25);
          const rCol = 0.98 * (1 - cool * 0.72);
          const gCol = 0.55 * (1 - cool * 0.85);
          const bCol = 0.1 * (1 - cool * 0.4);
          this.#pushQuad(
            fx - lobeSize * 0.5,
            fy - lobeSize * 0.5,
            lobeSize,
            lobeSize,
            lobe.angle,
            'circle',
            [rCol, gCol, bCol, (1 - lp) * 0.88]
          );
        }
      }

      // Núcleo branco-amarelado brilhante
      const coreSize = ex.radius * 0.92 * Math.sin(Math.min(1, progress * 1.55) * Math.PI);
      if (coreSize > 2 && progress < 0.65) {
        const coreAlpha = (1 - progress / 0.65) * 0.95;
        this.#pushQuad(ex.x - coreSize * 0.5, ex.y - coreSize * 0.5, coreSize, coreSize, 0, 'circle', [1, 0.95, 0.58, coreAlpha]);
      }

      // Faíscas radiantes de alta velocidade
      if (progress < 0.78) {
        const sparks = ex.sparks || [];
        const spAlpha = (1 - progress / 0.78) * 0.95;
        for (const sp of sparks) {
          const dist = ex.radius * (0.14 + easeOut * 1.35 * sp.speed);
          const sx = ex.x + Math.cos(sp.angle) * dist;
          const sy = ex.y + Math.sin(sp.angle) * dist;
          const sz = sp.size * (1 - progress * 0.65);
          this.#pushQuad(sx - sz * 0.5, sy - sz * 0.5, sz, sz, sp.angle, 'circle', [1, 0.84, 0.25, spAlpha]);
        }
      }
    }

    gl.clearColor(0.08, 0.09, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(this.locResolution, this.viewWidth || 800, this.viewHeight || 600);
    gl.uniform2f(this.locCamera, camera.x, camera.y);
    gl.uniform1f(this.locZoom, this.zoom);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.quadCount * 6 * this.floatsPerVertex));
    gl.drawArrays(gl.TRIANGLES, 0, this.quadCount * 6);

    if (pendingRoofLogos.length > 0) {
      const logoVerts = new Float32Array(6 * 8);
      for (const { roof, entry, alpha } of pendingRoofLogos) {
        const maxBox = Math.min(roof.w, roof.h) * 0.62;
        const aspect = entry.width / Math.max(1, entry.height);
        const lw = aspect >= 1 ? maxBox : maxBox * aspect;
        const lh = aspect >= 1 ? maxBox / aspect : maxBox;
        const x0 = roof.x + (roof.w - lw) * 0.5;
        const y0 = roof.y + (roof.h - lh) * 0.5;
        const x1 = x0 + lw;
        const y1 = y0 + lh;
        const verts = [
          x0, y0, 0, 0, 1, 1, 1, alpha,
          x1, y0, 1, 0, 1, 1, 1, alpha,
          x1, y1, 1, 1, 1, 1, 1, alpha,
          x0, y0, 0, 0, 1, 1, 1, alpha,
          x1, y1, 1, 1, 1, 1, 1, alpha,
          x0, y1, 0, 1, 1, 1, 1, alpha,
        ];
        logoVerts.set(verts);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, logoVerts);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }
  }
}
