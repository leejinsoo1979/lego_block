import * as THREE from 'three';
import { createBrick, createMinifigure } from './blocks';
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
    camera!.position.set(7, 5.5, 7.5);
    camera!.lookAt(0, 2.2, 0);
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
    case 'plate':
    case 'tile':
      camera!.position.set(3.2, 2.8, 3.2);
      camera!.lookAt(0, 0.15, 0);
      break;
    case 'slope':
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
      camera!.position.set(0, 2.8, 7.5);
      camera!.lookAt(0, 1.7, 0);
      break;
    case 'fence':
      camera!.position.set(3.5, 2.0, 5.5);
      camera!.lookAt(0, 0.5, 0);
      break;
    case 'wheel':
      camera!.position.set(3.6, 2.4, 4.0);
      camera!.lookAt(0, 0.5, 0);
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
  camera!.position.set(7, 5.7, 7.6);
  camera!.lookAt(0, 2.3, 0);
  return render(fig);
}
