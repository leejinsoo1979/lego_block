import * as THREE from 'three';
import {
  createBrick,
  createDogCharacter,
  createMinifigure,
  getMinifigHeight,
} from './blocks';
import { BLOCK_TYPES, MINIFIG_PRESETS } from './config';
import type { BlockType, MinifigPreset } from './config';

/**
 * Tiny offscreen renderer used to generate data-URL thumbnails.
 * Shares a single renderer/scene across all calls.
 */

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let currentObj: THREE.Object3D | null = null;

const THUMB_SIZE = 180;

function setup() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.setPixelRatio(2);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.9);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(4, 6, 3);
  scene.add(dir);

  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambient);

  camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
}

function render(obj: THREE.Object3D): string {
  if (currentObj) scene!.remove(currentObj);
  scene!.add(obj);
  currentObj = obj;
  renderer!.render(scene!, camera!);
  return renderer!.domElement.toDataURL('image/png');
}

export function renderBlockTypeThumbnail(
  type: BlockType,
  colorHex: number
): string {
  setup();

  if (type === 'minifig') {
    const fig = createMinifigure(MINIFIG_PRESETS[0]);
    const h = getMinifigHeight() || 2.5;
    const dist = h * 1.6;
    camera!.position.set(dist, h * 1.2, dist * 1.05);
    camera!.lookAt(0, h * 0.5, 0);
    return render(fig);
  }

  if (type === 'dog') {
    const dog = createDogCharacter();
    // Dog is ~2 long × 1 wide × 1.5 tall. Three-quarter view from
    // the front-right so head, ears, and legs all read clearly.
    camera!.position.set(3.0, 2.3, 3.6);
    camera!.lookAt(0, 0.9, 0);
    return render(dog);
  }

  // Pick a representative footprint. Most usesSize blocks fall back to
  // 2×2, but a few need a bigger default so the thumbnail reads right —
  // e.g. ramps only look gentle with a longer run.
  const def = BLOCK_TYPES.find((t) => t.type === type);
  let w = def?.fixedSize?.w ?? 2;
  let d = def?.fixedSize?.d ?? 2;
  if (type === 'ramp') {
    w = 1;
    d = 4; // 1×4 @ 1 brick rise ≈ 17° — clearly "gentle"
  } else if (type === 'ramptall') {
    w = 1;
    d = 4; // 1×4 @ 2 brick rise ≈ 31° — taller but still a ramp
  }
  const obj = createBrick({ w, d, colorHex, type });

  switch (type) {
    case 'brick':
      camera!.position.set(3.8, 3.2, 3.8);
      camera!.lookAt(0, 0.5, 0);
      break;
    case 'tallbrick':
      // 6 plates (= 2.4 units) tall — pull camera back and aim higher.
      camera!.position.set(4.6, 3.8, 4.6);
      camera!.lookAt(0, 1.2, 0);
      break;
    case 'wallpanel':
      // 9 plates (= 3.6 units) tall — pull further back and aim mid-height.
      camera!.position.set(5.4, 4.4, 5.4);
      camera!.lookAt(0, 1.8, 0);
      break;
    case 'wallhigh':
      // 15 plates (= 6.0 units) tall — matches the door height.
      camera!.position.set(7.5, 6.0, 7.5);
      camera!.lookAt(0, 3.0, 0);
      break;
    case 'walltower':
      // 18 plates (= 7.2 units) tall — matches the archway height.
      camera!.position.set(8.5, 7.0, 8.5);
      camera!.lookAt(0, 3.6, 0);
      break;
    case 'plate':
    case 'tile':
      camera!.position.set(3.2, 2.8, 3.2);
      camera!.lookAt(0, 0.15, 0);
      break;
    case 'slope':
      // Spin the slope 90° counter-clockwise (as seen from the camera) so
      // the slope face reads naturally in the thumbnail.
      obj.rotation.y = -Math.PI / 2;
      camera!.position.set(4.0, 3.0, 4.2);
      camera!.lookAt(0, 0.5, 0);
      break;
    case 'ramp':
      // 1×4 ramp (1 brick rise) — pull the camera back to fit the
      // length and aim just above the slope center.
      camera!.position.set(5.0, 2.8, 5.4);
      camera!.lookAt(0, 0.45, 0);
      break;
    case 'ramptall':
      // 1×4 ramptall (2 brick rise) — taller peak, same length.
      camera!.position.set(5.2, 3.6, 5.6);
      camera!.lookAt(0, 0.9, 0);
      break;
    case 'arch':
      camera!.position.set(0, 2.6, 6.5);
      camera!.lookAt(0, 0.7, 0);
      break;
    case 'round':
    case 'cone':
      camera!.position.set(2.6, 2.4, 2.6);
      camera!.lookAt(0, 0.6, 0);
      break;
    case 'window':
      camera!.position.set(0, 2.0, 6.2);
      camera!.lookAt(0, 1.2, 0);
      break;
    case 'door':
      // 4×1×6.0 — widened to 4 studs so a 2-stud-wide minifig with
      // generous collision can walk through without clipping the jambs.
      // Head-on view; camera pulled back to fit both the 4-wide footprint
      // and the 6-tall height.
      camera!.position.set(0, 4.0, 14);
      camera!.lookAt(0, 3.0, 0);
      break;
    case 'fence':
      camera!.position.set(3.5, 2.0, 5.5);
      camera!.lookAt(0, 0.5, 0);
      break;
    case 'wheel':
      camera!.position.set(3.6, 2.4, 4.0);
      camera!.lookAt(0, 0.5, 0);
      break;
    // ------------------------------------------------------------------
    //  Special blocks: all 4.8–6.0 units tall. The thumbnail camera uses
    //  a 28° FOV, so fitting a 4.8-tall block needs distance ~11 and a
    //  6.0-tall block needs distance ~14. All aim at the vertical center.
    // ------------------------------------------------------------------
    case 'archway':
      // 6×2×7.2 — default archway. Pull camera back so the 6-wide
      // footprint AND the 7.2-tall opening both fit comfortably.
      camera!.position.set(10, 6, 13);
      camera!.lookAt(0, 3.6, 0);
      break;
    case 'archmid':
      // 8×2×8.4 — wider opening, slightly taller. Pull back further so
      // both axes still fit the square thumbnail.
      camera!.position.set(11, 7, 15);
      camera!.lookAt(0, 4.2, 0);
      break;
    case 'archlarge':
      // 10×3×9.6 — monumental. Largest fixed block in the library —
      // needs the most distance. Aim at the vertical center.
      camera!.position.set(13, 8, 18);
      camera!.lookAt(0, 4.8, 0);
      break;
    case 'stairs':
      // 2×4×4.8 — climbs along +Z (unified with archway's walk-through
      // direction). Step profile is now on the ±X face. Camera biased to
      // +X so that face is dominantly visible. Slight +Z lets the back
      // wall of the tallest step hint at depth. The thumbnail spins the
      // stairs 180° around Y so the rise direction reads naturally
      // (low step on the right, climbing toward the back-left).
      obj.rotation.y = Math.PI;
      camera!.position.set(10, 5, 9);
      camera!.lookAt(0, 2.4, 0);
      break;
    case 'gentlestairs':
      // 2×6×2.4 — longer but shallower than the regular staircase. Same
      // camera treatment, but pulled back a touch to fit the longer
      // 6-stud run and aimed lower since the total rise is only 2.4.
      obj.rotation.y = Math.PI;
      camera!.position.set(10, 3.5, 11);
      camera!.lookAt(0, 1.2, 0);
      break;
    case 'column':
      // 1×1×4.8 — tall thin pillar.
      camera!.position.set(7.5, 5, 7.5);
      camera!.lookAt(0, 2.4, 0);
      break;
    case 'tree':
      // 1×1×4.8 with foliage spreading ~0.9 unit radius.
      camera!.position.set(8, 4.8, 8);
      camera!.lookAt(0, 2.4, 0);
      break;
    case 'lamp':
      // 1×1×6.0 — the tallest block; needs the largest distance.
      camera!.position.set(9.5, 5.5, 9.5);
      camera!.lookAt(0, 3.0, 0);
      break;
    case 'ladder':
      // 2×1×7.2 — widened to 2 stud and raised to 18 plates so a minifig
      // can climb past the top rung. Pull camera back further to fit the
      // taller height.
      camera!.position.set(9, 6, 10);
      camera!.lookAt(0, 3.6, 0);
      break;
    case 'bridge':
      // 6×44×2.4 — wide road bridge. Rotate 45° around Y so the full
      // length packs diagonally into the square thumbnail, then pull the
      // camera further back to fit both the wider deck and the long span.
      obj.rotation.y = Math.PI / 4;
      camera!.position.set(24, 19, 28);
      camera!.lookAt(0, 1.2, 0);
      break;
    // ------------------------------------------------------------------
    //  Playground modules
    // ------------------------------------------------------------------
    case 'slide':
      // 4×16×7.2 — long gradual slide with 6-step staircase (exposed
      // at the back, 1 brick rise per step) and a 9-stud-long curved
      // ramp at ~38°. Side-on 3/4 view shows both the stairs and the
      // slide profile clearly.
      camera!.position.set(17, 10, 20);
      camera!.lookAt(0, 3.4, 0);
      break;
    case 'swing':
      // 12×3×9.6 — wide A-frame with 2 swings. Head-on view, pulled
      // back to fit the 12-stud width and the 9.6u height.
      camera!.position.set(0, 7, 26);
      camera!.lookAt(0, 4.8, 0);
      break;
    case 'seesaw':
      // 12×4×3.6 — long horizontal toy. 3/4 view from above shows the
      // tilted plank, axle stand, and both seats together.
      camera!.position.set(15, 9, 13);
      camera!.lookAt(0, 1.4, 0);
      break;
    case 'junglegym':
      // 6×6×9.6 — big cube-shaped climbing frame with a yellow climbing
      // wall, top platform, and flag. Pulled back to fit it all.
      camera!.position.set(15, 10, 16);
      camera!.lookAt(0, 4.8, 0);
      break;
    case 'merrygoround':
      // 16×16×12.8 — the biggest playground piece. Round platform,
      // tall central pole, hub crown, and 6 minifig-scale swing seats
      // hanging on hand-spaced chain pairs. Camera way back so the
      // 16-stud diameter and 12.8-tall pole + finial all fit in frame.
      camera!.position.set(34, 22, 34);
      camera!.lookAt(0, 5.0, 0);
      break;
    default:
      camera!.position.set(3.8, 3.2, 3.8);
      camera!.lookAt(0, 0.5, 0);
  }
  return render(obj);
}

export function renderMinifigPresetThumbnail(preset: MinifigPreset): string {
  setup();
  const fig = createMinifigure(preset);
  const h = getMinifigHeight() || 2.5;
  const dist = h * 1.6;
  camera!.position.set(dist, h * 1.25, dist * 1.05);
  camera!.lookAt(0, h * 0.55, 0);
  return render(fig);
}
