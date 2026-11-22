import * as THREE from 'three';
import { clamp, lerp, mulberry32, smoothstep } from './noise';
import {
  getLivingRiverInfo,
  getTerrainHeight,
  getTerrainSlope,
  getVitality,
  HOPE_POCKETS,
  isPointInWater,
  PLUNGE_POOL_CENTER,
  SUN_DIRECTION,
  TREE_CENTER,
} from './terrainData';
import { WorldTextures } from './textures';

export interface VegetationSystem {
  group: THREE.Group;
  uniforms: {
    uTime: { value: number };
  };
}

// Helper to merge simple non-indexed or indexed geometries cleanly
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
      for (let i = 0; i < g.index.count; i++) {
        indices.push(g.index.getX(i) + offset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(i + offset);
      }
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

// Build an authentic multi-tiered conifer (trunk geometry + feathery bough foliage geometry)
function buildConiferGeometries(): { trunk: THREE.BufferGeometry; foliage: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.08, 0.34, 9.2, 7, 1);
  trunk.translate(0, 4.4, 0);

  const boughCards: THREE.BufferGeometry[] = [];
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1); // 0 = bottom, 1 = spire top
    const y = lerp(2.2, 9.4, f);
    const radius = lerp(2.5, 0.55, Math.pow(f, 0.82));
    const cardsInTier = f > 0.78 ? 3 : 5;
    for (let c = 0; c < cardsInTier; c++) {
      const ang = (c / cardsInTier) * Math.PI * 2 + t * 0.7;
      const card = new THREE.PlaneGeometry(radius * 1.45, radius * 1.55);
      // Tilt gracefully outward like real drooping spruce boughs
      card.rotateX(-0.55 - (1 - f) * 0.32);
      card.rotateY(ang);
      card.translate(Math.sin(ang) * radius * 0.42, y, Math.cos(ang) * radius * 0.42);
      // Bias normals gently upward/outward for rich soft woodland lighting
      const n = card.attributes.normal;
      for (let i = 0; i < n.count; i++) {
        const nx = Math.sin(ang) * 0.55;
        const ny = 0.72;
        const nz = Math.cos(ang) * 0.55;
        const l = Math.hypot(nx, ny, nz);
        n.setXYZ(i, nx / l, ny / l, nz / l);
      }
      boughCards.push(card);
    }
  }
  // Top vertical crown finial cards
  for (let k = 0; k < 2; k++) {
    const topCard = new THREE.PlaneGeometry(1.1, 2.0);
    topCard.rotateY(k * Math.PI * 0.5);
    topCard.translate(0, 9.9, 0);
    boughCards.push(topCard);
  }

  return { trunk, foliage: mergeGeometriesSimple(boughCards) };
}

// Build an articulated broadleaf woodland tree (forked trunk + airy crossed foliage sprays)
function buildBroadleafGeometries(): { trunk: THREE.BufferGeometry; foliage: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.16, 0.36, 4.6, 7, 1);
  main.translate(0, 2.2, 0);
  parts.push(main);

  const limbAngles = [0.3, 2.3, 4.4];
  for (const a of limbAngles) {
    const limb = new THREE.CylinderGeometry(0.06, 0.14, 3.0, 5, 1);
    limb.translate(0, 1.5, 0);
    limb.rotateZ(0.42);
    limb.rotateY(a);
    limb.translate(0, 3.8, 0);
    parts.push(limb);
  }

  const leafCards: THREE.BufferGeometry[] = [];
  const clusterCenters = [
    [0, 6.9, 0, 2.5],
    [1.6, 5.8, 0.7, 2.1],
    [-1.5, 6.0, 0.9, 2.15],
    [0.2, 5.7, -1.6, 2.1],
    [-1.1, 6.9, -0.9, 1.9],
    [1.2, 6.8, -0.8, 1.85],
    [0, 5.2, 1.4, 1.8],
  ];
  for (const [cx, cy, cz, sc] of clusterCenters) {
    for (let k = 0; k < 3; k++) {
      const p = new THREE.PlaneGeometry(sc * 1.3, sc * 1.3);
      p.rotateY((k * Math.PI) / 3 + cx);
      p.rotateX((k - 1) * 0.28);
      p.translate(cx, cy, cz);
      const n = p.attributes.normal;
      for (let i = 0; i < n.count; i++) {
        const vx = p.attributes.position.getX(i);
        const vy = p.attributes.position.getY(i) - 5.2;
        const vz = p.attributes.position.getZ(i);
        const l = Math.hypot(vx, vy + 1.8, vz) || 1;
        n.setXYZ(i, vx / l, (vy + 1.8) / l, vz / l);
      }
      leafCards.push(p);
    }
  }

  return { trunk: mergeGeometriesSimple(parts), foliage: mergeGeometriesSimple(leafCards) };
}

// 3-blade curved organic meadow grass tuft
function buildGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  const blades = [
    { yaw: 0.0, lean: 0.24, h: 0.85, w: 0.065, ox: 0.0, oz: 0.0 },
    { yaw: 2.15, lean: 0.30, h: 0.72, w: 0.058, ox: 0.08, oz: -0.05 },
    { yaw: 4.25, lean: 0.26, h: 0.64, w: 0.055, ox: -0.07, oz: 0.06 },
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
      // Blade perpendicular vector
      const px = -sinY * halfW;
      const pz = cosY * halfW;

      positions.push(cx - px, y, cz - pz);
      positions.push(cx + px, y, cz + pz);
      normals.push(cosY * 0.35, 0.92, sinY * 0.35);
      normals.push(cosY * 0.35, 0.92, sinY * 0.35);
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

// 6-frond gracefully arching woodland sword fern rosette
function buildFernRosetteGeometry(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.18;
    const plane = new THREE.PlaneGeometry(0.75, 1.35, 1, 4);
    const pos = plane.attributes.position;
    // Shift base to origin and bend into a graceful arching fern curve
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const yNorm = (pos.getY(v) + 0.675) / 1.35; // 0..1
      const archY = Math.sin(yNorm * Math.PI * 0.68) * 0.75 + yNorm * 0.12;
      const reachZ = yNorm * 1.18;
      pos.setXYZ(v, x, archY, reachZ);
    }
    plane.rotateY(angle);
    plane.computeVertexNormals();
    fronds.push(plane);
  }
  return mergeGeometriesSimple(fronds);
}

// Wildflower cluster (3 delicate stalks + tiny radiant blossom heads)
function buildWildflowerGeometry(): { stems: THREE.BufferGeometry; blooms: THREE.BufferGeometry } {
  const stemParts: THREE.BufferGeometry[] = [];
  const bloomParts: THREE.BufferGeometry[] = [];
  const stalks = [
    { x: 0.0, z: 0.0, h: 0.56, leanX: 0.05, leanZ: 0.03, r: 0.11 },
    { x: 0.14, z: -0.09, h: 0.44, leanX: 0.09, leanZ: -0.06, r: 0.09 },
    { x: -0.12, z: 0.11, h: 0.49, leanX: -0.07, leanZ: 0.08, r: 0.095 },
  ];

  for (const s of stalks) {
    const stem = new THREE.CylinderGeometry(0.008, 0.014, s.h, 4, 1);
    stem.translate(s.x + s.leanX * 0.5, s.h * 0.5, s.z + s.leanZ * 0.5);
    stemParts.push(stem);

    // 5-petal blossom disc + slight cup
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

export function createVegetation(textures: WorldTextures): VegetationSystem {
  const group = new THREE.Group();
  group.name = 'LivingVegetation';

  const uTime = { value: 0 };
  const rand = mulberry32(20261120);

  // Shared wind injection helper for foliage materials
  const applyWindAndBacklight = (mat: THREE.MeshStandardMaterial, swayStrength: number, sssStrength: number) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uSunDir = { value: SUN_DIRECTION.clone() };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vVegWorld;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 iw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          float hFactor = clamp(position.y * 0.15, 0.0, 1.5);
          float gust = sin(uTime * 1.4 + iw.x * 0.08 + iw.z * 0.06) * 0.65
                     + sin(uTime * 2.5 + iw.x * 0.22 - iw.z * 0.17) * 0.35;
          transformed.x += gust * ${swayStrength.toFixed(3)} * hFactor;
          transformed.z += cos(uTime * 1.1 + iw.z * 0.09) * ${(swayStrength * 0.55).toFixed(3)} * hFactor;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vVegWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nvarying vec3 vVegWorld;')
        .replace(
          '#include <dithering_fragment>',
          `vec3 vDir = normalize(vVegWorld - cameraPosition);
          float sBack = pow(clamp(dot(vDir, uSunDir), 0.0, 1.0), 3.0);
          gl_FragColor.rgb += vec3(0.35, 0.44, 0.10) * sBack * ${sssStrength.toFixed(3)};
          #include <dithering_fragment>`
        );
    };
  };

  // =========================================================================
  // 1. CONIFER FOREST (Alpine Pines & Spruces across living hills & cliffs)
  // =========================================================================
  const coniferGeo = buildConiferGeometries();
  const coniferPlacements: Array<{ x: number; y: number; z: number; s: number; rot: number; tint: THREE.Color }> = [];

  for (let attempt = 0; attempt < 2600 && coniferPlacements.length < 280; attempt++) {
    const x = (rand() * 2 - 1) * 155;
    const z = (rand() * 2 - 1) * 155;

    // Keep clear view corridor around the Ancient Tree sanctuary & hero sightline
    const treeD = Math.hypot(x - TREE_CENTER.x, z - TREE_CENTER.y);
    if (treeD < 24) continue;
    // Keep hero foreground camera sightline open
    if (x > -34 && x < 6 && z > 18 && z < 56) continue;
    // Keep waterfall curtain unobstructed
    const poolD = Math.hypot(x - PLUNGE_POOL_CENTER.x, z - PLUNGE_POOL_CENTER.y);
    if (poolD < 17) continue;

    const vit = getVitality(x, z);
    if (vit < 0.52) continue;

    const water = isPointInWater(x, z);
    if (water.inWater) continue;

    const y = getTerrainHeight(x, z);
    if (y < 2.2 || y > 54) continue;

    const slope = getTerrainSlope(x, z);
    if (slope > 0.34) continue;

    // Natural clumping probability
    if (rand() > smoothstep(0.48, 0.88, vit)) continue;

    const s = (0.78 + rand() * 0.92) * lerp(0.75, 1.15, clamp(vit, 0, 1));
    const col = new THREE.Color().setHSL(0.32 + (rand() - 0.5) * 0.05, 0.34 + rand() * 0.16, 0.28 + rand() * 0.14);
    coniferPlacements.push({ x, y: y - 0.35, z, s, rot: rand() * Math.PI * 2, tint: col });
  }

  const coniferTrunkMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    roughness: 0.94,
    color: new THREE.Color('#6f5b4a'),
  });
  const coniferLeafMat = new THREE.MeshStandardMaterial({
    map: textures.coniferBoughMap,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 0.82,
  });
  applyWindAndBacklight(coniferLeafMat, 0.18, 0.22);

  const coniferTrunks = new THREE.InstancedMesh(coniferGeo.trunk, coniferTrunkMat, coniferPlacements.length);
  const coniferLeaves = new THREE.InstancedMesh(coniferGeo.foliage, coniferLeafMat, coniferPlacements.length);
  coniferTrunks.castShadow = true;
  coniferTrunks.receiveShadow = true;
  coniferLeaves.castShadow = true;
  coniferLeaves.receiveShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < coniferPlacements.length; i++) {
    const p = coniferPlacements[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set((rand() - 0.5) * 0.05, p.rot, (rand() - 0.5) * 0.05);
    dummy.scale.set(p.s * (0.9 + rand() * 0.2), p.s, p.s * (0.9 + rand() * 0.2));
    dummy.updateMatrix();
    coniferTrunks.setMatrixAt(i, dummy.matrix);
    coniferLeaves.setMatrixAt(i, dummy.matrix);
    coniferLeaves.setColorAt(i, p.tint);
  }
  coniferTrunks.instanceMatrix.needsUpdate = true;
  coniferLeaves.instanceMatrix.needsUpdate = true;
  if (coniferLeaves.instanceColor) coniferLeaves.instanceColor.needsUpdate = true;
  group.add(coniferTrunks, coniferLeaves);

  // =========================================================================
  // 2. BROADLEAF WOODLAND TREES & RESILIENT BORDER SAPLINGS
  // =========================================================================
  const broadGeo = buildBroadleafGeometries();
  const broadPlacements: Array<{ x: number; y: number; z: number; s: number; rot: number; tint: THREE.Color }> = [];

  for (let attempt = 0; attempt < 1800 && broadPlacements.length < 105; attempt++) {
    const x = (rand() * 2 - 1) * 125;
    const z = (rand() * 2 - 1) * 125;
    const treeD = Math.hypot(x - TREE_CENTER.x, z - TREE_CENTER.y);
    if (treeD < 21) continue;
    if (x > -34 && x < 8 && z > 18 && z < 56) continue;
    if (Math.hypot(x - PLUNGE_POOL_CENTER.x, z - PLUNGE_POOL_CENTER.y) < 16) continue;

    const vit = getVitality(x, z);
    if (vit < 0.44) continue;
    if (isPointInWater(x, z).inWater) continue;

    const y = getTerrainHeight(x, z);
    if (y < 2.2 || y > 26) continue;
    if (getTerrainSlope(x, z) > 0.26) continue;

    // Smaller resilient saplings near the restoration border, lush full trees on the living side!
    const isSapling = vit < 0.62;
    const s = isSapling ? 0.38 + rand() * 0.34 : 0.72 + rand() * 0.68;
    const col = new THREE.Color().setHSL(
      0.24 + (rand() - 0.35) * 0.09,
      0.38 + rand() * 0.2,
      0.34 + rand() * 0.16
    );
    broadPlacements.push({ x, y: y - 0.25, z, s, rot: rand() * Math.PI * 2, tint: col });
  }

  const broadLeafMat = new THREE.MeshStandardMaterial({
    map: textures.broadleafMap,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 0.74,
  });
  applyWindAndBacklight(broadLeafMat, 0.22, 0.32);

  const broadTrunks = new THREE.InstancedMesh(broadGeo.trunk, coniferTrunkMat, broadPlacements.length);
  const broadLeaves = new THREE.InstancedMesh(broadGeo.foliage, broadLeafMat, broadPlacements.length);
  broadTrunks.castShadow = true;
  broadLeaves.castShadow = true;
  broadLeaves.receiveShadow = true;

  for (let i = 0; i < broadPlacements.length; i++) {
    const p = broadPlacements[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    broadTrunks.setMatrixAt(i, dummy.matrix);
    broadLeaves.setMatrixAt(i, dummy.matrix);
    broadLeaves.setColorAt(i, p.tint);
  }
  broadTrunks.instanceMatrix.needsUpdate = true;
  broadLeaves.instanceMatrix.needsUpdate = true;
  if (broadLeaves.instanceColor) broadLeaves.instanceColor.needsUpdate = true;
  group.add(broadTrunks, broadLeaves);

  // =========================================================================
  // 3. DENSE WIND-RIPPLED MEADOW GRASS (26,000+ curved 3-blade grass tufts!)
  // =========================================================================
  const grassGeo = buildGrassTuftGeometry();
  const maxGrass = 26000;
  const grassMatrices: THREE.Matrix4[] = [];
  const grassColors: THREE.Color[] = [];

  const grassLushA = new THREE.Color('#3b6e24');
  const grassLushB = new THREE.Color('#6a8f2c');
  const grassSunGold = new THREE.Color('#9aa33c');
  const grassDryEdge = new THREE.Color('#8a7a42');

  for (let attempt = 0; attempt < 95000 && grassMatrices.length < maxGrass; attempt++) {
    // Biased radial distribution: extra dense within 75m of center, sprawling out to 135m
    const u = Math.pow(rand(), 0.78);
    const radius = 2.6 + u * 128;
    const ang = rand() * Math.PI * 2;
    const x = Math.cos(ang) * radius;
    const z = Math.sin(ang) * radius;

    const vit = getVitality(x, z);
    if (vit < 0.24) continue;
    if (rand() > smoothstep(0.22, 0.68, vit)) continue;

    if (isPointInWater(x, z).inWater) continue;
    const y = getTerrainHeight(x, z);
    if (y < 1.8 || y > 34) continue;
    if (getTerrainSlope(x, z) > 0.27) continue;

    const sH = (0.65 + rand() * 0.95) * lerp(0.55, 1.18, smoothstep(0.24, 0.85, vit));
    const sW = 0.78 + rand() * 0.55;
    dummy.position.set(x, y - 0.04, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(sW, sH, sW);
    dummy.updateMatrix();
    grassMatrices.push(dummy.matrix.clone());

    const c = grassLushA.clone().lerp(grassLushB, rand());
    if (vit > 0.75 && rand() > 0.65) c.lerp(grassSunGold, rand() * 0.45);
    if (vit < 0.48) c.lerp(grassDryEdge, smoothstep(0.48, 0.24, vit) * 0.75);
    c.multiplyScalar(0.8 + rand() * 0.38);
    grassColors.push(c);
  }

  const grassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uSunDir = { value: SUN_DIRECTION.clone() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vBladeY;\nvarying vec3 vGrassWorld;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBladeY = uv.y;
        vec4 gw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        // Rolling wind waves across the entire valley meadow!
        float wave1 = sin(uTime * 1.9 + gw.x * 0.14 + gw.z * 0.10);
        float wave2 = sin(uTime * 3.1 + gw.x * 0.35 - gw.z * 0.28) * 0.45;
        float bend = uv.y * uv.y * 0.26;
        transformed.x += (wave1 + wave2) * bend;
        transformed.z += (wave1 * 0.6 - wave2 * 0.4) * bend;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vGrassWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nvarying float vBladeY;\nvarying vec3 vGrassWorld;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Rich dark earthy roots fading to sunlit translucent grass tips
        diffuseColor.rgb *= mix(0.42, 1.22, smoothstep(0.0, 0.9, vBladeY));`
      )
      .replace(
        '#include <dithering_fragment>',
        `vec3 gView = normalize(vGrassWorld - cameraPosition);
        float gBack = pow(clamp(dot(gView, uSunDir), 0.0, 1.0), 3.0);
        gl_FragColor.rgb += vec3(0.32, 0.38, 0.08) * gBack * vBladeY * 0.42;
        #include <dithering_fragment>`
      );
  };

  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, grassMatrices.length);
  grassMesh.receiveShadow = true;
  for (let i = 0; i < grassMatrices.length; i++) {
    grassMesh.setMatrixAt(i, grassMatrices[i]);
    grassMesh.setColorAt(i, grassColors[i]);
  }
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  group.add(grassMesh);

  // =========================================================================
  // 4. WOODLAND SWORD FERNS (Around Ancient Tree roots, plunge pool, forests & hope pockets)
  // =========================================================================
  const fernGeo = buildFernRosetteGeometry();
  const fernTransforms: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];

  const tryAddFern = (x: number, z: number, minScale: number, maxScale: number) => {
    if (isPointInWater(x, z).inWater) return false;
    const y = getTerrainHeight(x, z);
    if (y < 1.9 || y > 32) return false;
    if (getTerrainSlope(x, z) > 0.34) return false;
    const s = lerp(minScale, maxScale, rand());
    dummy.position.set(x, y - 0.05, z);
    dummy.rotation.set((rand() - 0.5) * 0.15, rand() * Math.PI * 2, (rand() - 0.5) * 0.15);
    dummy.scale.set(s, s * (0.85 + rand() * 0.3), s);
    dummy.updateMatrix();
    const col = new THREE.Color().setHSL(0.26 + (rand() - 0.5) * 0.04, 0.44 + rand() * 0.16, 0.36 + rand() * 0.14);
    fernTransforms.push({ m: dummy.matrix.clone(), c: col });
    return true;
  };

  // Ring of lush ferns carpeting the Ancient Tree's exposed roots!
  for (let i = 0; i < 240; i++) {
    const a = rand() * Math.PI * 2;
    const r = 3.2 + Math.pow(rand(), 0.72) * 13.5;
    const x = TREE_CENTER.x + Math.cos(a) * r;
    const z = TREE_CENTER.y + Math.sin(a) * r;
    if (getVitality(x, z) > 0.32) tryAddFern(x, z, 0.65, 1.45);
  }

  // Lush mist-fed ferns around the waterfall plunge pool & riverbanks
  for (let i = 0; i < 280; i++) {
    const a = rand() * Math.PI * 2;
    const r = 10.5 + rand() * 14.0;
    const x = PLUNGE_POOL_CENTER.x + Math.cos(a) * r;
    const z = PLUNGE_POOL_CENTER.y + Math.sin(a) * r;
    tryAddFern(x, z, 0.75, 1.55);
  }

  // General woodland ferns across the thriving valley
  for (let i = 0; i < 3200 && fernTransforms.length < 1350; i++) {
    const x = (rand() * 2 - 1) * 105;
    const z = (rand() * 2 - 1) * 105;
    const vit = getVitality(x, z);
    if (vit < 0.58) continue;
    tryAddFern(x, z, 0.55, 1.35);
  }

  // Poignant pioneer ferns returning in the scarred-side hope pockets!
  for (const hp of HOPE_POCKETS) {
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * hp.radius * 0.68;
      tryAddFern(hp.x + Math.cos(a) * r, hp.z + Math.sin(a) * r, 0.42, 0.85);
    }
  }

  const fernMat = new THREE.MeshStandardMaterial({
    map: textures.fernFrondMap,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.72,
  });
  applyWindAndBacklight(fernMat, 0.14, 0.36);

  const fernMesh = new THREE.InstancedMesh(fernGeo, fernMat, fernTransforms.length);
  fernMesh.receiveShadow = true;
  for (let i = 0; i < fernTransforms.length; i++) {
    fernMesh.setMatrixAt(i, fernTransforms[i].m);
    fernMesh.setColorAt(i, fernTransforms[i].c);
  }
  fernMesh.instanceMatrix.needsUpdate = true;
  if (fernMesh.instanceColor) fernMesh.instanceColor.needsUpdate = true;
  group.add(fernMesh);

  // =========================================================================
  // 5. WILDFLOWERS (Natural refined meadow blooms + resilient restoration flowers)
  // =========================================================================
  const wfGeo = buildWildflowerGeometry();
  const wfMatrices: THREE.Matrix4[] = [];
  const wfBloomColors: THREE.Color[] = [];

  // Sophisticated natural wildflower palette (never neon or plastic!)
  const flowerPalette = [
    new THREE.Color('#e8c766'), // wild buttercup / arnica gold
    new THREE.Color('#ede8d8'), // woodland daisy ivory
    new THREE.Color('#9ca5d4'), // wild lavender / bluebell
    new THREE.Color('#d9886a'), // subtle warm sunset poppy / indian paintbrush
    new THREE.Color('#b8c7e0'), // pale forget-me-not
  ];

  // Meadow wildflowers
  for (let i = 0; i < 6500 && wfMatrices.length < 1850; i++) {
    const a = rand() * Math.PI * 2;
    const r = 4.2 + Math.pow(rand(), 0.78) * 86;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const vit = getVitality(x, z);
    if (vit < 0.42) continue;
    if (isPointInWater(x, z).inWater) continue;
    const y = getTerrainHeight(x, z);
    if (y < 2.1 || y > 24) continue;
    if (getTerrainSlope(x, z) > 0.24) continue;

    // Clump wildflowers naturally using simple trig clustering
    const clump = Math.sin(x * 0.22) * Math.cos(z * 0.22) * 0.5 + 0.5;
    if (rand() > clump * 0.85 + 0.15) continue;

    const s = 0.72 + rand() * 0.85;
    dummy.position.set(x, y - 0.02, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    wfMatrices.push(dummy.matrix.clone());

    const baseCol = flowerPalette[Math.floor(rand() * flowerPalette.length)].clone();
    baseCol.multiplyScalar(0.85 + rand() * 0.25);
    wfBloomColors.push(baseCol);
  }

  // Resilient wildflowers breaking through the scarred earth in the hope pockets!
  for (const hp of HOPE_POCKETS) {
    for (let i = 0; i < 24; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * hp.radius * 0.65;
      const x = hp.x + Math.cos(a) * r;
      const z = hp.z + Math.sin(a) * r;
      const y = getTerrainHeight(x, z);
      const s = 0.65 + rand() * 0.55;
      dummy.position.set(x, y - 0.02, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      wfMatrices.push(dummy.matrix.clone());
      wfBloomColors.push(flowerPalette[i % 3].clone());
    }
  }

  const wfStemMat = new THREE.MeshStandardMaterial({ color: '#456b2a', roughness: 0.85 });
  const wfBloomMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  applyWindAndBacklight(wfStemMat, 0.24, 0.1);
  applyWindAndBacklight(wfBloomMat, 0.24, 0.45);

  const wfStems = new THREE.InstancedMesh(wfGeo.stems, wfStemMat, wfMatrices.length);
  const wfBlooms = new THREE.InstancedMesh(wfGeo.blooms, wfBloomMat, wfMatrices.length);
  for (let i = 0; i < wfMatrices.length; i++) {
    wfStems.setMatrixAt(i, wfMatrices[i]);
    wfBlooms.setMatrixAt(i, wfMatrices[i]);
    wfBlooms.setColorAt(i, wfBloomColors[i]);
  }
  wfStems.instanceMatrix.needsUpdate = true;
  wfBlooms.instanceMatrix.needsUpdate = true;
  if (wfBlooms.instanceColor) wfBlooms.instanceColor.needsUpdate = true;
  group.add(wfStems, wfBlooms);

  // =========================================================================
  // 6. RIVERBANK REEDS & RUSHES along the winding living river
  // =========================================================================
  const reedGeo = new THREE.CylinderGeometry(0.012, 0.032, 1.75, 4, 3);
  reedGeo.translate(0, 0.85, 0);
  // Subtle organic curve at top of reed
  const rPos = reedGeo.attributes.position;
  for (let i = 0; i < rPos.count; i++) {
    const ry = rPos.getY(i) / 1.75;
    rPos.setX(i, rPos.getX(i) + ry * ry * 0.22);
  }
  reedGeo.computeVertexNormals();

  const reedMatrices: THREE.Matrix4[] = [];
  for (let attempt = 0; attempt < 3400 && reedMatrices.length < 750; attempt++) {
    const x = 6 + rand() * 105;
    const z = -42 + rand() * 165;
    const riv = getLivingRiverInfo(x, z);
    if (Math.abs(riv.dist - riv.width * 0.92) > 2.4) continue;
    const y = getTerrainHeight(x, z);
    if (y < riv.waterY - 0.55 || y > riv.waterY + 0.65) continue;

    // Add a small cluster of 2-3 reeds
    for (let k = 0; k < 2; k++) {
      if (reedMatrices.length >= 750) break;
      dummy.position.set(x + (rand() - 0.5) * 0.45, y - 0.1, z + (rand() - 0.5) * 0.45);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      const s = 0.72 + rand() * 0.65;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      reedMatrices.push(dummy.matrix.clone());
    }
  }

  const reedMat = new THREE.MeshStandardMaterial({
    color: '#4e6f2c',
    roughness: 0.78,
  });
  applyWindAndBacklight(reedMat, 0.32, 0.25);

  const reedMesh = new THREE.InstancedMesh(reedGeo, reedMat, reedMatrices.length);
  for (let i = 0; i < reedMatrices.length; i++) {
    reedMesh.setMatrixAt(i, reedMatrices[i]);
  }
  reedMesh.instanceMatrix.needsUpdate = true;
  group.add(reedMesh);

  return {
    group,
    uniforms: { uTime },
  };
}
