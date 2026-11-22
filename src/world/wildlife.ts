import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from './noise';
import { RestorationSystem } from './restoration';
import { getTerrainHeight, HOPE_POCKETS, TREE_CENTER } from './terrainData';

export interface WildlifeSystem {
  group: THREE.Group;
  update: (time: number, dt: number, restoration?: RestorationSystem) => void;
  resetRestorationWildlife: () => void;
  getRecoveryWildlifeCounts: () => { activeFish: number; activeDeer: number };
}

// Sculpted gliding bird silhouette (body + swept wings whose Y-flapping is driven in vertex shader by abs(position.x))
function buildBirdGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    // Central slender body diamond (2 triangles)
    0.0, 0.0, 0.55,
    -0.12, 0.0, -0.05,
    0.12, 0.0, -0.05,

    -0.12, 0.0, -0.05,
    0.0, 0.0, -0.52,
    0.12, 0.0, -0.05,

    // Left inner wing
    -0.08, 0.0, 0.22,
    -0.68, 0.05, 0.02,
    -0.08, 0.0, -0.18,
    // Left outer wingtip
    -0.68, 0.05, 0.02,
    -1.25, 0.02, -0.22,
    -0.08, 0.0, -0.18,

    // Right inner wing
    0.08, 0.0, 0.22,
    0.08, 0.0, -0.18,
    0.68, 0.05, 0.02,
    // Right outer wingtip
    0.68, 0.05, 0.02,
    0.08, 0.0, -0.18,
    1.25, 0.02, -0.22,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// Delicate 2-wing butterfly geometry
function buildButterflyGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    // Left forewing & hindwing
    0.0, 0.0, 0.06,
    -0.22, 0.02, 0.14,
    -0.16, 0.0, -0.04,

    0.0, 0.0, 0.02,
    -0.16, 0.0, -0.04,
    -0.10, 0.0, -0.16,

    // Right forewing & hindwing
    0.0, 0.0, 0.06,
    0.16, 0.0, -0.04,
    0.22, 0.02, 0.14,

    0.0, 0.0, 0.02,
    0.10, 0.0, -0.16,
    0.16, 0.0, -0.04,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

interface BirdAgent {
  center: THREE.Vector3;
  radiusX: number;
  radiusZ: number;
  speed: number;
  phase: number;
  bobAmp: number;
  bobFreq: number;
  scale: number;
  flapRate: number;
}

interface ButterflyAgent {
  home: THREE.Vector3;
  phase: number;
  speed: number;
  range: number;
  color: THREE.Color;
}

export function createWildlife(): WildlifeSystem {
  const group = new THREE.Group();
  group.name = 'WildlifeAndParticles';

  const rand = mulberry32(90012026);
  const uTime = { value: 0 };

  // =========================================================================
  // 1. SOARING BIRDS (Graceful flapping silhouettes circling the canopy & valley)
  // =========================================================================
  const birdCount = 26;
  const birds: BirdAgent[] = [];
  for (let i = 0; i < birdCount; i++) {
    const isCanopyFlock = i < 14;
    birds.push({
      center: isCanopyFlock
        ? new THREE.Vector3(TREE_CENTER.x + 8 + (rand() - 0.5) * 14, 34 + rand() * 14, TREE_CENTER.y - 12 + (rand() - 0.5) * 14)
        : new THREE.Vector3(24 + (rand() - 0.5) * 35, 44 + rand() * 20, -24 + (rand() - 0.5) * 30),
      radiusX: isCanopyFlock ? 22 + rand() * 20 : 42 + rand() * 34,
      radiusZ: isCanopyFlock ? 18 + rand() * 18 : 34 + rand() * 28,
      speed: (0.14 + rand() * 0.09) * (i % 3 === 0 ? -1 : 1),
      phase: rand() * Math.PI * 2,
      bobAmp: 1.4 + rand() * 2.4,
      bobFreq: 0.32 + rand() * 0.25,
      scale: 0.52 + rand() * 0.36,
      flapRate: 4.8 + rand() * 2.2,
    });
  }

  const birdGeo = buildBirdGeometry();
  const birdPhases = new Float32Array(birdCount);
  const birdFlapRates = new Float32Array(birdCount);
  for (let i = 0; i < birdCount; i++) {
    birdPhases[i] = birds[i].phase * 3.1;
    birdFlapRates[i] = birds[i].flapRate;
  }
  birdGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(birdPhases, 1));
  birdGeo.setAttribute('aFlapRate', new THREE.InstancedBufferAttribute(birdFlapRates, 1));

  const birdMat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      attribute float aPhase;
      attribute float aFlapRate;
      varying float vWing;
      void main() {
        vec3 p = position;
        float wingDist = abs(p.x);
        vWing = wingDist;
        // Natural flap-and-glide cadence!
        float glideWindow = smoothstep(-0.35, 0.35, sin(uTime * 0.75 + aPhase));
        float flap = sin(uTime * aFlapRate + aPhase) * (0.32 + 0.68 * glideWindow);
        p.y += flap * pow(wingDist, 1.35) * 0.42;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying float vWing;
      void main() {
        vec3 bodyCol = vec3(0.11, 0.12, 0.14);
        vec3 tipCol = vec3(0.24, 0.25, 0.27);
        vec3 col = mix(bodyCol, tipCol, clamp(vWing * 0.6, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const birdMesh = new THREE.InstancedMesh(birdGeo, birdMat, birdCount);
  birdMesh.frustumCulled = false;
  group.add(birdMesh);

  // =========================================================================
  // 2. FLUTTERING BUTTERFLIES (Among wildflowers, ancient roots & hope pockets)
  // =========================================================================
  const bflyCount = 30;
  const bflies: ButterflyAgent[] = [];
  const bflyPalette = [
    new THREE.Color('#e6b95c'), // warm meadow ochre
    new THREE.Color('#ece5cf'), // woodland ivory
    new THREE.Color('#8cb5db'), // pale azure blue
    new THREE.Color('#d9885b'), // soft monarch amber
  ];

  for (let i = 0; i < bflyCount; i++) {
    let hx: number;
    let hz: number;
    if (i < 12) {
      // Around the Ancient Tree sanctuary roots
      const a = rand() * Math.PI * 2;
      const r = 4.5 + rand() * 11.5;
      hx = TREE_CENTER.x + Math.cos(a) * r;
      hz = TREE_CENTER.y + Math.sin(a) * r;
    } else if (i < 18) {
      // Poignant butterflies hovering over the returning wildflowers on the scarred side!
      const hp = HOPE_POCKETS[i % HOPE_POCKETS.length];
      hx = hp.x + (rand() - 0.5) * 4.0;
      hz = hp.z + (rand() - 0.5) * 4.0;
    } else {
      // Sunlit eastern meadow & riverbanks
      hx = 12 + rand() * 36;
      hz = -18 + rand() * 48;
    }
    const hy = getTerrainHeight(hx, hz) + 1.15 + rand() * 1.6;
    bflies.push({
      home: new THREE.Vector3(hx, hy, hz),
      phase: rand() * Math.PI * 2,
      speed: 0.75 + rand() * 0.65,
      range: 1.8 + rand() * 2.8,
      color: bflyPalette[i % bflyPalette.length],
    });
  }

  const bflyGeo = buildButterflyGeometry();
  const bflyPhases = new Float32Array(bflyCount);
  for (let i = 0; i < bflyCount; i++) bflyPhases[i] = bflies[i].phase * 5.0;
  bflyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(bflyPhases, 1));

  const bflyMat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      attribute float aPhase;
      varying vec3 vColor;
      void main() {
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(0.9, 0.78, 0.45);
        #endif
        vec3 p = position;
        float flap = sin(uTime * 15.0 + aPhase) * 0.85;
        p.y += abs(p.x) * flap;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
  });

  const bflyMesh = new THREE.InstancedMesh(bflyGeo, bflyMat, bflyCount);
  bflyMesh.frustumCulled = false;
  for (let i = 0; i < bflyCount; i++) {
    bflyMesh.setColorAt(i, bflies[i].color);
  }
  if (bflyMesh.instanceColor) bflyMesh.instanceColor.needsUpdate = true;
  group.add(bflyMesh);

  // =========================================================================
  // 3. DUAL-BIOME DRIFTING ATMOSPHERIC PARTICLES (Sunlit pollen vs scarred dust/ash)
  // =========================================================================
  const pollenCount = 520;
  const ashCount = 240;
  const totalParticles = pollenCount + ashCount;

  const pPos = new Float32Array(totalParticles * 3);
  const pSeed = new Float32Array(totalParticles * 3); // x: speed, y: phase, z: type (1 = sunlit pollen, 0 = scarred dust)
  const pSize = new Float32Array(totalParticles);

  for (let i = 0; i < totalParticles; i++) {
    const isPollen = i < pollenCount;
    let x: number;
    let z: number;
    let y: number;

    if (isPollen) {
      if (i < 240) {
        // Warm sunlit pollen drifting around the Ancient Tree canopy & roots
        const a = rand() * Math.PI * 2;
        const r = Math.pow(rand(), 0.7) * 26;
        x = TREE_CENTER.x + Math.cos(a) * r;
        z = TREE_CENTER.y + Math.sin(a) * r;
        y = getTerrainHeight(x, z) + 0.8 + rand() * 20;
      } else {
        // Eastern meadow, river & waterfall sunlit air
        x = -5 + rand() * 75;
        z = -48 + rand() * 105;
        y = getTerrainHeight(x, z) + 0.8 + rand() * 14;
      }
      pSize[i] = 1.8 + rand() * 2.6;
    } else {
      // Sparse dry dust & muted ash motes drifting across the scarred western basin
      x = -12 - rand() * 78;
      z = -28 + rand() * 88;
      y = getTerrainHeight(x, z) + 0.5 + rand() * 11;
      pSize[i] = 2.0 + rand() * 2.8;
    }

    pPos[i * 3] = x;
    pPos[i * 3 + 1] = y;
    pPos[i * 3 + 2] = z;

    pSeed[i * 3] = 0.25 + rand() * 0.55;
    pSeed[i * 3 + 1] = rand() * Math.PI * 2;
    pSeed[i * 3 + 2] = isPollen ? 1.0 : 0.0;
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));

  const pMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime,
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute vec3 aSeed;
      attribute float aSize;
      varying float vType;
      varying float vAlpha;

      void main() {
        vType = aSeed.z;
        vec3 p = position;
        float t = uTime * aSeed.x + aSeed.y;
        // Organic gentle wind drift
        p.x += sin(t * 0.7) * 2.2 + mod(uTime * (aSeed.z > 0.5 ? 0.35 : 0.75) + aSeed.y * 5.0, 16.0) - 8.0;
        p.y += sin(t * 1.15) * 1.1 + cos(t * 0.45) * 0.6;
        p.z += cos(t * 0.65) * 1.8;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float dist = max(1.0, -mvPosition.z);
        gl_PointSize = clamp(aSize * uPixelRatio * (52.0 / dist), 1.0, 14.0);
        vAlpha = smoothstep(130.0, 22.0, dist) * (0.45 + 0.55 * sin(t * 1.8));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying float vType;
      varying float vAlpha;

      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float soft = pow(1.0 - d * 2.0, 2.0);
        // Subtle sunlit warm pollen vs muted smoky-ochre dust
        vec3 pollenCol = vec3(1.0, 0.91, 0.66);
        vec3 ashCol = vec3(0.42, 0.39, 0.37);
        vec3 col = mix(ashCol, pollenCol, vType);
        float alpha = soft * vAlpha * mix(0.32, 0.48, vType);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const particles = new THREE.Points(pGeo, pMat);
  particles.renderOrder = 7;
  group.add(particles);

  // =========================================================================
  // 4. RETURNING RIVER FISH (Swim through established, connected restored tributaries!)
  // =========================================================================
  const buildFishGeometry = (): THREE.BufferGeometry => {
    const geo = new THREE.BufferGeometry();
    // Sleek streamlined trout/salmon body + forked tail (swimming along +Z, tail at -Z)
    const verts = new Float32Array([
      // Left side body
      0.0, 0.0, 0.34,    -0.065, 0.055, 0.08,   -0.065, -0.045, 0.08,
      -0.065, 0.055, 0.08,  0.0, 0.015, -0.22,  -0.065, -0.045, 0.08,
      // Right side body
      0.0, 0.0, 0.34,     0.065, -0.045, 0.08,   0.065, 0.055, 0.08,
      0.065, 0.055, 0.08,   0.065, -0.045, 0.08,  0.0, 0.015, -0.22,
      // Top dorsal spine
      0.0, 0.0, 0.34,     0.065, 0.055, 0.08,   -0.065, 0.055, 0.08,
      -0.065, 0.055, 0.08,  0.065, 0.055, 0.08,   0.0, 0.015, -0.22,
      // Tail fin
      0.0, 0.015, -0.20,  0.0, 0.095, -0.36,    0.0, -0.075, -0.36,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  };

  const fishCount = 24;
  const fishGeo = buildFishGeometry();
  const fishPhases = new Float32Array(fishCount);
  for (let i = 0; i < fishCount; i++) fishPhases[i] = rand() * Math.PI * 2;
  fishGeo.setAttribute('aFishPhase', new THREE.InstancedBufferAttribute(fishPhases, 1));

  const fishMat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      attribute float aFishPhase;
      varying float vAlong;
      void main() {
        vec3 p = position;
        vAlong = clamp((p.z + 0.36) / 0.70, 0.0, 1.0);
        // Natural sinuous swimming tail undulation
        float tailFlex = pow(1.0 - vAlong, 1.7);
        p.x += sin(uTime * 11.5 + aFishPhase - vAlong * 4.0) * 0.095 * tailFlex;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying float vAlong;
      void main() {
        vec3 backCol = vec3(0.22, 0.31, 0.28);
        vec3 silverFlank = vec3(0.68, 0.74, 0.72);
        vec3 col = mix(backCol, silverFlank, smoothstep(0.15, 0.85, vAlong) * 0.75);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, fishCount);
  fishMesh.frustumCulled = false;
  fishMesh.renderOrder = 3;
  group.add(fishMesh);

  interface FishAgent {
    t: number;
    dir: number;
    speed: number;
    lateralOffset: number;
    scale: number;
    active: boolean;
  }
  const fishAgents: FishAgent[] = [];
  for (let i = 0; i < fishCount; i++) {
    fishAgents.push({
      t: 0.05 + (i / fishCount) * 0.85,
      dir: i % 2 === 0 ? 1 : -1,
      speed: 0.045 + rand() * 0.04,
      lateralOffset: (rand() - 0.5) * 0.75,
      scale: 0.85 + rand() * 0.55,
      active: false,
    });
  }

  // =========================================================================
  // 5. RETURNING WOODLAND DEER (Gracefully inhabit established restored clearings!)
  // =========================================================================
  const deerCoatMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8c6848'),
    roughness: 0.88,
  });
  const deerBellyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c8baa0'),
    roughness: 0.9,
  });
  const antlerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b8ab92'),
    roughness: 0.82,
  });

  interface DeerAgent {
    root: THREE.Group;
    neckPivot: THREE.Group;
    legs: THREE.Mesh[];
    pos: THREE.Vector3;
    targetPos: THREE.Vector3;
    yaw: number;
    active: boolean;
    wanderTimer: number;
    phase: number;
    clearingIndex: number;
  }

  const createDeerMesh = (isBuck: boolean): { root: THREE.Group; neckPivot: THREE.Group; legs: THREE.Mesh[] } => {
    const root = new THREE.Group();

    // Sculpted slender torso
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.78, 6, 10), deerCoatMat);
    body.rotation.x = Math.PI * 0.5;
    body.position.set(0, 1.02, 0);
    body.castShadow = true;
    root.add(body);

    // Pale woodland tail tuft
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 5), deerBellyMat);
    tail.position.set(0, 1.06, -0.56);
    tail.rotation.x = -0.65;
    root.add(tail);

    // Articulated neck & head pivot (gently bows to graze!)
    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 1.12, 0.42);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.62, 7), deerCoatMat);
    neck.position.set(0, 0.28, 0.12);
    neck.rotation.x = 0.34;
    neck.castShadow = true;
    neckPivot.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.38), deerCoatMat);
    head.position.set(0, 0.58, 0.30);
    head.rotation.x = 0.14;
    head.castShadow = true;
    neckPivot.add(head);

    // Delicate ears
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 4), deerCoatMat);
      ear.position.set(side * 0.11, 0.70, 0.18);
      ear.rotation.z = -side * 0.48;
      neckPivot.add(ear);
    }

    if (isBuck) {
      for (const side of [-1, 1]) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.024, 0.48, 5), antlerMat);
        beam.position.set(side * 0.12, 0.84, 0.18);
        beam.rotation.z = -side * 0.42;
        beam.rotation.x = -0.18;
        const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.016, 0.24, 4), antlerMat);
        tine.position.set(side * 0.20, 0.94, 0.24);
        tine.rotation.x = 0.35;
        neckPivot.add(beam, tine);
      }
    }
    root.add(neckPivot);

    // 4 slender articulated legs
    const legOffsets: Array<[number, number]> = [
      [-0.14, 0.36],
      [0.14, 0.36],
      [-0.14, -0.36],
      [0.14, -0.36],
    ];
    const legs: THREE.Mesh[] = [];
    for (const [lx, lz] of legOffsets) {
      const legGeo = new THREE.CylinderGeometry(0.042, 0.028, 0.94, 6);
      legGeo.translate(0, -0.45, 0);
      const leg = new THREE.Mesh(legGeo, deerCoatMat);
      leg.position.set(lx, 0.92, lz);
      leg.castShadow = true;
      root.add(leg);
      legs.push(leg);
    }

    root.visible = false;
    return { root, neckPivot, legs };
  };

  const deerCount = 6;
  const deerAgents: DeerAgent[] = [];
  for (let i = 0; i < deerCount; i++) {
    const built = createDeerMesh(i % 2 === 0);
    const sc = i % 2 === 0 ? 1.06 : 0.92;
    built.root.scale.setScalar(sc);
    group.add(built.root);
    deerAgents.push({
      root: built.root,
      neckPivot: built.neckPivot,
      legs: built.legs,
      pos: new THREE.Vector3(14, getTerrainHeight(14, 16), 16),
      targetPos: new THREE.Vector3(-22, getTerrainHeight(-22, 20), 20),
      yaw: 0,
      active: false,
      wanderTimer: rand() * 5,
      phase: rand() * Math.PI * 2,
      clearingIndex: i,
    });
  }

  // Remember original eastern bird & butterfly homes so Reset cleanly restores them!
  const originalBirdCenters = birds.map((b) => b.center.clone());
  const originalBflyHomes = bflies.map((b) => b.home.clone());

  const dummy = new THREE.Object3D();
  const nextPos = new THREE.Vector3();
  let activeFishCount = 0;
  let activeDeerCount = 0;

  const resetRestorationWildlife = () => {
    activeFishCount = 0;
    activeDeerCount = 0;
    for (let i = 0; i < fishCount; i++) {
      fishAgents[i].active = false;
      dummy.position.set(0, -50, 0);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      fishMesh.setMatrixAt(i, dummy.matrix);
    }
    fishMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < deerAgents.length; i++) {
      deerAgents[i].active = false;
      deerAgents[i].root.visible = false;
    }

    for (let i = 0; i < birds.length; i++) birds[i].center.copy(originalBirdCenters[i]);
    for (let i = 0; i < bflies.length; i++) bflies[i].home.copy(originalBflyHomes[i]);
  };

  // Start with fish hidden until connected restored tributaries establish
  resetRestorationWildlife();

  return {
    group,
    resetRestorationWildlife,
    getRecoveryWildlifeCounts: () => ({ activeFish: activeFishCount, activeDeer: activeDeerCount }),
    update(time: number, dt: number, restoration?: RestorationSystem) {
      uTime.value = time;
      const safeDt = Math.min(dt, 0.05);

      const clearings = restoration ? restoration.getEstablishedClearings() : [];
      const branches = restoration ? restoration.getConnectedBranches() : [];

      // 1. Existing birds gently expand over regenerated western clearings
      for (let i = 0; i < birdCount; i++) {
        const b = birds[i];
        const orig = originalBirdCenters[i];
        if (i < 6 && clearings.length > 0) {
          const cl = clearings[i % clearings.length];
          b.center.x = lerp(b.center.x, cl.x, safeDt * 0.25);
          b.center.z = lerp(b.center.z, cl.z, safeDt * 0.25);
        } else {
          b.center.x = lerp(b.center.x, orig.x, safeDt * 0.35);
          b.center.z = lerp(b.center.z, orig.z, safeDt * 0.35);
        }

        const a = time * b.speed + b.phase;
        const x = b.center.x + Math.cos(a) * b.radiusX;
        const z = b.center.z + Math.sin(a) * b.radiusZ;
        const y = b.center.y + Math.sin(time * b.bobFreq + b.phase) * b.bobAmp;

        const aNext = a + b.speed * 0.08;
        nextPos.set(
          b.center.x + Math.cos(aNext) * b.radiusX,
          b.center.y + Math.sin((time + 0.08) * b.bobFreq + b.phase) * b.bobAmp,
          b.center.z + Math.sin(aNext) * b.radiusZ
        );

        dummy.position.set(x, y, z);
        dummy.lookAt(nextPos);
        dummy.rotateZ(b.speed > 0 ? -0.22 : 0.22);
        dummy.scale.setScalar(b.scale);
        dummy.updateMatrix();
        birdMesh.setMatrixAt(i, dummy.matrix);
      }
      birdMesh.instanceMatrix.needsUpdate = true;

      // 2. Existing butterflies visit newly blooming restored flower patches!
      for (let i = 0; i < bflyCount; i++) {
        const bf = bflies[i];
        const orig = originalBflyHomes[i];
        if (i >= 12 && i < 22 && clearings.length > 0) {
          const cl = clearings[(i - 12) % clearings.length];
          const ang = (i * 1.9);
          const tx = cl.x + Math.cos(ang) * 4.5;
          const tz = cl.z + Math.sin(ang) * 4.5;
          const ty = getTerrainHeight(tx, tz) + 1.25;
          bf.home.x = lerp(bf.home.x, tx, safeDt * 0.45);
          bf.home.y = lerp(bf.home.y, ty, safeDt * 0.45);
          bf.home.z = lerp(bf.home.z, tz, safeDt * 0.45);
        } else {
          bf.home.lerp(orig, safeDt * 0.5);
        }

        const t = time * bf.speed + bf.phase;
        const x = bf.home.x + Math.sin(t) * bf.range + Math.cos(t * 2.3) * 0.45;
        const z = bf.home.z + Math.cos(t * 0.85) * bf.range + Math.sin(t * 1.9) * 0.45;
        const y = bf.home.y + Math.sin(t * 2.1) * 0.55;

        const t2 = t + 0.05;
        nextPos.set(
          bf.home.x + Math.sin(t2) * bf.range + Math.cos(t2 * 2.3) * 0.45,
          bf.home.y + Math.sin(t2 * 2.1) * 0.55,
          bf.home.z + Math.cos(t2 * 0.85) * bf.range + Math.sin(t2 * 1.9) * 0.45
        );
        dummy.position.set(x, y, z);
        dummy.lookAt(nextPos);
        dummy.scale.setScalar(0.85 + 0.25 * Math.sin(bf.phase));
        dummy.updateMatrix();
        bflyMesh.setMatrixAt(i, dummy.matrix);
      }
      bflyMesh.instanceMatrix.needsUpdate = true;

      // 3. Returning Fish swim smoothly along established connected tributaries!
      const establishedBranches = branches.filter((b) => b.headT > 0.55 && b.age > 2.2 && b.points.length >= 4);
      activeFishCount = 0;
      for (let i = 0; i < fishCount; i++) {
        const fa = fishAgents[i];
        if (establishedBranches.length === 0) {
          fa.active = false;
          dummy.position.set(0, -50, 0);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          fishMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        const br = establishedBranches[i % establishedBranches.length];
        const maxT = Math.max(0.15, br.headT - 0.08);
        fa.active = true;
        activeFishCount++;

        fa.t += fa.dir * fa.speed * safeDt;
        if (fa.t > maxT) {
          fa.t = maxT;
          fa.dir = -1;
        } else if (fa.t < 0.06) {
          fa.t = 0.06;
          fa.dir = 1;
        }

        const fIdx = clamp(fa.t * (br.points.length - 1), 0, br.points.length - 1.001);
        const i0 = Math.floor(fIdx);
        const frac = fIdx - i0;
        const p0 = br.points[i0];
        const p1 = br.points[i0 + 1];
        const fx = lerp(p0.x, p1.x, frac);
        const fz = lerp(p0.z, p1.z, frac);
        const tx = p1.x - p0.x;
        const tz = p1.z - p0.z;
        const tLen = Math.hypot(tx, tz) || 1;
        const nx = -tz / tLen;
        const nz = tx / tLen;

        const wx = fx + nx * fa.lateralOffset;
        const wz = fz + nz * fa.lateralOffset;
        const wy = getTerrainHeight(wx, wz) + 0.07;

        dummy.position.set(wx, wy, wz);
        nextPos.set(wx + (tx / tLen) * fa.dir, wy, wz + (tz / tLen) * fa.dir);
        dummy.lookAt(nextPos);
        dummy.scale.setScalar(fa.scale);
        dummy.updateMatrix();
        fishMesh.setMatrixAt(i, dummy.matrix);
      }
      fishMesh.instanceMatrix.needsUpdate = true;

      // 4. Returning Woodland Deer gradually arrive in mature restored clearings!
      const matureClearings = clearings.filter((c) => c.maturity > 0.32);
      activeDeerCount = 0;
      const desiredDeer = Math.min(deerCount, matureClearings.length * 2);

      for (let i = 0; i < deerCount; i++) {
        const d = deerAgents[i];
        if (i >= desiredDeer) {
          d.active = false;
          d.root.visible = false;
          continue;
        }

        const cl = matureClearings[i % matureClearings.length];
        if (!d.active) {
          // Spawn subtly at the edge of the clearing / living woodland side and walk gently in!
          d.active = true;
          d.root.visible = true;
          const entryAng = (i * 1.45) + 0.5;
          const sx = cl.x + Math.cos(entryAng) * 18.0;
          const sz = cl.z + Math.sin(entryAng) * 18.0;
          d.pos.set(sx, getTerrainHeight(sx, sz), sz);
          d.targetPos.set(cl.x + Math.cos(entryAng + 0.8) * 6.0, getTerrainHeight(cl.x, cl.z), cl.z + Math.sin(entryAng + 0.8) * 6.0);
          d.wanderTimer = 3.0 + rand() * 4.0;
        }

        activeDeerCount++;
        const dx = d.targetPos.x - d.pos.x;
        const dz = d.targetPos.z - d.pos.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.45) {
          const walkSpeed = 2.1;
          const step = Math.min(dist, walkSpeed * safeDt);
          d.pos.x += (dx / dist) * step;
          d.pos.z += (dz / dist) * step;
          d.pos.y = getTerrainHeight(d.pos.x, d.pos.z);

          const targetYaw = Math.atan2(dx, dz);
          let diff = targetYaw - d.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          d.yaw += diff * clamp(safeDt * 3.5, 0, 1);

          // Gentle walking leg stride
          const stride = Math.sin(time * 5.2 + d.phase) * 0.34;
          d.legs[0].rotation.x = stride;
          d.legs[3].rotation.x = stride;
          d.legs[1].rotation.x = -stride;
          d.legs[2].rotation.x = -stride;
          d.neckPivot.rotation.x = lerp(d.neckPivot.rotation.x, 0.08, safeDt * 3.0);
        } else {
          // Grazing peacefully in the restored clearing!
          for (let l = 0; l < 4; l++) d.legs[l].rotation.x = lerp(d.legs[l].rotation.x, 0, safeDt * 4.0);
          const grazePitch = 0.72 + Math.sin(time * 1.4 + d.phase) * 0.12;
          d.neckPivot.rotation.x = lerp(d.neckPivot.rotation.x, grazePitch, safeDt * 2.2);

          d.wanderTimer -= safeDt;
          if (d.wanderTimer <= 0) {
            d.wanderTimer = 5.0 + rand() * 6.0;
            const wa = rand() * Math.PI * 2;
            const wr = 3.0 + rand() * 8.5;
            const nx = cl.x + Math.cos(wa) * wr;
            const nz = cl.z + Math.sin(wa) * wr;
            d.targetPos.set(nx, getTerrainHeight(nx, nz), nz);
          }
        }

        d.root.position.copy(d.pos);
        d.root.rotation.y = d.yaw;
      }

      void clamp;
    },
  };
}
