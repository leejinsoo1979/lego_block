// ----------------------------------------------------------------------
//  Multiplayer rooms — list / create / join, with a live chat panel.
//
//  Real-time wiring is via supabase.channel() — we subscribe to inserts
//  on `room_messages` plus presence for the current room. Block-position
//  sync is a TODO; for now rooms are a shared lobby + chat.
// ----------------------------------------------------------------------

import * as THREE from 'three';
import {
  createRoom,
  findRoomByCode,
  joinRoom,
  leaveRoom,
  listRoomMessages,
  sendRoomMessage,
} from './api';
import { onAuthChange, type AuthState } from './auth';
import { listMyMaps } from './mapStorage';
import { supabase, type Room, type RoomMessage, type SavedMap } from './supabase';
import { createMinifigure } from './blocks';
import { MINIFIG_PRESETS } from './config';
import type { Game } from './game';
import type { RealtimeChannel } from '@supabase/supabase-js';

type PresenceMeta = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

let authState: AuthState = { session: null, user: null, profile: null };
let currentRoom: Room | null = null;
let myMaps: SavedMap[] = [];
let messages: RoomMessage[] = [];
let presence: PresenceMeta[] = [];
let messageChannel: RealtimeChannel | null = null;
let presenceChannel: RealtimeChannel | null = null;
let gameChannel: RealtimeChannel | null = null;
let myRooms: Room[] = [];

// Game + sync integration state
let gameRef: Game | null = null;
let blockPlacedHandler: ((obj: THREE.Object3D, local: boolean) => void) | null = null;
let blockRemovedHandler: ((obj: THREE.Object3D, local: boolean) => void) | null = null;

// Remote avatars — one per other user who's in the room. We render them
// directly in the game's scene so collision/camera behaves naturally.
interface RemoteAvatar {
  group: THREE.Group;
  label: THREE.Sprite;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetRotY: number;
  lastUpdate: number;
}
const remoteAvatars = new Map<string, RemoteAvatar>();
let positionBroadcastTimer: number | null = null;
let remoteAnimHandle: number | null = null;

// --------------------------------------------------------------------
//  Public API
// --------------------------------------------------------------------

export function showRoomList() {
  document.body.classList.remove('show-landing');
  document.body.classList.remove('show-dashboard');
  document.body.classList.remove('show-gallery');
  document.body.classList.remove('show-store');
  document.body.classList.add('show-multiplayer');
  document.getElementById('multiplayer')?.classList.remove('hidden');
  teardownRoom();
  refreshRoomList();
}

export function enterRoom(room: Room) {
  currentRoom = room;
  document.body.classList.add('in-room');
  updateRoomPill();
  renderInRoomUI();
  wireRoomChannels(room);
  loadMessages(room);
}

/** Keep the floating pill text in sync with presence count. Called on
 *  room entry and on each presence sync event. */
function updateRoomPill() {
  const name = document.getElementById('room-pill-name');
  const count = document.getElementById('room-pill-count');
  if (name) name.textContent = currentRoom?.name ?? '방';
  if (count) count.textContent = String(Math.max(1, presence.length));
}

export function hideMultiplayer() {
  document.body.classList.remove('show-multiplayer');
  teardownRoom();
}

export function buildMultiplayerUI(game: Game) {
  gameRef = game;
  renderShell();

  onAuthChange((s) => {
    authState = s;
    // If an invite code is in the URL and the user just signed in, auto-join
    maybeAutoJoinFromUrl();
  });

  document.addEventListener('goto-multiplayer', () => {
    showRoomList();
  });

  document.getElementById('mp-back')?.addEventListener('click', () => {
    if (currentRoom) {
      handleLeaveRoom();
    } else {
      hideMultiplayer();
      document.dispatchEvent(new CustomEvent('goto-dashboard'));
    }
  });

  // Floating room pill — click to pop back into the room lobby while
  // keeping subscriptions alive. Only visible when in a room + in
  // builder (CSS selector handles visibility).
  document.getElementById('room-pill')?.addEventListener('click', () => {
    if (!currentRoom) return;
    document.body.classList.remove('show-landing');
    document.body.classList.remove('show-dashboard');
    document.body.classList.remove('show-gallery');
    document.body.classList.remove('show-store');
    document.body.classList.add('show-multiplayer');
    document.getElementById('multiplayer')?.classList.remove('hidden');
  });

  // Check URL for ?room=CODE on initial load
  maybeAutoJoinFromUrl();
}

/** If the URL has ?room=CODE (from an invite link), try to join the
 *  matching room once the user is authenticated. */
let autoJoinAttempted = false;
async function maybeAutoJoinFromUrl() {
  if (autoJoinAttempted) return;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  if (!code) return;
  // Need to be signed in to join
  if (!authState.user) return;
  autoJoinAttempted = true;
  try {
    const room = await findRoomByCode(code.toUpperCase());
    if (!room) {
      alert('초대 코드와 일치하는 방을 찾을 수 없습니다.');
      // Clean the URL so refresh doesn't retry
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    await joinRoom(room.id);
    // Switch into the multiplayer view and enter the room
    document.body.classList.remove('show-landing');
    document.body.classList.remove('show-dashboard');
    document.body.classList.remove('show-gallery');
    document.body.classList.remove('show-store');
    document.body.classList.add('show-multiplayer');
    document.getElementById('multiplayer')?.classList.remove('hidden');
    enterRoom(room);
    // Clean the URL (user already in the room now)
    window.history.replaceState({}, '', window.location.pathname);
  } catch (err) {
    console.error('[multiplayer] auto-join failed:', err);
    alert('방 참여 실패: ' + (err instanceof Error ? err.message : String(err)));
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/** Returns true if the local user is currently in a multiplayer room. */
export function isInRoom(): boolean {
  return currentRoom !== null;
}

export function getCurrentRoom(): Room | null {
  return currentRoom;
}

// --------------------------------------------------------------------
//  Shell
// --------------------------------------------------------------------

function renderShell() {
  const el = document.getElementById('multiplayer');
  if (!el) return;
  el.innerHTML = `
    <div class="gallery-bg-blobs" aria-hidden="true">
      <div class="dash-blob dash-blob-1"></div>
      <div class="dash-blob dash-blob-2"></div>
      <div class="dash-blob dash-blob-3"></div>
    </div>
    <div class="dash-studs" aria-hidden="true"></div>

    <header class="gallery-nav">
      <div class="gallery-nav-left">
        <div class="landing-logo">
          <span class="landing-logo-brick" style="background: #c4281c"></span>
          <span class="landing-logo-brick" style="background: #f5cd30"></span>
          <span class="landing-logo-brick" style="background: #0d69ac"></span>
          <span class="landing-logo-text">LEGO WORLD</span>
        </div>
        <h1 id="mp-title" class="gallery-title">멀티플레이</h1>
      </div>
      <div class="gallery-nav-tools">
        <button id="mp-back" class="gallery-back-btn">← 대시보드</button>
      </div>
    </header>

    <main class="gallery-main">
      <div id="mp-content"></div>
    </main>
  `;
}

// --------------------------------------------------------------------
//  Room list view
// --------------------------------------------------------------------

async function refreshRoomList() {
  const content = document.getElementById('mp-content');
  const title = document.getElementById('mp-title');
  if (!content) return;
  if (title) title.textContent = '멀티플레이';
  content.innerHTML = '<div class="dash-empty">불러오는 중…</div>';

  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('is_open', true)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    myRooms = (data ?? []) as Room[];
  } catch (err) {
    console.error('[multiplayer] list rooms failed:', err);
    alert('방 목록을 불러오지 못했습니다.');
    myRooms = [];
  }

  try {
    myMaps = await listMyMaps();
  } catch {
    myMaps = [];
  }

  renderRoomList();
}

function renderRoomList() {
  const content = document.getElementById('mp-content');
  if (!content) return;

  const mapOptions = myMaps
    .map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.title)}</option>`)
    .join('');

  const roomCards = myRooms.length
    ? myRooms
        .map(
          (r) => `
            <div class="room-card" data-id="${escapeAttr(r.id)}">
              <div class="room-card-head">
                <div class="room-card-name">${escapeHtml(r.name)}</div>
                <div class="room-card-code">#${escapeHtml(r.invite_code)}</div>
              </div>
              <div class="room-card-meta">
                최대 ${r.max_players}명 · ${formatRelativeDate(r.created_at)}
              </div>
              <button class="room-join-btn" data-action="join" data-id="${escapeAttr(r.id)}">입장</button>
            </div>
          `
        )
        .join('')
    : '<div class="dash-empty">열려있는 방이 없어요. 첫 방을 만들어보세요!</div>';

  content.innerHTML = `
    <section class="mp-section">
      <h2 class="mp-section-title">새 방 만들기</h2>
      <form id="mp-create-form" class="mp-create-form">
        <label class="form-label">방 이름</label>
        <input id="mp-create-name" type="text" class="form-input" maxlength="60" placeholder="우리 동네 같이 만들기" required />
        <label class="form-label">같이 열 맵 (선택)</label>
        <select id="mp-create-map" class="form-input">
          <option value="">— 빈 맵에서 시작 —</option>
          ${mapOptions}
        </select>
        <button type="submit" class="modal-btn-primary mp-create-btn">＋ 방 만들기</button>
      </form>
    </section>

    <section class="mp-section">
      <h2 class="mp-section-title">초대 코드로 참가</h2>
      <form id="mp-join-form" class="mp-join-form">
        <input id="mp-join-code" type="text" class="form-input" maxlength="8" placeholder="예: ABCD1234" autocapitalize="characters" />
        <button type="submit" class="modal-btn-primary">참가</button>
      </form>
    </section>

    <section class="mp-section">
      <h2 class="mp-section-title">열려있는 방</h2>
      <div class="room-grid">${roomCards}</div>
    </section>
  `;

  document.getElementById('mp-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleCreateRoom();
  });

  document.getElementById('mp-join-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleJoinByCode();
  });

  content.querySelectorAll<HTMLButtonElement>('[data-action="join"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const room = myRooms.find((r) => r.id === id);
      if (!room) return;
      await handleJoinRoom(room);
    });
  });
}

async function handleCreateRoom() {
  if (!authState.user) {
    alert('방 만들기는 로그인 후 이용할 수 있어요.');
    return;
  }
  const name = (document.getElementById('mp-create-name') as HTMLInputElement | null)?.value.trim();
  const mapId = (document.getElementById('mp-create-map') as HTMLSelectElement | null)?.value || null;
  if (!name) {
    alert('방 이름을 입력해주세요.');
    return;
  }
  try {
    const room = await createRoom({ name, mapId: mapId || null });
    enterRoom(room);
  } catch (err) {
    console.error('[multiplayer] createRoom failed:', err);
    alert('방 만들기에 실패했습니다: ' + (err instanceof Error ? err.message : String(err)));
  }
}

async function handleJoinByCode() {
  const codeEl = document.getElementById('mp-join-code') as HTMLInputElement | null;
  const code = codeEl?.value.trim().toUpperCase();
  if (!code) {
    alert('초대 코드를 입력해주세요.');
    return;
  }
  try {
    const room = await findRoomByCode(code);
    if (!room) {
      alert('해당 코드로 방을 찾을 수 없어요.');
      return;
    }
    await handleJoinRoom(room);
  } catch (err) {
    console.error('[multiplayer] join by code failed:', err);
    alert('참가에 실패했습니다.');
  }
}

async function handleJoinRoom(room: Room) {
  if (!authState.user) {
    alert('방 참가는 로그인 후 이용할 수 있어요.');
    return;
  }
  try {
    await joinRoom(room.id);
    enterRoom(room);
  } catch (err) {
    console.error('[multiplayer] joinRoom failed:', err);
    alert('방 입장에 실패했습니다.');
  }
}

async function handleLeaveRoom() {
  if (!currentRoom) return;
  const room = currentRoom;
  try {
    await leaveRoom(room.id);
  } catch (err) {
    console.error('[multiplayer] leaveRoom failed:', err);
  }
  teardownRoom();
  showRoomList();
}

// --------------------------------------------------------------------
//  In-room view (chat + members)
// --------------------------------------------------------------------

function renderInRoomUI() {
  const content = document.getElementById('mp-content');
  const title = document.getElementById('mp-title');
  if (!content || !currentRoom) return;

  if (title) title.textContent = currentRoom.name;

  const inviteUrl = `${window.location.origin}/?room=${currentRoom.invite_code}`;

  content.innerHTML = `
    <div class="mp-room-layout">
      <aside class="mp-room-aside">
        <div class="mp-room-info">
          <div class="mp-room-label">초대 링크</div>
          <div class="mp-room-code">#${escapeHtml(currentRoom.invite_code)}</div>
          <div class="mp-invite-actions">
            <button id="mp-copy-code" class="mp-copy-btn">코드 복사</button>
            <button id="mp-copy-link" class="mp-copy-btn">링크 복사</button>
          </div>
        </div>

        <div class="mp-room-members">
          <h3>방 안의 친구들 <span id="mp-presence-count" class="mp-count-pill">0</span></h3>
          <div id="mp-members" class="mp-member-list"></div>
        </div>

        <button id="mp-enter-builder" class="mp-enter-builder-btn">
          🧱 함께 만들기 시작
        </button>
        <p class="mp-room-note">
          빌더로 들어가면 다른 친구들이 놓는 블록과 캐릭터 위치가 실시간으로 보입니다.
        </p>

        <button id="mp-leave-btn" class="mp-leave-btn">방 나가기</button>
      </aside>

      <section class="mp-chat">
        <div class="mp-chat-header">💬 채팅</div>
        <div id="mp-chat-list" class="mp-chat-list"></div>
        <form id="mp-chat-form" class="mp-chat-form">
          <input id="mp-chat-input" type="text" class="form-input" placeholder="메시지 입력…" maxlength="500" autocomplete="off" />
          <button type="submit" class="modal-btn-primary">전송</button>
        </form>
      </section>
    </div>
  `;

  document.getElementById('mp-copy-code')?.addEventListener('click', () => {
    if (!currentRoom) return;
    navigator.clipboard
      ?.writeText(currentRoom.invite_code)
      .then(() => showToast('초대 코드 복사 완료'))
      .catch(() => alert(`코드: ${currentRoom!.invite_code}`));
  });

  document.getElementById('mp-copy-link')?.addEventListener('click', () => {
    navigator.clipboard
      ?.writeText(inviteUrl)
      .then(() => showToast('초대 링크 복사 완료'))
      .catch(() => alert(inviteUrl));
  });

  document.getElementById('mp-enter-builder')?.addEventListener('click', async () => {
    // If the room has an associated map, load it; otherwise stay on the
    // current scene (or a fresh one). Either way, leave the multiplayer
    // overlay and drop into the builder.
    if (currentRoom?.map_id && gameRef) {
      try {
        const { loadMap } = await import('./mapStorage');
        const { deserializeMap } = await import('./mapStorage');
        const map = await loadMap(currentRoom.map_id);
        deserializeMap(gameRef, map.data);
      } catch (err) {
        console.error('[multiplayer] failed to load room map:', err);
      }
    }
    document.body.classList.remove('show-multiplayer');
    // Keep the room subscriptions alive — they'll continue syncing in
    // the background while the user builds.
  });

  document.getElementById('mp-leave-btn')?.addEventListener('click', () => {
    handleLeaveRoom();
  });

  document.getElementById('mp-chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await sendChatMessage();
  });
}

async function loadMessages(room: Room) {
  try {
    messages = await listRoomMessages(room.id);
  } catch (err) {
    console.error('[multiplayer] listRoomMessages failed:', err);
    messages = [];
  }
  renderMessages();
}

function renderMessages() {
  const list = document.getElementById('mp-chat-list');
  if (!list) return;
  if (messages.length === 0) {
    list.innerHTML = '<div class="mp-chat-empty">첫 메시지를 남겨보세요!</div>';
    return;
  }
  list.innerHTML = messages
    .map((m) => {
      const isMine = authState.user?.id === m.user_id;
      return `
        <div class="mp-chat-msg ${isMine ? 'mine' : ''}">
          <div class="mp-chat-bubble">${escapeHtml(m.body)}</div>
          <div class="mp-chat-time">${formatRelativeDate(m.created_at)}</div>
        </div>
      `;
    })
    .join('');
  list.scrollTop = list.scrollHeight;
}

async function sendChatMessage() {
  if (!currentRoom) return;
  const input = document.getElementById('mp-chat-input') as HTMLInputElement | null;
  const body = input?.value.trim();
  if (!body) return;
  try {
    await sendRoomMessage(currentRoom.id, body);
    if (input) input.value = '';
  } catch (err) {
    console.error('[multiplayer] sendMessage failed:', err);
    alert('메시지 전송에 실패했습니다.');
  }
}

// --------------------------------------------------------------------
//  Realtime wiring
// --------------------------------------------------------------------

function wireRoomChannels(room: Room) {
  // --- Message inserts ---
  messageChannel = supabase
    .channel(`room-msgs-${room.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'room_messages',
        filter: `room_id=eq.${room.id}`,
      },
      (payload) => {
        const msg = payload.new as RoomMessage;
        messages.push(msg);
        renderMessages();
      }
    )
    .subscribe();

  // --- Presence ---
  presenceChannel = supabase.channel(`room-presence-${room.id}`, {
    config: { presence: { key: authState.user?.id || 'anon' } },
  });

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      if (!presenceChannel) return;
      const state = presenceChannel.presenceState<PresenceMeta>();
      presence = Object.values(state)
        .flat()
        .map((p) => p as PresenceMeta);
      renderPresence();
      updateRoomPill();
      // Clean up avatars for users who left the room
      const activeIds = new Set(presence.map((p) => p.user_id));
      for (const [uid] of remoteAvatars) {
        if (!activeIds.has(uid)) removeRemoteAvatar(uid);
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && presenceChannel && authState.user) {
        await presenceChannel.track({
          user_id: authState.user.id,
          display_name:
            authState.profile?.display_name ||
            authState.user.email?.split('@')[0] ||
            '익명',
          avatar_url: authState.profile?.avatar_url || null,
        });
      }
    });

  // --- Game sync channel (block place/remove + player position) ---
  // Uses broadcast-only events (no persistence) for low-latency sync.
  gameChannel = supabase.channel(`room-game-${room.id}`, {
    config: { broadcast: { self: false } },
  });

  gameChannel
    .on('broadcast', { event: 'block-placed' }, (payload) => {
      if (!gameRef) return;
      gameRef.applyRemoteBlockPlace(payload.payload as Parameters<Game['applyRemoteBlockPlace']>[0]);
    })
    .on('broadcast', { event: 'block-removed' }, (payload) => {
      if (!gameRef) return;
      gameRef.applyRemoteBlockRemove(payload.payload as { x: number; y: number; z: number });
    })
    .on('broadcast', { event: 'player-pose' }, (payload) => {
      const p = payload.payload as {
        user_id: string;
        x: number;
        y: number;
        z: number;
        rotY: number;
        display_name: string;
      };
      if (authState.user && p.user_id === authState.user.id) return;
      updateRemoteAvatar(p);
    })
    .subscribe();

  // Hook local game events → broadcast to peers
  wireLocalGameHooks();
}

/** Attach listeners to the local Game so its block events get broadcast
 *  to other players in the room. Detaches on teardown. */
function wireLocalGameHooks() {
  if (!gameRef) return;
  const g = gameRef;

  // Snapshot any existing handlers so we don't clobber them
  const prevPlaced = g.onBlockPlaced;
  const prevRemoved = g.onBlockRemoved;

  blockPlacedHandler = (obj, local) => {
    prevPlaced(obj, local);
    if (!local || !gameChannel) return;
    const spec = obj.userData.spec as {
      type?: string;
      w?: number;
      d?: number;
      colorHex?: number;
    } | undefined;
    if (!spec?.type) return;
    // Quarter-turn rotation step derived from world Y rotation
    const rotSteps = Math.round(-obj.rotation.y / (Math.PI / 2));
    const rotation = ((rotSteps % 4) + 4) % 4;
    gameChannel.send({
      type: 'broadcast',
      event: 'block-placed',
      payload: {
        type: spec.type,
        x: obj.position.x,
        y: obj.position.y,
        z: obj.position.z,
        w: spec.w ?? 1,
        d: spec.d ?? 1,
        colorHex: spec.colorHex ?? 0xffffff,
        rotation,
        characterId: obj.userData.characterId,
      },
    });
  };
  blockRemovedHandler = (obj, local) => {
    prevRemoved(obj, local);
    if (!local || !gameChannel) return;
    gameChannel.send({
      type: 'broadcast',
      event: 'block-removed',
      payload: {
        x: obj.position.x,
        y: obj.position.y,
        z: obj.position.z,
      },
    });
  };
  g.onBlockPlaced = blockPlacedHandler;
  g.onBlockRemoved = blockRemovedHandler;

  // Start broadcasting our own player position @ 10Hz
  if (positionBroadcastTimer != null) clearInterval(positionBroadcastTimer);
  positionBroadcastTimer = window.setInterval(() => {
    if (!gameChannel || !authState.user) return;
    const s = g.getPlayerState();
    // Only broadcast when actually playing (not in build mode)
    if (!s.isPlaying) return;
    gameChannel.send({
      type: 'broadcast',
      event: 'player-pose',
      payload: {
        user_id: authState.user.id,
        display_name:
          authState.profile?.display_name ||
          authState.user.email?.split('@')[0] ||
          '익명',
        x: s.x,
        y: s.y,
        z: s.z,
        rotY: s.rotY,
      },
    });
  }, 100);

  // Smooth-interp remote avatars at 60fps toward their latest broadcast pose
  const tickRemote = () => {
    for (const a of remoteAvatars.values()) {
      const g = a.group;
      const t = 0.2; // lerp factor
      g.position.x += (a.targetX - g.position.x) * t;
      g.position.y += (a.targetY - g.position.y) * t;
      g.position.z += (a.targetZ - g.position.z) * t;
      let dr = a.targetRotY - g.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      g.rotation.y += dr * t;
    }
    remoteAnimHandle = requestAnimationFrame(tickRemote);
  };
  if (remoteAnimHandle != null) cancelAnimationFrame(remoteAnimHandle);
  remoteAnimHandle = requestAnimationFrame(tickRemote);
}

// --------------------------------------------------------------------
//  Remote player avatars (rendered in the game scene)
// --------------------------------------------------------------------

function updateRemoteAvatar(p: {
  user_id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  display_name: string;
}) {
  if (!gameRef) return;
  let avatar = remoteAvatars.get(p.user_id);
  if (!avatar) {
    avatar = spawnRemoteAvatar(p.user_id, p.display_name);
    remoteAvatars.set(p.user_id, avatar);
  }
  avatar.targetX = p.x;
  avatar.targetY = p.y;
  avatar.targetZ = p.z;
  avatar.targetRotY = p.rotY;
  avatar.lastUpdate = performance.now();
}

function spawnRemoteAvatar(userId: string, name: string): RemoteAvatar {
  // Pick a deterministic preset based on the userId so each peer has a
  // distinct but stable look across sessions.
  const idx =
    Array.from(userId).reduce((a, c) => a + c.charCodeAt(0), 0) %
    MINIFIG_PRESETS.length;
  const preset = MINIFIG_PRESETS[idx];
  const fig = createMinifigure(preset);
  // Don't participate in collision AABBs — this is a visual-only actor
  fig.userData.isRemoteAvatar = true;

  // Floating name label above the head
  const label = makeNameLabel(name);
  label.position.set(0, 5.5, 0);
  fig.add(label);

  gameRef!.getScene().add(fig);
  return {
    group: fig,
    label,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    targetRotY: 0,
    lastUpdate: performance.now(),
  };
}

function removeRemoteAvatar(userId: string) {
  const a = remoteAvatars.get(userId);
  if (!a || !gameRef) return;
  gameRef.getScene().remove(a.group);
  a.group.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.geometry?.dispose?.();
      const mat = c.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    }
  });
  (a.label.material as THREE.SpriteMaterial)?.map?.dispose?.();
  (a.label.material as THREE.Material).dispose?.();
  remoteAvatars.delete(userId);
}

/** Render a canvas-based text label as a THREE.Sprite so it always faces
 *  the camera and stays readable regardless of yaw. */
function makeNameLabel(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  // Rounded pill background
  ctx.fillStyle = 'rgba(28, 29, 34, 0.85)';
  const r = 28;
  ctx.beginPath();
  ctx.moveTo(r, 4);
  ctx.lineTo(canvas.width - r, 4);
  ctx.quadraticCurveTo(canvas.width - 4, 4, canvas.width - 4, r);
  ctx.lineTo(canvas.width - 4, canvas.height - r);
  ctx.quadraticCurveTo(
    canvas.width - 4,
    canvas.height - 4,
    canvas.width - r,
    canvas.height - 4
  );
  ctx.lineTo(r, canvas.height - 4);
  ctx.quadraticCurveTo(4, canvas.height - 4, 4, canvas.height - r);
  ctx.lineTo(4, r);
  ctx.quadraticCurveTo(4, 4, r, 4);
  ctx.fill();
  // Name text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

function detachLocalGameHooks() {
  if (!gameRef) return;
  // Restore defaults (no-ops). We can't restore prev handlers because
  // they were the no-op defaults before we replaced them; if the app
  // later adds more listeners it should use an event-bus pattern.
  gameRef.onBlockPlaced = () => {};
  gameRef.onBlockRemoved = () => {};
  blockPlacedHandler = null;
  blockRemovedHandler = null;
  if (positionBroadcastTimer != null) {
    clearInterval(positionBroadcastTimer);
    positionBroadcastTimer = null;
  }
  if (remoteAnimHandle != null) {
    cancelAnimationFrame(remoteAnimHandle);
    remoteAnimHandle = null;
  }
  // Remove all remote avatars from the scene
  for (const uid of Array.from(remoteAvatars.keys())) {
    removeRemoteAvatar(uid);
  }
}

function renderPresence() {
  const members = document.getElementById('mp-members');
  const count = document.getElementById('mp-presence-count');
  if (count) count.textContent = String(presence.length);
  if (!members) return;
  if (presence.length === 0) {
    members.innerHTML = '<div class="mp-member-empty">아직 아무도 없어요…</div>';
    return;
  }
  members.innerHTML = presence
    .map((p) => {
      const avatar = p.avatar_url || defaultAvatarDataUrl(p.display_name);
      return `
        <div class="mp-member">
          <img src="${escapeAttr(avatar)}" alt="${escapeAttr(p.display_name)}" class="gallery-avatar-sm" />
          <span>${escapeHtml(p.display_name)}</span>
        </div>
      `;
    })
    .join('');
}

function teardownRoom() {
  if (messageChannel) {
    supabase.removeChannel(messageChannel);
    messageChannel = null;
  }
  if (presenceChannel) {
    supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  if (gameChannel) {
    supabase.removeChannel(gameChannel);
    gameChannel = null;
  }
  detachLocalGameHooks();
  currentRoom = null;
  messages = [];
  presence = [];
  document.body.classList.remove('in-room');
}

// --------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function defaultAvatarDataUrl(name: string): string {
  const initial = (name.trim()[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%231c1d22"/><text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="700" fill="white" text-anchor="middle">${initial}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + svg;
}

function showToast(message: string) {
  let toast = document.getElementById('toast-host');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-host';
    toast.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:500;pointer-events:none;';
    document.body.appendChild(toast);
  }
  const t = document.createElement('div');
  t.textContent = message;
  t.style.cssText =
    'background:#1c1d22;color:#fff;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:500;box-shadow:0 6px 20px rgba(0,0,0,0.2);margin-top:6px;opacity:0;transition:opacity 0.2s;';
  toast.appendChild(t);
  requestAnimationFrame(() => (t.style.opacity = '1'));
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, 2400);
}
