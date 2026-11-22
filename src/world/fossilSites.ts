export interface FossilSiteSpec {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  ribCount: number;
  includeSkull: boolean;
  protectRadius: number;
}

export const FOSSIL_SITES: FossilSiteSpec[] = [
  // 1. HERO LANDMARK — The Great Alkali Leviathan
  { x: -39.5, z: 34.5, yaw: 0.36, scale: 1.65, ribCount: 10, includeSkull: true, protectRadius: 5.5 },
  // 2. HERO LANDMARK — The Dried Reservoir Giant
  { x: -66.0, z: 38.5, yaw: -0.28, scale: 1.90, ribCount: 11, includeSkull: true, protectRadius: 6.2 },
  // 3. FOREGROUND SPECIMEN — Eroded Dry-Bank Skull & Partial Ribcage
  { x: -24.5, z: 36.5, yaw: -0.58, scale: 1.25, ribCount: 6, includeSkull: true, protectRadius: 4.2 },
  // 4. BURNED-FOREST DISCOVERY — Weathered Spine, Broken Ribs & Limb
  { x: -56.5, z: 6.0, yaw: 0.92, scale: 1.50, ribCount: 8, includeSkull: false, protectRadius: 4.8 },
  // 5. WESTERN TRIBUTARY SPECIMEN — Articulated Vertebral Column, Ribcage & Skull
  { x: -88.0, z: 21.0, yaw: 1.24, scale: 1.75, ribCount: 9, includeSkull: true, protectRadius: 5.5 },
  // 6. DISTANT SALT-FLAT RIB ARCHES
  { x: -104.0, z: 48.0, yaw: -0.82, scale: 1.85, ribCount: 8, includeSkull: false, protectRadius: 5.6 },
];

export function isNearFossilCore(x: number, z: number, radiusScale = 1.0): boolean {
  for (let i = 0; i < FOSSIL_SITES.length; i++) {
    const f = FOSSIL_SITES[i];
    if (Math.hypot(x - f.x, z - f.z) < f.protectRadius * radiusScale) {
      return true;
    }
  }
  return false;
}
