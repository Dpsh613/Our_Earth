import * as THREE from 'three';
import { clamp, fbm2D, lerp, ridged2D, smootherstep, smoothstep, warpedFbm2D } from './noise';

export const WORLD_SIZE = 340;          // Detailed inner world (-170..170)
export const HORIZON_SIZE = 920;        // Outer distant mountain skirt (-460..460)
export const TREE_CENTER = new THREE.Vector2(0, 0);
export const PLUNGE_POOL_CENTER = new THREE.Vector2(24, -36);
export const WATERFALL_TOP = new THREE.Vector3(24.5, 47.2, -50.2);
export const WATERFALL_BOTTOM = new THREE.Vector3(24.0, 2.45, -39.4);

// Sun direction: dramatic golden-hour sunlight raking from East-Southeast across cliffs, canopy, waterfall & valley
export const SUN_DIRECTION = new THREE.Vector3(0.82, 0.42, 0.38).normalize();

export interface RiverSample {
  x: number;
  z: number;
  width: number;
  waterY: number;
  tx: number;
  tz: number;
  s: number; // arc length
}

function sampleCatmullRom(
  controlPts: Array<{ x: number; z: number; width: number; waterY: number }>,
  stepsPerSeg: number
): RiverSample[] {
  const pts = controlPts.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const totalSteps = (controlPts.length - 1) * stepsPerSeg;
  const out: RiverSample[] = [];
  let accumS = 0;

  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const pos = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const segF = t * (controlPts.length - 1);
    const idx = Math.min(Math.floor(segF), controlPts.length - 2);
    const frac = segF - idx;
    const width = lerp(controlPts[idx].width, controlPts[idx + 1].width, frac);
    const waterY = lerp(controlPts[idx].waterY, controlPts[idx + 1].waterY, frac);

    if (i > 0) {
      accumS += Math.hypot(pos.x - out[i - 1].x, pos.z - out[i - 1].z);
    }
    const tLen = Math.hypot(tan.x, tan.z) || 1;
    out.push({
      x: pos.x,
      z: pos.z,
      width,
      waterY,
      tx: tan.x / tLen,
      tz: tan.z / tLen,
      s: accumS,
    });
  }
  return out;
}

// Living river flowing from emerald plunge pool around the eastern side of the ancient tree out into the sunlit valley
export const LIVING_RIVER_SAMPLES: RiverSample[] = sampleCatmullRom(
  [
    { x: 24.0, z: -36.0, width: 11.5, waterY: 2.45 },
    { x: 23.0, z: -24.0, width: 7.4, waterY: 2.38 },
    { x: 21.5, z: -10.0, width: 6.2, waterY: 2.28 },
    { x: 20.5, z: 4.0, width: 6.4, waterY: 2.18 },
    { x: 16.5, z: 18.0, width: 7.0, waterY: 2.08 },
    { x: 21.5, z: 34.0, width: 7.6, waterY: 1.98 },
    { x: 35.0, z: 54.0, width: 8.6, waterY: 1.88 },
    { x: 54.0, z: 80.0, width: 10.2, waterY: 1.76 },
    { x: 80.0, z: 116.0, width: 12.5, waterY: 1.62 },
    { x: 112.0, z: 162.0, width: 15.0, waterY: 1.50 },
  ],
  7
);

// Upper alpine river feeding the monumental 47m waterfall crest lip
export const UPPER_STREAM_SAMPLES: RiverSample[] = sampleCatmullRom(
  [
    { x: 38.0, z: -120.0, width: 10.5, waterY: 51.5 },
    { x: 32.0, z: -90.0, width: 9.8, waterY: 49.6 },
    { x: 27.2, z: -66.0, width: 9.2, waterY: 48.2 },
    { x: 24.5, z: -50.0, width: 8.8, waterY: 47.2 },
  ],
  5
);

// Dried ancient riverbed branching westward across the scarred wasteland
export const DRY_RIVER_SAMPLES: RiverSample[] = sampleCatmullRom(
  [
    { x: 12.0, z: 19.0, width: 4.2, waterY: 2.0 },
    { x: -3.0, z: 19.5, width: 5.2, waterY: 1.9 },
    { x: -18.0, z: 22.5, width: 6.2, waterY: 1.6 },
    { x: -36.0, z: 17.5, width: 7.0, waterY: 1.3 },
    { x: -56.0, z: 24.5, width: 7.6, waterY: 1.1 },
    { x: -82.0, z: 36.0, width: 8.4, waterY: 0.9 },
    { x: -116.0, z: 48.0, width: 9.2, waterY: 0.8 },
    { x: -162.0, z: 62.0, width: 10.5, waterY: 0.7 },
  ],
  6
);

export interface ClosestCurveResult {
  dist: number;
  width: number;
  waterY: number;
  tx: number;
  tz: number;
  s: number;
  tNorm: number; // 0..1 along curve
}

function closestOnSamples(samples: RiverSample[], x: number, z: number): ClosestCurveResult {
  let minD2 = Infinity;
  let bestIdx = 0;
  let bestFrac = 0;

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 1e-6 ? clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1) : 0;
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const dx = x - px;
    const dz = z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2) {
      minD2 = d2;
      bestIdx = i;
      bestFrac = t;
    }
  }

  const a = samples[bestIdx];
  const b = samples[bestIdx + 1];
  const lastS = samples[samples.length - 1].s || 1;
  const s = lerp(a.s, b.s, bestFrac);

  return {
    dist: Math.sqrt(minD2),
    width: lerp(a.width, b.width, bestFrac),
    waterY: lerp(a.waterY, b.waterY, bestFrac),
    tx: lerp(a.tx, b.tx, bestFrac),
    tz: lerp(a.tz, b.tz, bestFrac),
    s,
    tNorm: s / lastS,
  };
}

export function getLivingRiverInfo(x: number, z: number): ClosestCurveResult {
  return closestOnSamples(LIVING_RIVER_SAMPLES, x, z);
}

export function getUpperStreamInfo(x: number, z: number): ClosestCurveResult {
  return closestOnSamples(UPPER_STREAM_SAMPLES, x, z);
}

export function getDryRiverInfo(x: number, z: number): ClosestCurveResult {
  return closestOnSamples(DRY_RIVER_SAMPLES, x, z);
}

// Pockets of returning life on the scarred side (e.g., around the rusted relics & cracked riverbed)
export const HOPE_POCKETS: Array<{ x: number; z: number; radius: number; strength: number }> = [
  { x: -16.5, z: 12.5, radius: 7.5, strength: 0.55 },
  { x: -31.0, z: 18.0, radius: 6.0, strength: 0.48 }, // around weathered iron relic
  { x: -24.0, z: -2.0, radius: 6.5, strength: 0.42 },
  { x: -46.0, z: 21.5, radius: 5.0, strength: 0.38 },
];

/**
 * Spatial vitality field:
 * 0.0 = deeply scarred, parched, cracked earth & devastation (west/southwest basin)
 * 1.0 = lush, thriving, sunlit living ecosystem (east/north/river/waterfall)
 */
export function getVitality(x: number, z: number): number {
  // Organic noise warp so the divide between living and scarred feels completely natural
  const warpX = fbm2D(x * 0.018 + 3.1, z * 0.018 - 1.7, 3) * 18.0;
  const warpZ = fbm2D(x * 0.018 - 5.4, z * 0.018 + 4.2, 3) * 18.0;
  const wx = x + warpX;
  const wz = z + warpZ;

  // Base east-to-west gradient tilted slightly so north/east is thriving and west/southwest is scarred
  const divideAxis = wx * 0.88 - wz * 0.42;
  let v = smootherstep(-26, 20, divideAxis);

  // Living river radiates vitality outward along its banks
  const river = getLivingRiverInfo(x, z);
  const riverBoost = (1 - smoothstep(river.width * 0.8, river.width + 24, river.dist)) * 0.85;
  v = Math.max(v, riverBoost);

  // Plunge pool & waterfall lush microclimate
  const poolDist = Math.hypot(x - PLUNGE_POOL_CENTER.x, z - PLUNGE_POOL_CENTER.y);
  const poolBoost = (1 - smoothstep(10, 42, poolDist)) * 0.98;
  v = Math.max(v, poolBoost);

  // Ancient tree sanctuary sits on the threshold: lush core with fingers of life reaching west
  const treeDist = Math.hypot(x - TREE_CENTER.x, z - TREE_CENTER.y);
  const rootFinger = fbm2D(x * 0.09, z * 0.09, 3) * 0.25 + 0.75;
  const treeBoost = (1 - smoothstep(5.5, 22.0, treeDist)) * 0.92 * rootFinger;
  v = Math.max(v, treeBoost);

  // Subtle scarred push inside the dry riverbed channel so the dried bed looks truly parched
  const dry = getDryRiverInfo(x, z);
  if (x < 6) {
    const dryPenalty = (1 - smoothstep(dry.width * 0.5, dry.width + 7.5, dry.dist)) * 0.42;
    v -= dryPenalty * smoothstep(8, -14, x);
  }

  // Localized pockets of returning life ("hope") on the scarred side
  for (let i = 0; i < HOPE_POCKETS.length; i++) {
    const p = HOPE_POCKETS[i];
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.radius) {
      const b = (1 - smoothstep(0, p.radius, d)) * p.strength;
      v = Math.max(v, b);
    }
  }

  // Fine organic micro-variation
  const fine = fbm2D(x * 0.065, z * 0.065, 3) * 0.14;
  return clamp(v + fine, 0, 1);
}

/**
 * Exact continuous terrain elevation across the entire 920m world.
 */
export function getTerrainHeight(x: number, z: number): number {
  const rCenter = Math.hypot(x, z);

  // 1. Base gently undulating valley floor
  const valleyWarp = warpedFbm2D(x * 0.008, z * 0.008, 0.5, 4);
  let h = 4.2 + valleyWarp * 4.5 + fbm2D(x * 0.025, z * 0.025, 3) * 1.4;

  // 2. Sculpted Scarred Basin on the west-southwest (slightly lower, flatter eroded basin)
  const scarredFactor = smoothstep(5, -35, x) * smoothstep(-40, 20, z) * smoothstep(130, 50, rCenter);
  h = lerp(h, 3.1 + fbm2D(x * 0.02, z * 0.02, 3) * 1.6, scarredFactor * 0.65);

  // 3. Lush Rolling Meadow Hills on the east/southeast (gentle scenic rises)
  const meadowFactor = smoothstep(22, 58, x) * smoothstep(-10, 45, z) * smoothstep(145, 70, rCenter);
  h += meadowFactor * (4.0 + Math.max(0, fbm2D(x * 0.014 + 4.1, z * 0.014, 4)) * 9.5);

  // 4. Monumental 47m Waterfall Basalt Escarpment on the North-East (x > 6), tapering gracefully down into a wide open
  //    mountain valley pass behind the Ancient Tree so glorious sky, clouds & distant alpine peaks shine through!
  const cliffEdgeZ = -48.2 + Math.sin(x * 0.045) * 4.0 + fbm2D(x * 0.03, 1.5, 3) * 4.5;
  const wfProximity = 1 - smoothstep(10, 29, Math.abs(x - 24.5));
  const localCliffZ = lerp(cliffEdgeZ, -46.8, wfProximity);
  const cliffStep = smootherstep(localCliffZ + 4.8, localCliffZ - 5.2, z);
  const eastPlateauWeight = smootherstep(-4, 18, x) * (1 - smoothstep(76, 145, x));
  const highlandNoise = ridged2D(x * 0.009 + 2.3, z * 0.009 - 1.1, 5) * 18.0;
  const plateauBase = lerp(6.2, 47.6, eastPlateauWeight) + highlandNoise * eastPlateauWeight * (1 - wfProximity * 0.78);

  h = lerp(h, Math.max(h, plateauBase), cliffStep * eastPlateauWeight);

  // Carve the upper alpine river notch feeding the monumental waterfall lip
  if (z < -44 && x > 4 && x < 62) {
    const up = getUpperStreamInfo(x, z);
    const carve = 1 - smootherstep(up.width * 0.45, up.width + 7.5, up.dist);
    if (carve > 0.001) {
      const bedY = up.waterY - 1.8;
      h = lerp(h, bedY, carve);
    }
  }

  // 5. Majestic Encircling Alpine Mountain Amphitheater (sweeping distant horizon ranges leaving rich sky above!)
  const angle = Math.atan2(z, x);
  const northWeight = smoothstep(-0.15, -1.2, Math.sin(angle));
  const eastRidge = smoothstep(0.2, 0.9, Math.cos(angle)) * smoothstep(0.65, -0.3, Math.sin(angle));
  const westRidge = smoothstep(-0.2, -0.9, Math.cos(angle)) * smoothstep(0.35, -0.5, Math.sin(angle));
  const farRing = smoothstep(145, 285, rCenter);

  const ridgeNoise = ridged2D(x * 0.0056 + 7.1, z * 0.0056 - 3.4, 5);
  const detailRidge = ridged2D(x * 0.015 - 2.0, z * 0.015 + 5.0, 4);

  // Sculpted distant alpine peaks far to the north (z < -125) for breathtaking layered atmospheric depth & visible sky!
  const valleyNotch = 1 - 0.38 * Math.exp(-Math.pow((x + 12) / 58, 2));
  const northPeaks =
    smoothstep(-115, -240, z) *
    (22.0 + ridgeNoise * 68.0 + detailRidge * 14.0) *
    valleyNotch;

  // Eastern & Western dramatic shoulders
  const sidePeaks =
    eastRidge * smoothstep(95, 220, rCenter) * (18 + ridgeNoise * 52) +
    westRidge * smoothstep(105, 235, rCenter) * (14 + ridgeNoise * 44);

  // Far outer horizon mountain silhouettes
  const sePass = 1 - Math.exp(-Math.pow((angle - 0.92) / 0.44, 2));
  const swPass = 1 - Math.exp(-Math.pow((angle - 2.38) / 0.46, 2));
  const outerRange =
    farRing * (16.0 + ridgeNoise * 72.0 + detailRidge * 12.0) * (0.25 + 0.75 * sePass * swPass) * (0.6 + 0.4 * northWeight);

  h += northPeaks + sidePeaks + outerRange;

  // 6. Central Ancient Tree Sanctuary Knoll at (0, 0)
  // Prominent, organic rocky-mossy mound elevating the monumental tree above the river & basin
  const treeDist = Math.hypot(x - TREE_CENTER.x, z - TREE_CENTER.y);
  if (treeDist < 28) {
    const knollAngle = Math.atan2(z, x);
    const organicRadius = 15.5 + Math.sin(knollAngle * 3.0 + 0.7) * 2.2 + Math.cos(knollAngle * 5.0) * 1.1;
    const knoll = 1 - smootherstep(3.2, organicRadius + 7.0, treeDist);
    const crownFlat = 1 - smootherstep(0.0, 5.5, treeDist);
    const knollTarget = 7.4 + crownFlat * 0.45 + fbm2D(x * 0.14, z * 0.14, 2) * 0.45;
    h = lerp(h, Math.max(h, knollTarget), knoll);
  }

  // 7. Carve the Emerald Plunge Pool Basin around (24, -36)
  const poolDist = Math.hypot(x - PLUNGE_POOL_CENTER.x, z - PLUNGE_POOL_CENTER.y);
  if (poolDist < 22) {
    const poolCarve = 1 - smootherstep(4.5, 17.5, poolDist);
    // Do not erase the cliff wall right behind z < -41.5
    const cliffGuard = smoothstep(-43.2, -39.5, z);
    h = lerp(h, -1.65, poolCarve * cliffGuard);
  }

  // 8. Carve the Living Winding River Channel
  if (x > -5 && x < 145 && z > -45 && z < 185) {
    const river = getLivingRiverInfo(x, z);
    const bankOuter = river.width + 6.5;
    if (river.dist < bankOuter) {
      const bankT = 1 - smootherstep(river.width * 0.35, bankOuter, river.dist);
      const deepT = 1 - smootherstep(0, river.width * 0.85, river.dist);
      const bedY = river.waterY - 0.55 - deepT * 1.95;
      // Preserve waterfall cliff wall behind pool
      const cliffGuard = smoothstep(-42.5, -37.0, z);
      h = lerp(h, Math.min(h, bedY), bankT * cliffGuard);
    }
  }

  // 9. Carve the Dried Riverbed Channel across the Scarred Basin
  if (x < 24 && x > -180 && z > -2 && z < 85) {
    const dry = getDryRiverInfo(x, z);
    const bankOuter = dry.width + 5.8;
    if (dry.dist < bankOuter) {
      const bankT = 1 - smootherstep(dry.width * 0.3, bankOuter, dry.dist);
      const deepT = 1 - smootherstep(0, dry.width * 0.8, dry.dist);
      // Slight rocky/cracked dry bed unevenness
      const dryRipple = fbm2D(x * 0.22, z * 0.22, 2) * 0.22;
      const bedY = dry.waterY - 0.15 - deepT * 1.25 + dryRipple;
      // Gentle sill separating the living river from the dried channel so water doesn't bleed into the dry bed
      const sillGuard = smoothstep(13.5, 3.5, x);
      h = lerp(h, Math.min(h, bedY), bankT * (0.35 + 0.65 * sillGuard));
    }
  }

  // 10. Natural fine micro-relief (gentle rocks, soil undulations)
  const micro = fbm2D(x * 0.085, z * 0.085, 3) * 0.42;
  h += micro * smoothstep(220, 40, rCenter);

  return h;
}

export function getTerrainNormal(x: number, z: number, eps = 0.45): THREE.Vector3 {
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
}

export function getTerrainSlope(x: number, z: number): number {
  const n = getTerrainNormal(x, z);
  return 1 - clamp(n.y, 0, 1);
}

export function isPointInWater(x: number, z: number): { inWater: boolean; waterY: number; depth: number } {
  const h = getTerrainHeight(x, z);

  // Plunge pool
  const poolD = Math.hypot(x - PLUNGE_POOL_CENTER.x, z - PLUNGE_POOL_CENTER.y);
  if (poolD < 14.5 && z > -41.5 && h < 2.45) {
    return { inWater: true, waterY: 2.45, depth: 2.45 - h };
  }

  // Living river
  if (x > 2 && x < 140 && z > -42 && z < 175) {
    const r = getLivingRiverInfo(x, z);
    if (r.dist < r.width + 2.5 && h < r.waterY) {
      return { inWater: true, waterY: r.waterY, depth: r.waterY - h };
    }
  }

  // Upper mountain stream
  if (z < -47 && z > -120 && x > 10 && x < 50) {
    const u = getUpperStreamInfo(x, z);
    if (u.dist < u.width + 1.5 && h < u.waterY) {
      return { inWater: true, waterY: u.waterY, depth: u.waterY - h };
    }
  }

  return { inWater: false, waterY: 0, depth: 0 };
}
