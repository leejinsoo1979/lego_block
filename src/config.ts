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
    // Pure deep ocean blue — green component dropped to near zero so
    // there's no teal/cyan cast. Combined with the slightly lower
    // distortion below, the sky reflection no longer washes the base
    // color out toward white/cyan.
    waterColor: 0x0850e8,
    waterDistortion: 1.6,
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
  | 'wallhigh'
  | 'walltower'
  | 'plate'
  | 'tile'
  | 'slope'
  | 'ramp'
  | 'ramptall'
  | 'arch'
  | 'round'
  | 'cone'
  | 'window'
  | 'door'
  | 'fence'
  | 'wheel'
  | 'archway'
  | 'archmid'
  | 'archlarge'
  | 'stairs'
  | 'gentlestairs'
  | 'column'
  | 'tree'
  | 'lamp'
  | 'ladder'
  | 'bridge'
  | 'slide'
  | 'swing'
  | 'seesaw'
  | 'junglegym'
  | 'merrygoround'
  | 'minifig'
  | 'dog'
  // 가구
  | 'chair'
  | 'table'
  | 'sofa'
  | 'bed'
  | 'bookshelf'
  | 'desk'
  | 'cabinet'
  | 'tvset'
  | 'fridge'
  // 소품
  | 'bench'
  | 'flowerpot'
  | 'trashcan'
  | 'mailbox'
  | 'signpost'
  | 'hydrant'
  | 'barrel'
  | 'campfire'
  | 'fountain'
  | 'trafficcone'
  | 'barricade'
  | 'well'
  | 'tent'
  // 도로 / 철도
  | 'road_straight'
  | 'road_curve'
  | 'road_cross'
  | 'road_tee'
  | 'rail_straight'
  | 'rail_curve'
  | 'rail_crossing'
  // 탈것
  | 'car'
  | 'train'
  // 팩맨
  | 'pellet'
  | 'powerpellet';

export type BlockCategory =
  | 'basic'
  | 'shape'
  | 'part'
  | 'special'
  | 'playground'
  | 'furniture'
  | 'prop'
  | 'road'
  | 'character'
  | 'pacman';

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
  { id: 'playground', label: '놀이터' },
  { id: 'furniture', label: '가구' },
  { id: 'prop', label: '소품' },
  { id: 'road', label: '도로' },
  { id: 'character', label: '캐릭터' },
  { id: 'pacman', label: '팩맨' },
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
  { type: 'wallhigh', label: '큰 벽', category: 'basic', ghostHeightPlates: 15, bodyHeightPlates: 15, usesSize: true },
  { type: 'walltower', label: '거대 벽', category: 'basic', ghostHeightPlates: 18, bodyHeightPlates: 18, usesSize: true },
  { type: 'plate', label: '플레이트', category: 'basic', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: true },
  { type: 'tile', label: '타일', category: 'basic', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: true },
  // 모양
  { type: 'slope', label: '경사', category: 'shape', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: true },
  // Pure-wedge ramps: the entire footprint length is a slope. Pick a
  // longer size (1x4, 1x6, 2x8, …) for a gentler angle. `ramp` rises
  // one brick; `ramptall` rises two.
  { type: 'ramp', label: '완만한 경사', category: 'shape', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: true },
  { type: 'ramptall', label: '긴 경사', category: 'shape', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: true },
  { type: 'arch', label: '아치', category: 'special', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'round', label: '원형', category: 'special', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'cone', label: '콘', category: 'special', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 1, d: 1 } },
  // 부품
  { type: 'window', label: '창문', category: 'part', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 1 } },
  { type: 'door', label: '문', category: 'part', ghostHeightPlates: 15, bodyHeightPlates: 15, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'fence', label: '울타리', category: 'special', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'wheel', label: '바퀴', category: 'part', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 2, d: 2 } },
  // 특수
  { type: 'archway', label: '아치 입구', category: 'special', ghostHeightPlates: 18, bodyHeightPlates: 18, usesSize: false, fixedSize: { w: 6, d: 2 } },
  { type: 'archmid', label: '중간 아치 입구', category: 'special', ghostHeightPlates: 21, bodyHeightPlates: 21, usesSize: false, fixedSize: { w: 8, d: 2 } },
  { type: 'archlarge', label: '큰 아치 입구', category: 'special', ghostHeightPlates: 24, bodyHeightPlates: 24, usesSize: false, fixedSize: { w: 10, d: 3 } },
  { type: 'stairs', label: '계단', category: 'shape', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 2, d: 4 } },
  { type: 'gentlestairs', label: '완만한 계단', category: 'shape', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 6 } },
  { type: 'column', label: '기둥', category: 'special', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'tree', label: '나무', category: 'special', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'lamp', label: '가로등', category: 'special', ghostHeightPlates: 15, bodyHeightPlates: 15, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'ladder', label: '사다리', category: 'special', ghostHeightPlates: 18, bodyHeightPlates: 18, usesSize: false, fixedSize: { w: 2, d: 1 } },
  // 6 studs wide × 44 long — wide enough for a Lego car to drive across
  // (a standard car is ~4 studs wide), long enough to span a 40-stud gap
  // between two baseplates with 2 studs of overhang on each end. Placement
  // uses a relaxed bridge-specific check so the middle can hang over open
  // water.
  { type: 'bridge', label: '교량', category: 'special', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 6, d: 44 } },
  // 놀이터 — sizes scaled to ~2× minifig height (minifig is 4.8 units tall)
  { type: 'slide', label: '미끄럼틀', category: 'playground', ghostHeightPlates: 18, bodyHeightPlates: 18, usesSize: false, fixedSize: { w: 4, d: 16 } },
  { type: 'swing', label: '그네', category: 'playground', ghostHeightPlates: 24, bodyHeightPlates: 24, usesSize: false, fixedSize: { w: 12, d: 3 } },
  { type: 'seesaw', label: '시소', category: 'playground', ghostHeightPlates: 9, bodyHeightPlates: 9, usesSize: false, fixedSize: { w: 12, d: 4 } },
  { type: 'junglegym', label: '정글짐', category: 'playground', ghostHeightPlates: 24, bodyHeightPlates: 24, usesSize: false, fixedSize: { w: 6, d: 6 } },
  // The biggest playground piece — 16×16 footprint × 32 plates tall
  // (12.8 units, comfortably the tallest playground item). Sized so a
  // Lego minifig can actually sit on the seats and so the structure
  // visibly dominates the playground.
  { type: 'merrygoround', label: '회전무대', category: 'playground', ghostHeightPlates: 32, bodyHeightPlates: 32, usesSize: false, fixedSize: { w: 16, d: 16 } },
  // 가구 — minifig-scale (minifig ≈ 4.8 units tall)
  { type: 'chair', label: '의자', category: 'furniture', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 2 } },
  { type: 'table', label: '테이블', category: 'furniture', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 4, d: 4 } },
  { type: 'sofa', label: '소파', category: 'furniture', ghostHeightPlates: 8, bodyHeightPlates: 8, usesSize: false, fixedSize: { w: 8, d: 4 } },
  { type: 'bed', label: '침대', category: 'furniture', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 6, d: 10 } },
  { type: 'bookshelf', label: '책장', category: 'furniture', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'desk', label: '책상', category: 'furniture', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 4, d: 2 } },
  { type: 'cabinet', label: '서랍장', category: 'furniture', ghostHeightPlates: 9, bodyHeightPlates: 9, usesSize: false, fixedSize: { w: 2, d: 2 } },
  { type: 'tvset', label: 'TV', category: 'furniture', ghostHeightPlates: 9, bodyHeightPlates: 9, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'fridge', label: '냉장고', category: 'furniture', ghostHeightPlates: 15, bodyHeightPlates: 15, usesSize: false, fixedSize: { w: 2, d: 2 } },
  // 소품
  { type: 'bench', label: '벤치', category: 'prop', ghostHeightPlates: 4, bodyHeightPlates: 4, usesSize: false, fixedSize: { w: 6, d: 2 } },
  { type: 'flowerpot', label: '화분', category: 'prop', ghostHeightPlates: 4, bodyHeightPlates: 4, usesSize: false, fixedSize: { w: 2, d: 2 } },
  { type: 'trashcan', label: '쓰레기통', category: 'prop', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 2 } },
  { type: 'mailbox', label: '우체통', category: 'prop', ghostHeightPlates: 9, bodyHeightPlates: 9, usesSize: false, fixedSize: { w: 2, d: 1 } },
  { type: 'signpost', label: '표지판', category: 'prop', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 2, d: 1 } },
  { type: 'hydrant', label: '소화전', category: 'prop', ghostHeightPlates: 5, bodyHeightPlates: 5, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'barrel', label: '나무통', category: 'prop', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 2, d: 2 } },
  { type: 'campfire', label: '캠프파이어', category: 'prop', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 8, d: 8 } },
  { type: 'fountain', label: '분수', category: 'prop', ghostHeightPlates: 18, bodyHeightPlates: 18, usesSize: false, fixedSize: { w: 12, d: 12 } },
  { type: 'trafficcone', label: '라바콘', category: 'prop', ghostHeightPlates: 3, bodyHeightPlates: 3, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'barricade', label: '바리케이드', category: 'prop', ghostHeightPlates: 6, bodyHeightPlates: 6, usesSize: false, fixedSize: { w: 4, d: 1 } },
  { type: 'well', label: '우물', category: 'prop', ghostHeightPlates: 9, bodyHeightPlates: 9, usesSize: false, fixedSize: { w: 4, d: 4 } },
  { type: 'tent', label: '텐트', category: 'prop', ghostHeightPlates: 12, bodyHeightPlates: 12, usesSize: false, fixedSize: { w: 6, d: 6 } },
  // 도로 / 철도 — 바닥판 위에 깔리는 flat 타일 (1 plate 높이).
  // 8×8 스터드 정사각형으로 통일해서 타일끼리 정확히 맞물림.
  { type: 'road_straight', label: '직선 도로', category: 'road', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 8, d: 8 } },
  { type: 'road_curve', label: '커브 도로', category: 'road', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 8, d: 8 } },
  { type: 'road_cross', label: '교차로', category: 'road', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 8, d: 8 } },
  { type: 'road_tee', label: 'T자 도로', category: 'road', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 8, d: 8 } },
  { type: 'rail_straight', label: '직선 레일', category: 'road', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 8, d: 8 } },
  { type: 'rail_curve', label: '커브 레일', category: 'road', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 8, d: 8 } },
  { type: 'rail_crossing', label: '건널목', category: 'road', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 8, d: 8 } },
  // 탈것 — 도로/레일 위에 배치, 플레이 모드에서 E로 탑승 후 WASD 운전
  { type: 'car', label: '자동차', category: 'road', ghostHeightPlates: 4, bodyHeightPlates: 4, usesSize: false, fixedSize: { w: 4, d: 2 } },
  { type: 'train', label: '기차', category: 'road', ghostHeightPlates: 5, bodyHeightPlates: 5, usesSize: false, fixedSize: { w: 8, d: 3 } },
  // 캐릭터
  { type: 'minifig', label: '사람', category: 'character', ghostHeightPlates: 1, bodyHeightPlates: 7, usesSize: false },
  { type: 'dog', label: '강아지', category: 'character', ghostHeightPlates: 1, bodyHeightPlates: 5, usesSize: false, fixedSize: { w: 1, d: 2 } },
  // 팩맨 — 수집용 펠릿. 게임 모드에서 모두 먹으면 클리어
  { type: 'pellet', label: '펠릿', category: 'pacman', ghostHeightPlates: 1, bodyHeightPlates: 1, usesSize: false, fixedSize: { w: 1, d: 1 } },
  { type: 'powerpellet', label: '파워펠릿', category: 'pacman', ghostHeightPlates: 2, bodyHeightPlates: 2, usesSize: false, fixedSize: { w: 1, d: 1 } },
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

export type HairStyle =
  | 'none'
  | 'short'
  | 'bob'
  | 'long'
  | 'ponytail'
  | 'mohawk'
  | 'curly'
  | 'twintails'
  | 'updo'
  | 'sidepart'
  | 'pixie'
  | 'braid'
  | 'afro';

/** Per-part face expression config for the character editor. Each field
 *  is an index into the corresponding FACE_* catalog array. When
 *  undefined the face falls through to the legacy per-preset
 *  `drawCharacterFace` switch (backwards compat for the 8 built-in
 *  presets that have hand-tuned faces). */
export interface FaceConfig {
  eyes: number;       // 0..FACE_EYES.length-1
  nose: number;       // 0..FACE_NOSES.length-1
  mouth: number;      // 0..FACE_MOUTHS.length-1
  eyebrows: number;   // 0..FACE_EYEBROWS.length-1
  cheeks: number;     // 0..FACE_CHEEKS.length-1
}

export interface MinifigPreset {
  id: string;
  name: string;
  shirtHex: number;
  pantsHex: number;
  headHex?: number;
  hatStyle: HatStyle;
  hatColor?: number;
  hairStyle?: HairStyle;
  hairColor?: number;
  hideFace?: boolean;
  /** Custom face parts — when set, the editor-driven composable face
   *  renderer is used instead of the legacy per-preset switch. */
  face?: FaceConfig;
}

// ------------------------------------------------------------------
//  Face part catalogs — each entry has a short Korean label used by
//  the character-editor UI and a numeric `id` that the face renderer
//  dispatches on.
// ------------------------------------------------------------------

export const FACE_EYES = [
  { id: 0, label: '기본' },
  { id: 1, label: '큰눈' },
  { id: 2, label: '반달' },
  { id: 3, label: '윙크' },
  { id: 4, label: '졸린' },
  { id: 5, label: '놀란' },
  { id: 6, label: '별눈' },
  { id: 7, label: '하트' },
  { id: 8, label: '선글라스' },
  { id: 9, label: '눈물' },
] as const;

export const FACE_NOSES = [
  { id: 0, label: '없음' },
  { id: 1, label: '점' },
  { id: 2, label: 'ㄴ자' },
  { id: 3, label: '둥근' },
  { id: 4, label: '삼각' },
] as const;

export const FACE_MOUTHS = [
  { id: 0, label: '미소' },
  { id: 1, label: '활짝' },
  { id: 2, label: '일자' },
  { id: 3, label: '놀란' },
  { id: 4, label: '혀' },
  { id: 5, label: '찡그린' },
  { id: 6, label: '수염' },
  { id: 7, label: '뾰루퉁' },
] as const;

export const FACE_EYEBROWS = [
  { id: 0, label: '없음' },
  { id: 1, label: '일자' },
  { id: 2, label: '올린' },
  { id: 3, label: '찡그린' },
  { id: 4, label: '굵은' },
] as const;

export const FACE_CHEEKS = [
  { id: 0, label: '없음' },
  { id: 1, label: '홍조' },
  { id: 2, label: '주근깨' },
] as const;

export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'short', label: '짧은머리' },
  { id: 'bob', label: '단발' },
  { id: 'long', label: '긴머리' },
  { id: 'ponytail', label: '포니테일' },
  { id: 'mohawk', label: '모히칸' },
  { id: 'curly', label: '곱슬' },
  { id: 'twintails', label: '트윈테일' },
  { id: 'updo', label: '올림머리' },
  { id: 'sidepart', label: '가르마' },
  { id: 'pixie', label: '픽시컷' },
  { id: 'braid', label: '땋은머리' },
  { id: 'afro', label: '아프로' },
];

export const HAT_STYLES: { id: HatStyle; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'cap', label: '야구모자' },
  { id: 'fireman', label: '소방모' },
  { id: 'astronaut', label: '우주헬멧' },
  { id: 'wizard', label: '마법모자' },
  { id: 'crown', label: '왕관' },
  { id: 'pirate', label: '해적모' },
];

/** Default face config used when the user creates a new custom character
 *  or when a preset doesn't specify a custom face. Friendly round-eye
 *  smile — the "classic" Lego face. */
export const DEFAULT_FACE: FaceConfig = {
  eyes: 0,
  nose: 0,
  mouth: 0,
  eyebrows: 0,
  cheeks: 0,
};

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
