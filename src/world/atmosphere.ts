import * as THREE from 'three';
import { clamp, lerp, mulberry32, smoothstep } from './noise';
import { SUN_DIRECTION, TREE_CENTER, WATERFALL_BOTTOM } from './terrainData';
import { WorldTextures } from './textures';

export interface AtmosphereSystem {
  group: THREE.Group;
  update: (time: number, camera: THREE.Camera) => void;
}

export function createAtmosphere(textures: WorldTextures): AtmosphereSystem {
  const group = new THREE.Group();
  group.name = 'Atmosphere';

  const uTime = { value: 0 };

  // =========================================================================
  // 1. EMOTIONAL RAYLEIGH/MIE + STORM-DIVIDE SKY DOME
  // =========================================================================
  const skyGeo = new THREE.SphereGeometry(620, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime,
      uSunDir: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vDir;

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
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          s += a * vnoise(p);
          p = p * 2.03 + vec2(3.1, 1.7);
          a *= 0.5;
        }
        return s;
      }

      void main() {
        vec3 d = normalize(vDir);
        float elev = clamp(d.y, -0.15, 1.0);
        float h = clamp(d.y, 0.0, 1.0);

        // Organic noise-warped world-space X-axis Split-Horizon divide aligned along the valley river!
        // Seamless transition: ZERO harsh vertical seam
        float divideWarp = (fbm(d.xz * 2.2 + vec2(1.4, -0.8) + uTime * 0.004) - 0.5) * 0.34;
        float griefSide = smoothstep(0.24, -0.44, d.x - d.z * 0.18 + divideWarp);

        // EASTERN MOTHER NATURE SIDE: Crystalline blue sky, airy mid-blue & clean golden sunlight
        vec3 livingZenith = vec3(0.14, 0.32, 0.56);
        vec3 livingMid = vec3(0.42, 0.60, 0.76);
        vec3 livingHorizon = vec3(0.86, 0.78, 0.64);
        vec3 livingSky = mix(livingHorizon, livingMid, smoothstep(0.0, 0.28, h));
        livingSky = mix(livingSky, livingZenith, smoothstep(0.22, 0.85, h));

        // WESTERN DAMAGED SIDE: Restrained bruised amber, ash-grey & subtle ochre haze
        // Complements the scorched forest, fossils & industrial skyline without turning overly gloomy
        vec3 griefZenith = vec3(0.26, 0.27, 0.30);
        vec3 griefMid = vec3(0.54, 0.41, 0.34);
        vec3 griefHorizon = vec3(0.66, 0.44, 0.35);
        vec3 griefSky = mix(griefHorizon, griefMid, smoothstep(0.0, 0.30, h));
        griefSky = mix(griefSky, griefZenith, smoothstep(0.24, 0.84, h));

        vec3 sky = mix(livingSky, griefSky, griefSide * 0.78);

        // Mie scattering clean golden sun break on the Eastern Mother Nature horizon
        float sunDot = clamp(dot(d, uSunDir), 0.0, 1.0);
        float mieWide = pow(sunDot, 4.0);
        float mieTight = pow(sunDot, 28.0);
        float sunDisc = smoothstep(0.9982, 0.9994, sunDot);
        sky += vec3(0.95, 0.72, 0.40) * mieWide * 0.32 * (1.0 - griefSide * 0.65);
        sky += vec3(1.0, 0.88, 0.64) * mieTight * 0.50;
        sky += vec3(1.35, 1.24, 0.96) * sunDisc;

        // Procedural upper-sky drifting cloud tapestry (bright clean clouds east -> heavy bruised smog decks west)
        if (d.y > 0.01) {
          vec2 skyUV = d.xz / (d.y + 0.16) * 0.85;
          vec2 wind = vec2(uTime * 0.008, uTime * 0.003);
          float cBase = fbm(skyUV + wind);
          float cDetail = fbm(skyUV * 2.3 - wind * 1.4);
          float cloudVal = cBase * 0.68 + cDetail * 0.32;

          float threshold = mix(0.54, 0.30, griefSide);
          float cloudMask = smoothstep(threshold, threshold + 0.34, cloudVal) * smoothstep(0.01, 0.14, d.y);

          vec3 cloudLit = mix(vec3(0.98, 0.95, 0.88), vec3(0.68, 0.44, 0.31), griefSide * 0.86);
          vec3 cloudDark = mix(vec3(0.54, 0.62, 0.70), vec3(0.22, 0.17, 0.16), griefSide);
          float lightEdge = clamp((1.0 - cBase) * 0.55 + pow(sunDot, 3.0) * 0.75, 0.0, 1.0);
          vec3 cloudCol = mix(cloudDark, cloudLit, lightEdge);
          cloudCol += vec3(1.0, 0.76, 0.42) * pow(sunDot, 10.0) * (1.0 - cloudVal * 0.6) * 0.68 * (1.0 - griefSide * 0.5);

          sky = mix(sky, cloudCol, cloudMask * 0.86);
        }

        // Ground-level atmospheric horizon band matching terrain split-horizon fog seamlessly
        vec3 horizonMist = mix(vec3(0.66, 0.71, 0.73), vec3(0.54, 0.32, 0.24), griefSide);
        sky = mix(horizonMist, sky, smoothstep(-0.02, 0.18, elev));

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -10;
  group.add(skyDome);

  // =========================================================================
  // 2. 3D SCULPTED VOLUMETRIC-STYLE CLOUD FORMATIONS (Drifting over the valley)
  // =========================================================================
  interface CloudCluster {
    sprite: THREE.Sprite;
    baseX: number;
    baseY: number;
    baseZ: number;
    driftSpeed: number;
  }
  const clouds: CloudCluster[] = [];
  const rand = mulberry32(445566);

  // Create ~22 sculpted multi-puff cloud banks (stormy dark-bellied west, radiant sunlit east)
  const bankCount = 24;
  for (let b = 0; b < bankCount; b++) {
    const angle = (b / bankCount) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    const dist = 115 + rand() * 210;
    const bx = Math.cos(angle) * dist;
    const bz = Math.sin(angle) * dist;
    // Leave a natural luminous sky break around the sun direction so sunlight pours down cleanly
    const dirToBank = new THREE.Vector3(bx, 95, bz).normalize();
    if (dirToBank.dot(SUN_DIRECTION) > 0.86) continue;

    const stormFactor = clamp(smoothstep(45, -135, bx - bz * 0.25), 0, 1);
    const by = lerp(96, 74, stormFactor) + rand() * 38;
    const puffs = 5 + Math.floor(rand() * 4);

    for (let p = 0; p < puffs; p++) {
      const px = bx + (rand() - 0.5) * 52;
      const py = by + (rand() - 0.5) * 12;
      const pz = bz + (rand() - 0.5) * 44;

      // Split-Horizon cloud tinting: bright clean sunlit cumulus east -> bruised amber, ash-grey & crimson-ochre smog west!
      const isLower = py < by - 1.0;
      const cLit = new THREE.Color('#f7f2e8');
      const cGriefTop = new THREE.Color('#9e684b');
      const cGriefBelly = new THREE.Color('#473530');
      const cSunBelly = new THREE.Color('#b4c2cf');

      const col = isLower
        ? cSunBelly.clone().lerp(cGriefBelly, stormFactor)
        : cLit.clone().lerp(cGriefTop, stormFactor * 0.88);

      // Subtle golden rim warmth if close to sun azimuth on eastern side
      const sunAlign = clamp(new THREE.Vector3(px, py, pz).normalize().dot(SUN_DIRECTION), 0, 1);
      if (sunAlign > 0.45) {
        col.lerp(new THREE.Color('#ffdba8'), Math.pow(sunAlign, 3) * 0.42 * (1 - stormFactor * 0.6));
      }

      const mat = new THREE.SpriteMaterial({
        map: textures.cloudPuffMap,
        color: col,
        transparent: true,
        opacity: lerp(0.32, 0.52, stormFactor) * (0.75 + rand() * 0.35),
        depthWrite: false,
      });

      const sprite = new THREE.Sprite(mat);
      sprite.position.set(px, py, pz);
      const sx = 46 + rand() * 54;
      const sy = 22 + rand() * 22;
      sprite.scale.set(sx, sy, 1);
      sprite.renderOrder = -2;
      group.add(sprite);

      clouds.push({
        sprite,
        baseX: px,
        baseY: py,
        baseZ: pz,
        driftSpeed: 0.45 + rand() * 0.4,
      });
    }
  }

  // =========================================================================
  // 3. VOLUMETRIC SUNLIGHT SHAFTS (Soft Streaky Crepuscular God-Rays — never blobby!)
  // =========================================================================
  const rayMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime,
      uColor: { value: new THREE.Color('#ffe0a6') },
      uOpacity: { value: 0.045 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;

      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        float camDist = length(cameraPosition - vWorldPos);
        // Very smooth grazing fade + camera proximity fade so edges never look geometric or blobby
        float edgeFade = pow(abs(dot(normalize(vNormalW), V)), 2.2);
        float verticalFade = smoothstep(0.0, 0.34, vUv.y) * smoothstep(1.0, 0.22, vUv.y);
        float distFade = smoothstep(8.0, 22.0, camDist);
        // Fine parallel crepuscular ray streaks filtering through clouds & boughs
        float streaks = 0.55 + 0.45 * sin(vUv.x * 31.4159 + uTime * 0.25) * cos(vUv.x * 18.85 - uTime * 0.18);
        float alpha = edgeFade * verticalFade * distFade * streaks * uOpacity;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  // Align volumetric shafts strictly parallel to SUN_DIRECTION
  const rayQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN_DIRECTION);

  const shaftSpecs = [
    // Graceful diagonal sunbeams streaming through the upper canopy onto the mossy roots & eastern meadow
    { target: new THREE.Vector3(TREE_CENTER.x + 1.0, 13.0, TREE_CENTER.y + 1.5), rTop: 2.2, rBot: 6.2, len: 56 },
    { target: new THREE.Vector3(TREE_CENTER.x - 5.5, 11.0, TREE_CENTER.y + 4.5), rTop: 1.6, rBot: 4.8, len: 48 },
    // Sunbeam catching the rising waterfall mist
    { target: new THREE.Vector3(WATERFALL_BOTTOM.x + 1.5, 12.0, WATERFALL_BOTTOM.z + 3.5), rTop: 2.8, rBot: 7.4, len: 58 },
    // Sunbeam illuminating the sunlit river bend & meadow
    { target: new THREE.Vector3(30.0, 9.0, 12.0), rTop: 2.8, rBot: 7.5, len: 58 },
  ];

  const rayMeshes: THREE.Mesh[] = [];
  for (const spec of shaftSpecs) {
    const cyl = new THREE.CylinderGeometry(spec.rTop, spec.rBot, spec.len, 20, 1, true);
    const mesh = new THREE.Mesh(cyl, rayMat);
    mesh.position.copy(spec.target).addScaledVector(SUN_DIRECTION, spec.len * 0.46);
    mesh.quaternion.copy(rayQuat);
    mesh.renderOrder = 6;
    group.add(mesh);
    rayMeshes.push(mesh);
  }

  return {
    group,
    update(time: number, camera: THREE.Camera) {
      uTime.value = time;

      // Gently drift the 3D clouds across the sky and wrap them smoothly
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        let nx = c.baseX + time * c.driftSpeed;
        if (nx > 340) nx -= 680;
        c.sprite.position.x = nx;
        c.sprite.position.y = c.baseY + Math.sin(time * 0.15 + i) * 1.4;
      }

      // Keep god-rays delicately atmospheric from every viewing angle
      const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const sunLook = clamp(camFwd.dot(SUN_DIRECTION) * 0.5 + 0.5, 0, 1);
      rayMat.uniforms.uOpacity.value = lerp(0.022, 0.056, Math.pow(sunLook, 1.2));
    },
  };
}
