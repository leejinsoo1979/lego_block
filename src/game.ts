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
  private pointerDownPos = new THREE.Vector2();
  private wasDrag = false;
  // Tablet long-press → rotate block (touch-only substitute for right click)
  private longPressTimer: number | null = null;
  private longPressFired = false;
  private lastPointerType: string = 'mouse';
  private sound = new SoundManager();
  private lastFrameTime = performance.now();

  // Build state
  color: ColorDef = COLORS[0];
  size: SizeDef = SIZES.find((s) => s.name === '2x2') ?? SIZES[0];
  /** Clockwise rotation step in 90° increments: 0, 1, 2, 3 (= 0°, 90°, 180°, 270°). */
  rotationStep = 0;
  blockType: BlockType = 'brick';
  character: MinifigPreset = MINIFIG_PRESETS[0];
  mode: Mode = 'place';
  /** Default tile size in studs. The map is now built from a grid of tiles
   *  rather than a single resizable plate, so this is per-tile, not the
   *  total board size. */
  tileSize: number = BOARD_SIZE;
  /** Vertical spacing between stacked tiles (one "floor"). */
  static readonly TILE_LEVEL_HEIGHT = 4.0;
  private baseplates = new Map<string, THREE.Group>();
  private sunLight: THREE.DirectionalLight | null = null;
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
  /** When the player is currently riding a slide, this holds the slide's
   *  root group + the player's progress along the slide's local Z axis.
   *  Null when not on a slide. The slide ride mechanic locks the player
   *  to the slide curve and overrides normal physics until they reach
   *  the slide's exit. */
  private slideRideObj: THREE.Object3D | null = null;
  private slideRideLocalZ = 0;
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
  private savedCam = {
    position: new THREE.Vector3(28, 28, 28),
    target: new THREE.Vector3(0, 2, 0),
  };
  // Visible avatar in the world (used in 3rd-person, hidden in 1st-person)
  private playerAvatar: THREE.Group | null = null;
  private avatarYaw = 0; // facing direction in radians
  private walkTime = 0;  // accumulator for limb-swing animation
  private thirdPersonDistance = 14;
  private wasMovingForJumpAnim = false;

  // Event callbacks
  onCountChange: (count: number) => void = () => {};
  onRotationChange: (step: number) => void = () => {};
  onBlockTypeChange: (type: BlockType) => void = () => {};
  onCharacterChange: (preset: MinifigPreset) => void = () => {};
  onModeChange: (mode: Mode) => void = () => {};
  onPlayChange: (playing: boolean) => void = () => {};
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

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
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
      this.cancelLongPress();
      this.longPressFired = false;
      this.wasDrag = false;
    });
    dom.addEventListener('pointerleave', () => {
      this.ghost.visible = false;
      this.hoverBox.visible = false;
      this.cancelLongPress();
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

    // Visible sun disc — a billboarded bright sphere with soft halos so
    // the sun is actually IN the scene, not just an invisible shader light.
    // Positioned along the directional light's direction, far enough away
    // that it stays put as the camera orbits.
    const sunDisc = this.createSunDisc();
    sunDisc.position.copy(sun.position).normalize().multiplyScalar(300);
    this.scene.add(sunDisc);
  }

  /** Visible sun: bright core + two layered translucent halos. */
  private createSunDisc(): THREE.Group {
    const group = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(9, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfffaea, fog: false })
    );
    group.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(15, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffeaad,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        fog: false,
      })
    );
    group.add(halo);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(26, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd778,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        fog: false,
      })
    );
    group.add(glow);

    return group;
  }

  /** Match the shadow frustum to the union of every placed baseplate tile
   *  so large multi-tile maps still receive crisp shadows. */
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
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const halfSpan = Math.max(maxX - minX, maxZ - minZ) / 2 + 8;
    const cam = this.sunLight.shadow.camera;
    cam.left = cx - halfSpan;
    cam.right = cx + halfSpan;
    cam.top = cz + halfSpan;
    cam.bottom = cz - halfSpan;
    cam.updateProjectionMatrix();
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
    if (env.surroundType === 'none') return;

    if (env.surroundType === 'water') {
      this.surroundMesh = this.createWaterSurround(env);
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
    const geom = new THREE.PlaneGeometry(1000, 1000);
    const mat = new THREE.MeshStandardMaterial({
      color: env.surroundColor ?? 0xcccccc,
      roughness: env.surroundRoughness ?? 0.9,
      metalness: 0,
    });
    const ground = new THREE.Mesh(geom, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    ground.userData.isSurround = true;
    return ground;
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
    const rect = this.renderer.domElement.getBoundingClientRect();
    // Raise the raycast target ~70 screen pixels above the finger on
    // touch devices so the finger doesn't occlude the ghost or the cell
    // the user is trying to target. The ghost visually floats just above
    // the fingertip — users adapt to this within a few taps.
    const offsetY = e.pointerType === 'touch' ? -70 : 0;
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y =
      -((e.clientY - rect.top + offsetY) / rect.height) * 2 + 1;
  }

  private onPointerMove(e: PointerEvent) {
    if (this.isPlaying) return;
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
        // Dragging cancels the pending long-press rotation on touch
        this.cancelLongPress();
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

    // Touch: start a long-press timer that rotates the block on hold.
    // Right-click doesn't exist on tablets, so this is the touch substitute
    // for "right click → rotate".
    this.cancelLongPress();
    this.longPressFired = false;
    if (e.pointerType === 'touch' && e.button === 0) {
      this.longPressTimer = window.setTimeout(() => {
        // Only fire if still holding in place (no drag, no release)
        if (!this.wasDrag && !this.placementSuspended) {
          this.rotateClockwise();
          this.longPressFired = true;
          // Haptic nudge so the user knows rotation fired
          if (
            typeof navigator !== 'undefined' &&
            typeof navigator.vibrate === 'function'
          ) {
            navigator.vibrate(25);
          }
        }
        this.longPressTimer = null;
      }, 450);
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

    // Clear any pending long-press regardless of whether it fired
    this.cancelLongPress();

    // End line-placement drag
    if (this.shiftLineStart) {
      this.shiftLineStart = null;
      this.shiftLinePlaced.clear();
      this.controls.enabled = true;
      this.wasDrag = false;
      this.updatePreview();
      return;
    }

    // If a long press already rotated the block, don't also place on release
    if (this.longPressFired) {
      this.longPressFired = false;
      return;
    }

    // Touch uses drag-and-drop placement: the finger drags the ghost to
    // the desired spot and releasing commits. So on touch we IGNORE the
    // wasDrag guard — any release places (or taps the current slot in
    // add-baseplate mode). Mouse drags are still camera rotation.
    const isTouch = e.pointerType === 'touch';
    if (!isTouch && this.wasDrag) return;

    // Add-baseplate mode handles its own clicks — drag-and-drop works the
    // same way since the ghost highlights the slot under the finger and
    // commitBaseplateGhost uses that highlighted slot.
    if (this.addBaseplateMode) {
      if (e.button === 0) this.commitBaseplateGhost();
      else if (e.button === 2) this.setAddBaseplateMode(false);
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

  private cancelLongPress() {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const inTextInput =
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

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
            // Doors take priority over NPCs (they share the E key).
            if (this.currentDoorHotspot) {
              this.toggleCurrentDoor();
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

    if (e.key === 'Tab' && !e.repeat) {
      e.preventDefault();
      this.rotateClockwise();
    } else if (e.key === 'x' || e.key === 'X') {
      this.setMode(this.mode === 'remove' ? 'place' : 'remove');
    } else if (e.key === 'Escape') {
      // Esc cancels add-baseplate mode first; otherwise clears the
      // current block selection.
      if (this.addBaseplateMode) {
        this.setAddBaseplateMode(false);
        return;
      }
      this.placementSuspended = true;
      this.ghost.visible = false;
      this.hoverBox.visible = false;
      this.onSelectionCleared();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
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
    this.onBlockTypeChange(type);
    this.updatePreview();
  }

  setCharacter(preset: MinifigPreset) {
    this.character = preset;
    this.placementSuspended = false;
    this.onCharacterChange(preset);
    this.updatePreview();
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.placementSuspended = false;
    this.onModeChange(mode);
    this.renderer.domElement.style.cursor =
      mode === 'remove' ? 'not-allowed' : 'crosshair';
    this.updatePreview();
  }

  clearAll() {
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

  // ------------------------------------------------------------------
  //  Preview
  // ------------------------------------------------------------------

  private updatePreview() {
    if (this.isPlaying) return;
    if (this.placementSuspended) {
      this.ghost.visible = false;
      this.hoverBox.visible = false;
      return;
    }
    if (this.mode === 'remove') {
      this.ghost.visible = false;
      this.updateHoverBox();
    } else {
      this.hoverBox.visible = false;
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
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.brickGroup.children,
      true
    );
    if (hits.length === 0) {
      this.hoverBox.visible = false;
      return;
    }
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.isBrick) obj = obj.parent;
    if (!obj || obj.parent !== this.brickGroup) {
      this.hoverBox.visible = false;
      return;
    }
    const bbox = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);
    this.hoverBox.scale.copy(size).addScalar(0.06);
    this.hoverBox.position.copy(center);
    this.hoverBox.visible = true;
  }

  // ------------------------------------------------------------------
  //  Place / remove
  // ------------------------------------------------------------------

  private placeBlock() {
    const placement = this.computePlacement();
    if (!placement) return;
    // Bridge previews can return a "raw" snapped position with invalid=true
    // so the user can see where it would go in red. We must NOT actually
    // place anything in that case.
    if (placement.invalid) return;
    this.placeAtPosition(placement, placement.autoRotate);
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
    this.sound.playClick();
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
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.brickGroup.children,
      true
    );
    if (hits.length === 0) return;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.isBrick) obj = obj.parent;
    if (obj && obj.parent === this.brickGroup) {
      this.brickGroup.remove(obj);
      this.sound.playRemove();
      this.onCountChange(this.brickGroup.children.length);
      this.updatePreview();
    }
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

    // Hide build previews
    this.ghost.visible = false;
    this.hoverBox.visible = false;

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

    // Restore build camera + orbit controls
    this.camera.position.copy(this.savedCam.position);
    this.controls.target.copy(this.savedCam.target);
    this.controls.enabled = true;
    this.controls.update();

    this.onPlayChange(false);
    // Hide the dog-whistle UI on the way out of play mode.
    this.dogsFollowing = false;
    this.onDogsPresentChange(false);
    this.onDogsFollowingChange(false);
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

    // Real Roblox-style run: significantly faster than walk. The walk
    // cycle amplitude + body lean changes below make it *feel* like a
    // full-on sprint, not just "faster walking".
    const RUN_MULT = 2.4;
    const SPEED = 6 * (this.moveKeys.run ? RUN_MULT : 1);
    const GRAVITY = -22;
    const JUMP = this.moveKeys.run ? 10.5 : 9;
    // Minifig footprint is 2×1 studs — the visible mesh (torso, arms,
    // shoulders) extends up to 1 unit from the player center. Using 0.45
    // lets arms/shoulders clip into walls and doorframes. 1.0 half-width
    // gives a 2×2 collision box that loosely bounds the minifig at any
    // Y-rotation, so the mesh never overlaps block geometry.
    const BODY_W = 1.0; // half-width (full 2.0, matches minifig width)
    // Both derived from the loaded GLB so they track its uniform scale.
    const BODY_H = getMinifigHeight() || 2.5;
    const EYE_HEIGHT = BODY_H * 0.92; // just below the top of the head/hat

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
    if (move.lengthSq() > 0) move.normalize();

    this.playerVel.x = move.x * SPEED;
    this.playerVel.z = move.z * SPEED;
    const isWalking = move.lengthSq() > 0.001;

    // Gravity
    this.playerVel.y += GRAVITY * dt;

    // Jump (only if grounded)
    if (this.moveKeys.jump && this.onGround) {
      this.playerVel.y = JUMP;
      this.onGround = false;
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
    if (newY < 0) {
      newY = 0;
      this.playerVel.y = 0;
      this.onGround = true;
    }
    if (!this.collides(this.playerPos.x, newY, this.playerPos.z, BODY_W, BODY_H)) {
      this.playerPos.y = newY;
      // Ground test: sample a hair below current position
      const below = this.playerPos.y - 0.02;
      this.onGround =
        below <= 0 ||
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
    // net catches them.

    // Safety net: if something goes sideways and we fall forever, respawn
    if (this.playerPos.y < -20) {
      const spawnZ = Math.min(15, this.tileSize / 2 - 5);
      this.playerPos.set(0, 0, spawnZ);
      this.playerVel.set(0, 0, 0);
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

      // Walking animation: hip-pivoted leg swing + opposite-phase arm swing.
      // Pivots are created in createMinifigure (blocks.ts) so rotations
      // happen at the hip / shoulder rather than the mesh center. Running
      // uses a faster cycle, a larger stride, and more arm swing.
      if (isWalking && this.onGround) {
        this.walkTime += dt * (isRunning ? 15 : 9);
      }
      const swingAmp = isRunning ? 0.7 : 0.32;
      const swing =
        isWalking && this.onGround ? Math.sin(this.walkTime) * swingAmp : 0;
      const parts = this.playerAvatar.userData.parts as
        | {
            rightLeg?: THREE.Group | null;
            leftLeg?: THREE.Group | null;
            rightArm?: THREE.Group | null;
            leftArm?: THREE.Group | null;
          }
        | undefined;
      if (parts) {
        // Right leg forward ↔ left leg back
        if (parts.rightLeg) parts.rightLeg.rotation.x = swing;
        if (parts.leftLeg) parts.leftLeg.rotation.x = -swing;
        // Arms swing opposite to legs, a bit bigger when sprinting
        const armScale = isRunning ? 1.0 : 0.85;
        if (parts.rightArm) parts.rightArm.rotation.x = -swing * armScale;
        if (parts.leftArm) parts.leftArm.rotation.x = swing * armScale;
      }
      // Body bounce — much more pronounced when sprinting
      const bobAmp = isRunning ? 0.14 : 0.05;
      const bob =
        isWalking && this.onGround
          ? Math.abs(Math.sin(this.walkTime)) * bobAmp
          : 0;
      this.playerAvatar.position.y += bob;

      // Forward body lean when sprinting — gives that real "running"
      // silhouette instead of "walking faster". Smoothly eases in/out so
      // starting/stopping Shift doesn't snap the body.
      // With YXZ rotation order the local X axis (after yaw) maps to the
      // character's right, and a POSITIVE rotation.x tilts the head toward
      // the character's forward direction — i.e. a forward lean.
      this.playerAvatar.rotation.order = 'YXZ';
      const targetLean = isRunning ? 0.28 : 0; // ~16° forward
      const currentLean = this.playerAvatar.rotation.x;
      const leanDelta = targetLean - currentLean;
      this.playerAvatar.rotation.x =
        currentLean + leanDelta * Math.min(1, dt * 8);
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
    let maxTop = 0; // baseplate top
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

        // Stand next to the player, not on top
        const FOLLOW_STOP = 2.2;
        if (distSq < FOLLOW_STOP * FOLLOW_STOP) {
          this.faceNpcToward(npc, this.playerPos.x, this.playerPos.z, dt * 6);
          applyNpcLimbs(npc.obj, 0);
          continue;
        }

        const inv = 1 / Math.sqrt(distSq);
        const dirX = tx * inv;
        const dirZ = tz * inv;
        // Dogs run a bit faster than a wandering NPC so they can catch up
        const speed = Game.NPC_SPEED * 1.8;
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
            dt * 8
          );
          npc.walkTime += dt * 9;
          const swing = Math.sin(npc.walkTime) * 0.35;
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
  //  Render loop
  // ------------------------------------------------------------------

  private animate = () => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (this.isPlaying) {
      this.updatePlayMode(dt);
    } else {
      this.controls.update();
    }

    // Animate the water surround (if any) by advancing its time uniform
    if (this.surroundMesh instanceof Water) {
      (
        this.surroundMesh.material as THREE.ShaderMaterial
      ).uniforms['time'].value += dt;
    }

    this.renderer.render(this.scene, this.camera);
  };
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
