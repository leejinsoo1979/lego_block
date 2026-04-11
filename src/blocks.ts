import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { GRID, PLATE_HEIGHT, STUD_HEIGHT, STUD_RADIUS } from './config';
import type { BlockType, HatStyle, MinifigPreset } from './config';
import characterModelUrl from './model/people.glb?url';

export interface BlockSpec {
  w: number;
  d: number;
  colorHex: number;
  type?: BlockType;
}

const STUD_GEOMETRY = new THREE.CylinderGeometry(
  STUD_RADIUS,
  STUD_RADIUS,
  STUD_HEIGHT,
  20
);

function studMaterial(colorHex: number) {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.45,
    metalness: 0.05,
  });
}

function addStudGrid(
  group: THREE.Group,
  w: number,
  d: number,
  topY: number,
  material: THREE.Material
) {
  const width = w * GRID.X;
  const depth = d * GRID.Z;
  for (let sx = 0; sx < w; sx++) {
    for (let sz = 0; sz < d; sz++) {
      const stud = new THREE.Mesh(STUD_GEOMETRY, material);
      stud.position.set(
        -width / 2 + 0.5 + sx,
        topY + STUD_HEIGHT / 2,
        -depth / 2 + 0.5 + sz
      );
      stud.castShadow = true;
      group.add(stud);
    }
  }
}

/** Creates a brick/plate/tile/slope/etc. Origin is at the BOTTOM CENTER. */
export function createBrick(spec: BlockSpec): THREE.Group {
  const type: BlockType = spec.type ?? 'brick';
  let group: THREE.Group;
  switch (type) {
    case 'plate':
    case 'tile':
    case 'brick':
    case 'tallbrick':
    case 'wallpanel':
    case 'wallhigh':
    case 'walltower':
      group = createBoxBlock(spec, type);
      break;
    case 'slope':
      group = createSlopeBlock(spec);
      break;
    case 'arch':
      group = createArchBlock(spec);
      break;
    case 'round':
      group = createRoundBlock(spec);
      break;
    case 'cone':
      group = createConeBlock(spec);
      break;
    case 'window':
      group = createWindowBlock(spec);
      break;
    case 'door':
      group = createDoorBlock(spec);
      break;
    case 'fence':
      group = createFenceBlock(spec);
      break;
    case 'wheel':
      group = createWheelBlock(spec);
      break;
    case 'archway':
    case 'archmid':
    case 'archlarge':
      group = createArchwayBlock(spec);
      break;
    case 'stairs':
      group = createStairsBlock(spec);
      break;
    case 'gentlestairs':
      group = createGentleStairsBlock(spec);
      break;
    case 'column':
      group = createColumnBlock(spec);
      break;
    case 'tree':
      group = createTreeBlock(spec);
      break;
    case 'lamp':
      group = createLampBlock(spec);
      break;
    case 'ladder':
      group = createLadderBlock(spec);
      break;
    case 'bridge':
      group = createBridgeBlock(spec);
      break;
    case 'slide':
      group = createSlideBlock(spec);
      break;
    case 'swing':
      group = createSwingBlock(spec);
      break;
    case 'seesaw':
      group = createSeesawBlock(spec);
      break;
    case 'junglegym':
      group = createJungleGymBlock(spec);
      break;
    case 'merrygoround':
      group = createMerryGoRoundBlock(spec);
      break;
    default:
      group = createBoxBlock(spec, 'brick');
  }
  group.userData.isBrick = true;
  group.userData.spec = { ...spec, type };
  return group;
}

function createBoxBlock(
  spec: BlockSpec,
  type:
    | 'brick'
    | 'plate'
    | 'tile'
    | 'tallbrick'
    | 'wallpanel'
    | 'wallhigh'
    | 'walltower'
): THREE.Group {
  const group = new THREE.Group();
  const width = spec.w * GRID.X;
  const depth = spec.d * GRID.Z;

  // Body height in plates, keyed off the block type. Keep this in sync with
  // bodyHeightPlates in config.ts (game.ts's collision math reads from the
  // same source of truth).
  let plates: number;
  switch (type) {
    case 'plate':
    case 'tile':
      plates = 1;
      break;
    case 'tallbrick':
      plates = 6;
      break;
    case 'wallpanel':
      plates = 9;
      break;
    case 'wallhigh':
      plates = 15; // matches door height
      break;
    case 'walltower':
      plates = 18; // matches archway height
      break;
    case 'brick':
    default:
      plates = 3;
  }
  const bodyHeight = plates * PLATE_HEIGHT;
  const showStuds = type !== 'tile';

  const material = studMaterial(spec.colorHex);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, bodyHeight, depth),
    material
  );
  body.position.y = bodyHeight / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  if (showStuds) addStudGrid(group, spec.w, spec.d, bodyHeight, material);
  return group;
}

// ------------------------------------------------------------------
//  Slope (wedge) — rises along the longer footprint axis
// ------------------------------------------------------------------
function createSlopeBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const h = 3 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  // Real Lego slope shape: the slope occupies just ONE stud at the LOW end
  // of the long axis; the remaining (run - 1) studs form a flat top with
  // studs on it. For 1×1 / 1×d there is no flat portion — pure wedge.
  //
  // Construction: build a 2D side profile in the XY plane and extrude it
  // along Z by `cross`. If d > w we rotate the geometry 90° around Y so
  // the slope rise ends up running along Z instead of X.
  const useX = w >= d;
  const run = useX ? w : d;
  const cross = useX ? d : w;

  const shape = new THREE.Shape();
  if (run === 1) {
    // Pure wedge: triangle (0,0) → (1,h) → (1,0)
    shape.moveTo(0, 0);
    shape.lineTo(1, h);
    shape.lineTo(1, 0);
    shape.closePath();
  } else {
    // Wedge + flat top: (0,0) → (1,h) → (run,h) → (run,0)
    shape.moveTo(0, 0);
    shape.lineTo(1, h);
    shape.lineTo(run, h);
    shape.lineTo(run, 0);
    shape.closePath();
  }

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: cross,
    bevelEnabled: false,
  });
  // Center on origin (extrude starts at (0, 0, 0)).
  geom.translate(-run / 2, 0, -cross / 2);
  // After centering: slope's low edge at -X, flat top's far edge at +X.
  // For !useX, rotate +90° around Y. With rotateY(+π/2), original -X
  // becomes +Z, so the slope's low edge ends up at +Z and the flat top
  // ends up at -Z.
  if (!useX) geom.rotateY(Math.PI / 2);
  geom.computeVertexNormals();

  const wedge = new THREE.Mesh(geom, material);
  wedge.castShadow = true;
  wedge.receiveShadow = true;
  group.add(wedge);

  // Studs on the flat top portion only (skip pure-wedge case).
  if (run >= 2) {
    if (useX) {
      // Flat top spans x = [-w/2 + 1, +w/2] (i.e., w-1 stud cells), full d in z.
      for (let ix = 0; ix < w - 1; ix++) {
        for (let iz = 0; iz < d; iz++) {
          const stud = new THREE.Mesh(STUD_GEOMETRY, material);
          stud.position.set(
            -w / 2 + 1 + 0.5 + ix,
            h + STUD_HEIGHT / 2,
            -d / 2 + 0.5 + iz
          );
          stud.castShadow = true;
          group.add(stud);
        }
      }
    } else {
      // After rotation the slope is at +Z and the flat is at -Z, spanning
      // z = [-d/2, +d/2 - 1] (d-1 stud cells), full w in x.
      for (let ix = 0; ix < w; ix++) {
        for (let iz = 0; iz < d - 1; iz++) {
          const stud = new THREE.Mesh(STUD_GEOMETRY, material);
          stud.position.set(
            -w / 2 + 0.5 + ix,
            h + STUD_HEIGHT / 2,
            -d / 2 + 0.5 + iz
          );
          stud.castShadow = true;
          group.add(stud);
        }
      }
    }
  }

  return group;
}

// ------------------------------------------------------------------
//  Arch — two vertical legs + horizontal beam (inverted U)
// ------------------------------------------------------------------
function createArchBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const h = 3 * PLATE_HEIGHT;
  const beamH = PLATE_HEIGHT;
  const legH = h - beamH;
  const legW = 1;
  const material = studMaterial(spec.colorHex);

  const width = w * GRID.X;
  const depth = d * GRID.Z;

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(width, beamH, depth),
    material
  );
  beam.position.y = legH + beamH / 2;
  beam.castShadow = true;
  beam.receiveShadow = true;
  group.add(beam);

  const useX = w >= d;
  if (useX) {
    const leftLeg = new THREE.Mesh(
      new THREE.BoxGeometry(legW * GRID.X, legH, depth),
      material
    );
    leftLeg.position.set(-width / 2 + (legW * GRID.X) / 2, legH / 2, 0);
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(
      new THREE.BoxGeometry(legW * GRID.X, legH, depth),
      material
    );
    rightLeg.position.set(width / 2 - (legW * GRID.X) / 2, legH / 2, 0);
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;
    group.add(rightLeg);
  } else {
    const frontLeg = new THREE.Mesh(
      new THREE.BoxGeometry(width, legH, legW * GRID.Z),
      material
    );
    frontLeg.position.set(0, legH / 2, -depth / 2 + (legW * GRID.Z) / 2);
    frontLeg.castShadow = true;
    frontLeg.receiveShadow = true;
    group.add(frontLeg);

    const backLeg = new THREE.Mesh(
      new THREE.BoxGeometry(width, legH, legW * GRID.Z),
      material
    );
    backLeg.position.set(0, legH / 2, depth / 2 - (legW * GRID.Z) / 2);
    backLeg.castShadow = true;
    backLeg.receiveShadow = true;
    group.add(backLeg);
  }

  addStudGrid(group, w, d, h, material);
  return group;
}

// ------------------------------------------------------------------
//  Round — 1x1 cylindrical brick
// ------------------------------------------------------------------
function createRoundBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const h = 3 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, h, 24),
    material
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  addStudGrid(group, spec.w, spec.d, h, material);
  return group;
}

// ------------------------------------------------------------------
//  Cone — 1x1 cone
// ------------------------------------------------------------------
function createConeBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const h = 3 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, PLATE_HEIGHT, 24),
    material
  );
  base.position.y = PLATE_HEIGHT / 2;
  base.castShadow = true;
  group.add(base);

  const taper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.48, h - PLATE_HEIGHT, 24),
    material
  );
  taper.position.y = PLATE_HEIGHT + (h - PLATE_HEIGHT) / 2;
  taper.castShadow = true;
  group.add(taper);

  const stud = new THREE.Mesh(STUD_GEOMETRY, material);
  stud.position.set(0, h + STUD_HEIGHT / 2, 0);
  stud.castShadow = true;
  group.add(stud);
  return group;
}

// ------------------------------------------------------------------
//  Window — 2-brick tall frame with translucent pane
// ------------------------------------------------------------------
function createWindowBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const h = 6 * PLATE_HEIGHT;
  const frameMat = studMaterial(spec.colorHex);
  const paneMat = new THREE.MeshStandardMaterial({
    color: 0xa6d4f0,
    roughness: 0.15,
    metalness: 0.05,
    transparent: true,
    opacity: 0.45,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const t = 0.18;
  // Sill is a full plate-height slab so it fully encloses the baseplate
  // studs (otherwise the studs poke through the thin frame at the bottom).
  const sillH = PLATE_HEIGHT;

  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(width, sillH, depth),
    frameMat
  );
  sill.position.y = sillH / 2;
  sill.castShadow = true;
  sill.receiveShadow = true;
  group.add(sill);

  const header = new THREE.Mesh(
    new THREE.BoxGeometry(width, t, depth),
    frameMat
  );
  header.position.y = h - t / 2;
  header.castShadow = true;
  group.add(header);

  // Vertical span available for jambs + pane (between sill top and header bottom)
  const innerH = h - sillH - t;
  const innerCenterY = sillH + innerH / 2;

  const useX = w >= d;
  if (useX) {
    const jambL = new THREE.Mesh(
      new THREE.BoxGeometry(t, innerH, depth),
      frameMat
    );
    jambL.position.set(-width / 2 + t / 2, innerCenterY, 0);
    group.add(jambL);

    const jambR = new THREE.Mesh(
      new THREE.BoxGeometry(t, innerH, depth),
      frameMat
    );
    jambR.position.set(width / 2 - t / 2, innerCenterY, 0);
    group.add(jambR);

    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(width - 2 * t, innerH, 0.04),
      paneMat
    );
    pane.position.y = innerCenterY;
    group.add(pane);
  } else {
    const jambF = new THREE.Mesh(
      new THREE.BoxGeometry(width, innerH, t),
      frameMat
    );
    jambF.position.set(0, innerCenterY, -depth / 2 + t / 2);
    group.add(jambF);

    const jambB = new THREE.Mesh(
      new THREE.BoxGeometry(width, innerH, t),
      frameMat
    );
    jambB.position.set(0, innerCenterY, depth / 2 - t / 2);
    group.add(jambB);

    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, innerH, depth - 2 * t),
      paneMat
    );
    pane.position.y = innerCenterY;
    group.add(pane);
  }

  addStudGrid(group, w, d, h, frameMat);
  return group;
}

// ------------------------------------------------------------------
//  Door — 3-brick tall frame with a swinging slab
// ------------------------------------------------------------------
function createDoorBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  // 15 plates (5 bricks, 6.0 units) — tall enough for a minifig to walk
  // through. Keep in sync with bodyHeightPlates in config.ts.
  const h = 15 * PLATE_HEIGHT;
  const frameMat = studMaterial(spec.colorHex);
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.6,
  });
  const knobMat = new THREE.MeshStandardMaterial({
    color: 0xf5cd30,
    roughness: 0.3,
    metalness: 0.6,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const t = 0.18;
  // Sill is a full plate-height threshold so it fully encloses the
  // baseplate studs (otherwise they poke through the slab/frame bottom).
  const sillH = PLATE_HEIGHT;

  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(width, sillH, depth),
    frameMat
  );
  sill.position.y = sillH / 2;
  sill.castShadow = true;
  sill.receiveShadow = true;
  group.add(sill);

  const header = new THREE.Mesh(
    new THREE.BoxGeometry(width, t, depth),
    frameMat
  );
  header.position.y = h - t / 2;
  header.castShadow = true;
  group.add(header);

  // Vertical span for jambs and slab (between sill top and header bottom)
  const innerH = h - sillH - t;
  const innerCenterY = sillH + innerH / 2;

  const useX = w >= d;
  if (useX) {
    const jambL = new THREE.Mesh(
      new THREE.BoxGeometry(t, innerH, depth),
      frameMat
    );
    jambL.position.set(-width / 2 + t / 2, innerCenterY, 0);
    group.add(jambL);

    const jambR = new THREE.Mesh(
      new THREE.BoxGeometry(t, innerH, depth),
      frameMat
    );
    jambR.position.set(width / 2 - t / 2, innerCenterY, 0);
    group.add(jambR);

    // --- Hinge group (slab + knob pivot around the LEFT jamb inner edge).
    // Play-mode door-open animation rotates this group around Y. Hinge is
    // tagged with userData.isDoorHinge so game.ts can find and animate it.
    const hingeGroup = new THREE.Group();
    hingeGroup.position.set(-width / 2 + t, innerCenterY, 0);
    hingeGroup.userData.isDoorHinge = true;

    const slabW = width - 2 * t - 0.02;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(slabW, innerH - 0.02, 0.08),
      slabMat
    );
    // In hinge-local: slab center is slabW/2 + 0.01 along +X from the hinge
    // pivot, so that in world space (with hinge at -w/2+t) the slab's
    // closed position is centered at x = 0.
    slab.position.set(slabW / 2 + 0.01, 0, 0);
    slab.castShadow = true;
    hingeGroup.add(slab);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      knobMat
    );
    // Knob sits near the slab's +X end (far from the hinge) and slightly
    // +Z (visible front face). World x = width/2 - t - 0.18 — subtract the
    // hinge world-x (-width/2 + t) to get hinge-local x.
    knob.position.set(width - 2 * t - 0.18, 0, 0.08);
    hingeGroup.add(knob);

    group.add(hingeGroup);
  } else {
    const jambF = new THREE.Mesh(
      new THREE.BoxGeometry(width, innerH, t),
      frameMat
    );
    jambF.position.set(0, innerCenterY, -depth / 2 + t / 2);
    group.add(jambF);

    const jambB = new THREE.Mesh(
      new THREE.BoxGeometry(width, innerH, t),
      frameMat
    );
    jambB.position.set(0, innerCenterY, depth / 2 - t / 2);
    group.add(jambB);

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, innerH - 0.02, depth - 2 * t - 0.02),
      slabMat
    );
    slab.position.set(0, innerCenterY, 0);
    slab.castShadow = true;
    group.add(slab);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      knobMat
    );
    knob.position.set(0.08, innerCenterY, depth / 2 - t - 0.18);
    group.add(knob);
  }

  addStudGrid(group, w, d, h, frameMat);
  return group;
}

// ------------------------------------------------------------------
//  Fence — picket fence
// ------------------------------------------------------------------
function createFenceBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const h = 3 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  // Full plate-height base so the bottom slab fully encloses the
  // baseplate's studs (otherwise the studs poke through / z-fight).
  const baseH = PLATE_HEIGHT;

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, baseH, depth),
    material
  );
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const useX = w >= d;
  const railThk = 0.1;
  if (useX) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(width, railThk, railThk),
      material
    );
    rail.position.set(0, h - railThk * 1.5, 0);
    rail.castShadow = true;
    group.add(rail);

    const pickets = Math.max(2, w + 1);
    const pad = 0.08;
    for (let i = 0; i < pickets; i++) {
      const px = -width / 2 + pad + ((width - 2 * pad) * i) / (pickets - 1);
      const pk = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, h - baseH, 0.12),
        material
      );
      pk.position.set(px, baseH + (h - baseH) / 2, 0);
      pk.castShadow = true;
      group.add(pk);
    }
  } else {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(railThk, railThk, depth),
      material
    );
    rail.position.set(0, h - railThk * 1.5, 0);
    rail.castShadow = true;
    group.add(rail);

    const pickets = Math.max(2, d + 1);
    const pad = 0.08;
    for (let i = 0; i < pickets; i++) {
      const pz = -depth / 2 + pad + ((depth - 2 * pad) * i) / (pickets - 1);
      const pk = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, h - baseH, 0.12),
        material
      );
      pk.position.set(0, baseH + (h - baseH) / 2, pz);
      pk.castShadow = true;
      group.add(pk);
    }
  }

  return group;
}

// ------------------------------------------------------------------
//  Wheel — 2x2 axle base with two black tires
// ------------------------------------------------------------------
function createWheelBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const h = 3 * PLATE_HEIGHT;
  const baseMat = studMaterial(spec.colorHex);
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x121417,
    roughness: 0.85,
  });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0xc8ccd0,
    roughness: 0.4,
    metalness: 0.4,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;

  const useX = w >= d;
  const baseW = useX ? width * 0.6 : width;
  const baseD = useX ? depth : depth * 0.6;

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(baseW, h, baseD),
    baseMat
  );
  base.position.set(0, h / 2, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const tireR = h * 0.55;
  const tireT = 0.45;
  const tireGeom = new THREE.CylinderGeometry(tireR, tireR, tireT, 24);
  const hubGeom = new THREE.CylinderGeometry(
    tireR * 0.5,
    tireR * 0.5,
    tireT + 0.02,
    18
  );

  const placeTire = (x: number, z: number, axis: 'x' | 'z') => {
    const tire = new THREE.Mesh(tireGeom, tireMat);
    tire.position.set(x, tireR, z);
    if (axis === 'x') tire.rotation.z = Math.PI / 2;
    else tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;
    group.add(tire);

    const hub = new THREE.Mesh(hubGeom, hubMat);
    hub.position.set(x, tireR, z);
    if (axis === 'x') hub.rotation.z = Math.PI / 2;
    else hub.rotation.x = Math.PI / 2;
    group.add(hub);
  };

  if (useX) {
    placeTire(-width / 2 + tireT / 2 + 0.02, 0, 'x');
    placeTire(width / 2 - tireT / 2 - 0.02, 0, 'x');
  } else {
    placeTire(0, -depth / 2 + tireT / 2 + 0.02, 'z');
    placeTire(0, depth / 2 - tireT / 2 - 0.02, 'z');
  }

  // Studs across the full top
  addStudGrid(group, w, d, h, baseMat);

  return group;
}

// ------------------------------------------------------------------
//  Archway — tall entrance with a curved (semicircular) opening
// ------------------------------------------------------------------
function createArchwayBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  // Height varies per archway type — keep in sync with bodyHeightPlates
  // in config.ts. Default 'archway' = 18 plates; 'archmid' = 21; 'archlarge'
  // = 24 (the latter two are wider and need taller crowns to keep their
  // proportions sensible).
  let plates: number;
  switch (spec.type) {
    case 'archmid':
      plates = 21;
      break;
    case 'archlarge':
      plates = 24;
      break;
    case 'archway':
    default:
      plates = 18;
  }
  const h = plates * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const legThk = 1 * GRID.X; // 1 stud wide legs on each side
  const openingWidth = width - 2 * legThk;

  if (openingWidth <= 0.01) {
    // Degenerate: fall back to a solid tall block
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, h, depth),
      material
    );
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    addStudGrid(group, w, d, h, material);
    return group;
  }

  // Leave 1 brick of material above the arch crown so the top doesn't
  // look paper-thin. The arch itself is a full semicircle of radius
  // `archRadius`; `springY` is where it meets the vertical jambs.
  const topMargin = 3 * PLATE_HEIGHT; // 1 brick = 1.2
  const archRadius = Math.min(openingWidth / 2, h - topMargin - 0.4);
  const springY = Math.max(0.4, h - topMargin - archRadius);

  // Trace the archway outline in the XY plane, then extrude along Z.
  // Start at bottom-left outer, go around the outer rectangle, then dive
  // into the opening from the bottom, up the right jamb, around the
  // semicircular arch to the left jamb, and back down.
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(-width / 2, h);
  shape.lineTo(width / 2, h);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2 - legThk, 0);
  shape.lineTo(width / 2 - legThk, springY);
  // CCW arc from (w/2 - legThk, springY) to (-w/2 + legThk, springY),
  // passing through (0, springY + archRadius).
  shape.absarc(0, springY, archRadius, 0, Math.PI, false);
  shape.lineTo(-width / 2 + legThk, 0);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: depth,
    bevelEnabled: false,
  });
  geom.translate(0, 0, -depth / 2);
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  addStudGrid(group, w, d, h, material);
  return group;
}

// ------------------------------------------------------------------
//  Stairs — one step per stud along +Z (climbing direction matches the
//  archway's walk-through direction, so both blocks "face forward" the
//  same way when placed).
// ------------------------------------------------------------------
/**
 * Shared stair builder — each step is 1 stud deep along Z, full width
 * along X, and `stepRise` tall. Lowest step is at -Z (front), highest
 * step is at +Z (back).
 *
 * `stepRise` controls the steepness:
 *   - `3 * PLATE_HEIGHT` (1 brick) → the default steep Lego staircase
 *   - `PLATE_HEIGHT`     (1 plate) → a gentle ramp-like staircase
 */
function createStairsBlockShared(
  spec: BlockSpec,
  stepRise: number
): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const material = studMaterial(spec.colorHex);

  const width = w * GRID.X;
  const depth = d * GRID.Z;

  for (let i = 0; i < d; i++) {
    const stepH = (i + 1) * stepRise;
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(width, stepH, 1 * GRID.Z),
      material
    );
    step.position.set(0, stepH / 2, -depth / 2 + 0.5 + i);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);

    // Stud row on this step's top (w studs across x)
    for (let ix = 0; ix < w; ix++) {
      const stud = new THREE.Mesh(STUD_GEOMETRY, material);
      stud.position.set(
        -width / 2 + 0.5 + ix,
        stepH + 0.1,
        -depth / 2 + 0.5 + i
      );
      stud.castShadow = true;
      group.add(stud);
    }
  }

  return group;
}

/** Steep Lego staircase — each step is 1 brick (3 plates) tall. */
function createStairsBlock(spec: BlockSpec): THREE.Group {
  return createStairsBlockShared(spec, 3 * PLATE_HEIGHT);
}

/** Gentle staircase — each step is only 1 plate tall, producing a
 *  low-rise ramp-like ascent over a longer footprint. */
function createGentleStairsBlock(spec: BlockSpec): THREE.Group {
  return createStairsBlockShared(spec, PLATE_HEIGHT);
}

// ------------------------------------------------------------------
//  Column — Doric-style round pillar (base + shaft + capital)
// ------------------------------------------------------------------
function createColumnBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const h = 12 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  const baseH = PLATE_HEIGHT;
  const capH = PLATE_HEIGHT;
  const shaftH = h - baseH - capH;

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, baseH, 20),
    material
  );
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, shaftH, 20),
    material
  );
  shaft.position.y = baseH + shaftH / 2;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, capH, 20),
    material
  );
  cap.position.y = baseH + shaftH + capH / 2;
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);

  addStudGrid(group, 1, 1, h, material);
  return group;
}

// ------------------------------------------------------------------
//  Tree — brown trunk + 3-layer stacked pine foliage
// ------------------------------------------------------------------
function createTreeBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  // Trees have fixed natural colors (brown trunk, green foliage). The
  // user's color pick is intentionally ignored — the UI also disables
  // the color panel for this block type.
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.85,
  });
  const leavesMat = new THREE.MeshStandardMaterial({
    color: 0x3d7a3d,
    roughness: 0.7,
  });

  // Trunk tapers from a WIDE base up to a narrower top. The bottom radius
  // must be wider than a stud (0.3) — otherwise the tree can't sit on top
  // of a brick/baseplate because the stud underneath would intersect the
  // trunk body with nothing to enclose it. 0.48 fills the 1×1 footprint.
  const trunkH = 2.4;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.48, trunkH, 14),
    trunkMat
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const cone1H = 1.6;
  const cone1 = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, cone1H, 14),
    leavesMat
  );
  cone1.position.y = trunkH + cone1H / 2 - 0.2;
  cone1.castShadow = true;
  group.add(cone1);

  const cone2H = 1.2;
  const cone2 = new THREE.Mesh(
    new THREE.ConeGeometry(0.72, cone2H, 14),
    leavesMat
  );
  cone2.position.y = trunkH + cone1H + cone2H / 2 - 0.55;
  cone2.castShadow = true;
  group.add(cone2);

  const cone3H = 0.9;
  const cone3 = new THREE.Mesh(
    new THREE.ConeGeometry(0.52, cone3H, 14),
    leavesMat
  );
  cone3.position.y = trunkH + cone1H + cone2H + cone3H / 2 - 0.85;
  cone3.castShadow = true;
  group.add(cone3);

  // No studs — trees aren't stackable surfaces
  return group;
}

// ------------------------------------------------------------------
//  Lamp post — thin column with an emissive bulb at the top
// ------------------------------------------------------------------
function createLampBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const h = 15 * PLATE_HEIGHT; // 5 bricks tall (6.0)
  // Fixed dark metallic post — the yellow emissive bulb is the defining
  // feature and needs a contrasting neutral post. UI disables the color
  // panel for this block type.
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d35,
    roughness: 0.4,
    metalness: 0.35,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff4a6,
    roughness: 0.2,
    emissive: 0xfff4a6,
    emissiveIntensity: 0.75,
  });

  const baseH = PLATE_HEIGHT;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.44, baseH, 16),
    postMat
  );
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const postH = h - baseH - 0.6;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, postH, 12),
    postMat
  );
  post.position.y = baseH + postH / 2;
  post.castShadow = true;
  group.add(post);

  const topY = baseH + postH;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.14, 0.12, 12),
    postMat
  );
  cap.position.y = topY + 0.06;
  cap.castShadow = true;
  group.add(cap);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    bulbMat
  );
  bulb.position.y = topY + 0.12 + 0.28;
  group.add(bulb);

  return group;
}

// ------------------------------------------------------------------
//  Ladder — two vertical rails connected by 5 rungs
// ------------------------------------------------------------------
function createLadderBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  // 18 plates (= 7.2 units) — taller than the minifig's ~4.8u so the
  // climber actually has rungs above their head. Keep in sync with
  // bodyHeightPlates in config.ts.
  const h = 18 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  const width = spec.w * GRID.X;
  // Rails sit just inside the footprint edges so a 2-stud-wide ladder
  // visually fills its full footprint and reads at minifig scale.
  const railW = 0.14;
  const railX = width / 2 - railW;

  const leftRail = new THREE.Mesh(
    new THREE.BoxGeometry(railW, h, railW),
    material
  );
  leftRail.position.set(-railX, h / 2, 0);
  leftRail.castShadow = true;
  leftRail.receiveShadow = true;
  group.add(leftRail);

  const rightRail = new THREE.Mesh(
    new THREE.BoxGeometry(railW, h, railW),
    material
  );
  rightRail.position.set(railX, h / 2, 0);
  rightRail.castShadow = true;
  rightRail.receiveShadow = true;
  group.add(rightRail);

  // Rung count scales with height so spacing stays roughly constant
  // (~1 unit between rungs).
  const numRungs = Math.max(2, Math.round(h));
  const rungW = railX * 2;
  const topY = h - 0.35;
  const botY = 0.35;
  for (let i = 0; i < numRungs; i++) {
    const rung = new THREE.Mesh(
      new THREE.BoxGeometry(rungW, 0.1, 0.13),
      material
    );
    const t = i / (numRungs - 1);
    rung.position.set(0, botY + t * (topY - botY), 0);
    rung.castShadow = true;
    group.add(rung);
  }

  return group;
}

// ------------------------------------------------------------------
//  Slide — playground slide. Two solid side panels with a complex
//  outline (back wall + railings + slide curve) define the silhouette.
//  Stair boxes, platform tile, back wall and a curved slide deck fill
//  the structure. Yellow slide for color contrast against the user's
//  frame color.
// ------------------------------------------------------------------
function createSlideBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 4
  const d = spec.d; // 9
  const h = 24 * PLATE_HEIGHT; // 9.6 units (~2× minifig)
  const frameMat = studMaterial(spec.colorHex);
  const slideMat = new THREE.MeshStandardMaterial({
    color: 0xf5cd30, // bright yellow slide
    roughness: 0.35,
    metalness: 0.15,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const panelT = 0.22; // side panel thickness

  // Layout zones along Z:
  //   stairs   : -d/2 .. -d/2+4   (4 stud, 4 steps)
  //   platform : -d/2+4 .. -d/2+5 (1 stud)
  //   slide    : -d/2+5 .. d/2    (4 stud)
  const numSteps = 4;
  const stairsRunZ = 4;
  const platformDepth = 1;
  const stepRise = h / numSteps; // 2.4u per step (~half minifig)
  const z0 = -d / 2;
  const z1 = z0 + stairsRunZ; // front of stairs
  const z2 = z1 + platformDepth; // front of platform = start of slide
  const z3 = d / 2; // front edge of slide

  // ----- Slide curve points (smoothstep eased descent) -----
  const slideExitY = 0.4;
  const segments = 22;
  const curvePts: { z: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const eased = t * t * (3 - 2 * t);
    curvePts.push({
      z: z2 + (z3 - z2) * t,
      y: h + (slideExitY - h) * eased,
    });
  }

  // ----- Side panels (one on -X, one on +X) -----
  // Outline (CCW) traces: back-bottom → up the back wall → over the
  // platform railing → down to platform deck → along the slide curve
  // → down to the front exit → back to the back-bottom.
  const railingExtra = 0.7; // railing height above platform deck
  const panelShape = new THREE.Shape();
  panelShape.moveTo(z0, 0); // back-bottom
  panelShape.lineTo(z0, h + railingExtra); // back-top of railing
  panelShape.lineTo(z2, h + railingExtra); // top of railing, going forward
  panelShape.lineTo(z2, h); // step down to platform deck
  // Slide curve top edge (from platform front down to slide exit)
  for (let i = 1; i < curvePts.length; i++) {
    panelShape.lineTo(curvePts[i].z, curvePts[i].y);
  }
  panelShape.lineTo(z3, 0); // down to front-bottom
  panelShape.closePath();

  const panelGeom = new THREE.ExtrudeGeometry(panelShape, {
    depth: panelT,
    bevelEnabled: false,
  });
  panelGeom.translate(0, 0, -panelT / 2);
  panelGeom.rotateY(-Math.PI / 2);
  panelGeom.computeVertexNormals();
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(panelGeom.clone(), frameMat);
    panel.position.x = sx * (width / 2 - panelT / 2);
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);
  }

  // ----- 4 stair boxes (between the side panels) -----
  const innerW = width - 2 * panelT - 0.04;
  for (let i = 0; i < numSteps; i++) {
    const stepTopY = (i + 1) * stepRise;
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(innerW, stepTopY, GRID.Z),
      frameMat
    );
    step.position.set(0, stepTopY / 2, z0 + 0.5 + i);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }

  // ----- Platform tile (flat slab at top, between the panels) -----
  const platformT = 0.3;
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(innerW, platformT, platformDepth * GRID.Z),
    frameMat
  );
  platform.position.set(0, h - platformT / 2, (z1 + z2) / 2);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // ----- Back wall (closes off the back of the platform area) -----
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(innerW, h + railingExtra, panelT),
    frameMat
  );
  backWall.position.set(0, (h + railingExtra) / 2, z0 + panelT / 2);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  group.add(backWall);

  // ----- Curved slide deck (yellow), extruded along world X (width) -----
  const slabT = 0.22;
  const slideW = innerW;
  const slideShape = new THREE.Shape();
  slideShape.moveTo(curvePts[0].z, curvePts[0].y);
  for (let i = 1; i < curvePts.length; i++) {
    slideShape.lineTo(curvePts[i].z, curvePts[i].y);
  }
  for (let i = curvePts.length - 1; i >= 0; i--) {
    slideShape.lineTo(curvePts[i].z, curvePts[i].y - slabT);
  }
  slideShape.closePath();

  const slideGeom = new THREE.ExtrudeGeometry(slideShape, {
    depth: slideW,
    bevelEnabled: false,
  });
  slideGeom.translate(0, 0, -slideW / 2);
  slideGeom.rotateY(-Math.PI / 2);
  slideGeom.computeVertexNormals();
  const slideMesh = new THREE.Mesh(slideGeom, slideMat);
  slideMesh.castShadow = true;
  slideMesh.receiveShadow = true;
  group.add(slideMesh);

  return group;
}

// ------------------------------------------------------------------
//  Swing — proper A-frame swing set. Two SOLID triangular side panels
//  on each X end (extruded along Z), connected by a top beam, with
//  three swings hanging underneath on twin chains.
// ------------------------------------------------------------------
function createSwingBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 8
  const d = spec.d; // 3
  const h = 24 * PLATE_HEIGHT; // 9.6 units (~2× minifig)
  const frameMat = studMaterial(spec.colorHex);
  const chainMat = new THREE.MeshStandardMaterial({
    color: 0x4a4d52,
    roughness: 0.45,
    metalness: 0.65,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0xc4281c, // bright red seats
    roughness: 0.5,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const panelT = 0.28; // side panel thickness

  // ----- Two solid triangular side panels (one at each X end) -----
  // Triangle in shape XY where shape-X = world Z, shape-Y = world Y.
  // Vertices: front-bottom (z=-d/2), back-bottom (z=+d/2), apex (z=0, y=h).
  // After extrude+rotate the panel sits in the YZ plane at world X = ±X edge.
  const triShape = new THREE.Shape();
  triShape.moveTo(-d / 2, 0);
  triShape.lineTo(d / 2, 0);
  triShape.lineTo(0, h);
  triShape.closePath();
  const triGeom = new THREE.ExtrudeGeometry(triShape, {
    depth: panelT,
    bevelEnabled: false,
  });
  triGeom.translate(0, 0, -panelT / 2);
  triGeom.rotateY(-Math.PI / 2);
  triGeom.computeVertexNormals();
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(triGeom.clone(), frameMat);
    panel.position.x = sx * (width / 2 - panelT / 2);
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);
  }

  // ----- Top horizontal beam (connects the two triangle apexes) -----
  // The apex of each triangle is at (±(width/2 - panelT/2), h, 0). The
  // beam runs along X between the two apexes.
  const apexY = h - 0.14;
  const beamLen = width - panelT - 0.04;
  const topBeam = new THREE.Mesh(
    new THREE.BoxGeometry(beamLen, 0.32, 0.32),
    frameMat
  );
  topBeam.position.set(0, apexY, 0);
  topBeam.castShadow = true;
  group.add(topBeam);

  // ----- Three hanging swings — twin chains + seat + backrest each -----
  const chainLen = h * 0.62;
  const seatY = apexY - chainLen;
  // Spread along X. Avoid the very ends near the side panels.
  const usableW = beamLen - 1.6;
  const seatXs = [
    -usableW / 2 + usableW * 0.0,
    -usableW / 2 + usableW * 0.5,
    -usableW / 2 + usableW * 1.0,
  ];
  const chainCz = depth / 2 - 0.55; // chain z-offsets (front + back)
  const seatW = 1.1;
  const seatD = chainCz * 2 + 0.3;

  for (const sx of seatXs) {
    // Twin chains (front + back of seat)
    for (const cz of [-chainCz, chainCz]) {
      const chain = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, chainLen, 0.08),
        chainMat
      );
      chain.position.set(sx, apexY - chainLen / 2 - 0.16, cz);
      chain.castShadow = true;
      group.add(chain);
    }

    // Seat with backrest + side arms
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(seatW, 0.16, seatD),
      seatMat
    );
    seat.position.set(sx, seatY - 0.08, 0);
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    const backrest = new THREE.Mesh(
      new THREE.BoxGeometry(seatW, 0.75, 0.12),
      seatMat
    );
    backrest.position.set(sx, seatY + 0.3, seatD / 2 - 0.06);
    backrest.castShadow = true;
    group.add(backrest);
  }

  return group;
}

// ------------------------------------------------------------------
//  Seesaw — curved fulcrum + tilted plank with seat pads and handles
//  on each end. The whole "plank assembly" is a single child group so
//  the rotation cleanly tilts the plank, seats, and handles together.
// ------------------------------------------------------------------
function createSeesawBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 10
  const d = spec.d; // 3
  const material = studMaterial(spec.colorHex);
  const plankMat = new THREE.MeshStandardMaterial({
    color: 0xc4281c,
    roughness: 0.5,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x0d69ac,
    roughness: 0.5,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;

  // ----- Curved fulcrum: half-cylinder lying on its side -----
  // CylinderGeometry with thetaStart=0, thetaLength=π builds a half
  // cylinder bulging in the +Z direction (default Y-axis up). Rotating
  // by -π/2 around X re-orients the half-cylinder so its central axis
  // runs along world Z (the seesaw's depth direction), the flat cut
  // surface lies in the y=0 plane (sits on the ground), and the curved
  // bulge points straight up along +Y.
  const fulcrumR = 0.95;
  const fulcrumLen = depth - 0.4;
  const fulcrumGeom = new THREE.CylinderGeometry(
    fulcrumR,
    fulcrumR,
    fulcrumLen,
    24,
    1,
    false,
    0,
    Math.PI
  );
  fulcrumGeom.rotateX(-Math.PI / 2);
  fulcrumGeom.computeVertexNormals();
  const fulcrum = new THREE.Mesh(fulcrumGeom, material);
  fulcrum.position.set(0, 0, 0);
  fulcrum.castShadow = true;
  fulcrum.receiveShadow = true;
  group.add(fulcrum);

  // Two base supports under the fulcrum to anchor it visually.
  for (const sz of [-1, 1]) {
    const support = new THREE.Mesh(
      new THREE.BoxGeometry(fulcrumR * 1.7, 0.22, 0.4),
      material
    );
    support.position.set(0, 0.11, sz * (fulcrumLen / 2 - 0.15));
    support.castShadow = true;
    support.receiveShadow = true;
    group.add(support);
  }

  // ----- Plank assembly (sub-group that rotates as a unit) -----
  const plankGroup = new THREE.Group();
  const plankY = fulcrumR;
  plankGroup.position.set(0, plankY, 0);
  plankGroup.rotation.z = -0.14;
  group.add(plankGroup);

  // Long plank
  const plankLen = width - 0.5;
  const plankD = 1.3;
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(plankLen, 0.28, plankD),
    plankMat
  );
  plank.position.y = 0.14;
  plank.castShadow = true;
  plank.receiveShadow = true;
  plankGroup.add(plank);

  // Seat pads + handles at each end of the plank (sized for a minifig
  // who's 2 stud wide × 1 stud deep — pad needs to actually fit them).
  for (const sx of [-1, 1]) {
    const endX = sx * (plankLen / 2 - 0.7);

    // Seat pad
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.12, 1.0),
      seatMat
    );
    pad.position.set(endX, 0.34, 0);
    pad.castShadow = true;
    plankGroup.add(pad);

    // Vertical handle post
    const handlePost = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 1.0, 0.14),
      material
    );
    handlePost.position.set(endX, 0.9, 0);
    handlePost.castShadow = true;
    plankGroup.add(handlePost);

    // Horizontal grip bar at the top of the post
    const handleGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.7),
      material
    );
    handleGrip.position.set(endX, 1.34, 0);
    handleGrip.castShadow = true;
    plankGroup.add(handleGrip);
  }

  return group;
}

// ------------------------------------------------------------------
//  Jungle gym — 4 corner posts, 6 levels of climbing rungs on every
//  side, a flat top platform with raised guard rails, and diagonal
//  cross-bracing on two sides.
// ------------------------------------------------------------------
function createJungleGymBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 5
  const d = spec.d; // 5
  // 24 plates (= 9.6 units) tall — 2× minifig so they can climb up
  // multiple levels and reach the platform. Keep in sync with
  // bodyHeightPlates in config.ts.
  const h = 24 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const postT = 0.28;
  const barT = 0.16;

  // ----- 4 vertical corner posts -----
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(postT, h, postT),
        material
      );
      post.position.set(
        sx * (width / 2 - postT / 2),
        h / 2,
        sz * (depth / 2 - postT / 2)
      );
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);
    }
  }

  // ----- Horizontal climbing rungs at 8 evenly-spaced levels.
  // The top level coincides with the platform top. With 9.6u of height
  // 8 rungs gives ~1.2u (1 brick) spacing — proper minifig climb step. -----
  const levels: number[] = [];
  const numLevels = 8;
  for (let i = 1; i <= numLevels; i++) {
    levels.push((h * i) / numLevels - 0.08);
  }

  for (const y of levels) {
    // -X side bar (along Z)
    const barXL = new THREE.Mesh(
      new THREE.BoxGeometry(barT, barT, depth - postT),
      material
    );
    barXL.position.set(-width / 2 + postT / 2, y, 0);
    barXL.castShadow = true;
    group.add(barXL);
    // +X side
    const barXR = new THREE.Mesh(
      new THREE.BoxGeometry(barT, barT, depth - postT),
      material
    );
    barXR.position.set(width / 2 - postT / 2, y, 0);
    barXR.castShadow = true;
    group.add(barXR);
    // -Z side bar (along X)
    const barZL = new THREE.Mesh(
      new THREE.BoxGeometry(width - postT, barT, barT),
      material
    );
    barZL.position.set(0, y, -depth / 2 + postT / 2);
    barZL.castShadow = true;
    group.add(barZL);
    // +Z side
    const barZR = new THREE.Mesh(
      new THREE.BoxGeometry(width - postT, barT, barT),
      material
    );
    barZR.position.set(0, y, depth / 2 - postT / 2);
    barZR.castShadow = true;
    group.add(barZR);
  }

  // ----- Top platform: a thin flat slab spanning the full footprint -----
  const platformT = 0.18;
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(width - postT, platformT, depth - postT),
    material
  );
  platform.position.set(0, h - platformT / 2, 0);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // ----- Diagonal cross-bracing on the -X and +X sides for visual
  // structure. Two diagonals per side forming an X pattern. The brace
  // box has its length along local +Z; rotating around X by -braceAngle
  // tilts that local +Z to point along (0, +sin(braceAngle), +cos(braceAngle))
  // = (+Y, +Z) — the diagonal that goes from low-Z low-Y to high-Z
  // high-Y. The OTHER diagonal is built by additionally rotating the
  // brace 180° around Y, which negates its Z direction.
  const braceLen = Math.sqrt(
    (depth - postT) * (depth - postT) + h * h
  );
  const braceAngle = Math.atan2(h, depth - postT);
  for (const sx of [-1, 1]) {
    const braceX = sx * (width / 2 - postT - 0.04);
    // Diagonal 1: from (-Z, y=0) to (+Z, y=h)
    const brace1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, braceLen),
      material
    );
    brace1.position.set(braceX, h / 2, 0);
    brace1.rotation.x = -braceAngle;
    brace1.castShadow = true;
    group.add(brace1);
    // Diagonal 2: from (+Z, y=0) to (-Z, y=h). Three.js applies Euler
    // rotations as Rx*Ry*Rz to a vector, so rotation.y=π fires first
    // (flipping the box's local +Z to -Z), and then rotation.x=+braceAngle
    // tilts that flipped Z up to (0, +sin α, -cos α) — the desired
    // diagonal direction.
    const brace2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, braceLen),
      material
    );
    brace2.position.set(braceX, h / 2, 0);
    brace2.rotation.x = braceAngle;
    brace2.rotation.y = Math.PI;
    brace2.castShadow = true;
    group.add(brace2);
  }

  return group;
}

// ------------------------------------------------------------------
//  Merry-go-round — round disc base, central pole, 4 radial handles
// ------------------------------------------------------------------
function createMerryGoRoundBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 6
  const d = spec.d; // 6
  // 9 plates (= 3.6 units) tall — about chest height on a minifig.
  // Big enough for 4 minifigs to ride around the rim. Keep in sync
  // with bodyHeightPlates in config.ts.
  const h = 9 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0xf5cd30, // yellow seats
    roughness: 0.5,
  });

  const radius = Math.min(w, d) * 0.5 - 0.1;

  // Round disc base — flat cylinder
  const baseH = 0.3;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, baseH, 24),
    material
  );
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Inner support disc (slightly raised)
  const support = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.85, radius * 0.95, 0.12, 24),
    material
  );
  support.position.y = baseH + 0.06;
  support.castShadow = true;
  group.add(support);

  // Central vertical pole
  const poleH = h - baseH;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, poleH, 16),
    material
  );
  pole.position.y = baseH + poleH / 2;
  pole.castShadow = true;
  group.add(pole);

  // Top cap on the pole
  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 14, 10),
    material
  );
  topCap.position.y = baseH + poleH;
  group.add(topCap);

  // 4 radial handle bars going from the pole top out to the rim
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Horizontal handle bar (from center to rim)
    const handleLen = radius - 0.2;
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, handleLen),
      material
    );
    handle.position.set(
      cosA * (handleLen / 2 + 0.1),
      h - 0.25,
      sinA * (handleLen / 2 + 0.1)
    );
    handle.rotation.y = -angle;
    handle.castShadow = true;
    group.add(handle);

    // Vertical drop from handle end to disc rim
    const drop = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, h - baseH - 0.5, 0.08),
      material
    );
    drop.position.set(
      cosA * (radius - 0.15),
      baseH + (h - baseH - 0.5) / 2,
      sinA * (radius - 0.15)
    );
    drop.castShadow = true;
    group.add(drop);

    // Small seat block on the disc at this rim position
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.5),
      seatMat
    );
    seat.position.set(
      cosA * (radius - 0.45),
      baseH + 0.21,
      sinA * (radius - 0.45)
    );
    seat.rotation.y = -angle;
    seat.castShadow = true;
    group.add(seat);
  }

  return group;
}

// ------------------------------------------------------------------
//  Bridge — long plank walkway with railings, designed to span a gap
//  between two separated baseplate tiles. Fixed size 2 × 44 studs.
// ------------------------------------------------------------------
function createBridgeBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const material = studMaterial(spec.colorHex);

  const width = w * GRID.X;
  const depth = d * GRID.Z;

  // --- Deck (flat plank walkway) ---
  const deckH = PLATE_HEIGHT;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(width, deckH, depth),
    material
  );
  deck.position.y = deckH / 2;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // --- Chunky corner pillars at all four corners ---
  const cornerThk = 0.45;
  const cornerH = 2.0; // taller than the railing posts so they read as posts
  const cornerGeom = new THREE.BoxGeometry(cornerThk, cornerH, cornerThk);
  const cornerX = width / 2 - cornerThk / 2;
  const cornerZ = depth / 2 - cornerThk / 2;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const pillar = new THREE.Mesh(cornerGeom, material);
      pillar.position.set(sx * cornerX, deckH + cornerH / 2, sz * cornerZ);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
    }
  }

  // --- Railing posts at regular intervals along both long sides ---
  const postThk = 0.18;
  const postH = 1.6;
  const postGeom = new THREE.BoxGeometry(postThk, postH, postThk);
  const postSpacing = 4; // one post every 4 studs
  // Start one spacing in from the corners so the first post isn't jammed
  // against a corner pillar.
  const postStartZ = -depth / 2 + 1 + postSpacing / 2;
  const innerPostZEnd = depth / 2 - 1 - postSpacing / 2;
  for (let z = postStartZ; z <= innerPostZEnd + 1e-4; z += postSpacing) {
    for (const sx of [-1, 1] as const) {
      const post = new THREE.Mesh(postGeom, material);
      post.position.set(
        sx * (width / 2 - postThk / 2),
        deckH + postH / 2,
        z
      );
      post.castShadow = true;
      group.add(post);
    }
  }

  // --- Top rails + mid rails running the full length on both sides ---
  const railThk = 0.16;
  const railH = 0.12;
  // Length runs between the inside edges of the corner pillars
  const railLength = depth - cornerThk * 2 - 0.02;
  const railGeom = new THREE.BoxGeometry(railThk, railH, railLength);
  const topRailY = deckH + postH - railH / 2;
  const midRailY = deckH + postH / 2;
  for (const sx of [-1, 1] as const) {
    const top = new THREE.Mesh(railGeom, material);
    top.position.set(sx * (width / 2 - railThk / 2), topRailY, 0);
    top.castShadow = true;
    group.add(top);

    const mid = new THREE.Mesh(railGeom, material);
    mid.position.set(sx * (width / 2 - railThk / 2), midRailY, 0);
    mid.castShadow = true;
    group.add(mid);
  }

  return group;
}

// ------------------------------------------------------------------
//  Hat factories
// ------------------------------------------------------------------

function createHat(style: HatStyle, color: number): THREE.Group | null {
  if (style === 'none') return null;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

  switch (style) {
    case 'cap': {
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.5, 0.28, 20),
        mat
      );
      crown.position.y = 0.14;
      crown.castShadow = true;
      group.add(crown);

      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.05, 0.22),
        mat
      );
      visor.position.set(0, 0.03, 0.4);
      visor.castShadow = true;
      group.add(visor);
      break;
    }
    case 'fireman': {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.52, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
        mat
      );
      dome.position.y = 0.05;
      dome.castShadow = true;
      group.add(dome);

      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.72, 0.72, 0.06, 24),
        mat
      );
      brim.position.y = 0.04;
      brim.castShadow = true;
      group.add(brim);

      const crest = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.42, 0.1),
        mat
      );
      crest.position.set(0, 0.3, -0.08);
      crest.rotation.x = -0.15;
      crest.castShadow = true;
      group.add(crest);
      break;
    }
    case 'astronaut': {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 24, 20),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.35,
          metalness: 0.1,
        })
      );
      bubble.position.y = 0.1;
      bubble.castShadow = true;
      group.add(bubble);

      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, 0.3, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x1a1a30,
          roughness: 0.2,
          metalness: 0.7,
        })
      );
      visor.position.set(0, 0.1, 0.56);
      group.add(visor);
      break;
    }
    case 'wizard': {
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.78, 0.78, 0.06, 24),
        mat
      );
      brim.position.y = 0.03;
      brim.castShadow = true;
      group.add(brim);

      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.35, 24),
        mat
      );
      cone.position.y = 0.7;
      cone.rotation.x = 0.12;
      cone.castShadow = true;
      group.add(cone);

      // Star decoration
      const star = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.05, 5),
        new THREE.MeshStandardMaterial({
          color: 0xf5cd30,
          roughness: 0.3,
          metalness: 0.6,
        })
      );
      star.position.set(0, 0.9, 0.45);
      star.rotation.x = Math.PI / 2;
      group.add(star);
      break;
    }
    case 'crown': {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.44, 0.44, 0.15, 20),
        mat
      );
      base.position.y = 0.075;
      base.castShadow = true;
      group.add(base);

      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.08, 0.24, 8),
          mat
        );
        spike.position.set(
          Math.cos(angle) * 0.4,
          0.27,
          Math.sin(angle) * 0.4
        );
        group.add(spike);
      }
      break;
    }
    case 'pirate': {
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.74, 0.74, 0.06, 24),
        mat
      );
      brim.scale.z = 0.55;
      brim.position.y = 0.03;
      brim.castShadow = true;
      group.add(brim);

      const top = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, 0.32, 0.32),
        mat
      );
      top.position.y = 0.2;
      top.castShadow = true;
      group.add(top);

      // Skull
      const skull = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0xf2f3f3,
          roughness: 0.5,
        })
      );
      skull.position.set(0, 0.2, 0.17);
      group.add(skull);
      break;
    }
  }
  return group;
}

// ------------------------------------------------------------------
//  Minifigure
// ------------------------------------------------------------------

// ------------------------------------------------------------------
//  Character GLB loader
// ------------------------------------------------------------------

/**
 * Cached clone-source for the character GLB. The model is loaded EXACTLY
 * as authored in Blender — no nodes are removed and no procedural meshes
 * are bolted on. The loader only sets a non-uniform scale + position so
 * the character is the right physical size in our world.
 */
let characterTemplate: THREE.Group | null = null;
/** Top Y of the loaded character (after scale + recenter), in world units. */
let characterTopY = 0;

/** Target distance between the two FOOT CENTERS, in world units. One stud
 *  pitch = 1 unit, so setting this to 1.0 puts each foot center exactly
 *  on a stud center for the 2-stud-wide minifig footprint. The character
 *  total height comes out at whatever the GLB's authored aspect ratio
 *  yields — uniform scale, no distortion. */
const TARGET_FOOT_SPACING = 1.0;
/** Fallback height if the GLB doesn't have two recognizable foot meshes. */
const FALLBACK_HEIGHT = 4.8;
/** Manual forward (positive Z) shift applied to the centered character.
 *  Historically used to compensate when the XZ centering fell back to the
 *  full-body bbox (sole anchors couldn't be found). Now that sole anchors
 *  work correctly the natural shift is ~0, but leaving a small forward
 *  nudge because the bottom-slice bbox center of the bezier foot is
 *  slightly behind the visible foot tip. Positive = forward, negative = back. */
const MINIFIG_FORWARD_OFFSET = 0.08;

/** Compute the TIGHT world AABB of every mesh under `obj` by transforming
 *  each vertex through the mesh's matrixWorld (precise=true). The default
 *  (precise=false) variant of setFromObject only transforms the local
 *  geometry.boundingBox, which becomes a LOOSE AABB after rotation —
 *  for the GLB's bezier-curve legs (95° rotation), the loose box pokes
 *  way below the visible geometry, which is why earlier shifts left the
 *  character floating. The precise version doesn't have that problem. */
function fullBoundingBox(obj: THREE.Object3D): THREE.Box3 {
  const result = new THREE.Box3();
  result.makeEmpty();
  const tmp = new THREE.Box3();
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    tmp.setFromObject(m, true);
    result.union(tmp);
  });
  return result;
}

/** Names of the foot/leg meshes in the GLB. Drives XZ centering.
 *  three.js's GLTFLoader sanitizes node names via PropertyBinding —
 *  the `[].:/ ` chars are stripped — so the GLB's `BezierCurve.001`
 *  becomes `BezierCurve001` after loading. Use the post-sanitization
 *  names here to match what's actually on the loaded mesh. */
const FOOT_NAMES = new Set(['BezierCurve', 'BezierCurve001']);

/** Compute the (x, y, z) anchor of a leg/foot mesh's SOLE — the GEOMETRIC
 *  CENTER (bbox midpoint) of all vertices in the bottom slice of the mesh.
 *
 *  We use the bbox center, NOT the vertex AVERAGE, because curved
 *  bezier-extruded legs have non-uniform vertex density: tessellation may
 *  put more vertices around bends or in the heel/toe area, and a raw
 *  average gets pulled away from the visual center of the sole. The bbox
 *  of the slice captures the actual heel↔toe / left↔right extent of the
 *  sole's footprint, and its midpoint is what we want to align with a
 *  stud center. */
function footSoleAnchor(
  mesh: THREE.Mesh,
  sliceThickness = 0.06
): { x: number; y: number; z: number } | null {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const pos = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!pos) return null;
  mesh.updateMatrixWorld(true);
  const v = new THREE.Vector3();

  // Pass 1: find the lowest Y across all vertices in world space.
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.applyMatrix4(mesh.matrixWorld);
    if (v.y < minY) minY = v.y;
  }
  if (!Number.isFinite(minY)) return null;

  // Pass 2: bbox of the vertices in the bottom slice.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let count = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.applyMatrix4(mesh.matrixWorld);
    if (v.y - minY <= sliceThickness) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
      count++;
    }
  }
  if (count === 0) return null;
  return {
    x: (minX + maxX) / 2,
    y: minY,
    z: (minZ + maxZ) / 2,
  };
}

/**
 * Loads `src/model/people.glb` once and prepares it for cloning:
 *   - shadows on every mesh
 *   - UNIFORM scale so the visible body height = CHARACTER_HEIGHT
 *     (aspect ratio preserved — no distortion)
 *   - position shifted so the lowest point is at y=0 and the figure is
 *     centered on X/Z. The shift is verified by re-computing the bbox
 *     and applying corrective passes until min.y converges to 0.
 * Nothing is removed and nothing is added.
 */
export function loadCharacterModel(): Promise<void> {
  if (characterTemplate) return Promise.resolve();
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      characterModelUrl,
      (gltf) => {
        const root = gltf.scene;

        root.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });

        // List every mesh by name + its TIGHT world bounds. Helps debug
        // what the GLB actually contains and where each part lives.
        root.updateMatrixWorld(true);
        const tmp = new THREE.Box3();
        const meshList: Array<{ name: string; lo: number[]; hi: number[] }> = [];
        root.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh) return;
          tmp.setFromObject(m, true);
          meshList.push({
            name: m.name || '(unnamed)',
            lo: [+tmp.min.x.toFixed(3), +tmp.min.y.toFixed(3), +tmp.min.z.toFixed(3)],
            hi: [+tmp.max.x.toFixed(3), +tmp.max.y.toFixed(3), +tmp.max.z.toFixed(3)],
          });
        });
        console.log('[GLB] meshes (sorted by min Y):',
          meshList.sort((a, b) => a.lo[1] - b.lo[1]));

        // ----- Find the two foot meshes -----
        const footMeshes: THREE.Mesh[] = [];
        root.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh && FOOT_NAMES.has(m.name)) footMeshes.push(m);
        });

        // ----- Uniform scale from FOOT SOLE spacing (not bbox center) -----
        // Sample only the bottom slice of each leg mesh — the actual sole
        // tip — and scale so the X distance between the two soles equals
        // TARGET_FOOT_SPACING (= 1 stud). Bbox center would be the average
        // of the curved leg path, which is NOT where the foot is.
        let scale = 1;
        if (footMeshes.length === 2) {
          const a1 = footSoleAnchor(footMeshes[0]);
          const a2 = footSoleAnchor(footMeshes[1]);
          if (a1 && a2) {
            const spacing = Math.abs(a1.x - a2.x);
            if (spacing > 0) scale = TARGET_FOOT_SPACING / spacing;
            console.log('[GLB] foot SOLE anchors at scale 1:',
                        '#0=', a1, '#1=', a2,
                        'spacing=', spacing, '→ scale=', scale);
          }
        } else {
          // Fallback: scale by body height if foot meshes weren't found
          const beforeBox = fullBoundingBox(root);
          const bodyHeight = beforeBox.max.y - beforeBox.min.y;
          if (bodyHeight > 0) scale = FALLBACK_HEIGHT / bodyHeight;
          console.log('[GLB] foot meshes not found, falling back to height-based scale:', scale);
        }

        root.scale.setScalar(scale);
        root.updateMatrixWorld(true);

        const afterScale = fullBoundingBox(root);
        console.log('[GLB] after-scale bbox (full body):', afterScale.min, afterScale.max);

        // ----- XZ centering using FOOT SOLE anchors after scaling -----
        // Recompute the soles in scaled world space and use their midpoint.
        // This puts the two sole anchors at exactly (±0.5, _, 0) — i.e.
        // each foot directly over a stud center for the 2-stud minifig
        // footprint. Y still uses the full body's lowest visible point.
        let pivotX = 0;
        let pivotZ = 0;
        if (footMeshes.length === 2) {
          const a1s = footSoleAnchor(footMeshes[0]);
          const a2s = footSoleAnchor(footMeshes[1]);
          if (a1s && a2s) {
            pivotX = (a1s.x + a2s.x) / 2;
            pivotZ = (a1s.z + a2s.z) / 2;
            console.log('[GLB] post-scale sole anchors:', '#0=', a1s, '#1=', a2s,
                        'pivot=(', pivotX, ',', pivotZ, ')');
          }
        } else {
          const fb = fullBoundingBox(root);
          pivotX = (fb.min.x + fb.max.x) / 2;
          pivotZ = (fb.min.z + fb.max.z) / 2;
        }

        // Apply manual forward offset on Z so the visual foot center
        // (not the bbox center) lines up with the stud center from a side
        // view. The bbox of the curved bezier sole sits a hair behind
        // the visual foot, so we nudge the whole character forward.
        root.position.set(
          -pivotX,
          -afterScale.min.y,
          -pivotZ + MINIFIG_FORWARD_OFFSET
        );
        root.updateMatrixWorld(true);

        // Verify-and-correct: keep applying Y corrections until the
        // bbox bottom converges to 0. Catches any drift in setFromObject.
        for (let pass = 0; pass < 6; pass++) {
          const box = fullBoundingBox(root);
          if (Math.abs(box.min.y) < 0.001) break;
          console.log(`[GLB] correction pass ${pass}: min.y=`, box.min.y);
          root.position.y -= box.min.y;
          root.updateMatrixWorld(true);
        }

        const finalBox = fullBoundingBox(root);
        console.log('[GLB] final bbox:', finalBox.min, finalBox.max);
        characterTopY = finalBox.max.y;
        characterTemplate = root;
        resolve();
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/** Total minifig height in world units. Available after loadCharacterModel
 *  resolves. Used by Game for collision/eye height. Returns 0 before the
 *  GLB has finished loading. */
export function getMinifigHeight(): number {
  return characterTopY;
}

/**
 * Creates a Lego minifigure by cloning the loaded GLB scene unchanged.
 * Origin at BOTTOM CENTER (feet stand at y=0). Faces +Z.
 * Footprint: 2 studs wide × 1 stud deep (placement only — the visual
 * model may be wider; that's expected for a minifig with arms/hat).
 *
 * `loadCharacterModel()` MUST be awaited before this is called.
 */
export function createMinifigure(preset: MinifigPreset): THREE.Group {
  if (!characterTemplate) {
    throw new Error(
      'character model not loaded; call loadCharacterModel() and await it before createMinifigure()'
    );
  }

  const group = new THREE.Group();

  // Deep clone the GLB scene + per-instance material clones, so each
  // minifig can be recolored independently.
  const body = characterTemplate.clone(true);
  body.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    if (Array.isArray(m.material)) {
      m.material = m.material.map((mat) => mat.clone());
    } else {
      m.material = (m.material as THREE.Material).clone();
    }
  });

  // Recolor by Blender-exported node name. GLB hierarchy verified by
  // dumping the glTF JSON:
  //   Cube.001     (y=4.17, topmost)  → HEAD (skin-colored cube on top)
  //   Cylinder     (y=3.62)           → neck/skin piece under the head
  //   Cube         (y=2.73)           → torso
  //   Cube.002     (y=3.10, x=+0.90)  → right arm
  //     └ Cylinder.002                → right HAND (child of arm)
  //   Cube.004     (y=3.10, x=-0.90)  → left arm
  //     └ Cylinder.003                → left HAND (child of arm)
  //   Cube.003     (y=1.82)           → belt/hip
  //   Cylinder.001 (y=1.52)           → hip connector
  //   BezierCurve / BezierCurve.001   → legs
  //   everything else                 → shirt (torso, arms)
  //
  // All head/hand meshes use `skinHex` (yellow by default). GLTFLoader may
  // leave dots in names or strip them depending on version, so we normalize.
  const legs: THREE.Mesh[] = [];
  let headMesh: THREE.Mesh | null = null;
  const skinHex = preset.headHex ?? 0xf5cd30;
  const norm = (name: string) => name.replace(/\./g, '');
  body.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat.color) return;
    const n = norm(m.name);
    if (n === 'Cube001') {
      // HEAD — always skin-colored (yellow by default)
      mat.color.setHex(skinHex);
      headMesh = m;
    } else if (n === 'Cylinder') {
      // Neck / head connector — also skin
      mat.color.setHex(skinHex);
    } else if (n === 'Cylinder002' || n === 'Cylinder003') {
      // Hands — skin color
      mat.color.setHex(skinHex);
    } else if (n === 'BezierCurve' || n === 'BezierCurve001') {
      // Legs — pants color
      mat.color.setHex(preset.pantsHex);
      legs.push(m);
    } else {
      // Torso, arms, belt, etc. — shirt color
      mat.color.setHex(preset.shirtHex);
    }
  });

  group.add(body);

  // Project the character's face onto the head mesh as a decal. Each
  // preset gets a distinct expression. The decal MUST be added to `group`
  // (not headMesh) because DecalGeometry returns vertices in WORLD space at
  // creation time — at this point `group` is still at the origin, so
  // group-local == world. Re-parenting to headMesh would apply headMesh's
  // matrix a second time and throw the decal off into space.
  if (headMesh) {
    const faceMesh = createCharacterFace(preset, headMesh);
    if (faceMesh) group.add(faceMesh);
  }

  // ----- Rig the limbs for walking animation -----
  // The GLB exports each limb as a mesh (or two — upper + hand) with its
  // origin somewhere in the middle of the geometry. To make a limb swing
  // from the hip/shoulder instead of "kicking out" from its center, we wrap
  // each limb in a pivot Group placed at its top edge and re-parent the
  // mesh(es) into the pivot via attach() (which preserves world transform).
  body.updateMatrixWorld(true);

  const findMesh = (name: string): THREE.Mesh | null => {
    let found: THREE.Mesh | null = null;
    body.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!found && m.isMesh && norm(m.name) === name) found = m;
    });
    return found;
  };

  const rigLimb = (limbs: (THREE.Mesh | null)[]): THREE.Group | null => {
    const valid = limbs.filter((m): m is THREE.Mesh => m !== null);
    if (valid.length === 0) return null;
    // Combined world AABB across all sub-meshes
    const bbox = new THREE.Box3();
    for (const m of valid) bbox.expandByObject(m);
    const hipWorld = new THREE.Vector3(
      (bbox.min.x + bbox.max.x) / 2,
      bbox.max.y, // top of limb = hip / shoulder
      (bbox.min.z + bbox.max.z) / 2
    );
    const pivot = new THREE.Group();
    // Convert the world position into body's local space so the pivot
    // inherits body's scale/orientation correctly.
    pivot.position.copy(body.worldToLocal(hipWorld.clone()));
    body.add(pivot);
    for (const m of valid) {
      pivot.attach(m);
    }
    return pivot;
  };

  const rightLeg = rigLimb([findMesh('BezierCurve')]);
  const leftLeg = rigLimb([findMesh('BezierCurve001')]);
  const rightArm = rigLimb([findMesh('Cube002'), findMesh('Cylinder002')]);
  const leftArm = rigLimb([findMesh('Cube004'), findMesh('Cylinder003')]);

  group.userData.isBrick = true;
  group.userData.isMinifig = true;
  // Expose pivot references for walk animation in play mode.
  group.userData.parts = {
    legs,
    rightLeg,
    leftLeg,
    rightArm,
    leftArm,
  };
  return group;
}

/**
 * Projects the character's face onto the head mesh as a true decal, so it
 * conforms to the actual surface curvature (a cube, a rounded cube, a
 * cylinder — whatever the GLB's head mesh happens to be) instead of
 * floating as a flat plane in front of it.
 *
 * Implementation: three.js's `DecalGeometry` takes the target mesh plus
 * a projection box (position / orientation / size) and returns a new
 * geometry whose vertices sit ON the target mesh's surface, clipped to
 * the box. The resulting vertices are already in the target mesh's
 * LOCAL space, so we can simply parent the decal to `headMesh`.
 */
function createCharacterFace(
  preset: MinifigPreset,
  headMesh: THREE.Mesh
): THREE.Mesh | null {
  // DecalGeometry needs up-to-date world matrices on the target mesh so
  // it can invert them back to local space. Force-update the whole chain.
  headMesh.updateWorldMatrix(true, false);

  // World-space bounding box of the head at its current (pre-placement)
  // transform — this tells us where to aim the decal projector.
  const worldBox = new THREE.Box3().setFromObject(headMesh);
  if (worldBox.isEmpty()) return null;
  const worldSize = new THREE.Vector3();
  const worldCenter = new THREE.Vector3();
  worldBox.getSize(worldSize);
  worldBox.getCenter(worldCenter);

  // Canvas face texture
  const canvas = drawCharacterFace(preset, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    toneMapped: false, // keep the black lines pure, not washed out by ACES
    // polygonOffset still helps even with DecalGeometry — some GPUs/angles
    // can still z-fight between the decal and the original surface.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  // Decal projection box:
  //   - position: slightly in front of the head's front (+Z) face, so the
  //     projector starts outside the mesh and shoots back through it.
  //   - orientation: identity → projects along +Z.
  //   - size: covers ~90% of the head's width/height, and is deep enough
  //     (1.4x head depth) to fully punch through the mesh so every facing
  //     triangle gets captured.
  const projectorPos = new THREE.Vector3(
    worldCenter.x,
    worldCenter.y,
    worldBox.max.z + worldSize.z * 0.1
  );
  const projectorRot = new THREE.Euler(0, 0, 0);
  const projectorSize = new THREE.Vector3(
    worldSize.x * 0.9,
    worldSize.y * 0.9,
    worldSize.z * 1.4
  );

  let decalGeom: THREE.BufferGeometry;
  try {
    decalGeom = new DecalGeometry(
      headMesh,
      projectorPos,
      projectorRot,
      projectorSize
    );
  } catch (e) {
    console.error('[face] DecalGeometry failed:', e);
    return null;
  }

  // DecalGeometry can legitimately return an empty geometry if the
  // projection box misses every front-facing triangle — guard against it.
  if (
    !decalGeom.attributes.position ||
    decalGeom.attributes.position.count === 0
  ) {
    decalGeom.dispose();
    return null;
  }

  const decal = new THREE.Mesh(decalGeom, mat);
  decal.renderOrder = 5;
  decal.userData.isFace = true;
  return decal;
}

/**
 * Draws a character-specific face onto a transparent canvas. The canvas is
 * consumed by createCharacterFace() as a THREE.CanvasTexture.
 */
function drawCharacterFace(
  preset: MinifigPreset,
  size: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const eyeY = size * 0.44;
  const eyeOffset = size * 0.17;

  const dot = (x: number, y: number, r: number, color = '#000') => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const stroke = (fn: () => void, color = '#000', w = size * 0.025) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    fn();
    ctx.stroke();
  };
  const eyes = (r = size * 0.05) => {
    dot(cx - eyeOffset, eyeY, r);
    dot(cx + eyeOffset, eyeY, r);
  };
  const eyeShine = () => {
    dot(cx - eyeOffset + size * 0.015, eyeY - size * 0.015, size * 0.015, '#fff');
    dot(cx + eyeOffset + size * 0.015, eyeY - size * 0.015, size * 0.015, '#fff');
  };

  switch (preset.id) {
    case 'classic': {
      // Friendly default: round eyes + simple smile
      eyes(size * 0.048);
      stroke(() => {
        ctx.arc(cx, size * 0.56, size * 0.14, 0.1 * Math.PI, 0.9 * Math.PI);
      });
      break;
    }
    case 'police': {
      // Serious: bushy eyebrows, square eyes, thin mustache
      stroke(() => {
        // eyebrows
        ctx.moveTo(cx - eyeOffset - size * 0.07, eyeY - size * 0.1);
        ctx.lineTo(cx - eyeOffset + size * 0.07, eyeY - size * 0.07);
        ctx.moveTo(cx + eyeOffset - size * 0.07, eyeY - size * 0.07);
        ctx.lineTo(cx + eyeOffset + size * 0.07, eyeY - size * 0.1);
      }, '#000', size * 0.035);
      eyes(size * 0.045);
      // mustache
      ctx.fillStyle = '#3b2415';
      ctx.beginPath();
      ctx.ellipse(cx, size * 0.62, size * 0.16, size * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
      // closed straight mouth under mustache
      stroke(() => {
        ctx.moveTo(cx - size * 0.07, size * 0.69);
        ctx.lineTo(cx + size * 0.07, size * 0.69);
      }, '#000', size * 0.022);
      break;
    }
    case 'firefighter': {
      // Determined: furrowed brow, focused eyes, straight mouth
      stroke(() => {
        ctx.moveTo(cx - eyeOffset - size * 0.08, eyeY - size * 0.12);
        ctx.lineTo(cx - eyeOffset + size * 0.05, eyeY - size * 0.06);
        ctx.moveTo(cx + eyeOffset + size * 0.08, eyeY - size * 0.12);
        ctx.lineTo(cx + eyeOffset - size * 0.05, eyeY - size * 0.06);
      }, '#000', size * 0.032);
      eyes(size * 0.05);
      stroke(() => {
        ctx.moveTo(cx - size * 0.09, size * 0.62);
        ctx.lineTo(cx + size * 0.09, size * 0.62);
      }, '#000', size * 0.028);
      break;
    }
    case 'astronaut': {
      // Wide-eyed excited: big eyes with shine, big smile
      eyes(size * 0.062);
      eyeShine();
      stroke(() => {
        ctx.arc(cx, size * 0.55, size * 0.16, 0.1 * Math.PI, 0.9 * Math.PI);
      }, '#000', size * 0.03);
      break;
    }
    case 'ninja': {
      // Masked: thin angry white slits on a dark head
      ctx.fillStyle = '#f5f6f8';
      // left slit
      ctx.save();
      ctx.translate(cx - eyeOffset, eyeY);
      ctx.rotate(0.18);
      ctx.fillRect(-size * 0.07, -size * 0.015, size * 0.14, size * 0.03);
      ctx.restore();
      // right slit
      ctx.save();
      ctx.translate(cx + eyeOffset, eyeY);
      ctx.rotate(-0.18);
      ctx.fillRect(-size * 0.07, -size * 0.015, size * 0.14, size * 0.03);
      ctx.restore();
      break;
    }
    case 'wizard': {
      // Old wise: bushy white brows, squinty eyes, white beard
      stroke(() => {
        ctx.moveTo(cx - eyeOffset - size * 0.1, eyeY - size * 0.08);
        ctx.quadraticCurveTo(
          cx - eyeOffset,
          eyeY - size * 0.14,
          cx - eyeOffset + size * 0.08,
          eyeY - size * 0.08
        );
        ctx.moveTo(cx + eyeOffset - size * 0.08, eyeY - size * 0.08);
        ctx.quadraticCurveTo(
          cx + eyeOffset,
          eyeY - size * 0.14,
          cx + eyeOffset + size * 0.1,
          eyeY - size * 0.08
        );
      }, '#f5f5f5', size * 0.05);
      // small eye dots
      eyes(size * 0.035);
      // white beard shape
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.22, size * 0.6);
      ctx.quadraticCurveTo(cx, size * 0.92, cx + size * 0.22, size * 0.6);
      ctx.quadraticCurveTo(cx, size * 0.72, cx - size * 0.22, size * 0.6);
      ctx.fill();
      // mouth hint inside beard
      stroke(() => {
        ctx.moveTo(cx - size * 0.04, size * 0.65);
        ctx.lineTo(cx + size * 0.04, size * 0.65);
      }, '#3a3a3a', size * 0.015);
      break;
    }
    case 'princess': {
      // Cute: blush circles, sparkly eyes, small smile
      ctx.fillStyle = 'rgba(255, 110, 140, 0.55)';
      ctx.beginPath();
      ctx.arc(cx - size * 0.3, size * 0.58, size * 0.07, 0, Math.PI * 2);
      ctx.arc(cx + size * 0.3, size * 0.58, size * 0.07, 0, Math.PI * 2);
      ctx.fill();
      eyes(size * 0.055);
      eyeShine();
      // little lashes
      stroke(() => {
        ctx.moveTo(cx - eyeOffset - size * 0.07, eyeY - size * 0.03);
        ctx.lineTo(cx - eyeOffset - size * 0.1, eyeY - size * 0.07);
        ctx.moveTo(cx + eyeOffset + size * 0.07, eyeY - size * 0.03);
        ctx.lineTo(cx + eyeOffset + size * 0.1, eyeY - size * 0.07);
      }, '#000', size * 0.018);
      // small pink smile
      stroke(() => {
        ctx.arc(cx, size * 0.6, size * 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
      }, '#c83868', size * 0.025);
      break;
    }
    case 'pirate': {
      // Eyepatch on the left eye, grinning with a gold tooth
      // strap behind
      stroke(() => {
        ctx.moveTo(cx - size * 0.42, eyeY - size * 0.2);
        ctx.lineTo(cx - eyeOffset + size * 0.08, eyeY + size * 0.1);
        ctx.moveTo(cx - size * 0.42, eyeY + size * 0.18);
        ctx.lineTo(cx - eyeOffset + size * 0.08, eyeY - size * 0.08);
      }, '#1a1a1a', size * 0.018);
      // patch
      ctx.fillStyle = '#151518';
      ctx.beginPath();
      ctx.ellipse(
        cx - eyeOffset,
        eyeY,
        size * 0.1,
        size * 0.09,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      // right eye visible
      dot(cx + eyeOffset, eyeY, size * 0.055);
      // eyebrow over right eye
      stroke(() => {
        ctx.moveTo(cx + eyeOffset - size * 0.08, eyeY - size * 0.11);
        ctx.lineTo(cx + eyeOffset + size * 0.08, eyeY - size * 0.08);
      }, '#000', size * 0.03);
      // grin
      stroke(() => {
        ctx.arc(cx, size * 0.58, size * 0.16, 0.1 * Math.PI, 0.9 * Math.PI);
      }, '#000', size * 0.028);
      // gold tooth
      ctx.fillStyle = '#e4b63a';
      ctx.fillRect(cx - size * 0.02, size * 0.65, size * 0.035, size * 0.045);
      break;
    }
    default: {
      eyes(size * 0.048);
      stroke(() => {
        ctx.arc(cx, size * 0.58, size * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
      });
    }
  }

  return canvas;
}

// ------------------------------------------------------------------
//  Ghost preview
// ------------------------------------------------------------------

export interface GhostSpec {
  w: number;
  d: number;
  heightPlates: number;
  colorHex: number;
}

export function createGhost(spec: GhostSpec): THREE.Mesh {
  const width = spec.w * GRID.X;
  const depth = spec.d * GRID.Z;
  const height = spec.heightPlates * PLATE_HEIGHT;

  const geom = new THREE.BoxGeometry(width, height, depth);
  geom.translate(0, height / 2, 0);

  const mat = new THREE.MeshBasicMaterial({
    color: spec.colorHex,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.isGhost = true;
  mesh.userData.w = spec.w;
  mesh.userData.d = spec.d;
  mesh.userData.heightPlates = spec.heightPlates;

  const edges = new THREE.EdgesGeometry(geom);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    })
  );
  mesh.add(line);

  return mesh;
}

/**
 * Translucent preview built from the real block geometry — this is how
 * ghost shapes match slopes/arches/round/cone/window/door/fence/wheel/etc.
 * Brick/plate/tile also use this path for consistency.
 */
export function createBrickGhost(spec: BlockSpec): THREE.Group {
  const group = createBrick(spec);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.Material & {
        transparent: boolean;
        opacity: number;
        depthWrite: boolean;
      };
      mat.transparent = true;
      mat.opacity = 0.5;
      mat.depthWrite = false;
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  group.userData.isGhost = true;
  // Remove flags that would otherwise make this raycast-able as a real block
  delete group.userData.isBrick;
  delete group.userData.spec;
  return group;
}

/** Translucent minifigure preview. */
export function createMinifigGhost(preset: MinifigPreset): THREE.Group {
  const group = createMinifigure(preset);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.Material & {
        transparent: boolean;
        opacity: number;
        depthWrite: boolean;
      };
      mat.transparent = true;
      mat.opacity = 0.5;
      mat.depthWrite = false;
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  group.userData.isGhost = true;
  group.userData.isMinifigGhost = true;
  delete group.userData.isBrick;
  delete group.userData.isMinifig;
  return group;
}

// ------------------------------------------------------------------
//  Dog — procedural quadruped NPC character.
//
//  Built from simple primitives so no external model is required.
//  Footprint: 1 stud wide × 2 studs deep (the body is 2 studs long,
//  head and tail extend slightly outside that footprint — same pattern
//  as the minifig whose arms stick out beyond its 2×1 footprint).
//  Each leg is wrapped in its own THREE.Group pivot so the walk
//  animation in game.ts can rotate the legs around their hip/shoulder.
// ------------------------------------------------------------------
export function createDogCharacter(): THREE.Group {
  const group = new THREE.Group();

  const furHex = 0xb07645; // caramel brown
  const furMat = new THREE.MeshStandardMaterial({
    color: furHex,
    roughness: 0.75,
  });
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.4,
  });
  const darkFurMat = new THREE.MeshStandardMaterial({
    color: 0x6a4528,
    roughness: 0.75,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

  // ----- Legs (create first so we can measure hip height) -----
  const legLen = 0.7;
  const legR = 0.14;
  const bodyBottomY = legLen; // body sits on top of the leg reach

  const legGeom = new THREE.CylinderGeometry(legR, legR, legLen, 12);
  // Each leg is a pivot Group whose origin is at the HIP (shoulder).
  // The mesh hangs below the pivot, so rotating the pivot around X
  // swings the whole leg forward/back — the foot traces an arc.
  const makeLeg = (x: number, z: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, bodyBottomY, z);
    const mesh = new THREE.Mesh(legGeom, darkFurMat);
    mesh.position.y = -legLen / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };

  const bodyW = 0.75; // narrower than 1 stud so the footprint snap feels tight
  const bodyH = 0.7;
  const bodyD = 1.8;
  const legHalfX = bodyW / 2 - legR * 0.2; // tiny inset
  const legHalfZ = bodyD / 2 - legR - 0.1; // inside the body's Z extent

  const frontRightLeg = makeLeg(+legHalfX, +legHalfZ);
  const frontLeftLeg = makeLeg(-legHalfX, +legHalfZ);
  const backRightLeg = makeLeg(+legHalfX, -legHalfZ);
  const backLeftLeg = makeLeg(-legHalfX, -legHalfZ);

  // ----- Body -----
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW, bodyH, bodyD),
    furMat
  );
  body.position.set(0, bodyBottomY + bodyH / 2, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // ----- Head (slightly higher than the body, forward in +Z) -----
  const headW = 0.7;
  const headH = 0.7;
  const headD = 0.7;
  const headCenterZ = bodyD / 2 + headD / 2 - 0.2;
  const headCenterY = bodyBottomY + bodyH + 0.05;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(headW, headH, headD),
    furMat
  );
  head.position.set(0, headCenterY, headCenterZ);
  head.castShadow = true;
  group.add(head);

  // Snout sticks out the front of the head
  const snout = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.32, 0.3),
    furMat
  );
  snout.position.set(
    0,
    headCenterY - 0.12,
    headCenterZ + headD / 2 + 0.15
  );
  snout.castShadow = true;
  group.add(snout);

  // Nose (small dark square on the end of the snout)
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.14, 0.08),
    noseMat
  );
  nose.position.set(
    0,
    snout.position.y + 0.03,
    snout.position.z + 0.18
  );
  group.add(nose);

  // Eyes — two black dots on the front face of the head
  const eyeGeom = new THREE.SphereGeometry(0.065, 10, 8);
  const eyeY = headCenterY + 0.13;
  const eyeZ = headCenterZ + headD / 2 - 0.03;
  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(-0.16, eyeY, eyeZ);
  group.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
  rightEye.position.set(0.16, eyeY, eyeZ);
  group.add(rightEye);

  // Floppy ears on top of the head, tilted outward + forward
  const earGeom = new THREE.BoxGeometry(0.15, 0.42, 0.12);
  const leftEar = new THREE.Mesh(earGeom, darkFurMat);
  leftEar.position.set(
    -0.32,
    headCenterY + headH / 2 - 0.05,
    headCenterZ - headD / 4
  );
  leftEar.rotation.set(0.15, 0, -0.35);
  leftEar.castShadow = true;
  group.add(leftEar);
  const rightEar = new THREE.Mesh(earGeom, darkFurMat);
  rightEar.position.set(
    0.32,
    headCenterY + headH / 2 - 0.05,
    headCenterZ - headD / 4
  );
  rightEar.rotation.set(0.15, 0, 0.35);
  rightEar.castShadow = true;
  group.add(rightEar);

  // ----- Tail — tilted up and back, slim cylinder -----
  const tailLen = 0.7;
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.05, tailLen, 8),
    furMat
  );
  // Position the tail's bottom at the back of the body, then rotate up
  // around X so the whole thing points backwards and upwards.
  tail.position.set(
    0,
    bodyBottomY + bodyH * 0.75,
    -bodyD / 2 - 0.05
  );
  tail.rotation.x = -1.1; // flip cylinder from +Y to backward/up
  tail.castShadow = true;
  group.add(tail);

  // ----- Metadata -----
  // userData.isBrick: dogs participate in the brickGroup (can be removed,
  //   block count, etc.) same as minifigs.
  // userData.isDog: lets the NPC / collision loops pick them out.
  // userData.parts: hip pivots for the 4 legs. Consumed by applyNpcLimbs
  //   in game.ts to drive the walk cycle — quadruped gait rotates the
  //   diagonal pairs (FR+BL / FL+BR) in opposite phase.
  group.userData.isBrick = true;
  group.userData.isDog = true;
  group.userData.parts = {
    frontRightLeg,
    frontLeftLeg,
    backRightLeg,
    backLeftLeg,
  };
  return group;
}

/** Translucent dog for placement preview. Mirrors createMinifigGhost. */
export function createDogGhost(): THREE.Group {
  const group = createDogCharacter();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.Material & {
        transparent: boolean;
        opacity: number;
        depthWrite: boolean;
      };
      mat.transparent = true;
      mat.opacity = 0.5;
      mat.depthWrite = false;
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  group.userData.isGhost = true;
  group.userData.isDogGhost = true;
  delete group.userData.isBrick;
  delete group.userData.isDog;
  return group;
}
