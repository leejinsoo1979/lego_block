// ----------------------------------------------------------------------
//  Store — paid asset browsing. Currently a mock: purchases just insert
//  a row (no real payment). Replace mockPurchaseAsset with a Stripe-backed
//  Edge Function when the store goes live.
// ----------------------------------------------------------------------

import { listAssets, listMyPurchases, mockPurchaseAsset } from './api';
import { onAuthChange, type AuthState } from './auth';
import type { Asset, Purchase } from './supabase';
import type { Game } from './game';

let currentAssets: Asset[] = [];
let myPurchases: Purchase[] = [];
let authState: AuthState = { session: null, user: null, profile: null };

// --------------------------------------------------------------------
//  Public API
// --------------------------------------------------------------------

export function showStore() {
  document.body.classList.remove('show-landing');
  document.body.classList.remove('show-dashboard');
  document.body.classList.remove('show-gallery');
  document.body.classList.remove('show-multiplayer');
  document.body.classList.add('show-store');
  document.getElementById('store')?.classList.remove('hidden');
  refreshStore();
}

export function hideStore() {
  document.body.classList.remove('show-store');
}

// Exported for symmetry with the other modules. Game is unused for now,
// but kept so future asset pickers can poke at the live scene.
export function buildStoreUI(_game: Game) {
  renderStoreShell();

  onAuthChange((s) => {
    authState = s;
  });

  document.addEventListener('goto-store', () => {
    showStore();
  });

  document.getElementById('store-back')?.addEventListener('click', () => {
    hideStore();
    document.dispatchEvent(new CustomEvent('goto-dashboard'));
  });
}

// --------------------------------------------------------------------
//  Shell
// --------------------------------------------------------------------

function renderStoreShell() {
  const el = document.getElementById('store');
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
        <h1 class="gallery-title">에셋 스토어</h1>
      </div>
      <div class="gallery-nav-tools">
        <button id="store-back" class="gallery-back-btn">← 대시보드</button>
      </div>
    </header>

    <section class="gallery-hero">
      <span class="gallery-kicker">STORE</span>
      <h2>블록 팩 &amp; 프리미엄 에셋</h2>
      <p>새로운 블록으로 더 다양한 세계를 만들어보세요</p>
    </section>

    <main class="gallery-main">
      <div id="store-owned-summary" class="store-owned-summary"></div>
      <div id="store-grid" class="store-grid">
        <div class="dash-empty">불러오는 중…</div>
      </div>
      <div class="store-demo-note">
        💡 데모 모드 — 결제 없이 바로 잠금 해제됩니다 (Stripe 연동 예정)
      </div>
    </main>
  `;
}

// --------------------------------------------------------------------
//  Grid
// --------------------------------------------------------------------

async function refreshStore() {
  const grid = document.getElementById('store-grid');
  const summary = document.getElementById('store-owned-summary');
  if (!grid || !summary) return;

  grid.innerHTML = '<div class="dash-empty">불러오는 중…</div>';

  try {
    [currentAssets, myPurchases] = await Promise.all([
      listAssets(),
      listMyPurchases().catch(() => [] as Purchase[]),
    ]);
  } catch (err) {
    console.error('[store] load failed:', err);
    alert('스토어를 불러오지 못했습니다.');
    grid.innerHTML = '<div class="dash-empty">스토어를 불러오지 못했습니다.</div>';
    return;
  }

  renderSummary();
  renderGrid();
}

function renderSummary() {
  const summary = document.getElementById('store-owned-summary');
  if (!summary) return;
  summary.innerHTML = `
    <div class="store-owned-card">
      <span class="store-owned-icon">🎒</span>
      <div>
        <div class="store-owned-label">내 보유 에셋</div>
        <div class="store-owned-count">${myPurchases.length}개</div>
      </div>
    </div>
  `;
}

function renderGrid() {
  const grid = document.getElementById('store-grid');
  if (!grid) return;
  if (currentAssets.length === 0) {
    grid.innerHTML = '<div class="dash-empty">판매 중인 에셋이 없어요.</div>';
    return;
  }

  const ownedIds = new Set(myPurchases.map((p) => p.asset_id));

  grid.innerHTML = '';
  for (const asset of currentAssets) {
    const card = document.createElement('div');
    card.className = 'store-card';
    const owned = ownedIds.has(asset.id);
    const priceLabel = formatPriceKRW(asset.price_cents);

    card.innerHTML = `
      <div class="store-card-preview">
        <span class="store-card-emoji">${escapeHtml(asset.preview_emoji || '🎁')}</span>
        <span class="store-card-kind">${asset.kind === 'pack' ? '팩' : '단품'}</span>
      </div>
      <div class="store-card-body">
        <div class="store-card-name">${escapeHtml(asset.name)}</div>
        <div class="store-card-desc">${escapeHtml(asset.description || '')}</div>
      </div>
      <div class="store-card-footer">
        <div class="store-card-price">${priceLabel}</div>
        <button class="store-buy-btn ${owned ? 'owned' : ''}" ${owned ? 'disabled' : ''}>
          ${owned ? '✓ 보유 중' : '구매'}
        </button>
      </div>
    `;

    const btn = card.querySelector('.store-buy-btn') as HTMLButtonElement | null;
    if (btn && !owned) {
      btn.addEventListener('click', () => handlePurchase(asset));
    }

    grid.appendChild(card);
  }
}

async function handlePurchase(asset: Asset) {
  if (!authState.user) {
    alert('구매는 로그인 후 이용할 수 있어요.');
    return;
  }
  const confirmMsg = `"${asset.name}"을(를) 구매하시겠어요?\n\n💡 데모 모드이므로 실제 결제는 발생하지 않습니다.`;
  if (!confirm(confirmMsg)) return;
  try {
    await mockPurchaseAsset(asset);
    showToast('구매 완료! 🎉');
    await refreshStore();
  } catch (err) {
    console.error('[store] purchase failed:', err);
    alert('구매 처리에 실패했습니다: ' + (err instanceof Error ? err.message : String(err)));
  }
}

// --------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------

// Assume 1 cent = 10 won per the spec — so price_cents * 10 = won.
function formatPriceKRW(cents: number): string {
  const won = cents * 10;
  return won.toLocaleString('ko-KR') + '원';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
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
