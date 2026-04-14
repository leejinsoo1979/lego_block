// ----------------------------------------------------------------------
//  Supabase client — auth, DB, storage.
//
//  Credentials are injected at build time from .env.local (VITE_*). The
//  publishable anon key is safe to ship to the browser because Row Level
//  Security policies on every table gate what clients can actually read
//  or write.
// ----------------------------------------------------------------------

import { createClient, type Session, type User } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Profile row type that matches the `public.profiles` table schema.
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

// Saved map row type matching `public.maps`.
export interface SavedMap {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  data: MapData;
  thumbnail_url: string | null;
  is_public: boolean;
  block_count: number;
  tile_size: number;
  like_count: number;
  created_at: string;
  updated_at: string;
}

// Serialized scene payload stored in `maps.data` (jsonb).
export interface MapData {
  version: 1;
  tileSize: number;
  environmentId: string;
  timeOfDay: number;
  // One entry per placed block. Everything needed to recreate it.
  blocks: SerializedBlock[];
  // Baseplate tile positions (x,z grid coords). Lets us restore
  // multi-tile maps that the user extended with the "+stud" tool.
  tiles: { x: number; z: number; y: number }[];
}

export interface SerializedBlock {
  type: string;             // BlockType (stringly typed to survive schema changes)
  x: number;
  y: number;
  z: number;
  rotation: number;         // 0..3 (quarter turns)
  colorHex: number;
  w: number;
  d: number;
  // Optional per-type extras (minifig character id, dog breed, etc.)
  extras?: Record<string, unknown>;
}

// ----------------------------------------------------------------------
//  Phase 2-5 row types
// ----------------------------------------------------------------------

export interface MapComment {
  id: string;
  map_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  // Joined on read
  author?: Pick<Profile, 'display_name' | 'avatar_url'> | null;
}

export interface Room {
  id: string;
  owner_id: string;
  map_id: string | null;
  name: string;
  invite_code: string;
  is_open: boolean;
  max_players: number;
  created_at: string;
}

export interface RoomMessage {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface Asset {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  kind: 'pack' | 'single';
  unlocked_types: string[];
  preview_emoji: string;
  created_at: string;
}

export interface Purchase {
  id: string;
  user_id: string;
  asset_id: string;
  amount_cents: number;
  purchased_at: string;
  stripe_session_id: string | null;
}

// Re-export auth types so other modules don't each need to import them.
export type { Session, User };
