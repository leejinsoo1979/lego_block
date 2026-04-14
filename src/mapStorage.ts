// ----------------------------------------------------------------------
//  Map save/load — serializes Game.brickGroup into a JSON payload we
//  can stash in Supabase, and rebuilds the scene from one later.
// ----------------------------------------------------------------------

import * as THREE from 'three';
import { createBrick, createMinifigure, createDogCharacter } from './blocks';
import { ENVIRONMENTS, MINIFIG_PRESETS } from './config';
import type { BlockType, MinifigPreset } from './config';
import type { Game } from './game';
import { supabase, type MapData, type SavedMap, type SerializedBlock } from './supabase';

// --------------------------------------------------------------------
//  Current map tracking — which saved map the user is actively editing.
//  Set when a map is loaded from the gallery; cleared when the user
//  starts a fresh blank map. Used so "Save" overwrites instead of
//  prompting for a new title every time.
// --------------------------------------------------------------------

interface CurrentMapRef {
  id: string;
  title: string;
  description: string | null;
  isPublic: boolean;
}

let currentMap: CurrentMapRef | null = null;

export function getCurrentMap(): CurrentMapRef | null {
  return currentMap;
}

export function setCurrentMap(ref: CurrentMapRef | null): void {
  currentMap = ref;
}

export function clearCurrentMap(): void {
  currentMap = null;
}

// --------------------------------------------------------------------
//  Serialize / deserialize
// --------------------------------------------------------------------

/** Walk the live scene and produce a MapData payload we can store. */
export function serializeMap(game: Game): MapData {
  const blocks: SerializedBlock[] = [];

  for (const child of (game as unknown as { brickGroup: THREE.Group }).brickGroup.children) {
    const spec = child.userData.spec as
      | {
          type?: BlockType;
          w?: number;
          d?: number;
          colorHex?: number;
        }
      | undefined;
    if (!spec?.type) continue;

    // Rotation: we store the quarter-turn step (0..3) rather than the raw
    // radians, so future code can interpret it exactly.
    const rotSteps = Math.round(-child.rotation.y / (Math.PI / 2));
    const rotation = ((rotSteps % 4) + 4) % 4;

    const extras: Record<string, unknown> = {};
    // Minifig characters remember which preset was active at placement
    // time. `setCharacter` stashes the preset id on the avatar itself.
    if (spec.type === 'minifig') {
      const presetId = child.userData.characterId as string | undefined;
      if (presetId) extras.characterId = presetId;
    }

    blocks.push({
      type: spec.type,
      x: child.position.x,
      y: child.position.y,
      z: child.position.z,
      rotation,
      colorHex: spec.colorHex ?? 0xffffff,
      w: spec.w ?? 1,
      d: spec.d ?? 1,
      extras: Object.keys(extras).length > 0 ? extras : undefined,
    });
  }

  // Tile grid — the user may have added extra baseplate tiles via the
  // "스터드 추가" tool. Persist their grid coords so we can rebuild.
  const tiles: { x: number; z: number; y: number }[] = [];
  const gameAny = game as unknown as {
    baseplates: Map<string, THREE.Group>;
    tileSize: number;
  };
  for (const key of gameAny.baseplates.keys()) {
    const [xStr, yStr, zStr] = key.split(',');
    tiles.push({ x: Number(xStr), y: Number(yStr), z: Number(zStr) });
  }

  return {
    version: 1,
    tileSize: gameAny.tileSize,
    environmentId: game.environment.id,
    timeOfDay: game.getTimeOfDay(),
    blocks,
    tiles,
  };
}

/** Rebuild the scene from a MapData payload. Clears the current scene
 *  first, applies the environment/time, then re-creates every block. */
export function deserializeMap(game: Game, data: MapData): void {
  const g = game as unknown as {
    brickGroup: THREE.Group;
    baseplates: Map<string, THREE.Group>;
    addBaseplateTile(x: number, z: number, y: number): unknown;
  };

  // 1. Clear existing blocks
  game.clearAll();

  // 2. Apply environment
  const env = ENVIRONMENTS.find((e) => e.id === data.environmentId);
  if (env) game.setEnvironment(env);

  // 3. Time of day
  game.setTimeOfDay(data.timeOfDay);

  // 4. Rebuild extra tiles (beyond the default 0,0,0)
  for (const t of data.tiles) {
    if (t.x === 0 && t.y === 0 && t.z === 0) continue; // already exists
    try {
      g.addBaseplateTile?.(t.x, t.z, t.y);
    } catch {
      /* older games may not have this — skip */
    }
  }

  // 5. Recreate every block
  for (const b of data.blocks) {
    let obj: THREE.Group;
    if (b.type === 'minifig') {
      const presetId = b.extras?.characterId as string | undefined;
      const preset =
        MINIFIG_PRESETS.find((p: MinifigPreset) => p.id === presetId) ??
        MINIFIG_PRESETS[0];
      obj = createMinifigure(preset);
      obj.userData.characterId = preset.id;
    } else if (b.type === 'dog') {
      obj = createDogCharacter();
    } else {
      obj = createBrick({
        w: b.w,
        d: b.d,
        colorHex: b.colorHex,
        type: b.type as BlockType,
      });
    }
    obj.rotation.y = -b.rotation * (Math.PI / 2);
    obj.position.set(b.x, b.y, b.z);
    // Ensure spec reflects the final dimensions (important for shaped blocks)
    obj.userData.spec = {
      ...(obj.userData.spec ?? {}),
      type: b.type,
      w: b.w,
      d: b.d,
      colorHex: b.colorHex,
    };
    g.brickGroup.add(obj);
    // Re-apply runtime lighting for lamps / campfires
    const gameWithLamps = game as unknown as {
      updateLampForTime?: (o: THREE.Object3D) => void;
    };
    if (obj.userData.isLamp && gameWithLamps.updateLampForTime) {
      gameWithLamps.updateLampForTime(obj);
    }
  }

  // Fire count callback so UI updates
  game.onCountChange(g.brickGroup.children.length);
}

// --------------------------------------------------------------------
//  Supabase CRUD
// --------------------------------------------------------------------

export interface SaveMapInput {
  title: string;
  description?: string;
  isPublic: boolean;
  data: MapData;
  thumbnailBlob?: Blob;
  /** When set, update an existing row instead of inserting. */
  existingId?: string;
}

/** Insert or update a map row. Returns the persisted row. */
export async function saveMap(input: SaveMapInput): Promise<SavedMap> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('로그인이 필요합니다.');

  // Upload thumbnail first (if provided) — we need the URL before insert.
  let thumbnailUrl: string | null = null;
  if (input.thumbnailBlob) {
    const path = `${user.id}/${crypto.randomUUID()}.png`;
    const { error: upErr } = await supabase.storage
      .from('map-thumbnails')
      .upload(path, input.thumbnailBlob, {
        contentType: 'image/png',
        upsert: false,
      });
    if (upErr) {
      console.error('[mapStorage] thumbnail upload failed:', upErr);
    } else {
      const { data: urlData } = supabase.storage
        .from('map-thumbnails')
        .getPublicUrl(path);
      thumbnailUrl = urlData.publicUrl;
    }
  }

  const row = {
    owner_id: user.id,
    title: input.title,
    description: input.description ?? null,
    data: input.data,
    is_public: input.isPublic,
    block_count: input.data.blocks.length,
    tile_size: input.data.tileSize,
    ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
  };

  if (input.existingId) {
    const { data, error } = await supabase
      .from('maps')
      .update(row)
      .eq('id', input.existingId)
      .select()
      .single();
    if (error) throw error;
    return data as SavedMap;
  } else {
    const { data, error } = await supabase
      .from('maps')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data as SavedMap;
  }
}

/** Fetch all maps owned by the currently signed-in user. */
export async function listMyMaps(): Promise<SavedMap[]> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return [];
  const { data, error } = await supabase
    .from('maps')
    .select('*')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedMap[];
}

export async function loadMap(id: string): Promise<SavedMap> {
  const { data, error } = await supabase
    .from('maps')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as SavedMap;
}

export async function deleteMap(id: string): Promise<void> {
  const { error } = await supabase.from('maps').delete().eq('id', id);
  if (error) throw error;
}

// --------------------------------------------------------------------
//  Thumbnail capture — grabs a 400×300 PNG of the current viewer canvas
// --------------------------------------------------------------------

/** Captures the current viewer canvas into a PNG blob. Returns null if
 *  the canvas can't be read (e.g. tainted — shouldn't happen here). */
export async function captureThumbnail(): Promise<Blob | null> {
  const canvas = document.querySelector('#viewer canvas') as HTMLCanvasElement | null;
  if (!canvas) return null;
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png', 0.92);
  });
}
