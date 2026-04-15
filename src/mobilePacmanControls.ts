// ----------------------------------------------------------------------
//  Mobile Pac-Man controls — 4 direction buttons + exit + view toggle.
//  Visible only when game.isPacmanPlaying is true on mobile.
// ----------------------------------------------------------------------

import { haptic, isMobile } from './mobile';
import type { Game } from './game';

export function initMobilePacmanControls(game: Game): void {
  if (!isMobile()) return;

  const host = document.createElement('div');
  host.id = 'mb-pacman-controls';
  host.className = 'mb-pacman-controls';
  host.innerHTML = `
    <!-- Exit button -->
    <button class="mb-pm-exit" id="mb-pm-exit" aria-label="팩맨 종료" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
      </svg>
      나가기
    </button>

    <!-- View toggle: top-down / 1인칭 -->
    <div class="mb-pm-view-toggle" role="radiogroup" aria-label="시점">
      <button class="mb-pm-view-btn is-active" data-view="top" type="button" role="radio" aria-checked="true">탑뷰</button>
      <button class="mb-pm-view-btn" data-view="first" type="button" role="radio" aria-checked="false">1인칭</button>
    </div>

    <!-- D-pad -->
    <div class="mb-pm-dpad" role="group" aria-label="팩맨 이동">
      <button class="mb-pm-btn mb-pm-up" data-dir="up" aria-label="위" type="button">▲</button>
      <button class="mb-pm-btn mb-pm-left" data-dir="left" aria-label="왼쪽" type="button">◀</button>
      <button class="mb-pm-btn mb-pm-right" data-dir="right" aria-label="오른쪽" type="button">▶</button>
      <button class="mb-pm-btn mb-pm-down" data-dir="down" aria-label="아래" type="button">▼</button>
    </div>
  `;
  document.body.appendChild(host);

  // --- D-pad direction buttons (press=true on down, press=false on up) ---
  host.querySelectorAll<HTMLButtonElement>('.mb-pm-btn').forEach((btn) => {
    const dir = btn.dataset.dir as 'up' | 'down' | 'left' | 'right';
    if (!dir) return;
    const press = (on: boolean) => {
      if (on) haptic('tap');
      game.pacmanMobileInput(dir, on);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(true);
      btn.classList.add('is-held');
    });
    const release = () => {
      press(false);
      btn.classList.remove('is-held');
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });

  // --- View toggle ---
  host.querySelectorAll<HTMLButtonElement>('.mb-pm-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view as 'top' | 'first';
      haptic('tap');
      // Game exposes togglePacmanView (no direct setter); call it only
      // if the target view differs from current.
      if (view === 'first' && game.pacmanViewMode !== 'first') {
        game.togglePacmanView();
      } else if (view === 'top' && game.pacmanViewMode !== 'top') {
        game.togglePacmanView();
      }
      syncView();
    });
  });
  const syncView = () => {
    const mode = game.pacmanViewMode;
    host.querySelectorAll<HTMLButtonElement>('.mb-pm-view-btn').forEach((b) => {
      const on = b.dataset.view === (mode === 'first' ? 'first' : 'top');
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  syncView();

  // --- Exit button ---
  document.getElementById('mb-pm-exit')?.addEventListener('click', () => {
    haptic('tap');
    if (game.isPacmanPlaying) game.stopPacman();
  });

  // --- Show/hide based on isPacmanPlaying ---
  // Chain onto the existing handler (ui.ts sets one for the icon-bar
  // active state) so both subscribers run. `body.pacman-playing` is the
  // CSS hook that hides the builder chrome and shows these controls.
  const prev = game.onPacmanPlayChange;
  game.onPacmanPlayChange = (playing: boolean) => {
    prev(playing);
    document.body.classList.toggle('pacman-playing', playing);
    syncView();
  };
  document.body.classList.toggle('pacman-playing', game.isPacmanPlaying);
}
