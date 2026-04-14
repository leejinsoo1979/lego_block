// ----------------------------------------------------------------------
//  High-level data access for phases 2–5.
//  Wraps Supabase queries so UI code doesn't poke at raw SQL columns.
// ----------------------------------------------------------------------

import {
  supabase,
  type Asset,
  type MapComment,
  type Profile,
  type Purchase,
  type Room,
  type RoomMessage,
  type SavedMap,
} from './supabase';

// ====================================================================
//  GALLERY — public map browsing
// ====================================================================

export type GallerySort = 'popular' | 'recent';

export interface GalleryQuery {
  sort?: GallerySort;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Fetch public maps for the gallery grid. Joins author profile for
 *  attribution. */
export async function listPublicMaps(
  q: GalleryQuery = {}
): Promise<(SavedMap & { author: Pick<Profile, 'display_name' | 'avatar_url'> | null })[]> {
  let query = supabase
    .from('maps')
    .select(
      'id, owner_id, title, description, thumbnail_url, is_public, block_count, tile_size, like_count, created_at, updated_at, author:profiles!maps_owner_id_fkey(display_name, avatar_url)'
    )
    .eq('is_public', true);

  if (q.search) {
    query = query.ilike('title', `%${q.search}%`);
  }
  if (q.sort === 'popular') {
    query = query.order('like_count', { ascending: false }).order('created_at', {
      ascending: false,
    });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const limit = q.limit ?? 24;
  const offset = q.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) throw error;
  // Type-cast — "data" is never but we trust the query shape above
  // Note: `author:profiles!...(field, field)` returns an object, but the
  // Supabase client types it as an array; flatten here for convenience.
  const rows = (data ?? []) as unknown as (SavedMap & {
    author: Pick<Profile, 'display_name' | 'avatar_url'> | Array<Pick<Profile, 'display_name' | 'avatar_url'>> | null;
  })[];
  return rows.map((row) => ({
    ...row,
    author: Array.isArray(row.author) ? row.author[0] ?? null : row.author,
  }));
}

/** Fetch a single map by id (must be public or owned). */
export async function getMap(id: string): Promise<SavedMap> {
  const { data, error } = await supabase
    .from('maps')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as SavedMap;
}

/** Profile for an arbitrary user id (gallery attribution, room header). */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return (data as Profile) ?? null;
}

// ====================================================================
//  LIKES
// ====================================================================

/** Returns true if the signed-in user has liked the given map. */
export async function hasLiked(mapId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await supabase
    .from('map_likes')
    .select('map_id')
    .eq('map_id', mapId)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function likeMap(mapId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase
    .from('map_likes')
    .insert({ map_id: mapId, user_id: auth.user.id });
  if (error && error.code !== '23505') throw error; // 23505 = already liked
}

export async function unlikeMap(mapId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase
    .from('map_likes')
    .delete()
    .eq('map_id', mapId)
    .eq('user_id', auth.user.id);
  if (error) throw error;
}

// ====================================================================
//  COMMENTS
// ====================================================================

export async function listComments(mapId: string): Promise<MapComment[]> {
  const { data, error } = await supabase
    .from('map_comments')
    .select(
      'id, map_id, user_id, body, created_at, updated_at, author:profiles!map_comments_user_id_fkey(display_name, avatar_url)'
    )
    .eq('map_id', mapId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as unknown as (MapComment & {
    author: MapComment['author'] | Array<NonNullable<MapComment['author']>>;
  })[];
  return rows.map((r) => ({
    ...r,
    author: Array.isArray(r.author) ? r.author[0] ?? null : r.author,
  })) as MapComment[];
}

export async function addComment(mapId: string, body: string): Promise<MapComment> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const { data, error } = await supabase
    .from('map_comments')
    .insert({ map_id: mapId, user_id: auth.user.id, body })
    .select()
    .single();
  if (error) throw error;
  return data as MapComment;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('map_comments').delete().eq('id', id);
  if (error) throw error;
}

// ====================================================================
//  FOLLOWS
// ====================================================================

export async function isFollowing(targetUserId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  if (auth.user.id === targetUserId) return false;
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', auth.user.id)
    .eq('followed_id', targetUserId)
    .maybeSingle();
  return !!data;
}

export async function follow(targetUserId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase.from('follows').insert({
    follower_id: auth.user.id,
    followed_id: targetUserId,
  });
  if (error && error.code !== '23505') throw error;
}

export async function unfollow(targetUserId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', auth.user.id)
    .eq('followed_id', targetUserId);
  if (error) throw error;
}

// ====================================================================
//  MULTIPLAYER ROOMS
// ====================================================================

/** Create a room. Generates an invite code via a DB function. */
export async function createRoom(params: {
  name: string;
  mapId?: string | null;
  maxPlayers?: number;
}): Promise<Room> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');

  // Call the SQL helper to get a short invite code
  const { data: codeResult, error: codeErr } = await supabase.rpc('gen_invite_code');
  if (codeErr) throw codeErr;

  const { data, error } = await supabase
    .from('rooms')
    .insert({
      owner_id: auth.user.id,
      map_id: params.mapId ?? null,
      name: params.name,
      invite_code: codeResult as string,
      max_players: params.maxPlayers ?? 8,
    })
    .select()
    .single();
  if (error) throw error;

  // Auto-join the owner
  await supabase
    .from('room_members')
    .insert({ room_id: data.id, user_id: auth.user.id });
  return data as Room;
}

export async function findRoomByCode(code: string): Promise<Room | null> {
  const { data } = await supabase
    .from('rooms')
    .select('*')
    .eq('invite_code', code.toUpperCase())
    .maybeSingle();
  return (data as Room) ?? null;
}

export async function joinRoom(roomId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase
    .from('room_members')
    .insert({ room_id: roomId, user_id: auth.user.id });
  if (error && error.code !== '23505') throw error;
}

export async function leaveRoom(roomId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  await supabase
    .from('room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', auth.user.id);
}

export async function listRoomMessages(roomId: string): Promise<RoomMessage[]> {
  const { data, error } = await supabase
    .from('room_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as RoomMessage[];
}

export async function sendRoomMessage(roomId: string, body: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const trimmed = body.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('room_messages').insert({
    room_id: roomId,
    user_id: auth.user.id,
    body: trimmed.slice(0, 500),
  });
  if (error) throw error;
}

// ====================================================================
//  ASSETS + PURCHASES
// ====================================================================

export async function listAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .order('price_cents', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Asset[];
}

export async function listMyPurchases(): Promise<Purchase[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('user_id', auth.user.id);
  if (error) throw error;
  return (data ?? []) as Purchase[];
}

/** Mock purchase — inserts a purchase row. Replace with Stripe-backed
 *  Edge Function when the store goes live. */
export async function mockPurchaseAsset(asset: Asset): Promise<Purchase> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const { data, error } = await supabase
    .from('purchases')
    .insert({
      user_id: auth.user.id,
      asset_id: asset.id,
      amount_cents: asset.price_cents,
      stripe_session_id: 'mock_' + crypto.randomUUID(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as Purchase;
}
