import {
  BLOCK_TYPES,
  BOARD_SIZES,
  CATEGORIES,
  COLORS,
  ENVIRONMENTS,
  MINIFIG_PRESETS,
  SIZES,
} from './config';
import type { BlockCategory, BlockType } from './config';
import type { Game, Mode } from './game';
import {
  renderBlockTypeThumbnail,
  renderMinifigPresetThumbnail,
} from './thumbnails';

const THUMBNAIL_COLOR = 0xd4534a;

export function buildUI(game: Game) {
  const sidebar = document.getElementById('sidebar')!;

  // --- Play buttons (PC sidebar + mobile drawer handle) ---
  const playButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#play, #play-mobile')
  );
  const playOverlay = document.getElementById('play-overlay')!;
  const viewToggleFirst = document.getElementById(
    'view-toggle-first'
  ) as HTMLButtonElement;
  const viewToggleThird = document.getElementById(
    'view-toggle-third'
  ) as HTMLButtonElement;
  const syncPlay = (playing: boolean) => {
    playButtons.forEach((btn) => {
      btn.textContent = playing ? '■ 빌드로 돌아가기' : '▶ Play';
      btn.classList.toggle('playing', playing);
    });
    playOverlay.classList.toggle('active', playing);
    document.body.classList.toggle('playing', playing);
    // Auto-collapse the mobile drawer whenever play mode starts
    if (playing) sidebar.classList.remove('expanded');
  };
  const syncViewMode = (mode: 'first' | 'third') => {
    viewToggleFirst.classList.toggle('active', mode === 'first');
    viewToggleThird.classList.toggle('active', mode === 'third');
    playOverlay.classList.toggle('third-person', mode === 'third');
  };
  viewToggleFirst.addEventListener('click', () => {
    game.setViewMode('first');
    viewToggleFirst.blur();
  });
  viewToggleThird.addEventListener('click', () => {
    game.setViewMode('third');
    viewToggleThird.blur();
  });
  playButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't bubble up to drawer toggle handler
      if (game.isPlaying) game.stopPlay();
      else game.startPlay();
      btn.blur(); // prevent Space from re-triggering the button during play
    });
  });
  game.onPlayChange = syncPlay;
  game.onViewModeChange = syncViewMode;
  syncPlay(game.isPlaying);
  syncViewMode(game.viewMode);

  // --- Dog whistle button (only visible in play mode with dogs) ---
  const dogWhistleBtn = document.getElementById(
    'dog-whistle'
  ) as HTMLButtonElement | null;
  if (dogWhistleBtn) {
    dogWhistleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      game.whistleDogs();
      dogWhistleBtn.blur();
    });
    game.onDogsPresentChange = (present) => {
      dogWhistleBtn.classList.toggle('hidden', !present);
    };
    game.onDogsFollowingChange = (following) => {
      dogWhistleBtn.classList.toggle('active', following);
    };
  }

  // --- Mobile drawer toggle ---
  // Tapping anywhere on the handle (except the play button itself) toggles
  // the expand/collapse state of the bottom drawer.
  const sidebarHandle = document.getElementById('sidebar-handle');
  if (sidebarHandle) {
    sidebarHandle.addEventListener('click', () => {
      sidebar.classList.toggle('expanded');
    });
  }

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

  // --- Block library (tabs + filtered grid) ---
  const tabsNav = document.getElementById('library-tabs')!;
  const typeGrid = document.getElementById('types')!;
  const tabButtons = new Map<BlockCategory, HTMLButtonElement>();
  const typeButtons = new Map<BlockType, HTMLButtonElement>();
  const charButtons = new Map<string, HTMLButtonElement>();

  let activeCategory: BlockCategory =
    BLOCK_TYPES.find((t) => t.type === game.blockType)?.category ?? 'basic';

  /** Renders the block / character grid for the given category. Reused
   *  whenever the active tab or character preset changes. */
  function renderGrid(cat: BlockCategory) {
    typeGrid.innerHTML = '';
    typeButtons.clear();
    charButtons.clear();
    typeGrid.classList.toggle('character-mode', cat === 'character');

    if (cat === 'character') {
      MINIFIG_PRESETS.forEach((preset) => {
        const btn = document.createElement('button');
        btn.className = 'type-btn character-btn';
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

        btn.addEventListener('click', () => {
          game.setBlockType('minifig');
          game.setCharacter(preset);
        });
        if (preset.id === game.character.id && game.blockType === 'minifig') {
          btn.classList.add('active');
        }

        typeGrid.appendChild(btn);
        charButtons.set(preset.id, btn);
      });

      // Non-minifig characters (dog, future animals) — drawn after the
      // minifig presets. Reuse the block thumbnail path so the button
      // style matches the other character-tab tiles.
      BLOCK_TYPES.filter(
        (t) => t.category === 'character' && t.type !== 'minifig'
      ).forEach((t) => {
        const btn = document.createElement('button');
        btn.className = 'type-btn character-btn';
        btn.dataset.type = t.type;

        const img = document.createElement('img');
        img.alt = t.label;
        try {
          img.src = renderBlockTypeThumbnail(t.type, THUMBNAIL_COLOR);
        } catch {
          /* fallback */
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
    } else {
      BLOCK_TYPES.filter((t) => t.category === cat).forEach((t) => {
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
    }
  }

  function setActiveCategory(cat: BlockCategory) {
    activeCategory = cat;
    tabButtons.forEach((btn, c) => btn.classList.toggle('active', c === cat));
    renderGrid(cat);
  }

  // Build tab buttons from CATEGORIES (order is meaningful)
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.dataset.category = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => {
      if (activeCategory === cat.id) return;
      setActiveCategory(cat.id);
      // When entering a tab, auto-select its first member so the
      // properties panel reflects something sensible.
      if (cat.id === 'character') {
        game.setBlockType('minifig');
      } else {
        const first = BLOCK_TYPES.find((t) => t.category === cat.id);
        if (first) game.setBlockType(first.type);
      }
    });
    tabsNav.appendChild(btn);
    tabButtons.set(cat.id, btn);
  });

  setActiveCategory(activeCategory);

  // Disable color/size panels for blocks that don't honor them.
  const updateTypeVisibility = (type: BlockType) => {
    const def = BLOCK_TYPES.find((t) => t.type === type);
    const isMinifig = type === 'minifig';
    const isDog = type === 'dog';
    const isCharacter = isMinifig || isDog;
    const fixedSize = !!def?.fixedSize;
    // Blocks with hard-coded natural colors (tree, lamp, characters)
    // ignore the color picker — disable the panel so users don't get
    // confused.
    const isColorless = isCharacter || type === 'tree' || type === 'lamp';
    document
      .getElementById('color-panel')!
      .classList.toggle('disabled', isColorless);
    document
      .getElementById('size-panel')!
      .classList.toggle('disabled', isCharacter || fixedSize);
  };

  game.onBlockTypeChange = (type) => {
    // Auto-switch the tab if the new block lives in a different category
    const def = BLOCK_TYPES.find((t) => t.type === type);
    if (def && def.category !== activeCategory) {
      setActiveCategory(def.category);
    }
    typeButtons.forEach((b, k) => b.classList.toggle('active', k === type));
    updateTypeVisibility(type);
  };

  game.onSelectionCleared = () => {
    // Escape was pressed — drop active highlight from every type button
    // so the user sees that nothing is selected. The internal blockType
    // value is left alone; it'll re-activate the moment a button is clicked.
    typeButtons.forEach((b) => b.classList.remove('active'));
  };
  updateTypeVisibility(game.blockType);

  game.onCharacterChange = (preset) => {
    charButtons.forEach((b, k) =>
      b.classList.toggle('active', k === preset.id)
    );
  };

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

  // --- Board size selector (per-tile size) ---
  const boardRow = document.getElementById('board-sizes');
  const boardButtons: HTMLButtonElement[] = [];
  if (boardRow) {
    BOARD_SIZES.forEach((preset) => {
      const btn = document.createElement('button');
      btn.className = 'size-btn';
      btn.textContent = preset.name;
      btn.dataset.boardSize = String(preset.size);
      btn.addEventListener('click', () => game.setBoardSize(preset.size));
      if (preset.size === game.tileSize) btn.classList.add('active');
      boardRow.appendChild(btn);
      boardButtons.push(btn);
    });
    game.onBoardSizeChange = (size) => {
      boardButtons.forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.boardSize) === size);
      });
    };
  }

  // --- Environment selector (baseplate color + surround) ---
  const envRow = document.getElementById('environments');
  const envButtons: HTMLButtonElement[] = [];
  if (envRow) {
    ENVIRONMENTS.forEach((env) => {
      const btn = document.createElement('button');
      btn.className = 'size-btn';
      btn.textContent = env.name;
      btn.dataset.envId = env.id;
      btn.addEventListener('click', () => game.setEnvironment(env));
      if (env.id === game.environment.id) btn.classList.add('active');
      envRow.appendChild(btn);
      envButtons.push(btn);
    });
    game.onEnvironmentChange = (env) => {
      envButtons.forEach((b) => {
        b.classList.toggle('active', b.dataset.envId === env.id);
      });
    };
  }

  // --- Add baseplate tile mode toggle ---
  const addTileBtn = document.getElementById(
    'add-baseplate'
  ) as HTMLButtonElement | null;
  if (addTileBtn) {
    addTileBtn.addEventListener('click', () => {
      game.setAddBaseplateMode(!game.addBaseplateMode);
      addTileBtn.blur();
    });
    game.onAddBaseplateModeChange = (active) => {
      addTileBtn.classList.toggle('active', active);
      addTileBtn.textContent = active
        ? '✕ 스터드 추가 종료'
        : '＋ 스터드 추가';
    };
  }

  // --- Clear / count ---
  const clearBtn = document.getElementById('clear') as HTMLButtonElement;
  clearBtn.addEventListener('click', () => {
    if (confirm('모든 블록을 지울까요?')) game.clearAll();
  });

  // Count is mirrored in the PC sidebar (#count, full "블록: N" label) and
  // the mobile drawer handle pill (#count-mobile, just the number)
  const countDesktop = document.getElementById('count');
  const countMobile = document.getElementById('count-mobile');
  game.onCountChange = (count) => {
    if (countDesktop) countDesktop.textContent = `블록: ${count}`;
    if (countMobile) countMobile.textContent = String(count);
  };

  // --- Help popover toggle ---
  const helpToggle = document.getElementById('help-toggle');
  const helpClose = document.getElementById('help-close');
  const helpPopover = document.getElementById('help-popover');
  if (helpToggle && helpPopover) {
    helpToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      helpPopover.classList.toggle('hidden');
    });
  }
  if (helpClose && helpPopover) {
    helpClose.addEventListener('click', (e) => {
      e.stopPropagation();
      helpPopover.classList.add('hidden');
    });
  }
  // Click outside the popover closes it
  document.addEventListener('click', (e) => {
    if (!helpPopover || helpPopover.classList.contains('hidden')) return;
    const target = e.target as Node;
    if (helpPopover.contains(target)) return;
    if (helpToggle && helpToggle.contains(target)) return;
    helpPopover.classList.add('hidden');
  });
}
