import { Game } from './game';
import { buildUI } from './ui';
import { buildAuthUI } from './authUi';
import { buildDashboardUI } from './dashboard';
import { buildGalleryUI } from './gallery';
import { buildStoreUI } from './store';
import { buildMultiplayerUI } from './multiplayer';
import { initLandingRouting, wireLandingButtons, enterApp } from './landing';
import { loadCharacterModel } from './blocks';
import { signInWithGoogle } from './auth';
import { initMobile } from './mobile';

// Mobile detection + safe-area + viewport height must run FIRST so any
// CSS that depends on body.is-mobile / --sai-* / --vh has the right
// values from the very first paint.
initMobile();

// Expose landing button actions as global functions FIRST, so the inline
// onclick handlers in index.html have something to call even if the rest
// of init() throws or is still loading. This is a bulletproof fallback
// on top of the delegated document-level click listener.
(window as unknown as { __legoLandingLogin: () => void }).__legoLandingLogin =
  () => {
    try {
      signInWithGoogle();
    } catch (err) {
      console.error('[landing] Google login failed:', err);
    }
  };
(window as unknown as { __legoLandingGuest: () => void }).__legoLandingGuest =
  () => {
    try {
      sessionStorage.setItem('legoworld:entered-as-guest', '1');
    } catch {}
    enterApp();
  };

// Wire landing buttons IMMEDIATELY at boot (before awaiting any heavy
// resource). Otherwise the ~500KB character GLB load blocks init() and
// a user who clicks "둘러보기" during that window finds nothing happens
// because the click handler hasn't been attached yet.
wireLandingButtons();

async function init() {
  // The character GLB must be loaded before any minifig is created
  // (both the landing hero scene and the type-button thumbnails in buildUI
  //  call createMinifigure synchronously).
  await loadCharacterModel();

  const viewer = document.getElementById('viewer')!;
  const game = new Game(viewer);
  buildUI(game);
  buildAuthUI(game);
  buildDashboardUI(game);
  buildGalleryUI(game);
  buildStoreUI(game);
  buildMultiplayerUI(game);

  // Auth-driven routing (dashboard / builder) — needs the UIs above to
  // already be built since it may immediately call showDashboard().
  initLandingRouting();

  // Expose for debugging / automation
  (window as unknown as { __game__: Game }).__game__ = game;
}

init().catch((err) => {
  console.error('Failed to initialize:', err);
});
