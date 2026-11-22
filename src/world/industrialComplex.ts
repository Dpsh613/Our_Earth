import * as THREE from 'three';
import { clamp, fbm2D, lerp, mulberry32 } from './noise';
import {
  DISTANT_PLANT_POS,
  FACTORY_CENTER,
  OIL_TRICKLE_PTS,
  RESERVOIR_CENTER,
  WEIR_POS,
} from './damageField';
import { getTerrainHeight, SUN_DIRECTION } from './terrainData';
import { WorldTextures } from './textures';

export interface IndustrialSystem {
  group: THREE.Group;
  update: (time: number) => void;
}

function createCorrugatedMetalTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const rib = Math.sin(u * Math.PI * 2 * 28) * 0.5 + 0.5;
      const grime = fbm2D(u * 6.0, v * 4.0, 4) * 0.5 + 0.5;
      const rustStreak = clamp(fbm2D(u * 14.0 + 3.1, v * 3.0, 3) * 0.6 + 0.45, 0, 1);
      const seam = Math.abs((v * 4) % 1 - 0.5) > 0.47 ? 0.62 : 1.0;

      let r = lerp(34, 78, rib * 0.55 + grime * 0.45);
      let g = lerp(34, 76, rib * 0.55 + grime * 0.45);
      let b = lerp(36, 78, rib * 0.55 + grime * 0.45);

      const rustAmt = clamp((rustStreak - 0.50) * 1.9, 0, 0.72);
      r = lerp(r, 122, rustAmt);
      g = lerp(g, 62, rustAmt);
      b = lerp(b, 38, rustAmt);

      const edgeSoot = 0.72 + 0.28 * Math.sin(v * Math.PI);
      const idx = (y * size + x) * 4;
      img.data[idx] = clamp(Math.round(r * seam * edgeSoot), 0, 255);
      img.data[idx + 1] = clamp(Math.round(g * seam * edgeSoot), 0, 255);
      img.data[idx + 2] = clamp(Math.round(b * seam * edgeSoot), 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function createWeatheredConcreteTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = fbm2D(u * 8, v * 8, 4) * 0.5 + 0.5;
      const streak = fbm2D(u * 18, v * 2.5, 3) * 0.5 + 0.5;
      const dampBase = clamp(1 - v * 2.1, 0, 1);
      const base = lerp(82, 132, n1 * 0.65 + streak * 0.35);
      const stain = lerp(1.0, 0.46, dampBase * (0.55 + 0.45 * streak));

      const idx = (y * size + x) * 4;
      img.data[idx] = clamp(Math.round(base * stain * 1.02), 0, 255);
      img.data[idx + 1] = clamp(Math.round(base * stain * 0.98), 0, 255);
      img.data[idx + 2] = clamp(Math.round(base * stain * 0.92), 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

interface SmokePlumePuff {
  sprite: THREE.Sprite;
  origin: THREE.Vector3;
  phase: number;
  speed: number;
  maxRise: number;
  driftX: number;
  driftZ: number;
  startScale: number;
  endScale: number;
  maxOpacity: number;
  startCol: THREE.Color;
  endCol: THREE.Color;
}

interface LowHazePuff {
  sprite: THREE.Sprite;
  baseX: number;
  baseY: number;
  baseZ: number;
  driftSpeed: number;
}

function buildOilTrickleGeometry(pts: Array<[number, number]>): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.45
  );
  const steps = 38;
  const cross = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const edgeFade: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const tLen = Math.hypot(tan.x, tan.z) || 1;
    const nx = -tan.z / tLen;
    const nz = tan.x / tLen;
    const halfW = lerp(0.55, 2.6, Math.pow(t, 1.8));
    const ends = clamp(t / 0.08, 0, 1) * clamp((1 - t) / 0.14, 0, 1);

    for (let j = 0; j <= cross; j++) {
      const u = j / cross;
      const across = u * 2 - 1;
      const wx = p.x + nx * across * halfW;
      const wz = p.z + nz * across * halfW;
      const gy = getTerrainHeight(wx, wz);
      const center = Math.max(0, 1 - across * across);
      const y = lerp(gy - 0.04, gy + 0.048, center);
      positions.push(wx, y, wz);
      uvs.push(u, t * 5.0);
      edgeFade.push(center * (0.25 + 0.75 * ends));
    }
  }

  const stride = cross + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < cross; j++) {
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
  geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edgeFade, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createIndustrialComplex(textures: WorldTextures): IndustrialSystem {
  const group = new THREE.Group();
  group.name = 'IndustrialDestruction';

  const rand = mulberry32(20260309);
  const uTime = { value: 0 };

  const corrugatedTex = createCorrugatedMetalTexture();
  corrugatedTex.repeat.set(4, 2);
  const concreteTex = createWeatheredConcreteTexture();
  concreteTex.repeat.set(2, 2);

  const concreteMat = new THREE.MeshStandardMaterial({
    map: concreteTex,
    roughness: 0.94,
    metalness: 0.04,
  });
  const darkConcreteMat = new THREE.MeshStandardMaterial({
    map: concreteTex,
    color: new THREE.Color('#4c4844'),
    roughness: 0.96,
    metalness: 0.04,
  });
  const corrugatedMat = new THREE.MeshStandardMaterial({
    map: corrugatedTex,
    roughness: 0.84,
    metalness: 0.34,
  });
  const darkSteelMat = new THREE.MeshStandardMaterial({
    map: textures.rustMap,
    color: new THREE.Color('#383330'),
    roughness: 0.82,
    metalness: 0.54,
  });
  const rustSteelMat = new THREE.MeshStandardMaterial({
    map: textures.rustMap,
    color: new THREE.Color('#8a4e33'),
    roughness: 0.84,
    metalness: 0.44,
  });
  const sootCrownMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#181616'),
    roughness: 0.98,
    metalness: 0.05,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#16171a'),
    roughness: 0.42,
    metalness: 0.22,
  });

  // =========================================================================
  // THICK, LAYERED DARK INDUSTRIAL SMOKE PLUMES (Rises, expands & drifts west)
  // =========================================================================
  const smokePuffs: SmokePlumePuff[] = [];
  const smokeCoreCol = new THREE.Color('#1a1818');      // thick dense charcoal-soot throat
  const smokeMidCol = new THREE.Color('#3c3533');       // dark industrial ash belly
  const smokeDriftCol = new THREE.Color('#664d42');     // bruised ochre-ash outer haze

  const addThickSmokeColumn = (
    topPos: THREE.Vector3,
    count: number,
    baseScale: number,
    rise: number,
    heavyDark = true
  ) => {
    for (let i = 0; i < count; i++) {
      const startC = heavyDark ? smokeCoreCol.clone() : smokeMidCol.clone();
      const endC = heavyDark ? smokeDriftCol.clone() : new THREE.Color('#7a6255');
      const mat = new THREE.SpriteMaterial({
        map: textures.cloudPuffMap,
        color: startC.clone(),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(topPos);
      sprite.renderOrder = 5;
      group.add(sprite);

      smokePuffs.push({
        sprite,
        origin: topPos.clone(),
        phase: i / count + rand() * 0.05,
        speed: 0.032 + rand() * 0.015,
        maxRise: rise + rand() * 14.0,
        // Drifts westward & slightly northwest away from the Ancient Tree and eastern sky!
        driftX: -28.0 - rand() * 24.0,
        driftZ: -12.0 + (rand() - 0.5) * 14.0,
        startScale: baseScale * (0.8 + rand() * 0.35),
        endScale: baseScale * (4.6 + rand() * 2.2),
        maxOpacity: heavyDark ? 0.62 + rand() * 0.16 : 0.42 + rand() * 0.14,
        startCol: startC,
        endCol: endC,
      });
    }
  };

  // =========================================================================
  // 1. IMPOSING INDUSTRIAL SKYLINE ON THE NORTHWESTERN RIDGE (-98, y, -78)
  //    Monumental factories, 4 towering smokestacks & thick dark billowing smoke
  // =========================================================================
  {
    const fx = FACTORY_CENTER.x;
    const fz = FACTORY_CENTER.y;
    const fy = getTerrainHeight(fx, fz);

    const factory = new THREE.Group();
    factory.position.set(fx, fy, fz);
    factory.rotation.y = 0.42;

    // Massive deeply-embedded concrete retaining terrace (extends 38m downward so ZERO slope gap!)
    const pad = new THREE.Mesh(new THREE.BoxGeometry(58, 38.0, 34), darkConcreteMat);
    pad.position.set(0, -18.0, 0);
    pad.receiveShadow = true;
    factory.add(pad);

    // Primary Heavy Processing Hall (monumental scale matching alpine mountain ridge!)
    const mainHall = new THREE.Mesh(new THREE.BoxGeometry(36.0, 16.5, 19.0), corrugatedMat);
    mainHall.position.set(-5.0, 9.2, 1.0);
    mainHall.castShadow = true;
    mainHall.receiveShadow = true;
    factory.add(mainHall);

    // Sawtooth Roof Bays along Main Hall
    for (let i = 0; i < 4; i++) {
      const bay = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 4.6, 19.2, 3), darkSteelMat);
      bay.rotation.x = Math.PI * 0.5;
      bay.rotation.y = Math.PI / 6;
      bay.scale.set(1.15, 1.0, 0.88);
      bay.position.set(-18.5 + i * 9.0, 19.2, 1.0);
      factory.add(bay);
    }

    // Dark Industrial Facade Window Bays & Steel Buttresses
    for (let i = 0; i < 6; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.6, 0.35), windowMat);
      win.position.set(-19.5 + i * 5.8, 10.8, 10.6);
      factory.add(win);
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.65, 16.5, 1.1), darkSteelMat);
      col.position.set(-22.2 + i * 5.8, 9.2, 10.65);
      factory.add(col);
    }

    // Tall Smelter / Furnace Tower Wing adjoining the east end of the plant
    const smelter = new THREE.Mesh(new THREE.BoxGeometry(16.0, 23.0, 15.0), concreteMat);
    smelter.position.set(18.5, 12.2, -1.5);
    smelter.castShadow = true;
    smelter.receiveShadow = true;
    factory.add(smelter);

    // Heavy Rooftop Exhaust Ducts connecting halls to smokestacks
    const duct = new THREE.Mesh(new THREE.BoxGeometry(28.0, 2.8, 3.2), darkSteelMat);
    duct.position.set(4.0, 18.2, -5.5);
    factory.add(duct);

    // 4 Monumental Tapered Industrial Smokestacks dominating the northwestern skyline!
    const stackSpecs = [
      { x: 21.0, z: -7.5, h: 64.0, rBot: 3.1, rTop: 1.55, puffs: 18, heavy: true },
      { x: 9.5, z: -9.8, h: 55.0, rBot: 2.75, rTop: 1.38, puffs: 16, heavy: true },
      { x: -4.5, z: -9.0, h: 48.0, rBot: 2.45, rTop: 1.24, puffs: 14, heavy: true },
      { x: -19.0, z: -8.2, h: 41.0, rBot: 2.15, rTop: 1.12, puffs: 12, heavy: false },
    ];

    factory.updateMatrixWorld(true);
    for (const st of stackSpecs) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(st.rTop, st.rBot, st.h, 16), concreteMat);
      stack.position.set(st.x, st.h * 0.5 + 0.5, st.z);
      stack.castShadow = true;
      factory.add(stack);

      const crown = new THREE.Mesh(new THREE.CylinderGeometry(st.rTop * 1.05, st.rTop * 1.16, 6.0, 16), sootCrownMat);
      crown.position.set(st.x, st.h - 2.2, st.z);
      factory.add(crown);

      for (const bandFrac of [0.34, 0.60, 0.82]) {
        const br = lerp(st.rBot, st.rTop, bandFrac) * 1.05;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(br, br, 0.72, 16), rustSteelMat);
        band.position.set(st.x, st.h * bandFrac + 0.5, st.z);
        factory.add(band);
      }

      const rimWorld = new THREE.Vector3(st.x, st.h + 1.5, st.z).applyMatrix4(factory.matrixWorld);
      addThickSmokeColumn(rimWorld, st.puffs, 6.5 + st.rTop * 2.2, 52.0 + st.h * 0.35, st.heavy);
    }

    group.add(factory);
  }

  // =========================================================================
  // 2. COLOSSAL COOLING TOWER & SECONDARY INDUSTRIAL BLOCK (-132, y, -48)
  // =========================================================================
  {
    const dx = DISTANT_PLANT_POS.x;
    const dz = DISTANT_PLANT_POS.y;
    const dy = getTerrainHeight(dx, dz);

    const distant = new THREE.Group();
    distant.position.set(dx, dy, dz);
    distant.rotation.y = 0.25;

    // Appropriately monumental hyperbolic cooling tower deeply skirted into the terrain ridge
    const towerPts: THREE.Vector2[] = [];
    towerPts.push(new THREE.Vector2(14.5, -28.0));
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const y = t * 44.0 - 4.0;
      const r = 12.6 - Math.sin(t * Math.PI * 0.82) * 4.5 + Math.pow(t, 2.2) * 2.0;
      towerPts.push(new THREE.Vector2(r, y));
    }
    const coolingTower = new THREE.Mesh(new THREE.LatheGeometry(towerPts, 22), darkConcreteMat);
    coolingTower.castShadow = true;
    distant.add(coolingTower);

    // Secondary heavy industrial plant block + 5th towering smokestack
    const blockPad = new THREE.Mesh(new THREE.BoxGeometry(34, 34, 24), darkConcreteMat);
    blockPad.position.set(-14, -16, 18);
    distant.add(blockPad);

    const block = new THREE.Mesh(new THREE.BoxGeometry(28, 14, 18), corrugatedMat);
    block.position.set(-14, 7.5, 18);
    block.castShadow = true;
    distant.add(block);

    const distStack = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 2.65, 58, 14), concreteMat);
    distStack.position.set(-22, 29, 12);
    distStack.castShadow = true;
    distant.add(distStack);

    const distCrown = new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.62, 5.2, 14), sootCrownMat);
    distCrown.position.set(-22, 56, 12);
    distant.add(distCrown);

    distant.updateMatrixWorld(true);
    const coolTop = new THREE.Vector3(0, 41.5, 0).applyMatrix4(distant.matrixWorld);
    addThickSmokeColumn(coolTop, 14, 14.0, 56.0, false);

    const stackTop = new THREE.Vector3(-22, 59.5, 12).applyMatrix4(distant.matrixWorld);
    addThickSmokeColumn(stackTop, 16, 8.2, 62.0, true);

    group.add(distant);
  }

  // =========================================================================
  // 3. LOCALIZED WESTERN ATMOSPHERIC SMOKE HAZE LAYERS (Strictly West — NEVER touches East!)
  // =========================================================================
  const lowHaze: LowHazePuff[] = [];
  for (let i = 0; i < 20; i++) {
    const hx = -65 - rand() * 145;
    const hz = -115 + rand() * 195;
    const hy = getTerrainHeight(hx, hz) + 12 + rand() * 34;
    const isDark = i % 2 === 0;
    const mat = new THREE.SpriteMaterial({
      map: textures.cloudPuffMap,
      color: new THREE.Color(isDark ? '#4a3d38' : '#735445'),
      transparent: true,
      opacity: 0.16 + rand() * 0.12,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(hx, hy, hz);
    const sx = 58 + rand() * 68;
    const sy = 20 + rand() * 24;
    sprite.scale.set(sx, sy, 1);
    sprite.renderOrder = 3;
    group.add(sprite);
    lowHaze.push({
      sprite,
      baseX: hx,
      baseY: hy,
      baseZ: hz,
      driftSpeed: 0.35 + rand() * 0.35,
    });
  }

  // =========================================================================
  // 4. MONUMENTAL MID-GROUND SCAR: SEVERED RESERVOIR DAM / WEIR (-48.5, y, 22.0)
  // =========================================================================
  {
    const wx = WEIR_POS.x;
    const wz = WEIR_POS.y;
    const wy = getTerrainHeight(wx, wz);

    const weir = new THREE.Group();
    weir.position.set(wx, wy, wz);
    weir.rotation.y = 0.58;

    const mainWall = new THREE.Mesh(new THREE.BoxGeometry(20.5, 6.2, 2.2), concreteMat);
    mainWall.position.set(0, 0.9, 0);
    mainWall.castShadow = true;
    mainWall.receiveShadow = true;
    weir.add(mainWall);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5.5, 5.4, 2.4), darkConcreteMat);
      wing.position.set(side * 11.4, 0.5, -1.1);
      wing.rotation.y = side * -0.34;
      wing.castShadow = true;
      wing.receiveShadow = true;
      weir.add(wing);
    }

    const tideStain = new THREE.Mesh(new THREE.BoxGeometry(20.6, 1.05, 2.32), darkConcreteMat);
    tideStain.position.set(0, 2.2, 0);
    weir.add(tideStain);

    for (let i = 0; i < 4; i++) {
      const px = -6.9 + i * 4.6;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.35, 7.8, 3.8), darkConcreteMat);
      pier.position.set(px, 1.7, 0.35);
      pier.castShadow = true;
      pier.receiveShadow = true;
      weir.add(pier);

      if (i < 3) {
        const bayX = px + 2.3;
        const gate = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, 0.32), rustSteelMat);
        gate.position.set(bayX, i === 1 ? 0.65 : 0.35, 0.55);
        if (i === 1) gate.rotation.z = 0.08;
        gate.castShadow = true;
        gate.receiveShadow = true;
        weir.add(gate);

        const beam = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.38, 0.42), darkSteelMat);
        beam.position.set(bayX, 5.4, 0.35);
        beam.castShadow = true;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 6), rustSteelMat);
        stem.position.set(bayX, 3.8, 0.55);
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.06, 6, 14), rustSteelMat);
        wheel.rotation.x = Math.PI * 0.5;
        wheel.position.set(bayX, 5.75, 0.55);
        weir.add(beam, stem, wheel);
      }
    }

    const apron = new THREE.Mesh(new THREE.BoxGeometry(16.0, 0.65, 5.5), darkConcreteMat);
    apron.position.set(0, -1.6, 3.2);
    apron.receiveShadow = true;
    weir.add(apron);

    const leakGap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 2.5), sootCrownMat);
    leakGap.position.set(0, -1.0, 0.2);
    weir.add(leakGap);

    group.add(weir);

    // Dark iridescent oil-sheen trickle & stagnant slick hollow
    const oilMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uSunDir: { value: SUN_DIRECTION.clone() },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        attribute float aEdge;
        varying vec2 vUv;
        varying float vEdge;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vEdge = aEdge;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying float vEdge;
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
          if (vEdge < 0.04) discard;
          vec2 flowUV = vec2(vUv.x * 2.8, vUv.y * 2.2 - uTime * 0.16);
          float swirl = vnoise(flowUV * 2.4) * 0.6 + vnoise(flowUV * 5.2 + vec2(2.3, -uTime * 0.08)) * 0.4;
          vec3 N = normalize(vec3((swirl - 0.5) * 0.35, 1.0, (vnoise(flowUV * 3.1 + 4.1) - 0.5) * 0.35));
          vec3 V = normalize(cameraPosition - vWorldPos);
          float NoV = clamp(dot(N, V), 0.0, 1.0);
          float fresnel = pow(1.0 - NoV, 3.0);

          float phase = swirl * 6.5 + (1.0 - NoV) * 5.2 + uTime * 0.25;
          vec3 irid = vec3(
            0.5 + 0.5 * sin(phase),
            0.5 + 0.5 * sin(phase + 2.094),
            0.5 + 0.5 * sin(phase + 4.188)
          );
          vec3 petrolTint = mix(vec3(0.06, 0.09, 0.10), irid * vec3(0.42, 0.55, 0.48), fresnel * 0.78 + 0.16);
          vec3 baseTar = vec3(0.035, 0.032, 0.030);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(clamp(dot(N, H), 0.0, 1.0), 120.0);

          vec3 col = mix(baseTar, petrolTint, clamp(fresnel * 0.85 + swirl * 0.35, 0.0, 0.9));
          col += vec3(0.75, 0.68, 0.58) * spec * 0.65;

          float alpha = smoothstep(0.04, 0.45, vEdge) * 0.92;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const trickleMesh = new THREE.Mesh(buildOilTrickleGeometry(OIL_TRICKLE_PTS), oilMat);
    trickleMesh.renderOrder = 3;
    group.add(trickleMesh);

    const rx = RESERVOIR_CENTER.x;
    const rz = RESERVOIR_CENTER.y;
    const poolGeo = new THREE.CircleGeometry(6.8, 28);
    poolGeo.rotateX(-Math.PI * 0.5);
    const pPos = poolGeo.attributes.position;
    const pEdge = new Float32Array(pPos.count);
    let minBed = Infinity;
    for (let i = 0; i < pPos.count; i++) {
      const lx = pPos.getX(i) * 1.32;
      const lz = pPos.getZ(i) * 0.82;
      pPos.setX(i, lx);
      pPos.setZ(i, lz);
      const rNorm = clamp(Math.hypot(lx / (6.8 * 1.32), lz / (6.8 * 0.82)), 0, 1);
      pEdge[i] = 1 - rNorm * rNorm;
      const gh = getTerrainHeight(rx + lx, rz + lz);
      if (gh < minBed) minBed = gh;
    }
    poolGeo.setAttribute('aEdge', new THREE.BufferAttribute(pEdge, 1));
    const poolMesh = new THREE.Mesh(poolGeo, oilMat);
    poolMesh.position.set(rx, minBed + 0.12, rz);
    poolMesh.renderOrder = 3;
    group.add(poolMesh);
  }

  return {
    group,
    update(time: number) {
      uTime.value = time;

      // Animate thick, layered dark industrial smoke rising, expanding & drifting westward
      for (let i = 0; i < smokePuffs.length; i++) {
        const p = smokePuffs[i];
        const t = (p.phase + time * p.speed) % 1;
        const fadeIn = clamp(t / 0.12, 0, 1);
        const fadeOut = 1 - clamp((t - 0.34) / 0.66, 0, 1);
        const driftEase = Math.pow(t, 1.35);
        p.sprite.position.set(
          p.origin.x + p.driftX * driftEase + Math.sin(time * 0.3 + i * 1.1) * (1.8 + t * 4.5),
          p.origin.y + p.maxRise * Math.pow(t, 0.78),
          p.origin.z + p.driftZ * driftEase + Math.cos(time * 0.25 + i) * (1.2 + t * 3.0)
        );
        const s = lerp(p.startScale, p.endScale, Math.pow(t, 0.72));
        p.sprite.scale.set(s * 1.38, s * 0.96, 1);
        p.sprite.material.color.copy(p.startCol).lerp(p.endCol, clamp(t * 1.25, 0, 1));
        p.sprite.material.opacity = fadeIn * fadeOut * fadeOut * p.maxOpacity;
      }

      // Gently drift localized low western smog haze layers (strictly stays west of x = -55!)
      for (let i = 0; i < lowHaze.length; i++) {
        const h = lowHaze[i];
        let nx = h.baseX - ((time * h.driftSpeed) % 75);
        if (nx < -215) nx += 145;
        h.sprite.position.x = nx;
        h.sprite.position.y = h.baseY + Math.sin(time * 0.18 + i) * 1.6;
      }
    },
  };
}
