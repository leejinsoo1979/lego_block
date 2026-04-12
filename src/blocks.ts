import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { GRID, PLATE_HEIGHT, STUD_HEIGHT, STUD_RADIUS } from './config';
import type { BlockType, FaceConfig, HairStyle, HatStyle, MinifigPreset } from './config';
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
    case 'ramp':
      // 1-brick rise, full-length wedge (gentler as the size grows).
      group = createRampBlock(spec, 3 * PLATE_HEIGHT);
      break;
    case 'ramptall':
      // 2-brick rise, full-length wedge. Needs at least a 2-stud run
      // so the per-step rise (= 2.4 / run) stays within STEP_MAX.
      group = createRampBlock(spec, 6 * PLATE_HEIGHT);
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
    // 도로 / 철도
    case 'road_straight':
      group = createRoadStraightBlock(spec);
      break;
    case 'road_curve':
      group = createRoadCurveBlock(spec);
      break;
    case 'road_cross':
      group = createRoadCrossBlock(spec);
      break;
    case 'road_tee':
      group = createRoadTeeBlock(spec);
      break;
    case 'rail_straight':
      group = createRailStraightBlock(spec);
      break;
    case 'rail_curve':
      group = createRailCurveBlock(spec);
      break;
    case 'rail_crossing':
      group = createRailCrossingBlock(spec);
      break;
    // 가구
    case 'chair':
      group = createChairBlock(spec);
      break;
    case 'table':
      group = createTableBlock(spec);
      break;
    case 'sofa':
      group = createSofaBlock(spec);
      break;
    case 'bed':
      group = createBedBlock(spec);
      break;
    case 'bookshelf':
      group = createBookshelfBlock(spec);
      break;
    case 'desk':
      group = createDeskBlock(spec);
      break;
    case 'cabinet':
      group = createCabinetBlock(spec);
      break;
    case 'tvset':
      group = createTvSetBlock(spec);
      break;
    case 'fridge':
      group = createFridgeBlock(spec);
      break;
    // 소품
    case 'bench':
      group = createBenchBlock(spec);
      break;
    case 'flowerpot':
      group = createFlowerpotBlock(spec);
      break;
    case 'trashcan':
      group = createTrashcanBlock(spec);
      break;
    case 'mailbox':
      group = createMailboxBlock(spec);
      break;
    case 'signpost':
      group = createSignpostBlock(spec);
      break;
    case 'hydrant':
      group = createHydrantBlock(spec);
      break;
    case 'barrel':
      group = createBarrelBlock(spec);
      break;
    case 'campfire':
      group = createCampfireBlock(spec);
      break;
    case 'fountain':
      group = createFountainBlock(spec);
      break;
    case 'trafficcone':
      group = createTrafficConeBlock(spec);
      break;
    case 'barricade':
      group = createBarricadeBlock(spec);
      break;
    case 'well':
      group = createWellBlock(spec);
      break;
    case 'tent':
      group = createTentBlock(spec);
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
//  Ramp — pure wedge that slopes up across the ENTIRE footprint length.
//
//  Unlike the regular `slope` (a steep 1-stud wedge + flat top), a ramp
//  rises continuously from one end to the other. The longer the
//  footprint, the gentler the angle. Used for gradual climbs that a
//  minifig or car can actually drive up.
// ------------------------------------------------------------------
function createRampBlock(spec: BlockSpec, totalRise: number): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w;
  const d = spec.d;
  const material = studMaterial(spec.colorHex);

  // The wedge runs along the LONGER of the two footprint axes. The
  // shorter axis becomes the cross-section (how wide the ramp is).
  const useX = w >= d;
  const run = useX ? w : d;
  const cross = useX ? d : w;

  // Side profile in the XY plane: triangle from (0, 0) to (run, rise)
  // to (run, 0). Extruded along Z by `cross` to give the full wedge.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(run, totalRise);
  shape.lineTo(run, 0);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: cross,
    bevelEnabled: false,
  });
  // Center on origin (extrude starts at (0, 0, 0)).
  geom.translate(-run / 2, 0, -cross / 2);
  // If the run is the Z axis, rotate the geometry so +X becomes +Z.
  // Same convention as createSlopeBlock.
  if (!useX) geom.rotateY(Math.PI / 2);
  geom.computeVertexNormals();

  const wedge = new THREE.Mesh(geom, material);
  wedge.castShadow = true;
  wedge.receiveShadow = true;
  group.add(wedge);

  // No studs — the wedge has no flat surface to plant them on.
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
    // Default emissive intensity is the DAY value — Game.updateLampForTime()
    // ramps it up at night via this material reference stored on userData.
    emissiveIntensity: 0.4,
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

  const bulbY = topY + 0.12 + 0.28;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    bulbMat
  );
  bulb.position.y = bulbY;
  group.add(bulb);

  // ----- Real lighting that turns on at night -----
  // SpotLight pointing straight down from the bulb. The cone is wide
  // (~70°) with a soft penumbra so the floor pool has gentle edges
  // instead of a hard circle. Intensity starts at 0 and is ramped up by
  // Game.updateLampForTime() as the sun drops below the horizon.
  const lampLight = new THREE.SpotLight(
    0xffe1a0, // warm bulb color
    0,         // intensity (set live by Game.updateLampForTime)
    22,        // range — light reaches the ground and several units past
    Math.PI / 2.6, // ~69° half-angle — wider pool than before
    0.55,      // penumbra (soft circle edge)
    2          // physical inverse-square decay
  );
  lampLight.position.set(0, bulbY - 0.05, 0);
  // SpotLight needs an explicit target. Place it directly under the
  // bulb in the lamp's LOCAL space so it follows the lamp around as a
  // child of the same group.
  lampLight.target.position.set(0, 0, 0);
  group.add(lampLight);
  group.add(lampLight.target);
  lampLight.userData.isLampLight = true;

  // Expose direct refs so Game.updateLampForTime() can modulate them
  // every time the time-of-day slider moves, without traversing the
  // group every frame.
  group.userData.isLamp = true;
  group.userData.lampBulbMaterial = bulbMat;
  group.userData.lampLight = lampLight;

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
  const d = spec.d; // 16
  const h = 18 * PLATE_HEIGHT; // 7.2 units
  const frameMat = studMaterial(spec.colorHex);
  const slideMat = new THREE.MeshStandardMaterial({
    color: 0xf5cd30, // bright yellow slide
    roughness: 0.35,
    metalness: 0.15,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const panelT = 0.22; // side panel thickness

  // Layout zones along Z. d=16 + h=18 plates gives a much more gradual
  // slide (~38° linear angle, smoothstep peak ~48°) and stairs that
  // climb only 1 brick per step.
  //   stairs   : -d/2 .. -d/2+6   (6 stud, 6 steps × 1.2u (1 brick) rise)
  //   platform : -d/2+6 .. -d/2+7 (1 stud)
  //   slide    : -d/2+7 .. d/2    (9 stud)
  const numSteps = 6;
  const stairsRunZ = 6;
  const platformDepth = 1;
  const stepRise = h / numSteps; // 1.2u (1 brick) per step
  const z0 = -d / 2;
  const z1 = z0 + stairsRunZ; // front of stairs / back of platform
  const z2 = z1 + platformDepth; // front of platform / start of slide
  const z3 = d / 2; // front edge of slide

  // Expose slide ride parameters on userData so game.ts can find a
  // matching slide block under the player and compute the slide curve.
  group.userData.slideParams = {
    width,
    depth,
    height: h,
    numSteps,
    stairsRunZ,
    platformDepth,
    z0,
    z1,
    z2,
    z3,
    slideExitY: 0.4,
    panelT,
  };

  // ----- Slide curve points (smoothstep eased descent) -----
  const slideExitY = 0.4;
  const segments = 24;
  const curvePts: { z: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const eased = t * t * (3 - 2 * t);
    curvePts.push({
      z: z2 + (z3 - z2) * t,
      y: h + (slideExitY - h) * eased,
    });
  }

  // ----- Side panels (only PLATFORM + SLIDE area, leaving stairs
  // exposed). Outline traces: back-of-platform-bottom → straight up
  // the platform back → across the platform top → down the slide
  // curve to the front exit → back along the bottom. No railing
  // protrusion above the platform. -----
  const panelShape = new THREE.Shape();
  panelShape.moveTo(z1, 0); // back of platform, on the ground
  panelShape.lineTo(z1, h); // up to platform top
  // Slide curve from platform front edge down to slide exit
  for (let i = 0; i < curvePts.length; i++) {
    panelShape.lineTo(curvePts[i].z, curvePts[i].y);
  }
  panelShape.lineTo(z3, 0); // front-bottom
  panelShape.closePath(); // back along the bottom to (z1, 0)

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

  // ----- 4 stair boxes (FULL width since no side panels in the stair
  // zone). Each step is a stacked box from y=0 up to its top y. -----
  for (let i = 0; i < numSteps; i++) {
    const stepTopY = (i + 1) * stepRise;
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.05, stepTopY, GRID.Z),
      frameMat
    );
    step.position.set(0, stepTopY / 2, z0 + 0.5 + i);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }

  // ----- Platform tile (flat slab at top, between the side panels) -----
  const innerW = width - 2 * panelT - 0.04;
  const platformT = 0.3;
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(innerW, platformT, platformDepth * GRID.Z),
    frameMat
  );
  platform.position.set(0, h - platformT / 2, (z1 + z2) / 2);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // (No back wall — the topmost stair already reaches y=h, which is
  // exactly the platform top, so the platform back has no gap to close.)

  // ----- Curved slide deck (yellow), extruded along world X (width) -----
  const slabT = 0.24;
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

  // ----- Two hanging swings -----
  // The minifig sits on the seat facing PERPENDICULAR to the beam, i.e.
  // facing +Z. So the seat is wide along X (matching the minifig's
  // 2-stud-wide side) and deep along Z (matching the minifig's 1-stud
  // depth). The two chains attach at the X positions that match the
  // minifig's HAND grip width — that way the seated rider visually
  // grips the chains with both hands.
  //
  // Each swing (chains + seat) is wrapped in its own PIVOT GROUP placed
  // at (sx, apexY, 0) — the point on the beam where the chains hang
  // from. Rotating that pivot around its X axis swings the whole
  // assembly forward/back along Z, which is what updateSwingRide drives
  // when the player is riding.
  //
  // Chain length is 78% of the swing height so the seat hangs LOW
  // enough for a Lego minifig to actually sit on it (the previous 62%
  // hung the seat well above the rider's hips).
  const chainLen = h * 0.78;
  const numSwings = 2;
  const swingSpacing = beamLen / (numSwings + 1);
  const seatXs: number[] = [];
  for (let i = 1; i <= numSwings; i++) {
    seatXs.push(-beamLen / 2 + i * swingSpacing);
  }
  // Chain X spacing = ACTUAL minifig hand grip half-width, measured off
  // the rigged GLB at load time (see loadCharacterModel). This way the
  // chains hang exactly under the rider's hands, no eyeballing.
  // Fall back to ~1.0 if the GLB hasn't loaded for any reason.
  const handX = characterHandX > 0 ? characterHandX : 1.0;
  const chainXOffset = handX;
  // Seat width is the chain span plus generous padding on each side so
  // the rider sits comfortably between the chains, and depth fits the
  // sit-pose minifig (legs forward, arms slightly forward).
  const seatW = chainXOffset * 2 + 0.6;
  const seatD = 1.4;

  const swingPivots: THREE.Group[] = [];
  for (const sx of seatXs) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, apexY, 0);
    group.add(pivot);
    swingPivots.push(pivot);

    // Two chains hanging straight down from the pivot point. In pivot-
    // local space the pivot is the origin and the chain extends down
    // from y=0 to y=-chainLen. Thickened so the visual contact with
    // the rider's hand is clearly readable in 3rd-person view.
    for (const cx of [-chainXOffset, chainXOffset]) {
      const chain = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, chainLen, 0.14),
        chainMat
      );
      chain.position.set(cx, -chainLen / 2, 0);
      chain.castShadow = true;
      pivot.add(chain);
    }

    // Flat seat — minifig sits facing +Z. Seat top is at pivot-local
    // y = -chainLen, so the seat box (0.18 thick) centers at y = -chainLen - 0.09.
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(seatW, 0.18, seatD),
      seatMat
    );
    seat.position.set(0, -chainLen - 0.09, 0);
    seat.castShadow = true;
    seat.receiveShadow = true;
    pivot.add(seat);
  }

  // Expose the pivots so updateSwingRide can rotate them while the
  // player is riding. The ride loop computes a swing angle and sets
  // pivot.rotation.x = -angle to match its physics.
  group.userData.parts = { swingPivots };
  // Mirror the geometric constants the ride loop needs so it doesn't
  // have to re-derive them (and so they stay in sync if we tweak the
  // factory). apexY is the Y of the beam, chainLen is the chain
  // length used by the pivot rotation calculation.
  group.userData.swingParams = { apexY, chainLen, numSwings };

  return group;
}

// ------------------------------------------------------------------
//  Seesaw — curved fulcrum + tilted plank with seat pads and handles
//  on each end. The whole "plank assembly" is a single child group so
//  the rotation cleanly tilts the plank, seats, and handles together.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
//  Seesaw — two side posts hold a horizontal axle bar; the plank is
//  balanced on the axle with seats and back-handles at each end.
// ------------------------------------------------------------------
function createSeesawBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 12
  const d = spec.d; // 4
  const material = studMaterial(spec.colorHex);
  const plankMat = new THREE.MeshStandardMaterial({
    color: 0xc4281c, // bright red plank
    roughness: 0.5,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x0d69ac, // bright blue seats
    roughness: 0.5,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;

  // ----- Two A-frame side posts holding the axle -----
  // Each "post" is a triangular wedge prism standing at z = ±zPost,
  // tapering up to support the axle bar. Bumped to 2.0u tall + wider
  // base for the bigger 12×4×9p seesaw.
  const postZ = depth / 2 - 0.5;
  const postBaseW = 1.0;
  const postH = 2.0;
  const postT = 0.4;

  // Triangle (base wide, apex narrow at top) in shape XY
  const postShape = new THREE.Shape();
  postShape.moveTo(-postBaseW / 2, 0);
  postShape.lineTo(postBaseW / 2, 0);
  postShape.lineTo(0.12, postH);
  postShape.lineTo(-0.12, postH);
  postShape.closePath();
  const postGeom = new THREE.ExtrudeGeometry(postShape, {
    depth: postT,
    bevelEnabled: false,
  });
  postGeom.translate(0, 0, -postT / 2);
  postGeom.computeVertexNormals();
  for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(postGeom.clone(), material);
    post.position.set(0, 0, sz * postZ);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
  }

  // ----- Axle bar (horizontal, between the two post tops) -----
  const axleR = 0.14;
  const axleLen = 2 * postZ + 0.4;
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(axleR, axleR, axleLen, 14),
    material
  );
  axle.rotation.x = Math.PI / 2; // align Y-axis cylinder along Z
  axle.position.set(0, postH, 0);
  axle.castShadow = true;
  group.add(axle);

  // ----- Plank assembly (rotates around Z as a unit, balanced on the axle) -----
  // The whole plank+seats live in this group so updateSeesawRide can
  // rock the visual seesaw by setting plankGroup.rotation.z while the
  // player is riding. Resting tilt is a gentle ~8°.
  const plankGroup = new THREE.Group();
  plankGroup.position.set(0, postH + axleR, 0);
  plankGroup.rotation.z = -0.14;
  group.add(plankGroup);

  // Long red plank — wider so a minifig can sit on it sideways
  const plankLen = width - 0.5;
  const plankD = 2.4; // wide enough that a minifig (1 stud deep) fits
  const plankT = 0.32;
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(plankLen, plankT, plankD),
    plankMat
  );
  plank.position.y = plankT / 2;
  plank.castShadow = true;
  plank.receiveShadow = true;
  plankGroup.add(plank);

  // ----- Saddle (small block under the plank center, hugs the axle so
  // the visual reads as "plank attached to axle") -----
  const saddle = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.28, plankD - 0.2),
    material
  );
  saddle.position.y = -0.14;
  plankGroup.add(saddle);

  // ----- Proper seats at each end of the plank.
  // On a real seesaw the two riders sit FACING EACH OTHER across the
  // pivot. So at the +X end the minifig faces -X, and at the -X end
  // they face +X. The minifig's 2-stud width then runs along Z and the
  // 1-stud depth runs along X. The backrest sits at the OUTER side of
  // each seat (away from the pivot) — that's where the rider's back
  // leans while looking inward. -----
  const seatPadW = 1.4; // X (along plank, = minifig depth + clearance)
  const seatPadH = 0.2;
  const seatPadD = 2.2; // Z (perpendicular to plank, fits 2-stud width)
  const backrestH = 1.3;
  const backrestT = 0.2;

  for (const sx of [-1, 1]) {
    const endX = sx * (plankLen / 2 - seatPadW / 2 - 0.1);

    // Seat pad (blue)
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(seatPadW, seatPadH, seatPadD),
      seatMat
    );
    pad.position.set(endX, plankT + seatPadH / 2, 0);
    pad.castShadow = true;
    pad.receiveShadow = true;
    plankGroup.add(pad);

    // Backrest at the OUTER end of the seat (the sx side, away from
    // the pivot) — the rider's back rests against it while facing the
    // pivot. Long along Z, thin along X.
    const backrest = new THREE.Mesh(
      new THREE.BoxGeometry(backrestT, backrestH, seatPadD),
      seatMat
    );
    backrest.position.set(
      endX + sx * (seatPadW / 2 - backrestT / 2),
      plankT + seatPadH + backrestH / 2,
      0
    );
    backrest.castShadow = true;
    plankGroup.add(backrest);

    // Two side arms on the rider's left and right (= ±Z), running along
    // the seat depth (X). Slight forward shift toward the pivot so the
    // rider can climb in from the side.
    for (const az of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(seatPadW * 0.85, 0.5, 0.18),
        seatMat
      );
      arm.position.set(
        endX - sx * 0.05,
        plankT + seatPadH + 0.25,
        az * (seatPadD / 2 - 0.09)
      );
      arm.castShadow = true;
      plankGroup.add(arm);
    }
  }

  // Expose the plank pivot so updateSeesawRide can rock it while the
  // player rides. The ride loop sets plankGroup.rotation.z to a sine
  // wave; the player position is computed against the same tilt.
  group.userData.parts = { plankGroup };

  return group;
}

// ------------------------------------------------------------------
//  Jungle gym — 4 corner posts hold a railed top platform. The back
//  side is a SOLID climbing wall with grip holes; the left side has
//  ladder rungs for climbing; the front and right sides have railings
//  with one open entry/exit. A flag on top adds character.
// ------------------------------------------------------------------
function createJungleGymBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 5
  const d = spec.d; // 5
  const h = 24 * PLATE_HEIGHT; // 9.6 units (~2× minifig)
  const material = studMaterial(spec.colorHex);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf5cd30, // yellow climbing wall (color contrast)
    roughness: 0.55,
  });
  const flagMat = new THREE.MeshStandardMaterial({
    color: 0xc4281c, // red flag
    roughness: 0.6,
  });

  const width = w * GRID.X;
  const depth = d * GRID.Z;
  const postT = 0.32;
  const wallT = 0.22;

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

  // ----- SOLID climbing wall at -Z side (yellow with grip studs) -----
  // The wall fills the area between the two -Z corner posts, from y=0
  // up to y=h. Grip studs (small spheres) are scattered in a grid for
  // climb-hold visual.
  const wallW = width - 2 * postT - 0.04;
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(wallW, h, wallT),
    wallMat
  );
  wall.position.set(0, h / 2, -depth / 2 + postT + wallT / 2);
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  // Climb grip studs scattered on the back wall
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0xc4281c,
    roughness: 0.5,
  });
  const gripGridX = 3;
  const gripGridY = 5;
  for (let gx = 0; gx < gripGridX; gx++) {
    for (let gy = 0; gy < gripGridY; gy++) {
      const px =
        -wallW / 2 +
        (wallW / (gripGridX + 1)) * (gx + 1) +
        (gy % 2 === 0 ? 0 : 0.25);
      const py = (h / (gripGridY + 1)) * (gy + 1);
      const grip = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 8),
        gripMat
      );
      grip.position.set(
        px,
        py,
        -depth / 2 + postT + wallT + 0.04
      );
      grip.castShadow = true;
      group.add(grip);
    }
  }

  // ----- Ladder rungs on the -X side (between back-left and front-left
  // corner posts). 7 horizontal rungs spanning the depth. -----
  const numRungs = 7;
  for (let i = 0; i < numRungs; i++) {
    const ry = (h * (i + 0.5)) / numRungs;
    const rung = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, depth - 2 * postT - 0.04),
      material
    );
    rung.position.set(-width / 2 + postT / 2 + 0.05, ry, 0);
    rung.castShadow = true;
    group.add(rung);
  }

  // ----- Top platform: solid slab spanning the full footprint -----
  const platformT = 0.3;
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(
      width - postT - 0.02,
      platformT,
      depth - postT - 0.02
    ),
    material
  );
  platform.position.set(0, h - platformT / 2, 0);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // ----- Top railings on 3 sides (back/left/right; +X side open as exit) -----
  const railH = 0.7;
  const railT = 0.14;

  // Back railing (-Z)
  const railBack = new THREE.Mesh(
    new THREE.BoxGeometry(width - postT, railT, railT),
    material
  );
  railBack.position.set(0, h + railH - railT / 2, -depth / 2 + postT / 2);
  group.add(railBack);
  // Left railing (-X)
  const railLeft = new THREE.Mesh(
    new THREE.BoxGeometry(railT, railT, depth - postT),
    material
  );
  railLeft.position.set(-width / 2 + postT / 2, h + railH - railT / 2, 0);
  group.add(railLeft);
  // Front railing (+Z)
  const railFront = new THREE.Mesh(
    new THREE.BoxGeometry(width - postT, railT, railT),
    material
  );
  railFront.position.set(0, h + railH - railT / 2, depth / 2 - postT / 2);
  group.add(railFront);

  // Vertical balusters supporting the railings (every other corner)
  for (const corner of [
    { x: -1, z: -1 },
    { x: 1, z: -1 },
    { x: -1, z: 1 },
    { x: 1, z: 1 },
  ]) {
    const bx = corner.x * (width / 2 - postT / 2);
    const bz = corner.z * (depth / 2 - postT / 2);
    const baluster = new THREE.Mesh(
      new THREE.BoxGeometry(railT, railH, railT),
      material
    );
    baluster.position.set(bx, h + railH / 2, bz);
    group.add(baluster);
  }

  // ----- Flag pole + flag on top of the platform -----
  const poleH = 1.6;
  const flagPoleY = h + railH + poleH / 2;
  const flagPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, poleH, 10),
    material
  );
  flagPole.position.set(0, flagPoleY, 0);
  flagPole.castShadow = true;
  group.add(flagPole);

  // Triangular flag on the pole (extruded right triangle)
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.9, 0.3);
  flagShape.lineTo(0, 0.6);
  flagShape.closePath();
  const flagGeom = new THREE.ExtrudeGeometry(flagShape, {
    depth: 0.05,
    bevelEnabled: false,
  });
  flagGeom.translate(0, 0, -0.025);
  const flag = new THREE.Mesh(flagGeom, flagMat);
  flag.position.set(0.05, h + railH + poleH - 0.65, 0);
  flag.castShadow = true;
  group.add(flag);

  return group;
}

// ------------------------------------------------------------------
//  Merry-go-round — round disc base, central pole, 4 radial handles
// ------------------------------------------------------------------
// ------------------------------------------------------------------
//  Merry-go-round — round disc base, central pole, conical canopy on
//  top, 4 seats around the rim and 4 vertical drop-bars from the
//  canopy edge to the rim.
// ------------------------------------------------------------------
function createMerryGoRoundBlock(spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const w = spec.w; // 16
  const d = spec.d; // 16
  // 32 plates (= 12.8 units) tall — the tallest playground piece. Keep
  // in sync with bodyHeightPlates in config.ts so the collision box
  // matches the visible structure.
  const h = 32 * PLATE_HEIGHT;
  const material = studMaterial(spec.colorHex);
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0xf5cd30, // yellow seats
    roughness: 0.5,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0xc4281c, // red canopy / trim
    roughness: 0.55,
  });
  const chainMat = new THREE.MeshStandardMaterial({
    color: 0x6a6a6a,
    roughness: 0.4,
    metalness: 0.55,
  });

  const baseR = Math.min(w, d) * 0.5 - 0.3; // ~7.7 for a 16×16
  const baseH = 0.6; // 1.5 plates — chunky raised platform
  const hubR = baseR * 0.42; // top hub disc radius (~3.2)

  // ----- Stationary central support pole + ground anchor -----
  // The pole stays put; only the rotor (everything else) spins around it.
  const poleH = h - 0.4;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, poleH, 20),
    material
  );
  pole.position.y = poleH / 2;
  pole.castShadow = true;
  pole.receiveShadow = true;
  group.add(pole);

  // ----- Rotor: everything that spins (base disc + hub + chains + seats) -----
  const rotor = new THREE.Group();
  rotor.userData.isRotor = true;
  group.add(rotor);

  // Round disc base — the floor riders' feet would touch
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(baseR, baseR, baseH, 48),
    material
  );
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  rotor.add(base);

  // Red trim ring around the base rim
  const trim = new THREE.Mesh(
    new THREE.CylinderGeometry(baseR + 0.08, baseR, 0.24, 48),
    canopyMat
  );
  trim.position.y = baseH + 0.12;
  rotor.add(trim);

  // Top hub (where chains hang from)
  const hubH = 0.7;
  const hubY = h - 0.9;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(hubR, hubR + 0.25, hubH, 36),
    canopyMat
  );
  hub.position.y = hubY;
  hub.castShadow = true;
  rotor.add(hub);

  // Decorative dome on the hub
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(hubR * 0.7, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    canopyMat
  );
  dome.position.y = hubY + hubH / 2;
  rotor.add(dome);

  // Pointy finial on top
  const finial = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.95, 18),
    canopyMat
  );
  finial.position.y = hubY + hubH / 2 + hubR * 0.7 + 0.47;
  rotor.add(finial);

  // ----- Six swing seats hanging from the hub -----
  // Seats are sized for an actual minifig sitting on them. The chain
  // PAIR for each seat is spaced exactly to match the minifig's hand
  // span — measured off the rigged GLB at load time — so the rider's
  // hands grip the chains naturally with no eyeballing.
  const numSeats = 6;
  const seatRadius = baseR - 1.4; // distance from center to seat center (~6.3)
  const halfHandSpan = characterHandX > 0 ? characterHandX : 1.0;
  const seatPadW = halfHandSpan * 2 + 0.6; // chain span + padding
  const seatPadD = 1.4; // deep enough for sitting + back-shift
  const seatBackH = 1.4; // up to minifig shoulder height
  const seatBottomY = baseH + 1.6; // riders' feet hang freely
  const seatTopY = seatBottomY + 0.18;
  // How far back (toward the central pole, in seat-local -Z) the rider
  // sits on the pad — places their back near the backrest and leaves
  // the chains slightly in front so the arms reach forward to grip.
  const seatBackShift = 0.3;

  // Helper: build a thin cylinder ("chain") between two points.
  const yAxis = new THREE.Vector3(0, 1, 0);
  const buildChain = (
    top: THREE.Vector3,
    bot: THREE.Vector3,
    r: number
  ): THREE.Mesh => {
    const dir = new THREE.Vector3().subVectors(bot, top);
    const length = dir.length();
    dir.normalize();
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, length, 8),
      chainMat
    );
    chain.position.copy(top).add(bot).multiplyScalar(0.5);
    chain.quaternion.setFromUnitVectors(yAxis, dir);
    chain.castShadow = true;
    return chain;
  };

  // Seat layout data — exposed via userData so the play-mode "ride"
  // mechanic can find seats and lock the player to them.
  const seatLocalPositions: { x: number; y: number; z: number; angle: number }[] =
    [];

  for (let i = 0; i < numSeats; i++) {
    const angle = (i / numSeats) * Math.PI * 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const seatCx = cosA * seatRadius;
    const seatCz = sinA * seatRadius;

    // Seat group, oriented so its +Z faces OUTWARD (radially away from
    // center). Riders sit looking out — backrest is on the inner side.
    const seatGroup = new THREE.Group();
    seatGroup.position.set(seatCx, seatBottomY, seatCz);
    // Look at a point further along the same radial direction (outward)
    seatGroup.lookAt(seatCx + cosA, seatBottomY, seatCz + sinA);
    rotor.add(seatGroup);

    // Seat pad
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(seatPadW, 0.18, seatPadD),
      seatMat
    );
    pad.castShadow = true;
    seatGroup.add(pad);

    // Backrest — on the inside (rider's back faces the central pole).
    // Local -Z is now toward center after the outward-facing lookAt.
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(seatPadW, seatBackH, 0.18),
      seatMat
    );
    back.position.set(0, seatBackH / 2 + 0.09, -seatPadD / 2 + 0.09);
    back.castShadow = true;
    seatGroup.add(back);

    // Two chains per seat, spaced exactly handSpan apart so the rider's
    // hands rest on them naturally. Chains attach to the seat edges
    // (left and right of the rider, at hand level) and rise straight up
    // to the hub edge directly above.
    //
    // After the outward-facing lookAt, the seat's local +X axis runs
    // along the tangent direction (sinA, 0, -cosA) in world space. We
    // use that to place chain anchors exactly handSpan apart along the
    // tangent (so the spacing matches a minifig's hand span).
    const tx = sinA; // local +X direction in world (tangent)
    const tz = -cosA;

    for (const ax of [-1, 1] as const) {
      // Chain grip on the seat: tangentially offset by the measured
      // half hand span, at chest height above the seat pad.
      const offX = ax * halfHandSpan;
      const wx = seatCx + tx * offX;
      const wz = seatCz + tz * offX;
      const handY = seatTopY + seatBackH * 0.55;
      const handPoint = new THREE.Vector3(wx, handY, wz);

      // Hub attachment: directly above this anchor, projected onto the
      // hub edge so the chain has a slight inward slope when at rest.
      const len = Math.hypot(wx, wz);
      const ux = wx / len;
      const uz = wz / len;
      const hubX = ux * (hubR + 0.06);
      const hubZ = uz * (hubR + 0.06);
      const hubAttach = new THREE.Vector3(
        hubX,
        hubY - hubH / 2 - 0.04,
        hubZ
      );

      rotor.add(buildChain(hubAttach, handPoint, 0.07));
    }

    // Sit position: on top of the pad (= seatBottomY + halfPadH) and
    // shifted back toward the backrest by seatBackShift, in the seat-
    // local -Z direction (which equals the inward radial in world).
    const sitX = seatCx - cosA * seatBackShift;
    const sitZ = seatCz - sinA * seatBackShift;
    const sitY = seatBottomY + 0.09; // pad-top in world Y (= rider hip)
    seatLocalPositions.push({
      x: sitX,
      y: sitY,
      z: sitZ,
      angle,
    });
  }

  // Stash the seat layout + rotor reference + spin parameters in
  // userData so the play loop can drive rotation and snap riders.
  group.userData.merryGoRound = {
    rotor,
    seats: seatLocalPositions,
    seatBottomY,
    spinSpeed: 0.55, // radians per second when active
  };

  return group;
}

// ------------------------------------------------------------------
//  Bridge — long plank walkway with railings, designed to span a gap
//  between two separated baseplate tiles. Fixed size 2 × 44 studs.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
//  Road tile factories — flat 8×8 stud tiles placed ON the baseplate.
//  All tiles share a common asphalt-gray base slab (1 plate thick)
//  with painted road markings (white center line, yellow edge lines)
//  or rail geometry (brown sleepers + silver rails) on top.
// ------------------------------------------------------------------

/** Shared asphalt base slab for all road/rail tiles. */
function roadBase(w: number, d: number): { group: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.85 });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w * GRID.X, PLATE_HEIGHT, d * GRID.Z),
    mat
  );
  slab.position.y = PLATE_HEIGHT / 2;
  slab.receiveShadow = true;
  slab.castShadow = true;
  group.add(slab);
  return { group, mat };
}

const ROAD_W = 4.5; // road-surface width in studs (leaves 1.75 sidewalk on each side)
const LINE_H = PLATE_HEIGHT + 0.01; // line Y just above the slab surface

/** White dashed center line running along Z axis. */
function addCenterLine(group: THREE.Group, length: number) {
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 });
  const dashLen = 0.8;
  const gapLen = 0.6;
  const step = dashLen + gapLen;
  const count = Math.floor(length / step);
  const startZ = -length / 2 + (length - count * step + dashLen) / 2;
  for (let i = 0; i < count; i++) {
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, dashLen),
      lineMat
    );
    dash.position.set(0, LINE_H, startZ + i * step);
    group.add(dash);
  }
}

/** Yellow solid edge lines on both sides of the road, running along Z. */
function addEdgeLines(group: THREE.Group, length: number) {
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xddb832, roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.02, length - 0.2),
      edgeMat
    );
    line.position.set(sx * (ROAD_W / 2), LINE_H, 0);
    group.add(line);
  }
}

/** Sidewalk curb strips on both sides. */
function addSidewalks(group: THREE.Group, w: number, d: number) {
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xa0a3a8, roughness: 0.75 });
  const totalW = w * GRID.X;
  const totalD = d * GRID.Z;
  const curbW = (totalW - ROAD_W) / 2;
  for (const sx of [-1, 1]) {
    const curb = new THREE.Mesh(
      new THREE.BoxGeometry(curbW, PLATE_HEIGHT + 0.08, totalD),
      curbMat
    );
    curb.position.set(sx * (ROAD_W / 2 + curbW / 2), (PLATE_HEIGHT + 0.08) / 2, 0);
    curb.receiveShadow = true;
    group.add(curb);
  }
}

function createRoadStraightBlock(spec: BlockSpec): THREE.Group {
  const { group } = roadBase(spec.w, spec.d);
  const len = spec.d * GRID.Z;
  addSidewalks(group, spec.w, spec.d);
  addCenterLine(group, len);
  addEdgeLines(group, len);
  return group;
}

function createRoadCurveBlock(spec: BlockSpec): THREE.Group {
  const { group } = roadBase(spec.w, spec.d);
  const half = (spec.w * GRID.X) / 2; // 4
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xddb832, roughness: 0.6 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xa0a3a8, roughness: 0.75 });

  // 90° curve: road enters from the -Z edge center (x=0, z=-half) and
  // exits from the +X edge center (x=+half, z=0). Arc center sits at
  // the bottom-right corner (half, -half) with radius = half, so the
  // openings line up exactly with adjacent straight tiles.
  const arcCx = half;
  const arcCz = -half;
  const R = half;

  // Dashed white center line along the arc (angle π → π/2)
  const dashCount = 8;
  for (let i = 0; i < dashCount; i++) {
    const t = (i + 0.5) / dashCount;
    const a = Math.PI - t * (Math.PI / 2);
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, 0.6),
      lineMat
    );
    dash.position.set(
      arcCx + R * Math.cos(a),
      LINE_H,
      arcCz + R * Math.sin(a)
    );
    dash.rotation.y = -(a - Math.PI / 2);
    group.add(dash);
  }

  // Yellow edge arcs (inner + outer)
  for (const rOffset of [-ROAD_W / 2, ROAD_W / 2]) {
    const r = R + rOffset;
    if (r <= 0) continue;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      const a = Math.PI - t * (Math.PI / 2);
      pts.push(new THREE.Vector3(
        arcCx + r * Math.cos(a),
        LINE_H,
        arcCz + r * Math.sin(a)
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, 0.05, 4, false),
      edgeMat
    );
    group.add(tube);
  }

  // Sidewalk: inner corner fill near the arc center (bottom-right)
  const innerR = R - ROAD_W / 2;
  if (innerR > 0.3) {
    const sz = innerR - 0.2;
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(sz, PLATE_HEIGHT + 0.08, sz),
      curbMat
    );
    inner.position.set(half - sz / 2, (PLATE_HEIGHT + 0.08) / 2, -half + sz / 2);
    inner.receiveShadow = true;
    group.add(inner);
  }

  // Sidewalk: outer corner fill (top-left, opposite the curve)
  const outerR = R + ROAD_W / 2;
  const outerSz = half * 2 - outerR - 0.2;
  if (outerSz > 0.3) {
    const outer = new THREE.Mesh(
      new THREE.BoxGeometry(outerSz, PLATE_HEIGHT + 0.08, outerSz),
      curbMat
    );
    outer.position.set(-half + outerSz / 2, (PLATE_HEIGHT + 0.08) / 2, half - outerSz / 2);
    outer.receiveShadow = true;
    group.add(outer);
  }

  return group;
}

function createRoadCrossBlock(spec: BlockSpec): THREE.Group {
  const { group } = roadBase(spec.w, spec.d);
  const len = spec.d * GRID.Z;
  const wid = spec.w * GRID.X;
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 });
  // Crosswalk stripes on all 4 approaches
  for (let axis = 0; axis < 2; axis++) {
    for (const sign of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.02, ROAD_W),
          lineMat
        );
        const offset = sign * ((axis === 0 ? len : wid) / 2 - 0.8) + sign * (-i * 0.5);
        if (axis === 0) {
          stripe.position.set(0, LINE_H, offset);
        } else {
          stripe.rotation.y = Math.PI / 2;
          stripe.position.set(offset, LINE_H, 0);
        }
        group.add(stripe);
      }
    }
  }
  return group;
}

function createRoadTeeBlock(spec: BlockSpec): THREE.Group {
  const { group } = roadBase(spec.w, spec.d);
  const len = spec.d * GRID.Z;
  // Main road along Z + branch toward +X
  addCenterLine(group, len);
  addEdgeLines(group, len);
  // Cut opening in +X edge line (already done by not extending it)
  // T-junction: add crosswalk stripes at the branch
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.02, ROAD_W),
      lineMat
    );
    stripe.rotation.y = Math.PI / 2;
    stripe.position.set((spec.w * GRID.X) / 2 - 0.8 - i * 0.5, LINE_H, 0);
    group.add(stripe);
  }
  // Sidewalk on -X side only (the non-branch side)
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xa0a3a8, roughness: 0.75 });
  const totalW = spec.w * GRID.X;
  const curbW = (totalW - ROAD_W) / 2;
  const curb = new THREE.Mesh(
    new THREE.BoxGeometry(curbW, PLATE_HEIGHT + 0.08, len),
    curbMat
  );
  curb.position.set(-(ROAD_W / 2 + curbW / 2), (PLATE_HEIGHT + 0.08) / 2, 0);
  curb.receiveShadow = true;
  group.add(curb);
  return group;
}

// ------------------------------------------------------------------
//  Rail tile factories
// ------------------------------------------------------------------

/** Shared rail-bed: gravel-textured slab. */
function railBase(w: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const gravelMat = new THREE.MeshStandardMaterial({ color: 0x6e6b63, roughness: 0.95 });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w * GRID.X, PLATE_HEIGHT, d * GRID.Z),
    gravelMat
  );
  slab.position.y = PLATE_HEIGHT / 2;
  slab.receiveShadow = true;
  slab.castShadow = true;
  group.add(slab);
  return group;
}

const RAIL_GAUGE = 2.4; // distance between the two rails in studs
const SLEEPER_SPACING = 1.0;

/** Two parallel silver rails running along Z. */
function addRails(group: THREE.Group, length: number) {
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xb0b5bc,
    roughness: 0.3,
    metalness: 0.7,
  });
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.12, length - 0.1),
      railMat
    );
    rail.position.set(sx * (RAIL_GAUGE / 2), PLATE_HEIGHT + 0.06, 0);
    rail.castShadow = true;
    group.add(rail);
  }
}

/** Wooden sleepers (ties) across the track, running along Z. */
function addSleepers(group: THREE.Group, length: number) {
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.8 });
  const count = Math.floor(length / SLEEPER_SPACING);
  const startZ = -(count - 1) * SLEEPER_SPACING / 2;
  for (let i = 0; i < count; i++) {
    const sleeper = new THREE.Mesh(
      new THREE.BoxGeometry(RAIL_GAUGE + 1.2, 0.1, 0.4),
      sleeperMat
    );
    sleeper.position.set(0, PLATE_HEIGHT + 0.01, startZ + i * SLEEPER_SPACING);
    sleeper.receiveShadow = true;
    group.add(sleeper);
  }
}

function createRailStraightBlock(spec: BlockSpec): THREE.Group {
  const group = railBase(spec.w, spec.d);
  const len = spec.d * GRID.Z;
  addSleepers(group, len);
  addRails(group, len);
  return group;
}

function createRailCurveBlock(spec: BlockSpec): THREE.Group {
  const group = railBase(spec.w, spec.d);
  const half = (spec.w * GRID.X) / 2;
  const cR = half * 0.6; // curve radius
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xb0b5bc,
    roughness: 0.3,
    metalness: 0.7,
  });
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.8 });
  const segments = 16;
  // Sleepers along arc
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * (Math.PI / 2);
    const cx = -half + cR + Math.sin(a) * cR;
    const cz = -half + cR - Math.cos(a) * cR;
    const sleeper = new THREE.Mesh(
      new THREE.BoxGeometry(RAIL_GAUGE + 1.2, 0.1, 0.4),
      sleeperMat
    );
    sleeper.position.set(cx, PLATE_HEIGHT + 0.01, cz);
    sleeper.rotation.y = a;
    sleeper.receiveShadow = true;
    group.add(sleeper);
  }
  // Rails — two arc tubes (inner + outer)
  for (const rOffset of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * (Math.PI / 2);
      pts.push(
        new THREE.Vector3(
          -half + cR + Math.sin(a) * (cR + rOffset),
          PLATE_HEIGHT + 0.06,
          -half + cR - Math.cos(a) * (cR + rOffset)
        )
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, 0.07, 6, false),
      railMat
    );
    tube.castShadow = true;
    group.add(tube);
  }
  return group;
}

function createRailCrossingBlock(spec: BlockSpec): THREE.Group {
  const { group } = roadBase(spec.w, spec.d);
  const len = spec.d * GRID.Z;
  // Road goes along Z, rails cross along X
  addCenterLine(group, len);
  addEdgeLines(group, len);
  addSidewalks(group, spec.w, spec.d);
  // Rails crossing perpendicular (along X)
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xb0b5bc,
    roughness: 0.3,
    metalness: 0.7,
  });
  const totalW = spec.w * GRID.X;
  for (const sz of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(totalW, 0.12, 0.14),
      railMat
    );
    rail.position.set(0, PLATE_HEIGHT + 0.06, sz * (RAIL_GAUGE / 2));
    rail.castShadow = true;
    group.add(rail);
  }
  // Crossing planks across the road
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.7 });
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W + 0.4, 0.06, RAIL_GAUGE + 1.6),
    plankMat
  );
  plank.position.y = PLATE_HEIGHT + 0.03;
  plank.receiveShadow = true;
  group.add(plank);
  // Warning stripes
  const warnMat = new THREE.MeshStandardMaterial({ color: 0xddb832, roughness: 0.6 });
  for (const sz of [-1, 1]) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_W + 0.4, 0.02, 0.15),
      warnMat
    );
    stripe.position.set(0, PLATE_HEIGHT + 0.07, sz * (RAIL_GAUGE / 2 + 1.0));
    group.add(stripe);
  }
  return group;
}

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
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  // All hats are scaled to properly sit on the Lego minifig head (which
  // is about 1.0–1.2u wide). The hat sits directly on head-top (y=0 in
  // this group's local frame), so everything builds upward from y=0.

  switch (style) {
    case 'cap': {
      // Classic Lego baseball cap — tapered cylinder crown + flat
      // rounded visor that sticks out in front. The visor is a full-
      // width half-cylinder (not a box) so it reads as curved from
      // every angle, like the real Lego cap piece.
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.54, 0.62, 0.35, 24),
        mat
      );
      crown.position.y = 0.18;
      crown.castShadow = true;
      group.add(crown);
      // Button on top
      const button = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12),
        mat
      );
      button.position.y = 0.38;
      group.add(button);
      // Visor — a flat half-cylinder lying on its side: the full-
      // width curved brim that sticks forward from the crown base.
      const visor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.56, 0.56, 0.06, 24, 1, false, 0, Math.PI),
        mat
      );
      visor.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      visor.position.set(0, 0.04, 0.34);
      visor.castShadow = true;
      group.add(visor);
      break;
    }
    case 'fireman': {
      // Chunky fire helmet — dome + wide brim + front crest
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
        mat
      );
      dome.position.y = 0.08;
      dome.castShadow = true;
      group.add(dome);
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.88, 0.9, 0.08, 28),
        mat
      );
      brim.position.y = 0.05;
      brim.castShadow = true;
      group.add(brim);
      // Front crest (shield)
      const crest = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.5, 0.12),
        new THREE.MeshStandardMaterial({ color: 0xf5cd30, roughness: 0.4, metalness: 0.3 })
      );
      crest.position.set(0, 0.38, 0.52);
      crest.castShadow = true;
      group.add(crest);
      break;
    }
    case 'astronaut': {
      // Full-head fishbowl helmet with reflective visor
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(0.78, 28, 22),
        new THREE.MeshStandardMaterial({
          color: 0xf0f0f0,
          roughness: 0.15,
          metalness: 0.05,
          transparent: true,
          opacity: 0.65,
        })
      );
      bubble.position.y = -0.15;
      bubble.castShadow = true;
      group.add(bubble);
      // Dark gold visor on the front
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.72, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.4),
        new THREE.MeshStandardMaterial({
          color: 0x302010,
          roughness: 0.1,
          metalness: 0.85,
        })
      );
      visor.position.set(0, -0.15, 0);
      visor.rotation.x = Math.PI * 0.15;
      group.add(visor);
      break;
    }
    case 'wizard': {
      // Tall pointy wizard hat with wide brim + star
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 0.95, 0.08, 28),
        mat
      );
      brim.position.y = 0.04;
      brim.castShadow = true;
      group.add(brim);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 1.8, 28),
        mat
      );
      cone.position.y = 0.96;
      cone.rotation.z = 0.08;
      cone.castShadow = true;
      group.add(cone);
      // Gold star at the front
      const starMat = new THREE.MeshStandardMaterial({
        color: 0xf5cd30,
        roughness: 0.3,
        metalness: 0.5,
      });
      const star = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.08, 5),
        starMat
      );
      star.position.set(0, 0.6, 0.5);
      star.rotation.x = Math.PI / 2;
      group.add(star);
      break;
    }
    case 'crown': {
      // Chunky gold crown — thick band + 5 tall points
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.58, 0.62, 0.25, 24),
        mat
      );
      band.position.y = 0.125;
      band.castShadow = true;
      group.add(band);
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.1, 0.4, 8),
          mat
        );
        spike.position.set(
          Math.cos(angle) * 0.52,
          0.45,
          Math.sin(angle) * 0.52
        );
        spike.castShadow = true;
        group.add(spike);
      }
      // Jewels on the band
      const jewelMat = new THREE.MeshStandardMaterial({
        color: 0xcc2222,
        roughness: 0.2,
        metalness: 0.4,
      });
      for (let i = 0; i < 5; i++) {
        const angle = ((i + 0.5) / 5) * Math.PI * 2;
        const jewel = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 10, 8),
          jewelMat
        );
        jewel.position.set(
          Math.cos(angle) * 0.6,
          0.14,
          Math.sin(angle) * 0.6
        );
        group.add(jewel);
      }
      break;
    }
    case 'pirate': {
      // Tricorn pirate hat — wide brim pinched front-back + tall top
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.92, 0.08, 28),
        mat
      );
      brim.scale.z = 0.55;
      brim.position.y = 0.04;
      brim.castShadow = true;
      group.add(brim);
      // Turned-up sides (two triangular wedges)
      for (const sx of [-1, 1]) {
        const flap = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.45, 0.55),
          mat
        );
        flap.position.set(sx * 0.7, 0.22, 0);
        flap.rotation.z = sx * -0.2;
        flap.castShadow = true;
        group.add(flap);
      }
      // Tall top
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.45, 0.4),
        mat
      );
      top.position.y = 0.3;
      top.castShadow = true;
      group.add(top);
      // Skull and crossbones
      const skullMat = new THREE.MeshStandardMaterial({
        color: 0xf2f3f3,
        roughness: 0.5,
      });
      const skull = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 8),
        skullMat
      );
      skull.position.set(0, 0.32, 0.21);
      group.add(skull);
      // Crossbones
      for (const sx of [-1, 1]) {
        const bone = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6),
          skullMat
        );
        bone.position.set(0, 0.22, 0.21);
        bone.rotation.z = sx * 0.7;
        group.add(bone);
      }
      break;
    }
  }
  return group;
}

// ------------------------------------------------------------------
//  Hair factories
// ------------------------------------------------------------------

function createHair(style: HairStyle, color: number): THREE.Group | null {
  if (style === 'none') return null;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  // Lego hair pieces are thick, smooth, and completely cover the top
  // of the head with generous overhang on the sides. The head is
  // roughly 1.0–1.2u wide (after GLB scaling), so a dome radius of
  // 0.65 and side panels at ±0.6 give proper coverage.

  switch (style) {
    case 'short': {
      // Classic short Lego hair — thick rounded cap that covers the
      // whole top + clips around the sides and back.
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45),
        mat
      );
      dome.position.y = 0.04;
      dome.castShadow = true;
      group.add(dome);
      // Side volume wrapping around the head
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.45, 0.9),
          mat
        );
        side.position.set(sx * 0.55, -0.12, -0.05);
        side.castShadow = true;
        group.add(side);
      }
      // Back volume
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.4, 0.25),
        mat
      );
      back.position.set(0, -0.1, -0.45);
      back.castShadow = true;
      group.add(back);
      break;
    }
    case 'bob': {
      // Classic Lego bob cut — smooth dome + thick side panels to jaw
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
        mat
      );
      dome.castShadow = true;
      group.add(dome);
      // Side panels reaching jaw level
      for (const sx of [-1, 1]) {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.8, 0.85),
          mat
        );
        panel.position.set(sx * 0.56, -0.3, -0.05);
        panel.castShadow = true;
        group.add(panel);
      }
      // Thick back
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.75, 0.26),
        mat
      );
      back.position.set(0, -0.25, -0.48);
      back.castShadow = true;
      group.add(back);
      // Fringe bangs across the forehead
      const bangs = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.18, 0.25),
        mat
      );
      bangs.position.set(0, -0.06, 0.48);
      bangs.castShadow = true;
      group.add(bangs);
      break;
    }
    case 'long': {
      // Flowing long hair — dome + long thick back + side curtains
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
        mat
      );
      dome.castShadow = true;
      group.add(dome);
      // Long back portion reaching mid-torso
      const longBack = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.5, 0.28),
        mat
      );
      longBack.position.set(0, -0.7, -0.46);
      longBack.castShadow = true;
      group.add(longBack);
      // Side curtains
      for (const sx of [-1, 1]) {
        const strand = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 1.3, 0.7),
          mat
        );
        strand.position.set(sx * 0.56, -0.55, -0.1);
        strand.castShadow = true;
        group.add(strand);
      }
      // Fringe
      const bangs = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.15, 0.22),
        mat
      );
      bangs.position.set(0, -0.04, 0.5);
      bangs.castShadow = true;
      group.add(bangs);
      break;
    }
    case 'ponytail': {
      // Thick cap + chunky ponytail sticking out the back
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45),
        mat
      );
      dome.position.y = 0.04;
      dome.castShadow = true;
      group.add(dome);
      // Sides
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.4, 0.8),
          mat
        );
        side.position.set(sx * 0.55, -0.1, -0.05);
        side.castShadow = true;
        group.add(side);
      }
      // Ponytail — thick cylinder angled downward
      const tail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.12, 1.1, 12),
        mat
      );
      tail.position.set(0, -0.45, -0.55);
      tail.rotation.x = 0.45;
      tail.castShadow = true;
      group.add(tail);
      // Hair tie
      const tie = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.1, 14),
        new THREE.MeshStandardMaterial({ color: 0xc43030, roughness: 0.4 })
      );
      tie.position.set(0, -0.05, -0.55);
      tie.rotation.x = 0.45;
      group.add(tie);
      break;
    }
    case 'mohawk': {
      // Flat sides + tall ridge of thick plates along center
      // Base shell covering sides
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.3, 0.9),
          mat
        );
        side.position.set(sx * 0.45, -0.08, -0.05);
        side.castShadow = true;
        group.add(side);
      }
      // Mohawk ridge — 7 thick plates tapering up in center
      for (let i = 0; i < 7; i++) {
        const t = i / 6; // 0..1
        const h = 0.3 + 0.35 * Math.sin(t * Math.PI); // parabolic height
        const spike = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, h, 0.16),
          mat
        );
        spike.position.set(0, h / 2 + 0.02, -0.4 + i * 0.14);
        spike.castShadow = true;
        group.add(spike);
      }
      break;
    }
    case 'curly': {
      // Voluminous curly hair — larger spheres clustered all around
      const r = 0.22;
      const positions: number[][] = [
        // Top
        [0, 0.18, 0.3], [-0.3, 0.14, 0.22], [0.3, 0.14, 0.22],
        [0, 0.24, -0.05], [-0.25, 0.2, -0.25], [0.25, 0.2, -0.25],
        [0, 0.16, -0.4],
        // Sides
        [-0.5, -0.05, 0.1], [0.5, -0.05, 0.1],
        [-0.48, -0.05, -0.2], [0.48, -0.05, -0.2],
        [-0.42, 0.1, 0.28], [0.42, 0.1, 0.28],
        // Back
        [-0.3, -0.1, -0.42], [0.3, -0.1, -0.42], [0, -0.08, -0.5],
      ];
      for (const [px, py, pz] of positions) {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(r, 12, 10),
          mat
        );
        ball.position.set(px, py, pz);
        ball.castShadow = true;
        group.add(ball);
      }
      break;
    }
    case 'twintails': {
      // Dome cap + two thick pigtails hanging on each side
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45),
        mat
      );
      dome.position.y = 0.04;
      dome.castShadow = true;
      group.add(dome);
      // Bangs
      const bangs = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.18, 0.25), mat
      );
      bangs.position.set(0, -0.06, 0.48);
      bangs.castShadow = true;
      group.add(bangs);
      // Two tails
      for (const sx of [-1, 1]) {
        const tail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.1, 1.2, 12), mat
        );
        tail.position.set(sx * 0.55, -0.55, -0.15);
        tail.rotation.z = sx * -0.15;
        tail.castShadow = true;
        group.add(tail);
        // Hair tie
        const tie = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14),
          new THREE.MeshStandardMaterial({ color: 0xe03050, roughness: 0.4 })
        );
        tie.position.set(sx * 0.52, -0.02, -0.15);
        tie.rotation.z = sx * -0.15;
        group.add(tie);
      }
      break;
    }
    case 'updo': {
      // Elegant updo — dome + tall bun on top
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.63, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
        mat
      );
      dome.castShadow = true;
      group.add(dome);
      // Swept sides
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.5, 0.75), mat
        );
        side.position.set(sx * 0.55, -0.15, -0.1);
        side.castShadow = true;
        group.add(side);
      }
      // Bun on top-back
      const bun = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 16, 12), mat
      );
      bun.position.set(0, 0.35, -0.25);
      bun.castShadow = true;
      group.add(bun);
      // Bangs
      const bangs = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.14, 0.22), mat
      );
      bangs.position.set(0, -0.04, 0.5);
      bangs.castShadow = true;
      group.add(bangs);
      break;
    }
    case 'sidepart': {
      // Side-parted hair — asymmetric volume, more on one side
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.63, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.48),
        mat
      );
      dome.position.y = 0.02;
      dome.castShadow = true;
      group.add(dome);
      // Thicker left side (the "sweep" side)
      const leftPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.6, 0.85), mat
      );
      leftPanel.position.set(-0.52, -0.2, -0.05);
      leftPanel.castShadow = true;
      group.add(leftPanel);
      // Thinner right side
      const rightPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.45, 0.8), mat
      );
      rightPanel.position.set(0.55, -0.12, -0.05);
      rightPanel.castShadow = true;
      group.add(rightPanel);
      // Swept bangs — angled across forehead
      const bangs = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.2, 0.25), mat
      );
      bangs.position.set(-0.15, -0.04, 0.48);
      bangs.rotation.z = 0.15;
      bangs.castShadow = true;
      group.add(bangs);
      // Back
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 0.5, 0.24), mat
      );
      back.position.set(0, -0.15, -0.46);
      back.castShadow = true;
      group.add(back);
      break;
    }
    case 'pixie': {
      // Short pixie cut — compact, textured, slightly tousled
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.42),
        mat
      );
      dome.position.y = 0.06;
      dome.castShadow = true;
      group.add(dome);
      // Very short sides
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.3, 0.7), mat
        );
        side.position.set(sx * 0.52, -0.06, -0.08);
        side.castShadow = true;
        group.add(side);
      }
      // Wispy bangs — small angled piece
      const bangs = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.14, 0.22), mat
      );
      bangs.position.set(0.1, 0.0, 0.47);
      bangs.rotation.z = -0.1;
      bangs.castShadow = true;
      group.add(bangs);
      // Short back
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.28, 0.2), mat
      );
      back.position.set(0, -0.04, -0.44);
      back.castShadow = true;
      group.add(back);
      break;
    }
    case 'braid': {
      // Single thick braid down the back — dome + braided cylinder
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.64, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.48),
        mat
      );
      dome.position.y = 0.02;
      dome.castShadow = true;
      group.add(dome);
      // Side volume
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.45, 0.8), mat
        );
        side.position.set(sx * 0.55, -0.12, -0.05);
        side.castShadow = true;
        group.add(side);
      }
      // Bangs
      const bangs = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.16, 0.22), mat
      );
      bangs.position.set(0, -0.05, 0.49);
      bangs.castShadow = true;
      group.add(bangs);
      // Braid — segmented look with alternating slight offsets
      for (let i = 0; i < 8; i++) {
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.18, 0.2), mat
        );
        seg.position.set(
          (i % 2 === 0 ? 0.04 : -0.04),
          -0.1 - i * 0.16,
          -0.52
        );
        seg.castShadow = true;
        group.add(seg);
      }
      // Tie at the end
      const tie = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0xe03050, roughness: 0.4 })
      );
      tie.position.set(0, -1.35, -0.52);
      group.add(tie);
      break;
    }
    case 'afro': {
      // Big round afro — large sphere covering the whole head
      const afro = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 24, 18), mat
      );
      afro.position.y = 0.1;
      afro.castShadow = true;
      group.add(afro);
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
/** X distance from the body center to a HAND CENTER, in world units. This
 *  is the actual hand-grip half-width measured off the rigged GLB. The
 *  swing factory uses this so its chain spacing equals the rider's hand
 *  spacing exactly — chains land directly under the gripping hands. */
let characterHandX = 0;
/** Y of a SHOULDER pivot (= top of the arm bbox) in body-local space. */
let characterShoulderY = 0;
/** Length from shoulder to hand of a hanging arm, in world units. The
 *  swing ride uses this to compute the exact arm rotation that puts
 *  the hands on the chains while the rider sits back on the seat. */
let characterArmLen = 0;

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

        // Measure the rigged hand X positions (left + right) so the
        // swing factory can place its chains EXACTLY under the rider's
        // hand grip. The hands are the Cylinder.002 / Cylinder.003
        // meshes (children of the Cube.002 / Cube.004 arms).
        const normName = (s: string) => s.replace(/\./g, '');
        let leftHand: THREE.Mesh | null = null;
        let rightHand: THREE.Mesh | null = null;
        root.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh) return;
          const n = normName(m.name);
          if (n === 'Cylinder002') rightHand = m;
          else if (n === 'Cylinder003') leftHand = m;
        });
        // Find the upper-arm meshes (Cube.002 right, Cube.004 left) so
        // we can also measure the SHOULDER Y (= top of the arm bbox)
        // and derive the arm length (shoulderY - handY).
        let leftArmMesh: THREE.Mesh | null = null;
        let rightArmMesh: THREE.Mesh | null = null;
        root.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh) return;
          const n = normName(m.name);
          if (n === 'Cube002') rightArmMesh = m;
          else if (n === 'Cube004') leftArmMesh = m;
        });

        if (leftHand && rightHand) {
          const lb = new THREE.Box3().setFromObject(leftHand);
          const rb = new THREE.Box3().setFromObject(rightHand);
          const lx = (lb.min.x + lb.max.x) / 2;
          const rx = (rb.min.x + rb.max.x) / 2;
          characterHandX = (Math.abs(lx) + Math.abs(rx)) / 2;
          const handY = ((lb.min.y + lb.max.y) / 2 + (rb.min.y + rb.max.y) / 2) / 2;

          // Shoulder Y = top of the arm-mesh bbox (matching how rigLimb
          // picks the pivot). Use whichever side(s) we found.
          let shoulderY = 0;
          let shoulderCount = 0;
          if (rightArmMesh) {
            const ab = new THREE.Box3().setFromObject(rightArmMesh);
            shoulderY += ab.max.y;
            shoulderCount++;
          }
          if (leftArmMesh) {
            const ab = new THREE.Box3().setFromObject(leftArmMesh);
            shoulderY += ab.max.y;
            shoulderCount++;
          }
          if (shoulderCount > 0) {
            characterShoulderY = shoulderY / shoulderCount;
            characterArmLen = Math.max(0.1, characterShoulderY - handY);
          } else {
            // Fallback: assume the arm spans from the hand up by ~1.4u
            characterArmLen = 1.4;
            characterShoulderY = handY + characterArmLen;
          }

          console.log(
            '[GLB] hand X (world):',
            'L=', lx.toFixed(3),
            'R=', rx.toFixed(3),
            '→ |handX|=', characterHandX.toFixed(3),
            'shoulderY=', characterShoulderY.toFixed(3),
            'armLen=', characterArmLen.toFixed(3)
          );
        } else {
          console.warn('[GLB] hand meshes not found, falling back to handX=1.0');
          characterHandX = 1.0;
          characterShoulderY = 3.0;
          characterArmLen = 1.4;
        }

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

/** Half-distance from the body center to a hand center, in world units.
 *  Hand grip total width = 2 × this value. Available after
 *  loadCharacterModel resolves. */
export function getMinifigHandX(): number {
  return characterHandX;
}

/** Length from shoulder pivot to hand of a hanging arm, in world units.
 *  Used by the swing ride to compute the arm rotation that puts the
 *  hands on the chains. */
export function getMinifigArmLen(): number {
  return characterArmLen;
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

  // ----- Hat or Hair attachment -----
  // Hats take priority when BOTH hatStyle and hairStyle are set (a hat
  // covers the hair). Attach to body (not group) so it inherits the
  // body's scale/position for correct placement.
  if (headMesh) {
    body.updateMatrixWorld(true);
    const headBox = new THREE.Box3().setFromObject(headMesh);
    const headTopY = body.worldToLocal(
      new THREE.Vector3(0, headBox.max.y, 0)
    ).y;

    let headwear: THREE.Group | null = null;
    if (preset.hatStyle && preset.hatStyle !== 'none') {
      headwear = createHat(preset.hatStyle, preset.hatColor ?? 0x333333);
    } else if (preset.hairStyle && preset.hairStyle !== 'none') {
      headwear = createHair(preset.hairStyle, preset.hairColor ?? 0x3b2415);
    }
    if (headwear) {
      // Lower the hat so it sits around the head stud (not on top of it).
      // headTopY includes the stud; pull down by STUD_HEIGHT so the hat
      // encases the stud like a real Lego connection.
      headwear.position.y = headTopY - STUD_HEIGHT;
      body.add(headwear);
    }
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
    // Combined TIGHT world AABB across all sub-meshes. `precise=true`
    // walks every vertex through matrixWorld and computes the exact
    // axis-aligned bounding box; the default (precise=false) transforms
    // only the mesh's own local-bbox corners, which for rotated meshes
    // produces a LOOSE AABB whose max.y sits above the actual shoulder
    // vertices. A loose-bbox pivot is what makes the shoulder axis
    // appear to bob up and down during the arm swing — the visible mesh
    // top isn't at the pivot, so rotating the pivot traces a vertical
    // arc at the mesh's top end.
    const bbox = new THREE.Box3();
    for (const m of valid) bbox.expandByObject(m, true);
    const limbHeight = bbox.max.y - bbox.min.y;
    // Pivot at the shoulder/hip joint — slightly inside the top of the
    // limb (15% down from the top) so the rotation axis sits at the
    // joint center, not the outer surface. This keeps limbs attached
    // to the torso during large-angle swings (e.g. swimming).
    const hipWorld = new THREE.Vector3(
      (bbox.min.x + bbox.max.x) / 2,
      bbox.max.y - limbHeight * 0.15,
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

// ------------------------------------------------------------------
//  Composable face-part draw functions
//
//  Each function draws ONE part (eyes/nose/mouth/eyebrows/cheeks) onto
//  a 2D canvas at the standard layout positions. The `index` argument
//  selects a style from the corresponding FACE_* catalog in config.ts.
//  These are consumed by both the editor-driven renderer AND by
//  drawFacePartPreview (which generates tiny thumbnails for the UI).
// ------------------------------------------------------------------

interface FaceLayout {
  cx: number;
  eyeY: number;
  eyeOffset: number;
  size: number;
}

/** Shared canvas-drawing helpers — reused across all face-part draw fns. */
function faceDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color = '#000'
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function faceStroke(
  ctx: CanvasRenderingContext2D,
  fn: () => void,
  color = '#000',
  w: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  fn();
  ctx.stroke();
}

function drawFaceEyes(
  ctx: CanvasRenderingContext2D,
  index: number,
  l: FaceLayout
) {
  const { cx, eyeY, eyeOffset, size } = l;
  const lx = cx - eyeOffset;
  const rx = cx + eyeOffset;
  switch (index) {
    case 0: // 기본 — round dots
      faceDot(ctx, lx, eyeY, size * 0.048);
      faceDot(ctx, rx, eyeY, size * 0.048);
      break;
    case 1: // 큰눈 — big round eyes with shine
      faceDot(ctx, lx, eyeY, size * 0.062);
      faceDot(ctx, rx, eyeY, size * 0.062);
      faceDot(ctx, lx + size * 0.015, eyeY - size * 0.015, size * 0.018, '#fff');
      faceDot(ctx, rx + size * 0.015, eyeY - size * 0.015, size * 0.018, '#fff');
      break;
    case 2: // 반달 — happy closed arcs (^  ^)
      faceStroke(ctx, () => {
        ctx.arc(lx, eyeY + size * 0.01, size * 0.045, Math.PI, 2 * Math.PI);
      }, '#000', size * 0.028);
      faceStroke(ctx, () => {
        ctx.arc(rx, eyeY + size * 0.01, size * 0.045, Math.PI, 2 * Math.PI);
      }, '#000', size * 0.028);
      break;
    case 3: // 윙크 — left eye closed arc, right normal
      faceStroke(ctx, () => {
        ctx.arc(lx, eyeY + size * 0.01, size * 0.045, Math.PI, 2 * Math.PI);
      }, '#000', size * 0.028);
      faceDot(ctx, rx, eyeY, size * 0.05);
      faceDot(ctx, rx + size * 0.013, eyeY - size * 0.013, size * 0.014, '#fff');
      break;
    case 4: // 졸린 — half-lid (upper arc clipping the dot)
      faceDot(ctx, lx, eyeY, size * 0.045);
      faceDot(ctx, rx, eyeY, size * 0.045);
      // eyelids
      faceStroke(ctx, () => {
        ctx.moveTo(lx - size * 0.06, eyeY - size * 0.02);
        ctx.lineTo(lx + size * 0.06, eyeY - size * 0.005);
      }, '#000', size * 0.025);
      faceStroke(ctx, () => {
        ctx.moveTo(rx - size * 0.06, eyeY - size * 0.005);
        ctx.lineTo(rx + size * 0.06, eyeY - size * 0.02);
      }, '#000', size * 0.025);
      break;
    case 5: // 놀란 — wide O-shaped eyes
      faceStroke(ctx, () => {
        ctx.arc(lx, eyeY, size * 0.05, 0, Math.PI * 2);
      }, '#000', size * 0.025);
      faceStroke(ctx, () => {
        ctx.arc(rx, eyeY, size * 0.05, 0, Math.PI * 2);
      }, '#000', size * 0.025);
      faceDot(ctx, lx, eyeY, size * 0.025);
      faceDot(ctx, rx, eyeY, size * 0.025);
      break;
    case 6: // 별눈 — star sparkle
      for (const ex of [lx, rx]) {
        const r = size * 0.045;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          const o = a + Math.PI / 5;
          ctx.lineTo(ex + Math.cos(a) * r, eyeY + Math.sin(a) * r);
          ctx.lineTo(ex + Math.cos(o) * r * 0.45, eyeY + Math.sin(o) * r * 0.45);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 7: // 하트 — heart-shaped eyes
      for (const ex of [lx, rx]) {
        const s = size * 0.04;
        ctx.fillStyle = '#e03050';
        ctx.beginPath();
        ctx.moveTo(ex, eyeY + s * 1.1);
        ctx.bezierCurveTo(ex - s * 1.2, eyeY - s * 0.2, ex - s * 0.6, eyeY - s * 1.2, ex, eyeY - s * 0.4);
        ctx.bezierCurveTo(ex + s * 0.6, eyeY - s * 1.2, ex + s * 1.2, eyeY - s * 0.2, ex, eyeY + s * 1.1);
        ctx.fill();
      }
      break;
    case 8: // 선글라스 — dark visor strip
      ctx.fillStyle = '#1a1a22';
      // Bridge
      ctx.fillRect(cx - size * 0.04, eyeY - size * 0.02, size * 0.08, size * 0.04);
      // Left lens
      ctx.beginPath();
      ctx.roundRect(lx - size * 0.09, eyeY - size * 0.045, size * 0.18, size * 0.09, size * 0.02);
      ctx.fill();
      // Right lens
      ctx.beginPath();
      ctx.roundRect(rx - size * 0.09, eyeY - size * 0.045, size * 0.18, size * 0.09, size * 0.02);
      ctx.fill();
      break;
    case 9: // 눈물 — normal eyes + tear drops
      faceDot(ctx, lx, eyeY, size * 0.048);
      faceDot(ctx, rx, eyeY, size * 0.048);
      // tear on left
      ctx.fillStyle = '#5ac8f5';
      ctx.beginPath();
      ctx.moveTo(lx + size * 0.02, eyeY + size * 0.05);
      ctx.quadraticCurveTo(lx + size * 0.045, eyeY + size * 0.12, lx + size * 0.02, eyeY + size * 0.14);
      ctx.quadraticCurveTo(lx - size * 0.005, eyeY + size * 0.12, lx + size * 0.02, eyeY + size * 0.05);
      ctx.fill();
      break;
  }
}

function drawFaceNose(
  ctx: CanvasRenderingContext2D,
  index: number,
  l: FaceLayout
) {
  const { cx, size } = l;
  const noseY = size * 0.53;
  switch (index) {
    case 0: // 없음
      break;
    case 1: // 점
      faceDot(ctx, cx, noseY, size * 0.015);
      break;
    case 2: // ㄴ자
      faceStroke(ctx, () => {
        ctx.moveTo(cx, noseY - size * 0.03);
        ctx.lineTo(cx, noseY + size * 0.02);
        ctx.lineTo(cx + size * 0.025, noseY + size * 0.02);
      }, '#000', size * 0.018);
      break;
    case 3: // 둥근
      faceStroke(ctx, () => {
        ctx.arc(cx, noseY, size * 0.025, 0.2 * Math.PI, 0.8 * Math.PI);
      }, '#000', size * 0.018);
      break;
    case 4: // 삼각
      faceStroke(ctx, () => {
        ctx.moveTo(cx - size * 0.02, noseY + size * 0.015);
        ctx.lineTo(cx, noseY - size * 0.02);
        ctx.lineTo(cx + size * 0.02, noseY + size * 0.015);
      }, '#000', size * 0.015);
      break;
  }
}

function drawFaceMouth(
  ctx: CanvasRenderingContext2D,
  index: number,
  l: FaceLayout
) {
  const { cx, size } = l;
  const my = size * 0.63;
  switch (index) {
    case 0: // 미소
      faceStroke(ctx, () => {
        ctx.arc(cx, my - size * 0.04, size * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
      }, '#000', size * 0.025);
      break;
    case 1: // 활짝
      faceStroke(ctx, () => {
        ctx.arc(cx, my - size * 0.07, size * 0.16, 0.1 * Math.PI, 0.9 * Math.PI);
      }, '#000', size * 0.028);
      // teeth
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - size * 0.07, my - size * 0.01, size * 0.14, size * 0.04);
      break;
    case 2: // 일자
      faceStroke(ctx, () => {
        ctx.moveTo(cx - size * 0.08, my);
        ctx.lineTo(cx + size * 0.08, my);
      }, '#000', size * 0.025);
      break;
    case 3: // 놀란 (O-shaped)
      faceStroke(ctx, () => {
        ctx.arc(cx, my, size * 0.06, 0, Math.PI * 2);
      }, '#000', size * 0.025);
      break;
    case 4: // 혀 (tongue out)
      faceStroke(ctx, () => {
        ctx.arc(cx, my - size * 0.04, size * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
      }, '#000', size * 0.025);
      ctx.fillStyle = '#e85060';
      ctx.beginPath();
      ctx.arc(cx, my + size * 0.04, size * 0.04, 0, Math.PI);
      ctx.fill();
      break;
    case 5: // 찡그린 (frown)
      faceStroke(ctx, () => {
        ctx.arc(cx, my + size * 0.08, size * 0.12, 1.2 * Math.PI, 1.8 * Math.PI);
      }, '#000', size * 0.025);
      break;
    case 6: // 수염
      ctx.fillStyle = '#3b2415';
      ctx.beginPath();
      ctx.ellipse(cx, my - size * 0.02, size * 0.16, size * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
      faceStroke(ctx, () => {
        ctx.moveTo(cx - size * 0.06, my + size * 0.04);
        ctx.lineTo(cx + size * 0.06, my + size * 0.04);
      }, '#000', size * 0.02);
      break;
    case 7: // 뾰루퉁 (pouty)
      faceStroke(ctx, () => {
        ctx.moveTo(cx - size * 0.06, my);
        ctx.quadraticCurveTo(cx, my - size * 0.04, cx + size * 0.06, my);
      }, '#000', size * 0.028);
      break;
  }
}

function drawFaceEyebrows(
  ctx: CanvasRenderingContext2D,
  index: number,
  l: FaceLayout
) {
  const { cx, eyeY, eyeOffset, size } = l;
  const lx = cx - eyeOffset;
  const rx = cx + eyeOffset;
  const by = eyeY - size * 0.09;
  switch (index) {
    case 0: // 없음
      break;
    case 1: // 일자 (straight)
      faceStroke(ctx, () => {
        ctx.moveTo(lx - size * 0.06, by);
        ctx.lineTo(lx + size * 0.06, by);
        ctx.moveTo(rx - size * 0.06, by);
        ctx.lineTo(rx + size * 0.06, by);
      }, '#000', size * 0.028);
      break;
    case 2: // 올린 (raised inner)
      faceStroke(ctx, () => {
        ctx.moveTo(lx - size * 0.06, by);
        ctx.lineTo(lx + size * 0.06, by - size * 0.04);
        ctx.moveTo(rx - size * 0.06, by - size * 0.04);
        ctx.lineTo(rx + size * 0.06, by);
      }, '#000', size * 0.028);
      break;
    case 3: // 찡그린 (angry converging)
      faceStroke(ctx, () => {
        ctx.moveTo(lx - size * 0.07, by - size * 0.04);
        ctx.lineTo(lx + size * 0.05, by + size * 0.02);
        ctx.moveTo(rx + size * 0.07, by - size * 0.04);
        ctx.lineTo(rx - size * 0.05, by + size * 0.02);
      }, '#000', size * 0.03);
      break;
    case 4: // 굵은 (thick bushy)
      faceStroke(ctx, () => {
        ctx.moveTo(lx - size * 0.07, by);
        ctx.lineTo(lx + size * 0.07, by);
        ctx.moveTo(rx - size * 0.07, by);
        ctx.lineTo(rx + size * 0.07, by);
      }, '#000', size * 0.045);
      break;
  }
}

function drawFaceCheeks(
  ctx: CanvasRenderingContext2D,
  index: number,
  l: FaceLayout
) {
  const { cx, size } = l;
  const cy = size * 0.58;
  switch (index) {
    case 0: // 없음
      break;
    case 1: // 홍조
      ctx.fillStyle = 'rgba(255, 110, 140, 0.5)';
      ctx.beginPath();
      ctx.arc(cx - size * 0.28, cy, size * 0.06, 0, Math.PI * 2);
      ctx.arc(cx + size * 0.28, cy, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 2: // 주근깨
      ctx.fillStyle = 'rgba(140, 90, 50, 0.55)';
      for (const sx of [-1, 1]) {
        const ox = cx + sx * size * 0.22;
        for (let i = 0; i < 4; i++) {
          const fx = ox + (Math.random() - 0.5) * size * 0.08;
          const fy = cy + (Math.random() - 0.5) * size * 0.06;
          ctx.beginPath();
          ctx.arc(fx, fy, size * 0.01, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
  }
}

/** Draw a composable face from a FaceConfig onto a canvas. Used by the
 *  character editor. Each part is drawn in layer order (back to front):
 *  cheeks → eyebrows → eyes → nose → mouth. */
function drawComposableFace(
  face: FaceConfig,
  size: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const l: FaceLayout = {
    cx: size / 2,
    eyeY: size * 0.44,
    eyeOffset: size * 0.17,
    size,
  };
  drawFaceCheeks(ctx, face.cheeks, l);
  drawFaceEyebrows(ctx, face.eyebrows, l);
  drawFaceEyes(ctx, face.eyes, l);
  drawFaceNose(ctx, face.nose, l);
  drawFaceMouth(ctx, face.mouth, l);
  return canvas;
}

/** Render a single face-part preview onto a small canvas (for the
 *  editor's selectable thumbnail strips). Only the requested part is
 *  drawn so the user can see it in isolation. */
export function drawFacePartPreview(
  part: 'eyes' | 'nose' | 'mouth' | 'eyebrows' | 'cheeks',
  index: number,
  size = 48
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const l: FaceLayout = {
    cx: size / 2,
    eyeY: size * 0.44,
    eyeOffset: size * 0.17,
    size,
  };
  switch (part) {
    case 'eyes':
      drawFaceEyes(ctx, index, l);
      break;
    case 'nose':
      drawFaceNose(ctx, index, l);
      break;
    case 'mouth':
      drawFaceMouth(ctx, index, l);
      break;
    case 'eyebrows':
      drawFaceEyebrows(ctx, index, l);
      break;
    case 'cheeks':
      drawFaceCheeks(ctx, index, l);
      break;
  }
  return canvas;
}

/**
 * Draws a character-specific face onto a transparent canvas. The canvas is
 * consumed by createCharacterFace() as a THREE.CanvasTexture.
 *
 * When the preset has a `face` config (editor-driven), the composable
 * renderer is used. Otherwise falls through to the hand-tuned legacy
 * faces for the 8 built-in presets.
 */
function drawCharacterFace(
  preset: MinifigPreset,
  size: number
): HTMLCanvasElement {
  // Editor-driven composable face
  if (preset.face) {
    return drawComposableFace(preset.face, size);
  }

  // Legacy per-preset faces (preserved for the 8 built-in presets)
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

// ------------------------------------------------------------------
//  Furniture & prop blocks — visually recognizable Lego assemblies
// ------------------------------------------------------------------

/** Helper: positioned box mesh with castShadow */
function _b(
  geo: THREE.BufferGeometry,
  x: number, y: number, z: number,
  mat: THREE.Material
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function _box(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  mat: THREE.Material
): THREE.Mesh {
  return _b(new THREE.BoxGeometry(w, h, d), x, y, z, mat);
}
function _cyl(
  r: number, h: number,
  x: number, y: number, z: number,
  mat: THREE.Material, seg = 16
): THREE.Mesh {
  return _b(new THREE.CylinderGeometry(r, r, h, seg), x, y, z, mat);
}

// ---- FURNITURE ----

// 1. Chair — 2×2 footprint, 6 plates tall
function createChairBlock(_spec: BlockSpec): THREE.Group {
  const PH = PLATE_HEIGHT;
  const group = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({ color: 0xcc8833, roughness: 0.6 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xe8b84b, roughness: 0.5 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0xcc8833, roughness: 0.6 });
  // 4 thin legs at corners with 0.25 inset — visible gaps
  for (const [ox, oz] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]] as [number, number][]) {
    group.add(_box(0.5, 1.2, 0.5, ox, 0.6, oz, legMat));
  }
  // Seat plate on top of legs
  group.add(_box(2, 0.4, 2, 0, 1.4, 0, seatMat));
  // Backrest at back edge on top of seat
  group.add(_box(2, 1.2, 0.4, 0, 2.2, -0.8, backMat));
  return group;
}

// 2. Table — 4×4 footprint, 6 plates tall
function createTableBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0xcc8833, roughness: 0.5 });
  // 4 thin legs at corners with 0.3 inset
  for (const [ox, oz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]] as [number, number][]) {
    group.add(_box(0.6, 2.0, 0.6, ox, 1.0, oz, legMat));
  }
  // Tabletop
  group.add(_box(4, 0.4, 4, 0, 2.2, 0, topMat));
  return group;
}

// 3. Sofa — 4×2 footprint, 6 plates tall
function createSofaBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.6 });
  const cushMat = new THREE.MeshStandardMaterial({ color: 0xdd3333, roughness: 0.5 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x991111, roughness: 0.65 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0xaa1818, roughness: 0.65 });
  // 8×4 footprint, minifig-scale sofa (3-seater)
  const hw = 4, hd = 2;
  // Base
  group.add(_box(8, 1.0, 4, 0, 0.5, 0, baseMat));
  // 3 seat cushions with gaps between
  for (let i = -1; i <= 1; i++) {
    group.add(_box(2.3, 0.5, 3.0, i * 2.5, 1.25, 0.3, cushMat));
  }
  // Backrest
  group.add(_box(8, 1.6, 0.8, 0, 1.8, -hd + 0.4, backMat));
  // Armrests on sides
  group.add(_box(0.6, 1.2, 3.5, -hw + 0.3, 1.6, 0.15, armMat));
  group.add(_box(0.6, 1.2, 3.5, hw - 0.3, 1.6, 0.15, armMat));
  // 4 short legs
  for (const [ox, oz] of [[-hw + 0.5, -hd + 0.5], [hw - 0.5, -hd + 0.5], [-hw + 0.5, hd - 0.5], [hw - 0.5, hd - 0.5]] as [number, number][]) {
    group.add(_box(0.4, 0.3, 0.4, ox, -0.15, oz, baseMat));
  }
  return group;
}

// 4. Bed — 4×6 footprint, 4 plates tall
function createBedBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const mattMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xaaccee, roughness: 0.4 });
  const blanketMat = new THREE.MeshStandardMaterial({ color: 0xcc4444, roughness: 0.55 });
  // 6×10 footprint, minifig-scale bed
  const hw = 3, hd = 5;
  // 4 legs at corners
  for (const [ox, oz] of [[-hw + 0.3, -hd + 0.3], [hw - 0.3, -hd + 0.3], [-hw + 0.3, hd - 0.3], [hw - 0.3, hd - 0.3]] as [number, number][]) {
    group.add(_box(0.6, 0.8, 0.6, ox, 0.4, oz, frameMat));
  }
  // Frame rails (side beams)
  group.add(_box(0.5, 0.6, 10, -hw + 0.25, 0.7, 0, frameMat));
  group.add(_box(0.5, 0.6, 10, hw - 0.25, 0.7, 0, frameMat));
  // Frame slats (base)
  group.add(_box(6, 0.3, 10, 0, 0.95, 0, frameMat));
  // Mattress
  group.add(_box(5.4, 0.6, 9, 0, 1.4, 0.3, mattMat));
  // Pillow at head end
  group.add(_box(4.5, 0.5, 1.5, 0, 1.95, -hd + 1.2, pillowMat));
  // Blanket covering lower 2/3
  group.add(_box(5.2, 0.15, 6, 0, 1.78, 1.5, blanketMat));
  // Headboard
  group.add(_box(6, 2.4, 0.5, 0, 2.0, -hd + 0.25, frameMat));
  // Footboard (shorter)
  group.add(_box(6, 1.2, 0.5, 0, 1.4, hd - 0.25, frameMat));
  return group;
}

// 5. Bookshelf — 4×1 footprint, 12 plates tall
function createBookshelfBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.6 });
  const totalH = 4.8; // 12 plates
  // Side panels
  group.add(_box(0.4, totalH, 1.0, -1.8, totalH / 2, 0, woodMat));
  group.add(_box(0.4, totalH, 1.0, 1.8, totalH / 2, 0, woodMat));
  // 4 shelf plates
  const shelfYs = [0.0, 1.2, 2.4, 3.6];
  for (const sy of shelfYs) {
    group.add(_box(3.2, 0.2, 1.0, 0, sy + 0.1, 0, shelfMat));
  }
  // Top shelf
  group.add(_box(3.2, 0.2, 1.0, 0, totalH - 0.1, 0, shelfMat));
  // Books on each shelf
  const bookColors = [0x2244aa, 0xcc3333, 0x33aa44, 0xddaa22, 0x8833aa, 0x33aaaa, 0xdd6622, 0x4466bb, 0xbb2288];
  for (let si = 0; si < 3; si++) {
    const shelfTop = shelfYs[si] + 0.2;
    for (let bi = 0; bi < 4; bi++) {
      const bMat = new THREE.MeshStandardMaterial({ color: bookColors[(si * 4 + bi) % bookColors.length], roughness: 0.6 });
      group.add(_box(0.3, 0.8, 0.8, -1.2 + bi * 0.7, shelfTop + 0.4, 0, bMat));
    }
  }
  return group;
}

// 6. Desk — 4×2 footprint, 6 plates tall
function createDeskBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0xcc8833, roughness: 0.5 });
  const drawerMat = new THREE.MeshStandardMaterial({ color: 0x503018, roughness: 0.65 });
  // 2 side panels
  group.add(_box(0.5, 1.6, 2.0, -1.75, 0.8, 0, panelMat));
  group.add(_box(0.5, 1.6, 2.0, 1.75, 0.8, 0, panelMat));
  // Top surface on panels
  group.add(_box(4, 0.3, 2, 0, 1.75, 0, topMat));
  // Drawer block between panels, slightly recessed
  group.add(_box(1.5, 0.8, 1.8, 0, 0.4, 0.05, drawerMat));
  return group;
}

// 7. Cabinet — 2×2 footprint, 9 plates tall
function createCabinetBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const frontMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.55 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.6 });
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xccaa44, roughness: 0.4, metalness: 0.3 });
  const totalH = 3.6; // 9 plates
  // Body
  group.add(_box(2, totalH, 2, 0, totalH / 2, 0, bodyMat));
  // Front face slightly inset
  group.add(_box(1.8, 3.4, 0.1, 0, totalH / 2, 1.0, frontMat));
  // 3 drawer lines
  for (let i = 0; i < 3; i++) {
    const ly = 0.6 + i * 1.1;
    group.add(_box(1.6, 0.05, 0.1, 0, ly, 1.06, lineMat));
    // Small knob on each drawer
    group.add(_cyl(0.08, 0.15, 0, ly + 0.4, 1.1, knobMat, 8));
  }
  return group;
}

// 8. TV Set — 4×1 footprint, 9 plates tall
function createTvSetBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.1 });
  const displayMat = new THREE.MeshStandardMaterial({ color: 0x112244, roughness: 0.2, metalness: 0.1 });
  // Stand base
  group.add(_box(2, 0.4, 1, 0, 0.2, 0, standMat));
  // Stand neck
  group.add(_cyl(0.2, 0.8, 0, 0.8, 0, standMat));
  // Screen
  group.add(_box(4, 2.8, 0.2, 0, 2.6, 0, screenMat));
  // Display area on front
  group.add(_box(3.6, 2.4, 0.05, 0, 2.6, 0.13, displayMat));
  return group;
}

// 9. Fridge — 2×2 footprint, 15 plates tall
function createFridgeBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 });
  const freezerMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.45 });
  const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.42 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.5 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.4, metalness: 0.2 });
  const totalH = 6.0; // 15 plates
  // Main body
  group.add(_box(2, totalH, 2, 0, totalH / 2, 0, whiteMat));
  // Freezer door at top (front, slightly inset)
  group.add(_box(1.9, 1.8, 0.1, 0, totalH - 0.9, 1.0, freezerMat));
  // Fridge door below
  group.add(_box(1.9, 3.8, 0.1, 0, 2.1, 1.0, fridgeMat));
  // Divider line between doors
  group.add(_box(1.9, 0.08, 0.1, 0, 4.2, 1.0, lineMat));
  // Handles on right side of each door
  group.add(_cyl(0.05, 0.6, 0.7, 5.1, 1.1, handleMat, 8));
  group.add(_cyl(0.05, 0.6, 0.7, 2.1, 1.1, handleMat, 8));
  return group;
}

// ------------------------------------------------------------------
//  Prop blocks
// ------------------------------------------------------------------

// 10. Bench — 6×2 footprint, 4 plates tall
function createBenchBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.2 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xcc8833, roughness: 0.6 });
  // 2 leg pairs: inverted T shape
  for (const xOff of [-2, 2]) {
    // Base of T
    group.add(_box(0.8, 0.4, 1.5, xOff, 0.2, 0, legMat));
    // Vertical of T
    group.add(_box(0.3, 1.2, 0.3, xOff, 0.8, 0, legMat));
  }
  // 3 seat slats
  for (let i = 0; i < 3; i++) {
    group.add(_box(5.4, 0.2, 0.4, 0, 1.5, -0.5 + i * 0.5, seatMat));
  }
  // 2 backrest slats tilted slightly
  for (let i = 0; i < 2; i++) {
    const slat = _box(5.4, 0.2, 0.3, 0, 2.0 + i * 0.4, -0.7, seatMat);
    slat.rotation.x = -0.15;
    group.add(slat);
  }
  return group;
}

// 11. Flowerpot — 2×2 footprint, 4 plates tall
function createFlowerpotBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.7 });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.8 });
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x33aa44, roughness: 0.6 });
  // Truncated cone pot
  const pot = _b(new THREE.CylinderGeometry(0.65, 0.85, 1.0, 16), 0, 0.5, 0, potMat);
  group.add(pot);
  // Soil on top
  group.add(_cyl(0.6, 0.15, 0, 1.08, 0, soilMat));
  // Plant bush spheres
  const bush1 = _b(new THREE.SphereGeometry(0.7, 12, 10), 0, 1.8, 0, plantMat);
  group.add(bush1);
  const bush2 = _b(new THREE.SphereGeometry(0.4, 10, 8), 0.35, 2.2, 0.2, plantMat);
  group.add(bush2);
  return group;
}

// 12. Trashcan — 2×2 footprint, 6 plates tall
function createTrashcanBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5 });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.45 });
  // Cylinder body
  group.add(_cyl(0.8, 2.0, 0, 1.0, 0, bodyMat));
  // Lid slightly wider
  group.add(_cyl(0.85, 0.2, 0, 2.1, 0, lidMat));
  // Lid handle
  group.add(_box(0.3, 0.15, 0.08, 0, 2.28, 0, lidMat));
  return group;
}

// 13. Mailbox — 2×1 footprint, 9 plates tall
function createMailboxBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x2255bb, roughness: 0.5 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0x3366cc, roughness: 0.5 });
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
  // Post
  group.add(_cyl(0.15, 2.0, 0, 1.0, 0, poleMat));
  // Box on top of post
  group.add(_box(1.6, 1.2, 0.8, 0, 2.6, 0, boxMat));
  // Rounded top lip
  group.add(_box(1.7, 0.15, 0.85, 0, 3.28, 0, topMat));
  // Mail slot on front
  group.add(_box(1.0, 0.06, 0.05, 0, 2.6, 0.43, slotMat));
  return group;
}

// 14. Signpost — 2×1 footprint, 12 plates tall
function createSignpostBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5 });
  const borderMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });
  const signMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 });
  // Pole
  group.add(_cyl(0.12, 4.0, 0, 2.0, 0, poleMat));
  // Sign border (slightly larger, behind)
  group.add(_box(2.1, 1.3, 0.1, 0, 4.15, -0.05, borderMat));
  // Sign face
  group.add(_box(2, 1.2, 0.15, 0, 4.15, 0.03, signMat));
  return group;
}

// 15. Hydrant — 1×1 footprint, 5 plates tall
function createHydrantBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 });
  // Base
  group.add(_cyl(0.35, 0.3, 0, 0.15, 0, redMat));
  // Body
  group.add(_cyl(0.3, 1.2, 0, 0.75, 0, redMat));
  // Top dome
  const dome = _b(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.35, 0, redMat);
  group.add(dome);
  // Side nozzles (horizontal cylinders)
  for (const side of [-1, 1]) {
    const nozzle = _b(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8), side * 0.45, 0.9, 0, redMat);
    nozzle.rotation.z = Math.PI / 2;
    group.add(nozzle);
  }
  // Top bonnet
  group.add(_cyl(0.15, 0.15, 0, 1.6, 0, redMat));
  return group;
}

// 16. Barrel — 2×2 footprint, 6 plates tall
function createBarrelBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.7 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x5a3a10, roughness: 0.6 });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x7a5912, roughness: 0.65 });
  // Slightly tapered body
  const barrel = _b(new THREE.CylinderGeometry(0.75, 0.8, 2.2, 16), 0, 1.1, 0, woodMat);
  group.add(barrel);
  // 2 bands at 1/3 and 2/3 height
  const band1 = _b(new THREE.TorusGeometry(0.78, 0.04, 8, 24), 0, 0.73, 0, bandMat);
  band1.rotation.x = Math.PI / 2;
  group.add(band1);
  const band2 = _b(new THREE.TorusGeometry(0.78, 0.04, 8, 24), 0, 1.47, 0, bandMat);
  band2.rotation.x = Math.PI / 2;
  group.add(band2);
  // Lid
  group.add(_cyl(0.7, 0.1, 0, 2.25, 0, lidMat));
  return group;
}

// 17. Campfire — 3×3 footprint, 3 plates tall
function createCampfireBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.8 });
  const charMat = new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.9 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.7 });

  // Stone ring: 12 stones in a circle r=1.8
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const sx = Math.cos(angle) * 1.8;
    const sz = Math.sin(angle) * 1.8;
    const s = _box(0.55, 0.4, 0.5, sx, 0.2, sz, stoneMat);
    s.rotation.y = angle + 0.3;
    group.add(s);
  }

  // Charred ground base
  group.add(_cyl(1.3, 0.1, 0, 0.05, 0, charMat));

  // 8 logs: thick horizontal cylinders in a teepee-like crossed pattern
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const log = _b(new THREE.CylinderGeometry(0.18, 0.12, 2.0, 8), 0, 0.5, 0, logMat);
    log.rotation.z = Math.PI / 2 - 0.3;
    log.rotation.y = angle;
    log.position.set(
      Math.cos(angle) * 0.3,
      0.5,
      Math.sin(angle) * 0.3
    );
    group.add(log);
  }

  // Flames: many emissive cones of varying sizes — looks like roaring fire
  const flameGroup = new THREE.Group();
  flameGroup.userData.isCampfireFlame = true;
  const flameDefs: { x: number; z: number; r: number; h: number; color: number }[] = [
    { x: 0, z: 0, r: 0.35, h: 2.2, color: 0xff4400 },
    { x: 0.25, z: 0.2, r: 0.25, h: 1.8, color: 0xff6600 },
    { x: -0.3, z: 0.15, r: 0.22, h: 1.6, color: 0xff8800 },
    { x: 0.15, z: -0.25, r: 0.28, h: 2.0, color: 0xff5500 },
    { x: -0.2, z: -0.2, r: 0.2, h: 1.5, color: 0xffaa00 },
    { x: 0, z: 0.3, r: 0.18, h: 1.3, color: 0xffcc00 },
    { x: 0.35, z: -0.1, r: 0.15, h: 1.1, color: 0xffdd22 },
    { x: -0.35, z: -0.05, r: 0.18, h: 1.4, color: 0xff7700 },
  ];
  for (const f of flameDefs) {
    const mat = new THREE.MeshStandardMaterial({
      color: f.color,
      emissive: f.color,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.85,
      roughness: 0.2,
    });
    const cone = _b(new THREE.ConeGeometry(f.r, f.h, 8), f.x, 0.6 + f.h / 2, f.z, mat);
    flameGroup.add(cone);
  }
  group.add(flameGroup);

  // Point light for warm glow
  const fireLight = new THREE.PointLight(0xff6622, 5, 18);
  fireLight.position.set(0, 2.5, 0);
  group.add(fireLight);

  // Scale up to fill 8×8 footprint
  group.scale.setScalar(1.6);

  return group;
}

// 18. Fountain — 8×8 footprint, 12 plates tall
function createFountainBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6 });
  const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.65 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x3388cc,
    roughness: 0.1,
    transparent: true,
    opacity: 0.55,
    metalness: 0.1,
  });

  // Octagonal base platform
  group.add(_cyl(3.8, 0.4, 0, 0.2, 0, darkStoneMat, 8));

  // Basin wall: thick octagonal ring
  const wallR = 3.2;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const bx = Math.cos(angle) * wallR;
    const bz = Math.sin(angle) * wallR;
    const wall = _box(0.7, 1.0, 0.5, bx, 0.9, bz, stoneMat);
    wall.rotation.y = angle;
    group.add(wall);
  }

  // Basin rim (torus)
  const rim = _b(new THREE.TorusGeometry(wallR, 0.18, 8, 16), 0, 1.45, 0, stoneMat);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  // Water surface inside basin
  group.add(_cyl(2.8, 0.15, 0, 0.6, 0, waterMat, 24));

  // Center pillar — tiered
  group.add(_cyl(0.5, 1.2, 0, 1.0, 0, stoneMat, 8));  // bottom tier
  group.add(_cyl(0.35, 1.0, 0, 1.9, 0, stoneMat, 8));  // middle tier

  // Middle bowl
  group.add(_b(new THREE.CylinderGeometry(0.8, 0.3, 0.35, 12), 0, 2.55, 0, stoneMat));
  // Water in middle bowl
  group.add(_cyl(0.65, 0.08, 0, 2.62, 0, waterMat, 12));

  // Top pillar
  group.add(_cyl(0.2, 0.8, 0, 3.1, 0, stoneMat, 8));

  // Top bowl (small)
  group.add(_b(new THREE.CylinderGeometry(0.45, 0.15, 0.25, 10), 0, 3.6, 0, stoneMat));

  // Water jets — multiple translucent cones shooting upward
  const jetGroup = new THREE.Group();
  jetGroup.userData.isFountainJet = true;
  const jetMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    emissive: 0x4488cc,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.5,
    roughness: 0.05,
  });
  // Main center jet
  jetGroup.add(_b(new THREE.ConeGeometry(0.06, 1.2, 8), 0, 4.3, 0, jetMat));
  // Side jets from middle bowl
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const jx = Math.cos(a) * 0.5;
    const jz = Math.sin(a) * 0.5;
    jetGroup.add(_b(new THREE.ConeGeometry(0.04, 0.6, 6), jx, 3.0, jz, jetMat));
  }
  // Falling water streams from middle bowl edge (downward cylinders)
  const streamMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.3,
    roughness: 0.05,
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const sx = Math.cos(a) * 0.7;
    const sz = Math.sin(a) * 0.7;
    jetGroup.add(_cyl(0.03, 1.6, sx, 1.7, sz, streamMat, 6));
  }
  group.add(jetGroup);

  // Scale up to fill 12×12 footprint
  group.scale.setScalar(1.5);

  return group;
}

// 19. Traffic Cone — 1×1 footprint, 3 plates tall
function createTrafficConeBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.5 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  // Black base
  group.add(_box(0.9, 0.15, 0.9, 0, 0.075, 0, baseMat));
  // Orange cone
  group.add(_b(new THREE.ConeGeometry(0.3, 1.0, 12), 0, 0.65, 0, orangeMat));
  // White stripe at mid height
  group.add(_cyl(0.28, 0.1, 0, 0.55, 0, stripeMat, 12));
  return group;
}

// 20. Barricade — 4×1 footprint, 6 plates tall
function createBarricadeBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.5 });
  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.5 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  // 2 A-frame legs at ends
  for (const xOff of [-1.5, 1.5]) {
    // Left leg of A
    const legL = _box(0.2, 2.0, 0.15, xOff - 0.3, 1.0, 0, frameMat);
    legL.rotation.z = 0.15;
    group.add(legL);
    // Right leg of A
    const legR = _box(0.2, 2.0, 0.15, xOff + 0.3, 1.0, 0, frameMat);
    legR.rotation.z = -0.15;
    group.add(legR);
    // A crossbar
    group.add(_box(0.6, 0.15, 0.15, xOff, 0.6, 0, frameMat));
  }
  // Horizontal bar across top: alternating orange/white stripes
  group.add(_box(2, 0.3, 0.15, -1, 2.2, 0, orangeMat));
  group.add(_box(2, 0.3, 0.15, 1, 2.2, 0, whiteMat));
  return group;
}

// 21. Well — 4×4 footprint, 9 plates tall
function createWellBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xc2a870, roughness: 0.8 });
  const bucketMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6 });
  // Base
  group.add(_cyl(1.8, 0.4, 0, 0.2, 0, stoneMat));
  // Wall: 8 boxes octagonal
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const wx = Math.cos(angle) * 1.5;
    const wz = Math.sin(angle) * 1.5;
    const wall = _box(0.6, 1.6, 0.4, wx, 1.2, wz, stoneMat);
    wall.rotation.y = angle;
    group.add(wall);
  }
  // 2 vertical posts
  group.add(_box(0.3, 3.0, 0.3, 0, 1.9, -1.0, woodMat));
  group.add(_box(0.3, 3.0, 0.3, 0, 1.9, 1.0, woodMat));
  // Crossbar at top
  group.add(_box(0.3, 0.3, 2.5, 0, 3.55, 0, woodMat));
  // Rope hanging from crossbar
  group.add(_cyl(0.04, 1.2, 0, 2.8, 0, ropeMat, 6));
  // Bucket at rope bottom
  group.add(_box(0.4, 0.35, 0.4, 0, 2.03, 0, bucketMat));
  return group;
}

// 22. Tent — 6×6 footprint, 12 plates tall
function createTentBlock(_spec: BlockSpec): THREE.Group {
  const group = new THREE.Group();
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xc2b280, roughness: 0.7, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a3a10, roughness: 0.7 });
  const totalH = 4.8; // 12 plates
  // 4 corner poles
  group.add(_cyl(0.15, totalH, -2.85, totalH / 2, -2.85, poleMat, 8));
  group.add(_cyl(0.15, totalH, 2.85, totalH / 2, -2.85, poleMat, 8));
  group.add(_cyl(0.15, totalH, -2.85, totalH / 2, 2.85, poleMat, 8));
  group.add(_cyl(0.15, totalH, 2.85, totalH / 2, 2.85, poleMat, 8));
  // Ridge pole along z-axis at top
  const ridge = _b(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), 0, totalH, 0, poleMat);
  ridge.rotation.x = Math.PI / 2;
  group.add(ridge);
  // 2 canvas slopes tilted ±35 degrees from ridge
  const slopeAngle = 35 * Math.PI / 180;
  const leftSlope = _box(6.0, 0.08, 3.5, -1.4, totalH - 0.9, 0, canvasMat);
  leftSlope.rotation.z = slopeAngle;
  group.add(leftSlope);
  const rightSlope = _box(6.0, 0.08, 3.5, 1.4, totalH - 0.9, 0, canvasMat);
  rightSlope.rotation.z = -slopeAngle;
  group.add(rightSlope);
  // Back wall: tall thin box approximating triangle
  group.add(_box(5.5, totalH * 0.8, 0.08, 0, totalH * 0.4, -2.85, canvasMat));
  return group;
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
