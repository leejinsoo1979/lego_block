import {
  BLOCK_TYPES,
  BOARD_SIZES,
  COLORS,
  DEFAULT_FACE,
  ENVIRONMENTS,
  FACE_CHEEKS,
  FACE_EYEBROWS,
  FACE_EYES,
  FACE_MOUTHS,
  FACE_NOSES,
  HAIR_STYLES,
  HAT_STYLES,
  MINIFIG_PRESETS,
  SIZES,
} from './config';
import type { BlockCategory, BlockType, FaceConfig, HairStyle, HatStyle } from './config';
import type { Game, Mode } from './game';
import {
  renderBlockTypeThumbnail,
  renderMinifigPresetThumbnail,
} from './thumbnails';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { drawFacePartPreview, createMinifigure } from './blocks';

// Phosphor "lego-thin" — Vite ?raw import gives us the file contents as
// a string we can inject directly into the icon-bar logo button. This
// keeps the icon as a real SVG element (not an <img>) so currentColor
// and CSS sizing still work.
import legoThinSvg from '@phosphor-icons/core/assets/thin/lego-thin.svg?raw';

const THUMBNAIL_COLOR = 0xd4534a;

/** Maps icon-bar data-panel values to sidebar panel elements and
 *  the corresponding panel title shown in the header. */
const PANEL_TITLES: Record<string, string> = {
  basic: '블록',
  shape: '모양',
  part: '부품',
  special: '특수',
  playground: '놀이터',
  furniture: '가구',
  prop: '소품',
  character: '캐릭터',
  env: '환경',
};

export function buildUI(game: Game) {
  const sidebar = document.getElementById('sidebar')!;

  // Touch-device detection. If ANY touch input is available we enable the
  // screen-center reticle + tap-anywhere-to-place flow in build mode.
  // matchMedia('(pointer: coarse)') catches fingers/styluses; the
  // maxTouchPoints fallback handles hybrid laptops with touchscreens.
  const hasTouch =
    (typeof matchMedia === 'function' &&
      matchMedia('(pointer: coarse)').matches) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  if (hasTouch) document.body.classList.add('touch-device');

  // --- Play buttons (PC sidebar compact + mobile drawer handle) ---
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
      // Mobile button gets full text; compact header button gets icon only
      if (btn.id === 'play-mobile') {
        btn.textContent = playing ? '■ 빌드로 돌아가기' : '▶ 플레이';
      } else {
        btn.textContent = playing ? '■' : '▶';
      }
      btn.classList.toggle('playing', playing);
    });
    playOverlay.classList.toggle('active', playing);
    document.body.classList.toggle('playing', playing);
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
      e.stopPropagation();
      if (game.isPlaying) game.stopPlay();
      else game.startPlay();
      btn.blur();
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

  // --- Icon bar → sidebar panel switching ---
  const panelBlocks = document.getElementById('panel-blocks')!;
  const panelEnv = document.getElementById('panel-env')!;
  const panelTitle = document.getElementById('panel-title')!;
  const typeGrid = document.getElementById('types')!;
  const typeButtons = new Map<BlockType, HTMLButtonElement>();
  const charButtons = new Map<string, HTMLButtonElement>();

  // Which panel group is showing: 'blocks' (any block category) or 'env'
  type PanelId = 'blocks' | 'env';
  let activeCategory: BlockCategory =
    BLOCK_TYPES.find((t) => t.type === game.blockType)?.category ?? 'basic';

  function showPanel(panel: PanelId) {
    panelBlocks.classList.toggle('active', panel === 'blocks');
    panelEnv.classList.toggle('active', panel === 'env');
  }

  /** Wire a thumbnail button so a press-and-drag becomes a drag-place flow.
   *  Touch: drag starts immediately (no hover state on mobile).
   *  Mouse: drag starts after the pointer moves beyond a small threshold
   *         so that a normal click still just selects the block type. */
  const DRAG_THRESHOLD = 6; // px — must move this far before drag starts

  function attachThumbnailDrag(btn: HTMLButtonElement, selectFn: () => void) {
    // Suppress click when the interaction was a completed drag, so the
    // block type doesn't get re-selected after commitThumbnailDrag.
    let suppressClick = false;
    btn.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      selectFn();
    });

    // Prevent the browser's native image-drag on the <img> inside the
    // button — without this, mouse drag-and-drop never fires pointermove.
    btn.addEventListener('dragstart', (e) => e.preventDefault());

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (game.isPlaying) return;
      if (game.mode !== 'place') return;

      const isTouch = e.pointerType === 'touch';

      if (isTouch) {
        // Touch: start drag immediately (existing behaviour)
        e.preventDefault();
        e.stopPropagation();
        sidebar.classList.remove('expanded');
        selectFn();
        game.beginThumbnailDrag(e.clientX, e.clientY);
      }

      // Mouse: defer drag start until the pointer moves past the threshold.
      const startX = e.clientX;
      const startY = e.clientY;
      let dragStarted = isTouch; // touch starts immediately

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;

        if (!dragStarted) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          // Passed threshold — begin drag
          dragStarted = true;
          selectFn();
          game.beginThumbnailDrag(ev.clientX, ev.clientY);
        }

        ev.preventDefault();
        game.updateThumbnailDrag(ev.clientX, ev.clientY);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        ev.preventDefault();
        cleanup();
        if (dragStarted) {
          suppressClick = true;
          game.commitThumbnailDrag(ev.clientX, ev.clientY);
        }
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        cleanup();
        if (dragStarted) {
          suppressClick = true;
          game.cancelThumbnailDrag();
        }
      };
      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
      };
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp, { passive: false });
      document.addEventListener('pointercancel', onCancel);
    });
  }

  /** Renders the block / character grid for the given category. */
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

        attachThumbnailDrag(btn, () => {
          game.setBlockType('minifig');
          game.setCharacter(preset);
        });
        if (preset.id === game.character.id && game.blockType === 'minifig') {
          btn.classList.add('active');
        }

        typeGrid.appendChild(btn);
        charButtons.set(preset.id, btn);
      });

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

        attachThumbnailDrag(btn, () => game.setBlockType(t.type));
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
          /* fallback */
        }
        btn.appendChild(img);

        const label = document.createElement('span');
        label.textContent = t.label;
        btn.appendChild(label);

        attachThumbnailDrag(btn, () => game.setBlockType(t.type));
        if (t.type === game.blockType) btn.classList.add('active');

        typeGrid.appendChild(btn);
        typeButtons.set(t.type, btn);
      });
    }
  }

  // --- Icon bar button references (needed by setActiveCategory) ---
  const iconBar = document.getElementById('icon-bar');
  const iconBtns = iconBar
    ? Array.from(iconBar.querySelectorAll<HTMLButtonElement>('.icon-bar-btn'))
    : [];

  /** Highlight the icon bar button matching the given panel id. */
  function syncIconBar(panelId: string) {
    iconBtns.forEach((b) => {
      if (b.dataset.panel) {
        b.classList.toggle('active', b.dataset.panel === panelId);
      }
    });
  }

  /** Switch to a block category: update icon bar highlight, panel title,
   *  show the blocks panel, and render the grid. */
  function setActiveCategory(cat: BlockCategory) {
    activeCategory = cat;
    panelTitle.textContent = PANEL_TITLES[cat] ?? cat;
    showPanel('blocks');
    renderGrid(cat);
    syncIconBar(cat);
  }

  // Initial render
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
    const isFurnitureOrProp = def?.category === 'furniture' || def?.category === 'prop';
    const isColorless = isCharacter || isFurnitureOrProp || type === 'tree' || type === 'lamp';
    document
      .getElementById('color-panel')!
      .classList.toggle('disabled', isColorless);
    document
      .getElementById('size-panel')!
      .classList.toggle('disabled', isCharacter || fixedSize);
  };

  game.onBlockTypeChange = (type) => {
    // Auto-switch the icon bar panel if the new block lives in a different category
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

  // --- Time-of-day slider ---
  // Slider value is in MINUTES (0..1440) for fine 5-minute steps. Game
  // takes a 24h float, so we divide by 60 going in and reformat as
  // HH:MM coming out.
  const timeSlider = document.getElementById(
    'time-slider'
  ) as HTMLInputElement | null;
  const timeLabel = document.getElementById('time-label');
  const timePhase = document.getElementById('time-phase');
  if (timeSlider) {
    const formatTime = (t: number) => {
      const mins = Math.round(t * 60);
      const hh = Math.floor(mins / 60) % 24;
      const mm = mins % 60;
      return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
    };
    const phaseFor = (t: number) => {
      if (t < 5) return '심야';
      if (t < 7) return '새벽';
      if (t < 11) return '아침';
      if (t < 13) return '정오';
      if (t < 17) return '오후';
      if (t < 19) return '저녁';
      if (t < 22) return '밤';
      return '심야';
    };
    const renderTime = (t: number) => {
      if (timeLabel) timeLabel.textContent = formatTime(t);
      if (timePhase) timePhase.textContent = phaseFor(t);
    };
    timeSlider.value = String(Math.round(game.getTimeOfDay() * 60));
    renderTime(game.getTimeOfDay());
    timeSlider.addEventListener('input', () => {
      const t = parseInt(timeSlider.value, 10) / 60;
      game.setTimeOfDay(t);
    });
    game.onTimeOfDayChange = (t) => {
      const v = String(Math.round(t * 60));
      if (timeSlider.value !== v) timeSlider.value = v;
      renderTime(t);
    };
  }

  // --- Sun azimuth slider (0..360°) ---
  const azimuthSlider = document.getElementById(
    'azimuth-slider'
  ) as HTMLInputElement | null;
  const azimuthLabel = document.getElementById('azimuth-label');
  if (azimuthSlider) {
    const renderAzimuth = (rad: number) => {
      const deg = Math.round((rad * 180) / Math.PI);
      if (azimuthLabel) azimuthLabel.textContent = `${deg}°`;
    };
    azimuthSlider.value = String(
      Math.round((game.getSunAzimuth() * 180) / Math.PI)
    );
    renderAzimuth(game.getSunAzimuth());
    azimuthSlider.addEventListener('input', () => {
      const deg = parseInt(azimuthSlider.value, 10);
      game.setSunAzimuth((deg * Math.PI) / 180);
    });
    game.onSunAzimuthChange = (rad) => {
      const v = String(Math.round((rad * 180) / Math.PI));
      if (azimuthSlider.value !== v) azimuthSlider.value = v;
      renderAzimuth(rad);
    };
  }

  // --- Sun intensity slider (0..2.0×) ---
  // Slider stores ×100 so the integer step lands on whole percent
  // values; the game treats it as a multiplier (1.0 = baseline).
  const intensitySlider = document.getElementById(
    'intensity-slider'
  ) as HTMLInputElement | null;
  const intensityLabel = document.getElementById('intensity-label');
  if (intensitySlider) {
    const renderIntensity = (m: number) => {
      if (intensityLabel) intensityLabel.textContent = `×${m.toFixed(1)}`;
    };
    intensitySlider.value = String(
      Math.round(game.getSunIntensityScale() * 100)
    );
    renderIntensity(game.getSunIntensityScale());
    intensitySlider.addEventListener('input', () => {
      const m = parseInt(intensitySlider.value, 10) / 100;
      game.setSunIntensityScale(m);
    });
    game.onSunIntensityChange = (m) => {
      const v = String(Math.round(m * 100));
      if (intensitySlider.value !== v) intensitySlider.value = v;
      renderIntensity(m);
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

  // Count is mirrored in two places: sidebar footer + mobile drawer pill.
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

  // --- Left icon bar click handlers ---
  if (iconBar) {
    for (const btn of iconBtns) {
      const panel = btn.dataset.panel;
      const action = btn.dataset.action;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();

        if (panel) {
          if (panel === 'env') {
            syncIconBar('env');
            panelTitle.textContent = PANEL_TITLES.env;
            showPanel('env');
          } else {
            const cat = panel as BlockCategory;
            setActiveCategory(cat);
            if (cat === 'character') {
              game.setBlockType('minifig');
            } else {
              const first = BLOCK_TYPES.find((t) => t.category === cat);
              if (first) game.setBlockType(first.type);
            }
          }
        } else if (action) {
          switch (action) {
            case 'play':
              if (game.isPlaying) game.stopPlay();
              else game.startPlay();
              break;
            case 'help':
              if (helpPopover) helpPopover.classList.toggle('hidden');
              break;
          }
        }
        btn.blur();
      });
    }

    // Logo: inject the Phosphor lego-thin SVG
    const logoBtn = document.getElementById('iconbar-logo');
    if (logoBtn) {
      logoBtn.innerHTML = legoThinSvg;
      logoBtn.addEventListener('click', () => {
        setActiveCategory('basic');
        game.setBlockType('brick');
      });
    }

    // Mirror the Play button visual state
    const iconPlayBtn = document.getElementById(
      'iconbar-play'
    ) as HTMLButtonElement | null;
    if (iconPlayBtn) {
      const baseSyncPlay = game.onPlayChange;
      game.onPlayChange = (playing: boolean) => {
        baseSyncPlay(playing);
        iconPlayBtn.textContent = playing ? '■' : '▶';
        iconPlayBtn.classList.toggle('active', playing);
      };
    }
  }

  // =================================================================
  //  Character editor panel
  // =================================================================

  const editorEl = document.getElementById('char-editor');
  const editorPreviewCanvas = document.getElementById(
    'char-editor-preview'
  ) as HTMLCanvasElement | null;

  if (editorEl && editorPreviewCanvas) {
    // --- Editor state (local copy, applied to game on "적용") ---
    const editorFace: FaceConfig = { ...DEFAULT_FACE };
    let editorHairStyle: HairStyle = 'none';
    let editorHatStyle: HatStyle = 'none';
    let editorHairColor = 0x3b2415;
    let editorHatColor = 0x333333;
    let editorSkinHex = 0xf5cd30;
    let editorShirtHex = 0xc4281c;
    let editorPantsHex = 0x0d69ac;

    // --- 3D preview with OrbitControls (draggable + auto-rotate) ---
    const previewRenderer = new THREE.WebGLRenderer({
      canvas: editorPreviewCanvas,
      alpha: true,
      antialias: true,
    });
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Actual render size is driven by the CSS layout via ResizeObserver.
    previewRenderer.setSize(
      editorPreviewCanvas.clientWidth,
      editorPreviewCanvas.clientHeight,
      false
    );
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    previewRenderer.toneMappingExposure = 1.6;
    const previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0xeef0f4);
    const previewCamera = new THREE.PerspectiveCamera(
      32,
      editorPreviewCanvas.clientWidth / editorPreviewCanvas.clientHeight,
      0.1,
      100
    );
    // Frame the full body: camera at eye level, pulled back enough so
    // the head (top ~4.8u) and feet (0) both fit with room to spare.
    previewCamera.position.set(0, 2.8, 16);

    // OrbitControls — orbit target at the minifig's center of mass,
    // auto-rotate slowly so the user can inspect without dragging.
    const previewControls = new OrbitControls(
      previewCamera,
      editorPreviewCanvas
    );
    previewControls.target.set(0, 2.4, 0);
    previewControls.enableDamping = true;
    previewControls.dampingFactor = 0.12;
    previewControls.autoRotate = false;
    previewControls.enableZoom = true;
    previewControls.minDistance = 4;
    previewControls.maxDistance = 18;
    previewControls.enablePan = false;
    previewControls.update();

    // Lighting: key + fill + rim for a clean product-shot look.
    const pKey = new THREE.DirectionalLight(0xffffff, 4.5);
    pKey.position.set(4, 10, 6);
    previewScene.add(pKey);
    const pFill = new THREE.DirectionalLight(0xeef4ff, 2.5);
    pFill.position.set(-5, 6, -2);
    previewScene.add(pFill);
    const pBack = new THREE.DirectionalLight(0xfff0dd, 1.5);
    pBack.position.set(0, 4, -6);
    previewScene.add(pBack);
    const pAmb = new THREE.AmbientLight(0xffffff, 1.2);
    previewScene.add(pAmb);

    // Ground disc so the minifig isn't floating in void.
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xc8cad0,
      roughness: 0.9,
    });
    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 0.06, 32),
      groundMat
    );
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    previewScene.add(ground);

    let previewMinifig: THREE.Group | null = null;
    let editorOpen = false;

    const refreshPreview = () => {
      if (previewMinifig) {
        previewScene.remove(previewMinifig);
        previewMinifig = null;
      }
      previewMinifig = createMinifigure({
        id: 'editor',
        name: '커스텀',
        shirtHex: editorShirtHex,
        pantsHex: editorPantsHex,
        headHex: editorSkinHex,
        hatStyle: editorHatStyle,
        hatColor: editorHatColor,
        hairStyle: editorHairStyle,
        hairColor: editorHairColor,
        face: { ...editorFace },
      });
      previewScene.add(previewMinifig);
    };

    // Render loop — runs only while the editor is open.
    const editorRenderLoop = () => {
      if (!editorOpen) return;
      requestAnimationFrame(editorRenderLoop);
      previewControls.update();
      previewRenderer.render(previewScene, previewCamera);
    };

    // Keep preview canvas sized to its CSS container.
    const previewRO = new ResizeObserver(() => {
      const w = editorPreviewCanvas.clientWidth;
      const h = editorPreviewCanvas.clientHeight;
      if (w === 0 || h === 0) return;
      previewRenderer.setSize(w, h, false);
      previewCamera.aspect = w / h;
      previewCamera.updateProjectionMatrix();
    });
    previewRO.observe(editorPreviewCanvas);

    // --- Color pickers ---
    const skinPicker = document.getElementById('ce-skin') as HTMLInputElement;
    const shirtPicker = document.getElementById('ce-shirt') as HTMLInputElement;
    const pantsPicker = document.getElementById('ce-pants') as HTMLInputElement;
    const hwColorPicker = document.getElementById(
      'ce-headwear-color'
    ) as HTMLInputElement;

    const hex = (n: number) =>
      '#' + n.toString(16).padStart(6, '0');

    // --- Swatch palettes ---
    const SKIN_SWATCHES = [
      0xf5cd30, 0xf7d74e,
      0xfde0c4, 0xf5c9a0, 0xe8ab76, 0xd4915c,
      0xc47e4c, 0xb06835, 0x8d5524, 0x6b3e26,
      0x4a2912, 0x3b1e0e,
      0xf0e68c, 0xadd8e6, 0xd8bfd8, 0xc0e0c0,
    ];
    const CLOTHING_SWATCHES = [
      0xc4281c, 0xe74c3c, 0xff6b6b, 0xd4524a, 0x8b1a1a,
      0xff8c00, 0xf39c12, 0xe67e22,
      0xf5cd30, 0xffd700, 0xf7dc6f,
      0x27ae60, 0x2ecc71, 0x1abc9c, 0x006400, 0x228b22, 0x6b8e23,
      0x0d69ac, 0x2980b9, 0x3498db, 0x1b3668, 0x5dade2, 0x1a5276, 0x154360,
      0x8e44ad, 0x9b59b6, 0x4a1e6e, 0x6c3483, 0x2a1040,
      0xe8bac8, 0xff69b4, 0xd89ab0, 0xc0507e,
      0x8b4513, 0xa0522d, 0x6b3e26, 0xd2691e,
      0xf2f3f3, 0xd0d3d3, 0xa0a0a0, 0x6e6e6e, 0x4a4a4a, 0x2a2a2a,
      0xffffff, 0x1b2028, 0x0d1830, 0x000000,
    ];

    const buildSwatches = (
      containerId: string,
      palette: number[],
      setValue: (c: number) => void,
      picker: HTMLInputElement,
    ) => {
      const container = document.getElementById(containerId)!;
      const buttons: HTMLButtonElement[] = [];
      for (const c of palette) {
        const btn = document.createElement('button');
        btn.className = 'ce-swatch';
        btn.style.background = hex(c);
        btn.title = hex(c);
        btn.addEventListener('click', () => {
          setValue(c);
          picker.value = hex(c);
          syncSwatchActive();
          refreshPreview();
        });
        container.appendChild(btn);
        buttons.push(btn);
      }
      return buttons;
    };

    const skinSwatchBtns = buildSwatches(
      'ce-skin-swatches', SKIN_SWATCHES,
      (c) => { editorSkinHex = c; },
      skinPicker,
    );
    const shirtSwatchBtns = buildSwatches(
      'ce-shirt-swatches', CLOTHING_SWATCHES,
      (c) => { editorShirtHex = c; },
      shirtPicker,
    );
    const pantsSwatchBtns = buildSwatches(
      'ce-pants-swatches', CLOTHING_SWATCHES,
      (c) => { editorPantsHex = c; },
      pantsPicker,
    );

    const syncSwatchActive = () => {
      const mark = (btns: HTMLButtonElement[], palette: number[], cur: number) => {
        btns.forEach((b, i) => b.classList.toggle('active', palette[i] === cur));
      };
      mark(skinSwatchBtns, SKIN_SWATCHES, editorSkinHex);
      mark(shirtSwatchBtns, CLOTHING_SWATCHES, editorShirtHex);
      mark(pantsSwatchBtns, CLOTHING_SWATCHES, editorPantsHex);
    };

    const syncColorPickers = () => {
      skinPicker.value = hex(editorSkinHex);
      shirtPicker.value = hex(editorShirtHex);
      pantsPicker.value = hex(editorPantsHex);
      hwColorPicker.value = hex(
        editorHatStyle !== 'none' ? editorHatColor : editorHairColor
      );
      syncSwatchActive();
    };

    skinPicker.addEventListener('input', () => {
      editorSkinHex = parseInt(skinPicker.value.slice(1), 16);
      syncSwatchActive();
      refreshPreview();
    });
    shirtPicker.addEventListener('input', () => {
      editorShirtHex = parseInt(shirtPicker.value.slice(1), 16);
      syncSwatchActive();
      refreshPreview();
    });
    pantsPicker.addEventListener('input', () => {
      editorPantsHex = parseInt(pantsPicker.value.slice(1), 16);
      syncSwatchActive();
      refreshPreview();
    });
    hwColorPicker.addEventListener('input', () => {
      const c = parseInt(hwColorPicker.value.slice(1), 16);
      if (editorHatStyle !== 'none') editorHatColor = c;
      else editorHairColor = c;
      refreshPreview();
    });

    // --- Face part strips ---
    type FacePart = 'eyes' | 'nose' | 'mouth' | 'eyebrows' | 'cheeks';
    const facePartMap: { part: FacePart; elId: string; catalog: readonly { id: number; label: string }[]; key: keyof FaceConfig }[] = [
      { part: 'eyes', elId: 'ce-eyes', catalog: FACE_EYES, key: 'eyes' },
      { part: 'nose', elId: 'ce-nose', catalog: FACE_NOSES, key: 'nose' },
      { part: 'mouth', elId: 'ce-mouth', catalog: FACE_MOUTHS, key: 'mouth' },
      { part: 'eyebrows', elId: 'ce-eyebrows', catalog: FACE_EYEBROWS, key: 'eyebrows' },
      { part: 'cheeks', elId: 'ce-cheeks', catalog: FACE_CHEEKS, key: 'cheeks' },
    ];

    for (const { part, elId, catalog, key } of facePartMap) {
      const strip = document.getElementById(elId);
      if (!strip) continue;
      const buttons: HTMLButtonElement[] = [];
      catalog.forEach((entry) => {
        const btn = document.createElement('button');
        btn.className = 'ce-strip-btn';
        btn.title = entry.label;
        const canvas = drawFacePartPreview(part, entry.id, 48);
        if (entry.id === 0 && part !== 'eyes') {
          // "없음" entries look empty — show label instead
          const span = document.createElement('span');
          span.textContent = entry.label;
          btn.appendChild(span);
        } else {
          btn.appendChild(canvas);
        }
        btn.addEventListener('click', () => {
          editorFace[key] = entry.id;
          buttons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          refreshPreview();
        });
        if (entry.id === editorFace[key]) btn.classList.add('active');
        strip.appendChild(btn);
        buttons.push(btn);
      });
    }

    // --- Hair strip ---
    const hairStrip = document.getElementById('ce-hair');
    if (hairStrip) {
      const hairBtns: HTMLButtonElement[] = [];
      HAIR_STYLES.forEach((hs) => {
        const btn = document.createElement('button');
        btn.className = 'ce-strip-btn';
        const span = document.createElement('span');
        span.textContent = hs.label;
        btn.appendChild(span);
        btn.addEventListener('click', () => {
          editorHairStyle = hs.id;
          if (hs.id !== 'none') editorHatStyle = 'none';
          hairBtns.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          // deselect hat if hair picked
          document
            .querySelectorAll('#ce-hat .ce-strip-btn')
            .forEach((b) => b.classList.remove('active'));
          document
            .querySelector('#ce-hat .ce-strip-btn')
            ?.classList.add('active'); // "없음"
          refreshPreview();
        });
        if (hs.id === editorHairStyle) btn.classList.add('active');
        hairStrip.appendChild(btn);
        hairBtns.push(btn);
      });
    }

    // --- Hat strip ---
    const hatStrip = document.getElementById('ce-hat');
    if (hatStrip) {
      const hatBtns: HTMLButtonElement[] = [];
      HAT_STYLES.forEach((hs) => {
        const btn = document.createElement('button');
        btn.className = 'ce-strip-btn';
        const span = document.createElement('span');
        span.textContent = hs.label;
        btn.appendChild(span);
        btn.addEventListener('click', () => {
          editorHatStyle = hs.id;
          if (hs.id !== 'none') editorHairStyle = 'none';
          hatBtns.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          // deselect hair if hat picked
          document
            .querySelectorAll('#ce-hair .ce-strip-btn')
            .forEach((b) => b.classList.remove('active'));
          document
            .querySelector('#ce-hair .ce-strip-btn')
            ?.classList.add('active'); // "없음"
          refreshPreview();
        });
        if (hs.id === editorHatStyle) btn.classList.add('active');
        hatStrip.appendChild(btn);
        hatBtns.push(btn);
      });
    }

    // --- Open / close editor ---
    const openEditor = () => {
      // Load current character state into editor
      const c = game.character;
      editorSkinHex = c.headHex ?? 0xf5cd30;
      editorShirtHex = c.shirtHex;
      editorPantsHex = c.pantsHex;
      editorHatStyle = c.hatStyle;
      editorHatColor = c.hatColor ?? 0x333333;
      editorHairStyle = c.hairStyle ?? 'none';
      editorHairColor = c.hairColor ?? 0x3b2415;
      if (c.face) {
        Object.assign(editorFace, c.face);
      } else {
        Object.assign(editorFace, DEFAULT_FACE);
      }
      syncColorPickers();
      editorEl.classList.remove('hidden');
      refreshPreview();
      // Start the render loop so orbit controls animate.
      editorOpen = true;
      editorRenderLoop();
    };

    const closeEditor = () => {
      editorOpen = false;
      editorEl.classList.add('hidden');
    };

    // "커스터마이즈" button added to the character preset area
    // (We'll insert it dynamically after the character buttons)
    const charSection = document.querySelector(
      '[data-panel="character"], #types'
    );
    if (charSection) {
      const customBtn = document.createElement('button');
      customBtn.className = 'add-tile-btn';
      customBtn.textContent = '✎ 캐릭터 커스터마이즈';
      customBtn.style.marginTop = '8px';
      customBtn.addEventListener('click', openEditor);
      // Insert after the types grid (which holds character preset buttons)
      const typesGrid = document.getElementById('types');
      if (typesGrid) {
        typesGrid.parentElement?.insertBefore(
          customBtn,
          typesGrid.nextSibling
        );
      }
    }

    document
      .getElementById('char-editor-close')
      ?.addEventListener('click', closeEditor);
    document
      .getElementById('ce-exit')
      ?.addEventListener('click', closeEditor);

    // "적용" button — push editor state to game
    document.getElementById('ce-apply')?.addEventListener('click', () => {
      game.applyEditorCharacter({
        id: 'custom',
        name: '커스텀',
        shirtHex: editorShirtHex,
        pantsHex: editorPantsHex,
        headHex: editorSkinHex,
        hatStyle: editorHatStyle,
        hatColor: editorHatColor,
        hairStyle: editorHairStyle,
        hairColor: editorHairColor,
        face: { ...editorFace },
        hideFace: false,
      });
      closeEditor();
    });

    // "초기화" button — reset to default
    document.getElementById('ce-reset')?.addEventListener('click', () => {
      Object.assign(editorFace, DEFAULT_FACE);
      editorHairStyle = 'none';
      editorHatStyle = 'none';
      editorSkinHex = 0xf5cd30;
      editorShirtHex = 0xc4281c;
      editorPantsHex = 0x0d69ac;
      editorHairColor = 0x3b2415;
      editorHatColor = 0x333333;
      syncColorPickers();
      refreshPreview();
    });
  }
}
