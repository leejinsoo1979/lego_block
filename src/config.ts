// ------------------------------------------------------------------
//  Lego brick spec — official dimensions in world units.
//
//  We use 1 world unit = 1 stud pitch = 8.0 mm. Every other dimension
//  below is the real Lego dimension (in mm) divided by 8.0, so the
//  whole engine works in stud-pitch units while staying in proportion
//  with real bricks.
// ------------------------------------------------------------------

/** Stud pitch — distance between stud centers. 8.0 mm in real Lego. */
export const STUD_PITCH = 1.0;

/** Plate height — 3.2 mm. (1 plate = 3.2 mm = 0.4 unit) */
export const PLATE_HEIGHT = 0.4;
/** A brick is exactly 3 plates tall = 9.6 mm = 1.2 units. */
export const BRICK_PLATES = 3;
/** Brick body height (3 plates). */
export const BRICK_HEIGHT = BRICK_PLATES * PLATE_HEIGHT; // 1.2

/** Stud diameter — 4.8 mm = 0.6 units. */
export const STUD_DIAMETER = 0.6;
export const STUD_RADIUS = STUD_DIAMETER / 2; // 0.3
/** Stud height — 1.8 mm = 0.225 units. */
export const STUD_HEIGHT = 0.225;

/** Brick wall thickness — 1.5–1.6 mm ≈ 0.194 units. */
export const WALL_THICKNESS = 0.194;

/** Under-side cylindrical tube outer diameter — 6.51 mm ≈ 0.814 units. */
export const TUBE_OUTER_DIAMETER = 0.814;
export const TUBE_OUTER_RADIUS = TUBE_OUTER_DIAMETER / 2; // 0.407
/** Under-side cylindrical tube inner diameter — 4.8 mm = 0.6 units. */
export const TUBE_INNER_DIAMETER = 0.6;
export const TUBE_INNER_RADIUS = TUBE_INNER_DIAMETER / 2; // 0.3

export const GRID = {
  X: STUD_PITCH, // stud pitch
  Y: PLATE_HEIGHT, // plate-sized vertical grid
  Z: STUD_PITCH,
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

// ------------------------------------------------------------------
//  Environment presets — swaps the baseplate color and the "infinite"
//  surround mesh around it. Used by Game.setEnvironment() to theme the
//  scene for different builds (grass / island / desert / snow).
// ------------------------------------------------------------------

export type EnvironmentSurround = 'none' | 'water' | 'ground';

export interface EnvironmentDef {
  id: string;
  name: string;
  /** Baseplate top-face color. */
  baseplateColor: number;
  /** Baseplate body thickness in world units. Top stays at y=0; the body
   *  extends downward from there. Default 0.4 (standard plate). Larger
   *  values make the plate look like a thicker island / cliff. */
  baseplateThickness?: number;
  /** What fills the space outside the baseplate tiles. */
  surroundType: EnvironmentSurround;
  /** Color for 'ground' surround (ignored for 'water'/'none'). */
  surroundColor?: number;
  /** Roughness for 'ground' surround (0 = glossy, 1 = matte). */
  surroundRoughness?: number;
  /** Base color of the Water object, used only when surroundType='water'. */
  waterColor?: number;
  /** Distortion scale for the water normal map — higher = choppier. */
  waterDistortion?: number;
  /** Y level of the water surface. Default -0.05 (just below plate top).
   *  Lower values make the plate appear to rise out of the water. */
  waterLevel?: number;
}

export const ENVIRONMENTS: EnvironmentDef[] = [
  {
    id: 'grass',
    name: '잔디밭',
    baseplateColor: 0x4b974b,
    surroundType: 'none',
  },
  {
    id: 'island',
    name: '섬',
    baseplateColor: 0x4b974b,
    // Thick cliff-like plate — extends 2.4 units below the top so the
    // island visibly rises out of the water.
    baseplateThickness: 2.4,
    surroundType: 'water',
    waterColor: 0x0a4466,
    waterDistortion: 2.4,
    // Water surface sits ~1.4 units below the plate top, which is roughly
    // halfway down the cliff face — leaves plenty of visible island above.
    waterLevel: -1.4,
  },
  {
    id: 'desert',
    name: '사막',
    baseplateColor: 0xd4a870,
    surroundType: 'ground',
    surroundColor: 0xc08a52,
    surroundRoughness: 0.95,
  },
  {
    id: 'snow',
    name: '눈밭',
    baseplateColor: 0xeef1f5,
    surroundType: 'ground',
    surroundColor: 0xe0e6ec,
    surroundRoughness: 0.85,
  },
];

export type BlockType =
  | 'brick'
  | 'tallbrick'
  | 'wallpanel'
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
  | 'archway'
  | 'stairs'
  | 'gentlestairs'
  | 'column'
  | 'tree'
  | 'lamp'
  | 'ladder'
  | 'bridge'
  | 'minifig';

export type BlockCategory =
  | 'basic'
  | 'shape'
  | 'part'
  | 'special'
  | 'character';

export interface CategoryDef {
  id: BlockCategory;
  label: string;
}

/** Order here drives the tab order in the sidebar. */
export const CATEGORIES: CategoryDef[] = [
  { id: 'basic', label: '블록' },
  { id: 'shape', label: '모양' },
  { id: 'part', label: '부품' },
  { id: 'special', label: '특수' },
  { id: 'character', label: '캐릭터' },
];

export interface BlockTypeDef {
  type: BlockType;
  label: string;
  /** Which library tab the block lives under */
  category: BlockCategory;
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
  // 기본
  { type: 'brick', label: '벽돌', category: 'basic', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: true },
  { type: 'tallbrick', label: '높은 벽돌', category: 'basic', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: true },
  { type: 'wallpanel', label: '벽 패널', category: 'basic', ghostHeightPlates: 9, bodyHeightPlates: 9, usesSize: true },
  { type: 'plate', label: '플레이트', category: 'basic', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: true },
  { type: 'tile', label: '타일', category: 'basic', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: true },
  // 모양
  { type: 'slope', label: '경사', category: 'shape', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: true },
  { type: 'arch', label: '아치', category: 'shape', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'round', label: '원형', category: 'shape', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'cone', label: '콘', category: 'shape', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 1, d: 1 } },
  // 부품
  { type: 'window', label: '창문', category: 'part', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 1 } },
  { type: 'door', label: '문', category: 'part', ghostHeightPlates: 15, bodyHeightPlates: 15, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'fence', label: '울타리', category: 'part', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'wheel', label: '바퀴', category: 'part', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 2, d: 2 } },
  // 특수
  { type: 'archway', label: '아치 입구', category: 'special', ghostHeightPlates: 18, bodyHeightPlates: 18, usesSize: false, fixedSize: { w: 6, d: 2 } },
  { type: 'stairs', label: '계단', category: 'special', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 2, d: 4 } },
  { type: 'gentlestairs', label: '완만한 계단', category: 'special', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 6 } },
  { type: 'column', label: '기둥', category: 'special', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'tree', label: '나무', category: 'special', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'lamp', label: '가로등', category: 'special', ghostHeightPlates: 15, bodyHeightPlates: 15, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'ladder', label: '사다리', category: 'special', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 1, d: 1 } },
  // 44 studs long — enough to span a 40-stud gap between two baseplates
  // with 2 studs of overhang on each end for anchoring. Placement uses a
  // relaxed bridge-specific check so the middle can hang over open water.
  { type: 'bridge', label: '교량', category: 'special', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 44 } },
  // 캐릭터
  { type: 'minifig', label: '사람', category: 'character', ghostHeightPlates: 1, bodyHeightPlates: 7, usesSize: false },
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
