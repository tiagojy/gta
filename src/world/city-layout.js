import { GUN_SHOP_CODE } from '../shop/shop-location.js';
export const GRID_BLOCKS = 30;
export const ROAD_WIDTH = 124;
export const SIDEWALK_WIDTH = 26;

const BLOCK_WIDTH_CHOICES = [250, 310, 370, 440, 290, 410];
const BLOCK_HEIGHT_CHOICES = [250, 320, 380, 280, 430, 350];

export const VEHICLE_VARIANTS = [
  { kind: 'car', model: 'Sedan Urbano', color: '#e63946' },
  { kind: 'car', model: 'Cupê Esportivo', color: '#3a86ff' },
  { kind: 'car', model: 'Compacto Retrô', color: '#ffbe0b' },
  { kind: 'moto', model: 'Moto Street', color: '#fb5607' },
  { kind: 'moto', model: 'Moto Cruiser', color: '#06d6a0' },
  { kind: 'van', model: 'Van de Carga', color: '#f8f9fa' },
  { kind: 'van', model: 'Furgão Azul', color: '#457b9d' }
];

const ROOF_PALETTES = {
  house: ['#8d5b4c', '#7f5539', '#9c6644', '#6d597a', '#a47148'],
  commerce: ['#3d5a80', '#2a9d8f', '#b56576', '#4a4e69', '#355070'],
  hospital: ['#ffffff']
};

export function formatCode(prefix, number) {
  return `${prefix}-${String(number).padStart(2, '0')}`;
}

export function hashBlock(bx, by) {
  let h = (bx * 73856093) ^ (by * 19349663);
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) >>> 0;
  return h;
}

export function buildGridMetrics() {
  const colWidths = [];
  const rowHeights = [];
  for (let i = 0; i < GRID_BLOCKS; i++) {
    const wSeed = hashBlock(i + 3, 17);
    const hSeed = hashBlock(29, i + 5);
    colWidths.push(BLOCK_WIDTH_CHOICES[wSeed % BLOCK_WIDTH_CHOICES.length]);
    rowHeights.push(BLOCK_HEIGHT_CHOICES[hSeed % BLOCK_HEIGHT_CHOICES.length]);
  }

  const roadXOffsets = [];
  const blockXOffsets = [];
  let cx = 0;
  for (let i = 0; i < GRID_BLOCKS; i++) {
    roadXOffsets.push(cx);
    cx += ROAD_WIDTH;
    blockXOffsets.push(cx);
    cx += colWidths[i];
  }
  roadXOffsets.push(cx);
  const worldWidth = cx + ROAD_WIDTH;

  const roadYOffsets = [];
  const blockYOffsets = [];
  let cy = 0;
  for (let i = 0; i < GRID_BLOCKS; i++) {
    roadYOffsets.push(cy);
    cy += ROAD_WIDTH;
    blockYOffsets.push(cy);
    cy += rowHeights[i];
  }
  roadYOffsets.push(cy);
  const worldHeight = cy + ROAD_WIDTH;

  return {
    colWidths,
    rowHeights,
    roadXOffsets,
    blockXOffsets,
    roadYOffsets,
    blockYOffsets,
    worldWidth,
    worldHeight
  };
}

export function createBuildingWithInterior({
  code,
  type,
  x,
  y,
  w,
  h,
  doorSide,
  seed
}) {
  const wallT = 14;
  const doorW = 46;
  const roofPalette = ROOF_PALETTES[type];
  const roofColor = code === GUN_SHOP_CODE ? '#7f1d1d' : roofPalette[Math.abs(seed) % roofPalette.length];

  const walls = [];
  let entrance;
  let doormat;
  let spawnPoint;

  if (doorSide === 'south') {
    const doorX = x + (w - doorW) / 2;
    entrance = { x: doorX, y: y + h - wallT - 8, w: doorW, h: wallT + 20 };
    doormat = { x: doorX + 2, y: y + h - 2, w: doorW - 4, h: 14 };
    spawnPoint = { x: doorX + doorW / 2, y: y + h + 28 };
    walls.push(
      { x, y, w, h: wallT },
      { x, y, w: wallT, h },
      { x: x + w - wallT, y, w: wallT, h },
      { x, y: y + h - wallT, w: doorX - x, h: wallT },
      { x: doorX + doorW, y: y + h - wallT, w: x + w - (doorX + doorW), h: wallT }
    );
  } else if (doorSide === 'north') {
    const doorX = x + (w - doorW) / 2;
    entrance = { x: doorX, y: y - 12, w: doorW, h: wallT + 20 };
    doormat = { x: doorX + 2, y: y - 12, w: doorW - 4, h: 14 };
    spawnPoint = { x: doorX + doorW / 2, y: y - 28 };
    walls.push(
      { x, y: y + h - wallT, w, h: wallT },
      { x, y, w: wallT, h },
      { x: x + w - wallT, y, w: wallT, h },
      { x, y, w: doorX - x, h: wallT },
      { x: doorX + doorW, y, w: x + w - (doorX + doorW), h: wallT }
    );
  } else if (doorSide === 'west') {
    const doorY = y + (h - doorW) / 2;
    entrance = { x: x - 12, y: doorY, w: wallT + 20, h: doorW };
    doormat = { x: x - 12, y: doorY + 2, w: 14, h: doorW - 4 };
    spawnPoint = { x: x - 28, y: doorY + doorW / 2 };
    walls.push(
      { x, y, w, h: wallT },
      { x, y: y + h - wallT, w, h: wallT },
      { x: x + w - wallT, y, w: wallT, h },
      { x, y, w: wallT, h: doorY - y },
      { x, y: doorY + doorW, w: wallT, h: y + h - (doorY + doorW) }
    );
  } else {
    const doorY = y + (h - doorW) / 2;
    entrance = { x: x + w - wallT - 8, y: doorY, w: wallT + 20, h: doorW };
    doormat = { x: x + w - 2, y: doorY + 2, w: 14, h: doorW - 4 };
    spawnPoint = { x: x + w + 28, y: doorY + doorW / 2 };
    walls.push(
      { x, y, w, h: wallT },
      { x, y: y + h - wallT, w, h: wallT },
      { x, y, w: wallT, h },
      { x: x + w - wallT, y, w: wallT, h: doorY - y },
      { x: x + w - wallT, y: doorY + doorW, w: wallT, h: y + h - (doorY + doorW) }
    );
  }

  const props = [];
  if (w >= 130 && h >= 100) {
    if (type === 'commerce' || type === 'hospital') {
      props.push({ x: x + 26, y: y + 26, w: Math.min(90, w - 52), h: 20, kind: 'counter' });
    } else {
      props.push({ x: x + 26, y: y + 26, w: 36, h: 24, kind: 'table' });
    }
  }

  return {
    code,
    type,
    bounds: { x, y, w, h },
    roofRect: { x, y, w, h },
    roofColor,
    floorColor: type === 'hospital' ? '#e2e8f0' : type === 'commerce' ? '#d8cfc0' : '#cbb99d',
    entrance,
    doormat,
    doorSide,
    interior: {
      walls,
      props
    },
    spawnPoint
  };
}
