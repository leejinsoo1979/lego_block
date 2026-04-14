// ----------------------------------------------------------------------
//  Gallery — public map browsing. Grid of maps with search, sort, and
//  a detail modal showing likes, comments, follow, and an "open in
//  builder" view-only action.
// ----------------------------------------------------------------------

import {
  addComment,
  deleteComment,
  follow,
  getMap,
  hasLiked,
  isFollowing,
  likeMap,
  listComments,
  listPublicMaps,
  unfollow,
  unlikeMap,
  type GallerySort,
} from './api';
import { onAuthChange, type AuthState } from './auth';
import { deserializeMap } from './mapStorage';
import type { Game } from './game';
import type { MapComment, Profile, SavedMap } from './supabase';

type MapRow = SavedMap & {
  author: Pick<Profile, 'display_name' | 'avatar_url'> | null;
};

let gameRef: Game | null = null;
let currentMaps: MapRow[] = [];
let currentSort: GallerySort = 'popular';
let currentSearch = '';
let searchDebounce: number | null = null;
let likedSet: Set<string> = new Set();
let authState: AuthState = { session: null, user: null, profile: null };
let detailMapId: string | null = null;

// --------------------------------------------------------------------
//  Public API
// --------------------------------------------------------------------

export function showGallery() {
  document.body.classList.remove('show-landing');
  document.body.classList.remove('show-dashboard');
  document.body.classList.remove('show-store');
  document.body.classList.remove('show-multiplayer');
  document.body.classList.add('show-gallery');
  document.getElementById('gallery')?.classList.remove('hidden');
  refreshGallery();
}

export function hideGallery() {
  document.body.classList.remove('show-gallery');
}

export function buildGalleryUI(game: Game) {
  gameRef = game;

  // Render once so event wiring below finds the DOM.
  renderGalleryShell();

  onAuthChange((s) => {
    authState = s;
  });

  document.addEventListener('goto-gallery', () => {
    showGallery();
  });

  // Search
  const searchInput = document.getElementById('gallery-search') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    if (searchDebounce) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
      currentSearch = searchInput.value.trim();
      refreshGallery();
    }, 300);
  });

  // Sort dropdown
  const sortSel = document.getElementById('gallery-sort') as HTMLSelectElement | null;
  sortSel?.addEventListener('change', () => {
    currentSort = (sortSel.value as GallerySort) || 'popular';
    refreshGallery();
  });

  // Back to dashboard
  document.getElementById('gallery-back')?.addEventListener('click', () => {
    hideGallery();
    document.dispatchEvent(new CustomEvent('goto-dashboard'));
  });

  // Modal close
  document.getElementById('gallery-detail-close')?.addEventListener('click', () => {
    closeDetail();
  });
  document.getElementById('gallery-detail')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'gallery-detail') closeDetail();
  });
}

// --------------------------------------------------------------------
//  Shell — a one-shot render that fills the #gallery container
// --------------------------------------------------------------------

function renderGalleryShell() {
  const el = document.getElementById('gallery');
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
        <h1 class="gallery-title">갤러리</h1>
      </div>
      <div class="gallery-nav-tools">
        <div class="gallery-search-wrap">
          <span class="gallery-search-icon">🔍</span>
          <input
            id="gallery-search"
            type="text"
            class="gallery-search"
            placeholder="맵 제목 검색…"
            maxlength="80"
          />
        </div>
        <select id="gallery-sort" class="gallery-sort">
          <option value="popular">🔥 인기순</option>
          <option value="recent">✨ 최신순</option>
        </select>
        <button id="gallery-back" class="gallery-back-btn">← 대시보드</button>
      </div>
    </header>

    <section class="gallery-hero">
      <span class="gallery-kicker">COMMUNITY</span>
      <h2>세계의 창작</h2>
      <p>수천 개의 맵을 탐험하세요</p>
    </section>

    <main class="gallery-main">
      <div id="gallery-grid" class="gallery-grid">
        <div class="dash-empty">불러오는 중…</div>
      </div>
    </main>

    <div id="gallery-detail" class="modal-backdrop hidden">
      <div class="modal gallery-detail-modal">
        <button id="gallery-detail-close" class="modal-close gallery-detail-close">✕</button>
        <div id="gallery-detail-body" class="gallery-detail-body"></div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------
//  Grid
// --------------------------------------------------------------------

async function refreshGallery() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="dash-empty">불러오는 중…</div>';

  try {
    currentMaps = (await listPublicMaps({
      sort: currentSort,
      search: currentSearch || undefined,
    })) as MapRow[];
  } catch (err) {
    console.error('[gallery] listPublicMaps failed:', err);
    alert('갤러리를 불러오지 못했습니다.');
    grid.innerHTML = '<div class="dash-empty">맵을 불러오지 못했습니다.</div>';
    return;
  }

  // Refresh liked set for the current user (only if signed in).
  likedSet = new Set();
  if (authState.user) {
    await Promise.all(
      currentMaps.map(async (m) => {
        try {
          const liked = await hasLiked(m.id);
          if (liked) likedSet.add(m.id);
        } catch {
          /* ignore */
        }
      })
    );
  }

  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  if (currentMaps.length === 0) {
    grid.innerHTML = `
      <div class="dash-empty">
        ${
          currentSearch
            ? `"${escapeHtml(currentSearch)}" 검색 결과가 없어요.`
            : '아직 공개된 맵이 없어요.<br/>첫 공개 맵을 만들어보세요 ✨'
        }
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  for (const m of currentMaps) {
    const card = document.createElement('div');
    card.className = 'gallery-card';

    const authorName = m.author?.display_name || '익명';
    const authorAvatar =
      m.author?.avatar_url || defaultAvatarDataUrl(authorName);
    const liked = likedSet.has(m.id);
    const thumb = m.thumbnail_url
      ? `<div class="gallery-card-thumb" style="background-image:url('${escapeAttr(m.thumbnail_url)}')"></div>`
      : `<div class="gallery-card-thumb placeholder"></div>`;

    card.innerHTML = `
      ${thumb}
      <div class="gallery-card-body">
        <div class="gallery-card-title">${escapeHtml(m.title)}</div>
        <div class="gallery-card-author">
          <img src="${escapeAttr(authorAvatar)}" alt="${escapeAttr(authorName)}" class="gallery-avatar-sm" />
          <span>${escapeHtml(authorName)}</span>
        </div>
        <div class="gallery-card-meta">
          <button class="gallery-like ${liked ? 'liked' : ''}" data-action="like" title="좋아요">
            <span class="gallery-like-icon">${liked ? '❤️' : '🤍'}</span>
            <span class="gallery-like-count">${m.like_count}</span>
          </button>
          <span class="gallery-card-blocks">🧱 ${m.block_count}</span>
        </div>
      </div>
    `;

    // Click body/thumb opens detail
    card
      .querySelector('.gallery-card-thumb')
      ?.addEventListener('click', () => openDetail(m.id));
    card
      .querySelector('.gallery-card-title')
      ?.addEventListener('click', () => openDetail(m.id));
    card
      .querySelector('.gallery-card-author')
      ?.addEventListener('click', () => openDetail(m.id));

    // Like button
    card.querySelector('[data-action="like"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await handleLike(m);
    });

    grid.appendChild(card);
  }
}

async function handleLike(m: MapRow) {
  if (!authState.user) {
    alert('좋아요는 로그인 후 이용할 수 있어요.');
    return;
  }
  const wasLiked = likedSet.has(m.id);
  // Optimistic toggle
  if (wasLiked) {
    likedSet.delete(m.id);
    m.like_count = Math.max(0, m.like_count - 1);
  } else {
    likedSet.add(m.id);
    m.like_count += 1;
  }
  renderGrid();
  // If modal open for this map, re-render it too
  if (detailMapId === m.id) renderDetail();

  try {
    if (wasLiked) {
      await unlikeMap(m.id);
    } else {
      await likeMap(m.id);
    }
  } catch (err) {
    console.error('[gallery] like failed:', err);
    // Revert
    if (wasLiked) {
      likedSet.add(m.id);
      m.like_count += 1;
    } else {
      likedSet.delete(m.id);
      m.like_count = Math.max(0, m.like_count - 1);
    }
    renderGrid();
    alert('좋아요 처리에 실패했습니다.');
  }
}

// --------------------------------------------------------------------
//  Detail modal
// --------------------------------------------------------------------

let detailMap: SavedMap | null = null;
let detailAuthor: Profile | null = null;
let detailFollowing = false;
let detailComments: MapComment[] = [];

async function openDetail(mapId: string) {
  detailMapId = mapId;
  detailMap = null;
  detailAuthor = null;
  detailComments = [];
  detailFollowing = false;

  const modal = document.getElementById('gallery-detail');
  const body = document.getElementById('gallery-detail-body');
  if (!modal || !body) return;
  body.innerHTML = '<div class="dash-empty">불러오는 중…</div>';
  modal.classList.remove('hidden');

  try {
    detailMap = await getMap(mapId);
    const [comments, fol] = await Promise.all([
      listComments(mapId).catch(() => [] as MapComment[]),
      authState.user && authState.user.id !== detailMap.owner_id
        ? isFollowing(detailMap.owner_id).catch(() => false)
        : Promise.resolve(false),
    ]);
    detailComments = comments;
    detailFollowing = !!fol;

    // Fetch author profile from cached row if available
    const cached = currentMaps.find((m) => m.id === mapId);
    if (cached?.author) {
      detailAuthor = {
        id: detailMap.owner_id,
        display_name: cached.author.display_name,
        avatar_url: cached.author.avatar_url,
        created_at: '',
        updated_at: '',
      };
    }
  } catch (err) {
    console.error('[gallery] openDetail failed:', err);
    alert('맵을 불러오지 못했습니다.');
    body.innerHTML = '<div class="dash-empty">맵을 불러오지 못했습니다.</div>';
    return;
  }

  renderDetail();
}

function closeDetail() {
  detailMapId = null;
  document.getElementById('gallery-detail')?.classList.add('hidden');
}

function renderDetail() {
  const body = document.getElementById('gallery-detail-body');
  if (!body || !detailMap) return;
  const m = detailMap;
  const liked = likedSet.has(m.id);
  const authorName = detailAuthor?.display_name || '익명';
  const authorAvatar = detailAuthor?.avatar_url || defaultAvatarDataUrl(authorName);
  const isOwn = !!authState.user && authState.user.id === m.owner_id;

  const hero = m.thumbnail_url
    ? `<div class="gallery-detail-hero" style="background-image:url('${escapeAttr(m.thumbnail_url)}')"></div>`
    : `<div class="gallery-detail-hero placeholder"></div>`;

  const followBtn = !isOwn && authState.user
    ? `<button class="gallery-follow ${detailFollowing ? 'following' : ''}" data-action="follow">
         ${detailFollowing ? '✓ 팔로잉' : '+ 팔로우'}
       </button>`
    : '';

  body.innerHTML = `
    ${hero}
    <div class="gallery-detail-content">
      <h2 class="gallery-detail-title">${escapeHtml(m.title)}</h2>

      <div class="gallery-detail-author-row">
        <img src="${escapeAttr(authorAvatar)}" class="gallery-avatar-md" alt="${escapeAttr(authorName)}" />
        <div class="gallery-detail-author-info">
          <div class="gallery-detail-author-name">${escapeHtml(authorName)}</div>
          <div class="gallery-detail-author-sub">${m.block_count} 블록 · ${formatRelativeDate(m.created_at)}</div>
        </div>
        ${followBtn}
      </div>

      ${m.description ? `<p class="gallery-detail-desc">${escapeHtml(m.description)}</p>` : ''}

      <div class="gallery-detail-actions">
        <button class="gallery-like-big ${liked ? 'liked' : ''}" data-action="like">
          <span class="gallery-like-icon">${liked ? '❤️' : '🤍'}</span>
          <span>${m.like_count} 좋아요</span>
        </button>
        <button class="gallery-open-btn" data-action="open-map">🧱 맵 열어서 둘러보기</button>
      </div>

      <div class="gallery-comments">
        <h3 class="gallery-comments-title">댓글 ${detailComments.length}</h3>
        ${renderCommentsSection()}
      </div>
    </div>
  `;

  // Wire actions
  body.querySelector('[data-action="like"]')?.addEventListener('click', async () => {
    // Mirror grid logic
    const row = currentMaps.find((x) => x.id === m.id);
    if (row) {
      await handleLike(row);
    } else {
      // Cached row may not exist (direct open) — do a local toggle
      if (!authState.user) {
        alert('좋아요는 로그인 후 이용할 수 있어요.');
        return;
      }
      const wasLiked = likedSet.has(m.id);
      try {
        if (wasLiked) {
          await unlikeMap(m.id);
          likedSet.delete(m.id);
          m.like_count = Math.max(0, m.like_count - 1);
        } else {
          await likeMap(m.id);
          likedSet.add(m.id);
          m.like_count += 1;
        }
        renderDetail();
      } catch (err) {
        console.error('[gallery] like failed:', err);
        alert('좋아요 처리에 실패했습니다.');
      }
    }
  });

  body.querySelector('[data-action="follow"]')?.addEventListener('click', async () => {
    if (!authState.user || !detailMap) return;
    try {
      if (detailFollowing) {
        await unfollow(detailMap.owner_id);
        detailFollowing = false;
      } else {
        await follow(detailMap.owner_id);
        detailFollowing = true;
      }
      renderDetail();
    } catch (err) {
      console.error('[gallery] follow failed:', err);
      alert('팔로우 처리에 실패했습니다.');
    }
  });

  body.querySelector('[data-action="open-map"]')?.addEventListener('click', () => {
    if (!gameRef || !detailMap) return;
    try {
      deserializeMap(gameRef, detailMap.data);
      closeDetail();
      hideGallery();
      // Don't call setCurrentMap — user is viewing, not editing.
    } catch (err) {
      console.error('[gallery] open map failed:', err);
      alert('맵을 여는 데 실패했습니다.');
    }
  });

  wireCommentForm();
}

function renderCommentsSection(): string {
  const list = detailComments
    .map((c) => {
      const name = c.author?.display_name || '익명';
      const avatar = c.author?.avatar_url || defaultAvatarDataUrl(name);
      const canDelete = !!authState.user && authState.user.id === c.user_id;
      return `
        <div class="gallery-comment" data-id="${c.id}">
          <img src="${escapeAttr(avatar)}" class="gallery-avatar-sm" alt="${escapeAttr(name)}" />
          <div class="gallery-comment-body">
            <div class="gallery-comment-head">
              <span class="gallery-comment-name">${escapeHtml(name)}</span>
              <span class="gallery-comment-time">${formatRelativeDate(c.created_at)}</span>
              ${canDelete ? `<button class="gallery-comment-del" data-action="del-comment" data-id="${c.id}">삭제</button>` : ''}
            </div>
            <div class="gallery-comment-text">${escapeHtml(c.body)}</div>
          </div>
        </div>
      `;
    })
    .join('');

  const listHtml = detailComments.length
    ? `<div class="gallery-comments-list">${list}</div>`
    : `<div class="gallery-comments-empty">아직 댓글이 없어요. 첫 댓글을 남겨보세요!</div>`;

  const form = authState.user
    ? `
      <form class="gallery-comment-form" id="gallery-comment-form">
        <input type="text" id="gallery-comment-input" class="form-input" placeholder="댓글을 남겨보세요…" maxlength="500" />
        <button type="submit" class="modal-btn-primary">등록</button>
      </form>
    `
    : `<div class="gallery-comments-signin">댓글을 남기려면 로그인하세요.</div>`;

  return listHtml + form;
}

function wireCommentForm() {
  const form = document.getElementById('gallery-comment-form') as HTMLFormElement | null;
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!detailMap) return;
      const input = document.getElementById('gallery-comment-input') as HTMLInputElement | null;
      const body = input?.value.trim();
      if (!body) return;
      try {
        const created = await addComment(detailMap.id, body);
        // Re-hydrate author on the local comment (addComment returns raw row)
        detailComments.push({
          ...created,
          author: authState.profile
            ? {
                display_name: authState.profile.display_name,
                avatar_url: authState.profile.avatar_url,
              }
            : null,
        });
        if (input) input.value = '';
        renderDetail();
      } catch (err) {
        console.error('[gallery] addComment failed:', err);
        alert('댓글 등록에 실패했습니다.');
      }
    });
  }

  // Delete handlers
  document
    .querySelectorAll<HTMLButtonElement>('.gallery-comment-del[data-action="del-comment"]')
    .forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (!confirm('댓글을 삭제할까요?')) return;
        try {
          await deleteComment(id);
          detailComments = detailComments.filter((c) => c.id !== id);
          renderDetail();
        } catch (err) {
          console.error('[gallery] deleteComment failed:', err);
          alert('댓글 삭제에 실패했습니다.');
        }
      });
    });
}

// --------------------------------------------------------------------
//  Helpers (duplicated from dashboard to keep modules independent)
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
