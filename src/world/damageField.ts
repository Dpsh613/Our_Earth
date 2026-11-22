import * as THREE from 'three';
import { clamp, fbm2D, lerp, ridged2D, smoothstep } from './noise';
import { getDryRiverInfo, getVitality } from './terrainData';

// Vast western devastation field extending deep to the western & northwestern horizon
export const DAMAGE_BOUNDS = {
  minX: -260.0,
  maxX: 14.0,
  minZ: -175.0,
  maxZ: 155.0,
};

// Imposing industrial skyline anchored on the distant northwestern scarred ridge
// Directly visible with its monumental smokestacks & dark billowing smoke in Above the Divide!
export const FACTORY_CENTER = new THREE.Vector2(-86.0, -88.0);
export const DISTANT_PLANT_POS = new THREE.Vector2(-126.0, -56.0);

// Monumental single mid-ground scar: severed reservoir dam choking off water to the dried basin
export const WEIR_POS = new THREE.Vector2(-48.5, 22.0);
export const RESERVOIR_CENTER = new THREE.Vector2(-74.0, 36.0);

// Thin dark iridescent oil-sheen seepage below the choked dam
export const OIL_TRICKLE_PTS: Array<[number, number]> = [
  [-48.5, 22.0],
  [-55.0, 25.4],
  [-63.0, 29.8],
  [-72.0, 35.0],
];

// Branching dendritic dried tributaries showing where vast waterways once flowed across the basin
export const DRY_TRIBUTARIES: Array<Array<[number, number]>> = [
  // Tributary 1: Winding northwest dry creek feeding into the dried reservoir
  [
    [-135.0, 6.0],
    [-112.0, 14.0],
    [-92.0, 20.0],
    [-76.0, 30.0],
  ],
  // Tributary 2: Far southwest cracked desert-lake outlet extending toward the horizon
  [
    [-78.0, 40.0],
    [-106.0, 52.0],
    [-138.0, 66.0],
    [-178.0, 82.0],
  ],
  // Tributary 3: Southern dry arroyo feeding into the lower basin
  [
    [-42.0, 68.0],
    [-54.0, 55.0],
    [-66.0, 44.0],
    [-74.0, 38.0],
  ],
  // Tributary 4: Northern eroded gulch descending from the burned hills
  [
    [-72.0, -32.0],
    [-64.0, -14.0],
    [-58.0, 4.0],
    [-53.0, 18.0],
  ],
  // Tributary 5: Far western dry channel curving below the industrial hills
  [
    [-168.0, -20.0],
    [-146.0, 4.0],
    [-124.0, 24.0],
    [-98.0, 42.0],
  ],
];

// Faint eroded industrial/logging scar descending from the distant factory ridge
export const LOGGING_TRAIL_A: Array<[number, number]> = [
  [-96.0, -64.0],
  [-86.0, -40.0],
  [-74.0, -16.0],
  [-60.0, 2.0],
  [-48.0, 14.0],
];

function samplePolyline(pts: Array<[number, number]>, stepsPerSeg = 8): Array<[number, number]> {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.45
  );
  const total = (pts.length - 1) * stepsPerSeg;
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= total; i++) {
    const p = curve.getPoint(i / total);
    out.push([p.x, p.z]);
  }
  return out;
}

function distToPolyline(poly: Array<[number, number]>, x: number, z: number): number {
  let minD2 = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[i + 1];
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 1e-6 ? clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1) : 0;
    const dx = x - (ax + abx * t);
    const dz = z - (az + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2) minD2 = d2;
  }
  return Math.sqrt(minD2);
}

export interface DamageFieldData {
  texture: THREE.DataTexture;
  bounds: THREE.Vector4; // (minX, minZ, 1/(maxX-minX), 1/(maxZ-minZ))
  isOnLoggingTrail: (x: number, z: number) => boolean;
  isInDriedReservoir: (x: number, z: number) => boolean;
  getBurnedForestDensity: (x: number, z: number) => number;
}

export function createDamageField(): DamageFieldData {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  const trailA = samplePolyline(LOGGING_TRAIL_A, 8);
  const oilPath = samplePolyline(OIL_TRICKLE_PTS, 8);
  const tribPolys = DRY_TRIBUTARIES.map((pts) => samplePolyline(pts, 7));

  const { minX, maxX, minZ, maxZ } = DAMAGE_BOUNDS;

  const evalBurnedForestZone = (x: number, z: number): number => {
    // Enormous contiguous burned woodland sweeping across the western & northwestern slopes & valleys!
    const vit = getVitality(x, z);
    const scarred = smoothstep(0.56, 0.16, vit);
    if (scarred <= 0.01) return 0;

    // Exclude the Phase 2 foreground restoration clearing around (-24.5, 20.5)
    const restClear = smoothstep(14.0, 26.0, Math.hypot(x - -24.5, z - 20.5));

    // Exclude the vast central dried reservoir lakebed so burned forest frames the dried lake organically
    const resDist = Math.hypot((x - RESERVOIR_CENTER.x) * 0.68, (z - RESERVOIR_CENTER.y) * 0.92);
    const lakeClear = smoothstep(17.0, 32.0, resDist);

    // Organic large-scale woodland groves extending far west & northwest to the horizon
    const groveNoise = fbm2D(x * 0.022 + 4.3, z * 0.022 - 2.1, 4) * 0.5 + 0.5;
    const westSweep = smoothstep(-16, -54, x);
    return clamp(scarred * restClear * lakeClear * (0.35 + 0.65 * westSweep) * smoothstep(0.24, 0.62, groveNoise), 0, 1);
  };

  for (let iz = 0; iz < size; iz++) {
    const vz = iz / (size - 1);
    const z = lerp(minZ, maxZ, vz);
    for (let ix = 0; ix < size; ix++) {
      const vx = ix / (size - 1);
      const x = lerp(minX, maxX, vx);

      const vit = getVitality(x, z);
      const scarredMask = smoothstep(0.56, 0.14, vit);

      // R: Enormous burned forest floor (charcoal, scorched humus, ash & soot fallout from distant factory!)
      const burnedGrove = evalBurnedForestZone(x, z);
      const nSoot = fbm2D(x * 0.042 + 3.1, z * 0.042 - 1.9, 4) * 0.5 + 0.5;
      const factoryDist = Math.hypot(x - FACTORY_CENTER.x, z - FACTORY_CENTER.y);
      const distPlantD = Math.hypot(x - DISTANT_PLANT_POS.x, z - DISTANT_PLANT_POS.y);
      const weirD = Math.hypot(x - WEIR_POS.x, z - WEIR_POS.y);

      let soot = burnedGrove * (0.62 + 0.38 * smoothstep(0.32, 0.72, nSoot));
      soot = Math.max(soot, (1 - smoothstep(18, 72, factoryDist)) * 0.95);
      soot = Math.max(soot, (1 - smoothstep(14, 58, distPlantD)) * 0.88);
      soot = Math.max(soot, (1 - smoothstep(4, 18, weirD)) * 0.65);
      soot = clamp(soot * scarredMask, 0, 1);

      // G: Enormous dried lakebeds, pale cracked alkali mudflats & branching abandoned tributaries
      const rx = (x - RESERVOIR_CENTER.x) * 0.64;
      const rz = (z - RESERVOIR_CENTER.y) * 0.88;
      const resWarp = fbm2D(x * 0.048 - 4.2, z * 0.048 + 2.8, 3) * 7.5;
      const resDist = Math.hypot(rx, rz) + resWarp;
      const mainLakebed = 1 - smoothstep(14.0, 42.0, resDist);

      // Branching dry tributary channels etched across the entire western basin
      let tribMask = 0;
      for (let t = 0; t < tribPolys.length; t++) {
        const td = distToPolyline(tribPolys[t], x, z);
        const tw = fbm2D(x * 0.12 + t * 3.7, z * 0.12, 2) * 1.4;
        tribMask = Math.max(tribMask, 1 - smoothstep(1.8, 6.2, td + tw));
      }

      const dry = getDryRiverInfo(x, z);
      const drySilt = (1 - smoothstep(dry.width * 0.35, dry.width + 10.0, dry.dist)) * smoothstep(4, -22, x) * 0.92;
      // Open parched alkali flats in unburned dry depressions
      const openDry = smoothstep(-10, -32, x) * (1 - soot * 0.85) * 0.72;
      const lakebed = clamp(Math.max(mainLakebed, tribMask * 0.94, drySilt, openDry) * scarredMask, 0, 1);

      // B: Eroded oxidized ochre-rust strata, scorched rim ember-ash & industrial haul scar
      const dTrail = distToPolyline(trailA, x, z);
      const trailNoise = fbm2D(x * 0.14, z * 0.14, 2) * 1.0;
      const trailScar = (1 - smoothstep(1.5, 4.4, dTrail + trailNoise)) * 0.72;
      const erosionRidge = ridged2D(x * 0.032 + 5.2, z * 0.032 - 3.8, 3);
      const rustErosion = smoothstep(0.54, 0.82, erosionRidge) * (0.45 + 0.55 * soot) * 0.72;
      const rustMask = clamp(Math.max(trailScar, rustErosion) * scarredMask, 0, 1);

      // A: Dark tarry oil seepage channel & polluted hollow below the choked dam
      const dOil = distToPolyline(oilPath, x, z);
      const oilPool = 1 - smoothstep(2.5, 11.0, Math.hypot(x - RESERVOIR_CENTER.x, z - RESERVOIR_CENTER.y));
      const oilStain = clamp(Math.max(1 - smoothstep(1.0, 3.8, dOil), oilPool * 0.85) * scarredMask, 0, 1);

      const idx = (iz * size + ix) * 4;
      data[idx] = Math.round(soot * 255);
      data[idx + 1] = Math.round(lakebed * 255);
      data[idx + 2] = Math.round(rustMask * 255);
      data[idx + 3] = Math.round(oilStain * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const bounds = new THREE.Vector4(
    minX,
    minZ,
    1 / (maxX - minX),
    1 / (maxZ - minZ)
  );

  return {
    texture,
    bounds,
    isOnLoggingTrail(x: number, z: number): boolean {
      return distToPolyline(trailA, x, z) < 3.6;
    },
    isInDriedReservoir(x: number, z: number): boolean {
      const rx = (x - RESERVOIR_CENTER.x) * 0.68;
      const rz = (z - RESERVOIR_CENTER.y) * 0.92;
      return Math.hypot(rx, rz) < 22.0;
    },
    getBurnedForestDensity: evalBurnedForestZone,
  };
}
