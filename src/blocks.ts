import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GRID, PLATE_HEIGHT } from './config';
import type { BlockType, HatStyle, MinifigPreset } from './config';
import characterModelUrl from './model/people.glb?url';

export interface BlockSpec {
  w: number;
  d: number;
  colorHex: number;
  type?: BlockType;
}

const STUD_GEOMETRY = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 20);

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
        topY + 0.1,
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
    default:
      group = createBoxBlock(spec, 'brick');
  }
  group.userData.isBrick = true;
  group.userData.spec = { ...spec, type };
  return group;
}

function createBoxBlock(
  spec: BlockSpec,
  type: 'brick' | 'plate' | 'tile'
): THREE.Group {
  const group = new THREE.Group();
  const width = spec.w * GRID.X;
  const depth = spec.d * GRID.Z;
  const bodyHeight = type === 'brick' ? 3 * PLATE_HEIGHT : PLATE_HEIGHT;
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
            h + 0.1,
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
            h + 0.1,
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
  stud.position.set(0, h + 0.1, 0);
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
  const h = 9 * PLATE_HEIGHT;
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

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width - 2 * t - 0.02, innerH - 0.02, 0.08),
      slabMat
    );
    slab.position.set(0, innerCenterY, 0);
    slab.castShadow = true;
    group.add(slab);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      knobMat
    );
    knob.position.set(width / 2 - t - 0.18, innerCenterY, 0.08);
    group.add(knob);
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
 * Cached, normalized clone-source for the character GLB body
 * (built-in feet and built-in hat removed; remaining body scaled to fit
 *  target dimensions). loadCharacterModel() must complete before
 * createMinifigure() runs.
 */
let characterBodyTemplate: THREE.Group | null = null;
/** Top of the GLB body in the new minifig's local space — anchors hats. */
let characterTopY = 0;

/** Each procedural foot is exactly 1 stud × 1 stud × FOOT_H, at x=±0.5. */
const FOOT_H = 0.32;
/** Target X width of the loaded GLB body (slightly wider than the 2-stud
 *  footprint so the arms stick out a touch — that's normal for minifigs). */
const TARGET_BODY_X = 2.4;
/** Target Y height of the loaded GLB body (excluding feet and hat).
 *  Picked so foot 0.32 + body 4.0 + typical hat ≈ 4.8 ≈ 4 brick-heights. */
const TARGET_BODY_Y = 4.0;

/**
 * Loads `src/model/people.glb` once and prepares a clone-source body:
 *   - removes the GLB's built-in cube hat (`Cube.001`) so per-preset hats
 *     can replace it
 *   - removes the GLB's curve-based "feet" (`BezierCurve`/`BezierCurve.001`)
 *     so the procedural 1×1 stud block feet stand alone
 *   - scales the remaining body NON-uniformly to TARGET_BODY_X × TARGET_BODY_Y
 *     (with Z scaled identically to X), so the chibi GLB becomes a tall
 *     minifig that fits the 2-stud footprint
 *   - shifts so the body bottom rests on top of the procedural feet
 *   - centers the body on XZ
 * Subsequent calls are no-ops.
 */
export function loadCharacterModel(): Promise<void> {
  if (characterBodyTemplate) return Promise.resolve();
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      characterModelUrl,
      (gltf) => {
        const root = gltf.scene;

        // Strip parts that the procedural code overrides.
        for (const name of ['Cube.001', 'BezierCurve', 'BezierCurve.001']) {
          const obj = root.getObjectByName(name);
          if (obj && obj.parent) obj.parent.remove(obj);
        }

        // Shadows for everything that's left.
        root.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });

        // Wrap in a parent so scale + position can be set cleanly.
        const wrapper = new THREE.Group();
        wrapper.add(root);
        wrapper.updateMatrixWorld(true);

        const bbox = new THREE.Box3().setFromObject(wrapper);
        const size = new THREE.Vector3();
        bbox.getSize(size);

        // Non-uniform scale: X & Z share one factor (preserving cross-section
        // proportions); Y has its own factor so we can stretch the chibi
        // GLB into a tall minifig regardless of its native aspect ratio.
        const sx = size.x > 0 ? TARGET_BODY_X / size.x : 1;
        const sy = size.y > 0 ? TARGET_BODY_Y / size.y : 1;
        wrapper.scale.set(sx, sy, sx);
        wrapper.updateMatrixWorld(true);

        // Re-bbox after scaling, then position so body bottom = FOOT_H
        // (sits on top of the procedural feet) and center on XZ.
        const bbox2 = new THREE.Box3().setFromObject(wrapper);
        wrapper.position.x -= (bbox2.min.x + bbox2.max.x) / 2;
        wrapper.position.y += FOOT_H - bbox2.min.y;
        wrapper.position.z -= (bbox2.min.z + bbox2.max.z) / 2;
        wrapper.updateMatrixWorld(true);

        const finalBox = new THREE.Box3().setFromObject(wrapper);
        characterTopY = finalBox.max.y;
        characterBodyTemplate = wrapper;
        resolve();
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/** Total minifig height in world units (feet + body + space for a small
 *  hat). Used by Game for collision/eye height. Available after the GLB
 *  has been loaded. */
export function getMinifigHeight(): number {
  return characterTopY > 0 ? characterTopY + 0.6 : FOOT_H + TARGET_BODY_Y + 0.6;
}

/**
 * Creates a Lego minifigure: procedural 1×1 stud block feet at the bottom
 * + cloned GLB body on top + procedural hat. Origin at BOTTOM CENTER
 * (feet stand at y=0). Faces +Z. Footprint: 2 studs wide × 1 stud deep.
 *
 * `loadCharacterModel()` MUST be awaited before this is called.
 */
export function createMinifigure(preset: MinifigPreset): THREE.Group {
  if (!characterBodyTemplate) {
    throw new Error(
      'character model not loaded; call loadCharacterModel() and await it before createMinifigure()'
    );
  }

  const group = new THREE.Group();

  // ---------- Procedural feet (1 stud × 1 stud each) ----------
  const footMat = new THREE.MeshStandardMaterial({
    color: preset.pantsHex,
    roughness: 0.5,
  });
  const footGeom = new THREE.BoxGeometry(1.0, FOOT_H, 1.0);
  const leftFoot = new THREE.Mesh(footGeom, footMat);
  leftFoot.position.set(-0.5, FOOT_H / 2, 0);
  leftFoot.castShadow = true;
  leftFoot.receiveShadow = true;
  group.add(leftFoot);

  const rightFoot = new THREE.Mesh(footGeom, footMat);
  rightFoot.position.set(0.5, FOOT_H / 2, 0);
  rightFoot.castShadow = true;
  rightFoot.receiveShadow = true;
  group.add(rightFoot);

  // ---------- GLB body (clone + per-instance materials) ----------
  const body = characterBodyTemplate.clone(true);
  body.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    if (Array.isArray(m.material)) {
      m.material = m.material.map((mat) => mat.clone());
    } else {
      m.material = (m.material as THREE.Material).clone();
    }
  });

  // Recolor by mesh name (best-guess mapping from GLB node inspection;
  // fix here if visual inspection shows the wrong part is wearing a color):
  //   Cube      → torso (shirt)
  //   Cube.002  → arm   (shirt)
  //   Cube.004  → arm   (shirt)
  //   Cylinder  → head  (skin)
  //   everything else → pants
  const SHIRT_NAMES = new Set(['Cube', 'Cube.002', 'Cube.004']);
  const SKIN_NAMES = new Set(['Cylinder']);
  body.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat.color) return;
    if (SHIRT_NAMES.has(m.name)) {
      mat.color.setHex(preset.shirtHex);
    } else if (SKIN_NAMES.has(m.name)) {
      mat.color.setHex(preset.headHex ?? 0xf5cd30);
    } else {
      mat.color.setHex(preset.pantsHex);
    }
  });

  group.add(body);

  // ---------- Hat ----------
  const hat = createHat(preset.hatStyle, preset.hatColor ?? preset.shirtHex);
  if (hat) {
    hat.position.y = characterTopY;
    group.add(hat);
  } else {
    // Default: a chunky cube hat (replaces the GLB's removed Cube.001).
    const s = 1.0;
    const cubeHat = new THREE.Mesh(
      new THREE.BoxGeometry(s, s, s),
      new THREE.MeshStandardMaterial({
        color: preset.shirtHex,
        roughness: 0.5,
      })
    );
    cubeHat.position.y = characterTopY + s / 2;
    cubeHat.castShadow = true;
    group.add(cubeHat);
  }

  group.userData.isBrick = true;
  group.userData.isMinifig = true;
  return group;
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
