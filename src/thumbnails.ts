import * as THREE from 'three';
import { createBrick, createMinifigure, getMinifigHeight } from './blocks';
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

  // Pick a representative footprint
  const def = BLOCK_TYPES.find((t) => t.type === type);
  const w = def?.fixedSize?.w ?? 2;
  const d = def?.fixedSize?.d ?? 2;
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
      // 6×2×7.2 — now the tallest fixed block. Pull camera back so the
      // 6-wide footprint AND the 7.2-tall opening both fit comfortably.
      camera!.position.set(10, 6, 13);
      camera!.lookAt(0, 3.6, 0);
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
      // 1×1×4.8 — thin front-facing piece.
      camera!.position.set(7, 5, 7);
      camera!.lookAt(0, 2.4, 0);
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
