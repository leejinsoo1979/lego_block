// ----------------------------------------------------------------------
//  Landing page — 3D hero scene + routing (landing ↔ app).
//
//  The landing renders a tiny Three.js scene with floating lego bricks
//  and a slowly rotating minifig. It's a separate renderer from the
//  main game so mounting/unmounting is cheap.
// ----------------------------------------------------------------------

import * as THREE from 'three';
import { createBrick, createMinifigure } from './blocks';
import { COLORS, MINIFIG_PRESETS } from './config';
import { onAuthChange, signInWithGoogle } from './auth';
import { showDashboard } from './dashboard';

// --------------------------------------------------------------------
//  3D Hero scene
// --------------------------------------------------------------------

interface FloatingItem {
  obj: THREE.Object3D;
  baseY: number;
  bobAmp: number;
  bobFreq: number;
  bobPhase: number;
  spinSpeed: number;
}

let heroScene: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  items: FloatingItem[];
  animId: number | null;
  resizeHandler: () => void;
} | null = null;

/** Build and start the 3D hero scene. Call after the DOM is ready. */
export function startHeroScene() {
  if (heroScene) return;
  const canvas = document.getElementById(
    'landing-canvas'
  ) as HTMLCanvasElement | null;
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();

  // Lighting — bright, cheerful, no harsh shadows
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdce6f0, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(6, 10, 6);
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xfff4e0, 0.4);
  fill.position.set(-8, 4, -4);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  // Angle looking slightly down from upper-right — classic hero pose
  camera.position.set(8, 6, 14);
  camera.lookAt(0, 2, 0);

  const items: FloatingItem[] = [];

  // A central minifig — the star of the show
  const preset = MINIFIG_PRESETS[0];
  const fig = createMinifigure(preset);
  fig.position.set(-4, 2, 2);
  fig.scale.setScalar(1.3);
  scene.add(fig);
  items.push({
    obj: fig,
    baseY: 2,
    bobAmp: 0.15,
    bobFreq: 0.6,
    bobPhase: 0,
    spinSpeed: 0.2,
  });

  // Scattered floating bricks around the minifig
  const brickConfigs: {
    x: number;
    y: number;
    z: number;
    w: number;
    d: number;
    colorHex: number;
    type: 'brick' | 'plate' | 'tile';
    scale?: number;
  }[] = [
    { x: 3, y: 4, z: 0, w: 2, d: 2, colorHex: COLORS[0].hex, type: 'brick' },
    { x: 5, y: 2.5, z: -2, w: 1, d: 2, colorHex: COLORS[2].hex, type: 'brick' },
    { x: 2, y: 1, z: 3, w: 2, d: 2, colorHex: COLORS[1].hex, type: 'plate' },
    { x: -2, y: 5, z: -1, w: 1, d: 1, colorHex: COLORS[3].hex, type: 'brick' },
    { x: 6, y: 5.5, z: 2, w: 1, d: 1, colorHex: COLORS[6].hex, type: 'brick' },
    { x: -5, y: 4, z: -3, w: 2, d: 1, colorHex: COLORS[7].hex, type: 'brick' },
    { x: 4, y: 7, z: 1, w: 1, d: 1, colorHex: COLORS[2].hex, type: 'plate' },
    { x: -3, y: 6.5, z: 3, w: 1, d: 2, colorHex: COLORS[0].hex, type: 'brick' },
    { x: 0, y: 8, z: -3, w: 2, d: 2, colorHex: COLORS[1].hex, type: 'brick' },
  ];
  brickConfigs.forEach((cfg, i) => {
    const b = createBrick({
      w: cfg.w,
      d: cfg.d,
      colorHex: cfg.colorHex,
      type: cfg.type,
    });
    b.position.set(cfg.x, cfg.y, cfg.z);
    b.rotation.y = Math.random() * Math.PI * 2;
    b.rotation.x = (Math.random() - 0.5) * 0.2;
    if (cfg.scale) b.scale.setScalar(cfg.scale);
    scene.add(b);
    items.push({
      obj: b,
      baseY: cfg.y,
      bobAmp: 0.25 + Math.random() * 0.2,
      bobFreq: 0.4 + Math.random() * 0.5,
      bobPhase: (i / brickConfigs.length) * Math.PI * 2,
      spinSpeed: (Math.random() - 0.5) * 0.4,
    });
  });

  // Animation loop
  const clock = new THREE.Clock();
  const startTime = performance.now();

  const animate = () => {
    const t = clock.getElapsedTime();
    const elapsed = (performance.now() - startTime) / 1000;

    for (const it of items) {
      it.obj.position.y = it.baseY + Math.sin(t * it.bobFreq + it.bobPhase) * it.bobAmp;
      it.obj.rotation.y += it.spinSpeed * 0.015;
    }

    // Gentle camera orbit
    const camOrbit = Math.sin(elapsed * 0.12) * 0.8;
    camera.position.x = 8 + camOrbit;
    camera.position.z = 14 + Math.cos(elapsed * 0.12) * 0.4;
    camera.lookAt(0, 3, 0);

    renderer.render(scene, camera);
    heroScene!.animId = requestAnimationFrame(animate);
  };

  const resizeHandler = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resizeHandler);

  heroScene = {
    renderer,
    scene,
    camera,
    items,
    animId: null,
    resizeHandler,
  };
  heroScene.animId = requestAnimationFrame(animate);
}

/** Stop the hero scene and release GPU resources. */
export function stopHeroScene() {
  if (!heroScene) return;
  if (heroScene.animId != null) cancelAnimationFrame(heroScene.animId);
  window.removeEventListener('resize', heroScene.resizeHandler);
  heroScene.renderer.dispose();
  heroScene.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose?.();
      const mat = obj.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    }
  });
  heroScene = null;
}

// --------------------------------------------------------------------
//  Landing ↔ App routing
// --------------------------------------------------------------------

const GUEST_KEY = 'legoworld:entered-as-guest';

/** Enter the builder directly (hide landing + dashboard). Used by guest flow. */
export function enterApp() {
  document.body.classList.remove('show-landing');
  document.body.classList.remove('show-dashboard');
  stopHeroScene();
}

/** Show the landing (hide app + dashboard). */
export function showLanding() {
  document.body.classList.remove('show-dashboard');
  document.body.classList.add('show-landing');
  startHeroScene();
}

/** Call once at boot. Decides whether to show the landing based on auth
 *  state + whether the user has explicitly chosen "둘러보기". */
export function initLandingRouting() {
  // Hero starts immediately so the first render looks good
  startHeroScene();

  // Wire landing buttons
  const loginBtns = [
    document.getElementById('landing-login'),
    document.getElementById('landing-login-top'),
    document.getElementById('landing-login-bottom'),
  ];
  loginBtns.forEach((btn) =>
    btn?.addEventListener('click', () => {
      signInWithGoogle();
    })
  );

  const guestBtns = [
    document.getElementById('landing-guest'),
    document.getElementById('landing-guest-bottom'),
  ];
  guestBtns.forEach((btn) =>
    btn?.addEventListener('click', () => {
      sessionStorage.setItem(GUEST_KEY, '1');
      enterApp();
    })
  );

  // Smooth scroll for nav links
  document.querySelectorAll<HTMLAnchorElement>('.landing-nav-links a').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (href?.startsWith('#')) {
        e.preventDefault();
        document
          .querySelector(href)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Auth-state driven routing.
  //   - Signed in (no prior dashboard exit) → dashboard
  //   - Guest mode chosen → builder
  //   - Otherwise → landing
  onAuthChange((state) => {
    const isGuest = sessionStorage.getItem(GUEST_KEY) === '1';
    if (state.user) {
      // Signed in — if we're currently on the landing, route to dashboard.
      // If the builder is already visible (e.g. user clicked a map), leave
      // it alone; dashboard becomes their "home" button in the icon bar.
      const alreadyInApp =
        !document.body.classList.contains('show-landing') &&
        !document.body.classList.contains('show-dashboard');
      if (!alreadyInApp) {
        stopHeroScene();
        showDashboard();
      }
    } else if (isGuest) {
      enterApp();
    } else {
      showLanding();
    }
  });
}
