// ----------------------------------------------------------------------
//  Auth UI wiring — login button / avatar dropdown in the sidebar header,
//  save/load modals, and the cloud toolbar (visible only when signed in).
// ----------------------------------------------------------------------

import { onAuthChange, signInWithGoogle, signOut, type AuthState } from './auth';
import {
  captureThumbnail,
  clearCurrentMap,
  deleteMap,
  deserializeMap,
  getCurrentMap,
  listMyMaps,
  loadMap,
  saveMap,
  serializeMap,
  setCurrentMap,
} from './mapStorage';
import type { Game } from './game';
import type { SavedMap } from './supabase';

/** Wire up all auth-related DOM elements. Call once after buildUI. */
export function buildAuthUI(game: Game) {
  const slot = document.getElementById('auth-slot');
  const cloudToolbar = document.getElementById('cloud-toolbar');
  if (!slot) return;

  let currentState: AuthState = { session: null, user: null, profile: null };
  let menuEl: HTMLDivElement | null = null;

  const render = (state: AuthState) => {
    currentState = state;
    slot.innerHTML = '';
    closeMenu();

    if (!state.user) {
      // Signed out — show a compact "로그인" button that triggers Google OAuth.
      const btn = document.createElement('button');
      btn.className = 'login-btn';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
        </svg>
        Google 로그인
      `;
      btn.addEventListener('click', () => {
        signInWithGoogle();
      });
      slot.appendChild(btn);
      if (cloudToolbar) cloudToolbar.classList.add('hidden');
    } else {
      // Signed in — show avatar; clicking opens a small dropdown.
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
        toggleMenu(avatar);
      });
      slot.appendChild(avatar);
      if (cloudToolbar) cloudToolbar.classList.remove('hidden');
    }
  };

  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
  }

  function toggleMenu(anchor: HTMLElement) {
    if (menuEl) {
      closeMenu();
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'auth-menu';
    const name =
      currentState.profile?.display_name ||
      currentState.user?.email ||
      '사용자';
    menu.innerHTML = `
      <div class="menu-header">${escapeHtml(name)}</div>
      <button class="menu-item" data-action="my-maps">📂 내 맵</button>
      <button class="menu-item danger" data-action="signout">로그아웃</button>
    `;
    document.body.appendChild(menu);
    // Position below the avatar
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;

    menu.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).dataset?.action;
      if (action === 'signout') {
        // Clear guest flag so user returns to landing, not app-as-guest
        sessionStorage.removeItem('legoworld:entered-as-guest');
        signOut();
        closeMenu();
      } else if (action === 'my-maps') {
        closeMenu();
        openMapsDialog();
      }
    });
    // Click outside to close
    setTimeout(() => {
      document.addEventListener('click', onDocClick, { once: true });
    }, 0);
    function onDocClick(e: MouseEvent) {
      if (!menu.contains(e.target as Node)) closeMenu();
    }
    menuEl = menu;
  }

  // Subscribe to auth state. Fires immediately with the current state.
  onAuthChange(render);

  // --------------------------------------------------------------
  //  Save dialog wiring
  // --------------------------------------------------------------
  const saveBtn = document.getElementById('map-save');
  const saveDialog = document.getElementById('save-dialog');
  const saveConfirm = document.getElementById('save-confirm') as HTMLButtonElement | null;
  const titleInput = document.getElementById('save-title') as HTMLInputElement | null;
  const descInput = document.getElementById('save-desc') as HTMLTextAreaElement | null;
  const publicInput = document.getElementById('save-public') as HTMLInputElement | null;

  saveBtn?.addEventListener('click', async () => {
    if (!currentState.user) {
      alert('로그인이 필요합니다.');
      return;
    }

    // If we're actively editing a previously-saved map, overwrite it
    // silently — no dialog, just a quick thumbnail capture + update.
    const cur = getCurrentMap();
    if (cur) {
      try {
        const data = serializeMap(game);
        const thumb = await captureThumbnail();
        const saved = await saveMap({
          title: cur.title,
          description: cur.description ?? undefined,
          isPublic: cur.isPublic,
          data,
          thumbnailBlob: thumb ?? undefined,
          existingId: cur.id,
        });
        // Refresh current map ref (thumbnail URL may have changed)
        setCurrentMap({
          id: saved.id,
          title: saved.title,
          description: saved.description,
          isPublic: saved.is_public,
        });
        showToast(`"${cur.title}" 저장됨 ✓`);
      } catch (err) {
        console.error('[save] overwrite failed:', err);
        alert('저장 실패: ' + (err instanceof Error ? err.message : String(err)));
      }
      return;
    }

    // First-time save — show the dialog to collect title/description/public
    if (titleInput) titleInput.value = '';
    if (descInput) descInput.value = '';
    if (publicInput) publicInput.checked = false;
    saveDialog?.classList.remove('hidden');
    titleInput?.focus();
  });

  saveConfirm?.addEventListener('click', async () => {
    const title = titleInput?.value.trim();
    if (!title) {
      alert('제목을 입력해주세요.');
      titleInput?.focus();
      return;
    }
    saveConfirm.disabled = true;
    saveConfirm.textContent = '저장 중...';
    try {
      const data = serializeMap(game);
      const thumb = await captureThumbnail();
      const saved = await saveMap({
        title,
        description: descInput?.value.trim() || undefined,
        isPublic: !!publicInput?.checked,
        data,
        thumbnailBlob: thumb ?? undefined,
      });
      // Track this as the current map so subsequent saves overwrite
      setCurrentMap({
        id: saved.id,
        title: saved.title,
        description: saved.description,
        isPublic: saved.is_public,
      });
      saveDialog?.classList.add('hidden');
      showToast('맵이 저장되었습니다.');
    } catch (err) {
      console.error('[save] failed:', err);
      alert('저장 실패: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      saveConfirm.disabled = false;
      saveConfirm.textContent = '저장';
    }
  });

  // --------------------------------------------------------------
  //  Maps list dialog
  // --------------------------------------------------------------
  const mapListBtn = document.getElementById('map-list');
  const mapsDialog = document.getElementById('maps-dialog');
  const mapsList = document.getElementById('maps-list');

  async function openMapsDialog() {
    if (!currentState.user) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!mapsDialog || !mapsList) return;
    mapsList.innerHTML = '<div class="empty">불러오는 중...</div>';
    mapsDialog.classList.remove('hidden');
    try {
      const maps = await listMyMaps();
      renderMaps(maps);
    } catch (err) {
      console.error('[listMaps] failed:', err);
      mapsList.innerHTML =
        '<div class="empty">맵을 불러오지 못했습니다.</div>';
    }
  }

  function renderMaps(maps: SavedMap[]) {
    if (!mapsList) return;
    if (maps.length === 0) {
      mapsList.innerHTML =
        '<div class="empty">저장된 맵이 없습니다. 먼저 맵을 만들어 💾 저장 버튼으로 저장하세요.</div>';
      return;
    }
    mapsList.innerHTML = '';
    for (const m of maps) {
      const card = document.createElement('div');
      card.className = 'map-card';
      const thumb = m.thumbnail_url
        ? `<div class="map-card-thumb" style="background-image: url('${m.thumbnail_url}')"></div>`
        : `<div class="map-card-thumb placeholder"></div>`;
      card.innerHTML = `
        ${thumb}
        <div class="map-card-body">
          <div class="map-card-title">${escapeHtml(m.title)}</div>
          <div class="map-card-meta">
            <span>${m.block_count}개 블록</span>
            <span>${m.is_public ? '🌐 공개' : '🔒 비공개'}</span>
          </div>
        </div>
        <div class="map-card-actions">
          <button data-action="load">불러오기</button>
          <button data-action="delete" class="danger">삭제</button>
        </div>
      `;
      card.querySelector('[data-action="load"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const full = await loadMap(m.id);
          if (
            confirm(
              '현재 작업 중인 맵이 사라지고 저장된 맵을 불러옵니다. 계속할까요?'
            )
          ) {
            deserializeMap(game, full.data);
            // Track loaded map so subsequent saves overwrite this row
            setCurrentMap({
              id: full.id,
              title: full.title,
              description: full.description,
              isPublic: full.is_public,
            });
            mapsDialog?.classList.add('hidden');
            showToast(`"${m.title}" 불러오기 완료`);
          }
        } catch (err) {
          alert('불러오기 실패: ' + (err instanceof Error ? err.message : String(err)));
        }
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`"${m.title}"을(를) 삭제할까요?`)) return;
        try {
          await deleteMap(m.id);
          card.remove();
          if (mapsList.children.length === 0) {
            mapsList.innerHTML =
              '<div class="empty">저장된 맵이 없습니다.</div>';
          }
        } catch (err) {
          alert('삭제 실패: ' + (err instanceof Error ? err.message : String(err)));
        }
      });
      mapsList.appendChild(card);
    }
  }

  mapListBtn?.addEventListener('click', openMapsDialog);

  // Modal close buttons
  document.querySelectorAll<HTMLElement>('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.closeModal!;
      document.getElementById(id)?.classList.add('hidden');
    });
  });
  // Close on backdrop click
  document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach((b) => {
    b.addEventListener('click', (e) => {
      if (e.target === b) b.classList.add('hidden');
    });
  });
}

/** Simple toast notification at bottom of screen. */
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

/** Basic initials avatar as a data URL when the user has no avatar_url. */
function defaultAvatarDataUrl(name: string): string {
  const initial = (name.trim()[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%231c1d22"/><text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="700" fill="white" text-anchor="middle">${initial}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + svg;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}
