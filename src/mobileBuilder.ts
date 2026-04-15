// ----------------------------------------------------------------------
//  Mobile builder UI — bottom sheet, hotbar, radial menu, FAB.
//
//  Replaces the entire desktop sidebar + icon-bar experience on mobile.
//  Activated automatically when body has `.is-mobile`. The existing
//  desktop UI still initializes (and syncs state with the Game object),
//  but it's hidden by CSS and never receives touches.
//
//  Components:
//   - Mobile top bar (avatar, title, home)
//   - FAB cluster (save, play, dashboard) bottom-right
//   - Hotbar: Minecraft PE-style row of 9 blocks, swipe to cycle
//   - Bottom sheet: drag up to reveal full category/color picker
//   - Radial menu: long-press a color swatch to open a thumb-reachable
//     arc for size + rotation
// ----------------------------------------------------------------------

import {
  BLOCK_TYPES,
  CATEGORIES,
  COLORS,
  MINIFIG_PRESETS,
  SIZES,
} from './config';
import type { BlockCategory, BlockType, ColorDef, SizeDef } from './config';
import { renderBlockTypeThumbnail, renderMinifigPresetThumbnail } from './thumbnails';
import type { Game, Mode } from './game';
import { haptic, isMobile } from './mobile';

const THUMBNAIL_COLOR = 0xd4534a;

// --------------------------------------------------------------------
//  Entry point
// --------------------------------------------------------------------

export function buildMobileBuilderUI(game: Game): void {
  if (!isMobile()) return;

  // Host element — appended once, survives route changes via CSS
  // visibility rules tied to body classes.
  const host = document.createElement('div');
  host.id = 'mobile-builder';
  host.className = 'mb-host';
  host.innerHTML = shellMarkup();
  document.body.appendChild(host);

  wireTopBar(game);
  wireFAB(game);
  wireHotbar(game);
  wireBottomSheet(game);
  wireModeToggle(game);
  wireQuickActions(game);
  wireDPad(game);
  syncFromGame(game);
}

// --------------------------------------------------------------------
//  D-pad — nudges the placement ghost; center places
// --------------------------------------------------------------------

function wireDPad(game: Game): void {
  document.querySelectorAll<HTMLButtonElement>('.mb-dpad-btn').forEach((btn) => {
    const dir = btn.dataset.dir as
      | 'up'
      | 'down'
      | 'left'
      | 'right'
      | 'rotate'
      | undefined;
    if (!dir) return;

    // Tap = single action. Hold = repeat every 140ms for direction
    // buttons (lets the user scrub the ghost across the board).
    let holdTimer: number | null = null;
    const fire = () => {
      if (dir === 'rotate') {
        haptic('rotate');
        game.rotateClockwise();
      } else {
        const moved = game.nudgeGhost(dir);
        haptic(moved ? 'tap' : 'error');
      }
    };

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fire();
      // Direction buttons repeat on hold; rotate fires once per tap.
      if (dir !== 'rotate') {
        holdTimer = window.setInterval(fire, 140);
      }
    });
    const stop = () => {
      if (holdTimer != null) {
        clearInterval(holdTimer);
        holdTimer = null;
      }
    };
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  });

  // Hide D-pad in remove mode (arrows don't do anything there) + in
  // play mode (the player controls replace it).
  const apply = () => {
    const dpad = document.querySelector<HTMLElement>('.mb-dpad');
    if (!dpad) return;
    const hidden = game.mode === 'remove' || game.isPlaying;
    dpad.style.display = hidden ? 'none' : '';
  };
  const prevMode = game.onModeChange;
  game.onModeChange = (m) => {
    prevMode?.(m);
    apply();
  };
  const prevPlay = game.onPlayChange;
  game.onPlayChange = (p) => {
    prevPlay?.(p);
    apply();
  };
  apply();
}

// --------------------------------------------------------------------
//  Shell markup
// --------------------------------------------------------------------

function shellMarkup(): string {
  return `
    <!-- Top bar: home button, mode segmented control, help button -->
    <header class="mb-topbar" role="toolbar" aria-label="상단 도구모음">
      <button class="mb-top-btn" id="mb-home" aria-label="대시보드로" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12L12 3l9 9"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>
        </svg>
      </button>
      <!-- Mode chips moved INSIDE the top bar so they never overlap
           with the bottom-right FAB cluster on small screens. -->
      <div class="mb-mode-chips" role="radiogroup" aria-label="모드">
        <button class="mb-mode-chip is-active" data-mode="place" type="button" role="radio" aria-checked="true">설치</button>
        <button class="mb-mode-chip" data-mode="remove" type="button" role="radio" aria-checked="false">제거</button>
      </div>
      <button class="mb-top-btn" id="mb-help" aria-label="도움말" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/>
          <circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none"/>
        </svg>
      </button>
    </header>

    <!-- Quick action bar: rotate / undo — upper-left, above the D-pad -->
    <nav class="mb-quick-actions safe-bottom" aria-label="빠른 동작">
      <button class="mb-qa-btn" data-action="rotate" aria-label="회전" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>
        </svg>
        <span id="mb-rot-label">0°</span>
      </button>
      <button class="mb-qa-btn" data-action="undo" aria-label="실행 취소" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>
        </svg>
      </button>
    </nav>

    <!-- D-pad — nudges the placement ghost one footprint at a time.
         Center button ROTATES the ghost (tap-to-rotate shortcut; the
         user places by tapping the canvas instead). Left-bottom. -->
    <div class="mb-dpad safe-bottom" role="group" aria-label="고스트 이동">
      <button class="mb-dpad-btn mb-dpad-up" data-dir="up" aria-label="위" type="button">▲</button>
      <button class="mb-dpad-btn mb-dpad-left" data-dir="left" aria-label="왼쪽" type="button">◀</button>
      <button class="mb-dpad-btn mb-dpad-rotate" data-dir="rotate" aria-label="회전" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>
        </svg>
      </button>
      <button class="mb-dpad-btn mb-dpad-right" data-dir="right" aria-label="오른쪽" type="button">▶</button>
      <button class="mb-dpad-btn mb-dpad-down" data-dir="down" aria-label="아래" type="button">▼</button>
    </div>

    <!-- FAB cluster: save / play / (expanded) — bottom-right, safe-area -->
    <div class="mb-fab-cluster safe-bottom" role="toolbar" aria-label="주요 동작">
      <button class="mb-fab mb-fab-save" id="mb-save" aria-label="저장" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
      </button>
      <button class="mb-fab mb-fab-play" id="mb-play" aria-label="플레이" type="button">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5L8 5.5z"/></svg>
      </button>
    </div>

    <!-- Hotbar: 9 quick-access block slots, scrollable horizontally -->
    <nav class="mb-hotbar safe-bottom" role="tablist" aria-label="빠른 블록 선택">
      <div class="mb-hotbar-track" id="mb-hotbar-track"></div>
      <button class="mb-hotbar-expand" id="mb-hotbar-expand" aria-label="전체 블록 라이브러리 열기" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
    </nav>

    <!-- Bottom sheet: full library + properties -->
    <section class="mb-sheet" id="mb-sheet" aria-hidden="true">
      <div class="mb-sheet-handle" id="mb-sheet-handle" aria-label="끌어서 열고 닫기">
        <div class="mb-sheet-grip"></div>
      </div>
      <div class="mb-sheet-body safe-bottom">
        <nav class="mb-sheet-tabs" id="mb-sheet-tabs" role="tablist"></nav>
        <div class="mb-sheet-grid" id="mb-sheet-grid" role="tabpanel"></div>
        <div class="mb-sheet-section">
          <label class="mb-sheet-label">색상</label>
          <div class="mb-sheet-colors" id="mb-sheet-colors"></div>
        </div>
        <div class="mb-sheet-section" id="mb-sheet-sizes-wrap">
          <label class="mb-sheet-label">크기</label>
          <div class="mb-sheet-sizes" id="mb-sheet-sizes"></div>
        </div>
      </div>
    </section>
  `;
}

// --------------------------------------------------------------------
//  Top bar
// --------------------------------------------------------------------

function wireTopBar(_game: Game): void {
  document.getElementById('mb-home')?.addEventListener('click', () => {
    haptic('tap');
    document.dispatchEvent(new CustomEvent('goto-dashboard'));
  });
  document.getElementById('mb-help')?.addEventListener('click', () => {
    haptic('tap');
    // Open the desktop help popover — it's already in the DOM and
    // CSS keeps it positioned; we just toggle hidden.
    const helpPopover = document.getElementById('help-popover');
    helpPopover?.classList.toggle('hidden');
  });
}

// --------------------------------------------------------------------
//  Mode toggle
// --------------------------------------------------------------------

function wireModeToggle(game: Game): void {
  const apply = (mode: Mode) => {
    document.querySelectorAll<HTMLButtonElement>('.mb-mode-chip').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
    document.body.classList.toggle('mb-remove-mode', mode === 'remove');
  };
  document.querySelectorAll<HTMLButtonElement>('.mb-mode-chip').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.dataset.mode as Mode;
      haptic('tap');
      game.setMode(m);
    });
  });
  const prev = game.onModeChange;
  game.onModeChange = (m) => {
    prev?.(m);
    apply(m);
  };
  apply(game.mode);
}

// --------------------------------------------------------------------
//  FAB — save, play
// --------------------------------------------------------------------

function wireFAB(game: Game): void {
  const saveBtn = document.getElementById('mb-save');
  const playBtn = document.getElementById('mb-play');

  saveBtn?.addEventListener('click', () => {
    haptic('tap');
    // Dispatch to the existing desktop save flow — it handles the
    // logged-in vs logged-out branch and overwrite-vs-new decision.
    document.getElementById('iconbar-save')?.click();
  });

  playBtn?.addEventListener('click', () => {
    haptic('tap');
    if (game.isPlaying) game.stopPlay();
    else game.startPlay();
  });

  // Keep the play button's icon in sync with state
  const prev = game.onPlayChange;
  game.onPlayChange = (playing) => {
    prev?.(playing);
    if (playBtn) {
      playBtn.classList.toggle('playing', playing);
      playBtn.innerHTML = playing
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5L8 5.5z"/></svg>';
    }
  };
}

// --------------------------------------------------------------------
//  Quick actions — rotate, undo
// --------------------------------------------------------------------

function wireQuickActions(game: Game): void {
  const rotateBtn = document.querySelector<HTMLButtonElement>(
    '.mb-qa-btn[data-action="rotate"]'
  );
  const rotLabel = document.getElementById('mb-rot-label');
  const undoBtn = document.querySelector<HTMLButtonElement>(
    '.mb-qa-btn[data-action="undo"]'
  );

  rotateBtn?.addEventListener('click', () => {
    haptic('rotate');
    game.rotateClockwise();
  });
  const prev = game.onRotationChange;
  game.onRotationChange = (step) => {
    prev?.(step);
    if (rotLabel) rotLabel.textContent = `${step * 90}°`;
    rotateBtn?.classList.toggle('is-rotated', step !== 0);
  };

  // Undo — placeholder: triggers the existing desktop clear flow
  undoBtn?.addEventListener('click', () => {
    haptic('tap');
    // TODO: wire to real undo stack. For now, dispatch a custom event
    // that future history code will pick up.
    document.dispatchEvent(new CustomEvent('mb-undo'));
  });
}

// --------------------------------------------------------------------
//  Hotbar — 9-slot quick-access row
// --------------------------------------------------------------------

/** Default hotbar seed — a curated mix the user can replace anytime. */
const DEFAULT_HOTBAR: BlockType[] = [
  'brick',
  'plate',
  'tile',
  'slope',
  'window',
  'door',
  'tree',
  'lamp',
  'minifig',
];

let hotbarSlots: (BlockType | null)[] = [...DEFAULT_HOTBAR];
let hotbarActiveIdx = 0;

function wireHotbar(game: Game): void {
  const track = document.getElementById('mb-hotbar-track');
  const expand = document.getElementById('mb-hotbar-expand');
  if (!track || !expand) return;

  // Persist hotbar between sessions
  try {
    const saved = localStorage.getItem('legoworld:hotbar');
    if (saved) {
      const arr = JSON.parse(saved) as BlockType[];
      if (Array.isArray(arr) && arr.length === 9) hotbarSlots = arr;
    }
  } catch {}

  const render = () => {
    track.innerHTML = '';
    hotbarSlots.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.className = 'mb-hot-slot';
      btn.classList.toggle('is-active', i === hotbarActiveIdx);
      btn.dataset.slot = String(i);
      btn.type = 'button';
      btn.setAttribute('aria-label', `슬롯 ${i + 1}`);
      if (t) {
        const img = document.createElement('img');
        img.alt = '';
        try {
          img.src =
            t === 'minifig'
              ? renderMinifigPresetThumbnail(MINIFIG_PRESETS[0])
              : renderBlockTypeThumbnail(t, THUMBNAIL_COLOR);
        } catch {}
        btn.appendChild(img);
      } else {
        btn.classList.add('is-empty');
        btn.textContent = '＋';
      }
      btn.addEventListener('click', () => {
        hotbarActiveIdx = i;
        haptic('tap');
        if (t) {
          game.setBlockType(t);
          if (t === 'minifig') game.setCharacter(MINIFIG_PRESETS[0]);
        } else {
          // Empty slot — open the sheet so user can pick something
          openSheet();
        }
        render();
      });
      // Long-press a slot to replace it with the current block type
      wireLongPress(btn, () => {
        haptic('success');
        hotbarSlots[i] = game.blockType;
        try {
          localStorage.setItem('legoworld:hotbar', JSON.stringify(hotbarSlots));
        } catch {}
        render();
      });
      track.appendChild(btn);
    });
  };
  render();

  // Expand arrow toggles the bottom sheet
  expand.addEventListener('click', () => {
    haptic('tap');
    toggleSheet();
  });

  // Keep active slot in sync when user picks from sheet
  const prev = game.onBlockTypeChange;
  game.onBlockTypeChange = (type) => {
    prev?.(type);
    // If the new type matches a slot, highlight it. Otherwise clear.
    const i = hotbarSlots.findIndex((t) => t === type);
    hotbarActiveIdx = i;
    render();
  };
}

// --------------------------------------------------------------------
//  Bottom sheet — full library
// --------------------------------------------------------------------

type SheetState = 'closed' | 'peek' | 'open';
let sheetState: SheetState = 'closed';
let sheetActiveCategory: BlockCategory = 'basic';

function wireBottomSheet(game: Game): void {
  const sheet = document.getElementById('mb-sheet');
  const handle = document.getElementById('mb-sheet-handle');
  const tabs = document.getElementById('mb-sheet-tabs');
  const grid = document.getElementById('mb-sheet-grid');
  const colors = document.getElementById('mb-sheet-colors');
  const sizesWrap = document.getElementById('mb-sheet-sizes-wrap');
  const sizes = document.getElementById('mb-sheet-sizes');
  if (!sheet || !handle || !tabs || !grid || !colors || !sizes || !sizesWrap) return;

  // --- Drag to open/close ---
  let dragStartY = 0;
  let dragStartHeight = 0;
  let dragging = false;

  const setHeight = (h: number) => {
    const max = window.innerHeight * 0.85;
    const min = 0;
    const clamped = Math.max(min, Math.min(max, h));
    sheet.style.height = `${clamped}px`;
  };
  const snap = () => {
    const h = sheet.getBoundingClientRect().height;
    const peek = window.innerHeight * 0.45;
    const open = window.innerHeight * 0.85;
    const thresh1 = peek * 0.5;
    const thresh2 = (peek + open) / 2;
    if (h < thresh1) {
      sheetState = 'closed';
      sheet.style.height = '';
    } else if (h < thresh2) {
      sheetState = 'peek';
      sheet.style.height = `${peek}px`;
    } else {
      sheetState = 'open';
      sheet.style.height = `${open}px`;
    }
    sheet.dataset.state = sheetState;
    sheet.setAttribute('aria-hidden', sheetState === 'closed' ? 'true' : 'false');
  };

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartY = e.clientY;
    dragStartHeight = sheet.getBoundingClientRect().height;
    (handle as HTMLElement).setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = dragStartY - e.clientY;
    setHeight(dragStartHeight + dy);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    snap();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  // Tap the handle to cycle: closed → peek → open → closed
  let tapArmed = false;
  let tapStartY = 0;
  handle.addEventListener('pointerdown', (e) => {
    tapArmed = true;
    tapStartY = e.clientY;
  });
  handle.addEventListener('pointerup', (e) => {
    if (!tapArmed) return;
    const dy = Math.abs(e.clientY - tapStartY);
    tapArmed = false;
    if (dy < 5) {
      haptic('tap');
      if (sheetState === 'closed') openSheet('peek');
      else if (sheetState === 'peek') openSheet('open');
      else closeSheet();
    }
  });

  // --- Category tabs ---
  const renderTabs = () => {
    tabs.innerHTML = '';
    for (const cat of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'mb-sheet-tab';
      b.classList.toggle('is-active', cat.id === sheetActiveCategory);
      b.textContent = cat.label;
      b.type = 'button';
      b.addEventListener('click', () => {
        haptic('tap');
        sheetActiveCategory = cat.id;
        renderTabs();
        renderGrid();
      });
      tabs.appendChild(b);
    }
  };
  renderTabs();

  // --- Block grid ---
  const renderGrid = () => {
    grid.innerHTML = '';
    const types = BLOCK_TYPES.filter((t) => t.category === sheetActiveCategory);
    for (const t of types) {
      const b = document.createElement('button');
      b.className = 'mb-sheet-item';
      b.classList.toggle('is-active', t.type === game.blockType);
      b.type = 'button';
      try {
        const img = document.createElement('img');
        img.alt = t.label;
        img.src = renderBlockTypeThumbnail(t.type, THUMBNAIL_COLOR);
        b.appendChild(img);
      } catch {}
      const span = document.createElement('span');
      span.textContent = t.label;
      b.appendChild(span);
      b.addEventListener('click', () => {
        haptic('tap');
        game.setBlockType(t.type);
      });
      grid.appendChild(b);
    }
    // Character tab — append minifig presets too
    if (sheetActiveCategory === 'character') {
      for (const p of MINIFIG_PRESETS) {
        const b = document.createElement('button');
        b.className = 'mb-sheet-item';
        b.type = 'button';
        try {
          const img = document.createElement('img');
          img.alt = p.name;
          img.src = renderMinifigPresetThumbnail(p);
          b.appendChild(img);
        } catch {}
        const span = document.createElement('span');
        span.textContent = p.name;
        b.appendChild(span);
        b.addEventListener('click', () => {
          haptic('tap');
          game.setBlockType('minifig');
          game.setCharacter(p);
        });
        grid.appendChild(b);
      }
    }
  };
  renderGrid();

  // --- Colors ---
  const renderColors = () => {
    colors.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'mb-color-swatch compact';
      b.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      b.setAttribute('aria-label', c.name);
      b.type = 'button';
      b.classList.toggle('is-active', c === game.color);
      b.addEventListener('click', () => {
        haptic('tap');
        game.color = c;
        document
          .querySelectorAll<HTMLButtonElement>('.mb-color-swatch')
          .forEach((el) => el.classList.remove('is-active'));
        b.classList.add('is-active');
      });
      colors.appendChild(b);
    }
  };
  renderColors();

  // --- Sizes ---
  const renderSizes = () => {
    sizes.innerHTML = '';
    for (const s of SIZES) {
      const b = document.createElement('button');
      b.className = 'mb-size-chip';
      b.textContent = s.name;
      b.type = 'button';
      b.classList.toggle('is-active', s === game.size);
      b.addEventListener('click', () => {
        haptic('tap');
        game.size = s;
        document
          .querySelectorAll<HTMLButtonElement>('.mb-size-chip')
          .forEach((el) => el.classList.remove('is-active'));
        b.classList.add('is-active');
      });
      sizes.appendChild(b);
    }
  };
  renderSizes();

  // Re-render relevant parts when game state changes
  const prevType = game.onBlockTypeChange;
  game.onBlockTypeChange = (t) => {
    prevType?.(t);
    renderGrid();
    updateSizesVisibility(t);
  };

  const updateSizesVisibility = (t: BlockType) => {
    const def = BLOCK_TYPES.find((x) => x.type === t);
    const show = def ? def.usesSize && !def.fixedSize : true;
    sizesWrap.style.display = show ? '' : 'none';
  };
  updateSizesVisibility(game.blockType);
}

/** Open sheet (default peek) — exposed for programmatic open (e.g. from
 *  hotbar expand button). */
export function openSheet(state: 'peek' | 'open' = 'peek'): void {
  const sheet = document.getElementById('mb-sheet');
  if (!sheet) return;
  sheetState = state;
  sheet.dataset.state = state;
  sheet.setAttribute('aria-hidden', 'false');
  sheet.style.height =
    state === 'peek'
      ? `${window.innerHeight * 0.45}px`
      : `${window.innerHeight * 0.85}px`;
}

export function closeSheet(): void {
  const sheet = document.getElementById('mb-sheet');
  if (!sheet) return;
  sheetState = 'closed';
  sheet.dataset.state = 'closed';
  sheet.setAttribute('aria-hidden', 'true');
  sheet.style.height = '';
}

export function toggleSheet(): void {
  if (sheetState === 'closed') openSheet('peek');
  else closeSheet();
}

// --------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------

/** Long-press helper — fires `cb()` after `ms` of sustained touch
 *  without significant movement. Vibrates briefly for feedback. */
function wireLongPress(el: HTMLElement, cb: () => void, ms = 500): void {
  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  el.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    fired = false;
    timer = window.setTimeout(() => {
      fired = true;
      haptic('success');
      cb();
    }, ms);
  });
  el.addEventListener('pointermove', (e) => {
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if ((dx > 8 || dy > 8) && timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  });
  const cancel = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  el.addEventListener('pointerup', (e) => {
    if (fired) {
      // Prevent the subsequent click from also firing the tap handler
      e.preventDefault();
      e.stopPropagation();
    }
    cancel();
  });
  el.addEventListener('pointercancel', cancel);
}

function syncFromGame(game: Game): void {
  // Push initial values into whatever handlers we've registered.
  game.onBlockTypeChange(game.blockType);
  game.onRotationChange(game.rotationStep);
  game.onModeChange(game.mode);
  game.onPlayChange(game.isPlaying);
}

// keep re-exports helpful for the future but not currently used externally
export type { BlockCategory, ColorDef, SizeDef };
