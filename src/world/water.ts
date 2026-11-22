import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from './noise';
import {
  getTerrainHeight,
  LIVING_RIVER_SAMPLES,
  PLUNGE_POOL_CENTER,
  RiverSample,
  SUN_DIRECTION,
  UPPER_STREAM_SAMPLES,
  WATERFALL_BOTTOM,
  WATERFALL_TOP,
} from './terrainData';
import { WorldTextures } from './textures';

export interface WaterSystem {
  group: THREE.Group;
  update: (time: number, dt: number, camera: THREE.Camera) => void;
}

function buildRiverRibbonGeometry(samples: RiverSample[], extraHalfWidth: number, crossSegs = 14): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const depths: number[] = [];
  const flowSpeeds: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Perpendicular vector in XZ plane
    const nx = -s.tz;
    const nz = s.tx;
    const halfW = s.width + extraHalfWidth;

    for (let j = 0; j <= crossSegs; j++) {
      const u = j / crossSegs;
      const offset = (u * 2 - 1) * halfW;
      const wx = s.x + nx * offset;
      const wz = s.z + nz * offset;
      const bedY = getTerrainHeight(wx, wz);
      const depth = Math.max(0, s.waterY - bedY);

      positions.push(wx, s.waterY, wz);
      uvs.push(u, s.s * 0.085);
      depths.push(depth);
      // Faster flow in center and narrower reaches
      const centerFactor = 1 - Math.pow(Math.abs(u * 2 - 1), 2);
      flowSpeeds.push(0.55 + centerFactor * 0.55);
    }
  }

  const stride = crossSegs + 1;
  for (let i = 0; i < samples.length - 1; i++) {
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
  geo.setAttribute('aFlowSpeed', new THREE.Float32BufferAttribute(flowSpeeds, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildPlungePoolGeometry(): THREE.BufferGeometry {
  const radSegs = 40;
  const ringSegs = 12;
  const radius = 16.5;
  const waterY = 2.45;
  const positions: number[] = [];
  const uvs: number[] = [];
  const depths: number[] = [];
  const flowSpeeds: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= ringSegs; r++) {
    const rf = r / ringSegs;
    const rad = rf * radius;
    for (let a = 0; a <= radSegs; a++) {
      const af = a / radSegs;
      const theta = af * Math.PI * 2;
      const wx = PLUNGE_POOL_CENTER.x + Math.cos(theta) * rad;
      const wz = PLUNGE_POOL_CENTER.y + Math.sin(theta) * rad;
      const bedY = getTerrainHeight(wx, wz);
      const depth = Math.max(0, waterY - bedY);

      positions.push(wx, waterY, wz);
      uvs.push(wx * 0.08, wz * 0.08);
      depths.push(depth);
      flowSpeeds.push(0.35);
    }
  }

  const stride = radSegs + 1;
  for (let r = 0; r < ringSegs; r++) {
    for (let a = 0; a < radSegs; a++) {
      const i0 = r * stride + a;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
  geo.setAttribute('aFlowSpeed', new THREE.Float32BufferAttribute(flowSpeeds, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildWaterfallCurtain(
  widthTop: number,
  widthBottom: number,
  forwardOffset: number,
  archBoost: number,
  centerOffsetX = 0
): THREE.BufferGeometry {
  const segsU = 22;
  const segsV = 34;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV; // 0 = top lip (47.2m), 1 = plunge pool splash (2.45m)
    // Monumental 45m parabolic free-fall trajectory arching powerfully off the columnar basalt cliff!
    const y = lerp(WATERFALL_TOP.y + 0.25, WATERFALL_BOTTOM.y - 0.85, Math.pow(v, 1.56));
    const zBase = lerp(WATERFALL_TOP.z - 0.5, WATERFALL_BOTTOM.z + 1.1, Math.pow(v, 0.56));
    const ledgeKick =
      Math.sin(v * Math.PI) * (archBoost + 1.85) +
      Math.exp(-Math.pow((v - 0.36) / 0.14, 2)) * 0.85 +
      Math.exp(-Math.pow((v - 0.68) / 0.14, 2)) * 0.55;
    const z = zBase + forwardOffset + ledgeKick;
    const halfW = lerp(widthTop, widthBottom, v) * 0.5;
    const cx = lerp(WATERFALL_TOP.x, WATERFALL_BOTTOM.x, v) + centerOffsetX;

    for (let iu = 0; iu <= segsU; iu++) {
      const u = iu / segsU;
      const spread = (u * 2 - 1) * halfW;
      const curveZ = -Math.pow(u * 2 - 1, 2) * 1.15;
      positions.push(cx + spread, y, z + curveZ);
      uvs.push(u, v);
    }
  }

  const stride = segsU + 1;
  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Sculpted Columnar Basalt Cliff Architecture flanking the monumental 47m waterfall (inspired by waterfall.jpg!)
function buildColumnarBasaltCliff(textures: WorldTextures): THREE.Group {
  const cliffGroup = new THREE.Group();
  cliffGroup.name = 'WaterfallBasaltCliff';
  const rand = mulberry32(47472026);

  // Hexagonal-faceted weathered basalt column geometry
  const colGeo = new THREE.CylinderGeometry(1.0, 1.12, 1.0, 6, 4);
  colGeo.translate(0, 0.5, 0);
  const cPos = colGeo.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i);
    const y = cPos.getY(i);
    const z = cPos.getZ(i);
    const step = Math.sin(y * 16.0) * 0.05;
    cPos.setXYZ(i, x * (1 + step), y, z * (1 + step));
  }
  colGeo.computeVertexNormals();

  const basaltMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    normalScale: new THREE.Vector2(1.5, 1.5),
    color: new THREE.Color('#8e857a'),
    roughness: 0.88,
    metalness: 0.04,
  });

  // Inject mossy damp cliff-top & sunlit vertical basalt strata shading
  basaltMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vColWPos;\nvarying vec3 vColWNorm;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 cwp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vColWPos = cwp.xyz;
        vColWNorm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vColWPos;\nvarying vec3 vColWNorm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Rugged warm-granite & weathered dark-basalt vertical columns with lush emerald moss on flat tops & damp ledges (waterfall.jpg!)
        float wetBase = 1.0 - smoothstep(3.0, 14.0, vColWPos.y);
        float topMoss = smoothstep(0.68, 0.90, vColWNorm.y);
        float verticalStreaks = smoothstep(0.45, 0.82, sin(vColWPos.x * 1.4 + vColWPos.y * 0.25) * 0.5 + 0.5);
        vec3 rockTint = mix(vec3(0.48, 0.46, 0.44), vec3(0.92, 0.84, 0.74), smoothstep(4.0, 44.0, vColWPos.y));
        diffuseColor.rgb *= rockTint * (0.82 + 0.24 * verticalStreaks);
        diffuseColor.rgb *= mix(1.0, 0.64, wetBase * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.24, 0.08), clamp(topMoss * 0.86 + wetBase * 0.18 * (1.0 - topMoss), 0.0, 0.86));`
      );
  };

  const columnMatrices: THREE.Matrix4[] = [];
  const columnColors: THREE.Color[] = [];
  const dummy = new THREE.Object3D();

  // Left & Right sheer columnar basalt escarpments framing the roaring 47m torrent!
  const addCliffWallSide = (xStart: number, xEnd: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      const f = i / Math.max(1, steps - 1);
      const baseX = lerp(xStart, xEnd, f);
      // 3 tiered column depths (front jagged buttress -> mid column -> rear escarpment lip)
      for (let tier = 0; tier < 3; tier++) {
        const x = baseX + (rand() - 0.5) * 2.4;
        const z = -47.2 - tier * 2.2 + (rand() - 0.5) * 2.6 + Math.abs(x - 24.5) * 0.08;
        const distFromFalls = Math.abs(x - 24.5);
        const crestH = lerp(47.2, 41.5, clamp((distFromFalls - 6) / 22, 0, 1));
        const h = tier === 0
          ? crestH * (0.45 + rand() * 0.48)
          : crestH * (0.86 + rand() * 0.16);
        const r = 1.65 + rand() * 1.95;

        dummy.position.set(x, 0.5, z);
        dummy.rotation.set((rand() - 0.5) * 0.05, rand() * Math.PI, (rand() - 0.5) * 0.05);
        dummy.scale.set(r, h, r * (0.85 + rand() * 0.35));
        dummy.updateMatrix();
        columnMatrices.push(dummy.matrix.clone());

        const tone = 0.78 + rand() * 0.34;
        columnColors.push(new THREE.Color(tone, tone * 0.98, tone * 0.95));
      }
    }
  };

  // Left basalt cliff face (x = 3..18.5) & Right basalt cliff face (x = 30.5..46)
  addCliffWallSide(4.0, 18.2, 11);
  addCliffWallSide(30.8, 46.0, 11);

  // Submerged & wet basalt backing rock behind the falling water curtain + mid-height cascade ledge
  for (let i = 0; i < 10; i++) {
    const x = lerp(18.5, 30.5, i / 9) + (rand() - 0.5) * 1.2;
    const h = i % 3 === 1 ? 26 + rand() * 10 : 42 + rand() * 4.5;
    dummy.position.set(x, 0.5, -50.8 + (rand() - 0.5) * 1.5);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.set(2.2 + rand() * 1.2, h, 2.4);
    dummy.updateMatrix();
    columnMatrices.push(dummy.matrix.clone());
    columnColors.push(new THREE.Color(0.55, 0.58, 0.62));
  }

  const colMesh = new THREE.InstancedMesh(colGeo, basaltMat, columnMatrices.length);
  colMesh.castShadow = true;
  colMesh.receiveShadow = true;
  for (let i = 0; i < columnMatrices.length; i++) {
    colMesh.setMatrixAt(i, columnMatrices[i]);
    colMesh.setColorAt(i, columnColors[i]);
  }
  colMesh.instanceMatrix.needsUpdate = true;
  if (colMesh.instanceColor) colMesh.instanceColor.needsUpdate = true;
  cliffGroup.add(colMesh);

  // Clinging mossy cliff-face foliage bushes & hanging greenery along basalt ledges (waterfall.jpg!)
  const bushGeo = new THREE.PlaneGeometry(3.2, 2.8);
  const bushMat = new THREE.MeshStandardMaterial({
    map: textures.broadleafMap,
    alphaTest: 0.36,
    side: THREE.DoubleSide,
    roughness: 0.78,
  });
  const bushMats: THREE.Matrix4[] = [];
  const bushCols: THREE.Color[] = [];
  for (let i = 0; i < 48; i++) {
    const isLeft = i % 2 === 0;
    const x = isLeft ? 7 + rand() * 11.5 : 30.5 + rand() * 12.5;
    const y = 6 + rand() * 39;
    const z = -44.2 - rand() * 3.8;
    const s = 0.7 + rand() * 1.15;
    dummy.position.set(x, y, z);
    dummy.rotation.set((rand() - 0.5) * 0.4, (rand() - 0.5) * 0.9, (rand() - 0.5) * 0.4);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    bushMats.push(dummy.matrix.clone());
    bushCols.push(new THREE.Color().setHSL(0.28 + (rand() - 0.5) * 0.05, 0.45, 0.34 + rand() * 0.14));
  }
  const cliffFoliage = new THREE.InstancedMesh(bushGeo, bushMat, bushMats.length);
  for (let i = 0; i < bushMats.length; i++) {
    cliffFoliage.setMatrixAt(i, bushMats[i]);
    cliffFoliage.setColorAt(i, bushCols[i]);
  }
  cliffFoliage.instanceMatrix.needsUpdate = true;
  if (cliffFoliage.instanceColor) cliffFoliage.instanceColor.needsUpdate = true;
  cliffGroup.add(cliffFoliage);

  return cliffGroup;
}

export function createWaterSystem(textures: WorldTextures): WaterSystem {
  const group = new THREE.Group();
  group.name = 'WaterSystem';

  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIRECTION.clone() },
    uImpactPos: { value: new THREE.Vector3(WATERFALL_BOTTOM.x, WATERFALL_BOTTOM.y, WATERFALL_BOTTOM.z) },
    uFogColor: { value: new THREE.Color('#788794') },
    uFogDensity: { value: 0.0026 },
  };

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      attribute float aDepth;
      attribute float aFlowSpeed;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vDepth;
      varying float vFlowSpeed;

      void main() {
        vUv = uv;
        vDepth = aDepth;
        vFlowSpeed = aFlowSpeed;
        vec3 pos = position;
        // Subtle live surface ripple height displacement
        float wave = sin(pos.x * 0.9 + uTime * 2.1) * cos(pos.z * 0.85 - uTime * 1.8) * 0.035;
        pos.y += wave * clamp(aDepth, 0.0, 1.0);
        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uImpactPos;
      uniform vec3 uFogColor;
      uniform float uFogDensity;

      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vDepth;
      varying float vFlowSpeed;

      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.5);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p = p * 2.05 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        if (vDepth < 0.015) discard;

        // Flow-advected multi-layer wave normal
        vec2 flowCoord1 = vec2(vUv.x * 3.8, vUv.y * 2.8 - uTime * 0.52 * vFlowSpeed);
        vec2 flowCoord2 = vec2(vWorldPos.x * 0.32 + uTime * 0.14, vWorldPos.z * 0.32 - uTime * 0.34);

        float e = 0.06;
        float h0 = fbm(flowCoord1) * 0.6 + fbm(flowCoord2) * 0.4;
        float hx = fbm(flowCoord1 + vec2(e, 0.0)) * 0.6 + fbm(flowCoord2 + vec2(e, 0.0)) * 0.4;
        float hz = fbm(flowCoord1 + vec2(0.0, e)) * 0.6 + fbm(flowCoord2 + vec2(0.0, e)) * 0.4;

        // Concentric ripples radiating outward from the waterfall plunge impact!
        float impactDist = length(vWorldPos.xz - uImpactPos.xz);
        float impactRing = sin(impactDist * 2.2 - uTime * 5.2) * exp(-impactDist * 0.11);

        vec3 N = normalize(vec3((h0 - hx) * 1.85 + impactRing * 0.14, 1.0, (h0 - hz) * 1.85 + impactRing * 0.14));
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 R = reflect(-V, N);

        // Fresnel term (restrained so water stays rich emerald-teal instead of blowing out milky-white)
        float NoV = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = 0.04 + 0.68 * pow(1.0 - NoV, 3.6);

        // Rich depth-absorbed natural mountain-river colors (translucent jade shallows -> deep glacier teal)
        vec3 shallowCol = vec3(0.08, 0.25, 0.21);
        vec3 deepCol = vec3(0.02, 0.09, 0.13);
        float depthT = smoothstep(0.08, 2.2, vDepth);
        vec3 waterBody = mix(shallowCol, deepCol, depthT);

        // Reflected atmospheric sky & surrounding emerald forest banks
        float skyH = clamp(R.y, 0.0, 1.0);
        vec3 skyZenith = vec3(0.14, 0.25, 0.36);
        vec3 skyHorizon = vec3(0.46, 0.48, 0.46);
        vec3 forestRefl = vec3(0.10, 0.18, 0.12);
        vec3 reflCol = mix(skyHorizon, skyZenith, pow(skyH, 0.7));
        // Subtle bank-tree reflections near river edges
        float bankProximity = abs(vUv.x * 2.0 - 1.0);
        reflCol = mix(reflCol, forestRefl, smoothstep(0.45, 0.95, bankProximity) * 0.45);
        float sunGlow = pow(clamp(dot(R, uSunDir), 0.0, 1.0), 12.0);
        reflCol += vec3(0.85, 0.62, 0.34) * sunGlow * 0.42;

        // Crisp, sparkling sun specular highlights dancing tightly on moving wave crests
        vec3 H = normalize(uSunDir + V);
        float spec = pow(clamp(dot(N, H), 0.0, 1.0), 260.0);
        float specBroad = pow(clamp(dot(N, H), 0.0, 1.0), 36.0);

        vec3 col = mix(waterBody, reflCol, clamp(fresnel * 0.72 + 0.06, 0.0, 0.78));
        col += vec3(1.0, 0.86, 0.62) * (spec * 1.45 + specBroad * 0.10);

        // Shoreline foam + waterfall plunge whitewater churn
        float foamNoise = fbm(flowCoord1 * 2.4 + vec2(0.0, -uTime * 0.35));
        float shoreFoam = (1.0 - smoothstep(0.04, 0.42, vDepth)) * smoothstep(0.46, 0.72, foamNoise);
        float impactFoam = exp(-impactDist * 0.16) * (0.48 + 0.52 * smoothstep(0.32, 0.68, foamNoise + impactRing * 0.35));
        float rapidsFoam = smoothstep(0.72, 0.86, foamNoise) * smoothstep(0.45, 1.2, vFlowSpeed) * 0.22;
        float foam = clamp(shoreFoam * 0.72 + impactFoam * 1.05 + rapidsFoam, 0.0, 0.92);

        vec3 foamColor = vec3(0.78, 0.83, 0.84) * (0.76 + 0.24 * clamp(dot(N, uSunDir), 0.0, 1.0));
        col = mix(col, foamColor, foam);

        // Smooth shoreline edge transparency so water feathers organically into mossy wet banks
        float alpha = clamp(smoothstep(0.015, 0.32, vDepth) * 0.92 + foam * 0.45, 0.0, 0.96);

        // Atmospheric distance fog
        float dist = length(cameraPosition - vWorldPos);
        float fogFactor = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  // Living valley river mesh
  const riverMesh = new THREE.Mesh(buildRiverRibbonGeometry(LIVING_RIVER_SAMPLES, 3.2, 16), waterMat);
  riverMesh.renderOrder = 2;
  group.add(riverMesh);

  // Emerald plunge pool mesh
  const poolMesh = new THREE.Mesh(buildPlungePoolGeometry(), waterMat);
  poolMesh.renderOrder = 2;
  group.add(poolMesh);

  // Upper alpine stream feeding the waterfall lip (tucked cleanly inside the carved cliff notch)
  const upperMesh = new THREE.Mesh(buildRiverRibbonGeometry(UPPER_STREAM_SAMPLES, 0.35, 10), waterMat);
  upperMesh.renderOrder = 2;
  group.add(upperMesh);

  // MULTI-LAYERED CASCADING WATERFALL
  const wfUniforms = {
    uTime: waterUniforms.uTime,
    uSunDir: waterUniforms.uSunDir,
  };

  const waterfallMat = new THREE.ShaderMaterial({
    uniforms: wfUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec3 p = position;
        float flutter = sin(uv.y * 12.0 - uTime * 9.5 + uv.x * 8.0) * 0.14 * sin(uv.y * 3.14159);
        p.z += flutter;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
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
        // Multi-speed vertical cascading frothy streaks
        float s1 = vnoise(vec2(vUv.x * 13.0, vUv.y * 6.5 - uTime * 3.4));
        float s2 = vnoise(vec2(vUv.x * 26.0 + 3.1, vUv.y * 14.0 - uTime * 5.6));
        float s3 = vnoise(vec2(vUv.x * 7.0 - 1.5, vUv.y * 3.0 - uTime * 2.1));
        float streaks = s1 * 0.45 + s2 * 0.35 + s3 * 0.2;

        // Soft feathered horizontal edges (organic uneven waterfall curtain width)
        float edgeDist = abs(vUv.x * 2.0 - 1.0);
        float edgeMask = 1.0 - smoothstep(0.55 - s3 * 0.25, 0.98, edgeDist);

        // Frothy crest at top lip & intense glowing whitewater spray at plunge base
        float topLip = 1.0 - smoothstep(0.0, 0.16, vUv.y);
        float baseSplash = smoothstep(0.72, 1.0, vUv.y);
        float density = clamp(streaks * 0.95 + topLip * 0.55 + baseSplash * 0.65, 0.0, 1.0);

        float alpha = edgeMask * smoothstep(0.18, 0.72, density) * (1.0 - smoothstep(0.92, 1.0, vUv.y) * 0.45);
        if (alpha < 0.03) discard;

        // Sunlit warm-turquoise water tint -> sparkling white foam highlights
        vec3 waterTint = vec3(0.48, 0.68, 0.72);
        vec3 foamWhite = vec3(0.96, 0.95, 0.92);
        vec3 sunWarm = vec3(1.0, 0.91, 0.76);
        vec3 col = mix(waterTint, foamWhite, smoothstep(0.32, 0.78, density));
        col = mix(col, sunWarm, (baseSplash * 0.35 + topLip * 0.25) * 0.55);

        gl_FragColor = vec4(col, alpha * 0.86);
      }
    `,
  });

  // SCULPTED COLUMNAR BASALT CLIFF ARCHITECTURE FLANKING THE MONUMENTAL FALLS
  group.add(buildColumnarBasaltCliff(textures));

  // 5 STAGGERED MONUMENTAL CASCADING WATERFALL CURTAINS (10.5m -> 16.5m wide, 45m vertical drop!)
  const wfMain = new THREE.Mesh(buildWaterfallCurtain(10.6, 15.2, 0.0, 1.35, 0.0), waterfallMat);
  const wfInner = new THREE.Mesh(buildWaterfallCurtain(7.4, 11.0, -0.75, 0.65, 0.0), waterfallMat);
  const wfVeil = new THREE.Mesh(buildWaterfallCurtain(12.0, 17.5, 1.05, 2.05, 0.0), waterfallMat);
  const wfLeftRibbon = new THREE.Mesh(buildWaterfallCurtain(3.4, 5.2, 0.35, 1.05, -5.2), waterfallMat);
  const wfRightRibbon = new THREE.Mesh(buildWaterfallCurtain(3.2, 5.0, 0.45, 1.20, 5.4), waterfallMat);
  wfMain.renderOrder = 3;
  wfInner.renderOrder = 3;
  wfLeftRibbon.renderOrder = 3;
  wfRightRibbon.renderOrder = 3;
  wfVeil.renderOrder = 4;
  group.add(wfMain, wfInner, wfVeil, wfLeftRibbon, wfRightRibbon);

  // BILLOWING ILLUMINATED WATERFALL MIST PLUMES (52 lush sunlit mist clouds across the wide plunge pool!)
  interface MistPuff {
    sprite: THREE.Sprite;
    phase: number;
    speed: number;
    basePos: THREE.Vector3;
    driftX: number;
    driftZ: number;
    baseScale: number;
  }

  const mistPuffs: MistPuff[] = [];
  const rand = mulberry32(55123);
  const mistCount = 52;
  for (let i = 0; i < mistCount; i++) {
    const isCrest = i >= mistCount - 7;
    const isMidSpray = !isCrest && i >= mistCount - 16;
    const mat = new THREE.SpriteMaterial({
      map: textures.cloudPuffMap,
      color: new THREE.Color().setRGB(0.95, 0.94, 0.90),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const basePos = isCrest
      ? new THREE.Vector3(
          WATERFALL_TOP.x + (rand() - 0.5) * 10.0,
          WATERFALL_TOP.y - 2.0,
          WATERFALL_TOP.z + 1.8
        )
      : isMidSpray
      ? new THREE.Vector3(
          WATERFALL_BOTTOM.x + (rand() - 0.5) * 14.0,
          lerp(12, 26, rand()),
          WATERFALL_BOTTOM.z - 2.5 + rand() * 3.5
        )
      : new THREE.Vector3(
          WATERFALL_BOTTOM.x + (rand() - 0.5) * 19.5,
          WATERFALL_BOTTOM.y + 0.5 + rand() * 2.8,
          WATERFALL_BOTTOM.z + (rand() - 0.25) * 11.5
        );
    sprite.position.copy(basePos);
    sprite.renderOrder = 5;
    group.add(sprite);

    mistPuffs.push({
      sprite,
      phase: rand(),
      speed: 0.065 + rand() * 0.075,
      basePos,
      driftX: (rand() - 0.42) * 6.5,
      driftZ: 2.8 + rand() * 6.5,
      baseScale: isCrest ? 6.0 + rand() * 3.5 : isMidSpray ? 7.5 + rand() * 4.5 : 8.5 + rand() * 8.5,
    });
  }

  return {
    group,
    update(time: number, _dt: number, _camera: THREE.Camera) {
      waterUniforms.uTime.value = time;

      for (let i = 0; i < mistPuffs.length; i++) {
        const m = mistPuffs[i];
        const t = (m.phase + time * m.speed) % 1;
        const fade = Math.sin(t * Math.PI);
        const rise = t * 14.5;
        m.sprite.position.set(
          m.basePos.x + m.driftX * t + Math.sin(time * 0.55 + i) * 1.1,
          m.basePos.y + rise,
          m.basePos.z + m.driftZ * t
        );
        const s = m.baseScale * (0.68 + t * 1.25);
        m.sprite.scale.set(s * 1.32, s * 0.92, 1);
        m.sprite.material.opacity = fade * fade * 0.32;
      }
    },
  };
}
