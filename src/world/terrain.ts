import * as THREE from 'three';
import { clamp, smoothstep } from './noise';
import { DamageFieldData } from './damageField';
import { RestorationSystem } from './restoration';
import {
  getDryRiverInfo,
  getLivingRiverInfo,
  getTerrainHeight,
  getVitality,
  PLUNGE_POOL_CENTER,
  SUN_DIRECTION,
} from './terrainData';
import { WorldTextures } from './textures';

export interface TerrainSystem {
  mesh: THREE.Mesh;
  uniforms: {
    uTime: { value: number };
  };
}

function warpAxis(u: number): number {
  const s = u < 0 ? -1 : 1;
  const a = Math.abs(u);
  return 135.0 * u + 325.0 * s * Math.pow(a, 3.6);
}

export function createTerrain(
  textures: WorldTextures,
  restoration?: RestorationSystem,
  damageField?: DamageFieldData
): TerrainSystem {
  const segs = 264;
  const vertCount = (segs + 1) * (segs + 1);

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const vitalityAttr = new Float32Array(vertCount);
  const wetnessAttr = new Float32Array(vertCount);
  const dryBedAttr = new Float32Array(vertCount);

  let ptr = 0;
  for (let iz = 0; iz <= segs; iz++) {
    const vz = (iz / segs) * 2 - 1;
    const z = warpAxis(vz);
    for (let ix = 0; ix <= segs; ix++) {
      const vx = (ix / segs) * 2 - 1;
      const x = warpAxis(vx);

      const y = getTerrainHeight(x, z);
      positions[ptr * 3] = x;
      positions[ptr * 3 + 1] = y;
      positions[ptr * 3 + 2] = z;

      uvs[ptr * 2] = ix / segs;
      uvs[ptr * 2 + 1] = iz / segs;

      const vit = getVitality(x, z);
      vitalityAttr[ptr] = vit;

      // Wetness near living river, plunge pool, and waterfall mist zone
      let wet = 0;
      if (x > -4 && x < 145 && z > -55 && z < 175) {
        const riv = getLivingRiverInfo(x, z);
        const bankWet = 1 - smoothstep(riv.width - 0.5, riv.width + 4.8, riv.dist);
        const heightWet = 1 - smoothstep(riv.waterY + 0.1, riv.waterY + 1.8, y);
        wet = Math.max(wet, bankWet * heightWet);
      }
      const poolD = Math.hypot(x - PLUNGE_POOL_CENTER.x, z - PLUNGE_POOL_CENTER.y);
      const sprayWet = (1 - smoothstep(6, 23, poolD)) * (1 - smoothstep(4, 24, y));
      wet = Math.max(wet, sprayWet * 0.85);
      wetnessAttr[ptr] = clamp(wet, 0, 1);

      // Dry riverbed mask
      let dryBed = 0;
      if (x < 18 && x > -175 && z > -2 && z < 82) {
        const dry = getDryRiverInfo(x, z);
        dryBed = (1 - smoothstep(dry.width * 0.45, dry.width + 3.2, dry.dist)) * smoothstep(12, -8, x);
      }
      dryBedAttr[ptr] = clamp(dryBed, 0, 1);

      ptr++;
    }
  }

  const indices = new Uint32Array(segs * segs * 6);
  let idx = 0;
  const row = segs + 1;
  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices[idx++] = a;
      indices[idx++] = c;
      indices[idx++] = b;
      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aVitality', new THREE.BufferAttribute(vitalityAttr, 1));
  geometry.setAttribute('aWetness', new THREE.BufferAttribute(wetnessAttr, 1));
  geometry.setAttribute('aDryBed', new THREE.BufferAttribute(dryBedAttr, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const fallbackField = new THREE.DataTexture(new Uint8Array([0, 0, 128, 128]), 1, 1, THREE.RGBAFormat);
  fallbackField.needsUpdate = true;

  const fallbackDamage = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  fallbackDamage.needsUpdate = true;

  const uniforms = {
    uTime: { value: 0 },
    uGrassMap: { value: textures.grassGroundMap },
    uCrackedMap: { value: textures.crackedMap },
    uCrackedNormal: { value: textures.crackedNormal },
    uRockMap: { value: textures.rockMap },
    uRockNormal: { value: textures.rockNormal },
    uSunDir: { value: SUN_DIRECTION.clone() },
    uRestoreFieldMap: { value: restoration ? restoration.fieldMap : fallbackField },
    uRestoreBounds: { value: restoration ? restoration.bounds : new THREE.Vector4(-54, -8, 1 / 60, 1 / 58) },
    uRestoreOrigin: restoration ? restoration.uniforms.uRestoreOrigin : { value: new THREE.Vector3(-24.5, 2, 20.5) },
    uRestoreProgress: restoration ? restoration.uniforms.uRestoreProgress : { value: 0 },
    uRestoreRadius: restoration ? restoration.uniforms.uRestoreRadius : { value: 23.5 },
    uDamageFieldMap: { value: damageField ? damageField.texture : fallbackDamage },
    uDamageBounds: { value: damageField ? damageField.bounds : new THREE.Vector4(-158, -86, 1 / 170, 1 / 174) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aVitality;
        attribute float aWetness;
        attribute float aDryBed;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vVitality;
        varying float vWetness;
        varying float vDryBed;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vVitality = aVitality;
        vWetness = aWetness;
        vDryBed = aDryBed;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uGrassMap;
        uniform sampler2D uCrackedMap;
        uniform sampler2D uCrackedNormal;
        uniform sampler2D uRockMap;
        uniform sampler2D uRockNormal;
        uniform vec3 uSunDir;
        uniform sampler2D uRestoreFieldMap;
        uniform vec4 uRestoreBounds;
        uniform vec3 uRestoreOrigin;
        uniform float uRestoreProgress;
        uniform float uRestoreRadius;
        uniform sampler2D uDamageFieldMap;
        uniform vec4 uDamageBounds;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vVitality;
        varying float vWetness;
        varying float vDryBed;

        vec4 evalDamage(vec2 xz) {
          vec2 uv = (xz - uDamageBounds.xy) * uDamageBounds.zw;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
          return texture2D(uDamageFieldMap, uv);
        }

        // Sample unified Phase 4 dynamic 256x256 spatial restoration field (R=moisture, G=moss, B=life, A=channelWet)
        vec4 evalRestoration(vec2 xz) {
          if (uRestoreProgress <= 0.0005) return vec4(0.0);
          vec2 uv = (xz - uRestoreBounds.xy) * uRestoreBounds.zw;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
          vec4 f = texture2D(uRestoreFieldMap, uv);
          // Returns (moisture, moss, channelWet, life) matching all downstream terrain shader blends!
          return vec4(f.r, f.g, f.a, f.b);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
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

        // Triplanar texture sample for stretch-free cliffs & mountains
        vec3 sampleTriplanar(sampler2D tex, vec3 p, vec3 n, float scale) {
          vec3 w = pow(abs(n), vec3(4.0));
          w /= max(w.x + w.y + w.z, 0.0001);
          vec3 tx = texture2D(tex, p.zy * scale).rgb;
          vec3 ty = texture2D(tex, p.xz * scale).rgb;
          vec3 tz = texture2D(tex, p.xy * scale).rgb;
          return tx * w.x + ty * w.y + tz * w.z;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wn = normalize(vWorldNormal);
        float slope = 1.0 - clamp(wn.y, 0.0, 1.0);
        float alt = vWorldPos.y;

        // Multi-scale organic variation to eliminate tiling
        float macroN = vnoise(vWorldPos.xz * 0.035);
        float medN = vnoise(vWorldPos.xz * 0.14 + vec2(4.2, 1.7));

        // 1. Lush living meadow & woodland moss
        vec3 grassTex1 = texture2D(uGrassMap, vWorldPos.xz * 0.13).rgb;
        vec3 grassTex2 = texture2D(uGrassMap, vWorldPos.xz * 0.032 + vec2(0.37, 0.61)).rgb;
        vec3 lushColor = mix(grassTex1, grassTex2, 0.45);
        // Enrich with deep moss & sunlit olive-gold meadow variation
        vec3 deepMoss = vec3(0.09, 0.21, 0.07);
        vec3 sunlitMeadow = vec3(0.24, 0.36, 0.11);
        lushColor = mix(lushColor * 0.85, mix(deepMoss, sunlitMeadow, macroN), 0.42);

        // 2. Scarred Western Terrain — STRICT 3-TONE COLOR DISCIPLINE:
        //    (1) Parched bone-white cracked alkali silt, (2) Charcoal soot-black, (3) Subtle rust/ember accents
        //    Eliminates muddy mid-tone greys so green Phase 2 restoration pops dramatically!
        vec3 cracked1 = texture2D(uCrackedMap, vWorldPos.xz * 0.22).rgb;
        vec3 cracked2 = texture2D(uCrackedMap, vWorldPos.xz * 0.065 + vec2(0.2, 0.7)).rgb;
        float crackLuma = clamp(dot(mix(cracked1, cracked2, 0.28), vec3(0.45, 0.38, 0.17)), 0.0, 1.0);
        float crackPlate = smoothstep(0.18, 0.62, crackLuma);

        // Tone 1: Parched bone-white alkali clay plates with stark dark polygonal fissures
        vec3 boneAlkali = vec3(0.79, 0.75, 0.66);
        vec3 deepFissure = vec3(0.14, 0.12, 0.11);
        vec3 parchedColor = mix(deepFissure, boneAlkali, crackPlate * (0.86 + 0.14 * medN));

        // Phase 3 Vast Wound Terrain Discipline:
        // Deep scorched charcoal-ash burned forest floors, enormous pale cracked alkali lakebeds & dry tributaries,
        // and oxidized rust/ochre erosion — rich geological variation (never flat empty beige!)
        vec4 dmg = evalDamage(vWorldPos.xz);
        float dmgSoot = dmg.r;
        float dmgLake = dmg.g;
        float dmgRust = dmg.b;
        float dmgOil = dmg.a;

        // Enormous dried reservoir & branching dry tributary pale alkali silt + concentric water-recession strata
        float ringBand = 0.5 + 0.5 * sin(alt * 6.8 + macroN * 4.2);
        float siltNoise = vnoise(vWorldPos.xz * 0.34 + vec2(5.1, 2.7));
        vec3 bleachedSalt = mix(vec3(0.84, 0.80, 0.72), vec3(0.60, 0.55, 0.47), ringBand * 0.52 + siltNoise * 0.18);
        parchedColor = mix(parchedColor, mix(deepFissure, bleachedSalt, crackPlate), dmgLake * 0.82);

        // Vast blackened burned forest floor: charcoal soot, charred humus & pale windblown ash streaks
        float ashStreak = smoothstep(0.56, 0.84, vnoise(vWorldPos.xz * 0.16 + vec2(1.4, -3.2)));
        vec3 charredFloor = mix(vec3(0.08, 0.075, 0.075), vec3(0.19, 0.175, 0.165), crackPlate * 0.55);
        charredFloor = mix(charredFloor, vec3(0.46, 0.43, 0.39), ashStreak * 0.36);
        parchedColor = mix(parchedColor, charredFloor, smoothstep(0.08, 0.72, dmgSoot) * 0.92);

        // Oxidized rust / eroded ochre subsoil gullies & scorched forest borders
        vec3 rustAccent = mix(vec3(0.32, 0.13, 0.07), vec3(0.52, 0.22, 0.11), medN);
        parchedColor = mix(parchedColor, rustAccent, smoothstep(0.16, 0.76, dmgRust) * 0.68);

        // Dark tarry oil-stained earth beneath the choked weir trickle
        parchedColor = mix(parchedColor, vec3(0.045, 0.043, 0.042), dmgOil * 0.92);

        // Localized Phase 2 Ecological Restoration: capillary moisture -> dark damp earth -> creeping velvety moss!
        vec4 restState = evalRestoration(vWorldPos.xz);
        float restMoist = restState.x;
        float restMoss = restState.y;
        float restChannel = restState.z;

        // Stage 1: Water wicks into dark mud-crack fissures FIRST, then saturates the dry alkali plates
        float crackCrevice = 1.0 - smoothstep(0.24, 0.56, crackLuma);
        float capillaryWet = clamp(restMoist * (0.72 + crackCrevice * 0.95 + restChannel * 0.45), 0.0, 1.0);
        vec3 dampSoilCol = mix(parchedColor * vec3(0.34, 0.31, 0.26), vec3(0.10, 0.095, 0.08), 0.45 + restChannel * 0.25);
        parchedColor = mix(parchedColor, dampSoilCol, capillaryWet * 0.88);

        // Organic vitality transition with mossy tendrils at the boundary + creeping restoration moss
        float fineMossPatch = vnoise(vWorldPos.xz * 0.55 + vec2(2.1, 6.7));
        float naturalVit = clamp(vVitality - (dmgRust * 0.32 + dmgOil * 0.55 + dmgSoot * 0.28), 0.0, 1.0);
        float effectiveVitality = clamp(max(naturalVit, restMoss * (0.86 + fineMossPatch * 0.26)), 0.0, 1.0);
        float vitBlend = smoothstep(0.16, 0.82, effectiveVitality + (medN - 0.5) * 0.28);
        vec3 groundColor = mix(parchedColor, lushColor, vitBlend);

        // Rich velvety woodland moss accent creeping over damp restored earth (avoids flat green overlay!)
        float velvetMoss = restMoss * smoothstep(0.28, 0.76, fineMossPatch * 0.65 + medN * 0.35) * (1.0 - restChannel * 0.45);
        groundColor = mix(groundColor, mix(vec3(0.08, 0.21, 0.07), vec3(0.18, 0.31, 0.09), macroN), velvetMoss * 0.52);

        // Transition border damp fertile humus band
        float borderBand = smoothstep(0.15, 0.45, vitBlend) * (1.0 - smoothstep(0.45, 0.78, vitBlend));
        groundColor = mix(groundColor, vec3(0.16, 0.17, 0.11), borderBand * 0.35);

        // 3. Damp riverbank stones, dark earth & emerald wet moss (including newly returning stream banks!)
        float effectiveWetness = clamp(max(vWetness, restMoist * (0.55 + restChannel * 0.55) * (1.0 - restMoss * 0.35)), 0.0, 1.0);
        vec3 wetBankColor = mix(vec3(0.13, 0.14, 0.11), vec3(0.12, 0.25, 0.10), vitBlend * 0.78);
        groundColor = mix(groundColor, wetBankColor, effectiveWetness * 0.62);

        // 4. Stratified geological cliff rock (triplanar multi-scale breakup so cliffs NEVER look striped!)
        vec3 rockTri1 = sampleTriplanar(uRockMap, vWorldPos, wn, 0.032);
        vec3 rockTri2 = sampleTriplanar(uRockMap, vWorldPos.zyx + vec3(13.7, 7.3, 4.1), wn, 0.085);
        vec3 rockDetail = sampleTriplanar(uRockMap, vWorldPos, wn, 0.19);
        vec3 cliffColor = mix(mix(rockTri1, rockTri2, 0.48), rockDetail, 0.28);
        // Geological mineral variation (deep slate basalt crevices + warm sunlit ochre granite crags)
        vec3 basaltTone = vec3(0.46, 0.49, 0.54);
        vec3 graniteWarm = vec3(0.76, 0.69, 0.61);
        cliffColor *= mix(basaltTone, graniteWarm, clamp(macroN * 0.7 + smoothstep(12.0, 58.0, alt) * 0.4, 0.0, 1.0)) * 1.42;
        // Lush emerald moss clinging organically to damp waterfall ledges & living-side crevices
        float cliffMoss = (vWetness * 0.75 + vitBlend * 0.35) * smoothstep(0.68, 0.18, slope) * smoothstep(0.32, 0.74, medN);
        cliffColor = mix(cliffColor, vec3(0.14, 0.28, 0.11), clamp(cliffMoss, 0.0, 0.72));

        float rockMask = smoothstep(0.16, 0.42, slope + (macroN - 0.5) * 0.12);
        float highRock = smoothstep(28.0, 56.0, alt) * (0.42 + 0.58 * smoothstep(0.08, 0.28, slope));
        rockMask = clamp(max(rockMask, highRock), 0.0, 1.0);

        vec3 surfaceColor = mix(groundColor, cliffColor, rockMask);

        // 5. High-altitude alpine snow/frost dusting on distant peaks (> 42m, gentle ledges)
        float snowMask = smoothstep(42.0, 68.0, alt + (macroN - 0.5) * 14.0) * (1.0 - smoothstep(0.28, 0.62, slope));
        vec3 snowCol = vec3(0.86, 0.89, 0.94);
        surfaceColor = mix(surfaceColor, snowCol, snowMask * 0.84);

        // 6. Subtle atmospheric drifting cloud shadows (brooding mood west vs bright sunlit east)
        vec2 cloudUV = vWorldPos.xz * 0.0085 + vec2(uTime * 0.012, uTime * 0.005);
        float c1 = vnoise(cloudUV);
        float c2 = vnoise(cloudUV * 2.3 - vec2(uTime * 0.008, 0.0));
        float cloudCover = c1 * 0.65 + c2 * 0.35;
        float stormSide = smoothstep(25.0, -75.0, vWorldPos.x - vWorldPos.z * 0.3);
        float cloudShadow = smoothstep(0.48 - stormSide * 0.22, 0.80 - stormSide * 0.10, cloudCover);
        float treeSpot = 1.0 - smoothstep(14.0, 44.0, length(vWorldPos.xz));
        cloudShadow *= (1.0 - treeSpot * 0.82);
        surfaceColor *= mix(1.0, 0.72, cloudShadow * (0.48 + stormSide * 0.35));

        diffuseColor.rgb = surfaceColor;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Wet riverbanks, waterfall rock & freshly moistened restoration earth glisten softly
        vec4 rRough = evalRestoration(vWorldPos.xz);
        float freshWet = clamp(max(vWetness, rRough.x * (0.72 + rRough.z * 0.42) * (1.0 - rRough.y * 0.62)), 0.0, 1.0);
        roughnessFactor = mix(0.95, 0.28, freshWet * 0.85);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Subtle normal perturbation from cracked earth & cliff rock (cracks heal softly as moss covers them!)
        vec3 twn = normalize(vWorldNormal);
        float tSlope = 1.0 - clamp(twn.y, 0.0, 1.0);
        vec3 crkN = texture2D(uCrackedNormal, vWorldPos.xz * 0.22).xyz * 2.0 - 1.0;
        vec3 rckN = texture2D(uRockNormal, (vWorldPos.xy + vWorldPos.zy) * 0.065).xyz * 2.0 - 1.0;
        vec4 rNorm = evalRestoration(vWorldPos.xz);
        float healSoften = 1.0 - rNorm.y * 0.86;
        float crkWeight = (1.0 - smoothstep(0.15, 0.65, vVitality)) * (1.0 - smoothstep(0.15, 0.38, tSlope)) * (0.45 + 0.55 * vDryBed) * healSoften;
        float rckWeight = smoothstep(0.16, 0.45, tSlope) * 0.55;
        vec3 detailN = normalize(vec3(crkN.x * crkWeight + rckN.x * rckWeight, crkN.y * crkWeight + rckN.y * rckWeight, 1.0));
        normal = normalize(normal + (detailN - vec3(0.0, 0.0, 1.0)) * 0.42);`
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          // Balanced World-Space Split-Horizon Atmospheric Haze:
          // Clean alpine mist east -> warm ash-amber horizon haze west (clear enough for burned trees, fossils & factory to read crisply!)
          float hazeWarp = (vnoise(vWorldPos.xz * 0.014 + vec2(1.9, -2.3)) - 0.5) * 34.0;
          float westSmog = smoothstep(14.0, -88.0, vWorldPos.x - vWorldPos.z * 0.22 + hazeWarp);
          vec3 eastMistCol = vec3(0.66, 0.71, 0.73);
          vec3 westSmogCol = vec3(0.64, 0.47, 0.38);
          vec3 splitFogCol = mix(eastMistCol, westSmogCol, westSmog * 0.82);
          float localDensity = fogDensity * mix(0.92, 1.18, westSmog);
          float fogFactor = 1.0 - exp(-localDensity * localDensity * vFogDepth * vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, splitFogCol, clamp(fogFactor, 0.0, 1.0));
        #endif`
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'WorldTerrain';

  return {
    mesh,
    uniforms: {
      uTime: uniforms.uTime,
    },
  };
}
