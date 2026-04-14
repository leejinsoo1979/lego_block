// ----------------------------------------------------------------------
//  Multiplayer rooms — list / create / join, with a live chat panel.
//
//  Real-time wiring is via supabase.channel() — we subscribe to inserts
//  on `room_messages` plus presence for the current room. Block-position
//  sync is a TODO; for now rooms are a shared lobby + chat.
// ----------------------------------------------------------------------

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
let myRooms: Room[] = [];

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
  renderInRoomUI();
  wireRoomChannels(room);
  loadMessages(room);
}

export function hideMultiplayer() {
  document.body.classList.remove('show-multiplayer');
  teardownRoom();
}

// _game unused but accepted for future block-sync integration.
export function buildMultiplayerUI(_game: Game) {
  renderShell();

  onAuthChange((s) => {
    authState = s;
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

  content.innerHTML = `
    <div class="mp-room-layout">
      <aside class="mp-room-aside">
        <div class="mp-room-info">
          <div class="mp-room-label">초대 코드</div>
          <div class="mp-room-code">#${escapeHtml(currentRoom.invite_code)}</div>
          <button id="mp-copy-code" class="mp-copy-btn">복사</button>
        </div>

        <div class="mp-room-members">
          <h3>방 안의 친구들 <span id="mp-presence-count" class="mp-count-pill">0</span></h3>
          <div id="mp-members" class="mp-member-list"></div>
        </div>

        <div class="mp-room-note">
          🚧 블록 동기화는 곧 추가됩니다. 지금은 채팅과 로비만 공유돼요.
        </div>

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
  currentRoom = null;
  messages = [];
  presence = [];
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
