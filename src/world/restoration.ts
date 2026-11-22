import * as THREE from 'three';
import { clamp, fbm2D, lerp, mulberry32, smoothstep } from './noise';
import {
  DISTANT_PLANT_POS,
  DRY_TRIBUTARIES,
  FACTORY_CENTER,
  WEIR_POS,
} from './damageField';
import { isNearFossilCore } from './fossilSites';
import {
  DRY_RIVER_SAMPLES,
  getDryRiverInfo,
  getLivingRiverInfo,
  getTerrainHeight,
  getTerrainSlope,
  getVitality,
  isPointInWater,
  LIVING_RIVER_SAMPLES,
  SUN_DIRECTION,
  TREE_CENTER,
} from './terrainData';
import { WorldTextures } from './textures';

export const RESTORATION_CENTER = new THREE.Vector2(-24.5, 20.5);
export const RESTORATION_RADIUS = 23.5;

// World-wide western restoration field bounds covering all burned forests, dried lakebeds, fossils & valleys
export const RESTORATION_BOUNDS = {
  minX: -225.0,
  maxX: 28.0,
  minZ: -145.0,
  maxZ: 135.0,
};

const FIELD_SIZE = 256;
const NAV_SIZE = 104;

export interface RestorationSample {
  moisture: number;
  moss: number;
  life: number;
  channel: number;
}

export interface TributaryBranchInfo {
  id: number;
  points: THREE.Vector3[];
  headT: number;
  age: number;
  length: number;
  destination: THREE.Vector3;
}

export interface RestoredClearingInfo {
  x: number;
  y: number;
  z: number;
  maturity: number; // 0..1 based on field life at destination
}

export interface RestorationState {
  active: boolean;
  progress: number;
  branchCount: number;
}

export interface RestorationSystem {
  group: THREE.Group;
  fieldMap: THREE.DataTexture;
  bounds: THREE.Vector4; // (minX, minZ, 1/(maxX-minX), 1/(maxZ-minZ))
  uniforms: {
    uRestoreOrigin: { value: THREE.Vector3 };
    uRestoreProgress: { value: number };
    uRestoreRadius: { value: number };
  };
  isInsideZone: (point: THREE.Vector3) => boolean;
  setHoverPoint: (point: THREE.Vector3 | null) => void;
  trigger: (destination: THREE.Vector3) => boolean;
  reset: () => void;
  update: (time: number, dt: number) => void;
  getState: () => RestorationState;
  sampleStateAt: (x: number, z: number) => RestorationSample;
  getConnectedBranches: () => TributaryBranchInfo[];
  getEstablishedClearings: () => RestoredClearingInfo[];
}

interface InternalBranch {
  id: number;
  points: THREE.Vector3[];
  widths: number[];
  destination: THREE.Vector3;
  length: number;
  headT: number;
  flowSpeedT: number;
  age: number;
  destSpreadRadius: number;
  maxDestRadius: number;
  destArrivedTime: number;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  trickleMeshes: THREE.Mesh[];
  trickleMats: THREE.ShaderMaterial[];
  trickleSpawned: boolean;
}

// Helper to merge simple geometries cleanly
function mergeGeometriesSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    }
    offset += pos.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  return merged;
}

function buildGrassTuftGeo(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  const blades = [
    { yaw: 0.0, lean: 0.24, h: 0.84, w: 0.064, ox: 0.0, oz: 0.0 },
    { yaw: 2.1, lean: 0.28, h: 0.70, w: 0.056, ox: 0.07, oz: -0.05 },
    { yaw: 4.2, lean: 0.25, h: 0.62, w: 0.052, ox: -0.07, oz: 0.06 },
  ];
  const segs = 3;
  for (const b of blades) {
    const cosY = Math.cos(b.yaw);
    const sinY = Math.sin(b.yaw);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const halfW = b.w * (1 - t * 0.92);
      const bend = t * t * b.lean;
      const y = t * b.h;
      const cx = b.ox + cosY * bend;
      const cz = b.oz + sinY * bend;
      const px = -sinY * halfW;
      const pz = cosY * halfW;
      positions.push(cx - px, y, cz - pz, cx + px, y, cz + pz);
      normals.push(cosY * 0.35, 0.92, sinY * 0.35, cosY * 0.35, 0.92, sinY * 0.35);
      uvs.push(0, t, 1, t);
    }
    for (let i = 0; i < segs; i++) {
      const r0 = offset + i * 2;
      const r1 = r0 + 2;
      indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
    }
    offset += (segs + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildFernRosetteGeo(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.18;
    const plane = new THREE.PlaneGeometry(0.72, 1.32, 1, 4);
    const pos = plane.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const yNorm = (pos.getY(v) + 0.66) / 1.32;
      const archY = Math.sin(yNorm * Math.PI * 0.68) * 0.74 + yNorm * 0.12;
      const reachZ = yNorm * 1.15;
      pos.setXYZ(v, x, archY, reachZ);
    }
    plane.rotateY(angle);
    plane.computeVertexNormals();
    fronds.push(plane);
  }
  return mergeGeometriesSimple(fronds);
}

function buildUnderstoryPlantGeo(): THREE.BufferGeometry {
  const cards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(0.95, 0.92);
    p.translate(0, 0.42, 0);
    p.rotateY((i * Math.PI) / 3);
    p.rotateZ((i - 1) * 0.18);
    const n = p.attributes.normal;
    for (let v = 0; v < n.count; v++) {
      const vx = p.attributes.position.getX(v);
      const vy = p.attributes.position.getY(v) + 0.4;
      const vz = p.attributes.position.getZ(v);
      const l = Math.hypot(vx, vy, vz) || 1;
      n.setXYZ(v, vx / l, vy / l, vz / l);
    }
    cards.push(p);
  }
  return mergeGeometriesSimple(cards);
}

function buildWildflowerGeos(): { stems: THREE.BufferGeometry; blooms: THREE.BufferGeometry } {
  const stemParts: THREE.BufferGeometry[] = [];
  const bloomParts: THREE.BufferGeometry[] = [];
  const stalks = [
    { x: 0.0, z: 0.0, h: 0.52, leanX: 0.04, leanZ: 0.03, r: 0.095 },
    { x: 0.13, z: -0.08, h: 0.40, leanX: 0.08, leanZ: -0.05, r: 0.078 },
    { x: -0.11, z: 0.09, h: 0.45, leanX: -0.06, leanZ: 0.07, r: 0.084 },
  ];
  for (const s of stalks) {
    const stem = new THREE.CylinderGeometry(0.007, 0.013, s.h, 4, 1);
    stem.translate(s.x + s.leanX * 0.5, s.h * 0.5, s.z + s.leanZ * 0.5);
    stemParts.push(stem);
    const flower = new THREE.CircleGeometry(s.r, 6);
    flower.rotateX(-Math.PI * 0.44);
    flower.rotateY(s.x * 12);
    flower.translate(s.x + s.leanX, s.h + 0.01, s.z + s.leanZ);
    bloomParts.push(flower);
  }
  return {
    stems: mergeGeometriesSimple(stemParts),
    blooms: mergeGeometriesSimple(bloomParts),
  };
}

function buildYoungSaplingGeos(): { trunk: THREE.BufferGeometry; foliage: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.05, 0.15, 3.1, 6, 1);
  main.translate(0, 1.52, 0);
  parts.push(main);
  for (const [ang, yOff, len] of [
    [0.4, 2.0, 1.45],
    [2.5, 2.2, 1.35],
    [4.6, 2.1, 1.4],
  ]) {
    const b = new THREE.CylinderGeometry(0.022, 0.052, len, 5, 1);
    b.translate(0, len * 0.5, 0);
    b.rotateZ(0.45);
    b.rotateY(ang);
    b.translate(0, yOff, 0);
    parts.push(b);
  }
  const cards: THREE.BufferGeometry[] = [];
  const clusters = [
    [0.0, 3.65, 0.0, 1.25],
    [0.78, 3.05, 0.38, 0.98],
    [-0.70, 3.15, 0.45, 1.0],
    [0.14, 2.95, -0.78, 0.95],
    [-0.48, 3.45, -0.48, 0.88],
  ];
  for (const [cx, cy, cz, sc] of clusters) {
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(sc * 1.28, sc * 1.28);
      p.rotateY(k * Math.PI * 0.5 + cx);
      p.rotateX((k === 0 ? 1 : -1) * 0.22);
      p.translate(cx, cy, cz);
      const n = p.attributes.normal;
      for (let i = 0; i < n.count; i++) {
        const vx = p.attributes.position.getX(i);
        const vy = p.attributes.position.getY(i) - 2.5;
        const vz = p.attributes.position.getZ(i);
        const l = Math.hypot(vx, vy + 0.8, vz) || 1;
        n.setXYZ(i, vx / l, (vy + 0.8) / l, vz / l);
      }
      cards.push(p);
    }
  }
  return {
    trunk: mergeGeometriesSimple(parts),
    foliage: mergeGeometriesSimple(cards),
  };
}

// =========================================================================
// TERRAIN-CONFORMING FLOWING TRIBUTARY RIBBON BUILDER
// =========================================================================
function buildTributaryRibbonGeometry(
  points: THREE.Vector3[],
  widths: number[],
  widenAtEnd = true
): THREE.BufferGeometry {
  const crossSegs = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const depths: number[] = [];
  const arcTs: number[] = [];
  const cascades: number[] = [];
  const indices: number[] = [];

  let accumS = 0;
  const sArr: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    accumS += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    sArr.push(accumS);
  }
  const totalS = Math.max(accumS, 0.001);

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const tLen = Math.hypot(tx, tz) || 1;
    const nx = -tz / tLen;
    const nz = tx / tLen;

    const arcT = sArr[i] / totalS;
    const dy = Math.abs(next.y - prev.y);
    const localSlope = dy / Math.max(0.5, Math.hypot(next.x - prev.x, next.z - prev.z));
    const cascade = clamp((localSlope - 0.11) * 3.8, 0, 1);

    // Natural tributary width: smoothly blends from river connection -> graceful stream -> small natural pool at end!
    const poolWiden = widenAtEnd ? smoothstep(0.86, 0.97, arcT) * 1.45 : 0;
    const tipTaper = smoothstep(1.0, 0.95, arcT);
    const halfW = (widths[i] + poolWiden) * (0.28 + 0.72 * tipTaper);

    const centerBed = getTerrainHeight(p.x, p.z);
    const dryInfo = getDryRiverInfo(p.x, p.z);
    const inDryBed = dryInfo.dist < dryInfo.width * 0.9 && p.x < 10;
    const livingInfo = getLivingRiverInfo(p.x, p.z);
    const nearLiving = livingInfo.dist < livingInfo.width + 2.5;

    // Sample left & right bank heights so stream hugs depressions cleanly without ever floating above ground!
    const hL = getTerrainHeight(p.x - nx * halfW * 0.75, p.z - nz * halfW * 0.75);
    const hR = getTerrainHeight(p.x + nx * halfW * 0.75, p.z + nz * halfW * 0.75);
    let surfaceCenterY = centerBed + (inDryBed ? 0.34 : 0.14);
    if (nearLiving) {
      surfaceCenterY = lerp(surfaceCenterY, livingInfo.waterY + 0.02, 1 - smoothstep(livingInfo.width * 0.6, livingInfo.width + 2.5, livingInfo.dist));
    }
    // Clamp gently so water never sticks way above a low downhill bank
    const bankMin = Math.min(hL, hR);
    surfaceCenterY = Math.min(surfaceCenterY, bankMin + (inDryBed ? 0.55 : 0.24));
    surfaceCenterY = Math.max(surfaceCenterY, centerBed + 0.065);

    for (let j = 0; j <= crossSegs; j++) {
      const u = j / crossSegs;
      const across = u * 2 - 1;
      const wx = p.x + nx * across * halfW;
      const wz = p.z + nz * across * halfW;
      const localG = getTerrainHeight(wx, wz);

      const centerProfile = Math.max(0, 1 - across * across);
      // Center of stream sits above terrain; edges tuck cleanly -0.05m into damp banks so ZERO floating edges!
      const wy = lerp(localG - 0.055, Math.max(localG + 0.055, surfaceCenterY), Math.pow(centerProfile, 0.7));
      const depth = clamp(centerProfile * (inDryBed ? 0.58 : 0.32) + Math.max(0, wy - localG) * 0.85, 0, 1.1) * tipTaper;

      positions.push(wx, wy, wz);
      uvs.push(u, sArr[i] * 0.22);
      depths.push(depth);
      arcTs.push(arcT);
      cascades.push(cascade);
    }
  }

  const stride = crossSegs + 1;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < crossSegs; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
  geo.setAttribute('aArcT', new THREE.Float32BufferAttribute(arcTs, 1));
  geo.setAttribute('aCascade', new THREE.Float32BufferAttribute(cascades, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createTributaryWaterMaterial(uTime: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uHeadT: { value: 0.0 },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uFogColor: { value: new THREE.Color('#8e9699') },
      uFogDensity: { value: 0.0020 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      uniform float uHeadT;
      attribute float aDepth;
      attribute float aArcT;
      attribute float aCascade;

      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vDepth;
      varying float vAdvance;
      varying float vCascade;

      void main() {
        vUv = uv;
        vCascade = aCascade;
        // Progressive advancing water front traveling visibly from source (0) to destination (1)!
        float front = smoothstep(aArcT - 0.01, aArcT + 0.065, uHeadT);
        vAdvance = front;
        vDepth = aDepth * front;

        vec3 pos = position;
        pos.y -= (1.0 - front) * 0.14;
        float ripple = sin(pos.x * 1.5 + uTime * 3.1) * cos(pos.z * 1.4 - uTime * 2.5) * 0.015;
        pos.y += ripple * front * clamp(aDepth * 2.5, 0.0, 1.0);

        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform float uFogDensity;

      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vDepth;
      varying float vAdvance;
      varying float vCascade;

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
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p = p * 2.04 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        if (vAdvance < 0.02 || vDepth < 0.012) discard;

        float speedBoost = 1.0 + vCascade * 1.4;
        vec2 flow1 = vec2(vUv.x * 3.6, vUv.y * 2.8 - uTime * 1.05 * speedBoost);
        vec2 flow2 = vec2(vWorldPos.x * 0.45 + uTime * 0.14, vWorldPos.z * 0.45 - uTime * 0.42);
        float e = 0.06;
        float h0 = fbm(flow1) * 0.62 + fbm(flow2) * 0.38;
        float hx = fbm(flow1 + vec2(e, 0.0)) * 0.62 + fbm(flow2 + vec2(e, 0.0)) * 0.38;
        float hz = fbm(flow1 + vec2(0.0, e)) * 0.62 + fbm(flow2 + vec2(0.0, e)) * 0.38;

        vec3 N = normalize(vec3((h0 - hx) * 1.95, 1.0, (h0 - hz) * 1.95));
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 R = reflect(-V, N);

        float NoV = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = 0.05 + 0.66 * pow(1.0 - NoV, 3.4);

        vec3 shallowCol = vec3(0.09, 0.27, 0.23);
        vec3 deepCol = vec3(0.025, 0.12, 0.16);
        vec3 waterBody = mix(shallowCol, deepCol, smoothstep(0.04, 0.55, vDepth));

        vec3 skyZenith = vec3(0.16, 0.29, 0.42);
        vec3 skyHorizon = vec3(0.50, 0.52, 0.50);
        vec3 reflCol = mix(skyHorizon, skyZenith, pow(clamp(R.y, 0.0, 1.0), 0.7));
        float sunGlow = pow(clamp(dot(R, uSunDir), 0.0, 1.0), 12.0);
        reflCol += vec3(0.90, 0.68, 0.38) * sunGlow * 0.45;

        vec3 H = normalize(uSunDir + V);
        float spec = pow(clamp(dot(N, H), 0.0, 1.0), 210.0);

        float shallowMask = smoothstep(0.02, 0.24, vDepth);
        vec3 col = mix(waterBody, reflCol, clamp(fresnel * (0.38 + 0.36 * shallowMask) + 0.06, 0.0, 0.76));
        col += vec3(1.0, 0.88, 0.66) * spec * (0.85 + 0.65 * shallowMask);

        // Bank meniscus foam + frothy leading-edge arrival + small cascade rapids on elevation drops!
        float foamN = fbm(flow1 * 2.4 - vec2(0.0, uTime * 0.55));
        float shoreFoam = (1.0 - smoothstep(0.02, 0.22, vDepth)) * smoothstep(0.45, 0.74, foamN) * shallowMask;
        float leadingFoam = smoothstep(0.03, 0.45, vAdvance) * (1.0 - smoothstep(0.45, 0.94, vAdvance)) * smoothstep(0.28, 0.65, foamN);
        float cascadeFoam = vCascade * smoothstep(0.28, 0.68, foamN) * 0.95;
        float foam = clamp(shoreFoam * 0.62 + leadingFoam * 0.92 + cascadeFoam, 0.0, 0.92);
        col = mix(col, vec3(0.86, 0.90, 0.90), foam);

        float alpha = clamp(smoothstep(0.015, 0.16, vDepth) * 0.92 + foam * 0.48, 0.0, 0.95) * smoothstep(0.02, 0.22, vAdvance);

        float dist = length(cameraPosition - vWorldPos);
        float fogFactor = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

// =========================================================================
// MAIN PHASE 4 UNIFIED RESTORATION SYSTEM
// =========================================================================
export function createRestorationSystem(textures: WorldTextures): RestorationSystem {
  const group = new THREE.Group();
  group.name = 'EcologicalRestoration';

  const branchGroup = new THREE.Group();
  branchGroup.name = 'ConnectedRiverBranches';
  group.add(branchGroup);

  const rand = mulberry32(20260404);
  const { minX, maxX, minZ, maxZ } = RESTORATION_BOUNDS;
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;

  const bounds = new THREE.Vector4(minX, minZ, 1 / spanX, 1 / spanZ);

  // Dynamic 256x256 RGBA restoration field (R=moisture, G=moss, B=life, A=channelWet)
  const texelCount = FIELD_SIZE * FIELD_SIZE;
  const fieldBytes = new Uint8Array(texelCount * 4);
  const fMoist = new Float32Array(texelCount);
  const fMoss = new Float32Array(texelCount);
  const fLife = new Float32Array(texelCount);
  const fChan = new Float32Array(texelCount);
  const fNoise = new Float32Array(texelCount);

  for (let iz = 0; iz < FIELD_SIZE; iz++) {
    const z = lerp(minZ, maxZ, iz / (FIELD_SIZE - 1));
    for (let ix = 0; ix < FIELD_SIZE; ix++) {
      const x = lerp(minX, maxX, ix / (FIELD_SIZE - 1));
      fNoise[iz * FIELD_SIZE + ix] = clamp(fbm2D(x * 0.12 + 4.1, z * 0.12 - 2.7, 3) * 0.55 + 0.5, 0.15, 1.0);
    }
  }

  const fieldMap = new THREE.DataTexture(fieldBytes, FIELD_SIZE, FIELD_SIZE, THREE.RGBAFormat);
  fieldMap.minFilter = THREE.LinearFilter;
  fieldMap.magFilter = THREE.LinearFilter;
  fieldMap.wrapS = THREE.ClampToEdgeWrapping;
  fieldMap.wrapT = THREE.ClampToEdgeWrapping;
  fieldMap.needsUpdate = true;

  // Precomputed 104x104 terrain navigation cost grid for natural A* river-branch routing
  const navH = new Float32Array(NAV_SIZE * NAV_SIZE);
  const navCost = new Float32Array(NAV_SIZE * NAV_SIZE);

  // Sample dry tributary polylines for route-preference guidance
  const dryTribPts: Array<[number, number]> = [];
  for (const trib of DRY_TRIBUTARIES) {
    const curve = new THREE.CatmullRomCurve3(
      trib.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'catmullrom',
      0.45
    );
    for (let k = 0; k <= 14; k++) {
      const p = curve.getPoint(k / 14);
      dryTribPts.push([p.x, p.z]);
    }
  }

  for (let iz = 0; iz < NAV_SIZE; iz++) {
    const z = lerp(minZ, maxZ, iz / (NAV_SIZE - 1));
    for (let ix = 0; ix < NAV_SIZE; ix++) {
      const x = lerp(minX, maxX, ix / (NAV_SIZE - 1));
      const h = getTerrainHeight(x, z);
      const slope = getTerrainSlope(x, z);
      const idx = iz * NAV_SIZE + ix;
      navH[idx] = h;

      // Natural depression preference: lower elevation + existing dried riverbed/tributaries = cheaper!
      let cost = 1.0 + Math.max(0, h - 1.0) * 0.18 + slope * 6.5;

      const dry = getDryRiverInfo(x, z);
      if (dry.dist < dry.width + 2.5 && x < 14) {
        cost *= 0.42; // Strongly prefer flowing naturally through the carved dried riverbed!
      } else {
        // Check dry tributary gullies
        for (let t = 0; t < dryTribPts.length; t++) {
          if (Math.hypot(x - dryTribPts[t][0], z - dryTribPts[t][1]) < 5.5) {
            cost *= 0.58;
            break;
          }
        }
      }

      // Avoid obstacles gracefully: Ancient Tree trunk, fossils, factory pads, choked weir piers
      if (Math.hypot(x - TREE_CENTER.x, z - TREE_CENTER.y) < 8.5) cost += 28.0;
      if (isNearFossilCore(x, z, 0.92)) cost += 24.0;
      if (Math.hypot(x - FACTORY_CENTER.x, z - FACTORY_CENTER.y) < 28.0) cost += 45.0;
      if (Math.hypot(x - DISTANT_PLANT_POS.x, z - DISTANT_PLANT_POS.y) < 22.0) cost += 45.0;
      if (Math.hypot(x - WEIR_POS.x, z - WEIR_POS.y) < 5.5) cost += 14.0;
      if (slope > 0.56) cost += 26.0;

      navCost[idx] = Math.max(0.25, cost);
    }
  }

  const worldToNav = (x: number, z: number): [number, number] => [
    clamp(Math.round(((x - minX) / spanX) * (NAV_SIZE - 1)), 0, NAV_SIZE - 1),
    clamp(Math.round(((z - minZ) / spanZ) * (NAV_SIZE - 1)), 0, NAV_SIZE - 1),
  ];

  const navToWorld = (ix: number, iz: number): [number, number] => [
    minX + (ix / (NAV_SIZE - 1)) * spanX,
    minZ + (iz / (NAV_SIZE - 1)) * spanZ,
  ];

  // Fast terrain-aware A* pathfinder from nearest connected water source to user's tapped destination
  const findNaturalWaterRoute = (startX: number, startZ: number, endX: number, endZ: number): THREE.Vector3[] => {
    const [sx, sz] = worldToNav(startX, startZ);
    const [gx, gz] = worldToNav(endX, endZ);

    const startIdx = sz * NAV_SIZE + sx;
    const goalIdx = gz * NAV_SIZE + gx;
    const total = NAV_SIZE * NAV_SIZE;

    const gScore = new Float32Array(total);
    gScore.fill(1e9);
    const parent = new Int32Array(total);
    parent.fill(-1);
    const closed = new Uint8Array(total);

    // Lightweight binary min-heap for < 2ms A* execution
    const heapIdx: number[] = [];
    const heapF: number[] = [];
    const pushHeap = (node: number, f: number) => {
      let i = heapIdx.length;
      heapIdx.push(node);
      heapF.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        const ti = heapIdx[p];
        const tf = heapF[p];
        heapIdx[p] = heapIdx[i];
        heapF[p] = heapF[i];
        heapIdx[i] = ti;
        heapF[i] = tf;
        i = p;
      }
    };
    const popHeap = (): number => {
      const top = heapIdx[0];
      const lastI = heapIdx.pop()!;
      const lastF = heapF.pop()!;
      if (heapIdx.length > 0) {
        heapIdx[0] = lastI;
        heapF[0] = lastF;
        let i = 0;
        const n = heapIdx.length;
        while (true) {
          const l = i * 2 + 1;
          const r = l + 1;
          let smallest = i;
          if (l < n && heapF[l] < heapF[smallest]) smallest = l;
          if (r < n && heapF[r] < heapF[smallest]) smallest = r;
          if (smallest === i) break;
          const ti = heapIdx[i];
          const tf = heapF[i];
          heapIdx[i] = heapIdx[smallest];
          heapF[i] = heapF[smallest];
          heapIdx[smallest] = ti;
          heapF[smallest] = tf;
          i = smallest;
        }
      }
      return top;
    };

    gScore[startIdx] = 0;
    pushHeap(startIdx, Math.hypot(gx - sx, gz - sz));

    const dirs = [
      [1, 0, 1.0],
      [-1, 0, 1.0],
      [0, 1, 1.0],
      [0, -1, 1.0],
      [1, 1, 1.414],
      [-1, 1, 1.414],
      [1, -1, 1.414],
      [-1, -1, 1.414],
    ];

    let bestNode = startIdx;
    let bestH = Infinity;
    let iters = 0;

    while (heapIdx.length > 0 && iters < 7500) {
      iters++;
      const cur = popHeap();
      if (closed[cur]) continue;
      closed[cur] = 1;

      const cx = cur % NAV_SIZE;
      const cz = (cur - cx) / NAV_SIZE;
      const distGoal = Math.hypot(gx - cx, gz - cz);
      if (distGoal < bestH) {
        bestH = distGoal;
        bestNode = cur;
      }
      if (cur === goalIdx) {
        bestNode = cur;
        break;
      }

      const curG = gScore[cur];
      const curY = navH[cur];

      for (let d = 0; d < 8; d++) {
        const nx = cx + dirs[d][0];
        const nz = cz + dirs[d][1];
        if (nx < 0 || nx >= NAV_SIZE || nz < 0 || nz >= NAV_SIZE) continue;
        const nIdx = nz * NAV_SIZE + nx;
        if (closed[nIdx]) continue;

        const rise = Math.max(0, navH[nIdx] - curY);
        const stepCost = dirs[d][2] * (navCost[nIdx] + rise * 0.95);
        const ng = curG + stepCost;
        if (ng < gScore[nIdx]) {
          gScore[nIdx] = ng;
          parent[nIdx] = cur;
          pushHeap(nIdx, ng + Math.hypot(gx - nx, gz - nz) * 1.15);
        }
      }
    }

    // Reconstruct raw path
    const rawPts: THREE.Vector3[] = [];
    let trace = bestNode;
    while (trace !== -1) {
      const tx = trace % NAV_SIZE;
      const tz = (trace - tx) / NAV_SIZE;
      const [wx, wz] = navToWorld(tx, tz);
      rawPts.push(new THREE.Vector3(wx, getTerrainHeight(wx, wz), wz));
      trace = parent[trace];
    }
    rawPts.reverse();

    // Ensure exact connected start and destination endpoints
    const ctrlPts: THREE.Vector3[] = [new THREE.Vector3(startX, getTerrainHeight(startX, startZ), startZ)];
    const stride = Math.max(1, Math.floor(rawPts.length / 18));
    for (let i = stride; i < rawPts.length - 1; i += stride) {
      const p = rawPts[i];
      // Subtle organic river-meander offset (avoids straight artificial lines!)
      const meander = fbm2D(p.x * 0.06, p.z * 0.06, 2) * 2.2;
      const mx = p.x + meander;
      const mz = p.z - meander * 0.7;
      if (!isNearFossilCore(mx, mz, 0.85)) {
        ctrlPts.push(new THREE.Vector3(mx, getTerrainHeight(mx, mz), mz));
      } else {
        ctrlPts.push(p);
      }
    }
    ctrlPts.push(new THREE.Vector3(endX, getTerrainHeight(endX, endZ), endZ));

    if (ctrlPts.length === 2) {
      const mid = ctrlPts[0].clone().lerp(ctrlPts[1], 0.5);
      const perpX = -(ctrlPts[1].z - ctrlPts[0].z);
      const perpZ = ctrlPts[1].x - ctrlPts[0].x;
      const len = Math.hypot(perpX, perpZ) || 1;
      const kick = Math.min(3.2, len * 0.18);
      mid.x += (perpX / len) * kick;
      mid.z += (perpZ / len) * kick;
      mid.y = getTerrainHeight(mid.x, mid.z);
      ctrlPts.splice(1, 0, mid);
    }

    const curve = new THREE.CatmullRomCurve3(ctrlPts, false, 'catmullrom', 0.5);
    const totalLen = curve.getLength();
    const sampleCount = clamp(Math.round(totalLen / 1.4), 14, 140);
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const pt = curve.getPoint(i / sampleCount);
      pt.y = getTerrainHeight(pt.x, pt.z);
      out.push(pt);
    }
    return out;
  };

  // =========================================================================
  // SHARED UNIFORMS & GROUND INTERACTION CUES
  // =========================================================================
  const defaultOriginY = getTerrainHeight(RESTORATION_CENTER.x, RESTORATION_CENTER.y);
  const sharedUniforms = {
    uTime: { value: 0 },
    uRestoreOrigin: { value: new THREE.Vector3(RESTORATION_CENTER.x, defaultOriginY, RESTORATION_CENTER.y) },
    uRestoreProgress: { value: 0 }, // > 0 whenever restoration has been initiated
    uRestoreRadius: { value: RESTORATION_RADIUS },
    uSunDir: { value: SUN_DIRECTION.clone() },
  };

  const buildGroundRing = (radius: number, colorHex: string) => {
    const segs = 24;
    const plane = new THREE.PlaneGeometry(radius * 2, radius * 2, segs, segs);
    plane.rotateX(-Math.PI * 0.5);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uOpacity: { value: 0.0 },
        uColor: { value: new THREE.Color(colorHex) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float d = length(p);
          if (d > 1.0) discard;
          float pulse = fract(uTime * 0.28);
          float ring1 = exp(-pow((d - pulse * 0.88) * 11.0, 2.0)) * (1.0 - pulse);
          float pulse2 = fract(uTime * 0.28 + 0.5);
          float ring2 = exp(-pow((d - pulse2 * 0.88) * 11.0, 2.0)) * (1.0 - pulse2);
          float core = exp(-d * d * 7.5) * (0.45 + 0.15 * sin(uTime * 1.6));
          float alpha = (ring1 * 0.55 + ring2 * 0.55 + core * 0.55) * (1.0 - smoothstep(0.75, 1.0, d)) * uOpacity;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });
    const mesh = new THREE.Mesh(plane, mat);
    mesh.renderOrder = 3;
    return { mesh, mat };
  };

  const conformPlaneToTerrain = (mesh: THREE.Mesh, cx: number, cz: number) => {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      pos.setY(i, getTerrainHeight(cx + lx, cz + lz) + 0.15);
    }
    pos.needsUpdate = true;
    mesh.position.set(cx, 0, cz);
  };

  // Subtle initial invitation shimmer in the foreground damaged basin (fades once first restoration starts)
  const springCue = buildGroundRing(4.2, '#86bfa8');
  conformPlaneToTerrain(springCue.mesh, RESTORATION_CENTER.x, RESTORATION_CENTER.y);
  springCue.mat.uniforms.uOpacity.value = 0.55;
  group.add(springCue.mesh);

  // Delicate hover cue tracking pointer over ANY valid damaged western terrain
  const hoverCue = buildGroundRing(2.4, '#b8d9c4');
  hoverCue.mesh.visible = false;
  group.add(hoverCue.mesh);
  let hoverTargetOpacity = 0;

  // =========================================================================
  // UNIFIED GPU-DRIVEN ECOLOGICAL VEGETATION ACROSS THE ENTIRE WESTERN WORLD
  // Samples uRestoreFieldMap directly in the vertex shader -> ZERO overlap duplication!
  // =========================================================================
  const applyFieldGrowthShader = (
    mat: THREE.MeshStandardMaterial,
    options: {
      swayStrength: number;
      sssStrength: number;
      channelIndex: 1 | 2; // 1 = moss (G, Stage B), 2 = life (B, Stage C)
      uncurlFern?: boolean;
      sproutColorShift?: boolean;
      bloomStage?: boolean;
      reedChannel?: boolean;
      sinkDepth?: number;
    }
  ) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = sharedUniforms.uTime;
      shader.uniforms.uRestoreFieldMap = { value: fieldMap };
      shader.uniforms.uRestoreBounds = { value: bounds };
      shader.uniforms.uSunDir = sharedUniforms.uSunDir;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform sampler2D uRestoreFieldMap;
          uniform vec4 uRestoreBounds;
          attribute vec2 aGrowthSeed; // x = birth threshold, y = duration
          varying float vGrowth;
          varying float vBladeY;
          varying vec3 vRestWorld;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vBladeY = uv.y;
          vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          vec2 fUv = (instPos.xz - uRestoreBounds.xy) * uRestoreBounds.zw;
          vec4 fieldSample = (fUv.x >= 0.0 && fUv.x <= 1.0 && fUv.y >= 0.0 && fUv.y <= 1.0)
            ? texture2D(uRestoreFieldMap, fUv)
            : vec4(0.0);

          float driver = ${
            options.reedChannel
              ? 'max(fieldSample.a * 0.95, fieldSample.g * 0.65)'
              : options.channelIndex === 1
              ? 'fieldSample.g'
              : 'fieldSample.b'
          };
          float rawG = clamp((driver - aGrowthSeed.x) / max(aGrowthSeed.y, 0.05), 0.0, 1.0);
          float g = rawG * rawG * (3.0 - 2.0 * rawG);
          vGrowth = g;

          if (g <= 0.002) {
            transformed = vec3(0.0, -3.0, 0.0);
          } else {
            ${
              options.uncurlFern
                ? `
                float spread = smoothstep(0.08, 1.0, g);
                float rise = smoothstep(0.0, 0.82, g);
                transformed.xz *= mix(0.18, 1.0, spread);
                transformed.y *= mix(0.12, 1.0, rise);
                transformed.y -= (1.0 - rise) * 0.16;
                `
                : options.bloomStage
                ? `
                float stemRise = smoothstep(0.0, 0.58, g);
                float petalOpen = smoothstep(0.42, 1.0, g);
                transformed.y *= stemRise;
                transformed.xz *= mix(0.06, 1.0, petalOpen);
                transformed.y -= (1.0 - stemRise) * 0.12;
                `
                : `
                float hGrow = smoothstep(0.0, 0.92, g);
                float wGrow = smoothstep(0.05, 1.0, g);
                transformed.y *= hGrow;
                transformed.xz *= mix(0.32, 1.0, wGrow);
                transformed.y -= (1.0 - hGrow) * ${(options.sinkDepth ?? 0.12).toFixed(3)};
                `
            }
            vec4 gw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
            float hFactor = clamp(transformed.y * 0.42, 0.0, 1.4);
            float gust = sin(uTime * 1.8 + gw.x * 0.14 + gw.z * 0.10) * 0.65
                       + sin(uTime * 3.0 + gw.x * 0.34 - gw.z * 0.25) * 0.35;
            transformed.x += gust * ${options.swayStrength.toFixed(3)} * hFactor * g;
            transformed.z += cos(uTime * 1.3 + gw.z * 0.12) * ${(options.swayStrength * 0.58).toFixed(3)} * hFactor * g;
          }`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vRestWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uSunDir;
          varying float vGrowth;
          varying float vBladeY;
          varying vec3 vRestWorld;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vGrowth <= 0.003) discard;
          ${
            options.sproutColorShift
              ? `
              vec3 youngShoot = vec3(0.44, 0.58, 0.19);
              diffuseColor.rgb = mix(youngShoot, diffuseColor.rgb, smoothstep(0.15, 0.85, vGrowth));
              diffuseColor.rgb *= mix(0.46, 1.18, smoothstep(0.0, 0.9, vBladeY));
              `
              : ''
          }`
        )
        .replace(
          '#include <dithering_fragment>',
          `vec3 rView = normalize(vRestWorld - cameraPosition);
          float rBack = pow(clamp(dot(rView, uSunDir), 0.0, 1.0), 3.0);
          gl_FragColor.rgb += vec3(0.32, 0.40, 0.09) * rBack * ${options.sssStrength.toFixed(3)};
          #include <dithering_fragment>`
        );
    };
  };

  const dummy = new THREE.Object3D();

  const isSuitableRestorationPlantSpot = (x: number, z: number, maxSlope = 0.34): boolean => {
    if (getVitality(x, z) > 0.62) return false;
    if (isPointInWater(x, z).inWater) return false;
    if (isNearFossilCore(x, z, 0.68)) return false; // Never bury or cover fossil bones!
    if (Math.hypot(x - FACTORY_CENTER.x, z - FACTORY_CENTER.y) < 30.0) return false;
    if (Math.hypot(x - DISTANT_PLANT_POS.x, z - DISTANT_PLANT_POS.y) < 24.0) return false;
    if (Math.hypot(x - WEIR_POS.x, z - WEIR_POS.y) < 11.5) return false;
    const y = getTerrainHeight(x, z);
    if (y < 0.6 || y > 48) return false;
    if (getTerrainSlope(x, z) > maxSlope) return false;
    return true;
  };

  // Sample coordinates biased slightly denser in the closer western basin while covering the entire western world!
  const sampleWesternSpot = (): [number, number] => {
    if (rand() < 0.42) {
      // Rich density in the central/mid western basin (-85..14, -35..65)
      return [lerp(-88, 14, rand()), lerp(-35, 68, rand())];
    }
    return [lerp(minX + 12, 16, rand()), lerp(minZ + 14, maxZ - 14, rand())];
  };

  // 1. STAGE B — GRASS & TENDER SHOOTS (~17,500 instanced across entire western world!)
  {
    const grassGeo = buildGrassTuftGeo();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const seeds: number[] = [];
    const grassA = new THREE.Color('#396d23');
    const grassB = new THREE.Color('#668c2b');
    const grassSun = new THREE.Color('#929e38');

    for (let attempt = 0; attempt < 46000 && matrices.length < 17500; attempt++) {
      const [x, z] = sampleWesternSpot();
      if (!isSuitableRestorationPlantSpot(x, z, 0.34)) continue;
      const y = getTerrainHeight(x, z);
      const sH = 0.62 + rand() * 0.96;
      const sW = 0.8 + rand() * 0.52;
      dummy.position.set(x, y - 0.03, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(sW, sH, sW);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());

      const c = grassA.clone().lerp(grassB, rand());
      if (rand() > 0.64) c.lerp(grassSun, rand() * 0.42);
      c.multiplyScalar(0.84 + rand() * 0.32);
      colors.push(c);
      seeds.push(0.08 + rand() * 0.28, 0.28 + rand() * 0.22);
    }

    grassGeo.setAttribute('aGrowthSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2));
    const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, side: THREE.DoubleSide });
    applyFieldGrowthShader(grassMat, { swayStrength: 0.22, sssStrength: 0.38, channelIndex: 1, sproutColorShift: true, sinkDepth: 0.08 });
    const mesh = new THREE.InstancedMesh(grassGeo, grassMat, matrices.length);
    mesh.receiveShadow = true;
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  // 2. STAGE B/C — UNFURLING WOODLAND SWORD FERNS (~1,350 instanced!)
  {
    const fernGeo = buildFernRosetteGeo();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const seeds: number[] = [];

    for (let attempt = 0; attempt < 9500 && matrices.length < 1350; attempt++) {
      const [x, z] = sampleWesternSpot();
      if (!isSuitableRestorationPlantSpot(x, z, 0.35)) continue;
      const y = getTerrainHeight(x, z);
      const s = 0.62 + rand() * 0.82;
      dummy.position.set(x, y - 0.04, z);
      dummy.rotation.set((rand() - 0.5) * 0.14, rand() * Math.PI * 2, (rand() - 0.5) * 0.14);
      dummy.scale.set(s, s * (0.85 + rand() * 0.28), s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      colors.push(new THREE.Color().setHSL(0.26 + (rand() - 0.5) * 0.04, 0.44 + rand() * 0.16, 0.38 + rand() * 0.14));
      seeds.push(0.24 + rand() * 0.26, 0.32 + rand() * 0.22);
    }

    fernGeo.setAttribute('aGrowthSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2));
    const fernMat = new THREE.MeshStandardMaterial({ map: textures.fernFrondMap, alphaTest: 0.34, side: THREE.DoubleSide, roughness: 0.72 });
    applyFieldGrowthShader(fernMat, { swayStrength: 0.14, sssStrength: 0.34, channelIndex: 1, uncurlFern: true });
    const mesh = new THREE.InstancedMesh(fernGeo, fernMat, matrices.length);
    mesh.receiveShadow = true;
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  // 3. STAGE B/C — LOW LEAFY WOODLAND UNDERSTORY PLANTS (~1,100 instanced!)
  {
    const plantGeo = buildUnderstoryPlantGeo();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const seeds: number[] = [];

    for (let attempt = 0; attempt < 8000 && matrices.length < 1100; attempt++) {
      const [x, z] = sampleWesternSpot();
      if (!isSuitableRestorationPlantSpot(x, z, 0.32)) continue;
      const y = getTerrainHeight(x, z);
      const s = 0.52 + rand() * 0.72;
      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(s, s * (0.82 + rand() * 0.3), s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      colors.push(new THREE.Color().setHSL(0.27 + (rand() - 0.5) * 0.06, 0.36 + rand() * 0.16, 0.42 + rand() * 0.16));
      seeds.push(0.28 + rand() * 0.28, 0.34 + rand() * 0.2);
    }

    plantGeo.setAttribute('aGrowthSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2));
    const plantMat = new THREE.MeshStandardMaterial({ map: textures.broadleafMap, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.76 });
    applyFieldGrowthShader(plantMat, { swayStrength: 0.12, sssStrength: 0.28, channelIndex: 2, sinkDepth: 0.1 });
    const mesh = new THREE.InstancedMesh(plantGeo, plantMat, matrices.length);
    mesh.receiveShadow = true;
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  // 4. STAGE C — TWO-STAGE BLOOMING WILDFLOWERS (~2,100 clusters!)
  {
    const wfGeos = buildWildflowerGeos();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const seeds: number[] = [];
    const palette = [
      new THREE.Color('#e8c766'),
      new THREE.Color('#ede8d8'),
      new THREE.Color('#9ca5d4'),
      new THREE.Color('#d9886a'),
      new THREE.Color('#b8c7e0'),
    ];

    for (let attempt = 0; attempt < 14000 && matrices.length < 2100; attempt++) {
      const [x, z] = sampleWesternSpot();
      if (!isSuitableRestorationPlantSpot(x, z, 0.28)) continue;
      const clump = Math.sin(x * 0.24) * Math.cos(z * 0.24) * 0.5 + 0.5;
      if (rand() > clump * 0.82 + 0.18) continue;
      const y = getTerrainHeight(x, z);
      const s = 0.72 + rand() * 0.68;
      dummy.position.set(x, y - 0.02, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      const col = palette[Math.floor(rand() * palette.length)].clone();
      col.multiplyScalar(0.86 + rand() * 0.24);
      colors.push(col);
      seeds.push(0.16 + rand() * 0.30, 0.36 + rand() * 0.22);
    }

    const attr = new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2);
    wfGeos.stems.setAttribute('aGrowthSeed', attr);
    wfGeos.blooms.setAttribute('aGrowthSeed', attr.clone());
    const wfStemMat = new THREE.MeshStandardMaterial({ color: '#456b2a', roughness: 0.84 });
    const wfBloomMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.56, side: THREE.DoubleSide });
    applyFieldGrowthShader(wfStemMat, { swayStrength: 0.22, sssStrength: 0.12, channelIndex: 2, sinkDepth: 0.08 });
    applyFieldGrowthShader(wfBloomMat, { swayStrength: 0.22, sssStrength: 0.42, channelIndex: 2, bloomStage: true });

    const stemsMesh = new THREE.InstancedMesh(wfGeos.stems, wfStemMat, matrices.length);
    const bloomsMesh = new THREE.InstancedMesh(wfGeos.blooms, wfBloomMat, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      stemsMesh.setMatrixAt(i, matrices[i]);
      bloomsMesh.setMatrixAt(i, matrices[i]);
      bloomsMesh.setColorAt(i, colors[i]);
    }
    stemsMesh.instanceMatrix.needsUpdate = true;
    bloomsMesh.instanceMatrix.needsUpdate = true;
    if (bloomsMesh.instanceColor) bloomsMesh.instanceColor.needsUpdate = true;
    group.add(stemsMesh, bloomsMesh);
  }

  // 5. STAGE C — YOUNG REGENERATING SAPLINGS (~92 slender young trees across western valleys!)
  {
    const sapGeos = buildYoungSaplingGeos();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const seeds: number[] = [];

    for (let attempt = 0; attempt < 3200 && matrices.length < 92; attempt++) {
      const [x, z] = sampleWesternSpot();
      if (!isSuitableRestorationPlantSpot(x, z, 0.24)) continue;
      if (Math.hypot(x - -38.5, z - 24.0) < 7.0) continue;

      let tooClose = false;
      for (const m of matrices) {
        if (Math.hypot(x - m.elements[12], z - m.elements[14]) < 7.5) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const y = getTerrainHeight(x, z);
      const s = 0.68 + rand() * 0.62;
      dummy.position.set(x, y - 0.14, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      colors.push(new THREE.Color().setHSL(0.25 + (rand() - 0.4) * 0.06, 0.42 + rand() * 0.16, 0.40 + rand() * 0.14));
      seeds.push(0.32 + rand() * 0.24, 0.42 + rand() * 0.18);
    }

    const attr = new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2);
    sapGeos.trunk.setAttribute('aGrowthSeed', attr);
    sapGeos.foliage.setAttribute('aGrowthSeed', attr.clone());
    const sapTrunkMat = new THREE.MeshStandardMaterial({ map: textures.barkMap, color: new THREE.Color('#7f6c58'), roughness: 0.92 });
    const sapLeafMat = new THREE.MeshStandardMaterial({ map: textures.broadleafMap, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.72 });
    applyFieldGrowthShader(sapTrunkMat, { swayStrength: 0.08, sssStrength: 0.05, channelIndex: 2, sinkDepth: 0.28 });
    applyFieldGrowthShader(sapLeafMat, { swayStrength: 0.16, sssStrength: 0.36, channelIndex: 2, sinkDepth: 0.28 });

    const trunks = new THREE.InstancedMesh(sapGeos.trunk, sapTrunkMat, matrices.length);
    const leaves = new THREE.InstancedMesh(sapGeos.foliage, sapLeafMat, matrices.length);
    trunks.castShadow = true;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    for (let i = 0; i < matrices.length; i++) {
      trunks.setMatrixAt(i, matrices[i]);
      leaves.setMatrixAt(i, matrices[i]);
      leaves.setColorAt(i, colors[i]);
    }
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    group.add(trunks, leaves);
  }

  // =========================================================================
  // DYNAMIC CUMULATIVE TRIBUTARY NETWORK STATE & SPATIAL FIELD SOLVER
  // =========================================================================
  const branches: InternalBranch[] = [];
  let nextBranchId = 1;
  let fieldDirty = false;
  let fieldAccumDt = 0;
  let dirtyMinIX = FIELD_SIZE;
  let dirtyMaxIX = -1;
  let dirtyMinIZ = FIELD_SIZE;
  let dirtyMaxIZ = -1;

  const stampFieldCircle = (wx: number, wz: number, radius: number, moistAmt: number, chanAmt: number) => {
    const cix = ((wx - minX) / spanX) * (FIELD_SIZE - 1);
    const ciz = ((wz - minZ) / spanZ) * (FIELD_SIZE - 1);
    const rx = Math.ceil((radius / spanX) * FIELD_SIZE) + 1;
    const rz = Math.ceil((radius / spanZ) * FIELD_SIZE) + 1;
    const x0 = clamp(Math.floor(cix - rx), 0, FIELD_SIZE - 1);
    const x1 = clamp(Math.ceil(cix + rx), 0, FIELD_SIZE - 1);
    const z0 = clamp(Math.floor(ciz - rz), 0, FIELD_SIZE - 1);
    const z1 = clamp(Math.ceil(ciz + rz), 0, FIELD_SIZE - 1);

    if (x0 < dirtyMinIX) dirtyMinIX = x0;
    if (x1 > dirtyMaxIX) dirtyMaxIX = x1;
    if (z0 < dirtyMinIZ) dirtyMinIZ = z0;
    if (z1 > dirtyMaxIZ) dirtyMaxIZ = z1;

    for (let iz = z0; iz <= z1; iz++) {
      const pz = minZ + (iz / (FIELD_SIZE - 1)) * spanZ;
      for (let ix = x0; ix <= x1; ix++) {
        const px = minX + (ix / (FIELD_SIZE - 1)) * spanX;
        const idx = iz * FIELD_SIZE + ix;
        const nWarp = (fNoise[idx] - 0.5) * radius * 0.36;
        const d = Math.hypot(px - wx, pz - wz) + nWarp;
        if (d > radius) continue;

        const falloff = 1 - smoothstep(radius * 0.22, radius, d);
        const targetM = falloff * moistAmt;
        if (targetM > fMoist[idx]) {
          fMoist[idx] = Math.min(1, lerp(fMoist[idx], targetM, 0.38) + targetM * 0.16);
          fieldDirty = true;
        }
        if (chanAmt > 0) {
          const targetC = (1 - smoothstep(0, radius * 0.55, Math.hypot(px - wx, pz - wz))) * chanAmt;
          if (targetC > fChan[idx]) {
            fChan[idx] = Math.min(1, targetC);
            fieldDirty = true;
          }
        }
      }
    }
  };

  // Find closest connected water source (living river OR already established tributary points!)
  const findNearestWaterSource = (tx: number, tz: number): { x: number; z: number; dist: number } => {
    let bestX = 16.5;
    let bestZ = 18.0;
    let bestD2 = Infinity;

    for (let i = 0; i < LIVING_RIVER_SAMPLES.length; i++) {
      const s = LIVING_RIVER_SAMPLES[i];
      if (s.z < -36 || s.z > 125) continue;
      const d2 = (tx - s.x) * (tx - s.x) + (tz - s.z) * (tz - s.z);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestX = s.x;
        bestZ = s.z;
      }
    }

    // Also allow branching cleanly off already-established tributaries so waterways form a real connected network!
    for (let b = 0; b < branches.length; b++) {
      const br = branches[b];
      const maxIdx = Math.floor(br.headT * (br.points.length - 1));
      for (let i = 2; i <= maxIdx; i += 2) {
        const p = br.points[i];
        const d2 = (tx - p.x) * (tx - p.x) + (tz - p.z) * (tz - p.z);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestX = p.x;
          bestZ = p.z;
        }
      }
    }

    return { x: bestX, z: bestZ, dist: Math.sqrt(bestD2) };
  };

  // Spawn 2 small organic branching secondary trickles fanning out once water reaches a destination!
  const spawnDestinationTrickles = (br: InternalBranch) => {
    if (br.trickleSpawned) return;
    br.trickleSpawned = true;
    const dest = br.destination;
    for (let k = 0; k < 2; k++) {
      const ang = (k === 0 ? 1.1 : -1.25) + (br.id * 1.37);
      const len = 7.5 + (k % 2) * 3.5;
      const pts: THREE.Vector3[] = [];
      const widths: number[] = [];
      for (let s = 0; s <= 10; s++) {
        const f = s / 10;
        const wiggle = Math.sin(f * Math.PI * 1.8 + k * 2.1) * 1.4;
        const px = dest.x + Math.cos(ang) * len * f - Math.sin(ang) * wiggle;
        const pz = dest.z + Math.sin(ang) * len * f + Math.cos(ang) * wiggle;
        if (isNearFossilCore(px, pz, 0.72)) break;
        pts.push(new THREE.Vector3(px, getTerrainHeight(px, pz), pz));
        widths.push(lerp(0.85, 0.25, f));
      }
      if (pts.length >= 4) {
        const tGeo = buildTributaryRibbonGeometry(pts, widths, false);
        const tMat = createTributaryWaterMaterial(sharedUniforms.uTime);
        const tMesh = new THREE.Mesh(tGeo, tMat);
        tMesh.renderOrder = 2;
        branchGroup.add(tMesh);
        br.trickleMeshes.push(tMesh);
        br.trickleMats.push(tMat);
      }
    }
  };

  const sampleStateAt = (x: number, z: number): RestorationSample => {
    const u = (x - minX) / spanX;
    const v = (z - minZ) / spanZ;
    if (u < 0 || u > 1 || v < 0 || v > 1) return { moisture: 0, moss: 0, life: 0, channel: 0 };
    const ix = clamp(Math.round(u * (FIELD_SIZE - 1)), 0, FIELD_SIZE - 1);
    const iz = clamp(Math.round(v * (FIELD_SIZE - 1)), 0, FIELD_SIZE - 1);
    const idx = iz * FIELD_SIZE + ix;
    return {
      moisture: fMoist[idx],
      moss: fMoss[idx],
      life: fLife[idx],
      channel: fChan[idx],
    };
  };

  // =========================================================================
  // PUBLIC INTERACTION API — TOUCH ANYWHERE ON DAMAGED WESTERN LANDSCAPE!
  // =========================================================================
  const isInsideZone = (point: THREE.Vector3): boolean => {
    if (point.x < minX + 10 || point.x > 18 || point.z < minZ + 12 || point.z > maxZ - 12) return false;
    // Allow touching any damaged / drought-affected western terrain (including burned forests, fossils & dried riverbeds!)
    if (getVitality(point.x, point.z) > 0.64) return false;
    if (isPointInWater(point.x, point.z).inWater) return false;
    if (Math.hypot(point.x - FACTORY_CENTER.x, point.z - FACTORY_CENTER.y) < 24.0) return false;
    if (Math.hypot(point.x - DISTANT_PLANT_POS.x, point.z - DISTANT_PLANT_POS.y) < 18.0) return false;
    const y = getTerrainHeight(point.x, point.z);
    if (y > 48 || getTerrainSlope(point.x, point.z) > 0.58) return false;
    return true;
  };

  const setHoverPoint = (point: THREE.Vector3 | null) => {
    if (!point || !isInsideZone(point)) {
      hoverTargetOpacity = 0;
      return;
    }
    conformPlaneToTerrain(hoverCue.mesh, point.x, point.z);
    hoverCue.mesh.visible = true;
    hoverTargetOpacity = 0.58;
  };

  const trigger = (destination: THREE.Vector3): boolean => {
    // Clamp gently inside routable western bounds
    const tx = clamp(destination.x, minX + 12, 16);
    const tz = clamp(destination.z, minZ + 14, maxZ - 14);
    const dest = new THREE.Vector3(tx, getTerrainHeight(tx, tz), tz);

    // Avoid spawning redundant duplicate streams on top of an already-reached endpoint
    for (const br of branches) {
      if (Math.hypot(br.destination.x - tx, br.destination.z - tz) < 5.5) {
        // Gently expand moisture around existing endpoint instead of duplicating river
        br.maxDestRadius = Math.min(28, br.maxDestRadius + 4.0);
        return true;
      }
    }

    // Cap total simultaneous branches at 14 for guaranteed smooth browser performance
    if (branches.length >= 14) {
      stampFieldCircle(tx, tz, 14.0, 1.0, 0.4);
      return true;
    }

    const src = findNearestWaterSource(tx, tz);
    const points = findNaturalWaterRoute(src.x, src.z, tx, tz);
    let pathLen = 0;
    for (let i = 1; i < points.length; i++) {
      pathLen += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    }
    pathLen = Math.max(pathLen, 3.0);

    // Natural tributary width: wider where following carved dry riverbed, slender natural creek across hills
    const widths = points.map((p, idx) => {
      const f = idx / Math.max(1, points.length - 1);
      const dry = getDryRiverInfo(p.x, p.z);
      const inDry = dry.dist < dry.width * 0.85 && p.x < 10;
      const baseW = inDry ? lerp(2.2, 1.65, f) : lerp(1.55, 0.95, f);
      return baseW;
    });

    const geo = buildTributaryRibbonGeometry(points, widths, true);
    const mat = createTributaryWaterMaterial(sharedUniforms.uTime);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    branchGroup.add(mesh);

    // Visible flowing travel speed (~12–16 m/s; min 2.2s, max ~9s even across the entire western basin!)
    const travelSeconds = clamp(pathLen / 13.5, 2.2, 9.2);

    branches.push({
      id: nextBranchId++,
      points,
      widths,
      destination: dest,
      length: pathLen,
      headT: 0.02,
      flowSpeedT: 1.0 / travelSeconds,
      age: 0,
      destSpreadRadius: 3.5,
      maxDestRadius: 23.5,
      destArrivedTime: -1,
      mesh,
      material: mat,
      trickleMeshes: [],
      trickleMats: [],
      trickleSpawned: false,
    });

    sharedUniforms.uRestoreOrigin.value.copy(dest);
    sharedUniforms.uRestoreProgress.value = 1.0;
    hoverTargetOpacity = 0;
    hoverCue.mesh.visible = false;
    return true;
  };

  const reset = () => {
    // Cleanly dispose ALL dynamically created tributary meshes & materials (zero GPU memory leaks!)
    for (const br of branches) {
      branchGroup.remove(br.mesh);
      br.mesh.geometry.dispose();
      br.material.dispose();
      for (let i = 0; i < br.trickleMeshes.length; i++) {
        branchGroup.remove(br.trickleMeshes[i]);
        br.trickleMeshes[i].geometry.dispose();
        br.trickleMats[i].dispose();
      }
    }
    branches.length = 0;

    // Zero the unified 256x256 spatial restoration field cleanly
    fMoist.fill(0);
    fMoss.fill(0);
    fLife.fill(0);
    fChan.fill(0);
    fieldBytes.fill(0);
    fieldMap.needsUpdate = true;

    fieldDirty = false;
    dirtyMinIX = FIELD_SIZE;
    dirtyMaxIX = -1;
    dirtyMinIZ = FIELD_SIZE;
    dirtyMaxIZ = -1;

    sharedUniforms.uRestoreProgress.value = 0;
    sharedUniforms.uRestoreOrigin.value.set(RESTORATION_CENTER.x, defaultOriginY, RESTORATION_CENTER.y);
    springCue.mesh.visible = true;
  };

  const getState = (): RestorationState => {
    const active = branches.length > 0;
    let avgProgress = 0;
    if (active) {
      for (const br of branches) {
        const arrival = br.headT * 0.45;
        const spread = br.destArrivedTime >= 0 ? clamp((br.age - br.destArrivedTime) / 14.0, 0, 1) * 0.55 : 0;
        avgProgress += arrival + spread;
      }
      avgProgress /= branches.length;
    }
    return {
      active,
      progress: clamp(avgProgress, 0, 1),
      branchCount: branches.length,
    };
  };

  const getConnectedBranches = (): TributaryBranchInfo[] => {
    return branches.map((br) => ({
      id: br.id,
      points: br.points,
      headT: br.headT,
      age: br.age,
      length: br.length,
      destination: br.destination,
    }));
  };

  const getEstablishedClearings = (): RestoredClearingInfo[] => {
    const out: RestoredClearingInfo[] = [];
    for (const br of branches) {
      if (br.headT < 0.95) continue;
      const sample = sampleStateAt(br.destination.x, br.destination.z);
      if (sample.life > 0.35) {
        out.push({
          x: br.destination.x,
          y: br.destination.y,
          z: br.destination.z,
          maturity: sample.life,
        });
      }
    }
    return out;
  };

  const update = (time: number, dt: number) => {
    sharedUniforms.uTime.value = time;
    const safeDt = Math.min(dt, 0.05);

    // 1. Advance flowing water along every active tributary branch
    for (let b = 0; b < branches.length; b++) {
      const br = branches[b];
      br.age += safeDt;

      if (br.headT < 1.0) {
        br.headT = Math.min(1.0, br.headT + safeDt * br.flowSpeedT);
        br.material.uniforms.uHeadT.value = br.headT;
        if (br.headT >= 0.995 && br.destArrivedTime < 0) {
          br.destArrivedTime = br.age;
          spawnDestinationTrickles(br);
        }
      }

      // Advance secondary destination trickles once main water arrives
      if (br.destArrivedTime >= 0) {
        const trickleT = clamp((br.age - br.destArrivedTime) / 3.6, 0, 1);
        for (const tm of br.trickleMats) {
          tm.uniforms.uHeadT.value = trickleT;
        }
        // Gradually expand destination restoration spread outward from water
        br.destSpreadRadius = Math.min(br.maxDestRadius, br.destSpreadRadius + safeDt * 1.9);
      }
    }

    // 2. Step the 256x256 spatial restoration field at ~16 Hz whenever restoration is active
    if (branches.length > 0) {
      fieldAccumDt += safeDt;
      if (fieldAccumDt >= 0.06) {
        const stepDt = fieldAccumDt;
        fieldAccumDt = 0;

        // Stamp live moisture along every flowing tributary path up to headT + expanding destination zone
        for (const br of branches) {
          const maxPtIdx = Math.floor(br.headT * (br.points.length - 1));
          const stepStride = Math.max(1, Math.floor(br.points.length / 45));
          for (let i = 0; i <= maxPtIdx; i += stepStride) {
            const p = br.points[i];
            const bankRadius = br.widths[i] + 6.2;
            stampFieldCircle(p.x, p.z, bankRadius, 0.96, 1.0);
          }
          // Always stamp live water tip
          const tipPt = br.points[maxPtIdx];
          if (tipPt) {
            stampFieldCircle(tipPt.x, tipPt.z, 6.5, 0.95, 1.0);
          }
          // Broad organic restoration spread outward around reached destination!
          if (br.destArrivedTime >= 0) {
            stampFieldCircle(br.destination.x, br.destination.z, br.destSpreadRadius, 1.0, 0.45);
          }
        }

        // Advance Stage A (Moisture) -> Stage B (Moss) -> Stage C (Life) smoothly inside dirty bounding box!
        if (dirtyMaxIX >= dirtyMinIX && dirtyMaxIZ >= dirtyMinIZ) {
          let anyChanged = fieldDirty;
          for (let iz = dirtyMinIZ; iz <= dirtyMaxIZ; iz++) {
            const rowOff = iz * FIELD_SIZE;
            for (let ix = dirtyMinIX; ix <= dirtyMaxIX; ix++) {
              const idx = rowOff + ix;
              const m = fMoist[idx];
              if (m <= 0.005) continue;

              const n = fNoise[idx];
              // Stage B: Moss awakens smoothly once soil is sufficiently moistened
              if (m > 0.24 && fMoss[idx] < m) {
                const mossRate = (0.095 + n * 0.075) * stepDt;
                fMoss[idx] = Math.min(m, fMoss[idx] + mossRate);
                anyChanged = true;
              }
              // Stage C: Deeper ecosystem life (wildflowers, saplings, deer habitats) matures behind moss
              if (fMoss[idx] > 0.22 && fLife[idx] < fMoss[idx]) {
                const lifeRate = (0.075 + n * 0.065) * stepDt;
                fLife[idx] = Math.min(fMoss[idx], fLife[idx] + lifeRate);
                anyChanged = true;
              }

              const bOff = idx * 4;
              fieldBytes[bOff] = Math.round(fMoist[idx] * 255);
              fieldBytes[bOff + 1] = Math.round(fMoss[idx] * 255);
              fieldBytes[bOff + 2] = Math.round(fLife[idx] * 255);
              fieldBytes[bOff + 3] = Math.round(fChan[idx] * 255);
            }
          }
          if (anyChanged) {
            fieldMap.needsUpdate = true;
            fieldDirty = false;
          }
        }
      }
    }

    // Smoothly fade initial spring cue once first branch starts; update hover cue
    const springTarget = branches.length > 0 ? 0 : 0.52;
    springCue.mat.uniforms.uOpacity.value = lerp(springCue.mat.uniforms.uOpacity.value, springTarget, clamp(safeDt * 4.5, 0, 1));
    springCue.mesh.visible = springCue.mat.uniforms.uOpacity.value > 0.008;

    hoverCue.mat.uniforms.uOpacity.value = lerp(hoverCue.mat.uniforms.uOpacity.value, hoverTargetOpacity, clamp(safeDt * 8.0, 0, 1));
    if (hoverCue.mat.uniforms.uOpacity.value < 0.008) hoverCue.mesh.visible = false;
  };

  void DRY_RIVER_SAMPLES.length;

  return {
    group,
    fieldMap,
    bounds,
    uniforms: {
      uRestoreOrigin: sharedUniforms.uRestoreOrigin,
      uRestoreProgress: sharedUniforms.uRestoreProgress,
      uRestoreRadius: sharedUniforms.uRestoreRadius,
    },
    isInsideZone,
    setHoverPoint,
    trigger,
    reset,
    update,
    getState,
    sampleStateAt,
    getConnectedBranches,
    getEstablishedClearings,
  };
}
