import * as THREE from 'three';
import { clamp, fbm2D, lerp, mulberry32 } from './noise';
import {
  DamageFieldData,
  DISTANT_PLANT_POS,
  FACTORY_CENTER,
  WEIR_POS,
} from './damageField';
import { FOSSIL_SITES } from './fossilSites';
import { RestorationSystem } from './restoration';
import {
  DRY_RIVER_SAMPLES,
  getDryRiverInfo,
  getLivingRiverInfo,
  getTerrainHeight,
  getTerrainSlope,
  getVitality,
  PLUNGE_POOL_CENTER,
  TREE_CENTER,
  WATERFALL_BOTTOM,
} from './terrainData';
import { WorldTextures } from './textures';

export interface ScarredDetailsSystem {
  group: THREE.Group;
  update: (time: number, dt: number, restoration?: RestorationSystem) => void;
  getBurningTreeHitMeshes: () => THREE.Object3D[];
  getBurningStatus: () => { total: number; extinguished: number; recovering: number };
  resetFireStates: () => void;
}

// Clean geometry merger preserving position, normal & uv
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let off = 0;

  for (const g of parts) {
    const src = g.index ? g.toNonIndexed() : g;
    src.computeVertexNormals();
    const p = src.attributes.position;
    const n = src.attributes.normal;
    const u = src.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      indices.push(off + i);
    }
    off += p.count;
    g.dispose();
    if (src !== g) src.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  return out;
}

function buildSculptedRockGeometry(seed: number, detail = 2): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.0, detail);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n1 = fbm2D(x * 1.4 + seed, z * 1.4 + y * 1.1, 3);
    const n2 = fbm2D(y * 2.5 - seed, x * 2.1 + z * 1.9, 2);
    const flatBottom = y < -0.2 ? 0.65 : 1.0;
    const disp = 0.78 + n1 * 0.36 + n2 * 0.14;
    pos.setXYZ(i, x * disp, y * disp * 0.76 * flatBottom, z * disp);
  }
  geo.computeVertexNormals();
  return geo;
}

// Monumental fluted buttress tree stump
function buildFelledStumpGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.48, 0.86, 1.55, 13, 5);
  geo.translate(0, 0.62, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const flare = Math.max(0, 1 - y / 0.95);
    const buttress = 1 + Math.sin(ang * 6.0) * 0.30 * flare + Math.cos(ang * 3.0) * 0.12 * flare;
    let ny = y;
    const isTop = y > 1.32;
    if (isTop) {
      ny += x * 0.14 + Math.sin(ang * 4.0) * 0.08;
    }
    pos.setXYZ(i, x * buttress, ny, z * buttress);

    if (isTop) {
      colors[i * 3] = 1.25;
      colors[i * 3 + 1] = 1.14;
      colors[i * 3 + 2] = 1.00;
    } else {
      const sootBase = lerp(0.45, 0.82, clamp(y / 1.25, 0, 1));
      colors[i * 3] = sootBase;
      colors[i * 3 + 1] = sootBase * 0.94;
      colors[i * 3 + 2] = sootBase * 0.88;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// ============================================================================
// ARCHETYPE A: MONUMENTAL BURNED CONIFER / GIANT PINE SKELETON (18.5m base height!)
// Matches the realistic height & majestic proportions of the living eastern forest!
// ============================================================================
function buildBurnedConiferSkeletonGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = 18.5;
  const trunk = new THREE.CylinderGeometry(0.14, 0.72, h, 9, 9);
  trunk.translate(0, h * 0.48, 0);
  const pos = trunk.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = clamp(y / h, 0, 1);
    const ang = Math.atan2(z, x);
    const flare = Math.pow(Math.max(0, 1 - t * 4.2), 1.6);
    const buttress = 1 + Math.sin(ang * 6.0) * 0.34 * flare;
    const crookX = Math.sin(t * 2.8) * 0.42;
    const crookZ = Math.cos(t * 2.3) * 0.34;
    const jag = t > 0.92 ? Math.sin(ang * 5.0) * 0.75 : 0;
    pos.setXYZ(i, x * buttress + crookX, y + jag, z * buttress + crookZ);
  }
  parts.push(trunk);

  // 14 irregular drooping/broken charred conifer boughs radiating in tiered whorls
  const tiers = [
    { y: 5.2, r: 0.16, len: 4.2, count: 3, offset: 0.2 },
    { y: 7.8, r: 0.14, len: 3.8, count: 3, offset: 1.3 },
    { y: 10.4, r: 0.12, len: 3.2, count: 3, offset: 2.5 },
    { y: 12.9, r: 0.10, len: 2.5, count: 3, offset: 0.8 },
    { y: 15.2, r: 0.08, len: 1.7, count: 2, offset: 1.9 },
  ];

  for (const tier of tiers) {
    for (let k = 0; k < tier.count; k++) {
      const ang = tier.offset + (k / tier.count) * Math.PI * 2 + (k % 2) * 0.35;
      const bLen = tier.len * (0.72 + ((k * 37) % 10) * 0.045);
      const b = new THREE.CylinderGeometry(tier.r * 0.22, tier.r, bLen, 5, 2);
      b.translate(0, bLen * 0.48, 0);
      // Droop slightly outward like charred alpine pine boughs
      b.rotateZ(1.18 + (k % 2) * 0.18);
      b.rotateY(ang);
      b.translate(0, tier.y, 0);
      parts.push(b);

      // Broken secondary twig fork on lower main boughs
      if (tier.y < 11.5 && k % 2 === 0) {
        const sub = new THREE.CylinderGeometry(0.025, tier.r * 0.52, bLen * 0.48, 4, 1);
        sub.translate(0, bLen * 0.24, 0);
        sub.rotateZ(0.75);
        sub.rotateY(ang + 0.55);
        sub.translate(Math.sin(ang) * bLen * 0.45, tier.y - 0.35, Math.cos(ang) * bLen * 0.45);
        parts.push(sub);
      }
    }
  }

  return mergeParts(parts);
}

// ============================================================================
// ARCHETYPE B: ENORMOUS CHARRED BROADLEAF GIANT HUSK (15.5m base height!)
// Thick gnarled trunk forking into sweeping skeletal charred limbs
// ============================================================================
function buildBurnedBroadleafGiantGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.6, 0),
    new THREE.Vector3(0.25, 2.8, -0.15),
    new THREE.Vector3(-0.2, 6.2, 0.2),
    new THREE.Vector3(0.15, 9.2, -0.1),
  ]);
  const trunk = new THREE.TubeGeometry(trunkCurve, 10, 0.72, 9, false);
  // Taper & flare root base
  const tPos = trunk.attributes.position;
  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i);
    const y = tPos.getY(i);
    const z = tPos.getZ(i);
    const t = clamp(y / 9.2, 0, 1);
    const ang = Math.atan2(z, x);
    const scaleR = lerp(1.38, 0.62, t) * (1 + Math.sin(ang * 5) * 0.25 * Math.pow(1 - t, 2));
    tPos.setXYZ(i, x * scaleR, y, z * scaleR);
  }
  parts.push(trunk);

  // 5 Sweeping Gnarled Skeletal Primary Boughs + Forked Dead Limbs
  const boughs = [
    { ang: 0.2, y0: 6.4, reach: 5.8, rise: 5.6, r: 0.34 },
    { ang: 1.55, y0: 7.4, reach: 5.2, rise: 6.4, r: 0.30 },
    { ang: 2.85, y0: 6.8, reach: 6.0, rise: 5.0, r: 0.32 },
    { ang: 4.15, y0: 7.9, reach: 4.9, rise: 6.8, r: 0.28 },
    { ang: 5.4, y0: 8.5, reach: 4.2, rise: 7.2, r: 0.26 },
  ];

  for (const b of boughs) {
    const dx = Math.cos(b.ang);
    const dz = Math.sin(b.ang);
    const p0 = new THREE.Vector3(0, b.y0, 0);
    const p1 = new THREE.Vector3(dx * b.reach * 0.45, b.y0 + b.rise * 0.52, dz * b.reach * 0.45);
    const p2 = new THREE.Vector3(dx * b.reach, b.y0 + b.rise, dz * b.reach);
    const limbCurve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const limb = new THREE.TubeGeometry(limbCurve, 7, b.r * 0.65, 6, false);
    parts.push(limb);

    // Secondary jagged fork
    const forkAng = b.ang + 0.58;
    const fp1 = p1.clone().add(new THREE.Vector3(Math.cos(forkAng) * 2.8, 2.4, Math.sin(forkAng) * 2.8));
    const subCurve = new THREE.CatmullRomCurve3([p1, p1.clone().lerp(fp1, 0.5).add(new THREE.Vector3(0, 0.5, 0)), fp1]);
    parts.push(new THREE.TubeGeometry(subCurve, 5, b.r * 0.34, 5, false));
  }

  return mergeParts(parts);
}

// ============================================================================
// MASSIVE FALLEN CHARRED TREE TRUNK WITH BROKEN LIMBS & SPLINTERED BASE (12.5m!)
// ============================================================================
function buildMassiveFallenGiantGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const len = 12.6;
  const trunk = new THREE.CylinderGeometry(0.26, 0.68, len, 9, 9);
  trunk.rotateZ(Math.PI * 0.5);
  const pos = trunk.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const bendY = Math.sin(x * 0.32) * 0.22;
    const bendZ = Math.cos(x * 0.25) * 0.32;
    // Root flare at the thick end (x < -4.5)
    const endT = clamp((-x - 4.0) / 2.3, 0, 1);
    const flare = 1 + endT * 0.42;
    pos.setXYZ(i, x, y * flare + bendY, z * flare + bendZ);
  }
  parts.push(trunk);

  // 3 Broken charred limbs jutting organically from the fallen giant
  const stubs = [
    { x: 1.4, angZ: 0.65, angY: 0.5, len: 3.1, r: 0.16 },
    { x: 3.2, angZ: -0.52, angY: -0.7, len: 2.6, r: 0.13 },
    { x: -1.8, angZ: 0.45, angY: 1.1, len: 2.2, r: 0.17 },
  ];
  for (const s of stubs) {
    const limb = new THREE.CylinderGeometry(s.r * 0.25, s.r, s.len, 5, 1);
    limb.translate(0, s.len * 0.48, 0);
    limb.rotateZ(s.angZ);
    limb.rotateY(s.angY);
    limb.translate(s.x, 0.18, 0);
    parts.push(limb);
  }

  return mergeParts(parts);
}

// Organic uprooted tree base with curved gnarled roots
function buildUpturnedRootBallGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stub = new THREE.CylinderGeometry(0.32, 0.52, 2.8, 8, 3);
  stub.rotateZ(Math.PI * 0.46);
  stub.translate(1.2, 0.42, 0);
  parts.push(stub);

  const disc = new THREE.CylinderGeometry(1.25, 1.35, 0.44, 10, 2);
  disc.rotateZ(Math.PI * 0.48);
  const dPos = disc.attributes.position;
  for (let i = 0; i < dPos.count; i++) {
    const x = dPos.getX(i);
    const y = dPos.getY(i);
    const z = dPos.getZ(i);
    const n = fbm2D(y * 1.8 + 1.2, z * 1.8 - 0.7, 2);
    dPos.setXYZ(i, x * (0.85 + n * 0.35), Math.max(-0.18, y * (0.78 + n * 0.3) + 0.68), z * (0.85 + n * 0.35));
  }
  parts.push(disc);

  for (let i = 0; i < 6; i++) {
    const a = -1.35 + (i / 5) * 2.7;
    const len = 1.55 + (i % 2) * 0.45;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.1, 0.62, 0),
      new THREE.Vector3(-0.42, 0.72 + Math.cos(a) * 0.65, Math.sin(a) * 0.72),
      new THREE.Vector3(-0.72, Math.max(0.05, 0.55 + Math.cos(a) * len * 0.72), Math.sin(a) * len * 0.9),
    ]);
    parts.push(new THREE.TubeGeometry(curve, 6, 0.105, 5, false));
  }

  return mergeParts(parts);
}

// Scorched lacy skeletal canopy card assembly matching the monumental burned conifer (18.5m)
function buildBurnedConiferCanopyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = [
    { y: 6.2, r: 4.4, count: 4, tilt: -0.45 },
    { y: 9.2, r: 3.9, count: 4, tilt: -0.42 },
    { y: 12.2, r: 3.2, count: 3, tilt: -0.36 },
    { y: 15.0, r: 2.3, count: 3, tilt: -0.28 },
  ];
  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];
    for (let c = 0; c < tier.count; c++) {
      const ang = (c / tier.count) * Math.PI * 2 + t * 0.85;
      const card = new THREE.PlaneGeometry(tier.r * 1.6, tier.r * 1.45);
      card.rotateX(tier.tilt);
      card.rotateY(ang);
      card.translate(Math.sin(ang) * tier.r * 0.45, tier.y, Math.cos(ang) * tier.r * 0.45);
      parts.push(card);
    }
  }
  // Jagged scorched crown spire cards
  for (let k = 0; k < 2; k++) {
    const top = new THREE.PlaneGeometry(2.6, 4.2);
    top.rotateY(k * Math.PI * 0.5 + 0.3);
    top.translate(0, 16.8, 0);
    parts.push(top);
  }
  return mergeParts(parts);
}

// Tangled scorched skeletal crown web matching the giant burned broadleaf husk (15.5m)
function buildBurnedBroadleafCanopyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const centers: Array<[number, number, number, number]> = [
    [0.0, 14.5, 0.0, 5.2],
    [4.6, 11.8, 1.2, 4.4],
    [-4.4, 12.2, 1.6, 4.5],
    [0.4, 11.6, -4.6, 4.4],
    [-3.2, 13.8, -2.6, 4.0],
    [3.4, 13.6, -2.2, 3.9],
  ];
  for (const [cx, cy, cz, sc] of centers) {
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(sc * 1.28, sc * 1.22);
      p.rotateY(k * Math.PI * 0.5 + cx * 0.4);
      p.rotateX((k === 0 ? 1 : -1) * 0.25);
      p.translate(cx, cy, cz);
      parts.push(p);
    }
  }
  return mergeParts(parts);
}

// ============================================================================
// ANATOMICALLY COHERENT, DISCOVERABLE FOSSILIZED SKELETAL LANDMARKS
// Sculpted dorsal vertebrae, flattened tapering curved ribs, ancient skull & limb bones
// partially embedded in geological sediment
// ============================================================================
function buildFlattenedRibGeometry(
  pts: THREE.Vector3[],
  baseRadius: number,
  tipRadius: number,
  segments = 14
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(segments, false);
  const radial = 8;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const r = lerp(baseRadius, tipRadius, Math.pow(t, 0.85));
    // Realistic oval/flattened anatomical rib cross-section (wider front-to-back, thinner inside-out)
    const rx = r * 1.35;
    const ry = r * 0.72;
    const N = frames.normals[i];
    const B = frames.binormals[i];

    for (let j = 0; j <= radial; j++) {
      const u = j / radial;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      n.set(0, 0, 0)
        .addScaledVector(N, cosT * rx)
        .addScaledVector(B, sinT * ry);
      positions.push(p.x + n.x, p.y + n.y, p.z + n.z);
      n.normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(u, t * 3.0);
    }
  }

  const stride = radial + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildAncientFossilSkull(scale: number, boneMat: THREE.Material, darkCavityMat: THREE.Material): THREE.Group {
  const skull = new THREE.Group();

  // Elongated weathered ancient cranium & snout arch
  const snoutGeo = new THREE.CylinderGeometry(0.32 * scale, 0.92 * scale, 3.2 * scale, 10, 4);
  snoutGeo.rotateZ(-Math.PI * 0.5);
  const sPos = snoutGeo.attributes.position;
  for (let i = 0; i < sPos.count; i++) {
    const x = sPos.getX(i);
    const y = sPos.getY(i);
    const z = sPos.getZ(i);
    // Flatten skull vertically & taper brow ridge organically
    const yFlat = y * 0.72 + Math.sin((x / (1.6 * scale)) * 1.4) * 0.14 * scale;
    sPos.setXYZ(i, x, yFlat, z * 0.86);
  }
  snoutGeo.computeVertexNormals();
  const cranium = new THREE.Mesh(snoutGeo, boneMat);
  cranium.position.set(0.4 * scale, 0.55 * scale, 0);
  cranium.castShadow = true;
  cranium.receiveShadow = true;
  skull.add(cranium);

  // Heavy weathered brow/zygomatic arches & dark recessed orbital hollows (solemn ancient megafauna silhouette)
  for (const side of [-1, 1]) {
    const orbit = new THREE.Mesh(new THREE.SphereGeometry(0.34 * scale, 8, 8), darkCavityMat);
    orbit.scale.set(1.25, 0.85, 0.55);
    orbit.position.set(-0.35 * scale, 0.72 * scale, side * 0.62 * scale);
    skull.add(orbit);

    const brow = new THREE.Mesh(
      buildFlattenedRibGeometry(
        [
          new THREE.Vector3(-1.05 * scale, 0.45 * scale, side * 0.65 * scale),
          new THREE.Vector3(-0.35 * scale, 1.05 * scale, side * 0.78 * scale),
          new THREE.Vector3(0.45 * scale, 0.75 * scale, side * 0.58 * scale),
        ],
        0.13 * scale,
        0.09 * scale,
        8
      ),
      boneMat
    );
    brow.castShadow = true;
    skull.add(brow);

    // Sweeping weathered lower mandible jawbone half-buried in cracked earth
    const jaw = new THREE.Mesh(
      buildFlattenedRibGeometry(
        [
          new THREE.Vector3(-1.05 * scale, 0.05 * scale, side * 0.72 * scale),
          new THREE.Vector3(0.15 * scale, -0.05 * scale, side * 0.58 * scale),
          new THREE.Vector3(1.85 * scale, 0.15 * scale, side * 0.18 * scale),
        ],
        0.16 * scale,
        0.10 * scale,
        10
      ),
      boneMat
    );
    jaw.castShadow = true;
    skull.add(jaw);
  }

  return skull;
}

function createFossilSite(
  centerX: number,
  centerZ: number,
  yaw: number,
  scale: number,
  ribCount: number,
  includeSkull: boolean,
  boneMat: THREE.Material,
  darkCavityMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  const baseY = getTerrainHeight(centerX, centerZ);
  g.position.set(centerX, baseY, centerZ);
  g.rotation.y = yaw;

  const spineLen = ribCount * 1.18 * scale;
  const spinePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const lx = (t - 0.5) * spineLen;
    const lz = Math.sin(t * Math.PI * 1.25) * 1.75 * scale;
    // Spine arches organically out of the dry sediment & dips partially underground at ends
    const ly = Math.sin(t * Math.PI) * 0.65 * scale - 0.18 * scale;
    spinePts.push(new THREE.Vector3(lx, ly, lz));
  }
  const spineCurve = new THREE.CatmullRomCurve3(spinePts);

  // Articulated Sculpted Vertebrae (centrum + vertical dorsal neural spine + transverse spurs)
  const vertCount = Math.round(ribCount * 1.9);
  for (let i = 0; i < vertCount; i++) {
    const t = i / (vertCount - 1);
    const p = spineCurve.getPoint(t);
    const tan = spineCurve.getTangent(t);
    const env = Math.sin(t * Math.PI) * 0.65 + 0.35;

    const vGroup = new THREE.Group();
    vGroup.position.copy(p);
    vGroup.rotation.y = -Math.atan2(tan.z, tan.x);

    const centrum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24 * env * scale, 0.28 * env * scale, 0.48 * scale, 8),
      boneMat
    );
    centrum.rotation.z = Math.PI * 0.5;
    centrum.castShadow = true;
    centrum.receiveShadow = true;
    vGroup.add(centrum);

    // Dorsal neural spine ridge
    const dorsal = new THREE.Mesh(
      new THREE.BoxGeometry(0.22 * scale, 0.62 * env * scale, 0.12 * scale),
      boneMat
    );
    dorsal.position.set(0, 0.38 * env * scale, 0);
    dorsal.rotation.z = -0.22;
    dorsal.castShadow = true;
    vGroup.add(dorsal);

    g.add(vGroup);
  }

  // Broad, Flattened, Anatomically Tapering Arched Ribs
  for (let i = 0; i < ribCount; i++) {
    const t = lerp(0.14, 0.82, i / Math.max(1, ribCount - 1));
    const p = spineCurve.getPoint(t);
    const tan = spineCurve.getTangent(t);
    const env = Math.sin(((t - 0.1) / 0.76) * Math.PI) * 0.72 + 0.28;
    const ribH = (2.1 + env * 2.25) * scale;
    const ribReach = (1.55 + env * 1.45) * scale;

    const nx = -tan.z;
    const nz = tan.x;
    const nLen = Math.hypot(nx, nz) || 1;
    const px = nx / nLen;
    const pz = nz / nLen;

    // Primary towering arched rib (occasional fractured tip for geological realism)
    const broken = i % 4 === 2 ? 0.72 : 1.0;
    const rPts = [
      p.clone().add(new THREE.Vector3(0, -0.22 * scale, 0)),
      p.clone().add(new THREE.Vector3(px * ribReach * 0.55, ribH * 0.65, pz * ribReach * 0.55)),
      p.clone().add(new THREE.Vector3(px * ribReach * 0.96 * broken, ribH * 0.94 * broken, pz * ribReach * 0.96 * broken)),
      p.clone().add(new THREE.Vector3(px * ribReach * 0.38 * broken, ribH * (broken < 1 ? 0.88 : 1.08), pz * ribReach * 0.38 * broken)),
    ];
    const ribMesh = new THREE.Mesh(
      buildFlattenedRibGeometry(rPts, 0.16 * env * scale, 0.065 * env * scale, 12),
      boneMat
    );
    ribMesh.castShadow = true;
    ribMesh.receiveShadow = true;
    g.add(ribMesh);

    // Companion opposite rib emerging partially from the cracked alkali sediment
    if (i % 2 === 0 || i === 1) {
      const oppPts = [
        p.clone().add(new THREE.Vector3(0, -0.26 * scale, 0)),
        p.clone().add(new THREE.Vector3(-px * ribReach * 0.52, ribH * 0.38, -pz * ribReach * 0.52)),
        p.clone().add(new THREE.Vector3(-px * ribReach * 0.88, ribH * 0.54, -pz * ribReach * 0.88)),
      ];
      const oppMesh = new THREE.Mesh(
        buildFlattenedRibGeometry(oppPts, 0.14 * env * scale, 0.065 * env * scale, 9),
        boneMat
      );
      oppMesh.castShadow = true;
      oppMesh.receiveShadow = true;
      g.add(oppMesh);
    }
  }

  // Partially buried weathered Scapula / Pelvis & Femur Limb resting naturally beside the ribcage
  const hipPt = spineCurve.getPoint(0.22);
  const femur = new THREE.Mesh(
    buildFlattenedRibGeometry(
      [
        hipPt.clone().add(new THREE.Vector3(-0.6 * scale, -0.1 * scale, -1.2 * scale)),
        hipPt.clone().add(new THREE.Vector3(-1.4 * scale, 0.25 * scale, -2.5 * scale)),
        hipPt.clone().add(new THREE.Vector3(-2.3 * scale, -0.15 * scale, -3.7 * scale)),
      ],
      0.24 * scale,
      0.19 * scale,
      8
    ),
    boneMat
  );
  femur.castShadow = true;
  femur.receiveShadow = true;
  g.add(femur);

  // Ancient Fossilized Cranium & Mandible Arch at the forward end of hero specimens
  if (includeSkull) {
    const headPt = spineCurve.getPoint(0.95);
    const headTan = spineCurve.getTangent(0.95);
    const skull = buildAncientFossilSkull(scale * 1.15, boneMat, darkCavityMat);
    skull.position.copy(headPt).add(new THREE.Vector3(headTan.x * 1.4 * scale, -0.12 * scale, headTan.z * 1.4 * scale));
    skull.rotation.y = -Math.atan2(headTan.z, headTan.x) + 0.18;
    skull.rotation.z = -0.12;
    g.add(skull);
  }

  return g;
}

// Charred blistered alligator-skin bark material with razor-thin, slow-pulsing recessed ember cracks
function createSmolderingBarkMaterial(
  textures: WorldTextures,
  uTime: { value: number },
  maxGlowLocalY: number
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: textures.charredBarkMap,
    normalMap: textures.charredBarkNormal,
    normalScale: new THREE.Vector2(1.8, 1.8),
    color: new THREE.Color('#201c1b'),
    roughness: 0.96,
    metalness: 0.04,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uBarkTex = { value: textures.charredBarkMap };
    shader.uniforms.uMaxGlowY = { value: maxGlowLocalY };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aFireHeat;
        attribute float aWetChar;
        varying vec3 vCharWorld;
        varying float vLocalY;
        varying vec2 vBarkUv;
        varying float vFireHeat;
        varying float vWetChar;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLocalY = position.y;
        vBarkUv = uv;
        vFireHeat = aFireHeat;
        vWetChar = aWetChar;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vCharWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vCharWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uBarkTex;
        uniform float uMaxGlowY;
        varying vec3 vCharWorld;
        varying float vLocalY;
        varying vec2 vBarkUv;
        varying float vFireHeat;
        varying float vWetChar;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Extinguished & watered charred bark visibly darkens into wet glistening charcoal while keeping ash structure!
        float wetDark = mix(1.0, 0.56, vWetChar);
        diffuseColor.rgb *= vec3(0.38, 0.35, 0.34) * wetDark;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.96, 0.44, vWetChar * 0.85);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (vFireHeat > 0.01) {
          vec3 barkSample = texture2D(uBarkTex, vBarkUv * vec2(2.6, 2.8)).rgb;
          float barkVal = dot(barkSample, vec3(0.33, 0.45, 0.22));
          float deepCrevice = 1.0 - smoothstep(0.030, 0.095, barkVal);
          float twist = sin(vBarkUv.y * 16.0 + vCharWorld.x * 0.7) * 0.42;
          float veinWave = abs(sin((vBarkUv.x * 22.0 + twist) * 3.14159));
          float fineCrack = pow(clamp(1.0 - veinWave, 0.0, 1.0), 15.0);
          float emberVein = clamp(deepCrevice * 0.55 + fineCrack * (0.45 + 0.55 * deepCrevice), 0.0, 1.0);

          float hNorm = clamp(vLocalY / max(uMaxGlowY, 0.5), 0.0, 1.0);
          float heightBand = smoothstep(0.02, 0.16, hNorm) * (1.0 - smoothstep(0.42, 0.88, hNorm));
          float pocket = sin(vCharWorld.x * 2.3 + vCharWorld.y * 1.9) * cos(vCharWorld.z * 2.1 - vCharWorld.y * 1.4);
          float pocketMask = smoothstep(0.24, 0.78, pocket * 0.5 + 0.5);
          float slowPulse = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.95 + vCharWorld.x * 0.6 + vCharWorld.z * 0.5 + vLocalY * 0.7));

          float emberMask = emberVein * heightBand * pocketMask * slowPulse * vFireHeat;
          vec3 emberColor = mix(vec3(0.85, 0.10, 0.01), vec3(1.85, 0.36, 0.04), emberVein * slowPulse);
          totalEmissiveRadiance += emberColor * emberMask * 0.88;
        }`
      );
  };

  return mat;
}

// Wide-ranging GPU-instanced slow drifting ash flakes blowing across the entire western burned expanse
function createDriftingAshInstancedMesh(uTime: { value: number }): THREE.InstancedMesh {
  const count = 720;
  const rand = mulberry32(3032029);

  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    -0.07, -0.045, 0,
     0.08, -0.02, 0,
     0.055,  0.07, 0,
    -0.045,  0.055, 0,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const seeds = new Float32Array(count * 4);
  const dummy = new THREE.Object3D();

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      attribute vec4 aAshSeed;
      varying float vLightness;
      varying float vFade;

      void main() {
        vLightness = aAshSeed.w;
        vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float s = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));

        float t = uTime * aAshSeed.x + aAshSeed.y;
        vec3 drift = vec3(
          mod(uTime * (0.95 + aAshSeed.x * 0.75) + aAshSeed.y * 18.0, 56.0) - 28.0,
          sin(t * 0.85) * 1.8 - mod(uTime * (0.32 + aAshSeed.x * 0.24) + aAshSeed.y * 8.0, 18.0) + 9.0,
          cos(t * 0.62) * 3.8 + sin(t * 0.34) * 2.2
        );

        float a1 = t * aAshSeed.z;
        float a2 = t * (aAshSeed.z * 0.72 + 0.4);
        float c1 = cos(a1), s1 = sin(a1);
        float c2 = cos(a2), s2 = sin(a2);
        vec3 p = position * s;
        p = vec3(p.x * c1 - p.z * s1, p.y, p.x * s1 + p.z * c1);
        p = vec3(p.x, p.y * c2 - p.z * s2, p.y * s2 + p.z * c2);

        vec3 worldP = instPos + drift + p;
        vec4 mvPos = modelViewMatrix * vec4(worldP, 1.0);
        float dist = max(1.0, -mvPos.z);
        vFade = smoothstep(165.0, 30.0, dist) * smoothstep(2.0, 6.0, dist);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vLightness;
      varying float vFade;
      void main() {
        vec3 charcoal = vec3(0.10, 0.095, 0.095);
        vec3 paleAsh = vec3(0.70, 0.65, 0.58);
        vec3 col = mix(charcoal, paleAsh, vLightness);
        float alpha = vFade * mix(0.68, 0.54, vLightness);
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;

  for (let i = 0; i < count; i++) {
    const x = -12 - rand() * 175;
    const z = -98 + rand() * 185;
    const y = getTerrainHeight(x, z) + 2.5 + rand() * 20.0;
    const sc = 0.72 + rand() * 1.25;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    seeds[i * 4] = 0.35 + rand() * 0.55;
    seeds[i * 4 + 1] = rand() * Math.PI * 2;
    seeds[i * 4 + 2] = 0.9 + rand() * 1.6;
    seeds[i * 4 + 3] = rand() > 0.45 ? 0.85 : 0.1;
  }
  geo.setAttribute('aAshSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function createScarredAndRockyDetails(
  textures: WorldTextures,
  damageField?: DamageFieldData
): ScarredDetailsSystem {
  const group = new THREE.Group();
  group.name = 'RocksAndScarredDetails';

  const rand = mulberry32(601995);
  const dummy = new THREE.Object3D();
  const uTime = { value: 0 };

  const isBlockedByStructure = (x: number, z: number): boolean => {
    if (Math.hypot(x - FACTORY_CENTER.x, z - FACTORY_CENTER.y) < 34.0) return true;
    if (Math.hypot(x - DISTANT_PLANT_POS.x, z - DISTANT_PLANT_POS.y) < 28.0) return true;
    if (Math.hypot(x - WEIR_POS.x, z - WEIR_POS.y) < 13.5) return true;
    return false;
  };

  // =========================================================================
  // 1. PRESERVED HEALTHY WATERFALL & SANCTUARY BOULDERS + SCARRED OUTCROPS
  // =========================================================================
  const rockGeo = buildSculptedRockGeometry(4.2, 2);

  const mossyRockMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.86,
    metalness: 0.03,
  });
  mossyRockMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockWN;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vRockWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockWN;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float topMoss = smoothstep(0.45, 0.82, vRockWN.y);
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.78, vec3(0.12, 0.25, 0.08), topMoss * 0.74);`
      );
  };

  const dryRockMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    normalScale: new THREE.Vector2(1.3, 1.3),
    color: new THREE.Color('#665e56'),
    roughness: 0.94,
    metalness: 0.02,
  });

  const mossyRockMats: THREE.Matrix4[] = [];
  const dryRockMats: THREE.Matrix4[] = [];

  for (let i = 0; i < 65 && mossyRockMats.length < 36; i++) {
    const a = -0.15 + (i / 65) * Math.PI * 1.3;
    const r = 9.0 + rand() * 8.5;
    const x = PLUNGE_POOL_CENTER.x + Math.cos(a) * r;
    const z = PLUNGE_POOL_CENTER.y + Math.sin(a) * r;
    if (z < -39.2) continue;
    const y = getTerrainHeight(x, z);
    if (y > 5.2 || getTerrainSlope(x, z) > 0.42) continue;
    const sx = 1.2 + rand() * 2.6;
    const sy = 0.85 + rand() * 1.85;
    const sz = 1.2 + rand() * 2.5;
    dummy.position.set(x, y - sy * 0.44, z);
    dummy.rotation.set(rand() * 0.45, rand() * Math.PI * 2, rand() * 0.45);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mossyRockMats.push(dummy.matrix.clone());
  }

  for (let i = 0; i < 10; i++) {
    const x = WATERFALL_BOTTOM.x + (rand() - 0.5) * 10.5;
    const z = WATERFALL_BOTTOM.z + 0.6 + rand() * 3.8;
    const s = 1.1 + rand() * 1.75;
    dummy.position.set(x, 1.85 + rand() * 0.5, z);
    dummy.rotation.set(rand() * 0.4, rand() * Math.PI, rand() * 0.4);
    dummy.scale.set(s * 1.25, s * 0.68, s);
    dummy.updateMatrix();
    mossyRockMats.push(dummy.matrix.clone());
  }

  for (let i = 0; i < 24; i++) {
    const a = rand() * Math.PI * 2;
    const r = 5.5 + rand() * 10.5;
    const x = TREE_CENTER.x + Math.cos(a) * r;
    const z = TREE_CENTER.y + Math.sin(a) * r;
    const y = getTerrainHeight(x, z);
    const s = 0.65 + rand() * 1.45;
    dummy.position.set(x, y - s * 0.32, z);
    dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
    dummy.scale.set(s * 1.25, s * 0.72, s);
    dummy.updateMatrix();
    if (getVitality(x, z) > 0.45) mossyRockMats.push(dummy.matrix.clone());
    else dryRockMats.push(dummy.matrix.clone());
  }

  for (let i = 0; i < 340; i++) {
    const x = (rand() * 2 - 1) * 150;
    const z = (rand() * 2 - 1) * 130;
    if (Math.hypot(x, z) < 11) continue;
    const y = getTerrainHeight(x, z);
    if (y > 32 || getTerrainSlope(x, z) > 0.28) continue;
    const vit = getVitality(x, z);
    const riv = getLivingRiverInfo(x, z);
    const dry = getDryRiverInfo(x, z);

    const nearLivingBank = Math.abs(riv.dist - riv.width) < 3.5;
    const inDryBed = dry.dist < dry.width + 2.0 && x < 6;
    if (!nearLivingBank && !inDryBed && rand() > (vit > 0.5 ? 0.36 : 0.16)) continue;

    const s = inDryBed ? 0.35 + rand() * 0.9 : 0.65 + rand() * 2.1;
    dummy.position.set(x, y - s * 0.38, z);
    dummy.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
    dummy.scale.set(s * (0.9 + rand() * 0.45), s * (0.55 + rand() * 0.35), s * (0.9 + rand() * 0.45));
    dummy.updateMatrix();

    if (vit > 0.5 && !inDryBed) mossyRockMats.push(dummy.matrix.clone());
    else dryRockMats.push(dummy.matrix.clone());
  }

  const mossyRocks = new THREE.InstancedMesh(rockGeo, mossyRockMat, mossyRockMats.length);
  mossyRocks.castShadow = true;
  mossyRocks.receiveShadow = true;
  for (let i = 0; i < mossyRockMats.length; i++) mossyRocks.setMatrixAt(i, mossyRockMats[i]);
  mossyRocks.instanceMatrix.needsUpdate = true;

  const dryRocks = new THREE.InstancedMesh(rockGeo, dryRockMat, dryRockMats.length);
  dryRocks.castShadow = true;
  dryRocks.receiveShadow = true;
  for (let i = 0; i < dryRockMats.length; i++) dryRocks.setMatrixAt(i, dryRockMats[i]);
  dryRocks.instanceMatrix.needsUpdate = true;
  group.add(mossyRocks, dryRocks);

  // =========================================================================
  // 2. AN ENORMOUS BURNED FOREST — BLISTERED CHARRED BARK + SCORCHED SKELETAL CANOPIES
  //    Matching the 14m–25m scale of the living eastern forest, immediately readable as BURNED!
  // =========================================================================
  const burnedConiferGeo = buildBurnedConiferSkeletonGeometry();
  const burnedBroadGeo = buildBurnedBroadleafGiantGeometry();
  const burnedConiferCanopyGeo = buildBurnedConiferCanopyGeometry();
  const burnedBroadCanopyGeo = buildBurnedBroadleafCanopyGeometry();

  const charredForestMat = new THREE.MeshStandardMaterial({
    map: textures.charredBarkMap,
    normalMap: textures.charredBarkNormal,
    normalScale: new THREE.Vector2(1.75, 1.75),
    color: new THREE.Color('#6b635c'),
    roughness: 0.96,
  });

  const burnedCanopyMat = new THREE.MeshStandardMaterial({
    map: textures.burnedCanopyMap,
    alphaTest: 0.28,
    side: THREE.DoubleSide,
    roughness: 0.95,
    color: new THREE.Color('#ffffff'),
  });

  const coniferMats: THREE.Matrix4[] = [];
  const coniferCols: THREE.Color[] = [];
  const broadMats: THREE.Matrix4[] = [];
  const broadCols: THREE.Color[] = [];

  const colSootBlack = new THREE.Color('#1a1716');
  const colAshWood = new THREE.Color('#4a433d');
  const colWeatheredChar = new THREE.Color('#342e2a');

  // Populate ~175 monumental burned conifer skeletons (14m–25m tall!) across vast western groves & mountain slopes!
  for (let attempt = 0; attempt < 4800 && coniferMats.length < 175; attempt++) {
    const x = -20 - rand() * 195;
    const z = -128 + rand() * 238;
    if (isBlockedByStructure(x, z)) continue;
    if (damageField?.isOnLoggingTrail(x, z)) continue;
    if (damageField?.isInDriedReservoir(x, z)) continue;
    // Keep Phase 2 foreground restoration clearing & Ancient Heart foreground eye-line unobstructed
    if (Math.hypot(x - -24.5, z - 20.5) < 19.5) continue;
    if (x > -40 && x < -10 && z > 22 && z < 56) continue;

    const vit = getVitality(x, z);
    if (vit > 0.44) continue;
    const y = getTerrainHeight(x, z);
    if (y < 1.2 || y > 56 || getTerrainSlope(x, z) > 0.34) continue;

    // Dense organic groves via damageField's burned forest cluster density
    const density = damageField ? damageField.getBurnedForestDensity(x, z) : 0.6;
    if (rand() > 0.12 + density * 0.88) continue;

    const sH = 0.78 + rand() * 0.64; // 14.4m to 26.2m tall — matches living eastern conifers!
    const sW = sH * (0.85 + rand() * 0.32);
    dummy.position.set(x, y - 0.55, z);
    dummy.rotation.set((rand() - 0.5) * 0.11, rand() * Math.PI * 2, (rand() - 0.5) * 0.11);
    dummy.scale.set(sW, sH, sW);
    dummy.updateMatrix();
    coniferMats.push(dummy.matrix.clone());
    coniferCols.push(colSootBlack.clone().lerp(rand() > 0.5 ? colAshWood : colWeatheredChar, rand() * 0.65));
  }

  // Populate ~72 enormous charred broadleaf giant husks (12m–21m tall!) in burned woodland valleys
  for (let attempt = 0; attempt < 2600 && broadMats.length < 72; attempt++) {
    const x = -22 - rand() * 175;
    const z = -105 + rand() * 205;
    if (isBlockedByStructure(x, z)) continue;
    if (damageField?.isOnLoggingTrail(x, z)) continue;
    if (damageField?.isInDriedReservoir(x, z)) continue;
    if (Math.hypot(x - -24.5, z - 20.5) < 21.0) continue;
    if (x > -42 && x < -10 && z > 20 && z < 56) continue;

    if (getVitality(x, z) > 0.42) continue;
    const y = getTerrainHeight(x, z);
    if (y < 1.4 || y > 36 || getTerrainSlope(x, z) > 0.28) continue;

    const density = damageField ? damageField.getBurnedForestDensity(x, z) : 0.6;
    if (rand() > 0.15 + density * 0.85) continue;

    const sH = 0.82 + rand() * 0.52; // 12.7m to 20.7m tall!
    const sW = sH * (0.88 + rand() * 0.30);
    dummy.position.set(x, y - 0.45, z);
    dummy.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
    dummy.scale.set(sW, sH, sW);
    dummy.updateMatrix();
    broadMats.push(dummy.matrix.clone());
    broadCols.push(colSootBlack.clone().lerp(colAshWood, rand() * 0.55));
  }

  const burnedConifers = new THREE.InstancedMesh(burnedConiferGeo, charredForestMat, coniferMats.length);
  burnedConifers.castShadow = true;
  burnedConifers.receiveShadow = true;
  const burnedConiferCanopies = new THREE.InstancedMesh(burnedConiferCanopyGeo, burnedCanopyMat, coniferMats.length);
  burnedConiferCanopies.castShadow = true;
  for (let i = 0; i < coniferMats.length; i++) {
    burnedConifers.setMatrixAt(i, coniferMats[i]);
    burnedConifers.setColorAt(i, coniferCols[i]);
    burnedConiferCanopies.setMatrixAt(i, coniferMats[i]);
  }
  burnedConifers.instanceMatrix.needsUpdate = true;
  burnedConiferCanopies.instanceMatrix.needsUpdate = true;
  if (burnedConifers.instanceColor) burnedConifers.instanceColor.needsUpdate = true;

  const burnedBroadleafs = new THREE.InstancedMesh(burnedBroadGeo, charredForestMat, broadMats.length);
  burnedBroadleafs.castShadow = true;
  burnedBroadleafs.receiveShadow = true;
  const burnedBroadCanopies = new THREE.InstancedMesh(burnedBroadCanopyGeo, burnedCanopyMat, broadMats.length);
  burnedBroadCanopies.castShadow = true;
  for (let i = 0; i < broadMats.length; i++) {
    burnedBroadleafs.setMatrixAt(i, broadMats[i]);
    burnedBroadleafs.setColorAt(i, broadCols[i]);
    burnedBroadCanopies.setMatrixAt(i, broadMats[i]);
  }
  burnedBroadleafs.instanceMatrix.needsUpdate = true;
  burnedBroadCanopies.instanceMatrix.needsUpdate = true;
  if (burnedBroadleafs.instanceColor) burnedBroadleafs.instanceColor.needsUpdate = true;

  group.add(burnedConifers, burnedConiferCanopies, burnedBroadleafs, burnedBroadCanopies);

  // =========================================================================
  // 3. MASSIVE FALLEN CHARRED TREE TRUNKS (~92 fallen giants with blistered charred bark!)
  // =========================================================================
  const fallenGiantGeo = buildMassiveFallenGiantGeometry();
  const fallenWoodMat = new THREE.MeshStandardMaterial({
    map: textures.charredBarkMap,
    normalMap: textures.charredBarkNormal,
    normalScale: new THREE.Vector2(1.6, 1.6),
    color: new THREE.Color('#6e655e'),
    roughness: 0.96,
  });

  const fallenMats: THREE.Matrix4[] = [];

  // Expressive foreground fallen giants leading the eye toward the Ancient Tree
  const heroLogs = [
    { x: -19.5, z: 27.5, rotY: 0.52, s: 0.72 },
    { x: -29.0, z: 7.5, rotY: 1.18, s: 0.88 },
    { x: -39.0, z: 21.5, rotY: 0.25, s: 0.76 },
  ];
  for (const hl of heroLogs) {
    const y = getTerrainHeight(hl.x, hl.z);
    dummy.position.set(hl.x, y + 0.18, hl.z);
    dummy.rotation.set(0.03, hl.rotY, 0.04);
    dummy.scale.setScalar(hl.s);
    dummy.updateMatrix();
    fallenMats.push(dummy.matrix.clone());
  }

  for (let attempt = 0; attempt < 2200 && fallenMats.length < 92; attempt++) {
    const x = -18 - rand() * 175;
    const z = -105 + rand() * 195;
    if (isBlockedByStructure(x, z)) continue;
    if (damageField?.isOnLoggingTrail(x, z)) continue;
    if (damageField?.isInDriedReservoir(x, z)) continue;
    if (getVitality(x, z) > 0.42) continue;
    const y = getTerrainHeight(x, z);
    if (y > 38 || getTerrainSlope(x, z) > 0.26) continue;

    const s = 0.68 + rand() * 0.72; // ~8.5m to 17.5m massive fallen trunks!
    dummy.position.set(x, y + 0.22 * s, z);
    const fallYaw = (rand() > 0.4 ? 0.52 : -0.78) + (rand() - 0.5) * 1.3;
    dummy.rotation.set((rand() - 0.5) * 0.1, fallYaw, (rand() - 0.5) * 0.1);
    dummy.scale.set(s * (0.85 + rand() * 0.35), s, s);
    dummy.updateMatrix();
    fallenMats.push(dummy.matrix.clone());
  }

  const fallenGiants = new THREE.InstancedMesh(fallenGiantGeo, fallenWoodMat, fallenMats.length);
  fallenGiants.castShadow = true;
  fallenGiants.receiveShadow = true;
  for (let i = 0; i < fallenMats.length; i++) fallenGiants.setMatrixAt(i, fallenMats[i]);
  fallenGiants.instanceMatrix.needsUpdate = true;
  group.add(fallenGiants);

  // =========================================================================
  // 4. OCCASIONAL ENORMOUS SURVIVING ANCIENT STUMPS & CLEAR-CUT STUMPS (~135 total)
  // =========================================================================
  const stumpGeo = buildFelledStumpGeometry();
  const stumpMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    normalMap: textures.barkNormal,
    color: new THREE.Color('#5c5148'),
    roughness: 0.95,
    vertexColors: true,
  });

  const stumpMats: THREE.Matrix4[] = [];
  for (let attempt = 0; attempt < 2600 && stumpMats.length < 135; attempt++) {
    const x = -14 - rand() * 170;
    const z = -98 + rand() * 188;
    if (isBlockedByStructure(x, z)) continue;
    if (damageField?.isOnLoggingTrail(x, z)) continue;
    if (damageField?.isInDriedReservoir(x, z)) continue;

    const vit = getVitality(x, z);
    if (vit > 0.44) continue;
    const dry = getDryRiverInfo(x, z);
    if (dry.dist < dry.width * 0.92) continue;
    const y = getTerrainHeight(x, z);
    if (y < 1.0 || y > 38 || getTerrainSlope(x, z) > 0.28) continue;

    // 1 in 4 stumps is an ENORMOUS surviving ancient fluted stump (2m–3.2m wide!)
    const isMonumental = stumpMats.length < 36;
    const s = isMonumental ? 1.55 + rand() * 1.15 : 0.72 + rand() * 0.95;
    dummy.position.set(x, y - 0.24, z);
    dummy.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
    dummy.scale.set(s, s * (0.65 + rand() * 0.95), s);
    dummy.updateMatrix();
    stumpMats.push(dummy.matrix.clone());
  }

  const stumps = new THREE.InstancedMesh(stumpGeo, stumpMat, stumpMats.length);
  stumps.castShadow = true;
  stumps.receiveShadow = true;
  for (let i = 0; i < stumpMats.length; i++) stumps.setMatrixAt(i, stumpMats[i]);
  stumps.instanceMatrix.needsUpdate = true;
  group.add(stumps);

  // =========================================================================
  // 5. INTERACTIVE BURNING & SMOLDERING TREES + STUMPS
  //    Water extinguishes flames, fades ember veins, dissipates dark smoke, wets charred bark,
  //    and gradually introduces subtle root & lower-branch recovery shoots (preserving charred trunk!)
  // =========================================================================
  const smolderGiantMat = createSmolderingBarkMaterial(textures, uTime, 9.5);
  const smolderStumpMat = createSmolderingBarkMaterial(textures, uTime, 2.2);

  // 12 Monumental Hero Burning/Smoldering Burned Giants across the western landscape
  const heroEmberGiants: Array<[number, number, number, number]> = [
    [-31.5, 11.5, 0.82, 0.4],
    [-39.0, 2.5, 1.02, 1.8],
    [-46.5, 10.5, 0.96, 3.1],
    [-28.0, -14.0, 0.94, 0.9],
    [-58.0, 6.5, 1.15, 2.4],
    [-45.0, 34.5, 0.88, 4.2],
    [-68.0, 12.0, 1.12, 5.1],
    [-35.0, 32.5, 0.78, 1.3],
    [-52.0, -24.0, 1.08, 2.9],
    [-78.0, -12.0, 1.18, 0.6],
    [-86.0, 22.0, 1.05, 3.8],
    [-64.0, -38.0, 1.12, 1.5],
  ];

  // Clone geometry so per-instance fire/wet attributes stay cleanly isolated on the burning giants
  const burningGiantGeo = burnedConiferGeo.clone();
  const giantFireHeat = new Float32Array(heroEmberGiants.length).fill(1.0);
  const giantWetChar = new Float32Array(heroEmberGiants.length).fill(0.0);
  const giantFireAttr = new THREE.InstancedBufferAttribute(giantFireHeat, 1);
  const giantWetAttr = new THREE.InstancedBufferAttribute(giantWetChar, 1);
  burningGiantGeo.setAttribute('aFireHeat', giantFireAttr);
  burningGiantGeo.setAttribute('aWetChar', giantWetAttr);

  const smolderGiantsMesh = new THREE.InstancedMesh(burningGiantGeo, smolderGiantMat, heroEmberGiants.length);
  smolderGiantsMesh.castShadow = true;
  smolderGiantsMesh.receiveShadow = true;
  const smolderGiantCanopies = new THREE.InstancedMesh(burnedConiferCanopyGeo, burnedCanopyMat, heroEmberGiants.length);
  smolderGiantCanopies.castShadow = true;

  // Restrained, realistic flickering flame tongues nestled at charred trunk scars (die down smoothly when watered!)
  const buildCrossedFlameGeo = () => {
    const p1 = new THREE.PlaneGeometry(1.45, 2.6, 1, 3);
    p1.translate(0, 1.25, 0);
    const p2 = new THREE.PlaneGeometry(1.45, 2.6, 1, 3);
    p2.translate(0, 1.25, 0);
    p2.rotateY(Math.PI * 0.5);
    return mergeParts([p1, p2]);
  };
  const flameGeo = buildCrossedFlameGeo();
  const createFlameMaterial = (seedOffset: number) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uHeat: { value: 1.0 },
        uSeed: { value: seedOffset },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        uniform float uHeat;
        uniform float uSeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          float h = clamp(uv.y, 0.0, 1.0);
          p.y *= (0.15 + 0.85 * uHeat);
          p.xz *= (0.35 + 0.65 * uHeat);
          p.x += sin(uTime * 6.5 + uSeed + h * 4.5) * 0.16 * h * uHeat;
          p.z += cos(uTime * 5.2 - uSeed + h * 4.0) * 0.14 * h * uHeat;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uHeat;
        uniform float uSeed;
        varying vec2 vUv;
        void main() {
          if (uHeat <= 0.02) discard;
          float x = abs(vUv.x * 2.0 - 1.0);
          float y = vUv.y;
          float flicker = sin(y * 9.0 - uTime * 8.5 + uSeed) * 0.14 + cos(y * 15.0 - uTime * 12.0 + uSeed * 2.0) * 0.07;
          float taper = clamp(1.0 - y * 0.92 + flicker, 0.0, 1.0);
          float shape = smoothstep(taper * 0.72, 0.08, x) * smoothstep(0.0, 0.18, y) * (1.0 - smoothstep(0.65, 1.0, y));
          if (shape < 0.04) discard;
          vec3 coreCol = vec3(1.0, 0.82, 0.32);
          vec3 outerCol = vec3(0.92, 0.24, 0.03);
          vec3 col = mix(outerCol, coreCol, smoothstep(0.25, 0.85, shape * (1.0 - y * 0.55)));
          float alpha = shape * uHeat * 0.78;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

  // Subtle post-extinguish recovery shoots geometry (root ferns & small lower-branch sprout sprays!)
  const buildRecoverySproutGeo = () => {
    const cards: THREE.BufferGeometry[] = [];
    // Fresh shoots hugging the charred root collar
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const p = new THREE.PlaneGeometry(1.4, 1.3);
      p.translate(0, 0.6, 0);
      p.rotateY(a);
      p.rotateX(-0.22);
      p.translate(Math.cos(a) * 1.15, 0.05, Math.sin(a) * 1.15);
      cards.push(p);
    }
    // Delicate small green shoots regrowing on 2 lower charred branch forks (trunk stays visibly charred!)
    for (const [bx, by, bz] of [
      [1.4, 5.2, 0.7],
      [-1.3, 6.4, -0.8],
      [0.4, 7.6, 1.2],
    ]) {
      for (let m = 0; m < 2; m++) {
        const sp = new THREE.PlaneGeometry(1.7, 1.6);
        sp.rotateY(m * Math.PI * 0.5 + bx);
        sp.translate(bx, by, bz);
        cards.push(sp);
      }
    }
    return mergeParts(cards);
  };
  const recoverySproutGeo = buildRecoverySproutGeo();
  const recoverySproutMat = new THREE.MeshStandardMaterial({
    map: textures.broadleafMap,
    alphaTest: 0.36,
    side: THREE.DoubleSide,
    roughness: 0.72,
    color: new THREE.Color('#7ca83e'),
  });

  interface BurningSiteAgent {
    kind: 'giant' | 'stump';
    index: number;
    pos: THREE.Vector3;
    scale: number;
    burnHeat: number;  // 1 = active burning/smoldering -> 0 = extinguished
    wetness: number;   // 0 -> 1 wet darkened charcoal bark
    recovery: number;  // 0 -> 1 post-extinguish root/branch recovery shoots
    flameMat?: THREE.ShaderMaterial;
    flameMesh?: THREE.Mesh;
    sproutMesh?: THREE.Mesh;
    hitMesh: THREE.Mesh;
  }

  const burningAgents: BurningSiteAgent[] = [];
  const burningHitMeshes: THREE.Object3D[] = [];
  const invisibleHitMat = new THREE.MeshBasicMaterial({ visible: false });

  for (let i = 0; i < heroEmberGiants.length; i++) {
    const [ex, ez, sc, rot] = heroEmberGiants[i];
    const ey = getTerrainHeight(ex, ez);
    dummy.position.set(ex, ey - 0.5, ez);
    dummy.rotation.set((i % 2 === 0 ? 1 : -1) * 0.04, rot, (i % 3 === 0 ? -1 : 1) * 0.04);
    dummy.scale.set(sc * 1.08, sc, sc * 1.08);
    dummy.updateMatrix();
    smolderGiantsMesh.setMatrixAt(i, dummy.matrix);
    smolderGiantCanopies.setMatrixAt(i, dummy.matrix);

    // Restrained animated flame tongues at charred trunk base
    const fMat = createFlameMaterial(i * 3.7);
    const fMesh = new THREE.Mesh(flameGeo, fMat);
    fMesh.position.set(ex + Math.cos(rot) * 0.42, ey + 0.1, ez + Math.sin(rot) * 0.42);
    fMesh.scale.setScalar(0.85 + sc * 0.35);
    fMesh.renderOrder = 5;
    group.add(fMesh);

    // Post-extinguish recovery sprout group (starts at scale 0; appears ONLY after water extinguishes fire!)
    const sproutMesh = new THREE.Mesh(recoverySproutGeo, recoverySproutMat);
    sproutMesh.position.set(ex, ey - 0.1, ez);
    sproutMesh.rotation.y = rot;
    sproutMesh.scale.setScalar(0.001);
    sproutMesh.visible = false;
    group.add(sproutMesh);

    // Direct-tap raycast cylinder around this burning tree
    const hitMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.8 * sc, 2.2 * sc, 15.0 * sc, 6), invisibleHitMat);
    hitMesh.position.set(ex, ey + 7.0 * sc, ez);
    hitMesh.userData.burningTreePos = new THREE.Vector3(ex, ey, ez);
    group.add(hitMesh);
    burningHitMeshes.push(hitMesh);

    burningAgents.push({
      kind: 'giant',
      index: i,
      pos: new THREE.Vector3(ex, ey, ez),
      scale: sc,
      burnHeat: 1.0,
      wetness: 0.0,
      recovery: 0.0,
      flameMat: fMat,
      flameMesh: fMesh,
      sproutMesh,
      hitMesh,
    });
  }
  smolderGiantsMesh.instanceMatrix.needsUpdate = true;
  smolderGiantCanopies.instanceMatrix.needsUpdate = true;
  group.add(smolderGiantsMesh, smolderGiantCanopies);

  // 8 Enormous Smoldering Surviving Charred Stumps
  const heroEmberStumps: Array<[number, number, number, number]> = [
    [-25.5, 29.5, 1.65, 0.5],
    [-46.5, 29.0, 1.52, 2.1],
    [-17.8, 21.0, 1.38, 3.6],
    [-41.5, 15.8, 1.85, 1.2],
    [-54.0, 34.0, 1.72, 4.7],
    [-36.5, 11.5, 1.55, 5.5],
    [-60.5, 18.5, 1.95, 2.8],
    [-72.0, -4.0, 2.10, 0.9],
  ];

  const smolderStumpGeo = buildFelledStumpGeometry();
  smolderStumpGeo.deleteAttribute('color');
  const stumpFireHeat = new Float32Array(heroEmberStumps.length).fill(1.0);
  const stumpWetChar = new Float32Array(heroEmberStumps.length).fill(0.0);
  const stumpFireAttr = new THREE.InstancedBufferAttribute(stumpFireHeat, 1);
  const stumpWetAttr = new THREE.InstancedBufferAttribute(stumpWetChar, 1);
  smolderStumpGeo.setAttribute('aFireHeat', stumpFireAttr);
  smolderStumpGeo.setAttribute('aWetChar', stumpWetAttr);

  const smolderStumpsMesh = new THREE.InstancedMesh(smolderStumpGeo, smolderStumpMat, heroEmberStumps.length);
  smolderStumpsMesh.castShadow = true;
  smolderStumpsMesh.receiveShadow = true;
  for (let i = 0; i < heroEmberStumps.length; i++) {
    const [ex, ez, sc, rot] = heroEmberStumps[i];
    const ey = getTerrainHeight(ex, ez);
    dummy.position.set(ex, ey - 0.22, ez);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(sc, sc * 1.08, sc);
    dummy.updateMatrix();
    smolderStumpsMesh.setMatrixAt(i, dummy.matrix);

    const hitMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.4 * sc, 1.6 * sc, 3.0 * sc, 6), invisibleHitMat);
    hitMesh.position.set(ex, ey + 1.2 * sc, ez);
    hitMesh.userData.burningTreePos = new THREE.Vector3(ex, ey, ez);
    group.add(hitMesh);
    burningHitMeshes.push(hitMesh);

    burningAgents.push({
      kind: 'stump',
      index: i,
      pos: new THREE.Vector3(ex, ey, ez),
      scale: sc,
      burnHeat: 1.0,
      wetness: 0.0,
      recovery: 0.0,
      hitMesh,
    });
  }
  smolderStumpsMesh.instanceMatrix.needsUpdate = true;
  group.add(smolderStumpsMesh);

  // Rising dark smoke wisps tied to burning locations (turn pale steam briefly while extinguishing, then dissipate!)
  interface SmolderWisp {
    sprite: THREE.Sprite;
    origin: THREE.Vector3;
    phase: number;
    speed: number;
    maxRise: number;
    baseScale: number;
    agentIdx: number;
  }
  const smolderWisps: SmolderWisp[] = [];
  const smokeAgentIndices = [0, 1, 2, 4, 5, 6, 8, 9];
  for (const aIdx of smokeAgentIndices) {
    const ag = burningAgents[aIdx];
    const sy = ag.pos.y + 1.8;
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.SpriteMaterial({
        map: textures.cloudPuffMap,
        color: new THREE.Color('#3b3533'),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(ag.pos.x, sy, ag.pos.z);
      sp.renderOrder = 4;
      group.add(sp);
      smolderWisps.push({
        sprite: sp,
        origin: new THREE.Vector3(ag.pos.x, sy, ag.pos.z),
        phase: k / 3 + rand() * 0.2,
        speed: 0.055 + rand() * 0.025,
        maxRise: 10.0 + rand() * 5.0,
        baseScale: 2.4 + rand() * 1.5,
        agentIdx: aIdx,
      });
    }
  }

  // =========================================================================
  // 6. EXPOSED UPTURNED ROOT SYSTEMS (~22)
  // =========================================================================
  const rootBallGeo = buildUpturnedRootBallGeometry();
  const rootBallMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    normalMap: textures.barkNormal,
    color: new THREE.Color('#423932'),
    roughness: 0.96,
  });
  const rootBallMats: THREE.Matrix4[] = [];
  for (let attempt = 0; attempt < 900 && rootBallMats.length < 22; attempt++) {
    const x = -24 - rand() * 145;
    const z = -75 + rand() * 155;
    if (isBlockedByStructure(x, z)) continue;
    if (damageField?.isOnLoggingTrail(x, z)) continue;
    if (damageField?.isInDriedReservoir(x, z)) continue;
    if (Math.hypot(x - -38.5, z - 24.0) < 12.5) continue;
    if (getVitality(x, z) > 0.36) continue;
    const y = getTerrainHeight(x, z);
    if (y < 1.2 || y > 32 || getTerrainSlope(x, z) > 0.25) continue;

    const s = 0.85 + rand() * 0.78;
    dummy.position.set(x, y - 0.16, z);
    dummy.rotation.set((rand() - 0.5) * 0.14, rand() * Math.PI * 2, (rand() - 0.5) * 0.14);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    rootBallMats.push(dummy.matrix.clone());
  }
  const rootBalls = new THREE.InstancedMesh(rootBallGeo, rootBallMat, rootBallMats.length);
  rootBalls.castShadow = true;
  rootBalls.receiveShadow = true;
  for (let i = 0; i < rootBallMats.length; i++) rootBalls.setMatrixAt(i, rootBallMats[i]);
  rootBalls.instanceMatrix.needsUpdate = true;
  group.add(rootBalls);

  // Subtle recessed smoldering coal beds nestled in charred hollows (fade out cleanly when watered!)
  interface CoalBedEntry {
    mesh: THREE.Mesh;
    mat: THREE.ShaderMaterial;
    x: number;
    z: number;
  }
  const coalBeds: CoalBedEntry[] = [];
  const coalSpots: Array<[number, number]> = [
    [-31.5, 11.5],
    [-41.5, 15.8],
    [-58.0, 6.5],
    [-52.0, -24.0],
    [-68.0, 12.0],
    [-45.0, 34.5],
  ];
  for (const [cx, cz] of coalSpots) {
    const bedMat = new THREE.ShaderMaterial({
      uniforms: { uTime, uHeat: { value: 1.0 } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uHeat;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float d = length(p);
          if (d > 1.0) discard;
          float n1 = vnoise(vWorldPos.xz * 2.4);
          float n2 = vnoise(vWorldPos.xz * 6.5 + vec2(3.2, 1.7));
          float radial = 1.0 - smoothstep(0.18, 0.96, d + (n1 - 0.5) * 0.35);
          float coalVeins = smoothstep(0.46, 0.82, n2 * 0.7 + n1 * 0.3);
          float breathe = 0.45 + 0.55 * sin(uTime * 1.15 + vWorldPos.x * 0.7 + vWorldPos.z * 0.5);
          vec3 ashChar = vec3(0.06, 0.055, 0.055);
          vec3 hotCoal = mix(vec3(0.95, 0.16, 0.02), vec3(2.1, 0.58, 0.08), coalVeins * breathe);
          vec3 col = mix(ashChar, hotCoal, coalVeins * (0.45 + 0.55 * breathe) * uHeat);
          float alpha = radial * (0.52 + 0.38 * uHeat) * smoothstep(0.0, 0.15, uHeat + 0.35);
          if (alpha < 0.04) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const bedGeo = new THREE.PlaneGeometry(4.4, 4.4, 8, 8);
    bedGeo.rotateX(-Math.PI * 0.5);
    const bPos = bedGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      bPos.setY(i, getTerrainHeight(cx + bPos.getX(i), cz + bPos.getZ(i)) + 0.08);
    }
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    bedMesh.position.set(cx, 0, cz);
    bedMesh.renderOrder = 3;
    group.add(bedMesh);
    coalBeds.push({ mesh: bedMesh, mat: bedMat, x: cx, z: cz });
  }

  // =========================================================================
  // 7. 6 DISCOVERABLE, ANATOMICALLY COHERENT FOSSILIZED SKELETAL LANDMARKS (shared FOSSIL_SITES)
  // =========================================================================
  const fossilBoneMat = new THREE.MeshStandardMaterial({
    map: textures.fossilBoneMap,
    normalMap: textures.rockNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    color: new THREE.Color('#efe7d6'),
    roughness: 0.90,
    metalness: 0.02,
  });
  fossilBoneMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBoneLocalY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBoneLocalY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBoneLocalY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float embedDark = smoothstep(-0.35, 1.45, vBoneLocalY);
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.42, 0.36, 0.29), diffuseColor.rgb * vec3(1.06, 1.03, 0.97), embedDark);`
      );
  };

  const darkCavityMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#211c17'),
    roughness: 0.98,
  });

  for (const fs of FOSSIL_SITES) {
    group.add(createFossilSite(fs.x, fs.z, fs.yaw, fs.scale, fs.ribCount, fs.includeSkull, fossilBoneMat, darkCavityMat));
  }

  // =========================================================================
  // 8. LONE POETIC RUSTED STEEL GIRDER IN THE PHASE 2 DRIED RIVERBED
  // =========================================================================
  {
    const rustMat = new THREE.MeshStandardMaterial({
      map: textures.rustMap,
      color: new THREE.Color('#8c5338'),
      roughness: 0.86,
      metalness: 0.42,
    });
    const girder = new THREE.Group();
    const len = 7.4;
    const web = new THREE.Mesh(new THREE.BoxGeometry(len, 0.56, 0.07), rustMat);
    const flangeTop = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.34), rustMat);
    flangeTop.position.y = 0.28;
    const flangeBot = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.34), rustMat);
    flangeBot.position.y = -0.28;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.14), rustMat);
    strut.position.set(1.2, 0.2, 0.55);
    strut.rotation.set(0.18, -0.52, 0.25);

    for (const m of [web, flangeTop, flangeBot, strut]) {
      m.castShadow = true;
      m.receiveShadow = true;
      girder.add(m);
    }
    const gx = -31.0;
    const gz = 18.2;
    girder.position.set(gx, getTerrainHeight(gx, gz) + 0.18, gz);
    girder.rotation.set(0.24, 0.62, -0.18);
    group.add(girder);
  }

  // =========================================================================
  // 9. WIDE-RANGING GPU-INSTANCED DRIFTING ASH ACROSS THE ENTIRE DAMAGED REGION
  // =========================================================================
  const driftingAsh = createDriftingAshInstancedMesh(uTime);
  group.add(driftingAsh);

  void DRY_RIVER_SAMPLES.length;

  const smokeDarkCol = new THREE.Color('#3b3533');
  const steamCol = new THREE.Color('#c7cbc8');

  const resetFireStates = () => {
    for (const ag of burningAgents) {
      ag.burnHeat = 1.0;
      ag.wetness = 0.0;
      ag.recovery = 0.0;
      if (ag.kind === 'giant') {
        giantFireHeat[ag.index] = 1.0;
        giantWetChar[ag.index] = 0.0;
      } else {
        stumpFireHeat[ag.index] = 1.0;
        stumpWetChar[ag.index] = 0.0;
      }
      if (ag.flameMat) ag.flameMat.uniforms.uHeat.value = 1.0;
      if (ag.flameMesh) ag.flameMesh.visible = true;
      if (ag.sproutMesh) {
        ag.sproutMesh.visible = false;
        ag.sproutMesh.scale.setScalar(0.001);
      }
    }
    giantFireAttr.needsUpdate = true;
    giantWetAttr.needsUpdate = true;
    stumpFireAttr.needsUpdate = true;
    stumpWetAttr.needsUpdate = true;

    for (const cb of coalBeds) {
      cb.mat.uniforms.uHeat.value = 1.0;
      cb.mesh.visible = true;
    }
  };

  return {
    group,
    getBurningTreeHitMeshes: () => burningHitMeshes,
    getBurningStatus() {
      let extinguished = 0;
      let recovering = 0;
      for (const ag of burningAgents) {
        if (ag.burnHeat < 0.15) extinguished++;
        if (ag.recovery > 0.15) recovering++;
      }
      return { total: burningAgents.length, extinguished, recovering };
    },
    resetFireStates,
    update(time: number, dt: number, restoration?: RestorationSystem) {
      uTime.value = time;
      const safeDt = Math.min(dt, 0.05);

      let giantDirty = false;
      let stumpDirty = false;

      // Water-driven extinguishing & separate delayed recovery for EVERY burning tree & stump!
      if (restoration) {
        for (const ag of burningAgents) {
          const sample = restoration.sampleStateAt(ag.pos.x, ag.pos.z);

          // Stage 1: Water reaches burning tree (either along route OR at destination!) -> fire dies & bark wets!
          if (sample.moisture > 0.12) {
            const quenchRate = (0.32 + sample.moisture * 0.65) * safeDt;
            const prevHeat = ag.burnHeat;
            const prevWet = ag.wetness;
            ag.burnHeat = Math.max(0, ag.burnHeat - quenchRate);
            ag.wetness = Math.min(1, ag.wetness + quenchRate * 0.85);

            if (ag.burnHeat !== prevHeat || ag.wetness !== prevWet) {
              if (ag.kind === 'giant') {
                giantFireHeat[ag.index] = ag.burnHeat;
                giantWetChar[ag.index] = ag.wetness;
                giantDirty = true;
              } else {
                stumpFireHeat[ag.index] = ag.burnHeat;
                stumpWetChar[ag.index] = ag.wetness;
                stumpDirty = true;
              }
              if (ag.flameMat) ag.flameMat.uniforms.uHeat.value = ag.burnHeat;
              if (ag.flameMesh) ag.flameMesh.visible = ag.burnHeat > 0.02;
            }
          }

          // Stage 2 (Separate from extinguishing!): Subtle root & lower-branch recovery shoots once extinguished & mossy!
          if (ag.burnHeat < 0.18 && sample.moss > 0.28 && ag.sproutMesh) {
            const targetRec = clamp((sample.life - 0.15) / 0.72, 0, 1);
            if (targetRec > ag.recovery) {
              ag.recovery = Math.min(targetRec, ag.recovery + safeDt * 0.18);
              ag.sproutMesh.visible = ag.recovery > 0.02;
              const s = ag.scale * (0.05 + 0.95 * ag.recovery);
              ag.sproutMesh.scale.set(s, s, s);
            }
          }
        }

        // Quench ground coal beds smoothly as moisture reaches them
        for (const cb of coalBeds) {
          const s = restoration.sampleStateAt(cb.x, cb.z);
          if (s.moisture > 0.12) {
            const cur = cb.mat.uniforms.uHeat.value as number;
            const next = Math.max(0, cur - safeDt * 0.45);
            cb.mat.uniforms.uHeat.value = next;
            cb.mesh.visible = next > 0.01 || s.moss < 0.65;
          }
        }
      }

      if (giantDirty) {
        giantFireAttr.needsUpdate = true;
        giantWetAttr.needsUpdate = true;
      }
      if (stumpDirty) {
        stumpFireAttr.needsUpdate = true;
        stumpWetAttr.needsUpdate = true;
      }

      // Animate localized smoke -> brief steam during quenching -> complete dissipation!
      for (let i = 0; i < smolderWisps.length; i++) {
        const w = smolderWisps[i];
        const ag = burningAgents[w.agentIdx];
        const steamBoost = ag.burnHeat > 0.03 && ag.wetness > 0.05 ? Math.sin(ag.burnHeat * Math.PI) * 0.85 : 0;
        const visibility = clamp(ag.burnHeat + steamBoost * 0.65, 0, 1);
        if (visibility < 0.02) {
          w.sprite.visible = false;
          continue;
        }
        w.sprite.visible = true;
        const t = (w.phase + time * w.speed) % 1;
        const fade = Math.sin(t * Math.PI);
        w.sprite.position.set(
          w.origin.x - t * 4.5 + Math.sin(time * 0.5 + i) * 0.8,
          w.origin.y + t * w.maxRise,
          w.origin.z + Math.cos(time * 0.4 + i) * 0.6
        );
        const s = w.baseScale * (0.6 + t * 2.2);
        w.sprite.scale.set(s * 1.2, s * 1.0, 1);
        w.sprite.material.color.copy(smokeDarkCol).lerp(steamCol, clamp(steamBoost * 1.1, 0, 1));
        w.sprite.material.opacity = fade * fade * 0.28 * visibility;
      }
    },
  };
}
