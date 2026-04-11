export const PLATE_HEIGHT = 0.4; // 1 Lego plate = 0.4 world units
export const BRICK_PLATES = 3; // 1 brick = 3 plates (= 1.2 units)

export const GRID = {
  X: 1, // stud width
  Y: PLATE_HEIGHT, // plate-sized vertical grid
  Z: 1,
} as const;

export const BOARD_SIZE = 40; // default 40x40 studs (legacy, used as default)

export interface BoardSizePreset {
  name: string;
  size: number;
}

export const BOARD_SIZES: BoardSizePreset[] = [
  { name: '40×40', size: 40 },
  { name: '60×60', size: 60 },
  { name: '80×80', size: 80 },
  { name: '120×120', size: 120 },
  { name: '160×160', size: 160 },
];

export type BlockType =
  | 'brick'
  | 'plate'
  | 'tile'
  | 'slope'
  | 'arch'
  | 'round'
  | 'cone'
  | 'window'
  | 'door'
  | 'fence'
  | 'wheel'
  | 'minifig';

export interface BlockTypeDef {
  type: BlockType;
  label: string;
  /** Ghost preview height in plates (visual only; actual placement uses block geometry) */
  ghostHeightPlates: number;
  /** True body height in plates — used by collision/auto-stack math in game.ts */
  bodyHeightPlates: number;
  /** Whether the block uses the size selector */
  usesSize: boolean;
  /** If set, the block has a fixed footprint and ignores the size selector */
  fixedSize?: { w: number; d: number };
}

export const BLOCK_TYPES: BlockTypeDef[] = [
  { type: 'brick', label: '벽돌', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: true },
  { type: 'plate', label: '플레이트', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: true },
  { type: 'tile', label: '타일', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: true },
  { type: 'slope', label: '경사', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: true },
  { type: 'arch', label: '아치', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'round', label: '원형', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'cone', label: '콘', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'window', label: '창문', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 1 } },
  { type: 'door', label: '문', ghostHeightPlates: 9, bodyHeightPlates: 9, usesSize: false, fixedSize: { w: 2, d: 1 } },
  { type: 'fence', label: '울타리', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'wheel', label: '바퀴', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 2, d: 2 } },
  { type: 'minifig', label: '사람', ghostHeightPlates: 1, bodyHeightPlates: 7, usesSize: false },
];

export interface ColorDef {
  name: string;
  hex: number;
}

export interface SizeDef {
  name: string;
  w: number;
  d: number;
}

export const COLORS: ColorDef[] = [
  { name: 'Red', hex: 0xc4281c },
  { name: 'Blue', hex: 0x0d69ac },
  { name: 'Yellow', hex: 0xf5cd30 },
  { name: 'Green', hex: 0x4b974b },
  { name: 'White', hex: 0xf2f3f3 },
  { name: 'Black', hex: 0x1b2a35 },
  { name: 'Orange', hex: 0xda8541 },
  { name: 'Pink', hex: 0xe8bac8 },
  { name: 'Light Gray', hex: 0xa0a5a9 },
  { name: 'Dark Gray', hex: 0x545960 },
  { name: 'Brown', hex: 0x6b4423 },
];

export const SIZES: SizeDef[] = [
  { name: '1x1', w: 1, d: 1 },
  { name: '1x2', w: 1, d: 2 },
  { name: '1x3', w: 1, d: 3 },
  { name: '1x4', w: 1, d: 4 },
  { name: '1x6', w: 1, d: 6 },
  { name: '1x8', w: 1, d: 8 },
  { name: '2x2', w: 2, d: 2 },
  { name: '2x3', w: 2, d: 3 },
  { name: '2x4', w: 2, d: 4 },
  { name: '2x6', w: 2, d: 6 },
  { name: '2x8', w: 2, d: 8 },
  { name: '4x4', w: 4, d: 4 },
  { name: '4x6', w: 4, d: 6 },
  { name: '6x6', w: 6, d: 6 },
  { name: '8x8', w: 8, d: 8 },
];

// ------------------------------------------------------------------
//  Minifigure presets
// ------------------------------------------------------------------

export type HatStyle =
  | 'none'
  | 'cap'
  | 'fireman'
  | 'astronaut'
  | 'wizard'
  | 'crown'
  | 'pirate';

export interface MinifigPreset {
  id: string;
  name: string;
  shirtHex: number;
  pantsHex: number;
  headHex?: number;
  hatStyle: HatStyle;
  hatColor?: number;
  hideFace?: boolean;
}

export const MINIFIG_PRESETS: MinifigPreset[] = [
  {
    id: 'classic',
    name: '기본',
    shirtHex: 0xc4281c,
    pantsHex: 0x0d69ac,
    hatStyle: 'none',
  },
  {
    id: 'police',
    name: '경찰',
    shirtHex: 0x1b3668,
    pantsHex: 0x0d1830,
    hatStyle: 'cap',
    hatColor: 0x1b3668,
  },
  {
    id: 'firefighter',
    name: '소방관',
    shirtHex: 0xc4281c,
    pantsHex: 0x2a2a2a,
    hatStyle: 'fireman',
    hatColor: 0xda4630,
  },
  {
    id: 'astronaut',
    name: '우주인',
    shirtHex: 0xf2f3f3,
    pantsHex: 0xd0d3d3,
    hatStyle: 'astronaut',
    hatColor: 0xf2f3f3,
  },
  {
    id: 'ninja',
    name: '닌자',
    shirtHex: 0x1b2028,
    pantsHex: 0x1b2028,
    headHex: 0x1b2028,
    hatStyle: 'none',
    hideFace: true,
  },
  {
    id: 'wizard',
    name: '마법사',
    shirtHex: 0x4a1e6e,
    pantsHex: 0x2a1040,
    hatStyle: 'wizard',
    hatColor: 0x4a1e6e,
  },
  {
    id: 'princess',
    name: '공주',
    shirtHex: 0xe8bac8,
    pantsHex: 0xd89ab0,
    hatStyle: 'crown',
    hatColor: 0xf5cd30,
  },
  {
    id: 'pirate',
    name: '해적',
    shirtHex: 0x8b4513,
    pantsHex: 0x2a2028,
    hatStyle: 'pirate',
    hatColor: 0x1b1820,
  },
];
