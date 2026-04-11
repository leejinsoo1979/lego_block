import {
  BLOCK_TYPES,
  BOARD_SIZES,
  COLORS,
  MINIFIG_PRESETS,
  SIZES,
} from './config';
import type { BlockType, MinifigPreset } from './config';
import type { Game, Mode } from './game';
import {
  renderBlockTypeThumbnail,
  renderMinifigPresetThumbnail,
} from './thumbnails';

const THUMBNAIL_COLOR = 0xd4534a;

export function buildUI(game: Game) {
  // --- Play button ---
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const playOverlay = document.getElementById('play-overlay')!;
  const syncPlay = (playing: boolean) => {
    playBtn.textContent = playing ? '■ 빌드로 돌아가기' : '▶ Play';
    playBtn.classList.toggle('playing', playing);
    playOverlay.classList.toggle('active', playing);
    document.body.classList.toggle('playing', playing);
  };
  playBtn.addEventListener('click', () => {
    if (game.isPlaying) game.stopPlay();
    else game.startPlay();
    playBtn.blur(); // prevent Space from re-triggering the button during play
  });
  game.onPlayChange = syncPlay;
  syncPlay(game.isPlaying);

  // --- Mode toggle ---
  const placeBtn = document.getElementById('mode-place') as HTMLButtonElement;
  const removeBtn = document.getElementById('mode-remove') as HTMLButtonElement;
  const syncMode = (mode: Mode) => {
    placeBtn.classList.toggle('active', mode === 'place');
    removeBtn.classList.toggle('active', mode === 'remove');
    document.body.classList.toggle('remove-mode', mode === 'remove');
  };
  placeBtn.addEventListener('click', () => game.setMode('place'));
  removeBtn.addEventListener('click', () => game.setMode('remove'));
  game.onModeChange = syncMode;
  syncMode(game.mode);

  // --- Block type ---
  const typeGrid = document.getElementById('types')!;
  const typeButtons = new Map<BlockType, HTMLButtonElement>();

  BLOCK_TYPES.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = 'type-btn';
    btn.dataset.type = t.type;

    const img = document.createElement('img');
    img.alt = t.label;
    try {
      img.src = renderBlockTypeThumbnail(t.type, THUMBNAIL_COLOR);
    } catch {
      /* fallback: no thumbnail */
    }
    btn.appendChild(img);

    const label = document.createElement('span');
    label.textContent = t.label;
    btn.appendChild(label);

    btn.addEventListener('click', () => game.setBlockType(t.type));
    if (t.type === game.blockType) btn.classList.add('active');

    typeGrid.appendChild(btn);
    typeButtons.set(t.type, btn);
  });

  // --- Character picker (shown when minifig selected) ---
  const charPanel = document.getElementById('characters-panel')!;
  const charGrid = document.getElementById('characters')!;
  const charButtons = new Map<string, HTMLButtonElement>();

  MINIFIG_PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.className = 'character-btn';
    btn.dataset.char = preset.id;

    const img = document.createElement('img');
    img.alt = preset.name;
    try {
      img.src = renderMinifigPresetThumbnail(preset);
    } catch {
      /* fallback */
    }
    btn.appendChild(img);

    const label = document.createElement('span');
    label.textContent = preset.name;
    btn.appendChild(label);

    btn.addEventListener('click', () => game.setCharacter(preset));
    if (preset.id === game.character.id) btn.classList.add('active');

    charGrid.appendChild(btn);
    charButtons.set(preset.id, btn);
  });

  game.onCharacterChange = (preset) => {
    charButtons.forEach((b, k) => b.classList.toggle('active', k === preset.id));
  };

  const updateTypeVisibility = (type: BlockType) => {
    const isMinifig = type === 'minifig';
    charPanel.classList.toggle('hidden', !isMinifig);
    document.getElementById('color-panel')!.classList.toggle('disabled', isMinifig);
    document.getElementById('size-panel')!.classList.toggle('disabled', isMinifig);
  };

  game.onBlockTypeChange = (type) => {
    typeButtons.forEach((b, k) => b.classList.toggle('active', k === type));
    updateTypeVisibility(type);
  };
  updateTypeVisibility(game.blockType);

  // --- Colors ---
  const colorRow = document.getElementById('colors')!;
  const colorButtons: HTMLButtonElement[] = [];
  COLORS.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'color-btn';
    btn.style.background = '#' + c.hex.toString(16).padStart(6, '0');
    btn.title = c.name;
    btn.addEventListener('click', () => {
      game.color = c;
      colorButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    if (c === game.color) btn.classList.add('active');
    colorRow.appendChild(btn);
    colorButtons.push(btn);
  });

  // --- Sizes ---
  const sizeRow = document.getElementById('sizes')!;
  const sizeButtons: HTMLButtonElement[] = [];
  SIZES.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'size-btn';
    btn.textContent = s.name;
    btn.addEventListener('click', () => {
      game.size = s;
      sizeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    if (s === game.size) btn.classList.add('active');
    sizeRow.appendChild(btn);
    sizeButtons.push(btn);
  });

  // --- Rotate ---
  const rotateBtn = document.getElementById('rotate') as HTMLButtonElement;
  const rotLabel = document.getElementById('rot-label')!;
  const syncRotation = (step: number) => {
    rotLabel.textContent = `${step * 90}°`;
    rotateBtn.classList.toggle('active', step !== 0);
  };
  rotateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    game.rotateClockwise();
  });
  game.onRotationChange = syncRotation;
  syncRotation(game.rotationStep);

  // --- Board size selector ---
  const boardRow = document.getElementById('board-sizes')!;
  const boardButtons: HTMLButtonElement[] = [];
  BOARD_SIZES.forEach((preset) => {
    const btn = document.createElement('button');
    btn.className = 'size-btn';
    btn.textContent = preset.name;
    btn.dataset.boardSize = String(preset.size);
    btn.addEventListener('click', () => game.setBoardSize(preset.size));
    if (preset.size === game.boardSize) btn.classList.add('active');
    boardRow.appendChild(btn);
    boardButtons.push(btn);
  });
  game.onBoardSizeChange = (size) => {
    boardButtons.forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.boardSize) === size);
    });
  };

  // --- Clear / count ---
  const clearBtn = document.getElementById('clear') as HTMLButtonElement;
  clearBtn.addEventListener('click', () => {
    if (confirm('모든 블록을 지울까요?')) game.clearAll();
  });

  const countEl = document.getElementById('count')!;
  game.onCountChange = (count) => {
    countEl.textContent = `블록: ${count}`;
  };
}
