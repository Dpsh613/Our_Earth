import * as THREE from 'three';
import { clamp, lerp, mulberry32, smoothstep } from './noise';
import { getTerrainHeight, SUN_DIRECTION, TREE_CENTER } from './terrainData';
import { WorldTextures } from './textures';

export interface AncientTreeSystem {
  group: THREE.Group;
  uniforms: {
    uTime: { value: number };
  };
  canopyBounds: {
    center: THREE.Vector3;
    radius: number;
  };
}

interface BranchTip {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  vitality: number; // 0 = weathered bare branch on scarred side, 1 = lush living bough
  scale: number;
}

interface MossAnchor {
  pos: THREE.Vector3;
  length: number;
}

interface TubeBuilder {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[]; // r = moss mask, g = bark weathering, b = AO
  indices: number[];
}

function appendFlutedTube(
  builder: TubeBuilder,
  curve: THREE.CatmullRomCurve3,
  segments: number,
  radialSegs: number,
  radiusStart: number,
  radiusEnd: number,
  fluteCount: number,
  fluteAmp: number,
  twist: number,
  uvScaleV: number,
  mossBias: number,
  weatherBias: number
) {
  const baseVert = builder.positions.length / 3;
  const frames = curve.computeFrenetFrames(segments, false);
  const pt = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const vPos = new THREE.Vector3();
  const vNorm = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, pt);
    normal.copy(frames.normals[i]);
    binormal.copy(frames.binormals[i]);

    // Organic taper with root flare / collar thickening near t=0
    const flare = Math.pow(1 - t, 3.2) * 0.24;
    const baseR = lerp(radiusStart, radiusEnd, Math.pow(t, 0.85)) * (1 + flare);
    const localFluteAmp = fluteAmp * (1 - t * 0.65);

    for (let j = 0; j <= radialSegs; j++) {
      const u = j / radialSegs;
      const theta = u * Math.PI * 2;
      const fluteWave = Math.sin(theta * fluteCount + t * twist) * 0.65 + Math.cos(theta * (fluteCount * 2 - 1) - t * twist * 0.7) * 0.35;
      const r = Math.max(0.03, baseR * (1 + fluteWave * localFluteAmp));

      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      vNorm
        .set(0, 0, 0)
        .addScaledVector(normal, cosT)
        .addScaledVector(binormal, sinT)
        .normalize();

      vPos.copy(pt).addScaledVector(vNorm, r);

      builder.positions.push(vPos.x, vPos.y, vPos.z);
      builder.normals.push(vNorm.x, vNorm.y, vNorm.z);
      builder.uvs.push(u * Math.max(1, Math.round(radiusStart * 2.2)), t * uvScaleV);

      // Vertex color channels: R = moss potential (upward & east/north facing), G = weathered silvering, B = bark crevice AO
      const upFacing = clamp(vNorm.y * 0.7 + 0.35, 0, 1);
      const eastFacing = clamp(vNorm.x * 0.45 - vNorm.z * 0.3 + 0.55, 0, 1);
      const moss = clamp(upFacing * eastFacing * mossBias * (0.65 + 0.35 * (1 - fluteWave)), 0, 1);
      const ao = clamp(0.62 + 0.38 * (fluteWave * 0.5 + 0.5), 0.38, 1.0);
      builder.colors.push(moss, weatherBias, ao);
    }
  }

  const stride = radialSegs + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = baseVert + i * stride + j;
      const b = baseVert + (i + 1) * stride + j;
      const c = baseVert + (i + 1) * stride + (j + 1);
      const d = baseVert + i * stride + (j + 1);
      builder.indices.push(a, b, d);
      builder.indices.push(b, c, d);
    }
  }
}

export function createAncientTree(textures: WorldTextures): AncientTreeSystem {
  const group = new THREE.Group();
  group.name = 'TheAncientTree';

  const rand = mulberry32(20260711);
  const baseGroundY = getTerrainHeight(TREE_CENTER.x, TREE_CENTER.y);
  const treeBase = new THREE.Vector3(TREE_CENTER.x, baseGroundY - 0.55, TREE_CENTER.y);

  const builder: TubeBuilder = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
  };

  const leafTips: BranchTip[] = [];
  const mossAnchors: MossAnchor[] = [];

  // 1. MONUMENTAL GNARLED MAIN TRUNK (rising ~13.2m before main crown bifurcation)
  const trunkPts = [
    new THREE.Vector3(0, -1.2, 0),
    new THREE.Vector3(0.15, 2.2, -0.1),
    new THREE.Vector3(-0.35, 5.8, 0.25),
    new THREE.Vector3(0.2, 9.6, -0.18),
    new THREE.Vector3(0.45, 13.6, -0.05),
  ];
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPts);
  appendFlutedTube(builder, trunkCurve, 32, 28, 3.1, 1.85, 7, 0.22, 2.1, 4.8, 0.85, 0.12);

  // 2. EXPOSED SWEEPING SURFACE ROOTS gripping the sanctuary knoll & plunging into the earth
  const rootCount = 11;
  for (let i = 0; i < rootCount; i++) {
    const angle = (i / rootCount) * Math.PI * 2 + (rand() - 0.5) * 0.28;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const rootLen = 8.5 + rand() * 5.8;
    const isScarredSide = dirX < -0.35;

    const rPts: THREE.Vector3[] = [];
    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const dist = lerp(1.4, rootLen, f);
      const lateralWiggle = Math.sin(f * Math.PI * 2.1 + i * 1.7) * 0.85 * f;
      const wx = TREE_CENTER.x + dirX * dist - dirZ * lateralWiggle;
      const wz = TREE_CENTER.y + dirZ * dist + dirX * lateralWiggle;
      const groundH = getTerrainHeight(wx, wz) - treeBase.y;

      // Roots arch gracefully out of the trunk collar, hug the terrain surface, then bury tips underground
      let ry: number;
      if (s === 0) {
        ry = 2.6 + rand() * 0.9;
      } else if (s === 1) {
        ry = Math.max(groundH + 1.05, 1.35);
      } else if (s < steps) {
        const arch = Math.sin(f * Math.PI) * 0.65;
        ry = groundH + arch * (1 - f * 0.45) + 0.12;
      } else {
        ry = groundH - 0.85;
      }
      rPts.push(new THREE.Vector3(wx - TREE_CENTER.x, ry, wz - TREE_CENTER.y));
    }

    const rCurve = new THREE.CatmullRomCurve3(rPts);
    const rStart = 0.88 + rand() * 0.35;
    appendFlutedTube(
      builder,
      rCurve,
      18,
      10,
      rStart,
      0.16,
      4,
      0.18,
      1.6,
      3.5,
      isScarredSide ? 0.32 : 0.95,
      isScarredSide ? 0.45 : 0.08
    );

    // Secondary root fork splitting off halfway down the main root
    if (i % 2 === 0) {
      const forkStart = rCurve.getPoint(0.45);
      const forkAng = angle + (rand() > 0.5 ? 1 : -1) * (0.42 + rand() * 0.35);
      const fDirX = Math.cos(forkAng);
      const fDirZ = Math.sin(forkAng);
      const fPts: THREE.Vector3[] = [forkStart.clone()];
      for (let s = 1; s <= 3; s++) {
        const d = s * 1.9;
        const fx = forkStart.x + fDirX * d;
        const fz = forkStart.z + fDirZ * d;
        const gh = getTerrainHeight(TREE_CENTER.x + fx, TREE_CENTER.y + fz) - treeBase.y;
        fPts.push(new THREE.Vector3(fx, s === 3 ? gh - 0.55 : gh + 0.15, fz));
      }
      appendFlutedTube(
        builder,
        new THREE.CatmullRomCurve3(fPts),
        10,
        7,
        rStart * 0.46,
        0.1,
        3,
        0.12,
        1.0,
        2.0,
        isScarredSide ? 0.25 : 0.88,
        isScarredSide ? 0.4 : 0.1
      );
    }
  }

  // 3. MONUMENTAL PRIMARY BOUGHS + SECONDARY & TERTIARY LIMBS
  // Carefully sculpted crown architecture: 7 grand sweeping boughs + central towering leader
  interface BoughSpec {
    angle: number;
    startT: number;
    spread: number;
    rise: number;
    radius: number;
    vitality: number; // < 0.35 = weathered gnarled bough on scarred side
  }

  const primarySpecs: BoughSpec[] = [
    // Sweeping sunlit eastern bough reaching gracefully toward the river
    { angle: 0.15, startT: 0.78, spread: 14.5, rise: 7.5, radius: 1.05, vitality: 1.0 },
    // Northeast bough framing the waterfall
    { angle: -0.78, startT: 0.84, spread: 13.8, rise: 9.8, radius: 0.98, vitality: 1.0 },
    // North high bough
    { angle: -1.68, startT: 0.92, spread: 12.2, rise: 11.4, radius: 0.92, vitality: 0.96 },
    // Southeast lush bough
    { angle: 1.15, startT: 0.82, spread: 13.6, rise: 8.2, radius: 0.96, vitality: 1.0 },
    // South sweeping bough
    { angle: 2.08, startT: 0.86, spread: 12.5, rise: 9.0, radius: 0.88, vitality: 0.86 },
    // Northwest resilient upper bough arching over the divide
    { angle: -2.42, startT: 0.90, spread: 13.2, rise: 10.6, radius: 0.92, vitality: 0.82 },
    // Lower weathered western bough reaching out over the scarred basin (emotional storytelling!)
    { angle: 2.95, startT: 0.70, spread: 12.8, rise: 3.4, radius: 0.76, vitality: 0.22 },
    // Towering central crown leader giving regal vertical stature (~28.5m total height!)
    { angle: 0.4, startT: 0.98, spread: 4.5, rise: 14.2, radius: 1.12, vitality: 1.0 },
  ];

  for (let b = 0; b < primarySpecs.length; b++) {
    const spec = primarySpecs[b];
    const origin = trunkCurve.getPoint(spec.startT);
    const dx = Math.cos(spec.angle);
    const dz = Math.sin(spec.angle);
    const perpX = -dz;
    const perpZ = dx;

    const bend = (rand() - 0.5) * 3.0;
    // Start centered inside the trunk core so every primary bough merges seamlessly without collar seams
    const p0 = new THREE.Vector3(origin.x * 0.45, origin.y - 0.4, origin.z * 0.45);
    const p1 = origin
      .clone()
      .add(new THREE.Vector3(dx * spec.spread * 0.30 + perpX * bend * 0.35, spec.rise * 0.42, dz * spec.spread * 0.30 + perpZ * bend * 0.35));
    const p2 = origin
      .clone()
      .add(new THREE.Vector3(dx * spec.spread * 0.72 + perpX * bend, spec.rise * 0.84, dz * spec.spread * 0.72 + perpZ * bend));
    const p3 = origin
      .clone()
      .add(new THREE.Vector3(dx * spec.spread + perpX * bend * 0.6, spec.rise + (rand() - 0.3) * 1.8, dz * spec.spread + perpZ * bend * 0.6));

    const bCurve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    appendFlutedTube(
      builder,
      bCurve,
      20,
      14,
      spec.radius * 0.94,
      spec.radius * 0.24,
      5,
      0.12,
      1.6,
      3.8,
      spec.vitality * 0.75,
      1 - spec.vitality * 0.85
    );

    // Add hanging moss anchor points along lower sunlit boughs
    if (spec.vitality > 0.6 && b !== 7) {
      for (const mt of [0.38, 0.56, 0.74]) {
        const mp = bCurve.getPoint(mt);
        mossAnchors.push({
          pos: new THREE.Vector3(mp.x, mp.y - 0.35, mp.z),
          length: 2.2 + rand() * 3.0,
        });
      }
    }

    // Secondary branches splitting off each primary bough
    const secCount = b === 7 ? 6 : 5;
    for (let s = 0; s < secCount; s++) {
      const st = lerp(0.32, 0.94, s / (secCount - 1));
      const sOrigin = bCurve.getPoint(st);
      const bTan = bCurve.getTangent(st);

      const side = s % 2 === 0 ? 1 : -1;
      const yaw = spec.angle + side * (0.45 + rand() * 0.65) + (b === 7 ? (s / secCount) * Math.PI * 2 : 0);
      const sLen = (4.6 + rand() * 4.4) * (1 - st * 0.28);
      const sRise = (1.6 + rand() * 3.8) * (spec.vitality > 0.4 ? 1 : 0.45);
      const sdx = Math.cos(yaw);
      const sdz = Math.sin(yaw);

      const sp1 = sOrigin
        .clone()
        .add(new THREE.Vector3(sdx * sLen * 0.48 + bTan.x * 0.8, sRise * 0.62, sdz * sLen * 0.48 + bTan.z * 0.8));
      const sp2 = sOrigin.clone().add(new THREE.Vector3(sdx * sLen, sRise, sdz * sLen));

      const sCurve = new THREE.CatmullRomCurve3([sOrigin, sp1, sp2]);
      const sRad = spec.radius * lerp(0.42, 0.22, st);
      appendFlutedTube(
        builder,
        sCurve,
        9,
        7,
        sRad,
        sRad * 0.25,
        3,
        0.08,
        0.8,
        2.2,
        spec.vitality * 0.55,
        1 - spec.vitality * 0.8
      );

      // Register leaf tips along secondary limbs & tertiary twigs
      if (spec.vitality > 0.35 || s === secCount - 1) {
        const localVit = spec.vitality > 0.35 ? spec.vitality : 0.65; // Even the weathered bough has one resilient sprouting shoot!
        leafTips.push({
          pos: sp2.clone(),
          dir: new THREE.Vector3(sdx, 0.45, sdz).normalize(),
          vitality: localVit,
          scale: spec.vitality > 0.35 ? 1.0 + rand() * 0.45 : 0.68,
        });
        leafTips.push({
          pos: sp1.clone().add(new THREE.Vector3(0, 0.65, 0)),
          dir: new THREE.Vector3(sdx, 0.6, sdz).normalize(),
          vitality: localVit,
          scale: 0.85 + rand() * 0.35,
        });
      }

      // Tertiary gnarled twigs
      const twigCount = 3;
      for (let tw = 0; tw < twigCount; tw++) {
        const twT = lerp(0.45, 0.96, tw / (twigCount - 1));
        const twOrigin = sCurve.getPoint(twT);
        const twYaw = yaw + (tw - 1) * 0.72 + (rand() - 0.5) * 0.4;
        const twLen = 2.0 + rand() * 2.4;
        const twEnd = twOrigin
          .clone()
          .add(new THREE.Vector3(Math.cos(twYaw) * twLen, 0.8 + rand() * 2.1, Math.sin(twYaw) * twLen));
        const twMid = twOrigin.clone().lerp(twEnd, 0.5).add(new THREE.Vector3(0, 0.45, 0));
        appendFlutedTube(
          builder,
          new THREE.CatmullRomCurve3([twOrigin, twMid, twEnd]),
          5,
          5,
          sRad * 0.38,
          0.045,
          2,
          0.05,
          0.4,
          1.2,
          spec.vitality * 0.3,
          1 - spec.vitality * 0.75
        );

        if (spec.vitality > 0.35) {
          leafTips.push({
            pos: twEnd,
            dir: twEnd.clone().sub(twOrigin).normalize(),
            vitality: spec.vitality,
            scale: 0.9 + rand() * 0.48,
          });
        }
      }
    }

    // Primary bough tip leaf cloud
    if (spec.vitality > 0.35) {
      leafTips.push({
        pos: p3.clone(),
        dir: new THREE.Vector3(dx, 0.4, dz).normalize(),
        vitality: spec.vitality,
        scale: 1.25,
      });
    }
  }

  // Assemble unified trunk/root/branch geometry
  const woodGeo = new THREE.BufferGeometry();
  woodGeo.setAttribute('position', new THREE.Float32BufferAttribute(builder.positions, 3));
  woodGeo.setAttribute('normal', new THREE.Float32BufferAttribute(builder.normals, 3));
  woodGeo.setAttribute('uv', new THREE.Float32BufferAttribute(builder.uvs, 2));
  woodGeo.setAttribute('color', new THREE.Float32BufferAttribute(builder.colors, 3));
  woodGeo.setIndex(builder.indices);
  woodGeo.computeVertexNormals();

  const barkMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    normalMap: textures.barkNormal,
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughness: 0.9,
    metalness: 0.02,
    vertexColors: false,
  });

  barkMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying vec3 vBarkData;\nvarying vec3 vWorldPos;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vBarkData = color;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBarkData;\nvarying vec3 vWorldPos;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // vBarkData: r = moss coverage, g = silver weathering on scarred side, b = furrow AO
        float moss = smoothstep(0.28, 0.78, vBarkData.r) * smoothstep(22.0, 4.0, vWorldPos.y);
        vec3 mossCol = vec3(0.11, 0.24, 0.08);
        vec3 silverWood = vec3(0.42, 0.40, 0.37);
        diffuseColor.rgb = mix(diffuseColor.rgb, silverWood, vBarkData.g * 0.42);
        diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, moss * 0.62);
        diffuseColor.rgb *= vBarkData.b;`
      );
  };

  const woodMesh = new THREE.Mesh(woodGeo, barkMat);
  woodMesh.position.copy(treeBase);
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;
  group.add(woodMesh);

  // 4. LUSH INDIVIDUALLY-LEAFED CANOPY (Instanced crossed botanical leaf spray cards with wind, volumetric AO & sun translucency!)
  const cardGeo = createCrossedLeafCardGeometry();
  const clustersPerTip = 6;
  const totalCards = leafTips.length * clustersPerTip;

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIRECTION.clone() },
  };

  const leafMat = new THREE.MeshStandardMaterial({
    map: textures.ancientLeafMap,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 0.74,
    metalness: 0.0,
  });

  leafMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vLeafWorldPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 instW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        // Rolling wind gusts + delicate individual leaf-cluster flutter
        float windPhase = uTime * 1.35 + instW.x * 0.14 + instW.z * 0.11;
        float gust = sin(windPhase) * 0.65 + sin(windPhase * 2.3 + instW.y * 0.25) * 0.35;
        float swayAmt = (0.14 + smoothstep(10.0, 28.0, instW.y) * 0.24) * (uv.y * 0.65 + 0.35);
        transformed.x += gust * swayAmt;
        transformed.z += cos(windPhase * 0.9 + instW.x * 0.18) * swayAmt * 0.65;
        transformed.y += sin(windPhase * 1.9) * swayAmt * 0.22;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vLeafWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        varying vec3 vLeafWorldPos;`
      )
      .replace(
        '#include <dithering_fragment>',
        `// Volumetric crown shading & warm emerald-gold sun translucency (rich luminous depth from every angle!)
        vec3 viewToLeaf = normalize(vLeafWorldPos - cameraPosition);
        float sunBack = pow(clamp(dot(viewToLeaf, uSunDir), 0.0, 1.0), 2.8);
        float crownHeight = smoothstep(13.0, 31.0, vLeafWorldPos.y);
        float sunSide = clamp(dot(normalize(vLeafWorldPos - vec3(0.0, 20.0, 0.0)), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor.rgb *= mix(0.84, 1.24, clamp(crownHeight * 0.62 + sunSide * 0.38, 0.0, 1.0));
        vec3 sssTint = vec3(0.42, 0.52, 0.14) * (0.35 + 0.65 * crownHeight);
        gl_FragColor.rgb += sssTint * (sunBack * 0.45 + sunSide * crownHeight * 0.12);
        #include <dithering_fragment>`
      );
  };

  const canopyMesh = new THREE.InstancedMesh(cardGeo, leafMat, totalCards);
  canopyMesh.position.copy(treeBase);
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  // Bright calibrated multipliers (since ancientLeafMap already holds deep botanical green pigments!)
  const colDeep = new THREE.Color('#5a8c4e');     // cool lush emerald canopy heart
  const colMid = new THREE.Color('#8ec264');      // vibrant sunlit forest green
  const colSunlit = new THREE.Color('#cde076');   // warm sunlit meadow-emerald upper crown
  const colWarmTip = new THREE.Color('#f4d276');  // golden-hour rim tips

  let idx = 0;
  for (let i = 0; i < leafTips.length; i++) {
    const tip = leafTips[i];
    for (let c = 0; c < clustersPerTip; c++) {
      const a1 = rand() * Math.PI * 2;
      const a2 = (rand() - 0.38) * Math.PI * 0.68;
      const rad = (0.75 + Math.pow(rand(), 0.72) * 2.75) * tip.scale;
      const ox = Math.cos(a1) * Math.cos(a2) * rad;
      const oy = Math.sin(a2) * rad * 0.66 + 0.4;
      const oz = Math.sin(a1) * Math.cos(a2) * rad;

      dummy.position.set(tip.pos.x + ox, tip.pos.y + oy, tip.pos.z + oz);
      dummy.rotation.set(
        (rand() - 0.5) * 0.85,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.85
      );
      const s = (2.05 + rand() * 1.45) * tip.scale;
      dummy.scale.set(s, s * (0.84 + rand() * 0.24), s);
      dummy.updateMatrix();
      canopyMesh.setMatrixAt(idx, dummy.matrix);

      // Rich sculptural volumetric crown shading: emerald shaded heart -> radiant sunlit outer/upper boughs
      const heightNorm = clamp((dummy.position.y - 11) / 17.5, 0, 1);
      const sunFacing = clamp((dummy.position.x * 0.72 + dummy.position.z * 0.32) / 16 + 0.5, 0, 1);
      const radialOut = clamp(Math.hypot(dummy.position.x, dummy.position.z) / 15.5, 0, 1);
      const localCrownAO = clamp(0.66 + heightNorm * 0.26 + radialOut * 0.20 + (oy > 0.2 ? 0.12 : -0.08), 0.58, 1.18);

      color.copy(colDeep).lerp(colMid, clamp(heightNorm * 0.55 + radialOut * 0.45, 0, 1));
      color.lerp(colSunlit, clamp(heightNorm * 0.65 + sunFacing * 0.35, 0, 1) * 0.78);
      if (heightNorm > 0.52 && sunFacing > 0.45 && rand() > 0.48) {
        color.lerp(colWarmTip, 0.28 + rand() * 0.34);
      }
      color.multiplyScalar(localCrownAO * (0.88 + rand() * 0.24));
      canopyMesh.setColorAt(idx, color);
      idx++;
    }
  }
  canopyMesh.instanceMatrix.needsUpdate = true;
  if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
  group.add(canopyMesh);

  // 5. HANGING WOODLAND MOSS / VINE TENDRILS swaying softly from the monumental lower boughs
  const mossMesh = createHangingMoss(mossAnchors, treeBase, uniforms.uTime);
  group.add(mossMesh);

  return {
    group,
    uniforms: {
      uTime: uniforms.uTime,
    },
    canopyBounds: {
      center: new THREE.Vector3(TREE_CENTER.x, baseGroundY + 18.5, TREE_CENTER.y),
      radius: 17.5,
    },
  };
}

// 3 intersecting angled planes per cluster so it looks genuinely volumetric from EVERY camera angle (including looking straight up from beneath!)
function createCrossedLeafCardGeometry(): THREE.BufferGeometry {
  const planes: THREE.PlaneGeometry[] = [];
  const p1 = new THREE.PlaneGeometry(1.5, 1.5);
  const p2 = new THREE.PlaneGeometry(1.5, 1.5);
  p2.rotateY(Math.PI / 3);
  p2.rotateZ(0.22);
  const p3 = new THREE.PlaneGeometry(1.5, 1.5);
  p3.rotateY((Math.PI * 2) / 3);
  p3.rotateX(-0.24);
  planes.push(p1, p2, p3);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const g of planes) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      // Spherical-biased normals so foliage catches soft sunlight without harsh flat-plane edges!
      const nx = pos.getX(i);
      const ny = pos.getY(i) + 0.55;
      const nz = pos.getZ(i);
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / len, ny / len, nz / len);
      uvs.push(uv.getX(i), uv.getY(i));
    }
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) {
      indices.push(idx.getX(i) + offset);
    }
    offset += pos.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  return out;
}

function createHangingMoss(
  anchors: MossAnchor[],
  treeBase: THREE.Vector3,
  uTime: { value: number }
): THREE.Mesh {
  const rand = mulberry32(8192);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vOff = 0;

  for (const a of anchors) {
    const strands = 3;
    for (let s = 0; s < strands; s++) {
      const ox = (rand() - 0.5) * 1.1;
      const oz = (rand() - 0.5) * 1.1;
      const len = a.length * (0.65 + rand() * 0.55);
      const wid = 0.14 + rand() * 0.1;
      const yaw = rand() * Math.PI;
      const cx = Math.cos(yaw) * wid;
      const cz = Math.sin(yaw) * wid;
      const segs = 6;

      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const taper = (1 - t * 0.72) * (0.7 + 0.3 * Math.sin(t * Math.PI * 3));
        const y = a.pos.y - t * len;
        positions.push(a.pos.x + ox - cx * taper, y, a.pos.z + oz - cz * taper);
        positions.push(a.pos.x + ox + cx * taper, y, a.pos.z + oz + cz * taper);
        uvs.push(0, t, 1, t);
      }

      for (let i = 0; i < segs; i++) {
        const r0 = vOff + i * 2;
        const r1 = r0 + 2;
        indices.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
      }
      vOff += (segs + 1) * 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uSunDir: { value: SUN_DIRECTION.clone() },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec3 p = position;
        float sway = uv.y * uv.y;
        p.x += sin(uTime * 1.2 + position.x * 0.5 + position.z * 0.4) * 0.42 * sway;
        p.z += cos(uTime * 0.95 + position.z * 0.6) * 0.28 * sway;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float wisp = sin(vUv.y * 28.0 + vWorldPos.x * 4.0) * 0.25 + 0.75;
        float alpha = smoothstep(0.08, 0.55, edge * wisp) * (1.0 - smoothstep(0.75, 1.0, vUv.y)) * 0.72;
        if (alpha < 0.05) discard;
        vec3 col = mix(vec3(0.24, 0.34, 0.17), vec3(0.42, 0.52, 0.24), vUv.y * 0.5 + 0.3);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(treeBase);
  return mesh;
}
