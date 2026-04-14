// ----------------------------------------------------------------------
//  Dashboard — shown after login, before/between builder sessions.
//  Hosts user stats, quick actions, map library, and inspiration.
// ----------------------------------------------------------------------

import {
  clearCurrentMap,
  deleteMap,
  deserializeMap,
  listMyMaps,
  loadMap,
  setCurrentMap,
} from './mapStorage';
import type { Game } from './game';
import type { SavedMap } from './supabase';
import { onAuthChange, signOut } from './auth';

type ViewMode = 'overview' | 'maps' | 'gallery' | 'store' | 'multiplayer';
type FilterMode = 'all' | 'public' | 'private';

let currentMaps: SavedMap[] = [];
let currentFilter: FilterMode = 'all';
let lastEditedId: string | null = null;

/** Show the dashboard (hides app shell). */
export function showDashboard() {
  document.body.classList.remove('show-landing');
  document.body.classList.remove('show-gallery');
  document.body.classList.remove('show-store');
  document.body.classList.remove('show-multiplayer');
  document.body.classList.add('show-dashboard');
  // The #dashboard element starts with `.hidden` in HTML — remove it so
  // CSS rules can take over visibility based on body classes.
  document.getElementById('dashboard')?.classList.remove('hidden');
  refreshDashboardData();
}

/** Hide the dashboard (show the app shell instead). */
export function hideDashboard() {
  document.body.classList.remove('show-dashboard');
}

export function buildDashboardUI(game: Game) {
  const dashEl = document.getElementById('dashboard');
  if (!dashEl) return;

  // --- Welcome + stats ---
  onAuthChange((state) => {
    // Toggle a body class so CSS can show/hide auth-only icon-bar buttons
    document.body.classList.toggle('is-authed', !!state.user);

    const name =
      state.profile?.display_name ||
      state.user?.user_metadata?.full_name ||
      state.user?.user_metadata?.name ||
      (state.user?.email ? state.user.email.split('@')[0] : null);
    const welcomeEl = document.getElementById('dash-welcome-name');
    if (welcomeEl) {
      welcomeEl.textContent = name ? `안녕하세요, ${name}님!` : '안녕하세요!';
    }
    renderAuthSlot(state);
  });

  // --- Listen for "go to dashboard" from anywhere in the app ---
  document.addEventListener('goto-dashboard', () => {
    showDashboard();
  });

  // --- Top nav tabs (overview / maps / gallery / store / multiplayer) ---
  document.querySelectorAll<HTMLButtonElement>('.dash-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (btn.dataset.view || 'overview') as ViewMode;
      document
        .querySelectorAll('.dash-nav-item')
        .forEach((b) => b.classList.toggle('active', b === btn));
      if (v === 'gallery') {
        document.dispatchEvent(new CustomEvent('goto-gallery'));
      } else if (v === 'store') {
        document.dispatchEvent(new CustomEvent('goto-store'));
      } else if (v === 'multiplayer') {
        document.dispatchEvent(new CustomEvent('goto-multiplayer'));
      } else if (v === 'maps') {
        document.querySelector('.dash-section')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  // --- Filter buttons (all / public / private) ---
  document.querySelectorAll<HTMLButtonElement>('.dash-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = (btn.dataset.filter || 'all') as FilterMode;
      currentFilter = f;
      document
        .querySelectorAll('.dash-filter-btn')
        .forEach((b) => b.classList.toggle('active', b === btn));
      renderMapsGrid();
    });
  });

  // --- Quick action buttons ---
  document.getElementById('dash-new-map')?.addEventListener('click', () => {
    game.clearAll();
    clearCurrentMap(); // fresh blank map — save will prompt for a new title
    hideDashboard();
  });

  document.getElementById('dash-continue')?.addEventListener('click', async () => {
    if (!lastEditedId) {
      // No saved maps — just open a blank builder
      hideDashboard();
      return;
    }
    await openMap(game, lastEditedId);
  });

  document.getElementById('dash-browse')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('goto-gallery'));
  });

  document.getElementById('dash-store')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('goto-store'));
  });

  document.getElementById('dash-multiplayer')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('goto-multiplayer'));
  });

  // --- Logo click returns from builder to dashboard ---
  const iconLogo = document.getElementById('iconbar-logo');
  iconLogo?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Only return to dashboard if user is logged in; otherwise icon-logo
    // keeps its existing behavior (scroll sidebar to top).
    const { isSignedIn } = getAuthSnapshot();
    if (isSignedIn) {
      showDashboard();
    }
  });
}

/** Fetch maps + stats and rerender. Called whenever dashboard opens. */
async function refreshDashboardData() {
  try {
    currentMaps = await listMyMaps();
  } catch (err) {
    console.error('[dashboard] listMyMaps failed:', err);
    currentMaps = [];
  }

  // Stats
  const totalBlocks = currentMaps.reduce((sum, m) => sum + (m.block_count || 0), 0);
  const publicCount = currentMaps.filter((m) => m.is_public).length;
  const likeCount = currentMaps.reduce((sum, m) => sum + (m.like_count || 0), 0);

  setText('stat-maps', currentMaps.length);
  setText('stat-blocks', totalBlocks);
  setText('stat-public', publicCount);
  setText('stat-likes', likeCount);

  // Remember last-edited for "이어서 편집" action
  if (currentMaps.length > 0) {
    lastEditedId = currentMaps[0].id;
    const label = document.getElementById('dash-continue-label');
    if (label)
      label.textContent = `"${currentMaps[0].title}" 이어서 만들기`;
  } else {
    lastEditedId = null;
    const label = document.getElementById('dash-continue-label');
    if (label) label.textContent = '저장된 맵이 없어요. 빈 맵에서 시작!';
  }

  renderMapsGrid();
}

function renderMapsGrid() {
  const grid = document.getElementById('dash-maps-grid');
  if (!grid) return;

  const filtered = currentMaps.filter((m) => {
    if (currentFilter === 'public') return m.is_public;
    if (currentFilter === 'private') return !m.is_public;
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="dash-empty">
        ${
          currentMaps.length === 0
            ? '아직 저장된 맵이 없어요. 새 맵을 만들어 첫 작품을 저장해보세요.'
            : '이 필터에 해당하는 맵이 없어요.'
        }
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  for (const m of filtered) {
    const card = document.createElement('div');
    card.className = 'dash-map-card';
    const thumb = m.thumbnail_url
      ? `<div class="dash-map-thumb" style="background-image: url('${escapeAttr(m.thumbnail_url)}')">
           <span class="dash-map-badge ${m.is_public ? 'public' : ''}">${m.is_public ? '공개' : '비공개'}</span>
         </div>`
      : `<div class="dash-map-thumb placeholder">
           <span class="dash-map-badge ${m.is_public ? 'public' : ''}">${m.is_public ? '공개' : '비공개'}</span>
         </div>`;

    const updated = formatRelativeDate(m.updated_at);

    card.innerHTML = `
      ${thumb}
      <div class="dash-map-body">
        <div class="dash-map-title">${escapeHtml(m.title)}</div>
        <div class="dash-map-meta">
          <span>${m.block_count} 블록</span>
          <span>${updated}</span>
        </div>
      </div>
      <div class="dash-map-actions">
        <button data-action="open">열기</button>
        <button data-action="delete" class="danger">삭제</button>
      </div>
    `;

    const openHandler = async () => {
      const game = (window as unknown as { __game__: Game }).__game__;
      if (!game) return;
      await openMap(game, m.id);
    };
    card.querySelector('[data-action="open"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openHandler();
    });
    // Clicking the card body (thumb or title) also opens
    card.querySelector('.dash-map-thumb')?.addEventListener('click', openHandler);
    card.querySelector('.dash-map-body')?.addEventListener('click', openHandler);

    card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`"${m.title}"을(를) 삭제할까요?`)) return;
      try {
        await deleteMap(m.id);
        await refreshDashboardData();
      } catch (err) {
        alert('삭제 실패: ' + (err instanceof Error ? err.message : String(err)));
      }
    });

    grid.appendChild(card);
  }
}

async function openMap(game: Game, mapId: string) {
  try {
    const full = await loadMap(mapId);
    deserializeMap(game, full.data);
    // Remember which map we're editing so "Save" overwrites it
    setCurrentMap({
      id: full.id,
      title: full.title,
      description: full.description,
      isPublic: full.is_public,
    });
    hideDashboard();
  } catch (err) {
    console.error('[dashboard] loadMap failed:', err);
    alert('맵을 불러오지 못했습니다: ' + (err instanceof Error ? err.message : String(err)));
  }
}

// --------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------

function setText(id: string, val: string | number) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

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

// --------------------------------------------------------------------
//  Auth slot inside dashboard nav (avatar dropdown, duplicated from authUi)
// --------------------------------------------------------------------

let dashMenuEl: HTMLDivElement | null = null;

function renderAuthSlot(state: import('./auth').AuthState) {
  const slot = document.getElementById('dash-auth-slot');
  if (!slot) return;
  slot.innerHTML = '';
  dashMenuEl?.remove();
  dashMenuEl = null;

  if (!state.user) return;

  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.src =
    state.profile?.avatar_url ||
    state.user.user_metadata?.avatar_url ||
    defaultAvatarDataUrl(state.profile?.display_name || state.user.email || '?');
  avatar.alt = state.profile?.display_name || 'User';
  avatar.title = state.profile?.display_name || state.user.email || '';
  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    openAvatarMenu(avatar, state);
  });
  slot.appendChild(avatar);
}

function openAvatarMenu(anchor: HTMLElement, state: import('./auth').AuthState) {
  if (dashMenuEl) {
    dashMenuEl.remove();
    dashMenuEl = null;
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'auth-menu';
  const name =
    state.profile?.display_name || state.user?.email || '사용자';
  menu.innerHTML = `
    <div class="menu-header">${escapeHtml(name)}</div>
    <button class="menu-item danger" data-action="signout">로그아웃</button>
  `;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 8}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;

  menu.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).dataset?.action;
    if (action === 'signout') {
      sessionStorage.removeItem('legoworld:entered-as-guest');
      signOut();
      menu.remove();
      dashMenuEl = null;
    }
  });

  setTimeout(() => {
    document.addEventListener(
      'click',
      function onDoc(e: MouseEvent) {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          dashMenuEl = null;
        } else {
          document.addEventListener('click', onDoc, { once: true });
        }
      },
      { once: true }
    );
  }, 0);

  dashMenuEl = menu;
}

function defaultAvatarDataUrl(name: string): string {
  const initial = (name.trim()[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%231c1d22"/><text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="700" fill="white" text-anchor="middle">${initial}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + svg;
}

function getAuthSnapshot(): { isSignedIn: boolean } {
  // onAuthChange fires synchronously with the current state when a
  // listener is first registered, so a one-shot subscribe gives us
  // the current state. We use a quick Promise-less read here.
  let isSignedIn = false;
  const unsub = onAuthChange((s) => {
    isSignedIn = !!s.user;
  });
  unsub();
  return { isSignedIn };
}
