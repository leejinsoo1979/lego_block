import { Game } from './game';
import { buildUI } from './ui';
import { loadCharacterModel } from './blocks';

async function init() {
  // The character GLB must be loaded before any minifig is created
  // (the type-button thumbnails in buildUI call createMinifigure synchronously).
  await loadCharacterModel();

  const viewer = document.getElementById('viewer')!;
  const game = new Game(viewer);
  buildUI(game);

  // Expose for debugging / automation
  (window as unknown as { __game__: Game }).__game__ = game;
}

init().catch((err) => {
  console.error('Failed to initialize:', err);
});
