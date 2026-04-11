import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  BLOCK_TYPES,
  BOARD_SIZE,
  COLORS,
  MINIFIG_PRESETS,
  PLATE_HEIGHT,
  SIZES,
} from './config';
import type { BlockType, ColorDef, MinifigPreset, SizeDef } from './config';
import {
  createBrick,
  createBrickGhost,
  createGhost,
  createMinifigGhost,
  createMinifigure,
} from './blocks';
import { SoundManager } from './sound';

export type Mode = 'place' | 'remove';

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
  boardSize: number = BOARD_SIZE;
  private sunLight: THREE.DirectionalLight | null = null;

  // Line placement state (Shift + drag)
  private shiftLineStart: { x: number; y: number; z: number } | null = null;
  private shiftLinePlaced: Set<string> = new Set();

  // Play mode state
  isPlaying = false;
  private playAABBs: THREE.Box3[] = [];
  private playerPos = new THREE.Vector3(0, 0, 15);
  private playerVel = new THREE.Vector3();
  private onGround = false;
  private moveKeys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
  };
  private savedCam = {
    position: new THREE.Vector3(28, 28, 28),
    target: new THREE.Vector3(0, 2, 0),
  };

  // Event callbacks
  onCountChange: (count: number) => void = () => {};
  onRotationChange: (step: number) => void = () => {};
  onBlockTypeChange: (type: BlockType) => void = () => {};
  onCharacterChange: (preset: MinifigPreset) => void = () => {};
  onModeChange: (mode: Mode) => void = () => {};
  onPlayChange: (playing: boolean) => void = () => {};
  onBoardSizeChange: (size: number) => void = () => {};

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
    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    dom.addEventListener('pointerup', (e) => this.onPointerUp(e));
    dom.addEventListener('pointerleave', () => {
      this.ghost.visible = false;
      this.hoverBox.visible = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

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

  /** Match the shadow frustum to the current baseplate so large maps
   *  still receive crisp shadows. */
  private updateSunShadowBounds() {
    if (!this.sunLight) return;
    const s = this.boardSize / 2 + 5;
    const cam = this.sunLight.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.updateProjectionMatrix();
  }

  private createBaseplate() {
    const group = new THREE.Group();
    const size = this.boardSize;

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x4b974b,
      roughness: 0.7,
    });
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(size, 0.4, size),
      plateMat
    );
    plate.position.y = -0.2;
    plate.receiveShadow = true;
    group.add(plate);

    const studGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
    const total = size * size;
    const instanced = new THREE.InstancedMesh(studGeom, plateMat, total);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        dummy.position.set(
          -size / 2 + 0.5 + x,
          0.1,
          -size / 2 + 0.5 + z
        );
        dummy.updateMatrix();
        instanced.setMatrixAt(i++, dummy.matrix);
      }
    }
    instanced.receiveShadow = true;
    group.add(instanced);

    group.userData.isBaseplate = true;
    this.baseplate = group;
    this.scene.add(group);
  }

  /** Swap the current baseplate for a new one at the given stud size.
   *  Existing bricks remain; anything now outside the new bounds keeps its
   *  position (user can manually clear/remove). */
  setBoardSize(size: number) {
    if (size === this.boardSize) return;
    this.boardSize = size;

    // Dispose old baseplate
    if (this.baseplate) {
      this.scene.remove(this.baseplate);
      this.baseplate.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
          obj.geometry?.dispose?.();
        }
      });
    }

    this.createBaseplate();
    this.updateSunShadowBounds();
    this.onBoardSizeChange(size);
    this.updatePreview();
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
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerMove(e: PointerEvent) {
    if (this.isPlaying) return;
    this.updatePointer(e);
    if (e.buttons > 0) {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (dx * dx + dy * dy > 25) this.wasDrag = true;
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
    if (e.button === 1) e.preventDefault();

    // Shift + left click starts a line-placement drag
    if (
      e.shiftKey &&
      e.button === 0 &&
      this.mode === 'place'
    ) {
      const start = this.computePlacement();
      if (start) {
        this.shiftLineStart = { ...start };
        this.shiftLinePlaced.clear();
        this.controls.enabled = false;
        this.ghost.visible = false;
        this.hoverBox.visible = false;
        this.placeAtPosition(start);
        this.shiftLinePlaced.add(this.posKey(start));
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

    if (this.wasDrag) return;
    if (e.button === 0) {
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
        case 'Space':
          this.moveKeys.jump = true;
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
      case 'Space':
        this.moveKeys.jump = false;
        break;
    }
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
    this.onBlockTypeChange(type);
    this.updatePreview();
  }

  setCharacter(preset: MinifigPreset) {
    this.character = preset;
    this.onCharacterChange(preset);
    this.updatePreview();
  }

  setMode(mode: Mode) {
    this.mode = mode;
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

  private effectiveSize(): { w: number; d: number } {
    // Footprint only swaps on 90° / 270° (odd rotation steps); 0° and 180°
    // share the same footprint.
    const swapped = this.rotationStep % 2 === 1;
    if (this.blockType === 'minifig') {
      return swapped ? { w: 1, d: 2 } : { w: 2, d: 1 };
    }
    const def = BLOCK_TYPES.find((t) => t.type === this.blockType);
    if (def?.fixedSize) {
      const { w, d } = def.fixedSize;
      return swapped ? { w: d, d: w } : { w, d };
    }
    return swapped
      ? { w: this.size.d, d: this.size.w }
      : { w: this.size.w, d: this.size.d };
  }

  private snapXZ(v: number, count: number): number {
    const offset = (count % 2) * 0.5;
    return Math.round(v - offset) + offset;
  }

  private snapBottomY(hitY: number): number {
    return Math.max(0, Math.floor(hitY / PLATE_HEIGHT + 0.1) * PLATE_HEIGHT);
  }

  private computePlacement(): { x: number; y: number; z: number } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      [this.baseplate, this.brickGroup],
      true
    );
    if (hits.length === 0) return null;
    const hit = hits[0];
    if (!hit.face) return null;

    const worldNormal = hit.face.normal
      .clone()
      .transformDirection(hit.object.matrixWorld);
    if (worldNormal.y < 0.5) return null;

    const eff = this.effectiveSize();
    const pt = hit.point.clone();
    let bottomY = this.snapBottomY(pt.y);
    const x = this.snapXZ(pt.x, eff.w);
    const z = this.snapXZ(pt.z, eff.d);

    const half = this.boardSize / 2;
    const bw = eff.w / 2;
    const bd = eff.d / 2;
    if (x - bw < -half || x + bw > half) return null;
    if (z - bd < -half || z + bd > half) return null;

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
      // foot 0.32 + scaled GLB body 4.0 ≈ 4.32 (hat excluded; hats vary
      // per preset and shouldn't gate stacking).
      return 4.32;
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
      return new THREE.Box3(
        new THREE.Vector3(pos.x - w / 2, pos.y, pos.z - d / 2),
        new THREE.Vector3(pos.x + w / 2, pos.y + 4.32, pos.z + d / 2)
      );
    }
    return new THREE.Box3().setFromObject(obj);
  }

  // ------------------------------------------------------------------
  //  Preview
  // ------------------------------------------------------------------

  private updatePreview() {
    if (this.isPlaying) return;
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
    const eff = this.effectiveSize();
    const heightPlates = this.currentGhostHeightPlates();
    const u = this.ghost.userData;
    const isMinifig = this.blockType === 'minifig';
    const isShaped = this.isShapedBlock(this.blockType);

    const needsRecreate =
      u.type !== this.blockType ||
      u.w !== eff.w ||
      u.d !== eff.d ||
      u.heightPlates !== heightPlates ||
      // Shaped/minifig ghosts bake color+rotation into their child materials
      // so any change requires a full rebuild.
      (isMinifig &&
        (u.characterId !== this.character.id ||
          u.rotationStep !== this.rotationStep)) ||
      (isShaped &&
        (u.colorHex !== this.color.hex ||
          u.rotationStep !== this.rotationStep));

    if (needsRecreate) {
      this.scene.remove(this.ghost);
      if (isMinifig) {
        const fig = createMinifigGhost(this.character);
        fig.rotation.y = -this.rotationStep * (Math.PI / 2);
        this.ghost = fig;
      } else if (isShaped) {
        const shaped = createBrickGhost({
          w: eff.w,
          d: eff.d,
          colorHex: this.color.hex,
          type: this.blockType,
        });
        shaped.rotation.y = -this.rotationStep * (Math.PI / 2);
        this.ghost = shaped;
      } else {
        this.ghost = createGhost({
          w: eff.w,
          d: eff.d,
          heightPlates,
          colorHex: this.color.hex,
        });
      }
      this.ghost.userData.type = this.blockType;
      this.ghost.userData.w = eff.w;
      this.ghost.userData.d = eff.d;
      this.ghost.userData.heightPlates = heightPlates;
      this.ghost.userData.colorHex = this.color.hex;
      this.ghost.userData.characterId = this.character.id;
      this.ghost.userData.rotationStep = this.rotationStep;
      this.scene.add(this.ghost);
    } else if (!isMinifig && !isShaped && this.ghost instanceof THREE.Mesh) {
      // Cheap color update for the box ghost
      const mat = this.ghost.material as THREE.MeshBasicMaterial;
      mat.color.setHex(this.color.hex);
      this.ghost.userData.colorHex = this.color.hex;
    }

    const placement = this.computePlacement();
    if (placement) {
      this.ghost.position.set(placement.x, placement.y, placement.z);
      this.ghost.visible = true;
    } else {
      this.ghost.visible = false;
    }
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
    this.placeAtPosition(placement);
  }

  /** Places a block at the given (already-snapped and validated) position. */
  private placeAtPosition(p: { x: number; y: number; z: number }) {
    let obj: THREE.Group;
    if (this.blockType === 'minifig') {
      obj = createMinifigure(this.character);
      obj.rotation.y = -this.rotationStep * (Math.PI / 2);
    } else {
      const eff = this.effectiveSize();
      obj = createBrick({
        w: eff.w,
        d: eff.d,
        colorHex: this.color.hex,
        type: this.blockType,
      });
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

    const half = this.boardSize / 2;
    for (let i = 0; i <= steps; i++) {
      const pos = {
        x: start.x + signX * stepSize * i,
        y: start.y,
        z: start.z + signZ * stepSize * i,
      };
      const key = this.posKey(pos);
      if (this.shiftLinePlaced.has(key)) continue;
      if (pos.x - eff.w / 2 < -half || pos.x + eff.w / 2 > half) continue;
      if (pos.z - eff.d / 2 < -half || pos.z + eff.d / 2 > half) continue;
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

    // Build collision AABBs (body-only, excluding studs) for every placed object
    this.playAABBs = [];
    for (const child of this.brickGroup.children) {
      this.playAABBs.push(this.getBlockAABB(child));
    }

    // Spawn player on a clear spot near the +Z edge of the baseplate
    const spawnZ = Math.min(15, this.boardSize / 2 - 5);
    this.playerPos.set(0, 0, spawnZ);
    this.playerVel.set(0, 0, 0);
    this.onGround = true;

    // Lazily create PointerLockControls, bound to the canvas
    if (!this.fpsControls) {
      this.fpsControls = new PointerLockControls(
        this.camera,
        this.renderer.domElement
      );
      // Only exit play mode if user actually unlocks AFTER having locked
      // (e.g., pressed ESC). Failed lock attempts never reach 'lock' event.
      this.fpsControls.addEventListener('lock', () => {
        this.fpsControls!.addEventListener(
          'unlock',
          () => {
            if (this.isPlaying) this.stopPlay();
          },
          { once: true }
        );
      });
    }

    // Position camera at minifig eye height, facing baseplate center
    this.camera.position.set(
      this.playerPos.x,
      this.playerPos.y + 3.0,
      this.playerPos.z
    );
    this.camera.lookAt(0, 3.0, 0);

    // Requesting pointer lock may fail silently in sandboxed iframes.
    // WASD movement still works even without mouse look.
    try {
      this.fpsControls.lock();
    } catch {
      /* ignore — play mode continues without mouse look */
    }
    this.lastFrameTime = performance.now();
    this.onPlayChange(true);
  }

  stopPlay() {
    if (!this.isPlaying) return;
    this.isPlaying = false;

    this.moveKeys.forward = false;
    this.moveKeys.back = false;
    this.moveKeys.left = false;
    this.moveKeys.right = false;
    this.moveKeys.jump = false;

    if (this.fpsControls && this.fpsControls.isLocked) {
      this.fpsControls.unlock();
    }

    // Restore build camera + orbit controls
    this.camera.position.copy(this.savedCam.position);
    this.controls.target.copy(this.savedCam.target);
    this.controls.enabled = true;
    this.controls.update();

    this.onPlayChange(false);
  }

  private updatePlayMode(dt: number) {
    const SPEED = 6;
    const GRAVITY = -22;
    const JUMP = 9;
    const BODY_W = 0.45; // minifig width ≈ 1 stud
    const BODY_H = 4.32; // foot 0.32 + scaled GLB body 4.0 (hat excluded)
    const EYE_HEIGHT = 4.0; // eye level — just below the top of the GLB head

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

    // Clamp inside the baseplate so the player can't walk off into the void
    const half = this.boardSize / 2 - BODY_W;
    this.playerPos.x = Math.max(-half, Math.min(half, this.playerPos.x));
    this.playerPos.z = Math.max(-half, Math.min(half, this.playerPos.z));

    // Safety net: if something goes sideways and we fall forever, respawn
    if (this.playerPos.y < -20) {
      const spawnZ = Math.min(15, this.boardSize / 2 - 5);
      this.playerPos.set(0, 0, spawnZ);
      this.playerVel.set(0, 0, 0);
    }

    // Sync camera to minifig eye position
    this.camera.position.set(
      this.playerPos.x,
      this.playerPos.y + EYE_HEIGHT,
      this.playerPos.z
    );
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
    for (const b of this.playAABBs) {
      if (box.intersectsBox(b)) return true;
    }
    return false;
  }

  private findGroundY(x: number, y: number, z: number, bw: number): number {
    let maxTop = 0; // baseplate top
    for (const b of this.playAABBs) {
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
    for (const b of this.playAABBs) {
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
    this.renderer.render(this.scene, this.camera);
  };
}
