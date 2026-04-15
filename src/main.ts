import { Game } from './game';
import { buildUI } from './ui';
import { buildAuthUI } from './authUi';
import { buildDashboardUI } from './dashboard';
import { buildGalleryUI } from './gallery';
import { buildStoreUI } from './store';
import { buildMultiplayerUI } from './multiplayer';
import { initLandingRouting, wireLandingButtons } from './landing';
import { loadCharacterModel } from './blocks';

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
