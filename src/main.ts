import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import './style.css';
import { AmbientSoundscape } from './audio/soundscape';
import { CameraController, ExplorationMode, VISTAS } from './controls/cameraController';
import { createAncientTree } from './world/ancientTree';
import { createAtmosphere } from './world/atmosphere';
import { createDamageField } from './world/damageField';
import { createIndustrialComplex } from './world/industrialComplex';
import { createRestorationSystem } from './world/restoration';
import { createScarredAndRockyDetails } from './world/scarredDetails';
import { createTerrain } from './world/terrain';
import { SUN_DIRECTION } from './world/terrainData';
import { getWorldTextures } from './world/textures';
import { createVegetation } from './world/vegetation';
import { createWaterSystem } from './world/water';
import { createWildlife } from './world/wildlife';

function initApp() {
  const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;

  // =========================================================================
  // 1. RENDERER & CINEMATIC POST-PROCESSING
  // =========================================================================
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2('#8896a2', 0.00215);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.25, 950);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Subtle filmic bloom strictly catching bright sun specular glints & waterfall mist crest
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.16,
    0.52,
    0.94
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // =========================================================================
  // 2. CINEMATIC NATURAL LIGHTING (Warm Golden Sun + Sky IBL + Stormy Counter-Fill)
  // =========================================================================
  const sunLight = new THREE.DirectionalLight('#ffe4b8', 3.25);
  sunLight.position.copy(SUN_DIRECTION).multiplyScalar(145);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 25;
  sunLight.shadow.camera.far = 310;
  const shadowExtent = 96;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.bias = -0.00055;
  sunLight.shadow.normalBias = 0.035;
  scene.add(sunLight);

  // Rich atmospheric hemisphere sky-to-earth fill (prevents crushed black shadows!)
  const hemiLight = new THREE.HemisphereLight('#a8c4df', '#595042', 1.38);
  scene.add(hemiLight);

  // Moody cool slate counter-fill from the stormy western sky so shadow sides have sculpted depth
  const stormRimLight = new THREE.DirectionalLight('#7f98b5', 0.68);
  stormRimLight.position.set(-95, 48, 60);
  scene.add(stormRimLight);

  // Subtle warm sanctuary bounce beneath the Ancient Tree canopy so roots & ferns glow naturally
  const sanctuaryBounce = new THREE.PointLight('#e5be78', 8.5, 28, 1.7);
  sanctuaryBounce.position.set(2.5, 11.5, 1.5);
  scene.add(sanctuaryBounce);

  // =========================================================================
  // 3. BUILD THE LIVING INTERCONNECTED WORLD
  // =========================================================================
  const textures = getWorldTextures();

  const atmosphere = createAtmosphere(textures);
  scene.add(atmosphere.group);

  // Bake subtle physical sky IBL environment map from our actual sky dome for lifelike PBR ambient light!
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSkyClone = atmosphere.group.children[0].clone();
  envScene.add(envSkyClone);
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  const damageField = createDamageField();
  const restoration = createRestorationSystem(textures);

  const terrain = createTerrain(textures, restoration, damageField);
  scene.add(terrain.mesh);
  scene.add(restoration.group);

  const water = createWaterSystem(textures);
  scene.add(water.group);

  const ancientTree = createAncientTree(textures);
  scene.add(ancientTree.group);

  const vegetation = createVegetation(textures);
  scene.add(vegetation.group);

  const scarredDetails = createScarredAndRockyDetails(textures, damageField);
  scene.add(scarredDetails.group);

  const industrialComplex = createIndustrialComplex(textures);
  scene.add(industrialComplex.group);

  const wildlife = createWildlife();
  scene.add(wildlife.group);

  // =========================================================================
  // 4. INTERACTIVE CAMERA, SPATIAL AUDIO & MINIMAL UI
  // =========================================================================
  const soundscape = new AmbientSoundscape();

  const introOverlay = document.getElementById('intro-overlay')!;
  const enterBtn = document.getElementById('enter-btn')!;
  const topBrand = document.getElementById('top-brand')!;
  const hudBar = document.getElementById('hud-bar')!;
  const controlsWhisper = document.getElementById('controls-whisper')!;
  const vistaButtonsContainer = document.getElementById('vista-buttons')!;
  const vistaCaption = document.getElementById('vista-caption')!;
  const modeBtn = document.getElementById('mode-btn')!;
  const modeLabel = document.getElementById('mode-label')!;
  const resetBtn = document.getElementById('reset-btn')!;
  const soundBtn = document.getElementById('sound-btn')!;
  const soundOnIcon = document.getElementById('sound-on-icon')!;
  const soundOffIcon = document.getElementById('sound-off-icon')!;

  let activeVistaIdx = 0;
  let uiHidden = false;
  const vistaBtnEls: HTMLButtonElement[] = [];

  const updateModeUI = (mode: ExplorationMode) => {
    modeLabel.textContent = mode === 'ground' ? 'Ground' : 'Aerial';
    modeBtn.classList.toggle('ground-active', mode === 'ground');
  };

  const controller = new CameraController(camera, canvas, updateModeUI);

  const setActiveVistaUI = (index: number) => {
    activeVistaIdx = index;
    vistaBtnEls.forEach((btn, i) => btn.classList.toggle('active', i === index));
    const v = VISTAS[index];
    vistaCaption.textContent = `${v.name} — ${v.caption}`;
  };

  // Populate subtle Vista selector pills
  VISTAS.forEach((v, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vista-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = v.name.replace(/^The\s+/i, '');
    btn.title = `${v.name} (${idx + 1})`;
    btn.addEventListener('click', () => {
      setActiveVistaUI(idx);
      controller.goToVista(idx);
    });
    vistaButtonsContainer.appendChild(btn);
    vistaBtnEls.push(btn);
  });
  setActiveVistaUI(0);

  const updateSoundUI = (enabled: boolean) => {
    soundOnIcon.classList.toggle('hidden', !enabled);
    soundOffIcon.classList.toggle('hidden', enabled);
  };
  updateSoundUI(false);

  const enterExperience = () => {
    if (!controller.introActive) return;
    controller.introActive = false;
    introOverlay.classList.add('fade-out');
    topBrand.classList.remove('hidden-hud');
    hudBar.classList.remove('hidden-hud');
    controlsWhisper.classList.remove('hidden-hud');
    soundscape.startIfNotStarted();
    updateSoundUI(soundscape.enabled);
  };

  enterBtn.addEventListener('click', enterExperience);

  modeBtn.addEventListener('click', () => {
    controller.setMode(controller.mode === 'aerial' ? 'ground' : 'aerial');
  });

  soundBtn.addEventListener('click', () => {
    const enabled = soundscape.toggle();
    updateSoundUI(enabled);
  });

  // =========================================================================
  // PHASE 4 — TOUCH-DRIVEN RIVER OF RENEWAL RAYCAST (GROUND + BURNING TREES) & FULL RESET
  // =========================================================================
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let lastHoverRaycast = 0;

  const setRayFromClient = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
  };

  const raycastRestorationTarget = (clientX: number, clientY: number): THREE.Vector3 | null => {
    setRayFromClient(clientX, clientY);
    // 1. Direct tap on any burning/smoldering tree initiates a connected river branch right to it!
    const treeHits = raycaster.intersectObjects(scarredDetails.getBurningTreeHitMeshes(), false);
    if (treeHits.length > 0) {
      const targetPos = treeHits[0].object.userData.burningTreePos as THREE.Vector3 | undefined;
      if (targetPos) return targetPos.clone();
    }
    // 2. Otherwise check any damaged ground across the western landscape
    const groundHits = raycaster.intersectObject(terrain.mesh, false);
    if (groundHits.length > 0 && restoration.isInsideZone(groundHits[0].point)) {
      return groundHits[0].point.clone();
    }
    return null;
  };

  const syncResetUI = () => {
    resetBtn.classList.toggle('hidden', !restoration.getState().active);
  };

  const resetRestoration = () => {
    restoration.reset();
    scarredDetails.resetFireStates();
    wildlife.resetRestorationWildlife();
    syncResetUI();
  };

  resetBtn.addEventListener('click', resetRestoration);

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || controller.introActive || controller.isPointerInteracting()) {
      canvas.classList.remove('can-restore');
      return;
    }
    const now = performance.now();
    if (now - lastHoverRaycast < 45) return;
    lastHoverRaycast = now;

    const target = raycastRestorationTarget(e.clientX, e.clientY);
    if (target) {
      restoration.setHoverPoint(target);
      canvas.classList.add('can-restore');
    } else {
      restoration.setHoverPoint(null);
      canvas.classList.remove('can-restore');
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (controller.introActive) return;
    // Strict gesture separation: only trigger on clean single-finger tap / mouse click (never after orbit/pan/pinch!)
    if (!controller.wasCleanTap()) return;

    const target = raycastRestorationTarget(e.clientX, e.clientY);
    if (target) {
      restoration.trigger(target);
      canvas.classList.remove('can-restore');
      syncResetUI();
    }
  });

  canvas.addEventListener('pointerleave', () => {
    restoration.setHoverPoint(null);
    canvas.classList.remove('can-restore');
  });

  // Expose lightweight telemetry for automated acceptance verification (zero UI impact)
  (window as unknown as Record<string, unknown>).__EARTH_DEBUG__ = {
    triggerAt: (x: number, z: number) => {
      const ok = restoration.trigger(new THREE.Vector3(x, 0, z));
      syncResetUI();
      return ok;
    },
    reset: () => resetRestoration(),
    getStatus: () => ({
      restoration: restoration.getState(),
      branches: restoration.getConnectedBranches().map((b) => ({
        id: b.id,
        headT: Number(b.headT.toFixed(3)),
        length: Number(b.length.toFixed(1)),
        dest: [Number(b.destination.x.toFixed(1)), Number(b.destination.z.toFixed(1))],
      })),
      fires: scarredDetails.getBurningStatus(),
      wildlife: wildlife.getRecoveryWildlifeCounts(),
    }),
  };

  window.addEventListener('keydown', (e) => {
    if (controller.introActive && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      enterExperience();
      return;
    }
    if (controller.introActive) return;

    if (e.code === 'KeyG') {
      controller.setMode(controller.mode === 'aerial' ? 'ground' : 'aerial');
    } else if (e.code === 'KeyR') {
      if (restoration.getState().active) {
        resetRestoration();
      }
    } else if (e.code === 'KeyM') {
      const enabled = soundscape.toggle();
      updateSoundUI(enabled);
    } else if (e.code === 'KeyH') {
      uiHidden = !uiHidden;
      topBrand.classList.toggle('hidden-hud', uiHidden);
      hudBar.classList.toggle('hidden-hud', uiHidden);
      controlsWhisper.classList.toggle('hidden-hud', uiHidden);
    } else if (e.key >= '1' && e.key <= String(VISTAS.length)) {
      const idx = Number(e.key) - 1;
      setActiveVistaUI(idx);
      controller.goToVista(idx);
    }
  });

  // Responsive resize
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
  });

  // =========================================================================
  // 5. MAIN REAL-TIME RENDER LOOP
  // =========================================================================
  const clock = new THREE.Clock();
  const fogSunColor = new THREE.Color('#a4b0b6');
  const fogGriefColor = new THREE.Color('#865341');
  const camFwd = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    controller.update(elapsed, dt);

    // Split-horizon fog tint matching crystalline east mist vs bruised crimson-ochre west smog
    camera.getWorldDirection(camFwd);
    const sunLook = THREE.MathUtils.clamp((camFwd.x - camFwd.z * 0.22) * 0.65 + 0.52, 0, 1);
    fog.color.copy(fogGriefColor).lerp(fogSunColor, sunLook);

    terrain.uniforms.uTime.value = elapsed;
    ancientTree.uniforms.uTime.value = elapsed;
    vegetation.uniforms.uTime.value = elapsed;
    restoration.update(elapsed, dt);
    scarredDetails.update(elapsed, dt, restoration);
    industrialComplex.update(elapsed);
    water.update(elapsed, dt, camera);
    atmosphere.update(elapsed, camera);
    wildlife.update(elapsed, dt, restoration);
    soundscape.update(elapsed, camera.position);

    composer.render();
  }

  animate();

  // Keep activeVistaIdx referenced cleanly
  void activeVistaIdx;
}

initApp();
