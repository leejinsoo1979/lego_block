import { Game } from './game';
import { buildUI } from './ui';
import { buildAuthUI } from './authUi';
import { buildDashboardUI } from './dashboard';
import { buildGalleryUI } from './gallery';
import { buildStoreUI } from './store';
import { buildMultiplayerUI } from './multiplayer';
import { initLandingRouting } from './landing';
import { loadCharacterModel } from './blocks';

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

  // Landing + routing comes LAST — it dispatches the initial auth state
  // to dashboard / builder, so those must already be built.
  initLandingRouting();

  // Expose for debugging / automation
  (window as unknown as { __game__: Game }).__game__ = game;
}

init().catch((err) => {
  console.error('Failed to initialize:', err);
});
