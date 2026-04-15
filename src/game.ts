import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Water } from 'three/addons/objects/Water.js';
import {
  BLOCK_TYPES,
  BOARD_SIZE,
  COLORS,
  ENVIRONMENTS,
  GRID,
  MINIFIG_PRESETS,
  PLATE_HEIGHT,
  SIZES,
  STUD_HEIGHT,
  STUD_RADIUS,
} from './config';
import type {
  BlockType,
  ColorDef,
  EnvironmentDef,
  MinifigPreset,
  SizeDef,
} from './config';
import {
  createBrick,
  createBrickGhost,
  createDogCharacter,
  createDogGhost,
  createGhost,
  createMinifigGhost,
  createMinifigure,
  createPacmanGhost,
  getMinifigHeight,
} from './blocks';
import { SoundManager } from './sound';

export type Mode = 'place' | 'remove';
export type ViewMode = 'first' | 'third';

/** Runtime state for a single NPC (a minifig placed in build mode that
 *  is brought to life during play mode — wanders around, faces movement,
 *  collides with the world, and can be talked to by pressing E nearby). */
interface NpcState {
  /** The character's root THREE.Group — position/rotation are mutated
   *  in place each frame. Restored to `homePos`/`origRotY` on stopPlay. */
  obj: THREE.Group;
  homePos: THREE.Vector3;
  origRotY: number;
  target: THREE.Vector3;
  /** Current facing direction in radians (smoothed toward move dir). */
  yaw: number;
  /** Phase accumulator for limb-swing animation. */
  walkTime: number;
  state: 'idle' | 'walking' | 'greeting' | 'following';
  /** Time remaining in the current state before transitioning. */
  stateTimer: number;
  /** The line shown in the chat bubble while state === 'greeting'. */
  greeting: string;
  /** True for dog NPCs — quadruped walk animation, no chat interaction. */
  isDog: boolean;
  /** Countdown to the next bark while following (dogs only). */
  nextBarkIn?: number;
  /** Seconds remaining in an initial "sprint to player" burst right after
   *  a whistle. While >0 the dog runs at sprint speed; when it ticks to 0
   *  the dog settles back into a normal follow trot. Dogs only. */
  followSprintTime?: number;
}

/** Playground module subtypes the player can ride. */
type PlaygroundType =
  | 'slide'
  | 'swing'
  | 'seesaw'
  | 'junglegym'
  | 'merrygoround';

/** Runtime state for an active playground ride. The block + type are
 *  required; the rest is per-type animation data. `t` is a generic
 *  accumulator (seconds since the ride started). */
interface PlaygroundRideState {
  obj: THREE.Object3D;
  type: PlaygroundType;
  t: number;
  /** Slide: current local Z position along the slide deck. */
  slideZ?: number;
  /** Slide: which phase the ride is in. The ride starts in 'climbing'
   *  (walking up the rear staircase) and switches to 'sliding' once
   *  the avatar reaches the top platform. */
  slidePhase?: 'climbing' | 'sliding';
  /** Swing: local X of the seat the player picked. */
  swingSeatX?: number;
  /** Swing: index of the seat (matches userData.parts.swingPivots[i]). */
  swingSeatIdx?: number;
  /** Seesaw: which side of the plank the player sits on (-1 or +1). */
  seesawSide?: number;
  /** Merry-go-round: which seat (0..3) the player sits on. */
  merrySeatIdx?: number;
}

/** Runtime state for a vehicle the player is driving. Separate from
 *  PlaygroundRideState because vehicles are freely controlled via WASD
 *  rather than following a scripted animation loop. */
interface VehicleRideState {
  obj: THREE.Object3D;
  type: 'car' | 'train';
  /** Current speed in u/s (positive = forward along the vehicle's +Z). */
  speed: number;
  /** World-space yaw of the vehicle (for cars: steered by A/D). */
  yaw: number;
  /** For trains: the parameterized position along the rail spline (0..1). */
  railT?: number;
  /** For trains: the assembled rail spline (world-space points). */
  railPath?: THREE.CatmullRomCurve3;
}

/** Random greetings shown when the player presses E near an NPC. */
const NPC_GREETINGS = [
  '안녕하세요!',
  '날씨 좋네요.',
  '어디 가세요?',
  '만나서 반갑습니다.',
  '조심히 다니세요!',
  '오늘 기분이 좋아요.',
  '또 뵈어요!',
  '멋진 집이네요.',
];

export class Game {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private fpsControls: PointerLockControls | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private brickGroup = new THREE.Group();
  private baseplate!: THREE.Group;
  private ghost!: THREE.Object3D;
  private hoverBox: THREE.LineSegments;
  /** Block currently tinted as the remove-mode ghost (or null). When
   *  the cursor leaves the block / mode changes / play starts, we
   *  restore the block's original materials using hoverRemoveSaved. */
  private hoverRemoveTarget: THREE.Object3D | null = null;
  private hoverRemoveSaved: Array<{
    mesh: THREE.Mesh;
    original: THREE.Material | THREE.Material[];
    renderOrder: number;
  }> = [];
  /** Shared translucent red material applied to every mesh of the
   *  currently-hovered block while in remove mode. One instance is
   *  reused across hovers — cheaper than making one per mesh. */
  private removeHoverMaterial = new THREE.MeshBasicMaterial({
    color: 0xff2233,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private pointerDownPos = new THREE.Vector2();
  private wasDrag = false;
  private lastPointerType: string = 'mouse';
  /** True while the user is actively dragging from a sidebar thumbnail
   *  onto the canvas (touch only). Routes pointer position to the actual
   *  finger XY instead of the screen-center reticle, disables OrbitControls
   *  so 1-finger drag doesn't fight with placement, and skips the long-press
   *  rotate path. Cleared on commit / cancel. */
  private thumbnailDragActive = false;
  private sound = new SoundManager();
  private lastFrameTime = performance.now();

  // Build state
  color: ColorDef = COLORS[0];
  size: SizeDef = SIZES.find((s) => s.name === '2x2') ?? SIZES[0];
  /** Clockwise rotation step in 90° increments: 0, 1, 2, 3 (= 0°, 90°, 180°, 270°). */
  rotationStep = 0;
  blockType: BlockType = 'brick';
  character: MinifigPreset = MINIFIG_PRESETS[0];
  /** Bumped every time any editor field changes so the ghost cache can
   *  detect "same preset id but different customization". */
  characterVersion = 0;
  mode: Mode = 'place';
  /** Default tile size in studs. The map is now built from a grid of tiles
   *  rather than a single resizable plate, so this is per-tile, not the
   *  total board size. */
  tileSize: number = BOARD_SIZE;
  /** Vertical spacing between stacked tiles (one "floor"). */
  static readonly TILE_LEVEL_HEIGHT = 4.0;
  private baseplates = new Map<string, THREE.Group>();
  private sunLight: THREE.DirectionalLight | null = null;
  /** Visible billboarded sun disc (bright sphere with halos). Updated
   *  each time the time-of-day slider moves so it tracks the directional
   *  sun's direction; hidden when the sun drops below the horizon. */
  private sunDisc: THREE.Group | null = null;
  /** Per-layer sprite materials for the sun. Stored so setTimeOfDay can
   *  tint the core / inner halo / outer glow / soft flare independently
   *  as the sun rises and sets (white-gold at zenith, deep orange-red
   *  at the horizon). */
  private sunDiscLayers: {
    core: THREE.SpriteMaterial;
    halo: THREE.SpriteMaterial;
    glow: THREE.SpriteMaterial;
    flare: THREE.SpriteMaterial;
    coreSprite: THREE.Sprite;
    haloSprite: THREE.Sprite;
    glowSprite: THREE.Sprite;
    flareSprite: THREE.Sprite;
  } | null = null;
  /** Billboarded moon — same layered-sprite approach as the sun, smaller
   *  and tinted pale blue-white. Visible only when the sun is below the
   *  horizon, positioned opposite the sun in the sky. */
  private moonDisc: THREE.Group | null = null;
  private moonDiscLayers: {
    core: THREE.SpriteMaterial;
    halo: THREE.SpriteMaterial;
  } | null = null;
  /** Starfield (~2000 random points on the upper hemisphere) — rendered
   *  with a transparent PointsMaterial whose opacity fades in at night
   *  and out during the day. */
  private starField: THREE.Points | null = null;
  /** Time of day in 24-hour float (e.g. 6.5 = 6:30am, 18.0 = 6pm).
   *  Drives sun position, intensity, color, sky color, and HDRI fill
   *  brightness via setTimeOfDay(). Default = noon. */
  private timeOfDay: number = 12;
  /** Compass direction the sun "tracks across" in radians, 0..2π. At
   *  azimuth 0 the sun rises in the +X direction (east) and sets in
   *  -X (west); rotating this around the world Y axis swings the
   *  whole arc — useful for choosing where shadows land. */
  private sunAzimuth: number = 0;
  /** Multiplier on the directional sun light intensity (1.0 = normal).
   *  Lets the user dial the scene brighter or dimmer without affecting
   *  the day/night curve itself. */
  private sunIntensityScale: number = 1;
  /** UI callback fired whenever the time-of-day changes (slider, code,
   *  etc.) so the slider label can re-render. */
  onTimeOfDayChange: (time: number) => void = () => {};
  /** UI callback for sun azimuth (radians). */
  onSunAzimuthChange: (rad: number) => void = () => {};
  /** UI callback for sun intensity multiplier. */
  onSunIntensityChange: (mult: number) => void = () => {};
  /** Active environment preset (baseplate color + surround). */
  environment: EnvironmentDef = ENVIRONMENTS[0];
  /** Large plane or Water object that sits under/around the baseplate
   *  tiles to give the illusion of an infinite environment. */
  private surroundMesh: THREE.Object3D | null = null;
  /** Cached water-normals texture — reused whenever we toggle back into
   *  an environment with surroundType === 'water'. */
  private waterNormalsTex: THREE.Texture | null = null;
  /** Invisible 2000×2000 plane at y=0, used as a raycast target ONLY when
   *  the bridge block is selected. Lets the user point at empty space
   *  (water / off-tile / gap between baseplates) to position a bridge. */
  private bridgePlane: THREE.Mesh | null = null;
  /** Sharks swimming around the island environment. */
  private sharks: {
    group: THREE.Group;
    angle: number;
    speed: number;
    radiusX: number;
    radiusZ: number;
    phase: number;
    tailBone: THREE.Object3D;
  }[] = [];
  // Map-extension mode — translucent tile-shaped "slots" appear at every
  // empty horizontal neighbor of an existing baseplate. The user clicks a
  // slot to add a real tile there.
  addBaseplateMode = false;
  private slotsGroup: THREE.Group | null = null;
  private currentSlot: THREE.Mesh | null = null;

  // Line placement state (Shift + drag)
  private shiftLineStart: { x: number; y: number; z: number } | null = null;
  private shiftLinePlaced: Set<string> = new Set();

  // Play mode state
  isPlaying = false;
  viewMode: ViewMode = 'first';

  // Pac-Man game mode state (separate from isPlaying). When
  // isPacmanPlaying is true, arrow-key grid movement drives the player
  // and the camera is locked to a fixed top-down angle — no mouse look.
  isPacmanPlaying = false;
  private pacmanScore = 0;
  private pacmanLives = 3;
  /** Current stage (1..∞). Clearing the maze bumps this and rebuilds
   *  with faster ghosts + shorter frightened time. */
  private pacmanStage = 1;
  private pacmanPelletCount = 0;
  private pacmanPelletsRemaining = 0;
  private pacmanStartTime = 0;
  private pacmanHUDEl: HTMLElement | null = null;
  private pacmanHUDScoreEl: HTMLElement | null = null;
  private pacmanHUDPelletsEl: HTMLElement | null = null;
  private pacmanHUDLivesEl: HTMLElement | null = null;
  private pacmanHUDStageEl: HTMLElement | null = null;
  private pacmanOverlayEl: HTMLElement | null = null;
  /** Fruit bonus mesh — appears in the center after half the pellets
   *  are eaten, disappears after a while if not collected. Points
   *  scale with stage number for a classic risk/reward mechanic. */
  private pacmanFruit: THREE.Mesh | null = null;
  private pacmanFruitTimer = 0;
  private pacmanFruitValue = 100;
  /** True once the fruit has been spawned this stage (don't re-spawn). */
  private pacmanFruitSpawned = false;
  /** Per-axis arrow-key state + sprint flag. Separate from moveKeys so
   *  normal WASD play mode isn't affected by Pac-Man controls. */
  private pacmanKeys = {
    up: false,
    down: false,
    left: false,
    right: false,
    run: false,
  };
  /** Root group holding all auto-generated maze geometry for the Pac-Man
   *  game. Added to the scene on startPacman, fully disposed + removed
   *  on stopPacman so nothing leaks into the build-mode state. */
  private pacmanMazeGroup: THREE.Group | null = null;
  /** Parsed maze grid — each cell is a 1-stud square. Used by the
   *  ghost AI for path planning and wrap-around tunnel handling. */
  private pacmanGrid: string[] = [];
  /** World-space origin of grid cell (0,0). Center-cell world X/Z =
   *  pacmanGridOriginX + col, pacmanGridOriginZ + row. */
  private pacmanGridOriginX = 0;
  private pacmanGridOriginZ = 0;
  /** Player start (world space) */
  private pacmanPlayerSpawn = new THREE.Vector3();
  /** Ghosts — 4 colored chasers with a small state machine. */
  private pacmanGhosts: Array<{
    obj: THREE.Group;
    color: number;
    personality: 'chase' | 'ambush' | 'random' | 'scatter';
    spawn: THREE.Vector3;
    dir: { x: number; z: number };
    speed: number;
    /** Grid cell the ghost is currently heading for (center of cell). */
    target: { x: number; z: number };
    state: 'scatter' | 'chase' | 'frightened' | 'eaten';
    stateTimer: number;
    /** Last grid cell this ghost was in. Used to detect cell-crossings
     *  so we only re-pick direction ONCE per cell (without this the
     *  ghost oscillates around the spawn cell center forever). */
    lastCell: { c: number; r: number } | null;
  }> = [];
  /** If frightened > 0, ghosts are edible and fleeing. Counts down each
   *  frame; entered by eating a power pellet. */
  private pacmanFrightenedTime = 0;
  /** Grid cell pitch in world units. Matches the "Image #4" reference
   *  state the user had before any of my rework attempts. */
  private readonly PACMAN_CELL = 2.2;
  /** Wall thickness — fills the cell. */
  private readonly PACMAN_WALL_W = 2.2;
  /** Which camera mode is active in Pac-Man game mode. */
  private pacmanViewMode: 'top' | 'first' = 'top';
  /** Cardinal facing direction used by first-person "tank controls"
   *  (←/→ rotate 90°, ↑/↓ move forward/back). Always a unit cardinal
   *  vector. In top-down mode the player moves in absolute directions
   *  and this field is ignored. */
  private pacmanFacing: { x: number; z: number } = { x: 0, z: -1 };
  /** Minimap canvas + 2D context. Only visible in first-person mode. */
  private pacmanMinimapEl: HTMLCanvasElement | null = null;
  private pacmanMinimapCtx: CanvasRenderingContext2D | null = null;
  /** Brief "ready" pause at the start of a life so the player sees the
   *  maze before ghosts start moving. Counts down each frame. */
  private pacmanReadyTimer = 0;
  /** Death animation timer — ghosts pause, player spins and fades. */
  private pacmanDeathTimer = 0;
  /** Saved visibility of the build-mode brickGroup — restored on exit. */
  private pacmanSavedBrickVisible = true;
  private playAABBs: THREE.Box3[] = [];
  /** Parallel array to playAABBs. Non-null entries mark a collider that
   *  belongs to an interactable door — collision skips these while the
   *  door is animating or open (see doorAnimations). */
  private playAABBDoorRefs: (THREE.Object3D | null)[] = [];
  /** Active door animations (closed doors are not in the map). Keyed on
   *  the door's root group. */
  private doorAnimations = new Map<
    THREE.Object3D,
    { state: 'opening' | 'open' | 'closing'; t: number }
  >();
  /** The door closest to the player within interaction range, or null.
   *  Drives the on-screen "[E] 문 열기" prompt. */
  private currentDoorHotspot: THREE.Object3D | null = null;
  private doorPromptEl: HTMLElement | null = null;
  private doorPromptLabelEl: HTMLElement | null = null;
  /** Wandering NPCs built from every minifig placed during build mode.
   *  Each entry holds the mutable runtime state (target, yaw, state
   *  machine) and references the original group for position/rotation
   *  updates. Rebuilt at every startPlay(); cleared at stopPlay(). */
  private npcs: NpcState[] = [];
  private currentNpcHotspot: NpcState | null = null;
  private npcPromptEl: HTMLElement | null = null;
  private npcPromptLabelEl: HTMLElement | null = null;
  private npcBubbleEl: HTMLElement | null = null;
  private npcBubbleTextEl: HTMLElement | null = null;
  /** When the player is riding a playground module, this holds the
   *  block + ride type + per-type animation state. The ride locks the
   *  player to the equipment surface and overrides normal physics
   *  until they dismount (E) or the ride finishes (slide reaches exit). */
  private playgroundRide: PlaygroundRideState | null = null;
  /** Active vehicle ride — player is driving a car/train. Exclusive
   *  with playgroundRide (can't ride both at once). */
  private vehicleRide: VehicleRideState | null = null;
  /** Nearest driveable vehicle within interaction range. */
  private vehicleHotspot: { obj: THREE.Object3D; type: 'car' | 'train' } | null = null;
  /** Nearest playground module within interaction range. Drives the
   *  on-screen "[E] 타기" prompt. Null when nothing is in range or the
   *  player is already riding. */
  private playgroundHotspot:
    | { obj: THREE.Object3D; type: PlaygroundType }
    | null = null;
  private playgroundPromptEl: HTMLElement | null = null;
  private playgroundPromptLabelEl: HTMLElement | null = null;
  private playerPos = new THREE.Vector3(0, 0, 15);
  private playerVel = new THREE.Vector3();
  private onGround = false;
  private moveKeys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    run: false,
  };
  /** External override for movement input — used by the mobile virtual
   *  joystick to drive the player without going through keyboard events.
   *  Values are analog (-1..1) and combined with keyboard state each
   *  frame. Setting to 0/0 clears the override. */
  public analogMove = { x: 0, y: 0 };
  /** Set by the mobile jump button. One-shot — cleared after consumption. */
  public mobileJumpPressed = false;
  /** Held by the mobile sprint button. */
  public mobileRunning = false;
  private savedCam = {
    position: new THREE.Vector3(28, 28, 28),
    target: new THREE.Vector3(0, 2, 0),
  };
  // Visible avatar in the world (used in 3rd-person, hidden in 1st-person)
  private playerAvatar: THREE.Group | null = null;
  private avatarYaw = 0; // facing direction in radians
  private walkTime = 0;  // accumulator for limb-swing animation
  private swimTime = 0;  // accumulator for swim-stroke animation
  private isSwimming = false;
  private thirdPersonDistance = 14;
  private wasMovingForJumpAnim = false;

  // Event callbacks
  onCountChange: (count: number) => void = () => {};
  onRotationChange: (step: number) => void = () => {};
  onBlockTypeChange: (type: BlockType) => void = () => {};
  onCharacterChange: (preset: MinifigPreset) => void = () => {};
  onModeChange: (mode: Mode) => void = () => {};
  onPlayChange: (playing: boolean) => void = () => {};
  /** Fired after a block is actually added to the scene (local or remote).
   *  Carries the full created group so consumers can read its userData. */
  onBlockPlaced: (obj: THREE.Object3D, local: boolean) => void = () => {};
  /** Fired before a block is removed from the scene. `local` is true if
   *  the removal originated from this client's interaction. */
  onBlockRemoved: (obj: THREE.Object3D, local: boolean) => void = () => {};
  /** When true, Game will NOT fire local-place/remove callbacks and
   *  won't play click sounds — used while applying remote changes so
   *  they don't loop back through the multiplayer broadcast. */
  suppressBlockCallbacks = false;
  /** Fires when entering/leaving Pac-Man game mode. UI uses this to
   *  toggle the game button's active state. */
  onPacmanPlayChange: (playing: boolean) => void = () => {};
  onBoardSizeChange: (size: number) => void = () => {};
  onAddBaseplateModeChange: (active: boolean) => void = () => {};
  onEnvironmentChange: (env: EnvironmentDef) => void = () => {};
  onViewModeChange: (mode: ViewMode) => void = () => {};
  /** Fires when the user clears the current selection (e.g. by pressing
   *  Escape). UI should remove the active highlight from all type buttons. */
  onSelectionCleared: () => void = () => {};
  /** Fires when entering/leaving play mode if at least one dog NPC is on
   *  the baseplate — UI shows/hides the dog-whistle button accordingly. */
  onDogsPresentChange: (present: boolean) => void = () => {};
  /** Fires when the whistle toggles dogs between follow / wander — UI
   *  updates the "active" highlight on the whistle button. */
  onDogsFollowingChange: (following: boolean) => void = () => {};

  /** When true, no ghost is rendered and clicks don't place anything.
   *  Cleared the moment the user picks a block type or switches mode. */
  private placementSuspended = false;
  /** Keyboard cursor for arrow-key ghost placement in build mode.
   *  When active, computePlacement uses a downward raycast from this
   *  world-space XZ instead of the pointer-based camera raycast. */
  private kbCursor = { x: 0, z: 0, active: false };
  /** Timestamp of the last keyboard-driven ghost move. Used by
   *  onPointerMove to ignore small mouse hovers for a short cooldown
   *  after an arrow-key nudge — otherwise a Bluetooth mouse's micro-
   *  drift snaps the ghost back to the cursor and the user can't
   *  see their keyboard edits. */
  private kbCursorLastMove = 0;
  /** Last direction the user nudged the ghost. Used by placeAtGhost
   *  so the ghost auto-advances to the next cell in that direction
   *  after a placement — otherwise the ghost stacks on top of the
   *  just-placed block and the user has to manually nudge every time. */
  private kbCursorLastDir: 'up' | 'down' | 'left' | 'right' = 'up';
  /** Last placed block position + "line streak" mode. Space bar places
   *  a block and turns the streak ON. While the streak is on, arrow
   *  keys place NEW consecutive blocks in the pressed direction (one
   *  footprint step per press, with key-repeat) instead of just moving
   *  the ghost cursor. Escape / mode change / type change ends it. */
  private lastPlacedPos: { x: number; y: number; z: number } | null = null;
  private lineStreakActive: boolean = false;
  /** True while the player has active dogs following them — toggled by
   *  `whistleDogs()`. Only meaningful during play mode. */
  private dogsFollowing = false;

  constructor(container: HTMLElement) {
    this.container = container;
    const rect = container.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
    this.camera.position.set(28, 28, 28);

    // Renderer — quality auto-degrades on mobile so low-end phones
    // maintain 60fps. Desktop keeps full fidelity.
    const isMobileDevice =
      (typeof matchMedia === 'function' &&
        matchMedia('(pointer: coarse)').matches) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    // Antialias is expensive on mobile GPUs; disable for mobile and
    // rely on the higher DPR to smooth edges instead.
    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobileDevice,
      powerPreference: isMobileDevice ? 'low-power' : 'high-performance',
      // REQUIRED for captureThumbnail() (mapStorage.ts) to return a
      // non-empty PNG. Without this the drawing buffer is cleared
      // after every swap, so canvas.toBlob() returns a black image
      // and saved maps get blank thumbnails on the dashboard.
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(width, height);
    // Mobile caps DPR at 1.5 — huge perf win on retina phones without
    // a visible quality drop at typical viewing distances.
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, isMobileDevice ? 1.5 : 2)
    );
    // Shadows are a major GPU cost. Keep them off on mobile by default;
    // the user can re-enable via a settings toggle later.
    this.renderer.shadowMap.enabled = !isMobileDevice;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Visible background: a clean uniform light gray. Stays the same color
    // from every camera angle — no horizon, no banding, no surprises. This
    // is the standard approach in product visualization (Blender, KeyShot,
    // etc.): the visible backdrop is a flat color, and a separate HDRI
    // provides the actual lighting from off-screen.
    this.scene.background = new THREE.Color(0xeef0f3);

    // PBR environment lighting from a real photographic HDRI — used ONLY
    // for reflections and fill light on the bricks. Never assigned to
    // scene.background, so the visible backdrop stays uniform regardless
    // of camera angle.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load(
      'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_43d_clear_puresky_1k.hdr',
      (hdri) => {
        hdri.mapping = THREE.EquirectangularReflectionMapping;
        const envMap = pmrem.fromEquirectangular(hdri).texture;
        this.scene.environment = envMap;
        // Soft fill only — keep low so the directional sun's shadows
        // remain clearly visible against the lit surfaces.
        this.scene.environmentIntensity = 0.55;
        hdri.dispose();
        pmrem.dispose();
      },
      undefined,
      (err) => {
        console.error('[hdri] failed to load environment HDRI:', err);
      }
    );

    // Orbit controls (build mode)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    // Wheel zoom anchors at the mouse pointer instead of the orbit target,
    // so scrolling zooms INTO whatever the cursor is over.
    this.controls.zoomToCursor = true;
    this.controls.target.set(0, 2, 0);
    // LEFT drag: rotate camera (default)
    // MIDDLE drag: also rotate camera (user request)
    // RIGHT drag/click: reserved — right click rotates the current block
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    (
      this.controls.mouseButtons as unknown as {
        LEFT: number;
        MIDDLE: number;
        RIGHT: number | null;
      }
    ).RIGHT = null;

    // Touch bindings — natural tablet feel: 1 finger rotates the camera
    // (every tablet app does this), 2 fingers pinch-zoom / pan. Block
    // placement on touch uses a "tap anywhere = place at screen center"
    // pattern (see updatePointer and the build-mode reticle) so the
    // finger never needs to touch the target cell, and camera orbit
    // stays the primary gesture.
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    this.setupLights();
    this.createBaseplate();
    this.scene.add(this.brickGroup);

    // Ghost preview
    this.ghost = createGhost({
      w: this.size.w,
      d: this.size.d,
      heightPlates: this.currentGhostHeightPlates(),
      colorHex: this.color.hex,
    });
    this.ghost.userData.type = this.blockType;
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // Remove-mode hover outline
    const hoverGeom = new THREE.BoxGeometry(1, 1, 1);
    const hoverEdges = new THREE.EdgesGeometry(hoverGeom);
    this.hoverBox = new THREE.LineSegments(
      hoverEdges,
      new THREE.LineBasicMaterial({
        color: 0xff3344,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      })
    );
    this.hoverBox.renderOrder = 999;
    this.hoverBox.visible = false;
    this.scene.add(this.hoverBox);

    // Events
    window.addEventListener('resize', () => this.onResize());
    // Single bubble-phase listener on document — fires regardless of focus
    // and avoids the double-fire issue from window+document capture pairing.
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(container);

    const dom = this.renderer.domElement;
    // Let the canvas own every touch gesture — otherwise the browser
    // hijacks single-finger drags as page scrolls on tablets.
    dom.style.touchAction = 'none';
    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    dom.addEventListener('pointerup', (e) => this.onPointerUp(e));
    dom.addEventListener('pointercancel', () => {
      this.wasDrag = false;
    });
    dom.addEventListener('pointerleave', () => {
      this.ghost.visible = false;
      this.hoverBox.visible = false;
      this.clearRemoveHover();
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener(
      'wheel',
      (e) => {
        if (this.isPlaying && this.viewMode === 'third') {
          // Zoom the iso camera in/out
          this.thirdPersonDistance = Math.max(
            6,
            Math.min(40, this.thirdPersonDistance + e.deltaY * 0.015)
          );
          e.preventDefault();
        }
      },
      { passive: false }
    );

    this.animate();
  }

  // ------------------------------------------------------------------
  //  Scene setup
  // ------------------------------------------------------------------

  private setupLights() {
    // Direct sun — strong enough to throw clearly visible shadows even
    // against the HDRI environment fill. Slight warm tint so the lit side
    // of bricks reads as "sunlit" rather than studio-flat.
    const sun = new THREE.DirectionalLight(0xfff4d6, 3.6);
    sun.position.set(15, 42, -22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0001;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.sunLight = sun;
    this.updateSunShadowBounds();
    this.scene.add(sun);

    // Make sure the directional light has a target IN the scene so its
    // world matrix updates whenever we move the target.position. Three's
    // DirectionalLight aims at sun.position − sun.target.position, so
    // keeping the target at world origin gives a clean light direction.
    this.scene.add(sun.target);

    // Visible sun disc — a billboarded bright sphere with soft halos so
    // the sun is actually IN the scene, not just an invisible shader light.
    // Positioned along the directional light's direction, far enough away
    // that it stays put as the camera orbits.
    const sunDisc = this.createSunDisc();
    sunDisc.position.copy(sun.position).normalize().multiplyScalar(300);
    this.sunDisc = sunDisc;
    this.scene.add(sunDisc);

    // Moon disc — pale, smaller, follows the sun's antipode.
    const moonDisc = this.createMoonDisc();
    this.moonDisc = moonDisc;
    this.scene.add(moonDisc);

    // Starfield — 2000 white points scattered on the upper hemisphere.
    const stars = this.createStarfield();
    this.starField = stars;
    this.scene.add(stars);

    // Apply the default time-of-day so sun position/intensity/sky/HDRI
    // are all in sync from the start. Subsequent slider drags call this
    // again to re-light the scene.
    this.setTimeOfDay(this.timeOfDay);
  }

  /** A small white-blue moon — two layered sprites (bright core + soft
   *  halo). Same additive technique as the sun but smaller and cooler. */
  private createMoonDisc(): THREE.Group {
    const group = new THREE.Group();
    const baseRenderOrder = 1000;

    const coreTex = this.makeRadialTexture(
      'rgba(245, 250, 255, 1.0)',
      'rgba(220, 230, 255, 0.0)',
      0.4
    );
    const coreMat = new THREE.SpriteMaterial({
      map: coreTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      opacity: 0,
    });
    const core = new THREE.Sprite(coreMat);
    core.scale.set(20, 20, 1);
    core.renderOrder = baseRenderOrder + 2;
    group.add(core);

    const haloTex = this.makeRadialTexture(
      'rgba(180, 200, 255, 0.5)',
      'rgba(120, 150, 230, 0.0)'
    );
    const haloMat = new THREE.SpriteMaterial({
      map: haloTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      opacity: 0,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(46, 46, 1);
    halo.renderOrder = baseRenderOrder + 1;
    group.add(halo);

    this.moonDiscLayers = { core: coreMat, halo: haloMat };
    group.visible = false;
    return group;
  }

  /** ~2000 white points on a large upper hemisphere. Stars are rendered
   *  as fixed-pixel points (no perspective falloff) so they look like
   *  the night sky from any camera angle. Opacity = 0 by day, fades in
   *  as the sun drops below the horizon. */
  private createStarfield(): THREE.Points {
    const count = 2000;
    const radius = 290;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on upper hemisphere
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(v); // 0..π/2 → upper hemisphere
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      positions[i * 3] = x * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = z * radius;
      // Slight color variety: most white, some warm/cool
      const tint = 0.85 + Math.random() * 0.15;
      const cool = Math.random() < 0.2;
      colors[i * 3] = cool ? tint * 0.85 : tint;
      colors[i * 3 + 1] = tint;
      colors[i * 3 + 2] = cool ? 1 : tint * (0.92 + Math.random() * 0.08);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const points = new THREE.Points(geom, mat);
    points.renderOrder = 998;
    return points;
  }

  /** Drives the entire day/night cycle from a single 0..24 time value.
   *
   *  - Sun position is placed on a great-circle through the sky: rising
   *    at +X (east) at 06:00, peaking overhead near 12:00, setting at
   *    -X (west) at 18:00, and dropping below the horizon at night.
   *  - Sun intensity goes to ~0 below the horizon, peaks at noon.
   *  - Sun color shifts from warm orange (horizon) to neutral white
   *    (zenith), and a cool moonlight tone at deep night.
   *  - Sky background lerps blue → orange (sunset) → dark blue (night).
   *  - HDRI environment fill drops at night so the scene doesn't read
   *    as fully lit when the sun is gone. */
  setTimeOfDay(time: number) {
    // Wrap into [0, 24) so dragging or scripting past midnight works.
    const t = ((time % 24) + 24) % 24;
    this.timeOfDay = t;

    // Solar angle: 0 at sunrise (+X horizon), π/2 at noon (zenith),
    // π at sunset (-X horizon), 3π/2 at midnight (-Y, below ground).
    const sunAngle = ((t - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(sunAngle); // -1..+1
    const azim = -Math.cos(sunAngle); // +1 east at sunrise, -1 west at sunset

    // Place the directional light along (azim, elev, slight north tilt).
    // Use a far distance so the rays read as parallel across the board.
    // Then rotate the whole arc around the world Y axis by sunAzimuth
    // so the user can swing where sunrise/sunset come from.
    const distance = 80;
    const localX = azim * distance;
    const localY = elev * distance;
    const localZ = -distance * 0.4; // small north offset → diagonal shadows
    const cosAz = Math.cos(this.sunAzimuth);
    const sinAz = Math.sin(this.sunAzimuth);
    const sunX = localX * cosAz + localZ * sinAz;
    const sunY = localY;
    const sunZ = -localX * sinAz + localZ * cosAz;
    if (this.sunLight) {
      this.sunLight.position.set(sunX, sunY, sunZ);

      // Intensity: smooth ramp from horizon (0) to zenith (full),
      // with a tiny floor so deep night isn't pitch black. Scaled by
      // the user's manual intensity multiplier on top of that.
      const dayFactor = Math.max(0, elev);
      this.sunLight.intensity =
        (0.05 + dayFactor * 3.55) * this.sunIntensityScale;

      // Color: warm at horizon → neutral at zenith → cool moonlight at
      // deep night. Lerp via THREE.Color.
      const cNoon = new THREE.Color(0xfff4d6);
      const cHorizon = new THREE.Color(0xff8a3a);
      const cMoon = new THREE.Color(0x6a86c0);
      let sunColor: THREE.Color;
      if (elev > 0.2) {
        const k = Math.min(1, (elev - 0.2) / 0.7);
        sunColor = cHorizon.clone().lerp(cNoon, k);
      } else if (elev > 0) {
        sunColor = cHorizon.clone();
      } else {
        const k = Math.min(1, -elev / 0.4);
        sunColor = cHorizon.clone().lerp(cMoon, k);
      }
      this.sunLight.color.copy(sunColor);
    }

    // Sun disc: track the directional light's direction at large radius
    // and hide it once the sun is below the horizon. Also tint each
    // layer to match the time of day (white-gold at noon, deep orange
    // at sunset).
    const sunDirNorm = new THREE.Vector3(sunX, sunY, sunZ);
    if (sunDirNorm.lengthSq() > 0) sunDirNorm.normalize();
    if (this.sunDisc) {
      this.sunDisc.position.copy(sunDirNorm).multiplyScalar(300);
      this.sunDisc.visible = elev > -0.1;
    }
    this.updateSunDiscAppearance(elev);

    // Moon disc: lives at the antipode of the sun. Visible only when
    // the sun is below the horizon (so we always have ONE celestial
    // body in the sky), with opacity ramping in over the dusk window.
    if (this.moonDisc && this.moonDiscLayers) {
      this.moonDisc.position.copy(sunDirNorm).multiplyScalar(-300);
      const moonVis = Math.max(0, Math.min(1, (-elev + 0.05) / 0.2));
      this.moonDisc.visible = moonVis > 0;
      this.moonDiscLayers.core.opacity = moonVis;
      this.moonDiscLayers.halo.opacity = moonVis * 0.85;
    }

    // Starfield: opacity follows -elev, fading in across dusk.
    if (this.starField) {
      const starVis = Math.max(0, Math.min(1, (-elev + 0.05) / 0.25));
      const starMat = this.starField.material as THREE.PointsMaterial;
      starMat.opacity = starVis;
      this.starField.visible = starVis > 0;
    }

    // Tone-mapping exposure: dim slightly at night for a moodier look.
    // Day = 1.0, deep night = 0.55. Smooth lerp on dayFactor.
    {
      const dayK = Math.max(0, Math.min(1, (elev + 0.1) / 0.4));
      this.renderer.toneMappingExposure = 0.55 + dayK * 0.55;
    }

    // HDRI environment rotation tracks the sun azimuth so the bricks'
    // PBR reflections agree with the sun direction. (Three's
    // environmentRotation was added in r163.)
    const envRot = (this.scene as THREE.Scene & {
      environmentRotation?: THREE.Euler;
    }).environmentRotation;
    if (envRot) envRot.set(0, this.sunAzimuth, 0);

    // Sky color: bright daytime → orange sunset/sunrise → dark night.
    const skyDay = new THREE.Color(0xeef0f3);
    const skySunset = new THREE.Color(0xff8a55);
    const skyNight = new THREE.Color(0x07091e);
    let sky: THREE.Color;
    if (elev > 0.3) {
      sky = skyDay.clone();
    } else if (elev > 0) {
      const k = elev / 0.3;
      sky = skySunset.clone().lerp(skyDay, k);
    } else {
      const k = Math.min(1, -elev / 0.3);
      sky = skySunset.clone().lerp(skyNight, k);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(sky);
    } else {
      this.scene.background = sky;
    }

    // HDRI fill brightness — drops to a low floor at night so the scene
    // is dim but not invisible.
    const envDay = 0.55;
    const envNight = 0.08;
    this.scene.environmentIntensity =
      envNight + Math.max(0, elev) * (envDay - envNight);

    // Lamps glow + cast PointLight illumination at night. Compute the
    // night factor (0 = full day, 1 = deep night) from the same solar
    // elevation we already use for sun/sky and apply it to every lamp.
    this.currentNightFactor = Math.max(0, Math.min(1, -elev * 2));
    this.updateAllLamps();

    this.onTimeOfDayChange(t);
  }

  /** 0..1 — used by lamps and any other emissive blocks to fade their
   *  glow in/out smoothly with the time-of-day slider. Updated by
   *  setTimeOfDay() and read by updateLampForTime(). */
  private currentNightFactor = 0;

  /** Iterate every placed block and apply current-night lamp lighting
   *  to any lamp blocks. Cheap because lamps are tagged with
   *  userData.isLamp at creation. */
  private updateAllLamps() {
    for (const child of this.brickGroup.children) {
      if (child.userData.isLamp) {
        this.updateLampForTime(child);
      }
    }
  }

  /** Apply the current night factor to a single lamp's bulb material
   *  and SpotLight. Used by updateAllLamps and also called when a new
   *  lamp is placed so it picks up the live time-of-day immediately. */
  private updateLampForTime(lamp: THREE.Object3D) {
    const n = this.currentNightFactor;

    // Bulb emissive — visibly glows in the dark scene
    const mat = lamp.userData.lampBulbMaterial as
      | THREE.MeshStandardMaterial
      | undefined;
    if (mat) {
      // 0.5 daytime → 4.5 deep night (very bright in night scene)
      mat.emissiveIntensity = 0.5 + n * 4.0;
    }

    // Light — pours warm light onto the surrounding ground. Lamp posts
    // use a downward SpotLight; campfires use an omnidirectional
    // PointLight. The light type is baked in at creation time, we only
    // modulate intensity here via the night factor (plus an optional
    // per-block scale for blocks that should glow extra brightly).
    // Three.js r155+ physical lighting expects candela. A real
    // streetlight ranges from a few hundred to a few thousand cd; we
    // use 600 so the floor pool clearly reads against the dim night
    // ambient (sun ~0.05, env ~0.08) without any fake decal helper.
    const light = lamp.userData.lampLight as
      | THREE.SpotLight
      | THREE.PointLight
      | undefined;
    if (light) {
      const scale = (lamp.userData.lampIntensityScale as number) ?? 1;
      light.intensity = n * 600 * scale;
    }
  }

  /** Apply night factor to a campfire — brighter flames and stronger
  /** Read-only accessor for the current time-of-day (0..24 float). */
  getTimeOfDay(): number {
    return this.timeOfDay;
  }

  /** Sets the sun's compass direction (radians) and re-applies the
   *  full lighting state so the slider feels live. */
  setSunAzimuth(rad: number) {
    // Wrap into [0, 2π) so dragging past full rotation works.
    const a = ((rad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.sunAzimuth = a;
    this.setTimeOfDay(this.timeOfDay);
    this.onSunAzimuthChange(a);
  }

  /** Read-only accessor for sun azimuth in radians. */
  getSunAzimuth(): number {
    return this.sunAzimuth;
  }

  /** Sets the user-facing sun intensity multiplier (clamped 0..3) and
   *  re-applies the lighting state. */
  setSunIntensityScale(mult: number) {
    const m = Math.max(0, Math.min(3, mult));
    this.sunIntensityScale = m;
    this.setTimeOfDay(this.timeOfDay);
    this.onSunIntensityChange(m);
  }

  /** Read-only accessor for the sun intensity multiplier. */
  getSunIntensityScale(): number {
    return this.sunIntensityScale;
  }

  /** Builds a soft radial-gradient texture for use as a sun-glow sprite.
   *  `innerStop` is how far from the center the gradient stays at full
   *  opacity (0 = pure radial, 0.4 = hard disc with soft falloff). */
  private makeRadialTexture(
    innerColor: string,
    outerColor: string,
    innerStop = 0
  ): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2
      );
      grad.addColorStop(0, innerColor);
      if (innerStop > 0) grad.addColorStop(innerStop, innerColor);
      grad.addColorStop(1, outerColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Visible sun: layered additive sprites — a hard bright core plus
   *  three increasingly soft halos. Uses additive blending so the
   *  layers stack into a real glow against any sky color, and screen-
   *  facing sprites so the sun looks round from every camera angle.
   *
   *  Each layer's tint is updated by setTimeOfDay so the sun goes from
   *  white-gold at noon to a deep red-orange ball at the horizon. */
  private createSunDisc(): THREE.Group {
    const group = new THREE.Group();

    // Render LAST so the glow always wins against the gray sky.
    const baseRenderOrder = 1000;

    // 1) Hard bright core — small, near-opaque, mostly white.
    const coreTex = this.makeRadialTexture(
      'rgba(255, 255, 245, 1.0)',
      'rgba(255, 240, 200, 0.0)',
      0.35
    );
    const coreMat = new THREE.SpriteMaterial({
      map: coreTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const core = new THREE.Sprite(coreMat);
    core.scale.set(28, 28, 1);
    core.renderOrder = baseRenderOrder + 3;
    group.add(core);

    // 2) Inner halo — twice the core, warm gold.
    const haloTex = this.makeRadialTexture(
      'rgba(255, 220, 150, 0.85)',
      'rgba(255, 180, 80, 0.0)'
    );
    const haloMat = new THREE.SpriteMaterial({
      map: haloTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(70, 70, 1);
    halo.renderOrder = baseRenderOrder + 2;
    group.add(halo);

    // 3) Outer glow — broad orange falloff (atmospheric glow).
    const glowTex = this.makeRadialTexture(
      'rgba(255, 170, 80, 0.55)',
      'rgba(255, 110, 50, 0.0)'
    );
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(150, 150, 1);
    glow.renderOrder = baseRenderOrder + 1;
    group.add(glow);

    // 4) Soft lens-flare bloom — very wide, very faint.
    const flareTex = this.makeRadialTexture(
      'rgba(255, 200, 120, 0.25)',
      'rgba(255, 150, 60, 0.0)'
    );
    const flareMat = new THREE.SpriteMaterial({
      map: flareTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const flare = new THREE.Sprite(flareMat);
    flare.scale.set(280, 280, 1);
    flare.renderOrder = baseRenderOrder;
    group.add(flare);

    this.sunDiscLayers = {
      core: coreMat,
      halo: haloMat,
      glow: glowMat,
      flare: flareMat,
      coreSprite: core,
      haloSprite: halo,
      glowSprite: glow,
      flareSprite: flare,
    };

    return group;
  }

  /** Tint and scale the sun disc layers based on the current sun
   *  elevation. Mid-day the sun is a bright white-gold ball with a
   *  modest halo; near the horizon (sunrise/sunset) it bloats into a
   *  large red-orange disc; below the horizon it fades out. */
  private updateSunDiscAppearance(elev: number) {
    const layers = this.sunDiscLayers;
    if (!layers) return;

    // dayK ramps 0..1 as the sun rises from the horizon.
    const dayK = Math.max(0, Math.min(1, (elev + 0.05) / 0.5));

    // Core color: warm gold at horizon → near-white at zenith.
    const cHorizon = new THREE.Color(0xffb060);
    const cNoon = new THREE.Color(0xfff7d0);
    layers.core.color.copy(cHorizon).lerp(cNoon, dayK);

    // Halo color: deep orange at horizon → soft yellow at zenith.
    const haloHorizon = new THREE.Color(0xff7a30);
    const haloNoon = new THREE.Color(0xffd070);
    layers.halo.color.copy(haloHorizon).lerp(haloNoon, dayK);

    // Outer glow color: red at horizon → faint amber at zenith.
    const glowHorizon = new THREE.Color(0xff5520);
    const glowNoon = new THREE.Color(0xffaa50);
    layers.glow.color.copy(glowHorizon).lerp(glowNoon, dayK);

    // Lens-flare color: same family, very subtle.
    const flareHorizon = new THREE.Color(0xff7030);
    const flareNoon = new THREE.Color(0xffc880);
    layers.flare.color.copy(flareHorizon).lerp(flareNoon, dayK);

    // Bloat the disc near the horizon (atmospheric refraction look) and
    // shrink it as the sun climbs. Multiply each layer by the same
    // bloatK so the proportions stay the same.
    const bloatK = 1 + (1 - dayK) * 0.7;
    layers.coreSprite.scale.set(28 * bloatK, 28 * bloatK, 1);
    layers.haloSprite.scale.set(70 * bloatK, 70 * bloatK, 1);
    layers.glowSprite.scale.set(150 * bloatK, 150 * bloatK, 1);
    layers.flareSprite.scale.set(280 * bloatK, 280 * bloatK, 1);

    // Fade everything out under the horizon — already hidden via
    // sunDisc.visible in setTimeOfDay, but also fade material opacity
    // for the brief moments around sunrise/sunset transitions.
    const visK = Math.max(0, Math.min(1, (elev + 0.1) / 0.15));
    layers.core.opacity = visK;
    layers.halo.opacity = visK;
    layers.glow.opacity = visK;
    layers.flare.opacity = visK;
  }

  /** Recompute the directional-light shadow frustum so it covers every
   *  baseplate tile from ANY sun angle. We use a sphere-based bound:
   *  the LRTB are set to a square that inscribes the world bounding
   *  sphere, and the sun's `target` is moved to the world center so
   *  the orthographic camera always points at the scene mid-point.
   *  This way the same frustum works whether the sun is overhead or
   *  on the horizon. */
  private updateSunShadowBounds() {
    if (!this.sunLight) return;
    let minX = -this.tileSize / 2;
    let maxX = this.tileSize / 2;
    let minZ = -this.tileSize / 2;
    let maxZ = this.tileSize / 2;
    for (const tile of this.baseplates.values()) {
      const cx = tile.position.x;
      const cz = tile.position.z;
      const half = this.tileSize / 2;
      if (cx - half < minX) minX = cx - half;
      if (cx + half > maxX) maxX = cx + half;
      if (cz - half < minZ) minZ = cz - half;
      if (cz + half > maxZ) maxZ = cz + half;
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    // Bounding sphere radius in world XZ + a vertical safety margin for
    // tall block stacks. sqrt of (half-diagonal)² + verticalReach².
    const halfDiag = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    const verticalReach = 30; // generous: tall jungle gym + minifig
    const radius = Math.sqrt(halfDiag * halfDiag + verticalReach * verticalReach) + 6;

    const cam = this.sunLight.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.updateProjectionMatrix();

    // Aim the directional light at the world center so the orthographic
    // frustum's local axes are centered on the scene rather than on the
    // origin (matters when the player has moved off-tile).
    this.sunLight.target.position.set(centerX, 0, centerZ);
    this.sunLight.target.updateMatrixWorld();
  }

  /** Builds one stud-board tile group. The geometry is local to the tile —
   *  position is set by addBaseplateTile based on tile coordinates. */
  private buildBaseplateTileMesh(): THREE.Group {
    const group = new THREE.Group();
    const size = this.tileSize;
    // Thickness defaults to 0.4 (standard plate) but environments can
    // override it — e.g. "island" uses a tall cliff-like plate.
    const thickness = this.environment.baseplateThickness ?? 0.4;

    const plateMat = new THREE.MeshStandardMaterial({
      color: this.environment.baseplateColor,
      roughness: 0.7,
    });
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(size, thickness, size),
      plateMat
    );
    // Top face always sits at y=0 regardless of thickness, so placement
    // math and existing baseplate tile stacking stay unaffected.
    plate.position.y = -thickness / 2;
    plate.receiveShadow = true;
    plate.castShadow = true;
    group.add(plate);

    const studGeom = new THREE.CylinderGeometry(
      STUD_RADIUS,
      STUD_RADIUS,
      STUD_HEIGHT,
      16
    );
    const total = size * size;
    const instanced = new THREE.InstancedMesh(studGeom, plateMat, total);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        dummy.position.set(
          -size / 2 + 0.5 + x,
          STUD_HEIGHT / 2,
          -size / 2 + 0.5 + z
        );
        dummy.updateMatrix();
        instanced.setMatrixAt(i++, dummy.matrix);
      }
    }
    instanced.receiveShadow = true;
    group.add(instanced);

    group.userData.isBaseplate = true;
    return group;
  }

  /** Add a baseplate tile at the given grid coordinates (in tile units).
   *  Returns the created Group, or null if a tile already exists there. */
  addBaseplateTile(tx: number, ty: number, tz: number): THREE.Group | null {
    const key = `${tx},${ty},${tz}`;
    if (this.baseplates.has(key)) return null;

    const group = this.buildBaseplateTileMesh();
    group.position.set(
      tx * this.tileSize,
      ty * Game.TILE_LEVEL_HEIGHT,
      tz * this.tileSize
    );
    group.userData.tileX = tx;
    group.userData.tileY = ty;
    group.userData.tileZ = tz;
    group.userData.tileKey = key;
    this.scene.add(group);
    this.baseplates.set(key, group);
    this.updateSunShadowBounds();
    return group;
  }

  /** Initial setup — places the first tile at origin and the surround
   *  mesh for the default environment. */
  private createBaseplate() {
    this.addBaseplateTile(0, 0, 0);
    // Keep the legacy `baseplate` field pointing at the origin tile so any
    // existing code that touches `this.baseplate` still works.
    this.baseplate = this.baseplates.get('0,0,0')!;
    this.rebuildSurround();

    // Build the invisible bridge raycast plane once. It's a giant
    // horizontal quad at y=0 — never added to the scene, only used as a
    // raycast target inside computePlacement when blockType === 'bridge'.
    const bridgePlaneGeom = new THREE.PlaneGeometry(2000, 2000);
    const bridgePlaneMat = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
    });
    this.bridgePlane = new THREE.Mesh(bridgePlaneGeom, bridgePlaneMat);
    this.bridgePlane.rotation.x = -Math.PI / 2;
    this.bridgePlane.position.y = 0;
    // matrixWorld must be current for raycasting to work
    this.bridgePlane.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------
  //  Environment (baseplate color + surround)
  // ------------------------------------------------------------------

  /** Swap the active environment preset. Fully rebuilds every existing
   *  baseplate tile (so thickness changes like the island preset take
   *  effect) and rebuilds the surround mesh (water / ground / none). */
  setEnvironment(env: EnvironmentDef) {
    if (this.environment.id === env.id) return;

    const prevThickness = this.environment.baseplateThickness ?? 0.4;
    const nextThickness = env.baseplateThickness ?? 0.4;
    this.environment = env;

    if (prevThickness !== nextThickness) {
      // Thickness changed — every tile mesh has the wrong box geometry.
      // Destroy and rebuild each tile at the same grid coordinates.
      const tileCoords: [number, number, number][] = [];
      for (const key of this.baseplates.keys()) {
        const [tx, ty, tz] = key.split(',').map(Number);
        tileCoords.push([tx, ty, tz]);
      }
      for (const key of Array.from(this.baseplates.keys())) {
        const tile = this.baseplates.get(key)!;
        this.scene.remove(tile);
        tile.traverse((c) => {
          if (c instanceof THREE.Mesh || c instanceof THREE.InstancedMesh) {
            c.geometry?.dispose?.();
            const mat = c.material as THREE.Material | THREE.Material[];
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat?.dispose?.();
          }
        });
        this.baseplates.delete(key);
      }
      for (const [tx, ty, tz] of tileCoords) {
        this.addBaseplateTile(tx, ty, tz);
      }
      // Refresh the legacy origin-tile pointer
      this.baseplate =
        this.baseplates.get('0,0,0') ?? this.baseplates.values().next().value!;
    } else {
      // Only color changed — fast path: update each tile material in place.
      for (const tile of this.baseplates.values()) {
        tile.traverse((c) => {
          if (c instanceof THREE.Mesh || c instanceof THREE.InstancedMesh) {
            const mat = c.material as THREE.MeshStandardMaterial | undefined;
            if (mat && mat.color) mat.color.setHex(env.baseplateColor);
          }
        });
      }
    }

    this.rebuildSurround();
    this.onEnvironmentChange(env);
  }

  /** Dispose the current surround mesh (if any) and build a new one that
   *  matches `this.environment.surroundType`. */
  private rebuildSurround() {
    // Remove and dispose the previous surround mesh
    if (this.surroundMesh) {
      this.scene.remove(this.surroundMesh);
      this.surroundMesh.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry?.dispose?.();
          const mat = c.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose?.();
        }
      });
      this.surroundMesh = null;
    }

    const env = this.environment;
    // Despawn sharks whenever environment changes; re-spawn below if island
    this.despawnSharks();

    if (env.surroundType === 'none') return;

    if (env.surroundType === 'water') {
      this.surroundMesh = this.createWaterSurround(env);
      // Spawn sharks for island environment
      if (env.id === 'island') this.spawnSharks();
    } else if (env.surroundType === 'ground') {
      this.surroundMesh = this.createGroundSurround(env);
    }
    if (this.surroundMesh) this.scene.add(this.surroundMesh);
  }

  /** Large animated water plane (three.js Water addon) that extends
   *  1000 units in each direction — far enough to read as infinite from
   *  any reasonable camera distance. */
  private createWaterSurround(env: EnvironmentDef): Water {
    if (!this.waterNormalsTex) {
      const loader = new THREE.TextureLoader();
      this.waterNormalsTex = loader.load(
        'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/waternormals.jpg',
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        }
      );
      // Pre-set wrap so it's correct even before the async load completes
      this.waterNormalsTex.wrapS = this.waterNormalsTex.wrapT =
        THREE.RepeatWrapping;
    }

    const geom = new THREE.PlaneGeometry(1000, 1000);
    const water = new Water(geom, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: this.waterNormalsTex,
      sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
      sunColor: 0xffffff,
      waterColor: env.waterColor ?? 0x0a4466,
      distortionScale: env.waterDistortion ?? 2.4,
      fog: false,
    });
    water.rotation.x = -Math.PI / 2;
    // Environment-controlled water level. Default -0.05 (just under the
    // plate top). Island preset drops this to around -1.4 so the thick
    // cliff-like baseplate visibly rises out of the water.
    water.position.y = env.waterLevel ?? -0.05;
    water.userData.isSurround = true;
    return water;
  }

  /** Large flat ground plane (sand / snow / etc.) extending 1000 units. */
  private createGroundSurround(env: EnvironmentDef): THREE.Mesh {
    const isDesert = env.id === 'desert';
    const segments = isDesert ? 256 : 1;
    const geom = new THREE.PlaneGeometry(1000, 1000, segments, segments);

    // Desert: displace vertices with layered sine waves to create
    // rolling sand dunes. Amplitudes are small enough that they don't
    // interfere with the baseplate area near the origin.
    if (isDesert) {
      const pos = geom.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        // Distance from center — keep the baseplate zone flat
        const dist = Math.sqrt(x * x + y * y);
        const fade = Math.min(1, Math.max(0, (dist - 30) / 40));
        // Layered dunes at different scales
        const h =
          Math.sin(x * 0.012 + y * 0.008) * 3.5 +
          Math.sin(x * 0.025 - y * 0.018) * 1.8 +
          Math.sin(x * 0.06 + y * 0.05) * 0.6 +
          Math.sin(x * 0.15 - y * 0.12) * 0.2;
        pos.setZ(i, h * fade);
      }
      geom.computeVertexNormals();
    }

    // Desert: procedural canvas texture for sand grain + color variation
    const mat = new THREE.MeshStandardMaterial({
      color: env.surroundColor ?? 0xcccccc,
      roughness: env.surroundRoughness ?? 0.9,
      metalness: 0,
    });

    if (isDesert) {
      const texSize = 512;
      const canvas = document.createElement('canvas');
      canvas.width = texSize;
      canvas.height = texSize;
      const ctx = canvas.getContext('2d')!;
      // Base sand fill
      ctx.fillStyle = '#c99a5a';
      ctx.fillRect(0, 0, texSize, texSize);
      // Scatter fine sand grains
      for (let i = 0; i < 40000; i++) {
        const gx = Math.random() * texSize;
        const gy = Math.random() * texSize;
        const brightness = 140 + Math.random() * 80;
        const r = brightness + 20;
        const g = brightness - 10;
        const b = brightness - 50;
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(gx, gy, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
      }
      // Broader warm patches
      for (let i = 0; i < 200; i++) {
        const px = Math.random() * texSize;
        const py = Math.random() * texSize;
        const pr = 4 + Math.random() * 12;
        ctx.globalAlpha = 0.08 + Math.random() * 0.08;
        ctx.fillStyle = Math.random() > 0.5 ? '#b8842e' : '#ddb87a';
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(80, 80);
      mat.map = tex;
      mat.needsUpdate = true;
    }

    const ground = new THREE.Mesh(geom, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    ground.userData.isSurround = true;
    return ground;
  }

  // ------------------------------------------------------------------
  //  Sharks (island environment only)
  // ------------------------------------------------------------------

  /** Build a single procedural shark from basic Three.js geometry. */
  private createShark(): THREE.Group {
    const group = new THREE.Group();
    const bodyColor = 0x5a6a7a;
    const bellyColor = 0xc8ccd0;

    // --- Body (tapered ellipsoid via scaled sphere) ---
    const bodyGeom = new THREE.SphereGeometry(1, 16, 10);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.6,
      metalness: 0.1,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.scale.set(0.7, 0.45, 2.0); // wide, flat, long
    group.add(body);

    // --- Belly (slightly smaller, white underside) ---
    const bellyGeom = new THREE.SphereGeometry(0.92, 14, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    const bellyMat = new THREE.MeshStandardMaterial({
      color: bellyColor,
      roughness: 0.7,
      metalness: 0,
    });
    const belly = new THREE.Mesh(bellyGeom, bellyMat);
    belly.scale.set(0.7, 0.4, 1.9);
    belly.rotation.x = Math.PI;
    belly.position.y = -0.05;
    group.add(belly);

    // --- Dorsal fin (triangle via extruded shape) ---
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(-0.15, 0.8);
    finShape.lineTo(0.5, 0);
    finShape.closePath();
    const finGeom = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.06,
      bevelEnabled: false,
    });
    const finMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.5,
      metalness: 0.1,
    });
    const dorsalFin = new THREE.Mesh(finGeom, finMat);
    dorsalFin.position.set(-0.03, 0.4, -0.2);
    group.add(dorsalFin);

    // --- Tail fin (two flattened triangles in a V) ---
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0, -2.0);
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.lineTo(-0.05, 0.6);
    tailShape.lineTo(0.6, 0);
    tailShape.closePath();
    const tailGeom = new THREE.ExtrudeGeometry(tailShape, {
      depth: 0.04,
      bevelEnabled: false,
    });
    // Upper lobe
    const tailUp = new THREE.Mesh(tailGeom, finMat);
    tailUp.position.set(-0.02, 0.05, 0);
    tailUp.rotation.z = 0.15;
    tailPivot.add(tailUp);
    // Lower lobe
    const tailDown = new THREE.Mesh(tailGeom, finMat.clone());
    tailDown.position.set(-0.02, -0.05, 0);
    tailDown.rotation.z = -0.15;
    tailDown.scale.y = -0.7;
    tailPivot.add(tailDown);
    group.add(tailPivot);
    // Tag the tail pivot for animation
    tailPivot.userData.isSharkTail = true;

    // --- Pectoral fins (small flat triangles on each side) ---
    const pectoralShape = new THREE.Shape();
    pectoralShape.moveTo(0, 0);
    pectoralShape.lineTo(-0.1, -0.5);
    pectoralShape.lineTo(0.5, -0.1);
    pectoralShape.closePath();
    const pectoralGeom = new THREE.ExtrudeGeometry(pectoralShape, {
      depth: 0.03,
      bevelEnabled: false,
    });
    const pectL = new THREE.Mesh(pectoralGeom, finMat);
    pectL.position.set(-0.6, -0.15, 0.4);
    pectL.rotation.y = -0.3;
    group.add(pectL);
    const pectR = new THREE.Mesh(pectoralGeom, finMat);
    pectR.position.set(0.6, -0.15, 0.4);
    pectR.rotation.y = 0.3;
    pectR.scale.x = -1;
    group.add(pectR);

    // --- Eyes (small dark spheres) ---
    const eyeGeom = new THREE.SphereGeometry(0.06, 8, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(-0.5, 0.12, 1.4);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeR.position.set(0.5, 0.12, 1.4);
    group.add(eyeR);

    // Scale the whole shark to world size (about 4-5 studs long)
    group.scale.setScalar(1.2);

    return group;
  }

  /** Spawn sharks for the island environment. */
  private spawnSharks() {
    this.despawnSharks();
    const waterY = this.environment.waterLevel ?? -0.05;
    const count = 3;
    for (let i = 0; i < count; i++) {
      const shark = this.createShark();
      const angle = (i / count) * Math.PI * 2;
      const radiusX = 35 + Math.random() * 20;
      const radiusZ = 35 + Math.random() * 20;
      const speed = 0.15 + Math.random() * 0.1;
      // Position the shark so the dorsal fin pokes above water
      shark.position.y = waterY - 0.15;
      this.scene.add(shark);

      // Find the tail pivot
      let tailBone: THREE.Object3D = shark;
      shark.traverse((c) => {
        if (c.userData.isSharkTail) tailBone = c;
      });

      this.sharks.push({
        group: shark,
        angle,
        speed,
        radiusX,
        radiusZ,
        phase: Math.random() * Math.PI * 2,
        tailBone,
      });
    }
  }

  /** Remove all sharks from the scene and dispose geometry. */
  private despawnSharks() {
    for (const s of this.sharks) {
      this.scene.remove(s.group);
      s.group.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry?.dispose?.();
          const mat = c.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose?.();
        }
      });
    }
    this.sharks = [];
  }

  /** Per-frame shark animation — patrol + tail wag + bobbing. */
  private updateSharks(dt: number) {
    const waterY = this.environment.waterLevel ?? -0.05;
    const now = performance.now() * 0.001;
    for (const s of this.sharks) {
      s.angle += s.speed * dt;
      const x = Math.cos(s.angle) * s.radiusX;
      const z = Math.sin(s.angle) * s.radiusZ;
      // Gentle bobbing
      const bob = Math.sin(now * 1.5 + s.phase) * 0.08;
      s.group.position.set(x, waterY - 0.15 + bob, z);

      // Face movement direction (tangent of ellipse)
      const tx = -Math.sin(s.angle) * s.radiusX;
      const tz = Math.cos(s.angle) * s.radiusZ;
      s.group.rotation.y = Math.atan2(tx, tz);

      // Slight roll for realism
      s.group.rotation.z = Math.sin(now * 0.8 + s.phase) * 0.06;

      // Tail wag
      s.tailBone.rotation.y = Math.sin(now * 4 + s.phase) * 0.35;
    }
  }

  /** Toggle the "add baseplate" tile placement mode. When active, the cursor
   *  shows tile-shaped slots at every empty horizontal neighbor. */
  setAddBaseplateMode(active: boolean) {
    if (this.addBaseplateMode === active) return;
    this.addBaseplateMode = active;
    if (active) {
      this.rebuildBaseplateSlots();
      this.ghost.visible = false;
      this.hoverBox.visible = false;
      this.clearRemoveHover();
    } else {
      this.disposeSlotsGroup();
      this.currentSlot = null;
    }
    this.onAddBaseplateModeChange(active);
  }

  private disposeSlotsGroup() {
    if (!this.slotsGroup) return;
    this.scene.remove(this.slotsGroup);
    this.slotsGroup.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.geometry?.dispose?.();
        const mat = c.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      } else if (c instanceof THREE.LineSegments) {
        c.geometry?.dispose?.();
        (c.material as THREE.Material).dispose?.();
      }
    });
    this.slotsGroup = null;
  }

  /** Compute every empty grid position adjacent (face-connected) to an
   *  existing tile and create a translucent tile-shaped marker for each. */
  private rebuildBaseplateSlots() {
    this.disposeSlotsGroup();
    this.slotsGroup = new THREE.Group();
    this.scene.add(this.slotsGroup);

    const occupied = new Set(this.baseplates.keys());
    const slotKeys = new Set<string>();
    for (const key of occupied) {
      const [txStr, tyStr, tzStr] = key.split(',');
      const tx = +txStr;
      const ty = +tyStr;
      const tz = +tzStr;
      // Horizontal neighbors at distance 1 AND distance 2 (same Y) — lets
      // the user drop a new tile touching an existing one OR leave a
      // one-tile gap between them (visible as a separate ghost slot).
      const neighbors: [number, number, number][] = [
        // distance 1 — directly adjacent
        [tx + 1, ty, tz],
        [tx - 1, ty, tz],
        [tx, ty, tz + 1],
        [tx, ty, tz - 1],
        // distance 2 — skip one empty tile (creates a gap)
        [tx + 2, ty, tz],
        [tx - 2, ty, tz],
        [tx, ty, tz + 2],
        [tx, ty, tz - 2],
      ];
      for (const [nx, ny, nz] of neighbors) {
        const nkey = `${nx},${ny},${nz}`;
        if (!occupied.has(nkey)) slotKeys.add(nkey);
      }
    }

    for (const key of slotKeys) {
      const [tx, ty, tz] = key.split(',').map(Number);
      const slot = this.buildSlotMesh();
      slot.position.set(
        tx * this.tileSize,
        ty * Game.TILE_LEVEL_HEIGHT + 0.005, // slight offset, no z-fight
        tz * this.tileSize
      );
      slot.userData.isSlot = true;
      slot.userData.tileX = tx;
      slot.userData.tileY = ty;
      slot.userData.tileZ = tz;
      this.slotsGroup.add(slot);
    }
  }

  /** Builds one slot marker — a TRANSLUCENT FULL STUD-BOARD (slab + studs)
   *  so the user sees a ghost preview of exactly what a baseplate tile will
   *  look like in this position, with a small Feather-style FiPlusCircle
   *  icon hovering over the center. */
  private buildSlotMesh(): THREE.Mesh {
    const size = this.tileSize;
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x6dc36d,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    // Slab (matches a real baseplate's dimensions, bottom-anchored).
    // Thickness tracks the current environment so the island preset's
    // tall cliff also previews correctly.
    const thickness = this.environment.baseplateThickness ?? 0.4;
    const slabGeom = new THREE.BoxGeometry(size, thickness, size);
    slabGeom.translate(0, -thickness / 2, 0);
    const mesh = new THREE.Mesh(slabGeom, ghostMat);
    mesh.userData.ghostMat = ghostMat; // for hover-color tweaking

    // Translucent studs (instanced — share the slab material so a single
    // opacity tweak in updateBaseplateGhost colors the whole tile)
    const studGeom = new THREE.CylinderGeometry(
      STUD_RADIUS,
      STUD_RADIUS,
      STUD_HEIGHT,
      12
    );
    const total = size * size;
    const instanced = new THREE.InstancedMesh(studGeom, ghostMat, total);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        dummy.position.set(
          -size / 2 + 0.5 + x,
          STUD_HEIGHT / 2,
          -size / 2 + 0.5 + z
        );
        dummy.updateMatrix();
        instanced.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.add(instanced);

    // White outline edges around the slab
    const edges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(size, 0.4, size)
    );
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
      })
    );
    line.position.y = -0.2;
    mesh.add(line);

    // FiPlusCircle-style icon hovering above the studs
    const iconPlane = this.buildPlusCircleIcon();
    iconPlane.position.y = STUD_HEIGHT + 0.3;
    iconPlane.userData.isSlot = true;
    mesh.add(iconPlane);

    return mesh;
  }

  /** A flat plane textured with a Feather-icon-style FiPlusCircle drawn on
   *  a 2D canvas. Used as the slot's affordance — the white halo behind
   *  the dark green stroke makes it pop against the translucent slot. */
  private buildPlusCircleIcon(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    const SIZE = 256;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const radius = SIZE * 0.36;
    const stroke = SIZE * 0.05;

    // White soft halo so the dark stroke pops against any background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + stroke * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Feather icon style: round caps, even stroke width, dark green
    ctx.strokeStyle = '#0a4d0a';
    ctx.lineWidth = stroke;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Plus inside (matches react-icons/fi FiPlusCircle proportions)
    const armLen = radius * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - armLen, cy);
    ctx.lineTo(cx + armLen, cy);
    ctx.moveTo(cx, cy - armLen);
    ctx.lineTo(cx, cy + armLen);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 8;
    tex.needsUpdate = true;

    // Render the icon as a flat plane facing UP (visible from above)
    const iconWorldSize = Math.max(5, this.tileSize * 0.18);
    const geom = new THREE.PlaneGeometry(iconWorldSize, iconWorldSize);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    return new THREE.Mesh(geom, mat);
  }

  /** Raycasts against the slot markers and highlights whichever one is
   *  under the cursor. The slab + studs share a single material, so a
   *  single opacity/color tweak retints the whole tile. */
  private updateBaseplateGhost() {
    if (!this.addBaseplateMode || !this.slotsGroup) return;
    // Reset every slot to its default appearance
    for (const slot of this.slotsGroup.children) {
      const mat =
        (slot.userData.ghostMat as THREE.MeshBasicMaterial | undefined) ??
        ((slot as THREE.Mesh).material as THREE.MeshBasicMaterial);
      mat.opacity = 0.34;
      mat.color.setHex(0x6dc36d);
    }
    this.currentSlot = null;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.slotsGroup.children,
      true
    );
    if (hits.length === 0) return;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.isSlot) obj = obj.parent;
    if (!obj) return;

    const slotMesh = obj as THREE.Mesh;
    const mat =
      (slotMesh.userData.ghostMat as THREE.MeshBasicMaterial | undefined) ??
      (slotMesh.material as THREE.MeshBasicMaterial);
    mat.opacity = 0.6;
    mat.color.setHex(0x4dca4d);
    this.currentSlot = slotMesh;
  }

  /** Click commit — places a real tile at the highlighted slot. */
  private commitBaseplateGhost() {
    if (!this.addBaseplateMode || !this.currentSlot) return;
    const tx = this.currentSlot.userData.tileX as number;
    const ty = this.currentSlot.userData.tileY as number;
    const tz = this.currentSlot.userData.tileZ as number;
    this.addBaseplateTile(tx, ty, tz);
    // Recompute slots so the new neighbours of the placed tile become
    // available, and the just-filled slot is removed.
    this.rebuildBaseplateSlots();
    this.updateBaseplateGhost();
  }

  /** Legacy compat for the old "맵 크기" preset UI — resizes future tiles
   *  but does not modify already-placed tiles. */
  setBoardSize(size: number) {
    if (size === this.tileSize) return;
    this.tileSize = size;
    this.onBoardSizeChange(size);
  }

  /** True if a footprint (cx ± bw, cz ± bd) is contained inside any
   *  baseplate tile's XZ extent (ignoring Y). */
  private isFootprintOnBaseplate(
    cx: number,
    cz: number,
    bw: number,
    bd: number
  ): boolean {
    const half = this.tileSize / 2;
    for (const tile of this.baseplates.values()) {
      const tx = tile.position.x;
      const tz = tile.position.z;
      if (
        cx - bw >= tx - half &&
        cx + bw <= tx + half &&
        cz - bd >= tz - half &&
        cz + bd <= tz + half
      ) {
        return true;
      }
    }
    return false;
  }

  /** Bridge-specific placement check: the bridge is allowed to hang over
   *  empty space (water / gap) as long as BOTH short-end regions rest on
   *  a baseplate tile. The two anchor tiles don't have to be the same —
   *  in fact the whole point is to span a gap between two islands. */
  private isBridgeFootprintValid(
    cx: number,
    cz: number,
    w: number,
    d: number
  ): boolean {
    const longIsZ = d >= w;
    const longHalf = (longIsZ ? d : w) / 2;
    const shortHalf = (longIsZ ? w : d) / 2;
    // Each end anchor is 2 studs along the long axis × full short width.
    const overhang = 2;
    const endHalfLong = overhang / 2;
    const endHalfA = longIsZ ? shortHalf : endHalfLong;
    const endHalfB = longIsZ ? endHalfLong : shortHalf;

    // End A — low side of the long axis
    const aCx = longIsZ ? cx : cx - longHalf + endHalfLong;
    const aCz = longIsZ ? cz - longHalf + endHalfLong : cz;
    if (!this.isFootprintOnBaseplate(aCx, aCz, endHalfA, endHalfB)) {
      return false;
    }

    // End B — high side of the long axis
    const bCx = longIsZ ? cx : cx + longHalf - endHalfLong;
    const bCz = longIsZ ? cz + longHalf - endHalfLong : cz;
    if (!this.isFootprintOnBaseplate(bCx, bCz, endHalfA, endHalfB)) {
      return false;
    }

    return true;
  }

  /** Returns the XZ-union AABB of every placed baseplate tile (Y is the
   *  range of tile slab tops). Useful for camera bounds and shadow frustums. */
  private getBaseplatesBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    if (this.baseplates.size === 0) {
      box.min.set(-1, 0, -1);
      box.max.set(1, 0, 1);
      return box;
    }
    for (const tile of this.baseplates.values()) {
      const half = this.tileSize / 2;
      const cx = tile.position.x;
      const cy = tile.position.y;
      const cz = tile.position.z;
      box.expandByPoint(new THREE.Vector3(cx - half, cy, cz - half));
      box.expandByPoint(new THREE.Vector3(cx + half, cy, cz + half));
    }
    return box;
  }

  // ------------------------------------------------------------------
  //  Event handlers
  // ------------------------------------------------------------------

  private onResize() {
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private updatePointer(e: PointerEvent) {
    // Touch: aim from the screen center reticle regardless of where the
    // finger is — the user orbits the camera (1-finger drag) to move the
    // ghost around the world, then taps anywhere to commit. This avoids
    // finger occlusion entirely and matches Minecraft PE classic.
    //
    // EXCEPTION: while a thumbnail drag is in progress, the user IS
    // dragging the ghost itself with their finger, so use the real
    // finger position so the ghost tracks under the fingertip.
    if (e.pointerType === 'touch' && !this.thumbnailDragActive) {
      this.pointer.x = 0;
      this.pointer.y = 0;
      return;
    }
    this.setPointerFromClient(e.clientX, e.clientY);
  }

  /** Convert raw client coords to NDC and store in `this.pointer`. Used by
   *  the thumbnail-drag pipeline (whose pointer events come from a button
   *  outside the canvas). */
  private setPointerFromClient(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerMove(e: PointerEvent) {
    if (this.isPlaying) return;
    // On mobile, the D-pad is the ONLY way to move the ghost. Pointer
    // moves only rotate the camera — never touch the ghost position.
    // (Desktop keeps the existing hybrid flow.)
    const isMobileHost = document.body.classList.contains('is-mobile');
    if (isMobileHost) {
      // Don't even call updatePointer's screen-center override — we
      // still need OrbitControls to see the move event, so just track
      // the NDC pointer from actual coords for camera drag.
      this.setPointerFromClient(e.clientX, e.clientY);
      return;
    }
    // Don't deactivate the keyboard cursor on tiny hovers within 1500ms
    // of the last arrow-key press — otherwise a Bluetooth mouse's
    // micro-drift makes the ghost snap back to the cursor and the user
    // can't see their keyboard nudge.
    const sinceKb = performance.now() - this.kbCursorLastMove;
    // Only consider the pointer "intentional" if a button is held
    // (drag) or the cooldown has expired AND the pointer actually
    // moved a meaningful distance from the last frame.
    const intentional =
      e.buttons > 0 || sinceKb > 1500;
    if (intentional) {
      this.kbCursor.active = false;
    }
    this.updatePointer(e);
    if (e.buttons > 0) {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      // Larger drag tolerance on touch — fingertips naturally wiggle
      // several pixels on contact, and treating that as a camera drag
      // would break tap-to-place.
      const dragThresholdSq = e.pointerType === 'touch' ? 400 : 25;
      if (dx * dx + dy * dy > dragThresholdSq) {
        this.wasDrag = true;
      }
    }
    if (this.addBaseplateMode) {
      this.updateBaseplateGhost();
      return;
    }
    if (this.shiftLineStart) {
      this.updateShiftLine();
    } else {
      this.updatePreview();
    }
  }

  private onPointerDown(e: PointerEvent) {
    if (this.isPlaying) return;
    this.pointerDownPos.set(e.clientX, e.clientY);
    this.wasDrag = false;
    this.lastPointerType = e.pointerType || 'mouse';
    if (e.button === 1) e.preventDefault();

    // Touch has no "hover" state — so refresh the ghost immediately on
    // contact. This way the user sees exactly where the block will land
    // *before* lifting their finger, without having to dry-tap first.
    if (e.pointerType === 'touch') {
      this.updatePointer(e);
      if (!this.addBaseplateMode && !this.shiftLineStart) {
        this.updatePreview();
      }
    }

    // Shift + left click starts a line-placement drag
    if (
      e.shiftKey &&
      e.button === 0 &&
      this.mode === 'place' &&
      !this.placementSuspended
    ) {
      const start = this.computePlacement();
      // Shift-drag lines always use the user's current rotation, so don't
      // start a drag when only the auto-rotated orientation fits — that
      // would make the start block inconsistent with the rest of the line.
      // Also skip invalid placements (bridge raw fallback) — we never want
      // to start a line from a "can't place here" preview.
      if (start && !start.autoRotate && !start.invalid) {
        const p = { x: start.x, y: start.y, z: start.z };
        this.shiftLineStart = p;
        this.shiftLinePlaced.clear();
        this.controls.enabled = false;
        this.ghost.visible = false;
        this.hoverBox.visible = false;
        this.placeAtPosition(p);
        this.shiftLinePlaced.add(this.posKey(p));
      }
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (this.isPlaying) return;

    // End line-placement drag
    if (this.shiftLineStart) {
      this.shiftLineStart = null;
      this.shiftLinePlaced.clear();
      this.controls.enabled = true;
      this.wasDrag = false;
      this.updatePreview();
      return;
    }

    // Drag (mouse or touch) is camera rotation — skip placement. Touch
    // tap-to-place works because the ghost is always at the screen-center
    // reticle (see updatePointer), so the tap location doesn't matter.
    if (this.wasDrag) return;

    // Add-baseplate mode handles its own clicks — the ghost slot under
    // the screen-center reticle is whatever commitBaseplateGhost picks.
    if (this.addBaseplateMode) {
      if (e.button === 0) this.commitBaseplateGhost();
      else if (e.button === 2) this.setAddBaseplateMode(false);
      return;
    }

    // On mobile the dedicated 배치 FAB is the only way to place, and
    // the desktop's tap-to-place reticle flow is unwanted (user finds
    // stray taps placing random blocks confusing). We still honour
    // taps in REMOVE mode — the user taps directly on the block they
    // want gone, which works regardless of ghost position.
    const isMobileHost = document.body.classList.contains('is-mobile');
    if (isMobileHost && e.pointerType === 'touch' && this.mode !== 'remove') {
      return;
    }

    if (e.button === 0) {
      if (this.placementSuspended) return; // selection cleared by Escape
      if (this.mode === 'remove') {
        this.removeBlock();
      } else {
        this.placeBlock();
      }
    } else if (e.button === 2) {
      // Right click (tap, not drag): rotate the current block 90° clockwise
      this.rotateClockwise();
    }
    // Middle click is camera-drag only; no tap action
  }

  private onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const inTextInput =
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    // --- Pac-Man mode: movement + view toggle + exit ---
    // Takes priority over every other handler while the game is active.
    // In top-down mode arrow keys are ABSOLUTE (Up = world -Z). In
    // first-person mode ←/→ rotate the facing 90° per tap and ↑/↓
    // become forward/back along the current facing — classic tank
    // controls so the camera aligns with the player's look direction.
    if (this.isPacmanPlaying && !inTextInput) {
      let handled = true;
      const firstPerson = this.pacmanViewMode === 'first';
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
          if (firstPerson) this.pacmanKeys.up = true;
          else this.pacmanKeys.up = true;
          break;
        case 'ArrowDown':
        case 'KeyS':
          if (firstPerson) this.pacmanKeys.down = true;
          else this.pacmanKeys.down = true;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          if (firstPerson) {
            if (!e.repeat) this.rotatePacmanFacing(-1);
          } else {
            this.pacmanKeys.left = true;
          }
          break;
        case 'ArrowRight':
        case 'KeyD':
          if (firstPerson) {
            if (!e.repeat) this.rotatePacmanFacing(1);
          } else {
            this.pacmanKeys.right = true;
          }
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.pacmanKeys.run = true;
          break;
        case 'KeyV':
          if (!e.repeat) this.togglePacmanView();
          break;
        case 'Escape':
          this.stopPacman();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Play mode keys take priority and always preventDefault
    if (this.isPlaying && !inTextInput) {
      let handled = true;
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.moveKeys.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.moveKeys.back = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.moveKeys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.moveKeys.right = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.moveKeys.run = true;
          break;
        case 'Space':
          this.moveKeys.jump = true;
          break;
        case 'KeyV':
          if (!e.repeat) this.toggleViewMode();
          break;
        case 'KeyE':
          if (!e.repeat) {
            // Priority order:
            //   1. Vehicle ride → dismount vehicle
            //   2. Playground ride → dismount playground
            //   3. Door hotspot → toggle door
            //   4. Vehicle hotspot → board vehicle
            //   5. Playground hotspot → start ride
            //   6. NPC hotspot → talk
            if (this.vehicleRide) {
              this.dismountVehicle();
            } else if (this.playgroundRide) {
              this.dismountPlayground();
            } else if (this.currentDoorHotspot) {
              this.toggleCurrentDoor();
            } else if (this.vehicleHotspot) {
              this.startVehicleRide();
            } else if (this.playgroundHotspot) {
              this.startPlaygroundRide();
            } else if (this.currentNpcHotspot) {
              this.interactWithCurrentNpc();
            }
          }
          break;
        case 'Digit9':
          // "9" key toggles the dog whistle (same action as the HUD
          // button). Plays the whistle sound regardless so it still
          // feels responsive when no dogs are on the board.
          if (!e.repeat) this.whistleDogs();
          break;
        case 'Escape':
          this.stopPlay();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (inTextInput) return;

    // Arrow keys: move ghost via keyboard cursor, or — in line-streak
    // mode (activated by Space-placing a block) — place a new block
    // adjacent to the last placed one in the arrow's direction.
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();

      // Compute camera-relative forward/right on the XZ plane so arrow
      // keys map to the user's current viewpoint.
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();
      if (camDir.lengthSq() < 0.001) { camDir.set(0, 0, -1); }
      const camRight = new THREE.Vector3().crossVectors(
        new THREE.Vector3(0, 1, 0), camDir
      ).normalize();
      let dx = 0, dz = 0;
      switch (e.code) {
        case 'ArrowUp':    dx = camDir.x;   dz = camDir.z;   break;
        case 'ArrowDown':  dx = -camDir.x;  dz = -camDir.z;  break;
        case 'ArrowLeft':  dx = camRight.x; dz = camRight.z; break;
        case 'ArrowRight': dx = -camRight.x; dz = -camRight.z; break;
      }
      // Dominant-axis direction (+1 / -1 on either X or Z).
      const useXAxis = Math.abs(dx) >= Math.abs(dz);
      const sX = useXAxis ? Math.sign(dx) : 0;
      const sZ = useXAxis ? 0 : Math.sign(dz);

      const eff = this.effectiveSize();

      // --- LINE STREAK: place a new block offset by one full footprint ---
      if (
        this.lineStreakActive &&
        this.lastPlacedPos &&
        this.mode === 'place' &&
        !this.placementSuspended
      ) {
        const stepX = sX * eff.w;
        const stepZ = sZ * eff.d;
        const nextX = this.lastPlacedPos.x + stepX;
        const nextZ = this.lastPlacedPos.z + stepZ;
        // Bounds check: the full footprint must sit on a baseplate tile.
        if (!this.isFootprintOnBaseplate(nextX, nextZ, eff.w / 2, eff.d / 2)) {
          return;
        }
        // Place at the same Y as the last placed block (keep on-plane).
        this.placeAtPosition({ x: nextX, y: this.lastPlacedPos.y, z: nextZ });
        this.lastPlacedPos = { x: nextX, y: this.lastPlacedPos.y, z: nextZ };
        // Keep the ghost / kbCursor in sync so the preview shows where
        // the next block would go.
        this.kbCursor.x = nextX;
        this.kbCursor.z = nextZ;
        this.kbCursor.active = true;
        this.updatePreview();
        return;
      }

      // --- CURSOR MOVE: step the ghost by ONE FULL FOOTPRINT so blocks
      //     placed on successive arrow presses sit edge-to-edge. ---
      if (!this.kbCursor.active) {
        if (this.ghost.visible) {
          this.kbCursor.x = this.ghost.position.x;
          this.kbCursor.z = this.ghost.position.z;
        } else {
          this.kbCursor.x = 0;
          this.kbCursor.z = 0;
        }
        this.kbCursor.active = true;
        this.placementSuspended = false;
      }
      const prevX = this.kbCursor.x;
      const prevZ = this.kbCursor.z;
      // Step by the block's footprint size along the chosen axis (one
      // full block width for horizontal arrows, one full depth for
      // vertical). For 1×1 blocks this equals 1 stud; for a 2×2 it's
      // 2 studs; for a 4×2 rotated sideways it's 4 or 2 depending on
      // which axis is dominant.
      this.kbCursor.x += sX * eff.w;
      this.kbCursor.z += sZ * eff.d;
      const snappedX = this.snapXZ(this.kbCursor.x, eff.w);
      const snappedZ = this.snapXZ(this.kbCursor.z, eff.d);
      if (!this.isFootprintOnBaseplate(snappedX, snappedZ, eff.w / 2, eff.d / 2)) {
        this.kbCursor.x = prevX;
        this.kbCursor.z = prevZ;
      }
      this.kbCursorLastMove = performance.now();
      this.updatePreview();
      return;
    }

    if (e.key === 'Tab' && !e.repeat) {
      e.preventDefault();
      this.rotateClockwise();
    } else if (e.key === 'x' || e.key === 'X') {
      this.setMode(this.mode === 'remove' ? 'place' : 'remove');
    } else if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (!this.placementSuspended && this.ghost.visible) {
        if (this.mode === 'remove') {
          this.removeBlock();
        } else {
          const placed = this.placeBlock();
          // Space activates the line-paint streak so arrow keys can
          // place consecutive blocks in the pressed direction.
          if (placed) {
            this.lastPlacedPos = placed;
            this.lineStreakActive = true;
          }
        }
      }
    } else if (e.key === 'Escape') {
      // Esc cancels add-baseplate mode first; otherwise clears the
      // current block selection.
      if (this.addBaseplateMode) {
        this.setAddBaseplateMode(false);
        return;
      }
      // End the line-paint streak if active.
      this.lineStreakActive = false;
      this.lastPlacedPos = null;
      this.placementSuspended = true;
      this.ghost.visible = false;
      this.hoverBox.visible = false;
      this.clearRemoveHover();
      this.onSelectionCleared();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    // Pac-Man key release
    if (this.isPacmanPlaying) {
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.pacmanKeys.up = false;
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.pacmanKeys.down = false;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.pacmanKeys.left = false;
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.pacmanKeys.right = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.pacmanKeys.run = false;
          break;
      }
      return;
    }
    if (!this.isPlaying) return;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveKeys.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveKeys.back = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveKeys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveKeys.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.moveKeys.run = false;
        break;
      case 'Space':
        this.moveKeys.jump = false;
        break;
    }
  }

  toggleViewMode() {
    this.setViewMode(this.viewMode === 'first' ? 'third' : 'first');
  }

  setViewMode(mode: ViewMode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    if (this.playerAvatar) {
      // Hide avatar in 1st-person so we don't see the inside of our own head
      this.playerAvatar.visible = mode === 'third';
    }
    // Both modes use pointer lock — 1st person for FPS look, 3rd person for
    // orbit. When switching to 3rd person we re-seed the camera with an
    // isometric direction so the avatar appears above-and-behind.
    if (this.isPlaying) {
      if (mode === 'third') {
        this.camera.position.set(
          this.playerPos.x + 8,
          this.playerPos.y + 10,
          this.playerPos.z + 8
        );
        this.camera.lookAt(
          this.playerPos.x,
          this.playerPos.y + 2,
          this.playerPos.z
        );
        this.updateThirdPersonCamera();
      } else {
        // 1st person: snap camera to eye position immediately so the very
        // first frame doesn't render from the wrong place.
        const eyeY = (getMinifigHeight() || 2.5) * 0.92;
        this.camera.position.set(
          this.playerPos.x,
          this.playerPos.y + eyeY,
          this.playerPos.z
        );
      }
      // Re-acquire pointer lock if we lost it (e.g., user pressed ESC earlier)
      if (this.fpsControls && !this.fpsControls.isLocked) {
        try {
          this.fpsControls.lock();
        } catch {
          /* ignore */
        }
      }
    }
    this.onViewModeChange(mode);
  }

  // ------------------------------------------------------------------
  //  Public state setters
  // ------------------------------------------------------------------

  /** Advances the block orientation 90° clockwise (cycling 0→1→2→3→0). */
  rotateClockwise() {
    this.rotationStep = (this.rotationStep + 1) % 4;
    this.onRotationChange(this.rotationStep);
    this.updatePreview();
  }

  setBlockType(type: BlockType) {
    this.blockType = type;
    this.placementSuspended = false;
    // Different block → different footprint, so the in-flight line-paint
    // streak no longer makes sense. End it.
    this.lineStreakActive = false;
    this.lastPlacedPos = null;
    this.onBlockTypeChange(type);
    this.updatePreview();
  }

  setCharacter(preset: MinifigPreset) {
    this.character = preset;
    this.characterVersion++;
    this.placementSuspended = false;
    this.onCharacterChange(preset);
    this.updatePreview();
  }

  /** Merge partial editor changes into the current character preset
   *  without replacing the whole object. Used by the character editor
   *  UI to update individual fields (shirt color, face.eyes, etc.)
   *  while keeping the rest of the preset intact. */
  applyEditorCharacter(partial: Partial<MinifigPreset>) {
    Object.assign(this.character, partial);
    this.characterVersion++;
    this.onCharacterChange(this.character);
    this.updatePreview();
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.placementSuspended = false;
    // End the line-paint streak on mode change (remove mode has no
    // meaningful "next position" to continue from).
    this.lineStreakActive = false;
    this.lastPlacedPos = null;
    this.onModeChange(mode);
    this.renderer.domElement.style.cursor =
      mode === 'remove' ? 'not-allowed' : 'crosshair';
    this.updatePreview();
  }

  // ------------------------------------------------------------------
  //  Touch drag-from-thumbnail pipeline.
  //
  //  On a tablet the user starts a placement by pressing on a sidebar
  //  thumbnail and dragging onto the canvas. We can't rely on the
  //  canvas's own pointermove events for that — implicit pointer capture
  //  pins the pointer stream to the originating button — so ui.ts hooks
  //  document-level move/up listeners and forwards the events here.
  //
  //  beginThumbnailDrag()   — called on the thumbnail's pointerdown.
  //                           Switches the block type, suppresses the
  //                           screen-center reticle, and disables
  //                           OrbitControls so 1-finger drag doesn't
  //                           also rotate the camera.
  //  updateThumbnailDrag()  — called on document pointermove with the
  //                           raw client coordinates. Updates the ghost.
  //  commitThumbnailDrag()  — called on pointerup. If the finger landed
  //                           inside the canvas it places the block.
  //  cancelThumbnailDrag()  — clean teardown without placing.
  // ------------------------------------------------------------------
  beginThumbnailDrag(clientX: number, clientY: number) {
    this.thumbnailDragActive = true;
    document.body.classList.add('thumbnail-dragging');
    // OrbitControls would otherwise eat the 1-finger drag and rotate the
    // camera while the user is trying to position the ghost.
    this.controls.enabled = false;
    this.placementSuspended = false;
    this.setPointerFromClient(clientX, clientY);
    this.updatePreview();
    this.ghost.visible = true;
  }

  updateThumbnailDrag(clientX: number, clientY: number) {
    if (!this.thumbnailDragActive) return;
    this.setPointerFromClient(clientX, clientY);
    if (this.addBaseplateMode) {
      this.updateBaseplateGhost();
    } else {
      this.updatePreview();
    }
  }

  commitThumbnailDrag(clientX: number, clientY: number): boolean {
    if (!this.thumbnailDragActive) {
      return false;
    }
    this.setPointerFromClient(clientX, clientY);

    // Only place if the finger actually ended over the canvas.
    const rect = this.renderer.domElement.getBoundingClientRect();
    const overCanvas =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    let placed = false;
    if (overCanvas && this.mode === 'place' && !this.placementSuspended) {
      if (this.addBaseplateMode) {
        this.updateBaseplateGhost();
        this.commitBaseplateGhost();
        placed = true;
      } else {
        this.updatePreview();
        const before = this.brickGroup.children.length;
        this.placeBlock();
        placed = this.brickGroup.children.length > before;
      }
    }

    this.endThumbnailDrag();
    return placed;
  }

  cancelThumbnailDrag() {
    if (!this.thumbnailDragActive) return;
    this.endThumbnailDrag();
  }

  private endThumbnailDrag() {
    this.thumbnailDragActive = false;
    document.body.classList.remove('thumbnail-dragging');
    this.controls.enabled = true;
    // Restore the screen-center reticle aim for the next plain tap.
    this.pointer.x = 0;
    this.pointer.y = 0;
    this.updatePreview();
  }

  clearAll() {
    // Drop the hover reference before we wipe brickGroup — otherwise
    // we'd leave hoverRemoveTarget pointing at a removed object and
    // try to restore materials on it later.
    this.hoverRemoveTarget = null;
    this.hoverRemoveSaved = [];
    while (this.brickGroup.children.length > 0) {
      this.brickGroup.remove(this.brickGroup.children[0]);
    }
    this.hoverBox.visible = false;
    this.onCountChange(0);
  }

  // ------------------------------------------------------------------
  //  Placement math
  // ------------------------------------------------------------------

  private currentGhostHeightPlates(): number {
    const def = BLOCK_TYPES.find((t) => t.type === this.blockType);
    return def?.ghostHeightPlates ?? 3;
  }

  /** Unrotated (canonical) footprint of the current block type. This is the
   *  size that gets passed to the factories — the explicit Y rotation in
   *  placeAtPosition / updateGhost handles the visual orientation. */
  private baseDims(): { w: number; d: number } {
    if (this.blockType === 'minifig') {
      return { w: 2, d: 1 };
    }
    if (this.blockType === 'dog') {
      return { w: 1, d: 2 };
    }
    const def = BLOCK_TYPES.find((t) => t.type === this.blockType);
    if (def?.fixedSize) {
      return { w: def.fixedSize.w, d: def.fixedSize.d };
    }
    return { w: this.size.w, d: this.size.d };
  }

  private effectiveSize(): { w: number; d: number } {
    // Footprint only swaps on 90° / 270° (odd rotation steps); 0° and 180°
    // share the same footprint.
    const swapped = this.rotationStep % 2 === 1;
    const base = this.baseDims();
    return swapped ? { w: base.d, d: base.w } : { w: base.w, d: base.d };
  }

  private snapXZ(v: number, count: number): number {
    const offset = (count % 2) * 0.5;
    return Math.round(v - offset) + offset;
  }

  private snapBottomY(hitY: number): number {
    return Math.max(0, Math.floor(hitY / PLATE_HEIGHT + 0.1) * PLATE_HEIGHT);
  }

  private computePlacement(): {
    x: number;
    y: number;
    z: number;
    /** True when the block was auto-rotated 90° to fit inside the baseplate
     *  edge — ghost/placement should apply an extra rotation step. */
    autoRotate: boolean;
    /** True when the position is geometrically snapped but the block CAN'T
     *  actually be placed there (only used by bridges so the ghost can
     *  show a "red, can't place" preview). */
    invalid: boolean;
  } | null {
    // Keyboard cursor: downward raycast from above the cursor XZ to find
    // the landing surface, then feed into the normal tryPlacementAt path.
    if (this.kbCursor.active) {
      const origin = new THREE.Vector3(this.kbCursor.x, 200, this.kbCursor.z);
      const dir = new THREE.Vector3(0, -1, 0);
      this.raycaster.set(origin, dir);
      const targets: THREE.Object3D[] = [
        ...this.baseplates.values(),
        this.brickGroup,
      ];
      const hits = this.raycaster.intersectObjects(targets, true);
      const eff = this.effectiveSize();
      if (hits.length === 0) {
        // No surface — place at baseplate level if over the board
        const pt = new THREE.Vector3(this.kbCursor.x, 0, this.kbCursor.z);
        const primary = this.tryPlacementAt(pt, eff.w, eff.d);
        if (primary) return { ...primary, autoRotate: false, invalid: false };
        return null;
      }
      const pt = hits[0].point.clone();
      const primary = this.tryPlacementAt(pt, eff.w, eff.d);
      if (primary) return { ...primary, autoRotate: false, invalid: false };
      if (eff.w !== eff.d) {
        const swapped = this.tryPlacementAt(pt, eff.d, eff.w);
        if (swapped) return { ...swapped, autoRotate: true, invalid: false };
      }
      return null;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);
    // For the bridge, the user needs to be able to point at the EMPTY GAP
    // between two baseplates (e.g. open water in island mode) so the
    // bridge's center can land in the middle of the gap. We add both the
    // surround mesh (if any) AND a hidden y=0 raycast plane so any cursor
    // position over the world resolves to a hit. Baseplates remain the
    // closest hit when the cursor is over a tile, so normal hovering
    // behaviour is unchanged.
    const isBridge = this.blockType === 'bridge';
    const targets: THREE.Object3D[] = [
      ...this.baseplates.values(),
      this.brickGroup,
    ];
    if (isBridge) {
      if (this.surroundMesh) targets.push(this.surroundMesh);
      if (this.bridgePlane) targets.push(this.bridgePlane);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;
    const hit = hits[0];
    if (!hit.face) return null;

    const worldNormal = hit.face.normal
      .clone()
      .transformDirection(hit.object.matrixWorld);
    if (worldNormal.y < 0.5) return null;

    const eff = this.effectiveSize();
    const pt = hit.point.clone();
    // If the bridge raycast hit the surround/raycast-plane instead of a
    // baseplate, force the placement Y up to baseplate-top level so the
    // bridge sits at the same height as the islands it's connecting.
    if (isBridge) {
      const hitObj = hit.object;
      const isSurroundHit =
        this.surroundMesh != null &&
        (hitObj === this.surroundMesh || hitObj.parent === this.surroundMesh);
      const isPlaneHit = hitObj === this.bridgePlane;
      if (isSurroundHit || isPlaneHit) {
        pt.y = 0;
      }
    }

    // 1) Try the user's current rotation first.
    const primary = this.tryPlacementAt(pt, eff.w, eff.d);
    if (primary) return { ...primary, autoRotate: false, invalid: false };

    // 2) Edge fallback: swap w/d (visual 90° rotation) and try again. Only
    //    meaningful when the dimensions actually differ — a square footprint
    //    can't be un-stuck by swapping.
    if (eff.w !== eff.d) {
      const swapped = this.tryPlacementAt(pt, eff.d, eff.w);
      if (swapped) return { ...swapped, autoRotate: true, invalid: false };
    }

    // 3) Bridge fallback: even if no valid placement exists, return a raw
    //    snapped position so the ghost can render in red. This gives the
    //    user feedback about WHERE the bridge would go, instead of leaving
    //    them staring at an empty viewport wondering why the ghost vanished.
    if (isBridge) {
      const x = this.snapXZ(pt.x, eff.w);
      const z = this.snapXZ(pt.z, eff.d);
      return { x, y: 0, z, autoRotate: false, invalid: true };
    }

    return null;
  }

  /** Attempts to place a block of footprint (w, d) under the given hit point.
   *  Returns the snapped xyz if the block fits inside the baseplate, or null
   *  if the edge check fails. Handles auto-stack for vertical overlap. */
  private tryPlacementAt(
    pt: THREE.Vector3,
    w: number,
    d: number
  ): { x: number; y: number; z: number } | null {
    let bottomY = this.snapBottomY(pt.y);
    const x = this.snapXZ(pt.x, w);
    const z = this.snapXZ(pt.z, d);

    // The footprint must be entirely covered by some baseplate at this Y
    // (or by the column of an existing brick — in that case the auto-stack
    // loop below handles it). For now, just require that the (x, z) center
    // sits over a baseplate tile.
    //
    // Bridges are the exception: they intentionally span empty space, so
    // instead of the strict full-footprint check we only require that
    // both short ends rest on a baseplate tile.
    const bw = w / 2;
    const bd = d / 2;
    if (this.blockType === 'bridge') {
      if (!this.isBridgeFootprintValid(x, z, w, d)) return null;
    } else {
      if (!this.isFootprintOnBaseplate(x, z, bw, bd)) return null;
    }

    // Auto-stack: if the placement footprint overlaps an existing block,
    // raise bottomY to sit on top of it. Loop until the candidate is clear,
    // so a column of blocked layers is skipped one tier at a time.
    const h = this.blockBodyHeight(this.blockType);
    const XZ_EPS = 0.02;
    const Y_EPS = 1e-4;
    for (let iter = 0; iter < 64; iter++) {
      let nextTop = -Infinity;
      for (const child of this.brickGroup.children) {
        const box = this.getBlockAABB(child);
        // XZ strict overlap (edge-touching neighbors don't count)
        if (
          box.max.x <= x - bw + XZ_EPS ||
          box.min.x >= x + bw - XZ_EPS ||
          box.max.z <= z - bd + XZ_EPS ||
          box.min.z >= z + bd - XZ_EPS
        ) {
          continue;
        }
        // Vertical overlap with the candidate's [bottomY, bottomY + h]?
        if (box.max.y <= bottomY + Y_EPS) continue; // entirely below
        if (box.min.y >= bottomY + h - Y_EPS) continue; // entirely above
        if (box.max.y > nextTop) nextTop = box.max.y;
      }
      if (nextTop === -Infinity) break; // no overlap → done
      // Snap to plate grid (existing tops are already plate-aligned;
      // guard against float drift).
      bottomY = Math.round(nextTop / PLATE_HEIGHT) * PLATE_HEIGHT;
    }

    return { x, y: bottomY, z };
  }

  /** Body height in world units for a given block type (excludes studs). */
  private blockBodyHeight(type: BlockType): number {
    if (type === 'minifig') {
      // GLB character height — driven by uniform scale of the loaded
      // model, so we read it dynamically from the loader.
      return getMinifigHeight() || 2.5;
    }
    const def = BLOCK_TYPES.find((t) => t.type === type);
    return (def?.bodyHeightPlates ?? 3) * PLATE_HEIGHT;
  }

  /** Tests whether the current block type at (x, bottomY, z) would overlap
   *  any existing placed block. Used by the Shift+drag line placer. */
  private wouldOverlap(x: number, bottomY: number, z: number): boolean {
    const eff = this.effectiveSize();
    const h = this.blockBodyHeight(this.blockType);
    const bw = eff.w / 2;
    const bd = eff.d / 2;
    const XZ_EPS = 0.02;
    const Y_EPS = 1e-4;
    for (const child of this.brickGroup.children) {
      const box = this.getBlockAABB(child);
      if (
        box.max.x <= x - bw + XZ_EPS ||
        box.min.x >= x + bw - XZ_EPS ||
        box.max.z <= z - bd + XZ_EPS ||
        box.min.z >= z + bd - XZ_EPS
      )
        continue;
      if (box.max.y <= bottomY + Y_EPS) continue;
      if (box.min.y >= bottomY + h - Y_EPS) continue;
      return true;
    }
    return false;
  }

  /** True-body AABB for a placed block (studs excluded, matches placement math). */
  private getBlockAABB(obj: THREE.Object3D): THREE.Box3 {
    const pos = obj.position;
    const spec = obj.userData.spec as
      | { w: number; d: number; type?: BlockType }
      | undefined;
    if (spec) {
      const h = this.blockBodyHeight(spec.type ?? 'brick');
      return new THREE.Box3(
        new THREE.Vector3(pos.x - spec.w / 2, pos.y, pos.z - spec.d / 2),
        new THREE.Vector3(pos.x + spec.w / 2, pos.y + h, pos.z + spec.d / 2)
      );
    }
    if (obj.userData.isMinifig) {
      // Minifig footprint is 2x1, swapped to 1x2 on 90°/270° rotations.
      const k = Math.round(obj.rotation.y / (Math.PI / 2));
      const swapped = ((k % 2) + 2) % 2 === 1;
      const w = swapped ? 1 : 2;
      const d = swapped ? 2 : 1;
      const h = getMinifigHeight() || 2.5;
      return new THREE.Box3(
        new THREE.Vector3(pos.x - w / 2, pos.y, pos.z - d / 2),
        new THREE.Vector3(pos.x + w / 2, pos.y + h, pos.z + d / 2)
      );
    }
    if (obj.userData.isDog) {
      // Dog footprint is 1x2, swapped to 2x1 on 90°/270° rotations.
      const k = Math.round(obj.rotation.y / (Math.PI / 2));
      const swapped = ((k % 2) + 2) % 2 === 1;
      const w = swapped ? 2 : 1;
      const d = swapped ? 1 : 2;
      // Body top (legLen 0.7 + bodyH 0.7 + ears ≈ 0.4 headroom)
      const h = 2.0;
      return new THREE.Box3(
        new THREE.Vector3(pos.x - w / 2, pos.y, pos.z - d / 2),
        new THREE.Vector3(pos.x + w / 2, pos.y + h, pos.z + d / 2)
      );
    }
    return new THREE.Box3().setFromObject(obj);
  }

  /** Returns the list of collision AABBs for an archway / archmid /
   *  archlarge block: two vertical jambs (1 stud wide each) plus a
   *  lintel AABB spanning the top. The interior opening is left
   *  uncovered so the player can walk through. The walk-through axis
   *  depends on the block's effective footprint — the jambs sit at the
   *  extremes of the LONGER side. */
  private archwayCollisionBoxes(
    obj: THREE.Object3D,
    spec: { w: number; d: number; type?: BlockType }
  ): THREE.Box3[] {
    // Height varies per variant — keep in sync with createArchwayBlock.
    let plates: number;
    switch (spec.type) {
      case 'archmid':
        plates = 21;
        break;
      case 'archlarge':
        plates = 24;
        break;
      default:
        plates = 18; // archway
    }
    const pos = obj.position;
    const h = plates * PLATE_HEIGHT;
    const legThk = 1.0; // 1 stud wide legs
    const LINTEL_Y = h - 3 * PLATE_HEIGHT; // top 1 brick = flat lintel
    const boxes: THREE.Box3[] = [];
    const w = spec.w;
    const d = spec.d;

    if (w >= d) {
      // Walk-through along ±Z (jambs at ±X extremes)
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(pos.x - w / 2, pos.y, pos.z - d / 2),
          new THREE.Vector3(
            pos.x - w / 2 + legThk,
            pos.y + h,
            pos.z + d / 2
          )
        )
      );
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(
            pos.x + w / 2 - legThk,
            pos.y,
            pos.z - d / 2
          ),
          new THREE.Vector3(pos.x + w / 2, pos.y + h, pos.z + d / 2)
        )
      );
      // Lintel only spans the OPENING between jambs (the jambs already
      // cover their corners at full height).
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(
            pos.x - w / 2 + legThk,
            pos.y + LINTEL_Y,
            pos.z - d / 2
          ),
          new THREE.Vector3(
            pos.x + w / 2 - legThk,
            pos.y + h,
            pos.z + d / 2
          )
        )
      );
    } else {
      // Walk-through along ±X (jambs at ±Z extremes)
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(pos.x - w / 2, pos.y, pos.z - d / 2),
          new THREE.Vector3(
            pos.x + w / 2,
            pos.y + h,
            pos.z - d / 2 + legThk
          )
        )
      );
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(
            pos.x - w / 2,
            pos.y,
            pos.z + d / 2 - legThk
          ),
          new THREE.Vector3(pos.x + w / 2, pos.y + h, pos.z + d / 2)
        )
      );
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(
            pos.x - w / 2,
            pos.y + LINTEL_Y,
            pos.z - d / 2 + legThk
          ),
          new THREE.Vector3(
            pos.x + w / 2,
            pos.y + h,
            pos.z + d / 2 - legThk
          )
        )
      );
    }

    return boxes;
  }

  /** Returns per-step collision AABBs for a staircase. Each step is a
   *  box from the ground (y=0) to the top of that step. This lets
   *  `tryStepUp` walk the player up one step at a time instead of
   *  seeing the whole staircase as an impassable full-height block.
   *  Uses the object's world matrix so rotated staircases work too. */
  private stairsCollisionBoxes(
    obj: THREE.Object3D,
    spec: { w: number; d: number; type?: BlockType }
  ): THREE.Box3[] {
    // Step rise per staircase variant (must match createStairsBlockShared).
    const stepRise =
      spec.type === 'gentlestairs' ? PLATE_HEIGHT : 3 * PLATE_HEIGHT;

    // Base (unrotated) dims from fixedSize in config. The block was built
    // in this orientation and then obj.rotation.y was applied.
    let baseW = 2;
    let baseD = spec.type === 'gentlestairs' ? 6 : 4;
    // If the effective footprint's longer axis doesn't match the base's,
    // the block was rotated by an odd step — swap to recover base dims.
    if ((spec.w > spec.d) !== (baseW > baseD)) {
      [baseW, baseD] = [baseD, baseW];
    }
    // GRID.X / GRID.Z = 1 stud pitch in our unit system.
    const width = baseW;
    const depth = baseD;

    obj.updateMatrixWorld(true);
    const boxes: THREE.Box3[] = [];
    // One AABB per step. Local step i spans full width, 1 stud in z at
    // z = -depth/2 + i, height = (i+1)*stepRise.
    for (let i = 0; i < baseD; i++) {
      const stepTop = (i + 1) * stepRise;
      const local = new THREE.Box3(
        new THREE.Vector3(-width / 2, 0, -depth / 2 + i),
        new THREE.Vector3(width / 2, stepTop, -depth / 2 + i + 1)
      );
      local.applyMatrix4(obj.matrixWorld);
      boxes.push(local);
    }
    return boxes;
  }

  /** Returns collision AABBs for a small arch (4×1, 1 brick tall). Two
   *  jamb boxes + the flat beam. The opening under the beam is 0.8 units
   *  tall — too short to walk under at ground level, but auto step-up
   *  handles the 1.2-tall top just fine. */
  private archCollisionBoxes(
    obj: THREE.Object3D,
    spec: { w: number; d: number }
  ): THREE.Box3[] {
    const pos = obj.position;
    const h = 3 * PLATE_HEIGHT; // 1.2
    const beamH = PLATE_HEIGHT; // 0.4 top flat
    const legH = h - beamH; // 0.8
    const legThk = 1.0;
    const w = spec.w;
    const d = spec.d;
    const boxes: THREE.Box3[] = [];

    if (w >= d) {
      // Jambs at ±X extremes, beam across full width at the top
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(pos.x - w / 2, pos.y, pos.z - d / 2),
          new THREE.Vector3(
            pos.x - w / 2 + legThk,
            pos.y + legH,
            pos.z + d / 2
          )
        )
      );
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(
            pos.x + w / 2 - legThk,
            pos.y,
            pos.z - d / 2
          ),
          new THREE.Vector3(pos.x + w / 2, pos.y + legH, pos.z + d / 2)
        )
      );
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(pos.x - w / 2, pos.y + legH, pos.z - d / 2),
          new THREE.Vector3(pos.x + w / 2, pos.y + h, pos.z + d / 2)
        )
      );
    } else {
      // Jambs at ±Z extremes
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(pos.x - w / 2, pos.y, pos.z - d / 2),
          new THREE.Vector3(
            pos.x + w / 2,
            pos.y + legH,
            pos.z - d / 2 + legThk
          )
        )
      );
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(
            pos.x - w / 2,
            pos.y,
            pos.z + d / 2 - legThk
          ),
          new THREE.Vector3(pos.x + w / 2, pos.y + legH, pos.z + d / 2)
        )
      );
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(pos.x - w / 2, pos.y + legH, pos.z - d / 2),
          new THREE.Vector3(pos.x + w / 2, pos.y + h, pos.z + d / 2)
        )
      );
    }

    return boxes;
  }

  /** Returns per-stud "step" AABBs for a pure-wedge ramp block, so
   *  auto step-up can carry the player up the slope one cell at a
   *  time. The cells are defined in LOCAL space (matching the
   *  orientation baked into createRampBlock's geometry) and then
   *  transformed by obj.matrixWorld, so rotated placements work. */
  private rampCollisionBoxes(
    obj: THREE.Object3D,
    spec: { w: number; d: number; type?: BlockType }
  ): THREE.Box3[] {
    const totalRise =
      spec.type === 'ramptall' ? 6 * PLATE_HEIGHT : 3 * PLATE_HEIGHT;

    // Recover base (pre-rotation) dims from the effective footprint.
    // At 90° / 270° placements spec.w / spec.d are swapped relative to
    // the dims that were handed to createBrick (and therefore to the
    // geometry's local axes).
    const k = Math.round(-obj.rotation.y / (Math.PI / 2));
    const rotSwap = ((k % 2) + 2) % 2 === 1;
    const baseW = rotSwap ? spec.d : spec.w;
    const baseD = rotSwap ? spec.w : spec.d;

    // createRampBlock uses `useX = w >= d` to decide whether the wedge
    // runs along local X (no extra rotateY) or local Z (extra +90°
    // rotateY baked into the geometry). Mirror that here so our cell
    // AABBs line up with the actual mesh.
    const useX = baseW >= baseD;
    const run = useX ? baseW : baseD;
    const cross = useX ? baseD : baseW;
    const cellRise = totalRise / run;

    obj.updateMatrixWorld(true);
    const boxes: THREE.Box3[] = [];
    for (let i = 0; i < run; i++) {
      const stepTop = (i + 1) * cellRise;
      let local: THREE.Box3;
      if (useX) {
        // Cells march along +X from low (-run/2) to high (+run/2).
        local = new THREE.Box3(
          new THREE.Vector3(-run / 2 + i, 0, -cross / 2),
          new THREE.Vector3(-run / 2 + i + 1, stepTop, cross / 2)
        );
      } else {
        // After the rotateY(+π/2) bake, the geometry's low end sits at
        // +Z and the high end at -Z. Cells march along -Z from low to
        // high, so cell 0 = [baseD/2 - 1, baseD/2].
        local = new THREE.Box3(
          new THREE.Vector3(-cross / 2, 0, run / 2 - i - 1),
          new THREE.Vector3(cross / 2, stepTop, run / 2 - i)
        );
      }
      local.applyMatrix4(obj.matrixWorld);
      boxes.push(local);
    }
    return boxes;
  }

  /** Returns collision AABBs for a swing block: just the two A-frame
   *  side panels that sit at the ±X ends of the footprint. The entire
   *  interior (where the seats hang and the dismounted rider stands) is
   *  deliberately left open so the player can walk out after pressing
   *  E to dismount. Build-mode/factory constants must stay in sync with
   *  createSwingBlock in blocks.ts. */
  private swingCollisionBoxes(
    obj: THREE.Object3D,
    spec: { w: number; d: number; type?: BlockType }
  ): THREE.Box3[] {
    // Recover BASE (pre-rotation) dims so the panel edges map to the
    // geometry's actual X axis, then let obj.matrixWorld rotate the
    // resulting AABBs back into world space.
    const k = Math.round(-obj.rotation.y / (Math.PI / 2));
    const rotSwap = ((k % 2) + 2) % 2 === 1;
    const baseW = rotSwap ? spec.d : spec.w;
    const baseD = rotSwap ? spec.w : spec.d;

    // Match createSwingBlock in blocks.ts
    const h = 24 * PLATE_HEIGHT; // 9.6
    const panelT = 0.28;

    obj.updateMatrixWorld(true);
    const boxes: THREE.Box3[] = [];
    // Left triangle panel: x = [-baseW/2, -baseW/2 + panelT]
    const leftLocal = new THREE.Box3(
      new THREE.Vector3(-baseW / 2, 0, -baseD / 2),
      new THREE.Vector3(-baseW / 2 + panelT, h, baseD / 2)
    );
    leftLocal.applyMatrix4(obj.matrixWorld);
    boxes.push(leftLocal);

    // Right triangle panel: x = [baseW/2 - panelT, baseW/2]
    const rightLocal = new THREE.Box3(
      new THREE.Vector3(baseW / 2 - panelT, 0, -baseD / 2),
      new THREE.Vector3(baseW / 2, h, baseD / 2)
    );
    rightLocal.applyMatrix4(obj.matrixWorld);
    boxes.push(rightLocal);

    // Top beam is at y ≈ 9.44 — well above even a 5-unit-tall minifig
    // standing on elevated ground, so we skip it to keep the interior
    // fully walkable.
    return boxes;
  }

  /** Split the bridge into a thin walkable deck + two side railings so
   *  the player walks on the deck surface, not on top of the railings. */
  private bridgeCollisionBoxes(
    obj: THREE.Object3D,
    spec: { w: number; d: number; type?: BlockType }
  ): THREE.Box3[] {
    const k = Math.round(-obj.rotation.y / (Math.PI / 2));
    const rotSwap = ((k % 2) + 2) % 2 === 1;
    const baseW = rotSwap ? spec.d : spec.w;
    const baseD = rotSwap ? spec.w : spec.d;

    // Match createBridgeBlock in blocks.ts
    const deckH = PLATE_HEIGHT; // 0.4 — the walkway slab
    const railH = 2.0; // post height above deck
    const railThk = 0.45; // corner-pillar thickness ≈ railing width

    obj.updateMatrixWorld(true);
    const boxes: THREE.Box3[] = [];

    // 1) Deck slab — thin, full-width, walkable surface
    const deckLocal = new THREE.Box3(
      new THREE.Vector3(-baseW / 2, 0, -baseD / 2),
      new THREE.Vector3(baseW / 2, deckH, baseD / 2)
    );
    deckLocal.applyMatrix4(obj.matrixWorld);
    boxes.push(deckLocal);

    // 2) Left railing wall
    const leftLocal = new THREE.Box3(
      new THREE.Vector3(-baseW / 2, deckH, -baseD / 2),
      new THREE.Vector3(-baseW / 2 + railThk, deckH + railH, baseD / 2)
    );
    leftLocal.applyMatrix4(obj.matrixWorld);
    boxes.push(leftLocal);

    // 3) Right railing wall
    const rightLocal = new THREE.Box3(
      new THREE.Vector3(baseW / 2 - railThk, deckH, -baseD / 2),
      new THREE.Vector3(baseW / 2, deckH + railH, baseD / 2)
    );
    rightLocal.applyMatrix4(obj.matrixWorld);
    boxes.push(rightLocal);

    return boxes;
  }

  // ------------------------------------------------------------------
  //  Preview
  // ------------------------------------------------------------------

  private updatePreview() {
    if (this.isPlaying) return;
    if (this.placementSuspended) {
      this.ghost.visible = false;
      this.hoverBox.visible = false;
      this.clearRemoveHover();
      return;
    }
    if (this.mode === 'remove') {
      this.ghost.visible = false;
      this.updateHoverBox();
    } else {
      this.hoverBox.visible = false;
      this.clearRemoveHover();
      this.updateGhost();
    }
  }

  /** Non-box types (slope, arch, round, cone, window, door, fence, wheel)
   *  need a shaped ghost built from the real geometry; box types (brick,
   *  plate, tile) use the cheaper wireframe box ghost. */
  private isShapedBlock(type: BlockType): boolean {
    return (
      type !== 'brick' &&
      type !== 'plate' &&
      type !== 'tile' &&
      type !== 'minifig'
    );
  }

  private updateGhost() {
    // Compute placement FIRST — it decides whether we need an edge auto-
    // rotate, which determines the final footprint and visual rotation.
    const placement = this.computePlacement();
    if (!placement) {
      this.ghost.visible = false;
      return;
    }

    const eff = this.effectiveSize();
    // After the auto-rotate fallback, the effective footprint's w/d swap.
    const finalW = placement.autoRotate ? eff.d : eff.w;
    const finalD = placement.autoRotate ? eff.w : eff.d;
    // Total rotation step (user's + auto-rotate delta), in 90° steps.
    const totalRotStep = this.rotationStep + (placement.autoRotate ? 1 : 0);

    const heightPlates = this.currentGhostHeightPlates();
    const u = this.ghost.userData;
    const isMinifig = this.blockType === 'minifig';
    const isDog = this.blockType === 'dog';
    const isShaped = this.isShapedBlock(this.blockType);

    const needsRecreate =
      u.type !== this.blockType ||
      u.w !== finalW ||
      u.d !== finalD ||
      u.heightPlates !== heightPlates ||
      // Shaped/minifig/dog ghosts bake rotation into their child meshes
      // so any rotation change requires a full rebuild.
      (isMinifig &&
        (u.characterId !== this.character.id ||
          u.characterVersion !== this.characterVersion ||
          u.totalRotStep !== totalRotStep)) ||
      (isDog && u.totalRotStep !== totalRotStep) ||
      (isShaped &&
        (u.colorHex !== this.color.hex ||
          u.totalRotStep !== totalRotStep));

    if (needsRecreate) {
      this.scene.remove(this.ghost);
      if (isMinifig) {
        const fig = createMinifigGhost(this.character);
        fig.rotation.y = -totalRotStep * (Math.PI / 2);
        this.ghost = fig;
      } else if (isDog) {
        const dog = createDogGhost();
        dog.rotation.y = -totalRotStep * (Math.PI / 2);
        this.ghost = dog;
      } else if (isShaped) {
        // Build the ghost from the *base* (unrotated) dimensions, then
        // apply explicit Y rotation. The factory's internal canonical
        // orientation + this rotation together produce the visual that
        // matches effectiveSize() (plus any auto-rotate delta).
        const base = this.baseDims();
        const shaped = createBrickGhost({
          w: base.w,
          d: base.d,
          colorHex: this.color.hex,
          type: this.blockType,
        });
        shaped.rotation.y = -totalRotStep * (Math.PI / 2);
        this.ghost = shaped;
      } else {
        // Box ghost: dimensions carry the rotation.
        this.ghost = createGhost({
          w: finalW,
          d: finalD,
          heightPlates,
          colorHex: this.color.hex,
        });
      }
      this.ghost.userData.type = this.blockType;
      this.ghost.userData.w = finalW;
      this.ghost.userData.d = finalD;
      this.ghost.userData.heightPlates = heightPlates;
      this.ghost.userData.colorHex = this.color.hex;
      this.ghost.userData.characterId = this.character.id;
      this.ghost.userData.characterVersion = this.characterVersion;
      this.ghost.userData.totalRotStep = totalRotStep;
      // Snapshot original colors so the invalid-state red tint can be
      // restored cleanly when the placement becomes valid again.
      this.ghost.userData.invalidTinted = false;
      this.ghost.userData.materialOriginalColors = [];
      this.ghost.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          const mat = c.material as { color?: THREE.Color };
          if (mat.color) {
            this.ghost.userData.materialOriginalColors.push({
              mat,
              hex: mat.color.getHex(),
            });
          }
        }
      });
      this.scene.add(this.ghost);
    } else if (
      !isMinifig &&
      !isDog &&
      !isShaped &&
      this.ghost instanceof THREE.Mesh
    ) {
      // Cheap color update for the box ghost
      const mat = this.ghost.material as THREE.MeshBasicMaterial;
      mat.color.setHex(this.color.hex);
      this.ghost.userData.colorHex = this.color.hex;
    }

    // Apply / restore the "invalid" red tint based on the current placement.
    // Only the bridge currently uses placement.invalid; other blocks always
    // have invalid === false.
    const wantTinted = placement.invalid === true;
    if (wantTinted !== this.ghost.userData.invalidTinted) {
      const originals = (this.ghost.userData.materialOriginalColors ?? []) as {
        mat: { color: THREE.Color };
        hex: number;
      }[];
      if (wantTinted) {
        for (const o of originals) o.mat.color.setHex(0xe24848);
      } else {
        for (const o of originals) o.mat.color.setHex(o.hex);
      }
      this.ghost.userData.invalidTinted = wantTinted;
    }

    this.ghost.position.set(placement.x, placement.y, placement.z);
    this.ghost.visible = true;
  }

  private updateHoverBox() {
    // Legacy name kept for the call sites in updatePreview — this now
    // tints the hovered block's materials into a translucent red ghost
    // instead of positioning a line-outline box.
    this.hoverBox.visible = false; // old outline stays hidden
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.brickGroup.children,
      true
    );
    if (hits.length === 0) {
      this.clearRemoveHover();
      return;
    }
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.isBrick) obj = obj.parent;
    if (!obj || obj.parent !== this.brickGroup) {
      this.clearRemoveHover();
      return;
    }
    if (obj === this.hoverRemoveTarget) return; // already tinted — no change
    this.tintForRemove(obj);
  }

  /** Swap every mesh's material inside `obj` with the shared red ghost
   *  material, saving the originals so clearRemoveHover() can restore
   *  them exactly. The previous hover target (if any) is restored first. */
  private tintForRemove(obj: THREE.Object3D) {
    this.clearRemoveHover();
    const saved: Array<{
      mesh: THREE.Mesh;
      original: THREE.Material | THREE.Material[];
      renderOrder: number;
    }> = [];
    obj.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      saved.push({
        mesh: m,
        original: m.material,
        renderOrder: m.renderOrder,
      });
      m.material = this.removeHoverMaterial;
      // Draw the ghost on top of everything so studs / intersecting
      // blocks don't punch holes through it.
      m.renderOrder = 999;
    });
    this.hoverRemoveTarget = obj;
    this.hoverRemoveSaved = saved;
  }

  /** Restore the currently-tinted block's original materials and clear
   *  the hover target. Safe to call when nothing is tinted. */
  private clearRemoveHover() {
    if (!this.hoverRemoveTarget) return;
    for (const entry of this.hoverRemoveSaved) {
      entry.mesh.material = entry.original;
      entry.mesh.renderOrder = entry.renderOrder;
    }
    this.hoverRemoveTarget = null;
    this.hoverRemoveSaved = [];
  }

  // ------------------------------------------------------------------
  //  Place / remove
  // ------------------------------------------------------------------

  /** @returns the placement position when a block was actually placed,
   *  or null if the ghost was invalid / no hit. The caller can use the
   *  returned position to start a line-paint streak (see Space handler). */
  private placeBlock(): { x: number; y: number; z: number } | null {
    const placement = this.computePlacement();
    if (!placement) return null;
    if (placement.invalid) return null;
    this.placeAtPosition(placement, placement.autoRotate);
    return { x: placement.x, y: placement.y, z: placement.z };
  }

  /** Places a block at the given (already-snapped and validated) position.
   *  `autoRotate` is true when `computePlacement` had to rotate the block
   *  90° to fit the baseplate edge — the extra rotation is applied on top
   *  of the user's `rotationStep`. */
  private placeAtPosition(
    p: { x: number; y: number; z: number },
    autoRotate = false
  ) {
    let obj: THREE.Group;
    // Total rotation in 90° steps, combining the user's choice and any
    // edge-fit auto-rotate delta.
    const totalRotStep = this.rotationStep + (autoRotate ? 1 : 0);

    if (this.blockType === 'minifig') {
      obj = createMinifigure(this.character);
      obj.rotation.y = -totalRotStep * (Math.PI / 2);
    } else if (this.blockType === 'dog') {
      obj = createDogCharacter();
      obj.rotation.y = -totalRotStep * (Math.PI / 2);
    } else {
      const base = this.baseDims();
      obj = createBrick({
        w: base.w,
        d: base.d,
        colorHex: this.color.hex,
        type: this.blockType,
      });
      // Effective (post-rotation) footprint — accounts for both the user's
      // rotation step and any auto-rotate delta.
      const eff = this.effectiveSize();
      const finalW = autoRotate ? eff.d : eff.w;
      const finalD = autoRotate ? eff.w : eff.d;

      // Shaped blocks (slope, arch, window, door, fence, wheel, round, cone)
      // need an explicit Y rotation to honor the 4-way rotation step.
      // Box blocks (brick, plate, tile) only swap dimensions on odd steps,
      // so rotate via the dimension swap to keep their stud grid aligned.
      if (this.isShapedBlock(this.blockType)) {
        obj.rotation.y = -totalRotStep * (Math.PI / 2);
        // Override the spec stored on the group with the *final* (post-
        // everything) footprint so getBlockAABB / wouldOverlap see the right
        // bounds.
        obj.userData.spec = {
          ...(obj.userData.spec ?? {}),
          w: finalW,
          d: finalD,
          type: this.blockType,
        };
      } else {
        // Box blocks: rebuild with the final dimensions so the stud grid
        // matches the visible footprint.
        if (finalW !== base.w || finalD !== base.d) {
          obj = createBrick({
            w: finalW,
            d: finalD,
            colorHex: this.color.hex,
            type: this.blockType,
          });
        }
      }
    }
    obj.position.set(p.x, p.y, p.z);
    this.brickGroup.add(obj);
    // If this is a lamp, immediately apply the current night factor so the
    // bulb glow / point light reflect the live time-of-day rather than
    // popping in only after the next slider drag.
    if (obj.userData.isLamp) this.updateLampForTime(obj);
    if (!this.suppressBlockCallbacks) {
      this.sound.playClick();
      // Broadcast to multiplayer / any listeners
      this.onBlockPlaced(obj, /* local */ true);
    }
    this.onCountChange(this.brickGroup.children.length);
  }

  private posKey(p: { x: number; y: number; z: number }): string {
    return `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
  }

  /** Shift+drag line placement along the dominant axis from the start point. */
  private updateShiftLine() {
    const start = this.shiftLineStart;
    if (!start) return;

    // Intersect mouse ray with a horizontal plane at start.y so newly placed
    // blocks don't hijack the raycast and the line stays horizontal.
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -start.y);
    const hitPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hitPoint)) return;

    const eff = this.effectiveSize();
    const currentX = this.snapXZ(hitPoint.x, eff.w);
    const currentZ = this.snapXZ(hitPoint.z, eff.d);
    const dx = currentX - start.x;
    const dz = currentZ - start.z;
    const useX = Math.abs(dx) >= Math.abs(dz);

    const stepSize = useX ? eff.w : eff.d;
    const totalDist = useX ? Math.abs(dx) : Math.abs(dz);
    const steps = Math.floor(totalDist / stepSize + 1e-4);
    const signX = useX ? Math.sign(dx) : 0;
    const signZ = useX ? 0 : Math.sign(dz);

    for (let i = 0; i <= steps; i++) {
      const pos = {
        x: start.x + signX * stepSize * i,
        y: start.y,
        z: start.z + signZ * stepSize * i,
      };
      const key = this.posKey(pos);
      if (this.shiftLinePlaced.has(key)) continue;
      if (!this.isFootprintOnBaseplate(pos.x, pos.z, eff.w / 2, eff.d / 2))
        continue;
      if (this.wouldOverlap(pos.x, pos.y, pos.z)) continue;
      this.placeAtPosition(pos);
      this.shiftLinePlaced.add(key);
    }
  }

  private removeBlock() {
    // Restore any lingering remove-mode material tint first. The click
    // target is almost always the tinted block, but clearing
    // unconditionally keeps the state sane even if hover and click
    // point at different objects.
    this.clearRemoveHover();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.brickGroup.children,
      true
    );
    if (hits.length === 0) return;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.isBrick) obj = obj.parent;
    if (obj && obj.parent === this.brickGroup) {
      const removedObj = obj;
      this.brickGroup.remove(removedObj);
      if (!this.suppressBlockCallbacks) {
        this.sound.playRemove();
        this.onBlockRemoved(removedObj, /* local */ true);
      }
      this.onCountChange(this.brickGroup.children.length);
      this.updatePreview();
    }
  }

  // ------------------------------------------------------------------
  //  Public ghost-control API
  //
  //  Used by the mobile D-pad / virtual buttons to nudge the placement
  //  ghost and place blocks without going through synthetic keyboard
  //  events. Direct method calls bypass the entire keydown pipeline.
  // ------------------------------------------------------------------

  /** Activate the keyboard ghost at the board center if it isn't
   *  already active. Used by the mobile builder so the ghost is
   *  visible from the moment the user opens the app, without first
   *  having to press an arrow. */
  activateGhostAtCenter(): void {
    if (this.kbCursor.active) return;
    const eff = this.effectiveSize();
    this.kbCursor.x = this.snapXZ(0, eff.w);
    this.kbCursor.z = this.snapXZ(0, eff.d);
    this.kbCursor.active = true;
    this.placementSuspended = false;
    this.kbCursorLastMove = performance.now();
    this.updatePreview();
  }

  /** Move the placement ghost by one footprint step in the given
   *  camera-relative direction. dir = 'up' / 'down' / 'left' / 'right'.
   *  Returns true if the ghost actually moved (i.e. wasn't blocked by
   *  the baseplate edge). */
  nudgeGhost(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    if (this.isPlaying) return false;
    // Remember the last direction so placeAtGhost can auto-advance.
    this.kbCursorLastDir = dir;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 0.001) camDir.set(0, 0, -1);
    camDir.normalize();
    const camRight = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), camDir)
      .normalize();

    let dx = 0;
    let dz = 0;
    switch (dir) {
      case 'up':    dx = camDir.x;    dz = camDir.z;    break;
      case 'down':  dx = -camDir.x;   dz = -camDir.z;   break;
      case 'left':  dx = camRight.x;  dz = camRight.z;  break;
      case 'right': dx = -camRight.x; dz = -camRight.z; break;
    }
    const useXAxis = Math.abs(dx) >= Math.abs(dz);
    const sX = useXAxis ? Math.sign(dx) : 0;
    const sZ = useXAxis ? 0 : Math.sign(dz);

    const eff = this.effectiveSize();

    // Initialize cursor from current ghost position if not active
    if (!this.kbCursor.active) {
      if (this.ghost.visible) {
        this.kbCursor.x = this.ghost.position.x;
        this.kbCursor.z = this.ghost.position.z;
      } else {
        this.kbCursor.x = 0;
        this.kbCursor.z = 0;
      }
      this.kbCursor.active = true;
      this.placementSuspended = false;
    }
    const prevX = this.kbCursor.x;
    const prevZ = this.kbCursor.z;
    this.kbCursor.x += sX * eff.w;
    this.kbCursor.z += sZ * eff.d;
    const snappedX = this.snapXZ(this.kbCursor.x, eff.w);
    const snappedZ = this.snapXZ(this.kbCursor.z, eff.d);
    if (!this.isFootprintOnBaseplate(snappedX, snappedZ, eff.w / 2, eff.d / 2)) {
      this.kbCursor.x = prevX;
      this.kbCursor.z = prevZ;
      this.kbCursorLastMove = performance.now();
      this.updatePreview();
      return false;
    }
    this.kbCursorLastMove = performance.now();
    this.updatePreview();
    return true;
  }

  /** Place a block at the current ghost position. Returns true if
   *  placement succeeded. Also activates line-streak mode so the
   *  next nudgeGhost continues the row. */
  placeAtGhost(): boolean {
    if (this.isPlaying) return false;
    if (this.placementSuspended) return false;
    if (!this.ghost.visible) return false;
    if (this.mode === 'remove') {
      this.removeBlock();
      return true;
    }
    const placed = this.placeBlock();
    if (placed) {
      this.lastPlacedPos = placed;
      this.lineStreakActive = true;
      this.kbCursor.x = placed.x;
      this.kbCursor.z = placed.z;
      this.kbCursor.active = true;
      this.kbCursorLastMove = performance.now();
      // Auto-advance the ghost one footprint in the last nudge
      // direction so the next block sits BESIDE the one we just
      // placed, not on top of it. If the advanced cell is outside
      // the baseplate, fall back to staying in place.
      if (!this.nudgeGhost(this.kbCursorLastDir)) {
        // Couldn't advance (edge of board) — leave ghost at placed pos
        this.updatePreview();
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  //  Multiplayer remote application
  //
  //  These public methods let the multiplayer module apply block
  //  changes received from remote peers without re-broadcasting or
  //  playing local sounds. They also expose the raw brick group so
  //  remote player avatars can be rendered on top.
  // ------------------------------------------------------------------

  /** Apply a block placement received from a remote peer. */
  applyRemoteBlockPlace(info: {
    type: string;
    x: number;
    y: number;
    z: number;
    w: number;
    d: number;
    colorHex: number;
    rotation: number;          // quarter turns (0..3)
    characterId?: string;
  }): void {
    let obj: THREE.Group;
    if (info.type === 'minifig') {
      const preset =
        MINIFIG_PRESETS.find((p) => p.id === info.characterId) ??
        MINIFIG_PRESETS[0];
      obj = createMinifigure(preset);
      obj.userData.characterId = preset.id;
    } else if (info.type === 'dog') {
      obj = createDogCharacter();
    } else {
      obj = createBrick({
        w: info.w,
        d: info.d,
        colorHex: info.colorHex,
        type: info.type as BlockType,
      });
    }
    obj.rotation.y = -info.rotation * (Math.PI / 2);
    obj.position.set(info.x, info.y, info.z);
    // Stamp spec with final footprint so overlap/collision logic sees
    // the correct bounds (matches what local placeAtPosition does).
    obj.userData.spec = {
      ...(obj.userData.spec ?? {}),
      type: info.type,
      w: info.w,
      d: info.d,
      colorHex: info.colorHex,
    };
    // Use a remote stamp so we can find-and-remove the exact object later
    // when a matching remote-remove arrives.
    obj.userData.remoteKey = `${info.x.toFixed(2)},${info.y.toFixed(2)},${info.z.toFixed(2)}`;
    this.brickGroup.add(obj);
    if (obj.userData.isLamp) this.updateLampForTime(obj);
    this.onCountChange(this.brickGroup.children.length);
    this.onBlockPlaced(obj, /* local */ false);
  }

  /** Apply a block removal received from a remote peer. Finds the
   *  topmost brick at the exact position and removes it. */
  applyRemoteBlockRemove(info: { x: number; y: number; z: number }): void {
    const key = `${info.x.toFixed(2)},${info.y.toFixed(2)},${info.z.toFixed(2)}`;
    for (let i = this.brickGroup.children.length - 1; i >= 0; i--) {
      const child = this.brickGroup.children[i];
      if (child.userData.remoteKey === key) {
        this.brickGroup.remove(child);
        this.onCountChange(this.brickGroup.children.length);
        this.onBlockRemoved(child, false);
        return;
      }
      // Also match local-placed blocks by position
      if (
        child.userData.isBrick &&
        Math.abs(child.position.x - info.x) < 0.01 &&
        Math.abs(child.position.y - info.y) < 0.01 &&
        Math.abs(child.position.z - info.z) < 0.01
      ) {
        this.brickGroup.remove(child);
        this.onCountChange(this.brickGroup.children.length);
        this.onBlockRemoved(child, false);
        return;
      }
    }
  }

  /** Accessor for the scene — lets multiplayer add/remove remote
   *  player avatars without touching internal fields. */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /** Current local player position + facing (only meaningful while in
   *  play mode). Yaw is derived from the camera's world-space Y rotation. */
  getPlayerState(): { x: number; y: number; z: number; rotY: number; isPlaying: boolean } {
    // Extract yaw from the camera's world quaternion — works in both 1st
    // and 3rd person views because the camera always points toward the
    // player's facing direction.
    const e = new THREE.Euler().setFromQuaternion(
      this.camera.quaternion,
      'YXZ'
    );
    return {
      x: this.playerPos.x,
      y: this.playerPos.y,
      z: this.playerPos.z,
      rotY: e.y,
      isPlaying: this.isPlaying,
    };
  }

  // ------------------------------------------------------------------
  //  Play mode (first-person FPS)
  // ------------------------------------------------------------------

  startPlay() {
    if (this.isPlaying) return;
    try {
      this.startPlayInternal();
    } catch (err) {
      // If anything in startup throws (e.g. character model not yet
      // loaded, a node not yet in the scene, etc.) don't leave the game
      // stuck in a half-started play state with no key handling and a
      // disabled orbit camera.
      console.error('[startPlay] failed:', err);
      this.isPlaying = false;
      this.controls.enabled = true;
      if (this.playerAvatar) {
        this.scene.remove(this.playerAvatar);
        this.playerAvatar = null;
      }
      this.onPlayChange(false);
    }
  }

  private startPlayInternal() {
    this.isPlaying = true;

    // Drop focus from any UI button so Space/WASD don't retrigger it
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) active.blur();

    // Save current build camera state
    this.savedCam.position.copy(this.camera.position);
    this.savedCam.target.copy(this.controls.target);

    // Hide build previews + restore any remove-mode hover tint so the
    // placed block renders normally in play mode.
    this.ghost.visible = false;
    this.hoverBox.visible = false;
    this.clearRemoveHover();

    // Disable orbit controls
    this.controls.enabled = false;

    // Build collision AABBs (body-only, excluding studs) for every placed
    // object. Each AABB has a parallel entry in playAABBDoorRefs — non-null
    // for door root groups, so the collision loops can skip open doors.
    this.playAABBs = [];
    this.playAABBDoorRefs = [];
    // Reset any leftover door animations and put every door's hinge group
    // back to the closed position before snapshotting.
    this.doorAnimations.clear();
    this.currentDoorHotspot = null;
    this.currentNpcHotspot = null;
    for (const child of this.brickGroup.children) {
      const hinge = findDoorHinge(child);
      if (hinge) hinge.rotation.y = 0;
    }

    // Rebuild the NPC list from every placed minifig and skip minifigs
    // when snapshotting collision AABBs — NPCs move each frame, so their
    // collision is handled dynamically via `this.npcs`, not the static
    // playAABBs snapshot.
    this.npcs = [];
    for (const child of this.brickGroup.children) {
      const spec = child.userData.spec as
        | { w: number; d: number; type?: BlockType }
        | undefined;
      const isMinifigNpc =
        spec?.type === 'minifig' || child.userData.isMinifig;
      const isDogNpc = spec?.type === 'dog' || child.userData.isDog;
      if (isMinifigNpc || isDogNpc) {
        const homePos = child.position.clone();
        const initYaw = child.rotation.y;
        this.npcs.push({
          obj: child as THREE.Group,
          homePos,
          origRotY: initYaw,
          target: homePos.clone(),
          yaw: initYaw,
          walkTime: 0,
          state: 'idle',
          // Stagger initial idle so NPCs don't all start moving on frame 1
          stateTimer: 0.5 + Math.random() * 2.5,
          greeting: '',
          isDog: isDogNpc,
        });
        continue; // no static AABB for NPCs
      }
      // Archway variants: the getBlockAABB fallback would treat the
      // entire extruded block as solid — walking through the opening
      // would be impossible. Split the collider into left jamb + right
      // jamb + top lintel so the opening is actually passable.
      if (
        spec?.type === 'archway' ||
        spec?.type === 'archmid' ||
        spec?.type === 'archlarge'
      ) {
        for (const box of this.archwayCollisionBoxes(child, spec)) {
          this.playAABBs.push(box);
          this.playAABBDoorRefs.push(null);
        }
        continue;
      }
      // Stairs: each step is its own AABB so auto-step-up can walk the
      // player up one step at a time. A single full-height AABB would
      // exceed STEP_MAX on the first frame.
      if (spec?.type === 'stairs' || spec?.type === 'gentlestairs') {
        for (const box of this.stairsCollisionBoxes(child, spec)) {
          this.playAABBs.push(box);
          this.playAABBDoorRefs.push(null);
        }
        continue;
      }
      // Small arch (1-brick tall, beam + two legs): decompose into two
      // legs + the beam so the geometry matches the visual. At ground
      // level the character still has to auto-step over it (the opening
      // is only ~0.8 unit tall — well below head height).
      if (spec?.type === 'arch') {
        for (const box of this.archCollisionBoxes(child, spec)) {
          this.playAABBs.push(box);
          this.playAABBDoorRefs.push(null);
        }
        continue;
      }
      // Full-length wedge ramps: decompose into per-stud "steps" whose
      // heights grow linearly. The player auto-step-ups one cell at a
      // time, so a long 1x6 ramp feels like a smooth climb instead of
      // an impenetrable sloped wall.
      if (spec?.type === 'ramp' || spec?.type === 'ramptall') {
        for (const box of this.rampCollisionBoxes(child, spec)) {
          this.playAABBs.push(box);
          this.playAABBDoorRefs.push(null);
        }
        continue;
      }
      // Swing: only the two A-frame side panels are solid — the entire
      // interior between them (where the seats hang) must be walkable
      // so the rider can dismount and walk out. Without this decomp,
      // getBlockAABB treats the whole 12×9.6×3 shell as solid and the
      // dismounted player is stuck inside.
      if (spec?.type === 'swing') {
        for (const box of this.swingCollisionBoxes(child, spec)) {
          this.playAABBs.push(box);
          this.playAABBDoorRefs.push(null);
        }
        continue;
      }
      // Bridge: decompose into a thin deck slab + two side railings.
      // Without this, the single full-height AABB makes the player walk
      // on top of the railings instead of the deck surface.
      if (spec?.type === 'bridge') {
        for (const box of this.bridgeCollisionBoxes(child, spec)) {
          this.playAABBs.push(box);
          this.playAABBDoorRefs.push(null);
        }
        continue;
      }
      this.playAABBs.push(this.getBlockAABB(child));
      this.playAABBDoorRefs.push(spec?.type === 'door' ? child : null);
    }

    // Spawn player on a clear spot near the +Z edge of the origin tile
    const spawnZ = Math.min(15, this.tileSize / 2 - 5);
    this.playerPos.set(0, 0, spawnZ);
    this.playerVel.set(0, 0, 0);
    this.onGround = true;

    // Add baseplate AABBs for collision so the player doesn't fall through.
    // Slab bottom is relative to the environment's plate thickness (0.4 for
    // the standard plate, larger for island / other thicker environments).
    // The slab top is nudged DOWN by a tiny epsilon: THREE.Box3.intersectsBox
    // treats face-touching boxes as intersecting (uses strict <), so a player
    // whose feet sit exactly on the slab top (y=0) would otherwise be in
    // permanent collision and X/Z movement would be blocked every frame.
    // The visual baseplate stays at y=0; only the collision box is offset.
    const plateThickness = this.environment.baseplateThickness ?? 0.4;
    const SLAB_TOP_EPS = 0.001;
    for (const tile of this.baseplates.values()) {
      const half = this.tileSize / 2;
      const slabBottom = tile.position.y - plateThickness;
      const slabTop = tile.position.y - SLAB_TOP_EPS;
      this.playAABBs.push(
        new THREE.Box3(
          new THREE.Vector3(
            tile.position.x - half,
            slabBottom,
            tile.position.z - half
          ),
          new THREE.Vector3(
            tile.position.x + half,
            slabTop,
            tile.position.z + half
          )
        )
      );
      this.playAABBDoorRefs.push(null);
    }
    this.walkTime = 0;
    this.avatarYaw = Math.PI; // facing -Z (toward origin/baseplate center)

    // Create the visible avatar (used in 3rd-person view)
    this.playerAvatar = createMinifigure(this.character);
    // YXZ order: yaw (Y) is applied first, then any X/Z tilts in the
    // yaw-rotated frame. This matters for ride poses (e.g. swing ride
    // tilts the body forward/back along the swing direction by setting
    // rotation.x). With XYZ order the X tilt would happen in WORLD space
    // and would not align with the avatar's facing direction.
    this.playerAvatar.rotation.order = 'YXZ';
    this.playerAvatar.position.copy(this.playerPos);
    this.playerAvatar.rotation.y = this.avatarYaw;
    this.playerAvatar.visible = this.viewMode === 'third';
    this.scene.add(this.playerAvatar);

    // Lazily create PointerLockControls, bound to the canvas
    if (!this.fpsControls) {
      this.fpsControls = new PointerLockControls(
        this.camera,
        this.renderer.domElement
      );
      // Clamp pitch so the user can't look fully straight up/down — keeps
      // both 1st and 3rd person cameras well-behaved.
      this.fpsControls.minPolarAngle = 0.25;
      this.fpsControls.maxPolarAngle = Math.PI - 0.25;
      // Only exit play mode if user actually unlocks AFTER having locked
      // (e.g., pressed ESC). Failed lock attempts never reach 'lock' event.
      // three.js's EventDispatcher has no { once: true } option, so we
      // remove the unlock listener manually inside its handler.
      this.fpsControls.addEventListener('lock', () => {
        const onUnlock = () => {
          this.fpsControls!.removeEventListener('unlock', onUnlock);
          if (this.isPlaying) this.stopPlay();
        };
        this.fpsControls!.addEventListener('unlock', onUnlock);
      });
    }

    // Position camera based on the active view mode
    if (this.viewMode === 'first') {
      this.camera.position.set(
        this.playerPos.x,
        this.playerPos.y + 3.0,
        this.playerPos.z
      );
      this.camera.lookAt(0, 3.0, 0);
    } else {
      // Seed an isometric look direction (NE down) so the camera ends up
      // above-and-behind the player on the very first frame.
      this.camera.position.set(
        this.playerPos.x + 8,
        this.playerPos.y + 10,
        this.playerPos.z + 8
      );
      this.camera.lookAt(
        this.playerPos.x,
        this.playerPos.y + 2,
        this.playerPos.z
      );
      this.updateThirdPersonCamera();
    }
    // Pointer lock works for both modes — 1st person uses it for first-person
    // mouse-look, 3rd person uses it to orbit around the avatar.
    try {
      this.fpsControls.lock();
    } catch {
      /* ignore — sandboxed iframes can't acquire pointer lock */
    }
    this.lastFrameTime = performance.now();
    this.onPlayChange(true);
    // Notify UI whether a dog-whistle button should appear on the
    // overlay. Dogs were added to `this.npcs` above.
    const hasDog = this.npcs.some((n) => n.isDog);
    this.dogsFollowing = false;
    this.onDogsPresentChange(hasDog);
    this.onDogsFollowingChange(false);
    // Kick off the dog-bark sample load early so the first real bark
    // doesn't drop while the fetch/decode is in flight. This call makes
    // no sound — playBark() bails out until the buffer is ready.
    if (hasDog) this.sound.playBark();
  }

  stopPlay() {
    if (!this.isPlaying) return;
    this.isPlaying = false;

    this.moveKeys.forward = false;
    this.moveKeys.back = false;
    this.moveKeys.left = false;
    this.moveKeys.right = false;
    this.moveKeys.jump = false;
    this.moveKeys.run = false;

    if (this.fpsControls && this.fpsControls.isLocked) {
      this.fpsControls.unlock();
    }

    // If a playground ride is active, reset the avatar pose AND any
    // animated equipment parts BEFORE we despawn the avatar (otherwise
    // the next play session inherits a frozen mid-swing/mid-rock state
    // on the equipment).
    if (this.playgroundRide) {
      const ride = this.playgroundRide;
      const rparts = ride.obj.userData.parts as
        | { swingPivots?: THREE.Group[]; plankGroup?: THREE.Group }
        | undefined;
      if (ride.type === 'swing' && rparts?.swingPivots) {
        for (const p of rparts.swingPivots) p.rotation.x = 0;
      } else if (ride.type === 'seesaw' && rparts?.plankGroup) {
        rparts.plankGroup.rotation.z = -0.14;
      }
      if (this.playerAvatar) {
        this.playerAvatar.rotation.x = 0;
        this.applySitPose(false);
      }
      this.playgroundRide = null;
    }

    // Despawn avatar
    if (this.playerAvatar) {
      this.scene.remove(this.playerAvatar);
      this.playerAvatar = null;
    }

    // Reset door hinges back to closed so the build-mode view shows them
    // in their canonical state, and drop the interaction prompt.
    for (const child of this.brickGroup.children) {
      const hinge = findDoorHinge(child);
      if (hinge) hinge.rotation.y = 0;
    }
    this.doorAnimations.clear();
    this.currentDoorHotspot = null;
    this.getDoorPrompt()?.classList.add('hidden');

    // Restore every NPC to its original placement position/rotation and
    // reset its limbs to neutral — so re-entering build mode shows the
    // minifigs exactly where the user put them.
    for (const npc of this.npcs) {
      npc.obj.position.copy(npc.homePos);
      npc.obj.rotation.y = npc.origRotY;
      applyNpcLimbs(npc.obj, 0);
    }
    this.npcs = [];
    this.currentNpcHotspot = null;
    this.getNpcPrompt()?.classList.add('hidden');
    this.getNpcBubble()?.classList.add('hidden');

    this.playgroundHotspot = null;
    this.getPlaygroundPrompt()?.classList.add('hidden');

    // Restore build camera + orbit controls
    this.camera.position.copy(this.savedCam.position);
    this.controls.target.copy(this.savedCam.target);
    this.controls.enabled = true;
    this.controls.update();

    // Drop any active vehicle ride
    if (this.vehicleRide) {
      this.vehicleRide = null;
    }
    this.vehicleHotspot = null;

    this.onPlayChange(false);
    // Hide the dog-whistle UI on the way out of play mode.
    this.dogsFollowing = false;
    this.onDogsPresentChange(false);
    this.onDogsFollowingChange(false);
  }

  // ==================================================================
  //                         PAC-MAN GAME MODE
  // ==================================================================
  //  Kept as its own set of entry/exit/update methods (rather than
  //  reusing startPlay/stopPlay) because almost every physics and
  //  camera rule is inverted: top-down fixed camera, arrow-key
  //  grid-aligned movement, no gravity, no mouse look.
  //
  //  startPacman()   — snapshot colliders + pellet inventory, spawn
  //                    player at the middle of the baseplate, lock the
  //                    camera to a fixed high-angle shot, play the
  //                    intro melody and start the siren BGM.
  //  stopPacman()    — restore collected pellets to the scene so the
  //                    build-mode map is unchanged on exit.
  //  updatePacman()  — per-frame update driven from the render loop.

  /** Enter Pac-Man game mode — generates the classic maze procedurally,
   *  hides the build scene, spawns the player + 4 ghosts, then starts
   *  the intro music. Call stopPacman() to exit. */
  startPacman() {
    if (this.isPlaying || this.isPacmanPlaying) return;
    this.isPacmanPlaying = true;

    // Save camera/controls state so the build view can be restored
    this.savedCam.position.copy(this.camera.position);
    this.savedCam.target.copy(this.controls.target);
    this.controls.enabled = false;

    // Hide the build-mode scene entirely — the Pac-Man maze lives in
    // its own group so the user's blocks aren't disturbed.
    this.pacmanSavedBrickVisible = this.brickGroup.visible;
    this.brickGroup.visible = false;
    this.ghost.visible = false;
    this.hoverBox.visible = false;

    // Hide every baseplate tile too (the maze provides its own floor)
    for (const tile of this.baseplates.values()) tile.visible = false;

    // Build the maze
    this.buildPacmanMaze();

    // Reset game state
    this.pacmanScore = 0;
    this.pacmanLives = 3;
    this.pacmanStage = 1;
    this.pacmanReadyTimer = 1.2;
    this.pacmanDeathTimer = 0;
    this.pacmanFrightenedTime = 0;
    this.pacmanFruitSpawned = false;
    this.pacmanFruitTimer = 0;
    this.pacmanFruit = null;

    // Spawn player at the maze's designated P cell
    this.playerPos.copy(this.pacmanPlayerSpawn);
    this.playerVel.set(0, 0, 0);
    this.avatarYaw = 0;
    if (!this.playerAvatar) {
      this.playerAvatar = createMinifigure(this.character);
      this.playerAvatar.rotation.order = 'YXZ';
      this.scene.add(this.playerAvatar);
    }
    this.playerAvatar.scale.set(1, 1, 1);
    this.playerAvatar.position.copy(this.playerPos);
    this.playerAvatar.rotation.set(0, 0, 0);
    this.playerAvatar.visible = true;

    // Overhead camera — fixed, angled so the player sees the whole
    // maze like the reference images. Camera height scales with the
    // maze size so the whole layout stays framed.
    const mazeW = this.pacmanGrid[0].length * this.PACMAN_CELL;
    const camY = mazeW * 1.35;
    const camZ = mazeW * 0.55;
    this.camera.position.set(0, camY, camZ);
    this.camera.lookAt(0, 0, 0);

    // Default to top-down view on each game entry
    this.pacmanViewMode = 'top';

    // Build HUD + minimap
    this.buildPacmanHUD();
    this.buildPacmanMinimap();
    this.updatePacmanHUD();
    if (this.pacmanOverlayEl) this.pacmanOverlayEl.classList.add('hidden');

    this.onPacmanPlayChange(true);

    // Intro melody → siren after the melody
    const introDur = this.sound.playPacmanIntro();
    setTimeout(() => {
      if (this.isPacmanPlaying) this.sound.playPacmanSiren(1);
    }, Math.round(introDur * 1000) + 200);
  }

  /** Exit Pac-Man game mode — tear down the maze + ghosts, restore
   *  the build-mode scene as it was. */
  stopPacman() {
    if (!this.isPacmanPlaying) return;
    this.isPacmanPlaying = false;
    this.sound.stopPacmanSiren();

    // Dispose maze group
    if (this.pacmanMazeGroup) {
      this.scene.remove(this.pacmanMazeGroup);
      this.pacmanMazeGroup.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
          else (m.material as THREE.Material).dispose();
        }
      });
      this.pacmanMazeGroup = null;
    }
    // Remove ghosts
    for (const g of this.pacmanGhosts) {
      this.scene.remove(g.obj);
    }
    this.pacmanGhosts = [];

    // Despawn avatar
    if (this.playerAvatar) {
      this.scene.remove(this.playerAvatar);
      this.playerAvatar = null;
    }

    // Restore build-mode scene visibility
    this.brickGroup.visible = this.pacmanSavedBrickVisible;
    for (const tile of this.baseplates.values()) tile.visible = true;

    // Restore build camera
    this.camera.position.copy(this.savedCam.position);
    this.controls.target.copy(this.savedCam.target);
    this.controls.enabled = true;
    this.controls.update();

    // Clear arrow-key state
    this.pacmanKeys.up = false;
    this.pacmanKeys.down = false;
    this.pacmanKeys.left = false;
    this.pacmanKeys.right = false;
    this.pacmanKeys.run = false;

    if (this.pacmanHUDEl) this.pacmanHUDEl.classList.add('hidden');
    if (this.pacmanOverlayEl) this.pacmanOverlayEl.classList.add('hidden');
    if (this.pacmanMinimapEl) this.pacmanMinimapEl.classList.add('hidden');

    this.onPacmanPlayChange(false);
  }

  // ---- Maze geometry ----
  // Each maze is 28 cols × 29 rows (each cell = 1 world unit). Symbols:
  //   # = wall     . = pellet     o = power pellet
  //   (space) = walkable empty (ghost house interior / tunnel)
  //   _ = walkable empty (tunnel marker)
  //   G = ghost spawn     P = player spawn
  //
  // The center band (rows 9–19) is IDENTICAL across all mazes because
  // the ghost-house exit AI hardcodes GATE_C=13, GATE_R=12. Varying
  // only the upper/lower halves gives each stage a visibly different
  // layout while keeping the AI simple.

  /** Shared middle band (rows 9–19) containing the ghost house and
   *  tunnels. Gate opening is the two spaces in `###  ###` at row 12. */
  private static readonly PACMAN_CENTER: string[] = [
    '######.##### ## #####.######', // row 9
    '     #.##### ## #####.#     ', // 10
    '     #.##          ##.#     ', // 11
    '     #.## ###  ### ##.#     ', // 12  (gate opening)
    '######.## #GGGGGG# ##.######', // 13
    '_________ #GGGGGG# _________', // 14  (tunnel row)
    '######.## ######## ##.######', // 15
    '     #.##          ##.#     ', // 16
    '     #.## ######## ##.#     ', // 17
    '     #.## ######## ##.#     ', // 18
    '######.## ######## ##.######', // 19
  ];

  /** Classic Pac-Man layout (original arcade dimensions). Corridors
   *  are 1 cell wide — with PACMAN_CELL scaled up in world units the
   *  visual corridor width matches the original. */
  private static readonly PACMAN_VARIANTS: Array<{
    upper: string[];
    lower: string[];
  }> = [
    {
      upper: [
        '############################',
        '#............##............#',
        '#.####.#####.##.#####.####.#',
        '#o####.#####.##.#####.####o#',
        '#.####.#####.##.#####.####.#',
        '#..........................#',
        '#.####.##.########.##.####.#',
        '#.####.##.########.##.####.#',
        '#......##....##....##......#',
      ],
      lower: [
        '#............##............#',
        '#.####.#####.##.#####.####.#',
        '#o..##................##..o#',
        '###.##.##.########.##.##.###',
        '###.##.##.########.##.##.###',
        '#......##....##....##......#',
        '#.##########.##.##########.#',
        '#..............P...........#',
        '############################',
      ],
    },
  ];

  private getPacmanMazeLayout(): string[] {
    const variant =
      Game.PACMAN_VARIANTS[
        (this.pacmanStage - 1) % Game.PACMAN_VARIANTS.length
      ];
    const rows = [
      ...variant.upper,
      ...Game.PACMAN_CENTER,
      ...variant.lower,
    ];
    // Dev-time sanity check — every row must be exactly 28 chars.
    if (import.meta.env?.DEV) {
      for (const r of rows) {
        if (r.length !== 28) {
          console.warn(`[pacman] maze row wrong length: ${r.length} — "${r}"`);
        }
      }
      if (rows.length !== 29) {
        console.warn(`[pacman] maze row count wrong: ${rows.length}`);
      }
    }
    return rows;
  }

  /** Build all maze meshes, pellets, and ghosts. Stores the grid for
   *  AI and collision lookups. Cells are PACMAN_CELL world units wide
   *  so the minifig has room to breathe in corridors. */
  private buildPacmanMaze() {
    const grid = this.getPacmanMazeLayout();
    this.pacmanGrid = grid;
    const rows = grid.length;
    const cols = grid[0].length;
    const S = this.PACMAN_CELL;

    // Center the maze on the origin. World X of cell col c = originX + c*S.
    this.pacmanGridOriginX = -((cols - 1) / 2) * S;
    this.pacmanGridOriginZ = -((rows - 1) / 2) * S;

    const mazeGroup = new THREE.Group();
    mazeGroup.name = 'pacmanMaze';
    this.pacmanMazeGroup = mazeGroup;
    this.scene.add(mazeGroup);

    // ---- Floor ----
    // Dark Lego-style baseplate. We render ONE big box body, then
    // instance stud cylinders across the top (one per grid cell —
    // matching a Lego baseplate's 1-stud-per-cell grid). Using
    // InstancedMesh keeps it cheap even on a 40+-cell-wide floor.
    const floorGeom = new THREE.BoxGeometry((cols + 2) * S, 0.4, (rows + 2) * S);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a12,
      roughness: 0.8,
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.position.set(0, -0.2, 0);
    floor.receiveShadow = true;
    mazeGroup.add(floor);

    // Floor studs — one per grid cell that ISN'T a wall. Walls get
    // their own studs on top; covering the wall cells with floor-level
    // studs too would be invisible anyway (walls overlap them).
    const floorStudGeom = new THREE.CylinderGeometry(S * 0.18, S * 0.18, 0.18, 12);
    const floorStudMat = new THREE.MeshStandardMaterial({
      color: 0x0f0f20,
      roughness: 0.7,
      metalness: 0.05,
    });
    const floorStudCount = cols * rows;
    const floorStuds = new THREE.InstancedMesh(
      floorStudGeom,
      floorStudMat,
      floorStudCount
    );
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = this.pacmanGridOriginX + c * S;
        const z = this.pacmanGridOriginZ + r * S;
        dummy.position.set(x, 0.09, z);
        dummy.updateMatrix();
        floorStuds.setMatrixAt(idx++, dummy.matrix);
      }
    }
    floorStuds.instanceMatrix.needsUpdate = true;
    mazeGroup.add(floorStuds);

    // ---- Walls / pellets / spawns ----
    // Each wall = one 1×1×1-stud Lego brick with a single stud on top.
    // Adjacent wall cells merge visually into continuous wall lines.
    // 2-stud-wide corridors come from the MAZE LAYOUT itself (every
    // corridor is two adjacent walkable cells in the grid).
    const WALL_BODY_H = 1.2;
    const WALL_STUD_H = 0.2;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e3aff,
      emissive: 0x0820b0,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.05,
    });
    const wallGeom = new THREE.BoxGeometry(S, WALL_BODY_H, S);
    const studGeom = new THREE.CylinderGeometry(S * 0.24, S * 0.24, WALL_STUD_H, 14);
    const pelletGeom = new THREE.SphereGeometry(0.14, 10, 8);
    const pelletMat = new THREE.MeshBasicMaterial({ color: 0xffe04a });
    const powerGeom = new THREE.SphereGeometry(0.3, 14, 10);
    const powerMat = new THREE.MeshBasicMaterial({ color: 0xfff08a });

    let pelletCount = 0;
    const ghostSpawns: THREE.Vector3[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = grid[r][c];
        const x = this.pacmanGridOriginX + c * S;
        const z = this.pacmanGridOriginZ + r * S;

        if (ch === '#') {
          const wall = new THREE.Mesh(wallGeom, wallMat);
          wall.position.set(x, WALL_BODY_H / 2, z);
          wall.castShadow = true;
          wall.receiveShadow = true;
          mazeGroup.add(wall);
          const stud = new THREE.Mesh(studGeom, wallMat);
          stud.position.set(x, WALL_BODY_H + WALL_STUD_H / 2, z);
          stud.castShadow = true;
          mazeGroup.add(stud);
        } else if (ch === '.') {
          const pellet = new THREE.Mesh(pelletGeom, pelletMat);
          pellet.position.set(x, 0.3, z);
          pellet.userData.isPacmanPellet = true;
          pellet.userData.pelletScore = 10;
          mazeGroup.add(pellet);
          pelletCount++;
        } else if (ch === 'o') {
          const power = new THREE.Mesh(powerGeom, powerMat);
          power.position.set(x, 0.45, z);
          power.userData.isPacmanPellet = true;
          power.userData.isPacmanPower = true;
          power.userData.pelletScore = 50;
          mazeGroup.add(power);
          pelletCount++;
        } else if (ch === 'G') {
          ghostSpawns.push(new THREE.Vector3(x, 0, z));
        } else if (ch === 'P') {
          this.pacmanPlayerSpawn.set(x, 0, z);
        }
      }
    }

    this.pacmanPelletCount = pelletCount;
    this.pacmanPelletsRemaining = pelletCount;

    // ---- Ghosts ----
    // Pick 4 distinct spawn cells. Initial direction is UP so every
    // ghost tries to exit the house on its first cell-center step.
    const colors = [0xff0000, 0xffb6ff, 0x00ffff, 0xffa040];
    const personalities: Array<'chase' | 'ambush' | 'random' | 'scatter'> = [
      'chase',
      'ambush',
      'random',
      'scatter',
    ];
    for (let i = 0; i < 4; i++) {
      // Spawn on the TOP row of the ghost house (row 13 in the grid),
      // centered under the exit gate (cols 12-15). This puts every
      // ghost adjacent to the gate cells so they exit on the first
      // cell-step, matching the original arcade's "each ghost leaves
      // in turn" feel.
      const spawnIdx = Math.min(ghostSpawns.length - 1, 1 + i);
      const spawn = ghostSpawns[spawnIdx] ?? ghostSpawns[i] ?? new THREE.Vector3();
      const ghost = createPacmanGhost(colors[i]);
      ghost.position.copy(spawn);
      this.scene.add(ghost);
      this.pacmanGhosts.push({
        obj: ghost,
        color: colors[i],
        personality: personalities[i],
        spawn: spawn.clone(),
        // Start heading UP so the very first cell-center step tries
        // the exit gate (the spaces above the ghost house).
        dir: { x: 0, z: -1 },
        // Speed scales with cell size (classic cells/sec feel) AND
        // with stage — each stage bumps speed by 12%, capped at 2×.
        speed: (3.6 + i * 0.1) *
          S *
          Math.min(2, 1 + (this.pacmanStage - 1) * 0.12),
        target: { x: spawn.x, z: spawn.z },
        state: 'scatter',
        stateTimer: 3 + i * 0.5,
        lastCell: null,
      });
    }
  }

  /** HUD DOM (lazy-build) */
  private buildPacmanHUD() {
    let hud = document.getElementById('pacman-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'pacman-hud';
      hud.className = 'pacman-hud';
      hud.innerHTML = `
        <div class="pacman-hud-row"><span class="pacman-hud-label">STAGE</span><span id="pacman-hud-stage">1</span></div>
        <div class="pacman-hud-row"><span class="pacman-hud-label">SCORE</span><span id="pacman-hud-score">0</span></div>
        <div class="pacman-hud-row"><span class="pacman-hud-label">PELLETS</span><span id="pacman-hud-pellets">0</span></div>
        <div class="pacman-hud-row"><span class="pacman-hud-label">LIVES</span><span id="pacman-hud-lives">♥♥♥</span></div>
      `;
      document.body.appendChild(hud);
    }
    this.pacmanHUDEl = hud;
    this.pacmanHUDStageEl = document.getElementById('pacman-hud-stage');
    this.pacmanHUDScoreEl = document.getElementById('pacman-hud-score');
    this.pacmanHUDPelletsEl = document.getElementById('pacman-hud-pellets');
    this.pacmanHUDLivesEl = document.getElementById('pacman-hud-lives');
    hud.classList.remove('hidden');

    let overlay = document.getElementById('pacman-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pacman-overlay';
      overlay.className = 'pacman-overlay hidden';
      overlay.innerHTML = `
        <div class="pacman-overlay-inner">
          <div class="pacman-overlay-title">CLEAR!</div>
          <div class="pacman-overlay-score"></div>
          <button class="pacman-overlay-close">확인</button>
        </div>
      `;
      document.body.appendChild(overlay);
      const closeBtn = overlay.querySelector('.pacman-overlay-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.stopPacman());
      }
    }
    this.pacmanOverlayEl = overlay;
  }

  private updatePacmanHUD() {
    if (this.pacmanHUDStageEl) {
      this.pacmanHUDStageEl.textContent = String(this.pacmanStage);
    }
    if (this.pacmanHUDScoreEl) {
      this.pacmanHUDScoreEl.textContent = String(this.pacmanScore);
    }
    if (this.pacmanHUDPelletsEl) {
      this.pacmanHUDPelletsEl.textContent =
        `${this.pacmanPelletCount - this.pacmanPelletsRemaining} / ${this.pacmanPelletCount}`;
    }
    if (this.pacmanHUDLivesEl) {
      this.pacmanHUDLivesEl.textContent = '♥'.repeat(Math.max(0, this.pacmanLives));
    }
  }

  // ---- Maze grid helpers ----

  /** Translate world (x,z) to grid (col,row). */
  private pacmanWorldToCell(x: number, z: number): { c: number; r: number } {
    return {
      c: Math.round((x - this.pacmanGridOriginX) / this.PACMAN_CELL),
      r: Math.round((z - this.pacmanGridOriginZ) / this.PACMAN_CELL),
    };
  }
  /** Translate grid (col,row) to world (x,z). */
  private pacmanCellToWorld(c: number, r: number): { x: number; z: number } {
    return {
      x: this.pacmanGridOriginX + c * this.PACMAN_CELL,
      z: this.pacmanGridOriginZ + r * this.PACMAN_CELL,
    };
  }
  /** True when (col,row) is walkable (not a '#' wall and in-bounds).
   *  The ghost-house 'G' cells are walkable for ghosts; the open '_'
   *  tunnel ends are walkable too. */
  private pacmanIsWalkable(c: number, r: number): boolean {
    if (r < 0 || r >= this.pacmanGrid.length) return false;
    const row = this.pacmanGrid[r];
    if (c < 0 || c >= row.length) return false;
    const ch = row[c];
    return ch !== '#';
  }

  /** Per-frame update. */
  private updatePacman(dt: number) {
    if (!this.isPacmanPlaying) return;

    // Countdown timers
    if (this.pacmanReadyTimer > 0) this.pacmanReadyTimer -= dt;
    if (this.pacmanDeathTimer > 0) {
      this.pacmanDeathTimer -= dt;
      if (this.pacmanDeathTimer <= 0) this.respawnPacmanPlayer();
    }
    if (this.pacmanFrightenedTime > 0) {
      this.pacmanFrightenedTime -= dt;
      if (this.pacmanFrightenedTime <= 0) {
        for (const g of this.pacmanGhosts) {
          if (g.state === 'frightened') g.state = 'chase';
        }
      }
    }

    // Don't process movement during the intro "ready" pause or death
    // animation — keeps ghosts + player frozen visibly.
    const frozen = this.pacmanReadyTimer > 0 || this.pacmanDeathTimer > 0;

    if (!frozen) {
      this.updatePacmanPlayer(dt);
      this.updatePacmanGhosts(dt);
      this.updatePacmanFruit(dt);
      this.checkPacmanPelletCollision();
      this.checkPacmanGhostCollision();
    } else if (this.pacmanDeathTimer > 0 && this.playerAvatar) {
      // Death spin animation
      this.playerAvatar.rotation.y += dt * 10;
    }

    // Camera — top-down OR first-person from the player's head
    if (this.pacmanViewMode === 'first') {
      const S = this.PACMAN_CELL;
      // Look direction is the player's facing (avatarYaw). +Z at yaw=0.
      const fx = Math.sin(this.avatarYaw);
      const fz = Math.cos(this.avatarYaw);
      // Eye height roughly where a minifig's head sits
      const eyeY = 1.8;
      this.camera.position.set(
        this.playerPos.x,
        this.playerPos.y + eyeY,
        this.playerPos.z
      );
      // Look one cell ahead so the view isn't staring at the wall
      // immediately in front of the face.
      this.camera.lookAt(
        this.playerPos.x + fx * S * 1.5,
        this.playerPos.y + eyeY * 0.9,
        this.playerPos.z + fz * S * 1.5
      );
    } else {
      const mazeW = this.pacmanGrid[0].length * this.PACMAN_CELL;
      const camY = mazeW * 1.35;
      const camZ = mazeW * 0.55;
      this.camera.position.lerp(
        new THREE.Vector3(0, camY, camZ),
        Math.min(1, dt * 2)
      );
      this.camera.lookAt(0, 0, 0);
    }

    // Minimap — only rendered in first-person mode
    if (this.pacmanViewMode === 'first') this.drawPacmanMinimap();
  }

  /** Cycle Pac-Man view mode: top-down ↔ first-person. Hides the avatar
   *  in first-person so we don't see the inside of our own minifig head.
   *  When entering first-person, snap the tank-control facing to the
   *  player's current walk direction (or keep the previous facing if
   *  they're standing still). */
  togglePacmanView() {
    if (!this.isPacmanPlaying) return;
    this.pacmanViewMode = this.pacmanViewMode === 'top' ? 'first' : 'top';
    if (this.playerAvatar) {
      this.playerAvatar.visible = this.pacmanViewMode === 'top';
    }
    if (this.pacmanMinimapEl) {
      this.pacmanMinimapEl.classList.toggle(
        'hidden',
        this.pacmanViewMode !== 'first'
      );
    }
    if (this.pacmanViewMode === 'first') {
      // Snap facing to the nearest cardinal from current avatarYaw so
      // the initial camera points "where the player was just going".
      const yaw = this.avatarYaw;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      if (Math.abs(fx) > Math.abs(fz)) {
        this.pacmanFacing = { x: fx > 0 ? 1 : -1, z: 0 };
      } else {
        this.pacmanFacing = { x: 0, z: fz > 0 ? 1 : -1 };
      }
      // Clear any held arrow keys so the held state doesn't leak across modes
      this.pacmanKeys.left = false;
      this.pacmanKeys.right = false;
    }
  }

  /** Rotate the first-person facing 90° (delta = -1 CCW / +1 CW). */
  private rotatePacmanFacing(delta: number) {
    const cur = this.pacmanFacing;
    // Rotating (x, z) by ±90° around the Y axis
    if (delta > 0) {
      // CW (right turn): (x, z) → (-z, x)
      this.pacmanFacing = { x: -cur.z, z: cur.x };
    } else {
      // CCW (left turn): (x, z) → (z, -x)
      this.pacmanFacing = { x: cur.z, z: -cur.x };
    }
  }

  /** Build the minimap canvas lazily on first game entry. */
  private buildPacmanMinimap() {
    let canvas = document.getElementById(
      'pacman-minimap'
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'pacman-minimap';
      canvas.className = 'pacman-minimap hidden';
      canvas.width = 240;
      canvas.height = 248;
      document.body.appendChild(canvas);
    }
    this.pacmanMinimapEl = canvas;
    this.pacmanMinimapCtx = canvas.getContext('2d');
    canvas.classList.toggle('hidden', this.pacmanViewMode !== 'first');
  }

  /** Redraw the minimap. Called each frame while first-person is on. */
  private drawPacmanMinimap() {
    const ctx = this.pacmanMinimapCtx;
    const canvas = this.pacmanMinimapEl;
    if (!ctx || !canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    const cols = this.pacmanGrid[0].length;
    const rows = this.pacmanGrid.length;
    const sx = W / cols;
    const sy = H / rows;

    // BG
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, W, H);

    // Walls
    ctx.fillStyle = '#2050ff';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.pacmanGrid[r][c] === '#') {
          ctx.fillRect(c * sx, r * sy, sx + 0.5, sy + 0.5);
        }
      }
    }

    // Remaining pellets — uses the live maze children, so collected
    // dots disappear from the minimap as the player eats them.
    if (this.pacmanMazeGroup) {
      for (const child of this.pacmanMazeGroup.children) {
        if (!child.userData.isPacmanPellet) continue;
        const cell = this.pacmanWorldToCell(child.position.x, child.position.z);
        const cx = cell.c * sx + sx / 2;
        const cy = cell.r * sy + sy / 2;
        if (child.userData.isPacmanPower) {
          ctx.fillStyle = '#fff080';
          ctx.beginPath();
          ctx.arc(cx, cy, sx * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#ffe04a';
          ctx.beginPath();
          ctx.arc(cx, cy, sx * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Ghosts
    for (const g of this.pacmanGhosts) {
      const cell = this.pacmanWorldToCell(g.obj.position.x, g.obj.position.z);
      const cx = cell.c * sx + sx / 2;
      const cy = cell.r * sy + sy / 2;
      const hex =
        g.state === 'frightened'
          ? '#0070ff'
          : '#' + g.color.toString(16).padStart(6, '0');
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, sx * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player — yellow disc with a black heading arrow
    const pCell = this.pacmanWorldToCell(this.playerPos.x, this.playerPos.z);
    const px = pCell.c * sx + sx / 2;
    const py = pCell.r * sy + sy / 2;
    ctx.fillStyle = '#ffcf00';
    ctx.beginPath();
    ctx.arc(px, py, sx * 0.55, 0, Math.PI * 2);
    ctx.fill();
    const fx = Math.sin(this.avatarYaw);
    const fz = Math.cos(this.avatarYaw);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + fx * sx * 0.9, py + fz * sy * 0.9);
    ctx.stroke();

    // Border
    ctx.strokeStyle = '#2050ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  /** Update player movement with wall collision via grid lookup. */
  private updatePacmanPlayer(dt: number) {
    const S = this.PACMAN_CELL;
    // Sprint boost — holding Shift lets the player run at 1.7× speed.
    // Works in both view modes so the tank-control first-person player
    // can sprint-chomp through straight corridors too.
    const sprinting = this.pacmanKeys.run ?? false;
    const SPEED = (sprinting ? 6.8 : 4.0) * S;

    let vx = 0;
    let vz = 0;

    if (this.pacmanViewMode === 'first') {
      // ---- First-person tank controls ----
      // ←/→ were consumed as 90° rotations in the key handler; they
      // don't map to motion here. ↑ = move in current facing direction,
      // ↓ = move backward.
      if (this.pacmanKeys.up) {
        vx = this.pacmanFacing.x;
        vz = this.pacmanFacing.z;
      } else if (this.pacmanKeys.down) {
        vx = -this.pacmanFacing.x;
        vz = -this.pacmanFacing.z;
      }
    } else {
      // ---- Top-down absolute arrow keys ----
      if (this.pacmanKeys.left) vx -= 1;
      if (this.pacmanKeys.right) vx += 1;
      if (this.pacmanKeys.up) vz -= 1;
      if (this.pacmanKeys.down) vz += 1;

      // Prefer single-axis motion for the classic Pac-Man feel.
      // Probe a full cell ahead on each axis so the test reliably
      // lands in the *next* cell rather than returning the current
      // cell (which would always report walkable).
      if (vx !== 0 && vz !== 0) {
        const tryX = this.pacmanCanMoveFrom(
          this.playerPos.x + vx * S,
          this.playerPos.z
        );
        const tryZ = this.pacmanCanMoveFrom(
          this.playerPos.x,
          this.playerPos.z + vz * S
        );
        if (!tryX && tryZ) vx = 0;
        else if (tryX && !tryZ) vz = 0;
        else vx = 0;
      }
    }

    if (vx !== 0) {
      const newX = this.playerPos.x + vx * SPEED * dt;
      if (this.pacmanCanMoveFrom(newX, this.playerPos.z)) {
        this.playerPos.x = newX;
      } else {
        const cell = this.pacmanWorldToCell(this.playerPos.x, this.playerPos.z);
        this.playerPos.x = this.pacmanGridOriginX + cell.c * S;
      }
      // Auto-center on the perpendicular axis while moving. If the
      // player is slightly off-center after turning a corner, this
      // gently pulls them toward the cell center so subsequent corners
      // line up cleanly. Rate is 60% of forward speed — strong enough
      // to correct drift quickly without feeling snappy.
      const cz = this.pacmanWorldToCell(this.playerPos.x, this.playerPos.z).r;
      const targetZ = this.pacmanGridOriginZ + cz * S;
      const dz = targetZ - this.playerPos.z;
      const maxStep = SPEED * dt * 0.6;
      this.playerPos.z +=
        Math.sign(dz) * Math.min(Math.abs(dz), maxStep);
    }
    if (vz !== 0) {
      const newZ = this.playerPos.z + vz * SPEED * dt;
      if (this.pacmanCanMoveFrom(this.playerPos.x, newZ)) {
        this.playerPos.z = newZ;
      } else {
        const cell = this.pacmanWorldToCell(this.playerPos.x, this.playerPos.z);
        this.playerPos.z = this.pacmanGridOriginZ + cell.r * S;
      }
      // Auto-center on the perpendicular axis (X side this time)
      const cc = this.pacmanWorldToCell(this.playerPos.x, this.playerPos.z).c;
      const targetX = this.pacmanGridOriginX + cc * S;
      const dx = targetX - this.playerPos.x;
      const maxStep = SPEED * dt * 0.6;
      this.playerPos.x +=
        Math.sign(dx) * Math.min(Math.abs(dx), maxStep);
    }

    // Horizontal tunnel wrap-around (`_____ ... ____` middle row).
    const cols = this.pacmanGrid[0].length;
    const leftEdge = this.pacmanGridOriginX - 0.5 * S;
    const rightEdge = this.pacmanGridOriginX + (cols - 1 + 0.5) * S;
    if (this.playerPos.x < leftEdge) this.playerPos.x = rightEdge;
    if (this.playerPos.x > rightEdge) this.playerPos.x = leftEdge;

    this.playerPos.y = 0;

    // Avatar yaw — different target per view mode.
    // Top-down: face the direction of motion (existing behavior).
    // First-person: face the tank-control facing direction (so the
    // camera which follows avatarYaw aligns with player's "look").
    const isWalking = vx !== 0 || vz !== 0;
    if (this.playerAvatar) {
      let targetYaw: number | null = null;
      if (this.pacmanViewMode === 'first') {
        targetYaw = Math.atan2(this.pacmanFacing.x, this.pacmanFacing.z);
      } else if (isWalking) {
        targetYaw = Math.atan2(vx, vz);
      }
      if (targetYaw !== null) {
        let delta = targetYaw - this.avatarYaw;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        this.avatarYaw += delta * Math.min(1, dt * 12);
      }
      this.playerAvatar.position.copy(this.playerPos);
      this.playerAvatar.rotation.y = this.avatarYaw;
      this.playerAvatar.rotation.x = 0;
      this.playerAvatar.rotation.z = 0;

      // Walk/run cycle — sprint increases the swing rate + amplitude
      if (isWalking) this.walkTime += dt * (sprinting ? 15 : 11);
      const swingAmp = sprinting ? 0.6 : 0.35;
      const swing = isWalking ? Math.sin(this.walkTime) * swingAmp : 0;
      const parts = this.playerAvatar.userData.parts as
        | {
            rightLeg?: THREE.Group | null;
            leftLeg?: THREE.Group | null;
            rightArm?: THREE.Group | null;
            leftArm?: THREE.Group | null;
          }
        | undefined;
      if (parts) {
        if (parts.rightLeg) parts.rightLeg.rotation.x = swing;
        if (parts.leftLeg) parts.leftLeg.rotation.x = -swing;
        if (parts.rightArm) parts.rightArm.rotation.x = -swing * 0.85;
        if (parts.leftArm) parts.leftArm.rotation.x = swing * 0.85;
      }
    }
  }

  /** Simple cell-based walkability test. With PACMAN_CELL = 1.0 and
   *  walls filling a full cell, the player's center cell determines
   *  walkability — corridors are 2-cell-wide in the layout so the
   *  player can slide freely inside them. */
  private pacmanCanMoveFrom(x: number, z: number): boolean {
    const cell = this.pacmanWorldToCell(x, z);
    return this.pacmanIsWalkable(cell.c, cell.r);
  }

  /** Ghost AI — each ghost picks a new direction once per cell
   *  crossing (detected by change in the grid cell it's standing on).
   *  In frightened mode they all flee from the player. */
  private updatePacmanGhosts(dt: number) {
    const S = this.PACMAN_CELL;
    for (const g of this.pacmanGhosts) {
      const cell = this.pacmanWorldToCell(g.obj.position.x, g.obj.position.z);

      // Decide direction ONCE per new cell. Without this gate, the
      // ghost re-picks direction every frame while near the cell
      // center and never actually moves (oscillation lock).
      if (!g.lastCell || g.lastCell.c !== cell.c || g.lastCell.r !== cell.r) {
        // Snap to the exact center of the cell we just entered so
        // motion stays grid-aligned across intersections.
        const cellCenterX = this.pacmanGridOriginX + cell.c * S;
        const cellCenterZ = this.pacmanGridOriginZ + cell.r * S;
        // Snap the perpendicular axis only (keep forward momentum)
        if (g.dir.x !== 0) g.obj.position.z = cellCenterZ;
        if (g.dir.z !== 0) g.obj.position.x = cellCenterX;
        g.dir = this.chooseGhostDirection(g, cell);
        g.lastCell = { c: cell.c, r: cell.r };
      }

      // Move forward
      const speed = g.state === 'frightened' ? g.speed * 0.55 : g.speed;
      g.obj.position.x += g.dir.x * speed * dt;
      g.obj.position.z += g.dir.z * speed * dt;

      // Tunnel wrap-around
      const cols = this.pacmanGrid[0].length;
      const leftEdge = this.pacmanGridOriginX - 0.5 * S;
      const rightEdge = this.pacmanGridOriginX + (cols - 1 + 0.5) * S;
      if (g.obj.position.x < leftEdge) g.obj.position.x = rightEdge;
      if (g.obj.position.x > rightEdge) g.obj.position.x = leftEdge;

      // Face direction of motion
      g.obj.rotation.y = Math.atan2(g.dir.x, g.dir.z);

      // Bob animation
      g.obj.position.y = Math.sin(performance.now() * 0.01 + g.color) * 0.04;

      // Tint when frightened
      const body = g.obj.userData.bodyMesh as THREE.Mesh | undefined;
      if (body && body.material instanceof THREE.MeshStandardMaterial) {
        const mat = body.material;
        if (g.state === 'frightened') {
          mat.color.setHex(0x0050ff);
          mat.emissive.setHex(0x0040cc);
        } else {
          mat.color.setHex(g.color);
          mat.emissive.setHex(g.color);
        }
      }
    }
  }

  /** True when (c,r) is inside the ghost house ('G' cells). Used by
   *  the AI to force ghosts to exit upward before starting to chase. */
  private pacmanIsInGhostHouse(c: number, r: number): boolean {
    if (r < 0 || r >= this.pacmanGrid.length) return false;
    const row = this.pacmanGrid[r];
    if (c < 0 || c >= row.length) return false;
    return row[c] === 'G';
  }

  /** Pick a valid direction at a cell intersection based on ghost
   *  personality. Ghosts can't immediately reverse (180°) unless there
   *  is no other option. */
  private chooseGhostDirection(
    g: Game['pacmanGhosts'][number],
    cell: { c: number; r: number }
  ): { x: number; z: number } {
    const dirs: Array<{ x: number; z: number }> = [
      { x: 0, z: -1 },
      { x: 0, z: 1 },
      { x: -1, z: 0 },
      { x: 1, z: 0 },
    ];

    // ---- Ghost-house exit override ----
    // When still inside the house (on a 'G' cell), treat the target
    // as the gate cell directly above the house (col 13/14, row 12 in
    // our layout — the two space cells that open upward). The ghost
    // aims for (13, 12) and will always pick the direction that gets
    // it closer to the gate, without the usual reverse-ban. Once
    // above the top row of the house it's free to chase normally.
    if (this.pacmanIsInGhostHouse(cell.c, cell.r)) {
      // Gate opening is the two spaces in the `###  ###` pattern of
      // row 12. Ghosts aim for (13, 12) — the gate cell — and bypass
      // the usual no-reverse rule until they leave the house.
      const GATE_C = 13;
      const GATE_R = 12;
      const options = dirs.filter((d) =>
        this.pacmanIsWalkable(cell.c + d.x, cell.r + d.z)
      );
      if (options.length === 0) return g.dir;
      let bestDist = Infinity;
      let bestDir = options[0];
      for (const d of options) {
        const nc = cell.c + d.x;
        const nr = cell.r + d.z;
        const dc = nc - GATE_C;
        const dr = nr - GATE_R;
        const dist = dc * dc + dr * dr;
        if (dist < bestDist) {
          bestDist = dist;
          bestDir = d;
        }
      }
      return bestDir;
    }

    const valid = dirs.filter((d) => {
      if (d.x === -g.dir.x && d.z === -g.dir.z) return false; // no reverse
      return this.pacmanIsWalkable(cell.c + d.x, cell.r + d.z);
    });
    const options = valid.length > 0 ? valid : dirs.filter((d) =>
      this.pacmanIsWalkable(cell.c + d.x, cell.r + d.z)
    );
    if (options.length === 0) return g.dir;

    // Frightened: random choice
    if (g.state === 'frightened') {
      return options[Math.floor(Math.random() * options.length)];
    }

    // Compute the target grid cell based on personality
    const playerCell = this.pacmanWorldToCell(this.playerPos.x, this.playerPos.z);
    let tc = playerCell.c;
    let tr = playerCell.r;
    if (g.personality === 'ambush') {
      const heading = this.getPlayerFacingGrid();
      tc += heading.x * 4;
      tr += heading.z * 4;
    } else if (g.personality === 'random') {
      return options[Math.floor(Math.random() * options.length)];
    } else if (g.personality === 'scatter') {
      const dx = this.playerPos.x - g.obj.position.x;
      const dz = this.playerPos.z - g.obj.position.z;
      const S = this.PACMAN_CELL;
      const distCells = (dx * dx + dz * dz) / (S * S);
      if (distCells < 64) {
        // Flee — mirror the player direction
        tc = cell.c - (playerCell.c - cell.c);
        tr = cell.r - (playerCell.r - cell.r);
      } else {
        // Scatter corner
        tc = 1;
        tr = this.pacmanGrid.length - 2;
      }
    }

    // Pick option closest to target
    let bestDist = Infinity;
    let bestDir = options[0];
    for (const d of options) {
      const nc = cell.c + d.x;
      const nr = cell.r + d.z;
      const dc = nc - tc;
      const dr = nr - tr;
      const dist = dc * dc + dr * dr;
      if (dist < bestDist) {
        bestDist = dist;
        bestDir = d;
      }
    }
    return bestDir;
  }

  /** Approximate player heading in grid terms (for the ambush ghost). */
  private getPlayerFacingGrid(): { x: number; z: number } {
    const s = Math.sin(this.avatarYaw);
    const c = Math.cos(this.avatarYaw);
    if (Math.abs(s) > Math.abs(c)) return { x: s > 0 ? 1 : -1, z: 0 };
    return { x: 0, z: c > 0 ? 1 : -1 };
  }

  /** Pellet pickup check — iterate maze children and test against
   *  player. Removes the mesh, adds score, plays sound. */
  /** Spawn / despawn the fruit bonus. It appears once per stage after
   *  the player has eaten half the pellets, stays visible for ~10s,
   *  and awards a stage-scaled bonus on pickup. */
  private updatePacmanFruit(dt: number) {
    // Spawn condition — half pellets eaten & not yet spawned this stage
    const eaten = this.pacmanPelletCount - this.pacmanPelletsRemaining;
    if (
      !this.pacmanFruitSpawned &&
      eaten >= this.pacmanPelletCount / 2 &&
      this.pacmanMazeGroup
    ) {
      this.spawnPacmanFruit();
    }

    if (!this.pacmanFruit || !this.pacmanMazeGroup) return;

    // Bob animation
    const t = performance.now() * 0.003;
    this.pacmanFruit.position.y = 0.6 + Math.sin(t) * 0.1;
    this.pacmanFruit.rotation.y += dt * 2;

    // Lifetime countdown
    this.pacmanFruitTimer -= dt;
    if (this.pacmanFruitTimer <= 0) {
      this.pacmanMazeGroup.remove(this.pacmanFruit);
      this.pacmanFruit = null;
      return;
    }

    // Collection check
    const dx = this.pacmanFruit.position.x - this.playerPos.x;
    const dz = this.pacmanFruit.position.z - this.playerPos.z;
    const r = 0.7 * this.PACMAN_CELL;
    if (dx * dx + dz * dz < r * r) {
      this.pacmanScore += this.pacmanFruitValue;
      this.sound.playPacmanJingle();
      this.pacmanMazeGroup.remove(this.pacmanFruit);
      this.pacmanFruit = null;
      this.updatePacmanHUD();
    }
  }

  /** Create the fruit bonus mesh and place it at the center of the
   *  maze (just below the ghost house). Value scales with stage. */
  private spawnPacmanFruit() {
    if (!this.pacmanMazeGroup) return;
    const S = this.PACMAN_CELL;
    // Center column, row right below the ghost house (row 16 empty cell)
    const x = this.pacmanGridOriginX + 13.5 * S;
    const z = this.pacmanGridOriginZ + 20 * S;

    // Simple "cherry" — red sphere with a green stem
    const fruit = new THREE.Group();
    const cherryMat = new THREE.MeshStandardMaterial({
      color: 0xff2020,
      emissive: 0x800000,
      emissiveIntensity: 0.5,
      roughness: 0.35,
    });
    const cherryGeom = new THREE.SphereGeometry(0.5 * (S / 2.2), 16, 12);
    const c1 = new THREE.Mesh(cherryGeom, cherryMat);
    c1.position.set(-0.25, 0, 0);
    fruit.add(c1);
    const c2 = new THREE.Mesh(cherryGeom, cherryMat);
    c2.position.set(0.25, 0, 0);
    fruit.add(c2);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x20c030 });
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8),
      stemMat
    );
    stem.position.set(0, 0.35, 0);
    fruit.add(stem);

    const mesh = fruit as unknown as THREE.Mesh;
    mesh.position.set(x, 0.6, z);
    this.pacmanMazeGroup.add(mesh);
    this.pacmanFruit = mesh;
    this.pacmanFruitTimer = 10;
    this.pacmanFruitSpawned = true;
    // Points: 100 × stage, capped at 1000
    this.pacmanFruitValue = Math.min(1000, 100 * this.pacmanStage);
  }

  private checkPacmanPelletCollision() {
    if (!this.pacmanMazeGroup) return;
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.pacmanMazeGroup.children) {
      if (!child.userData.isPacmanPellet) continue;
      const dx = child.position.x - this.playerPos.x;
      const dz = child.position.z - this.playerPos.z;
      // Pickup radius = half a cell — generous enough to grab any
      // pellet the player walks near without requiring pixel-perfect
      // alignment.
      const r = 0.55 * this.PACMAN_CELL;
      if (dx * dx + dz * dz < r * r) toRemove.push(child);
    }
    if (toRemove.length === 0) return;
    for (const obj of toRemove) {
      this.pacmanMazeGroup.remove(obj);
      const score = (obj.userData.pelletScore as number) ?? 10;
      this.pacmanScore += score;
      this.pacmanPelletsRemaining--;
      if (obj.userData.isPacmanPower) {
        this.sound.playPacmanPower();
        // Enter frightened mode — ghosts turn blue and flee
        // Frightened mode gets shorter each stage (7s → 3s floor).
        this.pacmanFrightenedTime = Math.max(3, 7 - (this.pacmanStage - 1) * 0.5);
        for (const g of this.pacmanGhosts) {
          if (g.state !== 'eaten') {
            g.state = 'frightened';
            // Force immediate direction re-pick by nudging to center
            g.dir = { x: -g.dir.x, z: -g.dir.z };
          }
        }
      } else {
        this.sound.playPacmanChomp();
      }
    }
    this.updatePacmanHUD();

    // Stage cleared → advance to next stage (maze is rebuilt with
    // faster ghosts). Player keeps their score and lives.
    if (this.pacmanPelletsRemaining <= 0 && this.pacmanPelletCount > 0) {
      this.advancePacmanStage();
    }
  }

  /** Advance to the next stage: briefly show a "STAGE CLEAR" banner,
   *  rebuild the maze + ghosts with new speed, and resume play. */
  private advancePacmanStage() {
    this.sound.stopPacmanSiren();
    this.sound.playPacmanVictory();

    // Flash a short "STAGE X CLEAR" overlay for 1.5s, then rebuild.
    if (this.pacmanOverlayEl) {
      this.pacmanOverlayEl.classList.remove('hidden');
      const titleEl = this.pacmanOverlayEl.querySelector('.pacman-overlay-title');
      if (titleEl) {
        titleEl.textContent = `STAGE ${this.pacmanStage} CLEAR!`;
      }
      const scoreEl = this.pacmanOverlayEl.querySelector('.pacman-overlay-score');
      if (scoreEl) {
        scoreEl.textContent = `SCORE: ${this.pacmanScore}  ·  NEXT STAGE →`;
      }
      // Hide the "close" button for the auto-advance flow (the overlay
      // reappears with the button on true GAME OVER).
      const closeBtn = this.pacmanOverlayEl.querySelector(
        '.pacman-overlay-close'
      ) as HTMLElement | null;
      if (closeBtn) closeBtn.style.display = 'none';
    }

    // After a brief pause, tear down maze and build next stage
    setTimeout(() => {
      if (!this.isPacmanPlaying) return;
      this.pacmanStage++;
      this.rebuildPacmanMaze();
      if (this.pacmanOverlayEl) {
        this.pacmanOverlayEl.classList.add('hidden');
        const closeBtn = this.pacmanOverlayEl.querySelector(
          '.pacman-overlay-close'
        ) as HTMLElement | null;
        if (closeBtn) closeBtn.style.display = '';
      }
    }, 1800);
  }

  /** Dispose the current maze + ghosts and build a fresh one for the
   *  current stage number. Player state (score, lives) is preserved. */
  private rebuildPacmanMaze() {
    // Dispose old maze
    if (this.pacmanMazeGroup) {
      this.scene.remove(this.pacmanMazeGroup);
      this.pacmanMazeGroup.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
          else (m.material as THREE.Material).dispose();
        }
      });
      this.pacmanMazeGroup = null;
    }
    for (const g of this.pacmanGhosts) this.scene.remove(g.obj);
    this.pacmanGhosts = [];
    this.pacmanFruit = null;
    this.pacmanFruitSpawned = false;
    this.pacmanFruitTimer = 0;

    this.buildPacmanMaze();

    // Re-seed player at the maze's spawn
    this.playerPos.copy(this.pacmanPlayerSpawn);
    this.avatarYaw = 0;
    if (this.playerAvatar) {
      this.playerAvatar.position.copy(this.playerPos);
      this.playerAvatar.rotation.set(0, 0, 0);
    }
    this.pacmanReadyTimer = 1.0;
    this.pacmanFrightenedTime = 0;
    this.updatePacmanHUD();
    // Resume siren
    if (this.isPacmanPlaying) this.sound.playPacmanSiren(this.pacmanStage);
  }

  /** Ghost touch → lose a life (or eat ghost if in frightened mode). */
  private checkPacmanGhostCollision() {
    if (this.pacmanDeathTimer > 0) return;
    for (const g of this.pacmanGhosts) {
      const dx = g.obj.position.x - this.playerPos.x;
      const dz = g.obj.position.z - this.playerPos.z;
      const r = 0.6 * this.PACMAN_CELL;
      if (dx * dx + dz * dz < r * r) {
        if (g.state === 'frightened') {
          // Eaten! Ghost rushes back to spawn.
          this.sound.playPacmanGhostEaten();
          this.pacmanScore += 200;
          g.obj.position.copy(g.spawn);
          g.dir = { x: 0, z: -1 };
          g.lastCell = null;
          g.state = 'chase';
          this.updatePacmanHUD();
        } else if (g.state !== 'eaten') {
          // Death
          this.sound.stopPacmanSiren();
          this.sound.playPacmanDeath();
          this.pacmanLives--;
          this.pacmanDeathTimer = 1.8;
          this.updatePacmanHUD();
          return;
        }
      }
    }
  }

  /** After the death animation: either respawn and continue, or show
   *  the GAME OVER overlay. */
  private respawnPacmanPlayer() {
    if (this.pacmanLives <= 0) {
      if (this.pacmanOverlayEl) {
        this.pacmanOverlayEl.classList.remove('hidden');
        const titleEl = this.pacmanOverlayEl.querySelector('.pacman-overlay-title');
        if (titleEl) titleEl.textContent = 'GAME OVER';
        const scoreEl = this.pacmanOverlayEl.querySelector('.pacman-overlay-score');
        if (scoreEl) scoreEl.textContent = `SCORE: ${this.pacmanScore}`;
      }
      return;
    }
    // Respawn player + ghosts
    this.playerPos.copy(this.pacmanPlayerSpawn);
    this.avatarYaw = 0;
    if (this.playerAvatar) {
      this.playerAvatar.position.copy(this.playerPos);
      this.playerAvatar.rotation.set(0, 0, 0);
    }
    for (const g of this.pacmanGhosts) {
      g.obj.position.copy(g.spawn);
      g.dir = { x: 0, z: -1 };
      g.state = 'scatter';
      g.stateTimer = 3;
      g.lastCell = null;
    }
    this.pacmanReadyTimer = 1.0;
    this.pacmanFrightenedTime = 0;
    if (this.isPacmanPlaying) this.sound.playPacmanSiren(1);
  }

  /**
   * Toggle: the player blows a whistle. If no dogs are currently
   * following, every dog NPC in range switches to the 'following' state
   * and starts chasing the player with periodic barks. A second whistle
   * sends them back to their wander pattern. Always plays the whistle
   * sound so the user gets audible feedback on the click regardless.
   */
  whistleDogs() {
    if (!this.isPlaying) return;
    this.sound.playWhistle();
    const dogs = this.npcs.filter((n) => n.isDog);
    if (dogs.length === 0) return;

    if (!this.dogsFollowing) {
      this.dogsFollowing = true;
      for (const dog of dogs) {
        dog.state = 'following';
        dog.walkTime = 0;
        // Stagger first barks so multiple dogs don't all fire on the
        // same frame as the whistle.
        dog.nextBarkIn = 0.15 + Math.random() * 0.35;
        // Initial sprint burst — the dog dashes toward the player at
        // close to top speed for the first ~2.2 seconds after the
        // whistle, then naturally drops to a steady follow trot. Long
        // enough that even a dog 30+ studs away visibly sprints in.
        dog.followSprintTime = 2.2;
      }
      // A single immediate bark for instant acknowledgement.
      this.sound.playBark();
    } else {
      this.dogsFollowing = false;
      for (const dog of dogs) {
        if (dog.state === 'following') {
          dog.state = 'idle';
          dog.stateTimer = 0.4 + Math.random() * 1.2;
        }
      }
    }
    this.onDogsFollowingChange(this.dogsFollowing);
  }

  private updatePlayMode(dt: number) {
    // Advance any active door animations and refresh the interactable
    // hotspot at the start of each frame — both rely on the current
    // player position, so ordering before movement is fine.
    this.updateDoorAnimations(dt);
    this.updateDoorHotspot();
    // NPC AI (wandering / limb animation) also runs before player
    // movement so the player's collision check sees up-to-date NPC
    // positions.
    this.updateNpcs(dt);
    this.updateNpcHotspot();

    // Playground ride: when active, the ride update positions the
    // player on the equipment surface and overrides normal physics +
    // collision. WASD/jump are ignored while riding. Camera still
    // follows the player position via the existing 1st/3rd-person logic
    // at the bottom of the function.
    if (this.playgroundRide) {
      this.updatePlaygroundRide(dt);
      // Camera positioning still happens (1st-person eye / 3rd-person orbit)
      const BODY_H_RIDE = getMinifigHeight() || 2.5;
      const EYE_HEIGHT_RIDE = BODY_H_RIDE * 0.92;
      if (this.viewMode === 'first') {
        this.camera.position.set(
          this.playerPos.x,
          this.playerPos.y + EYE_HEIGHT_RIDE,
          this.playerPos.z
        );
      } else {
        this.updateThirdPersonCamera();
      }
      // Avatar visible during ride
      if (this.playerAvatar) {
        this.playerAvatar.position.set(
          this.playerPos.x,
          this.playerPos.y,
          this.playerPos.z
        );
        this.playerAvatar.rotation.y = this.avatarYaw;
      }
      return;
    }

    // Vehicle ride: player is driving a car/train — WASD steers the
    // vehicle, camera follows behind, normal physics are bypassed.
    if (this.vehicleRide) {
      this.updateVehicleRide(dt);
      return;
    }

    // Refresh the playground hotspot once per frame (skipped during a ride)
    this.updatePlaygroundHotspot();
    this.updateVehicleHotspot();

    // Real Roblox-style run: significantly faster than walk. The walk
    // cycle amplitude + body lean changes below make it *feel* like a
    // full-on sprint, not just "faster walking".
    const RUN_MULT = 2.4;
    // Minifig footprint is 2×1 studs — the visible mesh (torso, arms,
    // shoulders) extends up to 1 unit from the player center. Using 0.45
    // lets arms/shoulders clip into walls and doorframes. 1.0 half-width
    // gives a 2×2 collision box that loosely bounds the minifig at any
    // Y-rotation, so the mesh never overlaps block geometry.
    const BODY_W = 1.0; // half-width (full 2.0, matches minifig width)
    // Both derived from the loaded GLB so they track its uniform scale.
    const BODY_H = getMinifigHeight() || 2.5;
    const EYE_HEIGHT = BODY_H * 0.92; // just below the top of the head/hat

    // --- Swimming detection ---
    const hasWater = this.environment.surroundType === 'water';
    const waterY = hasWater ? (this.environment.waterLevel ?? -0.05) : -Infinity;
    this.isSwimming = hasWater && this.playerPos.y <= waterY;

    const SWIM_SPEED = 3.5;
    const SPEED = this.isSwimming
      ? SWIM_SPEED
      : 6 * (this.moveKeys.run ? RUN_MULT : 1);

    // Horizontal input relative to camera facing
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) forward.normalize();
    // Right vector is forward × up (right-handed coords)
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    const move = new THREE.Vector3();
    if (this.moveKeys.forward) move.add(forward);
    if (this.moveKeys.back) move.sub(forward);
    if (this.moveKeys.right) move.add(right);
    if (this.moveKeys.left) move.sub(right);
    // Analog joystick input (mobile virtual stick). y>0 = forward,
    // x>0 = right, magnitude 0..1. We add before normalize so an
    // analog half-push gives proportionally slower movement while
    // keyboard input still behaves digitally.
    if (this.analogMove.x !== 0 || this.analogMove.y !== 0) {
      const analog = forward.clone().multiplyScalar(this.analogMove.y);
      analog.add(right.clone().multiplyScalar(this.analogMove.x));
      move.add(analog);
    }
    if (move.lengthSq() > 1) move.normalize();
    // One-shot mobile jump button — consume the flag
    if (this.mobileJumpPressed) {
      this.moveKeys.jump = true;
      this.mobileJumpPressed = false;
    }
    // Held sprint button
    if (this.mobileRunning) this.moveKeys.run = true;

    this.playerVel.x = move.x * SPEED;
    this.playerVel.z = move.z * SPEED;
    const isWalking = move.lengthSq() > 0.001;

    if (this.isSwimming) {
      // --- Swimming physics ---
      // Buoyancy pulls the player toward the swim surface (head above water).
      const swimSurfaceY = waterY - BODY_H * 0.4;
      const buoyancy = (swimSurfaceY - this.playerPos.y) * 8;
      this.playerVel.y += buoyancy * dt;
      // Dampen vertical oscillation
      this.playerVel.y *= Math.max(0, 1 - 3 * dt);

      // Space near a baseplate edge → climb up onto the plate
      if (this.moveKeys.jump && this.tryClimbBaseplate(BODY_W, BODY_H)) {
        // Successfully climbed — skip normal swim-up
      } else {
        // Space = swim upward, Shift = dive down
        if (this.moveKeys.jump) this.playerVel.y += 6 * dt;
        if (this.moveKeys.run) this.playerVel.y -= 6 * dt;
      }
      this.onGround = false;
    } else {
      // --- Normal land physics ---
      const GRAVITY = -22;
      const JUMP = this.moveKeys.run ? 10.5 : 9;
      this.playerVel.y += GRAVITY * dt;
      if (this.moveKeys.jump && this.onGround) {
        this.playerVel.y = JUMP;
        this.onGround = false;
      }
    }

    // --- Depenetration: if the player is already stuck inside a block,
    // push them out to the nearest free position so they don't get
    // permanently trapped. Tries Y (up) first, then all 4 XZ directions.
    if (this.collides(this.playerPos.x, this.playerPos.y, this.playerPos.z, BODY_W, BODY_H)) {
      let escaped = false;
      // Try pushing up in small increments (most common escape)
      for (let dy = 0.2; dy <= 6; dy += 0.2) {
        if (!this.collides(this.playerPos.x, this.playerPos.y + dy, this.playerPos.z, BODY_W, BODY_H)) {
          this.playerPos.y += dy;
          this.playerVel.y = 0;
          escaped = true;
          break;
        }
      }
      // If up didn't work, try horizontal push
      if (!escaped) {
        const dirs = [
          [1, 0], [-1, 0], [0, 1], [0, -1],
          [1, 1], [-1, 1], [1, -1], [-1, -1],
        ];
        for (let dist = 0.5; dist <= 5 && !escaped; dist += 0.5) {
          for (const [dx, dz] of dirs) {
            const nx = this.playerPos.x + dx * dist;
            const nz = this.playerPos.z + dz * dist;
            if (!this.collides(nx, this.playerPos.y, nz, BODY_W, BODY_H)) {
              this.playerPos.x = nx;
              this.playerPos.z = nz;
              escaped = true;
              break;
            }
          }
        }
      }
    }

    // Auto step-up: small bumps (tiles, plates, even a single brick) should
    // let the player walk right over them instead of getting stuck.
    const STEP_MAX = 1.2; // 1 brick — plates/tiles/1-brick walls auto-step

    // --- X axis ---
    const newX = this.playerPos.x + this.playerVel.x * dt;
    if (!this.collides(newX, this.playerPos.y, this.playerPos.z, BODY_W, BODY_H)) {
      this.playerPos.x = newX;
    } else {
      const stepY = this.tryStepUp(newX, this.playerPos.y, this.playerPos.z, BODY_W, BODY_H, STEP_MAX);
      if (stepY !== null) {
        this.playerPos.x = newX;
        this.playerPos.y = stepY;
      } else {
        this.playerVel.x = 0;
      }
    }

    // --- Z axis ---
    const newZ = this.playerPos.z + this.playerVel.z * dt;
    if (!this.collides(this.playerPos.x, this.playerPos.y, newZ, BODY_W, BODY_H)) {
      this.playerPos.z = newZ;
    } else {
      const stepY = this.tryStepUp(this.playerPos.x, this.playerPos.y, newZ, BODY_W, BODY_H, STEP_MAX);
      if (stepY !== null) {
        this.playerPos.z = newZ;
        this.playerPos.y = stepY;
      } else {
        this.playerVel.z = 0;
      }
    }

    // --- Y axis ---
    let newY = this.playerPos.y + this.playerVel.y * dt;
    if (!this.collides(this.playerPos.x, newY, this.playerPos.z, BODY_W, BODY_H)) {
      this.playerPos.y = newY;
      // Ground test: sample a hair below current position
      const below = this.playerPos.y - 0.02;
      this.onGround =
        this.collides(this.playerPos.x, below, this.playerPos.z, BODY_W, BODY_H);
    } else {
      if (this.playerVel.y < 0) {
        // Landed on a brick — step upward to the brick's top
        this.playerPos.y = this.findGroundY(
          this.playerPos.x,
          this.playerPos.y,
          this.playerPos.z,
          BODY_W
        );
        this.onGround = true;
      }
      this.playerVel.y = 0;
    }

    // No XZ clamp now that the map can be extended in any direction with
    // tiles — the player can walk off the edge and fall. The respawn safety
    // net catches them when they drop below the water / void.

    // Safety net: respawn when falling far below the world. In water
    // environments, allow deeper swimming before forcing a respawn.
    const respawnFloor = hasWater ? waterY - 10 : -5;
    if (this.playerPos.y < respawnFloor) {
      const spawnZ = Math.min(15, this.tileSize / 2 - 5);
      this.playerPos.set(0, 0, spawnZ);
      this.playerVel.set(0, 0, 0);
      this.onGround = false;
      this.isSwimming = false;
    }

    // ----- Avatar update -----
    if (this.playerAvatar) {
      // Position avatar at the player's feet
      this.playerAvatar.position.set(
        this.playerPos.x,
        this.playerPos.y,
        this.playerPos.z
      );

      // Decide facing direction
      if (this.viewMode === 'first') {
        // 1st person: face whichever way the camera is looking
        this.avatarYaw = Math.atan2(forward.x, forward.z);
      } else if (isWalking) {
        // 3rd person: face the movement direction (only when actively moving)
        const targetYaw = Math.atan2(move.x, move.z);
        // Smooth rotation toward the target
        let delta = targetYaw - this.avatarYaw;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        this.avatarYaw += delta * Math.min(1, dt * 12);
      }

      // Running state: holding Shift while actually moving on the ground
      const isRunning =
        this.moveKeys.run && isWalking && this.onGround;

      const parts = this.playerAvatar.userData.parts as
        | {
            rightLeg?: THREE.Group | null;
            leftLeg?: THREE.Group | null;
            rightArm?: THREE.Group | null;
            leftArm?: THREE.Group | null;
          }
        | undefined;

      this.playerAvatar.rotation.order = 'YXZ';

      if (this.isSwimming) {
        // ---- Swimming animation (freestyle / front crawl) ----
        // Arms rotate 360° like a windmill; legs flutter kick.
        const swimRate = isWalking ? 5 : 2.5;
        this.swimTime += dt * swimRate;

        if (parts) {
          // Arms: freestyle crawl stroke — large alternating swing.
          // Uses the existing shoulder pivot (no child position hacks).
          // Each arm sweeps forward (overhead) then pulls back, offset
          // by half a cycle so they alternate like a real crawl.
          const armAmp = 1.2; // ~69 degrees each way
          const rPhase = Math.sin(this.swimTime);
          const lPhase = Math.sin(this.swimTime + Math.PI);
          // Asymmetric shape: fast pull (negative), slow recovery (positive)
          const shapeStroke = (t: number) =>
            t > 0 ? t * armAmp : t * armAmp * 0.7;
          if (parts.rightArm)
            parts.rightArm.rotation.x = shapeStroke(rPhase);
          if (parts.leftArm)
            parts.leftArm.rotation.x = shapeStroke(lPhase);

          // Legs: flutter kick
          const legAmp = 0.45;
          const legKick = Math.sin(this.swimTime * 2.5) * legAmp;
          if (parts.rightLeg) parts.rightLeg.rotation.x = legKick;
          if (parts.leftLeg) parts.leftLeg.rotation.x = -legKick;
        }

        // Body tilts forward (~70°) so the character is nearly horizontal
        const swimLean = isWalking ? 1.2 : 0.6;
        const currentLean = this.playerAvatar.rotation.x;
        const leanDelta = swimLean - currentLean;
        this.playerAvatar.rotation.x =
          currentLean + leanDelta * Math.min(1, dt * 6);

        // Gentle vertical bob in the water
        const waterBob = Math.sin(this.swimTime * 0.8) * 0.08;
        this.playerAvatar.position.y += waterBob;
      } else {
        // ---- Walking / running animation ----
        this.swimTime = 0;
        if (isWalking && this.onGround) {
          this.walkTime += dt * (isRunning ? 15 : 9);
        }
        const swingAmp = isRunning ? 0.7 : 0.32;
        const swing =
          isWalking && this.onGround ? Math.sin(this.walkTime) * swingAmp : 0;
        if (parts) {
          if (parts.rightLeg) parts.rightLeg.rotation.x = swing;
          if (parts.leftLeg) parts.leftLeg.rotation.x = -swing;
          const armScale = isRunning ? 1.0 : 0.85;
          if (parts.rightArm) parts.rightArm.rotation.x = -swing * armScale;
          if (parts.leftArm) parts.leftArm.rotation.x = swing * armScale;
        }
        const bobAmp = isRunning ? 0.1 : 0;
        const bob =
          isWalking && this.onGround
            ? Math.abs(Math.sin(this.walkTime)) * bobAmp
            : 0;
        this.playerAvatar.position.y += bob;

        const targetLean = isRunning ? 0.28 : 0;
        const currentLean = this.playerAvatar.rotation.x;
        const leanDelta = targetLean - currentLean;
        this.playerAvatar.rotation.x =
          currentLean + leanDelta * Math.min(1, dt * 8);
      }

      this.playerAvatar.rotation.y = this.avatarYaw;
      this.playerAvatar.rotation.z = 0;
    }

    // ----- Camera positioning -----
    if (this.viewMode === 'first') {
      // Hide avatar's head from clipping into the camera
      this.camera.position.set(
        this.playerPos.x,
        this.playerPos.y + EYE_HEIGHT,
        this.playerPos.z
      );
    } else {
      this.updateThirdPersonCamera();
    }
  }

  /** 3rd-person orbit camera. PointerLockControls drives camera.quaternion
   *  via mouse movement; we keep the camera positioned BEHIND the player
   *  along that look direction so it always frames the avatar. Distance is
   *  adjustable via mouse wheel (see the wheel handler). */
  private updateThirdPersonCamera() {
    const focus = new THREE.Vector3(
      this.playerPos.x,
      this.playerPos.y + 2.0, // chest-height look target
      this.playerPos.z
    );

    // Camera direction is set by PointerLockControls (mouse-controlled).
    // Position the camera at focus - forward * distance so it looks at the
    // player, then rotate look direction to keep the avatar centered.
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    if (forward.lengthSq() < 1e-6) forward.set(0, -0.5, -0.866).normalize();

    const offset = forward.clone().multiplyScalar(-this.thirdPersonDistance);
    this.camera.position.copy(focus).add(offset);
    // Re-orient the camera so the focus point stays exactly centered.
    // (forward is preserved up to numerical precision.)
    this.camera.lookAt(focus);
  }

  /** True when the given door is currently passable — i.e. it's in any
   *  active animation state (opening, open, or closing). Closed doors
   *  aren't in doorAnimations at all. */
  private isDoorPassable(door: THREE.Object3D): boolean {
    return this.doorAnimations.has(door);
  }

  private collides(
    x: number,
    y: number,
    z: number,
    bw: number,
    bh: number
  ): boolean {
    // Shrink the player AABB by a small epsilon so that touching a block
    // (e.g. standing exactly on top of a tile at y=0.4) is NOT a collision.
    // This keeps auto step-up working when the height delta matches a plate.
    const EPS = 0.003;
    const box = new THREE.Box3(
      new THREE.Vector3(x - bw + EPS, y + EPS, z - bw + EPS),
      new THREE.Vector3(x + bw - EPS, y + bh - EPS, z + bw - EPS)
    );
    for (let i = 0; i < this.playAABBs.length; i++) {
      const door = this.playAABBDoorRefs[i];
      if (door && this.isDoorPassable(door)) continue;
      if (box.intersectsBox(this.playAABBs[i])) return true;
    }
    // Dynamic NPC collision — treat each NPC as a cylinder of radius
    // NPC_BODY_R. Player can't walk through them.
    const npcH = getMinifigHeight() || 2.5;
    for (const npc of this.npcs) {
      const npcY = npc.obj.position.y;
      // Vertical overlap test
      if (y + bh <= npcY + EPS) continue;
      if (y >= npcY + npcH - EPS) continue;
      // Circle-AABB: closest point on the player AABB to the NPC center
      const px = Math.max(x - bw, Math.min(npc.obj.position.x, x + bw));
      const pz = Math.max(z - bw, Math.min(npc.obj.position.z, z + bw));
      const dx = npc.obj.position.x - px;
      const dz = npc.obj.position.z - pz;
      const r = Game.NPC_BODY_R;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  private findGroundY(x: number, y: number, z: number, bw: number): number {
    let maxTop = -Infinity;
    for (let i = 0; i < this.playAABBs.length; i++) {
      const door = this.playAABBDoorRefs[i];
      if (door && this.isDoorPassable(door)) continue;
      const b = this.playAABBs[i];
      if (
        x + bw > b.min.x &&
        x - bw < b.max.x &&
        z + bw > b.min.z &&
        z - bw < b.max.z
      ) {
        if (b.max.y <= y + 0.5 && b.max.y > maxTop) {
          maxTop = b.max.y;
        }
      }
    }
    return maxTop;
  }

  /** If moving to (x, z) is blocked by short obstacles, return the Y the
   *  player should step up to. Returns null if the bump is too tall or the
   *  player wouldn't fit at the stepped-up position. */
  private tryStepUp(
    x: number,
    currentY: number,
    z: number,
    bw: number,
    bh: number,
    maxStep: number
  ): number | null {
    let highestTop = currentY;
    for (let i = 0; i < this.playAABBs.length; i++) {
      const door = this.playAABBDoorRefs[i];
      if (door && this.isDoorPassable(door)) continue;
      const b = this.playAABBs[i];
      // Must horizontally overlap the proposed footprint
      if (x + bw <= b.min.x || x - bw >= b.max.x) continue;
      if (z + bw <= b.min.z || z - bw >= b.max.z) continue;
      // Must vertically intersect the current body
      if (b.max.y <= currentY) continue;
      if (b.min.y >= currentY + bh) continue;
      if (b.max.y > highestTop) highestTop = b.max.y;
    }
    const step = highestTop - currentY;
    if (step <= 0 || step > maxStep) return null;
    // Ensure the player actually fits at the new height
    if (this.collides(x, highestTop, z, bw, bh)) return null;
    return highestTop;
  }

  /** When swimming near a baseplate edge, check if the player can climb
   *  up onto it. Returns true if the climb succeeded (position updated). */
  private tryClimbBaseplate(bodyW: number, bodyH: number): boolean {
    const px = this.playerPos.x;
    const pz = this.playerPos.z;
    const half = this.tileSize / 2;
    const reach = 2.5; // how close to the edge the player must be

    for (const [key] of this.baseplates) {
      const [txs, _tys, tzs] = key.split(',');
      const cx = Number(txs) * this.tileSize;
      const cz = Number(tzs) * this.tileSize;
      const minX = cx - half;
      const maxX = cx + half;
      const minZ = cz - half;
      const maxZ = cz + half;

      // Player must be just outside the tile boundary but within reach
      const insideX = px >= minX && px <= maxX;
      const insideZ = pz >= minZ && pz <= maxZ;
      const nearEdge =
        (insideZ && (px >= minX - reach && px < minX)) ||
        (insideZ && (px <= maxX + reach && px > maxX)) ||
        (insideX && (pz >= minZ - reach && pz < minZ)) ||
        (insideX && (pz <= maxZ + reach && pz > maxZ));

      if (!nearEdge) continue;

      // Target Y = top of the baseplate (y = 0)
      const targetY = 0;
      // Clamp X/Z to just inside the tile
      const clampX = Math.max(minX + bodyW, Math.min(maxX - bodyW, px));
      const clampZ = Math.max(minZ + bodyW, Math.min(maxZ - bodyW, pz));

      // Make sure the landing spot is free
      if (!this.collides(clampX, targetY, clampZ, bodyW, bodyH)) {
        this.playerPos.set(clampX, targetY, clampZ);
        this.playerVel.set(0, 0, 0);
        this.isSwimming = false;
        this.onGround = true;
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------
  //  Door interaction (play mode)
  // ------------------------------------------------------------------

  /** How far the player can be from a door and still see the "[E] 문 열기"
   *  prompt / trigger the interaction. XZ-plane distance to the door's
   *  center position. */
  private static readonly DOOR_INTERACT_RANGE = 3.0;
  /** Duration of the open/close swing animation in seconds. A linear
   *  0.35s was uncomfortably fast — the slab smacked the player in the
   *  face. 0.8s combined with the ease-in-out curve feels like a real
   *  push-to-open door. */
  private static readonly DOOR_ANIM_DURATION = 0.8;
  /** Full-open rotation angle (radians) applied to the hinge group. -π/2
   *  swings the slab to +Z, away from a player approaching from -Z. */
  private static readonly DOOR_OPEN_ANGLE = -Math.PI / 2;

  /** Cubic ease-in-out — slow start, accelerate through the middle, slow
   *  deceleration at the end. Matches the physical feel of a real door
   *  being pushed open and coming to rest. */
  private static easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /** Inverse of `easeInOutCubic`. Maps an eased progress value back to
   *  linear time so that mid-animation reversals (player hitting E twice
   *  quickly) resume from exactly the current visual position without a
   *  jump. */
  private static easeInOutCubicInverse(x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (x < 0.5) {
      // x = 4t³  →  t = (x/4)^(1/3)
      return Math.cbrt(x / 4);
    }
    // x = 1 - ((-2t + 2)^3) / 2
    // 2(1 - x) = (-2t + 2)^3
    // (2(1 - x))^(1/3) = -2t + 2
    // t = 1 - (2(1 - x))^(1/3) / 2
    return 1 - Math.cbrt(2 * (1 - x)) / 2;
  }

  private updateDoorAnimations(dt: number) {
    if (this.doorAnimations.size === 0) return;
    const duration = Game.DOOR_ANIM_DURATION;
    const openAngle = Game.DOOR_OPEN_ANGLE;
    const finished: THREE.Object3D[] = [];
    for (const [obj, anim] of this.doorAnimations) {
      const hinge = findDoorHinge(obj);
      if (!hinge) {
        finished.push(obj);
        continue;
      }
      if (anim.state === 'open') continue; // fully open, nothing to animate
      anim.t += dt;
      const uLinear = Math.min(1, anim.t / duration);
      const u = Game.easeInOutCubic(uLinear);
      if (anim.state === 'opening') {
        hinge.rotation.y = u * openAngle;
        if (uLinear >= 1) {
          hinge.rotation.y = openAngle;
          anim.state = 'open';
          anim.t = duration;
        }
      } else {
        // closing
        hinge.rotation.y = (1 - u) * openAngle;
        if (uLinear >= 1) {
          hinge.rotation.y = 0;
          finished.push(obj);
        }
      }
    }
    // Doors that finished closing leave the map → they're solid again.
    for (const obj of finished) this.doorAnimations.delete(obj);
  }

  private updateDoorHotspot() {
    const range = Game.DOOR_INTERACT_RANGE;
    let nearest: { obj: THREE.Object3D; dist: number } | null = null;
    for (const child of this.brickGroup.children) {
      const spec = child.userData.spec as { type?: BlockType } | undefined;
      if (spec?.type !== 'door') continue;
      const dx = child.position.x - this.playerPos.x;
      const dz = child.position.z - this.playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < range && (!nearest || dist < nearest.dist)) {
        nearest = { obj: child, dist };
      }
    }
    const next = nearest?.obj ?? null;
    // Only refresh the DOM when the hotspot identity or its state changes.
    const prevState = this.currentDoorHotspot
      ? this.doorAnimations.get(this.currentDoorHotspot)?.state ?? 'closed'
      : null;
    const nextState = next
      ? this.doorAnimations.get(next)?.state ?? 'closed'
      : null;
    if (this.currentDoorHotspot !== next || prevState !== nextState) {
      this.currentDoorHotspot = next;
      this.renderDoorPrompt();
    }
  }

  private renderDoorPrompt() {
    const el = this.getDoorPrompt();
    if (!el) return;
    if (!this.currentDoorHotspot) {
      el.classList.add('hidden');
      return;
    }
    const anim = this.doorAnimations.get(this.currentDoorHotspot);
    const isOpen = anim?.state === 'open';
    if (this.doorPromptLabelEl) {
      this.doorPromptLabelEl.textContent = isOpen ? '문 닫기' : '문 열기';
    }
    el.classList.remove('hidden');
  }

  private getDoorPrompt(): HTMLElement | null {
    if (!this.doorPromptEl) {
      this.doorPromptEl = document.getElementById('door-prompt');
      this.doorPromptLabelEl = document.getElementById('door-prompt-label');
    }
    return this.doorPromptEl;
  }

  /** Toggles the nearest hotspot door between open and closed. Called by
   *  the E key handler in play mode. Mid-animation reversals use the
   *  easing inverse so the hinge resumes from its current EASED angle
   *  without a visual jump. */
  private toggleCurrentDoor() {
    const obj = this.currentDoorHotspot;
    if (!obj) return;
    const existing = this.doorAnimations.get(obj);
    if (!existing) {
      this.doorAnimations.set(obj, { state: 'opening', t: 0 });
    } else if (existing.state === 'open') {
      this.doorAnimations.set(obj, { state: 'closing', t: 0 });
    } else if (existing.state === 'opening') {
      // Mid-open → reverse to closing. Current eased progress u = hinge/openAngle.
      // Closing maps linear t to angle via (1 - ease(t/dur)) * openAngle.
      // We want angle = u * openAngle at the new t=0, so (1 - ease(t/dur)) = u
      // ⇒ ease(t/dur) = 1 - u ⇒ t = inv(1 - u) * dur.
      const hinge = findDoorHinge(obj);
      if (hinge) {
        const uEased = hinge.rotation.y / Game.DOOR_OPEN_ANGLE;
        const tLinear = Game.easeInOutCubicInverse(1 - uEased);
        this.doorAnimations.set(obj, {
          state: 'closing',
          t: tLinear * Game.DOOR_ANIM_DURATION,
        });
      }
    } else {
      // Mid-close → reverse to opening. Opening maps linear t to angle
      // via ease(t/dur) * openAngle. Want ease(t/dur) = u where u is
      // the current eased progress ⇒ t = inv(u) * dur.
      const hinge = findDoorHinge(obj);
      if (hinge) {
        const uEased = hinge.rotation.y / Game.DOOR_OPEN_ANGLE;
        const tLinear = Game.easeInOutCubicInverse(uEased);
        this.doorAnimations.set(obj, {
          state: 'opening',
          t: tLinear * Game.DOOR_ANIM_DURATION,
        });
      }
    }
    this.renderDoorPrompt();
  }

  // ------------------------------------------------------------------
  //  NPC AI (play mode)
  // ------------------------------------------------------------------

  /** NPC movement speed in world units per second. About a third of the
   *  walking player — NPCs should feel like scenery, not competition. */
  private static readonly NPC_SPEED = 2.2;
  /** Maximum wander distance from the NPC's home (placement) position. */
  private static readonly NPC_WANDER_RADIUS = 7.5;
  /** Radius at which the NPC's capsule collides with walls / each other. */
  private static readonly NPC_BODY_R = 0.7;
  /** Range at which "[E] 대화하기" prompt appears near an NPC. */
  private static readonly NPC_INTERACT_RANGE = 2.8;

  private updateNpcs(dt: number) {
    if (this.npcs.length === 0) return;
    const npcHeight = getMinifigHeight() || 2.5;
    for (const npc of this.npcs) {
      // --- State machine ---
      // Dogs following the player after a whistle — tracks the player's
      // live position, barks periodically, stops just short so it doesn't
      // push the player around.
      if (npc.state === 'following') {
        const tx = this.playerPos.x - npc.obj.position.x;
        const tz = this.playerPos.z - npc.obj.position.z;
        const distSq = tx * tx + tz * tz;

        // Periodic bark while following
        npc.nextBarkIn = (npc.nextBarkIn ?? 0) - dt;
        if (npc.nextBarkIn <= 0) {
          this.sound.playBark();
          npc.nextBarkIn = 1.6 + Math.random() * 2.0;
        }

        // Tick down the post-whistle initial-sprint timer
        if ((npc.followSprintTime ?? 0) > 0) {
          npc.followSprintTime = (npc.followSprintTime ?? 0) - dt;
          if (npc.followSprintTime < 0) npc.followSprintTime = 0;
        }
        const initialSprint = (npc.followSprintTime ?? 0) > 0;
        // The dog also breaks into a run whenever the PLAYER is running
        // (Shift held). This way "내가 달려가면 강아지도 달려서 따라온다."
        // The post-whistle initial sprint just kicks the dog into the
        // same fast gait without needing the player to also be running.
        const playerRunning = this.moveKeys.run;
        const isSprinting = initialSprint || playerRunning;

        // Stand next to the player, not on top. Cancel the initial sprint
        // as soon as we're in personal-space range so the dog doesn't
        // overshoot or hover at full sprint speed right next to you.
        // (We do NOT clear the player-running sprint here — it's purely
        // a function of the player's input each frame.)
        const FOLLOW_STOP = 2.2;
        if (distSq < FOLLOW_STOP * FOLLOW_STOP) {
          this.faceNpcToward(npc, this.playerPos.x, this.playerPos.z, dt * 6);
          applyNpcLimbs(npc.obj, 0);
          npc.followSprintTime = 0;
          continue;
        }

        const inv = 1 / Math.sqrt(distSq);
        const dirX = tx * inv;
        const dirZ = tz * inv;
        // Speed selection:
        //   - player running:        7.5× NPC_SPEED ≈ 16.5 (player run is
        //                            14.4, so the dog catches up over time)
        //   - post-whistle sprint:   3.2× NPC_SPEED ≈ 7.0 (visible sprint
        //                            even when player is standing still)
        //   - normal follow trot:    1.8× NPC_SPEED ≈ 4.0
        const speedMult = playerRunning ? 7.5 : initialSprint ? 3.2 : 1.8;
        const speed = Game.NPC_SPEED * speedMult;
        const step = speed * dt;
        const nextX = npc.obj.position.x + dirX * step;
        const nextZ = npc.obj.position.z + dirZ * step;

        if (this.npcCanMoveTo(nextX, nextZ, npc, npcHeight)) {
          npc.obj.position.x = nextX;
          npc.obj.position.z = nextZ;
          this.faceNpcToward(
            npc,
            this.playerPos.x,
            this.playerPos.z,
            dt * (isSprinting ? 12 : 8)
          );
          // Faster, bigger limb swing while sprinting so it visibly
          // *reads* as a sprint, not just a slightly faster walk.
          npc.walkTime += dt * (isSprinting ? 16 : 9);
          const swing = Math.sin(npc.walkTime) * (isSprinting ? 0.55 : 0.35);
          applyNpcLimbs(npc.obj, swing);
        } else {
          // Blocked by terrain — idle the limbs and retry next frame
          applyNpcLimbs(npc.obj, 0);
        }
        continue;
      }

      if (npc.state === 'greeting') {
        npc.stateTimer -= dt;
        if (npc.stateTimer <= 0) {
          npc.state = 'idle';
          npc.stateTimer = 0.6 + Math.random() * 1.8;
          if (this.currentNpcHotspot === npc) {
            this.getNpcBubble()?.classList.add('hidden');
            this.renderNpcPrompt();
          }
        }
        // Face the player while greeting — warm "looking at you" feel.
        this.faceNpcToward(npc, this.playerPos.x, this.playerPos.z, dt * 6);
        applyNpcLimbs(npc.obj, 0);
        continue;
      }

      if (npc.state === 'idle') {
        npc.stateTimer -= dt;
        if (npc.stateTimer <= 0) {
          this.pickNpcTarget(npc);
          npc.state = 'walking';
        }
        applyNpcLimbs(npc.obj, 0);
        continue;
      }

      // --- Walking ---
      const tx = npc.target.x - npc.obj.position.x;
      const tz = npc.target.z - npc.obj.position.z;
      const distSq = tx * tx + tz * tz;
      const ARRIVE = 0.5;
      if (distSq < ARRIVE * ARRIVE) {
        npc.state = 'idle';
        npc.stateTimer = 1.2 + Math.random() * 2.2;
        applyNpcLimbs(npc.obj, 0);
        continue;
      }

      const inv = 1 / Math.sqrt(distSq);
      const dirX = tx * inv;
      const dirZ = tz * inv;
      const step = Game.NPC_SPEED * dt;
      const nextX = npc.obj.position.x + dirX * step;
      const nextZ = npc.obj.position.z + dirZ * step;

      if (this.npcCanMoveTo(nextX, nextZ, npc, npcHeight)) {
        npc.obj.position.x = nextX;
        npc.obj.position.z = nextZ;
        this.faceNpcToward(
          npc,
          npc.obj.position.x + dirX,
          npc.obj.position.z + dirZ,
          dt * 7
        );
        // Walking limb animation
        npc.walkTime += dt * 6.5;
        const swing = Math.sin(npc.walkTime) * 0.3;
        applyNpcLimbs(npc.obj, swing);
      } else {
        // Blocked — abort this target and retry shortly
        npc.state = 'idle';
        npc.stateTimer = 0.5 + Math.random() * 0.8;
        applyNpcLimbs(npc.obj, 0);
      }
    }
  }

  /** Picks a new wander target inside a disk around the NPC's home. If
   *  the target isn't reachable the NPC will abort mid-walk and retry. */
  private pickNpcTarget(npc: NpcState) {
    const angle = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * Game.NPC_WANDER_RADIUS;
    npc.target.set(
      npc.homePos.x + Math.cos(angle) * r,
      npc.homePos.y,
      npc.homePos.z + Math.sin(angle) * r
    );
  }

  /** Smoothly rotates an NPC to face a world-space XZ target. */
  private faceNpcToward(
    npc: NpcState,
    tx: number,
    tz: number,
    slerpFactor: number
  ) {
    const dx = tx - npc.obj.position.x;
    const dz = tz - npc.obj.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    const targetYaw = Math.atan2(dx, dz);
    let delta = targetYaw - npc.yaw;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    npc.yaw += delta * Math.min(1, slerpFactor);
    npc.obj.rotation.y = npc.yaw;
  }

  /** True when the NPC's circular body at (x, z) doesn't overlap any
   *  static block, the player, or another NPC. */
  private npcCanMoveTo(
    x: number,
    z: number,
    self: NpcState,
    npcHeight: number
  ): boolean {
    const r = Game.NPC_BODY_R;
    const y = self.obj.position.y;
    const yTop = y + npcHeight;

    // 1) Static blocks — circle-AABB test, skipping open doors.
    for (let i = 0; i < this.playAABBs.length; i++) {
      const door = this.playAABBDoorRefs[i];
      if (door && this.isDoorPassable(door)) continue;
      const b = this.playAABBs[i];
      if (b.max.y <= y + 0.05) continue; // below feet
      if (b.min.y >= yTop - 0.05) continue; // above head
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r * r) return false;
    }

    // 2) Player — treat as radius-1.0 (matches BODY_W).
    const dpx = x - this.playerPos.x;
    const dpz = z - this.playerPos.z;
    const playerR = 1.0;
    if (dpx * dpx + dpz * dpz < (r + playerR) * (r + playerR)) return false;

    // 3) Other NPCs.
    for (const other of this.npcs) {
      if (other === self) continue;
      const odx = x - other.obj.position.x;
      const odz = z - other.obj.position.z;
      if (odx * odx + odz * odz < (r + r) * (r + r)) return false;
    }

    return true;
  }

  private updateNpcHotspot() {
    if (this.npcs.length === 0) {
      if (this.currentNpcHotspot) {
        this.currentNpcHotspot = null;
        this.renderNpcPrompt();
      }
      return;
    }
    const range = Game.NPC_INTERACT_RANGE;
    let nearest: { npc: NpcState; dist: number } | null = null;
    for (const npc of this.npcs) {
      if (npc.isDog) continue; // dogs don't have a chat greeting
      const dx = npc.obj.position.x - this.playerPos.x;
      const dz = npc.obj.position.z - this.playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < range && (!nearest || dist < nearest.dist)) {
        nearest = { npc, dist };
      }
    }
    const next = nearest?.npc ?? null;
    if (this.currentNpcHotspot !== next) {
      this.currentNpcHotspot = next;
      this.renderNpcPrompt();
    }
  }

  private renderNpcPrompt() {
    const el = this.getNpcPrompt();
    if (!el) return;
    const npc = this.currentNpcHotspot;
    if (!npc) {
      el.classList.add('hidden');
      return;
    }
    // Hide the prompt while the NPC is mid-greeting — the chat bubble
    // takes over and showing both would be noisy.
    if (npc.state === 'greeting') {
      el.classList.add('hidden');
      return;
    }
    if (this.npcPromptLabelEl) {
      this.npcPromptLabelEl.textContent = '대화하기';
    }
    el.classList.remove('hidden');
  }

  /** Triggered by the E key when `currentNpcHotspot` is set and no door
   *  is closer. The NPC switches to 'greeting' (stops, turns to face the
   *  player) and the chat bubble shows for a few seconds. */
  private interactWithCurrentNpc() {
    const npc = this.currentNpcHotspot;
    if (!npc) return;
    const line =
      NPC_GREETINGS[Math.floor(Math.random() * NPC_GREETINGS.length)];
    npc.greeting = line;
    npc.state = 'greeting';
    npc.stateTimer = 3.2;
    applyNpcLimbs(npc.obj, 0);

    const bubble = this.getNpcBubble();
    if (bubble && this.npcBubbleTextEl) {
      this.npcBubbleTextEl.textContent = line;
      bubble.classList.remove('hidden');
    }
    this.renderNpcPrompt();
  }

  private getNpcPrompt(): HTMLElement | null {
    if (!this.npcPromptEl) {
      this.npcPromptEl = document.getElementById('npc-prompt');
      this.npcPromptLabelEl = document.getElementById('npc-prompt-label');
    }
    return this.npcPromptEl;
  }

  private getNpcBubble(): HTMLElement | null {
    if (!this.npcBubbleEl) {
      this.npcBubbleEl = document.getElementById('npc-bubble');
      this.npcBubbleTextEl = document.getElementById('npc-bubble-text');
    }
    return this.npcBubbleEl;
  }

  // ------------------------------------------------------------------
  //  Playground rides (play mode)
  // ------------------------------------------------------------------

  /** Range at which "[E] 타기" prompt appears for any playground module. */
  private static readonly PLAYGROUND_INTERACT_RANGE = 4.5;

  /** When the minifig is in sit pose, its legs rotate forward at the
   *  hip — so the BUTT (where the seat surface should be) is roughly
   *  this many units above the avatar's playerPos.y (which is the
   *  feet/standing position). To make the minifig look like it's
   *  actually sitting on a seat at world Y = seatY, we set
   *  playerPos.y = seatY - SIT_HIP_OFFSET. */
  private static readonly SIT_HIP_OFFSET = 1.6;

  /** When riding a swing, shift the rider this far back (-Z in swing
   *  local) from the chain attachment point so they sit at the BACK
   *  of the seat rather than perched on its front edge. Kept small —
   *  the chains pass right beside the rider's body at hand X, so a
   *  modest back-shift reads as "sitting properly" without breaking
   *  the visual contact between hand and chain. */
  private static readonly SWING_SEAT_BACK = 0.15;

  private isPlaygroundType(t: BlockType | undefined): t is PlaygroundType {
    return (
      t === 'slide' ||
      t === 'swing' ||
      t === 'seesaw' ||
      t === 'junglegym' ||
      t === 'merrygoround'
    );
  }

  private updatePlaygroundHotspot() {
    const range = Game.PLAYGROUND_INTERACT_RANGE;
    let nearest:
      | { obj: THREE.Object3D; type: PlaygroundType; dist: number }
      | null = null;
    for (const child of this.brickGroup.children) {
      const spec = child.userData.spec as { type?: BlockType } | undefined;
      if (!this.isPlaygroundType(spec?.type)) continue;
      const dx = child.position.x - this.playerPos.x;
      const dz = child.position.z - this.playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < range && (!nearest || dist < nearest.dist)) {
        nearest = { obj: child, type: spec!.type as PlaygroundType, dist };
      }
    }
    const next = nearest ? { obj: nearest.obj, type: nearest.type } : null;
    if (
      this.playgroundHotspot?.obj !== next?.obj ||
      this.playgroundHotspot?.type !== next?.type
    ) {
      this.playgroundHotspot = next;
      this.renderPlaygroundPrompt();
    }
  }

  private renderPlaygroundPrompt() {
    const el = this.getPlaygroundPrompt();
    if (!el) return;
    if (this.playgroundRide) {
      if (this.playgroundPromptLabelEl) {
        this.playgroundPromptLabelEl.textContent = '내리기';
      }
      el.classList.remove('hidden');
      return;
    }
    if (!this.playgroundHotspot) {
      el.classList.add('hidden');
      return;
    }
    if (this.playgroundPromptLabelEl) {
      this.playgroundPromptLabelEl.textContent = '타기';
    }
    el.classList.remove('hidden');
  }

  private getPlaygroundPrompt(): HTMLElement | null {
    if (!this.playgroundPromptEl) {
      this.playgroundPromptEl = document.getElementById('playground-prompt');
      this.playgroundPromptLabelEl = document.getElementById(
        'playground-prompt-label'
      );
    }
    return this.playgroundPromptEl;
  }

  /** Sit pose: rotates the leg pivots forward so the minifig looks
   *  like it's sitting. Pass `false` to reset to a standing pose. */
  private applySitPose(sit = true) {
    if (!this.playerAvatar) return;
    const parts = this.playerAvatar.userData.parts as
      | {
          rightLeg?: THREE.Group | null;
          leftLeg?: THREE.Group | null;
          rightArm?: THREE.Group | null;
          leftArm?: THREE.Group | null;
        }
      | undefined;
    if (!parts) return;
    if (sit) {
      // Both legs forward (-π/2 around X tilts the leg's local -Y to +Z)
      if (parts.rightLeg) parts.rightLeg.rotation.x = -Math.PI / 2;
      if (parts.leftLeg) parts.leftLeg.rotation.x = -Math.PI / 2;
      if (parts.rightArm) parts.rightArm.rotation.x = -0.5;
      if (parts.leftArm) parts.leftArm.rotation.x = -0.5;
    } else {
      if (parts.rightLeg) parts.rightLeg.rotation.x = 0;
      if (parts.leftLeg) parts.leftLeg.rotation.x = 0;
      if (parts.rightArm) parts.rightArm.rotation.x = 0;
      if (parts.leftArm) parts.leftArm.rotation.x = 0;
    }
  }

  /** Convert (localX, localY, localZ) in a block's local frame to world
   *  coordinates, accounting for the block's position and Y rotation. */
  private localToWorld(
    obj: THREE.Object3D,
    localX: number,
    localY: number,
    localZ: number
  ): { x: number; y: number; z: number } {
    const cosY = Math.cos(obj.rotation.y);
    const sinY = Math.sin(obj.rotation.y);
    return {
      x: obj.position.x + localX * cosY + localZ * sinY,
      y: obj.position.y + localY,
      z: obj.position.z - localX * sinY + localZ * cosY,
    };
  }

  /** Begins a playground ride for the current hotspot. The minifig is
   *  teleported to the equipment's "use position" and the per-type
   *  update loop takes over. */
  private startPlaygroundRide() {
    const hotspot = this.playgroundHotspot;
    if (!hotspot) return;
    const obj = hotspot.obj;
    const ride: PlaygroundRideState = { obj, type: hotspot.type, t: 0 };

    switch (hotspot.type) {
      case 'slide': {
        const params = obj.userData.slideParams as
          | {
              z0: number;
              z2: number;
              z3: number;
              height: number;
              slideExitY: number;
              numSteps: number;
            }
          | undefined;
        if (!params) return;
        // Start at the BACK of the stairs (z = z0) standing on the
        // first step. updateSlideRide will walk the avatar up the
        // staircase, then switch to the sliding phase at the platform
        // top.
        ride.slidePhase = 'climbing';
        ride.slideZ = params.z0;
        const stepRise = params.height / params.numSteps;
        const wp = this.localToWorld(obj, 0, stepRise, params.z0);
        this.playerPos.set(wp.x, wp.y, wp.z);
        this.avatarYaw = obj.rotation.y;
        break;
      }
      case 'swing': {
        const w = (obj.userData.spec as { w: number }).w;
        const swingParams = obj.userData.swingParams as
          | { apexY: number; chainLen: number; numSwings: number }
          | undefined;
        if (!swingParams) return;
        const panelT = 0.28;
        const beamLen = w * GRID.X - panelT - 0.04;
        const numSwings = swingParams.numSwings;
        const swingSpacing = beamLen / (numSwings + 1);
        const seatXs: number[] = [];
        for (let i = 1; i <= numSwings; i++) {
          seatXs.push(-beamLen / 2 + i * swingSpacing);
        }
        const dx = this.playerPos.x - obj.position.x;
        const dz = this.playerPos.z - obj.position.z;
        const cosY = Math.cos(-obj.rotation.y);
        const sinY = Math.sin(-obj.rotation.y);
        const localX = dx * cosY + dz * sinY;
        let bestX = seatXs[0];
        let bestIdx = 0;
        let bestD = Math.abs(seatXs[0] - localX);
        for (let i = 0; i < seatXs.length; i++) {
          const d = Math.abs(seatXs[i] - localX);
          if (d < bestD) {
            bestD = d;
            bestX = seatXs[i];
            bestIdx = i;
          }
        }
        ride.swingSeatX = bestX;
        ride.swingSeatIdx = bestIdx;
        const apexY = swingParams.apexY;
        const chainLen = swingParams.chainLen;
        // Initial pose at angle = 0: avatar hangs straight down from
        // the pivot at extended length (chainLen + SIT_HIP_OFFSET),
        // shifted back on the seat by SWING_SEAT_BACK.
        // updateSwingRide will animate the same pendulum each frame
        // and also raise the arms to grip the chains.
        const fullLen = chainLen + Game.SIT_HIP_OFFSET;
        const wp = this.localToWorld(
          obj,
          bestX,
          apexY - fullLen,
          -Game.SWING_SEAT_BACK
        );
        this.playerPos.set(wp.x, wp.y, wp.z);
        this.avatarYaw = obj.rotation.y;
        // Body upright at start; updateSwingRide tilts each frame.
        if (this.playerAvatar) this.playerAvatar.rotation.x = 0;
        break;
      }
      case 'seesaw': {
        const w = (obj.userData.spec as { w: number }).w;
        const dx = this.playerPos.x - obj.position.x;
        const dz = this.playerPos.z - obj.position.z;
        const cosY = Math.cos(-obj.rotation.y);
        const sinY = Math.sin(-obj.rotation.y);
        const localX = dx * cosY + dz * sinY;
        const side = localX >= 0 ? 1 : -1;
        ride.seesawSide = side;
        // Match the seesaw factory dimensions exactly:
        //   plankLen     = w*GRID.X - 0.5
        //   seatPadW     = 1.4 (X axis along plank)
        //   plankT       = 0.32, seatPadH = 0.2
        // Seat surface in world Y = pivotY + plankT + seatPadH.
        const plankLen = w * GRID.X - 0.5;
        const seatPadW = 1.4;
        const endX = side * (plankLen / 2 - seatPadW / 2 - 0.1);
        const postH = 2.0;
        const axleR = 0.14;
        const pivotY = postH + axleR;
        const seatSurfaceY = pivotY + 0.32 + 0.2;
        const wp = this.localToWorld(
          obj,
          endX,
          seatSurfaceY - Game.SIT_HIP_OFFSET,
          0
        );
        this.playerPos.set(wp.x, wp.y, wp.z);
        // Face the PIVOT (the center of the plank), so the two riders
        // look at each other across the seesaw. At local +X end face
        // -X (yaw -π/2 on top of obj.rotation.y); at local -X end face
        // +X (yaw +π/2). Three.js avatar yaw 0 = facing +Z, so:
        //   facing +X → yaw = +π/2,  facing -X → yaw = -π/2.
        this.avatarYaw = obj.rotation.y - side * (Math.PI / 2);
        break;
      }
      case 'junglegym': {
        const h = 24 * PLATE_HEIGHT;
        const wp = this.localToWorld(obj, 0, h + 0.1, 0);
        this.playerPos.set(wp.x, wp.y, wp.z);
        this.avatarYaw = obj.rotation.y;
        break;
      }
      case 'merrygoround': {
        // Read seat layout that createMerryGoRoundBlock baked in.
        const data = obj.userData.merryGoRound as
          | {
              rotor: THREE.Object3D;
              seats: { x: number; y: number; z: number; angle: number }[];
              seatBottomY: number;
              spinSpeed: number;
            }
          | undefined;
        if (!data || data.seats.length === 0) break;

        // Find the seat closest to the player (in the rotor's CURRENT
        // orientation, since the rotor may have already spun some).
        const rotorY = data.rotor.rotation.y;
        const cosR = Math.cos(rotorY);
        const sinR = Math.sin(rotorY);
        let bestIdx = 0;
        let bestDistSq = Infinity;
        for (let i = 0; i < data.seats.length; i++) {
          const s = data.seats[i];
          // Apply the rotor's current Y rotation to the seat's local
          // position so we compare against the rider in world space.
          const rx = s.x * cosR - s.z * sinR;
          const rz = s.x * sinR + s.z * cosR;
          const wp = this.localToWorld(obj, rx, s.y, rz);
          const dx = wp.x - this.playerPos.x;
          const dz = wp.z - this.playerPos.z;
          const dsq = dx * dx + dz * dz;
          if (dsq < bestDistSq) {
            bestDistSq = dsq;
            bestIdx = i;
          }
        }
        ride.merrySeatIdx = bestIdx;
        // Snap player to that seat using the helper that runs every frame
        // — this also applies the avatar yaw so the rider faces outward.
        this.snapPlayerToMerrySeat(obj, data, bestIdx);
        break;
      }
    }

    this.playgroundRide = ride;
    // Junglegym: stand pose (player just stands on the platform).
    // Slide: stand pose for the climbing phase — updateSlideRide will
    //        switch to sit pose at the platform top before the descent.
    // Other rides: sit pose.
    if (hotspot.type === 'junglegym' || hotspot.type === 'slide') {
      this.applySitPose(false);
    } else {
      this.applySitPose(true);
    }
    this.renderPlaygroundPrompt();
  }

  private dismountPlayground() {
    if (!this.playgroundRide) return;
    // Reset any animated parts on the equipment back to their resting
    // pose so the next rider doesn't inherit a frozen mid-swing or
    // mid-rock state.
    const ride = this.playgroundRide;
    const parts = ride.obj.userData.parts as
      | { swingPivots?: THREE.Group[]; plankGroup?: THREE.Group }
      | undefined;
    if (ride.type === 'swing' && parts?.swingPivots) {
      for (const p of parts.swingPivots) p.rotation.x = 0;
    } else if (ride.type === 'seesaw' && parts?.plankGroup) {
      parts.plankGroup.rotation.z = -0.14; // resting tilt baked in factory
    }

    // Reset any avatar pose tweaks the ride loop applied (body tilt
    // for swing, arm overrides). applySitPose(false) below resets the
    // limbs back to standing.
    if (this.playerAvatar) this.playerAvatar.rotation.x = 0;

    // Drop player back to the ground at their current XZ
    this.playerPos.y = Math.max(
      0,
      this.findGroundY(this.playerPos.x, this.playerPos.y, this.playerPos.z, 1.0)
    );
    this.playgroundRide = null;
    this.applySitPose(false);
    this.renderPlaygroundPrompt();
  }

  private updatePlaygroundRide(dt: number) {
    const ride = this.playgroundRide;
    if (!ride) return;
    ride.t += dt;
    switch (ride.type) {
      case 'slide':
        this.updateSlideRide(dt);
        break;
      case 'swing':
        this.updateSwingRide(dt);
        break;
      case 'seesaw':
        this.updateSeesawRide(dt);
        break;
      case 'junglegym':
        // Static — player stays where they were placed.
        break;
      case 'merrygoround':
        this.updateMerryGoRoundRide(dt);
        break;
    }
  }

  private updateSlideRide(dt: number) {
    const ride = this.playgroundRide;
    if (!ride || ride.type !== 'slide') return;
    const obj = ride.obj;
    const params = obj.userData.slideParams as
      | {
          z0: number;
          z1: number;
          z2: number;
          z3: number;
          height: number;
          slideExitY: number;
          numSteps: number;
        }
      | undefined;
    if (!params) {
      this.dismountPlayground();
      return;
    }

    // ----- Phase 1: walking up the rear staircase -----
    if (ride.slidePhase === 'climbing') {
      const climbSpeed = 2.6; // u/s walking pace up the stairs
      ride.slideZ = (ride.slideZ ?? params.z0) + climbSpeed * dt;
      const localZ = ride.slideZ;
      const stepRise = params.height / params.numSteps;
      // Stair tops: each step occupies z ∈ [z0+i, z0+i+1] with top at
      // y = (i+1)*stepRise. Past the staircase (z >= z1) the avatar is
      // standing on the platform at y = h.
      let surfaceY: number;
      if (localZ >= params.z1) {
        surfaceY = params.height;
      } else {
        const i = Math.max(
          0,
          Math.min(params.numSteps - 1, Math.floor(localZ - params.z0))
        );
        surfaceY = (i + 1) * stepRise;
      }
      const wp = this.localToWorld(obj, 0, surfaceY, localZ);
      this.playerPos.set(wp.x, wp.y, wp.z);
      this.avatarYaw = obj.rotation.y;

      // Reached the platform front edge → flip to sliding pose + phase.
      if (localZ >= params.z2) {
        ride.slidePhase = 'sliding';
        ride.slideZ = params.z2;
        this.applySitPose(true);
      }
      return;
    }

    // ----- Phase 2: sliding down the curved deck -----
    const slideSpeed = 5.5;
    ride.slideZ = (ride.slideZ ?? params.z2) + slideSpeed * dt;
    const localZ = ride.slideZ;
    let surfaceY: number;
    if (localZ <= params.z2) {
      surfaceY = params.height;
    } else if (localZ >= params.z3) {
      surfaceY = params.slideExitY;
    } else {
      const t = (localZ - params.z2) / (params.z3 - params.z2);
      const eased = t * t * (3 - 2 * t);
      surfaceY =
        params.height + (params.slideExitY - params.height) * eased;
    }
    // Lower the avatar by SIT_HIP_OFFSET so the BUTT (not the feet)
    // sits on the slide surface.
    const wp = this.localToWorld(
      obj,
      0,
      surfaceY - Game.SIT_HIP_OFFSET,
      localZ
    );
    this.playerPos.set(wp.x, wp.y, wp.z);
    this.avatarYaw = obj.rotation.y;
    // Dismount threshold must push the player CLEAR of the slide's
    // full AABB. The slide's body AABB max z is at local z = d/2 = z3,
    // and the player's collision capsule has half-width 1.0, so the
    // dismount position needs local z ≥ z3 + 1.0 + EPS. Use 1.6 for
    // margin. Otherwise the dismounted player overlaps the AABB and
    // can't move an inch.
    if (localZ > params.z3 + 1.6) {
      // Snap the player one last time to a definitely-clear position
      // before the ride ends, so dismountPlayground doesn't drop them
      // back inside the slide's bbox via findGroundY.
      const cleared = this.localToWorld(
        obj,
        0,
        params.slideExitY,
        params.z3 + 1.6
      );
      this.playerPos.set(cleared.x, cleared.y, cleared.z);
      this.dismountPlayground();
    }
  }

  private updateSwingRide(dt: number) {
    void dt;
    const ride = this.playgroundRide;
    if (!ride || ride.type !== 'swing') return;
    const obj = ride.obj;
    const swingParams = obj.userData.swingParams as
      | { apexY: number; chainLen: number; numSwings: number }
      | undefined;
    if (!swingParams) return;
    const maxAngle = 0.7;
    const omega = 1.6;
    const angle = maxAngle * Math.sin(omega * ride.t);
    const apexY = swingParams.apexY;
    const chainLen = swingParams.chainLen;

    // ----- 1) Visual swing assembly -----
    // Rotate the matching pivot group around its X axis. The pivot is
    // at (sx, apexY, 0); rotating by -angle around X moves the chain
    // bottom (initially at local y=-chainLen) to (0, -chainLen·cos(angle),
    // +chainLen·sin(angle)), so the seat slides forward in +Z direction.
    const parts = obj.userData.parts as
      | { swingPivots?: THREE.Group[] }
      | undefined;
    const pivot = parts?.swingPivots?.[ride.swingSeatIdx ?? 0];
    if (pivot) pivot.rotation.x = -angle;

    // ----- 2) Rider position: pendulum + back-shift on the seat -----
    // The rider hangs from the same pivot as the chain. Their pivot
    // point is the BUTT (SIT_HIP_OFFSET above the avatar feet origin),
    // so the avatar feet trace a pendulum of radius (chainLen + hipY).
    // We then shift them BACK on the seat by SWING_SEAT_BACK in the
    // swing-local -Z direction so the hip sits at the back of the
    // seat — the chain attachment is now in FRONT of the rider, which
    // is why the arms have to reach forward+up to grip it.
    const hipY = Game.SIT_HIP_OFFSET;
    const fullLen = chainLen + hipY;
    const back = Game.SWING_SEAT_BACK;
    const localY = apexY - fullLen * Math.cos(angle);
    const localZ = fullLen * Math.sin(angle) - back;
    const wp = this.localToWorld(
      obj,
      ride.swingSeatX ?? 0,
      localY,
      localZ
    );
    this.playerPos.set(wp.x, wp.y, wp.z);
    this.avatarYaw = obj.rotation.y;

    // ----- 3) Body lean -----
    // Tilt the avatar around its LOCAL X axis (in the yawed frame,
    // thanks to YXZ rotation order set in startPlay) by -angle, so the
    // body rocks back-and-forth in lockstep with the chain — exactly
    // like a real pendulum rider.
    if (this.playerAvatar) this.playerAvatar.rotation.x = -angle;

    // ----- 4) Arms gripping the chains naturally -----
    // The chains pass right beside the rider's body at the rigged hand
    // X, so even with a tiny back-shift (SWING_SEAT_BACK = 0.15) the
    // hands are essentially next to the chains. Just put both arms in
    // a SLIGHT forward bend at the shoulder — the hands sit naturally
    // near the chain, which reads as "loosely gripping". Going past
    // ~30° here ends up rotating the rigged arm meshes far enough that
    // they visually detach from the torso (the pivot offset gets
    // flipped), so keep the angle small.
    //
    // The `back` shift drops out of the arm angle on purpose: a tiny
    // 0.15u forward reach is well within the visual tolerance of
    // "hand on chain" and avoids any extreme arm rotation.
    void back;
    const ARM_FORWARD = 0.25; // ~14° forward bend at shoulder
    const aparts = this.playerAvatar?.userData.parts as
      | { rightArm?: THREE.Group | null; leftArm?: THREE.Group | null }
      | undefined;
    if (aparts) {
      if (aparts.rightArm) aparts.rightArm.rotation.x = -ARM_FORWARD;
      if (aparts.leftArm) aparts.leftArm.rotation.x = -ARM_FORWARD;
    }
  }

  private updateSeesawRide(dt: number) {
    void dt;
    const ride = this.playgroundRide;
    if (!ride || ride.type !== 'seesaw') return;
    const obj = ride.obj;
    const w = (obj.userData.spec as { w: number }).w;
    const plankLen = w * GRID.X - 0.5;
    const seatPadW = 1.4;
    const side = ride.seesawSide ?? 1;
    const endX = side * (plankLen / 2 - seatPadW / 2 - 0.1);
    const maxTilt = 0.32;
    const omega = 1.4;
    // Sine wave around the resting tilt baked into the plank group
    // (-0.14 in createSeesawBlock). Drive the visual plank by writing
    // back to plankGroup.rotation.z so it actually rocks while ridden.
    const tilt = maxTilt * Math.sin(omega * ride.t);
    const parts = obj.userData.parts as
      | { plankGroup?: THREE.Group }
      | undefined;
    if (parts?.plankGroup) parts.plankGroup.rotation.z = tilt;

    const postH = 2.0;
    const axleR = 0.14;
    const pivotY = postH + axleR;
    // Seat-top offset from the pivot, in plank-local space:
    //   plank top      = pivotY + plankT  = pivotY + 0.32
    //   seat pad top   = plankT + seatPadH = 0.32 + 0.2 = 0.52
    // Subtract SIT_HIP_OFFSET so the BUTT lands on the pad surface.
    const offX = endX;
    const offY = 0.52 - Game.SIT_HIP_OFFSET;
    // Rotate (offX, offY) around the plank-group's local origin (= the
    // pivot at pivotY in world Y), since the plank tilts via plankGroup.rotation.z.
    const rotX = offX * Math.cos(tilt) - offY * Math.sin(tilt);
    const rotY = offX * Math.sin(tilt) + offY * Math.cos(tilt);
    const wp = this.localToWorld(obj, rotX, pivotY + rotY, 0);
    this.playerPos.set(wp.x, wp.y, wp.z);
    // Face the pivot — same calculation as in startPlaygroundRide.
    this.avatarYaw = obj.rotation.y - side * (Math.PI / 2);
  }

  private updateMerryGoRoundRide(dt: number) {
    const ride = this.playgroundRide;
    if (!ride || ride.type !== 'merrygoround') return;
    const obj = ride.obj;
    const data = obj.userData.merryGoRound as
      | {
          rotor: THREE.Object3D;
          seats: { x: number; y: number; z: number; angle: number }[];
          seatBottomY: number;
          spinSpeed: number;
        }
      | undefined;
    if (!data) return;

    // Spin the rotor (this is the only place merry-go-rounds rotate; the
    // free-standing version doesn't spin until a rider mounts it).
    data.rotor.rotation.y += data.spinSpeed * dt;

    // Snap the rider to their seat in the rotor's new orientation.
    this.snapPlayerToMerrySeat(obj, data, ride.merrySeatIdx ?? 0);
  }

  /** Computes the world position of seat `idx` for `obj`'s merry-go-round
   *  in its CURRENT rotor orientation, then writes it to playerPos +
   *  avatarYaw so the rider visually sits on the seat. */
  private snapPlayerToMerrySeat(
    obj: THREE.Object3D,
    data: {
      rotor: THREE.Object3D;
      seats: { x: number; y: number; z: number; angle: number }[];
    },
    idx: number
  ) {
    const seat = data.seats[idx];
    if (!seat) return;
    const rotorY = data.rotor.rotation.y;
    const cosR = Math.cos(rotorY);
    const sinR = Math.sin(rotorY);
    // Rotate the seat's local position around Y by the rotor's angle.
    const rx = seat.x * cosR - seat.z * sinR;
    const rz = seat.x * sinR + seat.z * cosR;
    const wp = this.localToWorld(obj, rx, seat.y - Game.SIT_HIP_OFFSET, rz);
    this.playerPos.set(wp.x, wp.y, wp.z);
    // Rider faces radially OUTWARD from the rotor center. The seat's
    // outward direction in rotor-local coords is at math angle
    // `seat.angle`; after the rotor spins by rotorY, the world math
    // angle is (seat.angle + rotorY). Avatar yaw is measured as
    // atan2(forwardX, forwardZ), so for outward = (cos α, 0, sin α):
    //   yaw = atan2(cos α, sin α) = π/2 − α
    // Plus obj.rotation.y for any block-level rotation.
    this.avatarYaw =
      obj.rotation.y + Math.PI / 2 - seat.angle - rotorY;

    // Arm grip pose: same gentle forward bend as the swing ride. The
    // chains are right beside the rider (matching hand X) and slightly
    // in front (because we shifted the rider back on the pad), so a
    // small forward bend reads as "loosely gripping the chains".
    const aparts = this.playerAvatar?.userData.parts as
      | { rightArm?: THREE.Group | null; leftArm?: THREE.Group | null }
      | undefined;
    if (aparts) {
      if (aparts.rightArm) aparts.rightArm.rotation.x = -0.25;
      if (aparts.leftArm) aparts.leftArm.rotation.x = -0.25;
    }
  }

  // ------------------------------------------------------------------
  //  Vehicle ride system
  // ------------------------------------------------------------------

  private static readonly VEHICLE_INTERACT_RANGE = 5;
  private static readonly CAR_MAX_SPEED = 14;
  private static readonly CAR_ACCEL = 12;
  private static readonly CAR_BRAKE = 18;
  private static readonly CAR_FRICTION = 6;
  private static readonly CAR_TURN_SPEED = 2.5;
  private static readonly TRAIN_MAX_SPEED = 10;
  private static readonly TRAIN_ACCEL = 6;

  /** Scan all bricks for the nearest vehicle within interaction range. */
  private updateVehicleHotspot() {
    if (this.vehicleRide) {
      this.vehicleHotspot = null;
      return;
    }
    let best: { obj: THREE.Object3D; type: 'car' | 'train' } | null = null;
    let bestDist = Game.VEHICLE_INTERACT_RANGE;
    for (const child of this.brickGroup.children) {
      if (!child.userData.isVehicle) continue;
      const dx = child.position.x - this.playerPos.x;
      const dz = child.position.z - this.playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          obj: child,
          type: child.userData.vehicleType as 'car' | 'train',
        };
      }
    }
    this.vehicleHotspot = best;
    // Show/hide the playground prompt (reuse the same [E] element)
    this.renderVehiclePrompt();
  }

  private renderVehiclePrompt() {
    const el = this.getPlaygroundPrompt();
    if (!el) return;
    if (this.vehicleRide) {
      if (this.playgroundPromptLabelEl) {
        this.playgroundPromptLabelEl.textContent = '내리기';
      }
      el.classList.remove('hidden');
      return;
    }
    if (this.vehicleHotspot && !this.playgroundHotspot) {
      if (this.playgroundPromptLabelEl) {
        this.playgroundPromptLabelEl.textContent =
          this.vehicleHotspot.type === 'car' ? '운전' : '탑승';
      }
      el.classList.remove('hidden');
      return;
    }
    // Don't hide if playground prompt is showing
    if (!this.playgroundHotspot && !this.playgroundRide) {
      el.classList.add('hidden');
    }
  }

  /** Board a vehicle. Hides the player avatar, locks the camera to the
   *  vehicle, and starts accepting WASD as driving input. */
  private startVehicleRide() {
    const hotspot = this.vehicleHotspot;
    if (!hotspot) return;
    const obj = hotspot.obj;
    const ride: VehicleRideState = {
      obj,
      type: hotspot.type,
      speed: 0,
      yaw: obj.rotation.y,
    };

    if (hotspot.type === 'train') {
      // Build the rail path from connected tiles
      const path = this.buildRailPath(obj);
      if (path) {
        ride.railPath = path.curve;
        ride.railT = path.startT;
      }
    }

    this.vehicleRide = ride;
    // Hide the player avatar while driving
    if (this.playerAvatar) this.playerAvatar.visible = false;
    this.renderVehiclePrompt();
  }

  private dismountVehicle() {
    if (!this.vehicleRide) return;
    const obj = this.vehicleRide.obj;
    // Place player next to the vehicle
    const exitX = obj.position.x + Math.sin(obj.rotation.y + Math.PI / 2) * 2.5;
    const exitZ = obj.position.z + Math.cos(obj.rotation.y + Math.PI / 2) * 2.5;
    this.playerPos.set(
      exitX,
      Math.max(0, this.findGroundY(exitX, obj.position.y + 2, exitZ, 1.0)),
      exitZ
    );
    this.avatarYaw = obj.rotation.y;
    this.vehicleRide = null;
    if (this.playerAvatar) this.playerAvatar.visible = this.viewMode === 'third';
    this.renderVehiclePrompt();
  }

  /** Main vehicle update — called every frame while the player is
   *  driving. Handles input → physics → position → camera. */
  private updateVehicleRide(dt: number) {
    const ride = this.vehicleRide;
    if (!ride) return;

    if (ride.type === 'car') {
      this.updateCarDrive(ride, dt);
    } else {
      this.updateTrainDrive(ride, dt);
    }

    // Move the brick-group object to the vehicle's new world position.
    // The vehicle obj is a child of brickGroup, so we set its LOCAL
    // position (which equals world position since brickGroup is at origin).
    ride.obj.rotation.y = ride.yaw;

    // Camera follows behind the vehicle in 3rd-person chase view.
    const camDist = ride.type === 'car' ? 10 : 14;
    const camH = ride.type === 'car' ? 5 : 6;
    const behindX = ride.obj.position.x - Math.sin(ride.yaw) * camDist;
    const behindZ = ride.obj.position.z - Math.cos(ride.yaw) * camDist;
    const targetY = ride.obj.position.y + 1.5;

    // Smooth camera follow
    this.camera.position.lerp(
      new THREE.Vector3(behindX, targetY + camH, behindZ),
      1 - Math.exp(-5 * dt)
    );
    this.camera.lookAt(
      ride.obj.position.x,
      targetY,
      ride.obj.position.z
    );

    // Keep playerPos synced so dismount places correctly
    this.playerPos.copy(ride.obj.position);
  }

  /** Car driving: free WASD steering on the ground plane. W/S =
   *  accelerate/brake, A/D = turn. Speed boost on road tiles. */
  private updateCarDrive(ride: VehicleRideState, dt: number) {
    // Acceleration / braking
    if (this.moveKeys.forward) {
      ride.speed = Math.min(
        Game.CAR_MAX_SPEED,
        ride.speed + Game.CAR_ACCEL * dt
      );
    } else if (this.moveKeys.back) {
      ride.speed = Math.max(
        -Game.CAR_MAX_SPEED * 0.4,
        ride.speed - Game.CAR_BRAKE * dt
      );
    } else {
      // Friction deceleration
      if (ride.speed > 0) {
        ride.speed = Math.max(0, ride.speed - Game.CAR_FRICTION * dt);
      } else if (ride.speed < 0) {
        ride.speed = Math.min(0, ride.speed + Game.CAR_FRICTION * dt);
      }
    }

    // Steering (only when moving)
    if (Math.abs(ride.speed) > 0.5) {
      const turnFactor = Math.min(1, Math.abs(ride.speed) / 5);
      if (this.moveKeys.left) {
        ride.yaw += Game.CAR_TURN_SPEED * turnFactor * dt;
      }
      if (this.moveKeys.right) {
        ride.yaw -= Game.CAR_TURN_SPEED * turnFactor * dt;
      }
    }

    // Road speed boost: check if the vehicle is on a road tile
    const isOnRoad = this.isOnRoadTile(ride.obj.position.x, ride.obj.position.z);
    const speedMult = isOnRoad ? 1.3 : 1.0;

    // Move forward along the vehicle's facing direction
    const moveSpeed = ride.speed * speedMult;
    ride.obj.position.x += Math.sin(ride.yaw) * moveSpeed * dt;
    ride.obj.position.z += Math.cos(ride.yaw) * moveSpeed * dt;

    // Keep on the ground
    ride.obj.position.y = Math.max(
      0,
      this.findGroundY(ride.obj.position.x, ride.obj.position.y + 2, ride.obj.position.z, 1.0)
    );
  }

  /** Check if a world XZ position is on any road tile. */
  private isOnRoadTile(x: number, z: number): boolean {
    for (const child of this.brickGroup.children) {
      const spec = child.userData.spec as { type?: string; w?: number; d?: number } | undefined;
      if (!spec?.type?.startsWith('road_')) continue;
      const hw = ((spec.w ?? 8) * GRID.X) / 2;
      const hd = ((spec.d ?? 8) * GRID.Z) / 2;
      if (
        x >= child.position.x - hw &&
        x <= child.position.x + hw &&
        z >= child.position.z - hd &&
        z <= child.position.z + hd
      ) {
        return true;
      }
    }
    return false;
  }

  /** Train driving: follows the assembled rail spline. W/S = forward/
   *  back along the spline, the train auto-rotates to match the rail
   *  tangent direction. */
  private updateTrainDrive(ride: VehicleRideState, dt: number) {
    if (!ride.railPath) {
      // No connected rails — treat like a car but slower
      this.updateCarDrive(ride, dt);
      return;
    }

    // Acceleration along the spline
    if (this.moveKeys.forward) {
      ride.speed = Math.min(
        Game.TRAIN_MAX_SPEED,
        ride.speed + Game.TRAIN_ACCEL * dt
      );
    } else if (this.moveKeys.back) {
      ride.speed = Math.max(
        -Game.TRAIN_MAX_SPEED * 0.5,
        ride.speed - Game.TRAIN_ACCEL * dt
      );
    } else {
      if (ride.speed > 0) ride.speed = Math.max(0, ride.speed - 3 * dt);
      else if (ride.speed < 0) ride.speed = Math.min(0, ride.speed + 3 * dt);
    }

    // Advance along the spline parameter
    const pathLen = ride.railPath.getLength();
    if (pathLen < 1) return;
    const t = ride.railT ?? 0;
    const newT = Math.max(0, Math.min(1, t + (ride.speed * dt) / pathLen));
    ride.railT = newT;

    // Sample position and tangent from the spline
    const pos = ride.railPath.getPointAt(newT);
    const tangent = ride.railPath.getTangentAt(newT);
    ride.obj.position.set(pos.x, pos.y, pos.z);
    ride.yaw = Math.atan2(tangent.x, tangent.z);
  }

  /** Scans all placed rail tiles, chains them together by matching
   *  edges, and returns a CatmullRomCurve3 path + the starting t
   *  parameter closest to the train's current position. Returns null
   *  if the train isn't on a rail tile or no connected path exists. */
  private buildRailPath(
    trainObj: THREE.Object3D
  ): { curve: THREE.CatmullRomCurve3; startT: number } | null {
    // Gather all rail tiles
    const railTiles: THREE.Object3D[] = [];
    for (const child of this.brickGroup.children) {
      const spec = child.userData.spec as { type?: string } | undefined;
      if (spec?.type?.startsWith('rail_')) {
        railTiles.push(child);
      }
    }
    if (railTiles.length === 0) return null;

    // For each rail tile, generate center-line waypoints (in world space).
    // Straight: 2 points along Z; Curve: arc points; Crossing: 2 points.
    const allPoints: THREE.Vector3[] = [];
    // Sort by distance from train to get a rough ordering
    railTiles.sort((a, b) => {
      const da = a.position.distanceToSquared(trainObj.position);
      const db = b.position.distanceToSquared(trainObj.position);
      return da - db;
    });

    for (const tile of railTiles) {
      const spec = tile.userData.spec as { type?: string; w?: number; d?: number };
      const half = ((spec.w ?? 8) * GRID.X) / 2;
      const ty = tile.position.y + PLATE_HEIGHT + 0.06;
      const cosR = Math.cos(tile.rotation.y);
      const sinR = Math.sin(tile.rotation.y);
      const toWorld = (lx: number, lz: number) =>
        new THREE.Vector3(
          tile.position.x + lx * cosR + lz * sinR,
          ty,
          tile.position.z - lx * sinR + lz * cosR
        );

      if (spec.type === 'rail_straight' || spec.type === 'rail_crossing') {
        // Straight segment along local Z
        allPoints.push(toWorld(0, -half));
        allPoints.push(toWorld(0, half));
      } else if (spec.type === 'rail_curve') {
        // Quarter arc: center at local (half, -half), R = half * 0.6
        const cR = half * 0.6;
        const cx = half;
        const cz = -half;
        for (let i = 0; i <= 8; i++) {
          const a = Math.PI - (i / 8) * (Math.PI / 2);
          allPoints.push(toWorld(cx + cR * Math.cos(a), cz + cR * Math.sin(a)));
        }
      }
    }

    if (allPoints.length < 2) return null;

    const curve = new THREE.CatmullRomCurve3(allPoints, false, 'centripetal', 0.5);

    // Find the t closest to the train's current position
    let bestT = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const p = curve.getPointAt(t);
      const dsq = p.distanceToSquared(trainObj.position);
      if (dsq < bestDistSq) {
        bestDistSq = dsq;
        bestT = t;
      }
    }

    return { curve, startT: bestT };
  }

  // ------------------------------------------------------------------
  //  Render loop
  // ------------------------------------------------------------------

  private animate = () => {
    requestAnimationFrame(this.animate);

    // Battery saver: when the tab is hidden (backgrounded / screen off),
    // skip rendering entirely. Also skip when the viewer canvas isn't
    // visible — it might be hidden behind the landing / dashboard / etc.
    // This saves battery on mobile without breaking state.
    if (document.hidden) {
      this.lastFrameTime = performance.now();
      return;
    }

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (this.isPlaying) {
      this.updatePlayMode(dt);
    } else if (this.isPacmanPlaying) {
      this.updatePacman(dt);
    } else {
      this.controls.update();
    }

    // Animate the water surround (if any) by advancing its time uniform
    if (this.surroundMesh instanceof Water) {
      (
        this.surroundMesh.material as THREE.ShaderMaterial
      ).uniforms['time'].value += dt;
    }

    // Animate sharks (island environment)
    if (this.sharks.length > 0) this.updateSharks(dt);

    // Animate campfires and fountains placed in the scene
    this.animateEffects(now);

    this.renderer.render(this.scene, this.camera);
  };

  /** Animate campfire flames (flicker/scale) and fountain jets (bobbing). */
  private animateEffects(now: number) {
    const t = now * 0.001;
    this.brickGroup.traverse((obj) => {
      // Campfire flames: layered cones (core / body / wisp) with per-layer
      // flicker rates, plus a soft halo that pulses with the fire and
      // ember particles that rise and reset.
      if (obj.userData.isCampfireFlame) {
        for (let i = 0; i < obj.children.length; i++) {
          const child = obj.children[i];

          // Halo sprite — gentle breathing pulse so it feels alive
          if (child.userData.isCampfireHalo) {
            const breathe = 1 + Math.sin(t * 2.5) * 0.08 + Math.sin(t * 5.7) * 0.04;
            child.scale.set(5.5 * breathe, 5.5 * breathe, 1);
            const mat = (child as THREE.Sprite).material as THREE.SpriteMaterial;
            mat.opacity = 0.45 + Math.sin(t * 3.1) * 0.08;
            continue;
          }

          // Ember sub-group — rise & reset loop
          if (child.userData.isCampfireEmbers) {
            for (let e = 0; e < child.children.length; e++) {
              const ember = child.children[e] as THREE.Mesh;
              const seed = ember.userData.seed as number;
              const speed = ember.userData.speed as number;
              const baseX = ember.userData.baseX as number;
              const baseZ = ember.userData.baseZ as number;
              // Lifecycle 0..1, looping; 0 = bottom, 1 = top
              const life = ((t * speed + seed) % 1);
              ember.position.y = 1.0 + life * 5.0;
              // Drift sideways as it rises (heat shimmer)
              ember.position.x = baseX + Math.sin(t * 3 + seed * 5) * 0.15 * life;
              ember.position.z = baseZ + Math.cos(t * 2.7 + seed * 4) * 0.15 * life;
              // Fade out near the top
              const mat = ember.material as THREE.MeshBasicMaterial;
              mat.opacity = Math.max(0, 1 - life) * 0.9;
              const s = 1 - life * 0.4;
              ember.scale.set(s, s, s);
            }
            continue;
          }

          // Flame cone — flicker scale + sway, no cumulative drift
          const layer = child.userData.layer as
            | 'core' | 'body' | 'wisp' | undefined;
          if (!layer) continue;
          const seed = i * 1.7;
          // Core flickers fast/sharp, body medium, wisps slow/wide
          const rateY = layer === 'core' ? 11 : layer === 'body' ? 8 : 5.5;
          const rateXZ = layer === 'core' ? 9 : layer === 'body' ? 6 : 4;
          const ampY = layer === 'core' ? 0.30 : layer === 'body' ? 0.22 : 0.18;
          const ampXZ = layer === 'core' ? 0.10 : layer === 'body' ? 0.14 : 0.20;
          const scaleY = 1 + Math.sin(t * rateY + seed) * ampY
            + Math.sin(t * rateY * 1.6 + seed * 2) * (ampY * 0.4);
          const scaleXZ = 1 + Math.sin(t * rateXZ + seed * 3) * ampXZ;
          child.scale.set(scaleXZ, scaleY, scaleXZ);
          // Sway around the BASE position so it doesn't drift
          const baseX = child.userData.baseX as number;
          const baseZ = child.userData.baseZ as number;
          const baseY = child.userData.baseY as number;
          const swayAmp = layer === 'wisp' ? 0.08 : 0.04;
          child.position.x = baseX + Math.sin(t * 2.3 + seed) * swayAmp;
          child.position.z = baseZ + Math.cos(t * 2.1 + seed * 1.3) * swayAmp;
          child.position.y = baseY + Math.sin(t * 3.5 + seed) * 0.05;
        }
      }
      // Fountain jets: gentle bobbing + scale pulse
      if (obj.userData.isFountainJet) {
        for (let i = 0; i < obj.children.length; i++) {
          const jet = obj.children[i];
          const seed = i * 2.3;
          const pulse = 0.85 + Math.sin(t * 4 + seed) * 0.2;
          jet.scale.set(pulse, 0.9 + Math.sin(t * 3 + seed) * 0.15, pulse);
        }
      }
      // Power pellets pulse (bright ↔ dim) at ~3Hz so they read as
      // "special" pickups even at a glance.
      if (obj.userData.isPowerPellet) {
        const pulse = 0.85 + Math.sin(t * 6) * 0.25;
        obj.scale.set(pulse, pulse, pulse);
      }
    });
  }
}

/** Walks `obj`'s descendant tree and returns the first child tagged with
 *  `userData.isDoorHinge` — that's the rotatable hinge group created by
 *  createDoorBlock. Returns null for non-door objects. */
function findDoorHinge(obj: THREE.Object3D): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  obj.traverse((c) => {
    if (!result && c.userData.isDoorHinge) result = c;
  });
  return result;
}

/** Rotates hip/shoulder pivot groups (populated by `createMinifigure` /
 *  `createDogCharacter` in blocks.ts via `userData.parts`) so the limbs
 *  swing back and forth. Biped minifigs use the 2-leg+2-arm gait;
 *  quadruped dogs use a diagonal-pair trot (front-right and back-left
 *  forward, front-left and back-right back). Pass swing=0 to reset to
 *  the neutral idle pose. */
function applyNpcLimbs(obj: THREE.Object3D, swing: number) {
  const parts = obj.userData.parts as
    | {
        // Biped minifig
        rightLeg?: THREE.Group | null;
        leftLeg?: THREE.Group | null;
        rightArm?: THREE.Group | null;
        leftArm?: THREE.Group | null;
        // Quadruped dog
        frontRightLeg?: THREE.Group | null;
        frontLeftLeg?: THREE.Group | null;
        backRightLeg?: THREE.Group | null;
        backLeftLeg?: THREE.Group | null;
      }
    | undefined;
  if (!parts) return;
  // Quadruped: diagonal pairs move in phase (trot gait).
  if (parts.frontRightLeg || parts.backLeftLeg) {
    if (parts.frontRightLeg) parts.frontRightLeg.rotation.x = swing;
    if (parts.backLeftLeg) parts.backLeftLeg.rotation.x = swing;
    if (parts.frontLeftLeg) parts.frontLeftLeg.rotation.x = -swing;
    if (parts.backRightLeg) parts.backRightLeg.rotation.x = -swing;
    return;
  }
  // Biped: right leg forward ↔ left leg back, arms in opposite phase.
  if (parts.rightLeg) parts.rightLeg.rotation.x = swing;
  if (parts.leftLeg) parts.leftLeg.rotation.x = -swing;
  if (parts.rightArm) parts.rightArm.rotation.x = -swing * 0.85;
  if (parts.leftArm) parts.leftArm.rotation.x = swing * 0.85;
}
