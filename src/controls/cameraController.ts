import * as THREE from 'three';
import { clamp, lerp } from '../world/noise';
import { getTerrainHeight, getTerrainSlope, isPointInWater } from '../world/terrainData';

export type ExplorationMode = 'aerial' | 'ground';

export interface VistaPreset {
  id: string;
  name: string;
  caption: string;
  mode: ExplorationMode;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export const VISTAS: VistaPreset[] = [
  {
    id: 'heart',
    name: 'The Ancient Heart',
    caption: 'Where memory holds the earth together',
    mode: 'aerial',
    position: new THREE.Vector3(-34, 17.8, 55),
    target: new THREE.Vector3(4.5, 17.5, -10.0),
  },
  {
    id: 'scarred',
    name: 'The Scarred Basin',
    caption: 'Dry silt, quiet relics, and the first returning blooms',
    mode: 'ground',
    position: new THREE.Vector3(-38.5, getTerrainHeight(-38.5, 24.0) + 2.2, 24.0),
    target: new THREE.Vector3(-2.5, 14.0, 1.0),
  },
  {
    id: 'canopy',
    name: 'Beneath the Canopy',
    caption: 'Sunlight filtering through a thousand living rings',
    mode: 'ground',
    position: new THREE.Vector3(-8.8, getTerrainHeight(-8.8, 13.8) + 1.9, 13.8),
    target: new THREE.Vector3(3.2, 16.8, -1.5),
  },
  {
    id: 'falls',
    name: 'The Living Falls',
    caption: 'Water carving life through ancient stone',
    mode: 'aerial',
    position: new THREE.Vector3(6.0, 14.5, -4.5),
    target: new THREE.Vector3(24.0, 23.0, -45.0),
  },
  {
    id: 'divide',
    name: 'Above the Divide',
    caption: 'One fragile world between storm and restoration',
    mode: 'aerial',
    position: new THREE.Vector3(-62, 42, 96),
    target: new THREE.Vector3(8, 16, -24),
  },
];

// Wide unrestricted world bounds covering the full western burned forest, industrial ridge, fossils & eastern highlands
const WORLD_MIN_X = -245;
const WORLD_MAX_X = 225;
const WORLD_MIN_Z = -195;
const WORLD_MAX_Z = 210;

interface TrackedPointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  pointerType: string;
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  public mode: ExplorationMode = 'aerial';
  public introActive = true;

  // Target & spherical state for aerial orbit + free flight
  private target = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private spherical = new THREE.Spherical();
  private desiredSpherical = new THREE.Spherical();

  // Ground-walk state
  private walkPos = new THREE.Vector3();
  private desiredWalkPos = new THREE.Vector3();
  private walkYaw = 0;
  private desiredWalkYaw = 0;
  private walkPitch = 0.08;
  private desiredWalkPitch = 0.08;

  // Smooth vista interpolation state
  private transitioning = false;
  private transT = 0;
  private transDuration = 2.2;
  private transStartPos = new THREE.Vector3();
  private transStartLook = new THREE.Vector3();
  private transEndPos = new THREE.Vector3();
  private transEndLook = new THREE.Vector3();
  private transEndMode: ExplorationMode = 'aerial';

  // Keyboard & Multi-Pointer (Desktop + Mobile/Tablet Touch) state
  private keys = new Set<string>();
  private pointers = new Map<number, TrackedPointer>();
  private dragButton = 0;
  private lastPinchDist = 0;
  private lastCentroidX = 0;
  private lastCentroidY = 0;

  // Clean gesture-separation flags so orbiting, panning, or pinching NEVER triggers ground interactions
  private gestureHadMultiTouch = false;
  private gestureMovedPx = 0;
  private gestureStartTime = 0;
  private lastTapClean = false;

  private currentLookAt = new THREE.Vector3();
  private onModeChange?: (mode: ExplorationMode) => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    onModeChange?: (mode: ExplorationMode) => void
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.onModeChange = onModeChange;

    const hero = VISTAS[0];
    this.camera.position.copy(hero.position);
    this.target.copy(hero.target);
    this.desiredTarget.copy(hero.target);
    this.currentLookAt.copy(hero.target);
    this.syncSphericalFromCamera();
    this.camera.lookAt(this.target);

    this.bindEvents();
  }

  /** Returns true ONLY if the most recently completed pointer interaction was a clean single-finger tap/click. */
  public wasCleanTap(): boolean {
    return this.lastTapClean;
  }

  public isPointerInteracting(): boolean {
    return this.pointers.size > 0;
  }

  private syncSphericalFromCamera() {
    const offset = this.camera.position.clone().sub(this.target);
    this.spherical.setFromVector3(offset);
    this.desiredSpherical.copy(this.spherical);
  }

  private syncWalkFromCamera() {
    this.walkPos.copy(this.camera.position);
    const groundY = getTerrainHeight(this.walkPos.x, this.walkPos.z);
    this.walkPos.y = groundY + 1.95;
    this.desiredWalkPos.copy(this.walkPos);

    const dir = this.currentLookAt.clone().sub(this.camera.position).normalize();
    this.walkYaw = Math.atan2(-dir.x, -dir.z);
    this.walkPitch = clamp(Math.asin(clamp(dir.y, -0.88, 0.88)), -0.85, 1.18);
    this.desiredWalkYaw = this.walkYaw;
    this.desiredWalkPitch = this.walkPitch;
  }

  public setMode(newMode: ExplorationMode) {
    if (this.mode === newMode) return;
    this.transitioning = false;
    this.mode = newMode;

    if (newMode === 'ground') {
      let gx = clamp(this.camera.position.x, WORLD_MIN_X, WORLD_MAX_X);
      let gz = clamp(this.camera.position.z, WORLD_MIN_Z, WORLD_MAX_Z);
      const water = isPointInWater(gx, gz);
      if (water.inWater && water.depth > 1.25) {
        gx = lerp(gx, 0, 0.28);
        gz = lerp(gz, 12, 0.28);
      }
      const gy = getTerrainHeight(gx, gz) + 1.95;
      this.walkPos.copy(this.camera.position);
      this.desiredWalkPos.set(gx, gy, gz);
      const dir = this.currentLookAt.clone().sub(this.camera.position).normalize();
      this.walkYaw = Math.atan2(-dir.x, -dir.z);
      this.walkPitch = clamp(Math.asin(clamp(dir.y, -0.78, 0.96)), -0.75, 1.15);
      this.desiredWalkYaw = this.walkYaw;
      this.desiredWalkPitch = clamp(this.walkPitch + 0.08, -0.55, 0.95);
    } else {
      const fwd = new THREE.Vector3(-Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw));
      this.target.copy(this.camera.position).addScaledVector(fwd, 22);
      this.target.y = Math.max(getTerrainHeight(this.target.x, this.target.z) + 3.0, this.camera.position.y);
      this.desiredTarget.copy(this.target);
      this.syncSphericalFromCamera();
      this.desiredSpherical.radius = Math.max(this.desiredSpherical.radius, 22);
      this.desiredSpherical.phi = clamp(this.desiredSpherical.phi - 0.16, 0.18, 1.44);
    }

    this.onModeChange?.(this.mode);
  }

  public goToVista(index: number) {
    const vista = VISTAS[clamp(index, 0, VISTAS.length - 1)];
    this.introActive = false;
    this.transitioning = true;
    this.transT = 0;
    this.transDuration = 2.1;
    this.transStartPos.copy(this.camera.position);
    this.transStartLook.copy(this.currentLookAt);
    this.transEndPos.copy(vista.position);
    if (vista.mode === 'ground') {
      this.transEndPos.y = getTerrainHeight(vista.position.x, vista.position.z) + 1.95;
    }
    this.transEndLook.copy(vista.target);
    this.transEndMode = vista.mode;
  }

  private getTwoPointerMetrics(): { dist: number; cx: number; cy: number } {
    const arr = Array.from(this.pointers.values());
    const a = arr[0];
    const b = arr[1];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      cx: (a.x + b.x) * 0.5,
      cy: (a.y + b.y) * 0.5,
    };
  }

  private panGroundPlane(dx: number, dy: number, scale: number) {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0.0001) forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
    this.desiredTarget.addScaledVector(right, -dx * scale);
    this.desiredTarget.addScaledVector(forward, dy * scale);
  }

  private bindEvents() {
    this.domElement.addEventListener('pointerdown', (e) => {
      if (this.introActive) return;
      this.transitioning = false;
      this.lastTapClean = false;

      if (this.pointers.size === 0) {
        this.gestureHadMultiTouch = false;
        this.gestureMovedPx = 0;
        this.gestureStartTime = performance.now();
        this.dragButton = e.button;
      }

      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        pointerType: e.pointerType,
      });

      if (this.pointers.size >= 2) {
        this.gestureHadMultiTouch = true;
        const m = this.getTwoPointerMetrics();
        this.lastPinchDist = m.dist;
        this.lastCentroidX = m.cx;
        this.lastCentroidY = m.cy;
      }

      try {
        this.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture is unsupported on synthetic test events
      }
    });

    this.domElement.addEventListener('pointermove', (e) => {
      const tracked = this.pointers.get(e.pointerId);
      if (!tracked) return;

      const dx = e.clientX - tracked.x;
      const dy = e.clientY - tracked.y;
      tracked.x = e.clientX;
      tracked.y = e.clientY;
      this.gestureMovedPx += Math.hypot(dx, dy);

      // TWO-FINGER TOUCH GESTURE: Smooth pinch-to-zoom & 2-finger pan/walk!
      if (this.pointers.size === 2) {
        const m = this.getTwoPointerMetrics();
        const pinchDelta = m.dist - this.lastPinchDist;
        const panDx = m.cx - this.lastCentroidX;
        const panDy = m.cy - this.lastCentroidY;
        this.lastPinchDist = m.dist;
        this.lastCentroidX = m.cx;
        this.lastCentroidY = m.cy;

        if (this.mode === 'aerial') {
          if (Math.abs(pinchDelta) > 0.2) {
            const factor = Math.exp(-pinchDelta * 0.0052);
            this.desiredSpherical.radius = clamp(this.desiredSpherical.radius * factor, 3.5, 280);
          }
          const panSpeed = clamp(this.desiredSpherical.radius * 0.0018, 0.03, 0.45);
          this.panGroundPlane(panDx, panDy, panSpeed);
        } else {
          // Ground mode: pinch forward/back + 2-finger drag moves cleanly across terrain!
          const fwd = new THREE.Vector3(-Math.sin(this.desiredWalkYaw), 0, -Math.cos(this.desiredWalkYaw));
          const right = new THREE.Vector3(Math.cos(this.desiredWalkYaw), 0, -Math.sin(this.desiredWalkYaw));
          const step = new THREE.Vector3();
          step.addScaledVector(fwd, pinchDelta * 0.08 + panDy * 0.045);
          step.addScaledVector(right, -panDx * 0.045);
          if (step.lengthSq() > 1e-6) {
            this.tryStepWalk(step);
          }
        }
        return;
      }

      // SINGLE-POINTER GESTURE: Orbit / Pan (Mouse) or Touch Rotate
      if (this.pointers.size === 1) {
        const isTouch = tracked.pointerType === 'touch';
        const rotSens = isTouch ? 0.0052 : 0.0046;

        if (this.mode === 'aerial') {
          if (!isTouch && (this.dragButton === 2 || this.dragButton === 1 || e.shiftKey)) {
            const panSpeed = clamp(this.desiredSpherical.radius * 0.0016, 0.02, 0.42);
            this.panGroundPlane(dx, dy, panSpeed);
          } else {
            this.desiredSpherical.theta -= dx * rotSens;
            this.desiredSpherical.phi = clamp(this.desiredSpherical.phi - dy * rotSens * 0.92, 0.10, 1.50);
          }
        } else {
          // Ground-level look around
          this.desiredWalkYaw -= dx * rotSens * 0.95;
          this.desiredWalkPitch = clamp(this.desiredWalkPitch - dy * rotSens * 0.85, -0.85, 1.22);
        }
      }
    });

    const handlePointerEnd = (e: PointerEvent) => {
      const tracked = this.pointers.get(e.pointerId);
      if (tracked) {
        const elapsed = performance.now() - this.gestureStartTime;
        const distFromStart = Math.hypot(e.clientX - tracked.startX, e.clientY - tracked.startY);
        if (
          this.pointers.size === 1 &&
          !this.gestureHadMultiTouch &&
          distFromStart < 10 &&
          this.gestureMovedPx < 14 &&
          elapsed < 1200 &&
          (tracked.pointerType === 'touch' || e.button === 0)
        ) {
          this.lastTapClean = true;
        }
        this.pointers.delete(e.pointerId);
      }
      if (this.pointers.size === 2) {
        const m = this.getTwoPointerMetrics();
        this.lastPinchDist = m.dist;
        this.lastCentroidX = m.cx;
        this.lastCentroidY = m.cy;
      }
    };

    this.domElement.addEventListener('pointerup', handlePointerEnd);
    this.domElement.addEventListener('pointercancel', handlePointerEnd);
    this.domElement.addEventListener('lostpointercapture', (e) => {
      this.pointers.delete(e.pointerId);
    });
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.keys.clear();
    });
    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.domElement.addEventListener(
      'wheel',
      (e) => {
        if (this.introActive) return;
        e.preventDefault();
        this.transitioning = false;
        if (this.mode === 'aerial') {
          const zoomFactor = 1 + Math.sign(e.deltaY) * 0.11;
          this.desiredSpherical.radius = clamp(this.desiredSpherical.radius * zoomFactor, 3.5, 280);
        } else {
          const fwd = new THREE.Vector3(-Math.sin(this.desiredWalkYaw), 0, -Math.cos(this.desiredWalkYaw));
          this.tryStepWalk(fwd.multiplyScalar(-Math.sign(e.deltaY) * 2.1));
        }
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const code = e.code;
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Space',
          'ShiftLeft',
          'ShiftRight',
          'KeyQ',
          'KeyE',
          'KeyC',
        ].includes(code)
      ) {
        if (!this.introActive) this.transitioning = false;
        this.keys.add(code);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private canStandAt(x: number, z: number): boolean {
    if (x < WORLD_MIN_X || x > WORLD_MAX_X || z < WORLD_MIN_Z || z > WORLD_MAX_Z) return false;
    const water = isPointInWater(x, z);
    const slope = getTerrainSlope(x, z);
    // Allow generous slope traversal & shallow stream wading — only prevent walking straight up sheer cliffs or deep plunge pool!
    if (water.inWater && water.depth > 1.35) return false;
    if (slope > 0.72) return false;
    return true;
  }

  // Smooth axis-sliding terrain movement — ZERO frustrating invisible walls or getting stuck on slopes!
  private tryStepWalk(delta: THREE.Vector3) {
    const cx = this.desiredWalkPos.x;
    const cz = this.desiredWalkPos.z;
    const nx = clamp(cx + delta.x, WORLD_MIN_X, WORLD_MAX_X);
    const nz = clamp(cz + delta.z, WORLD_MIN_Z, WORLD_MAX_Z);

    if (this.canStandAt(nx, nz)) {
      this.desiredWalkPos.x = nx;
      this.desiredWalkPos.z = nz;
      this.desiredWalkPos.y = getTerrainHeight(nx, nz) + 1.95;
      return;
    }

    // Slide cleanly along X or Z if hitting a sheer cliff wall or deep river pool edge
    if (Math.abs(delta.x) > 1e-4 && this.canStandAt(nx, cz)) {
      this.desiredWalkPos.x = nx;
      this.desiredWalkPos.y = getTerrainHeight(nx, cz) + 1.95;
      return;
    }
    if (Math.abs(delta.z) > 1e-4 && this.canStandAt(cx, nz)) {
      this.desiredWalkPos.z = nz;
      this.desiredWalkPos.y = getTerrainHeight(cx, nz) + 1.95;
    }
  }

  public update(time: number, dt: number) {
    const safeDt = Math.min(dt, 0.05);

    if (this.introActive) {
      const hero = VISTAS[0];
      const swayX = Math.sin(time * 0.14) * 3.4;
      const swayY = Math.cos(time * 0.11) * 0.9;
      this.camera.position.set(hero.position.x + swayX, hero.position.y + swayY, hero.position.z);
      this.currentLookAt.set(hero.target.x, hero.target.y + Math.sin(time * 0.16) * 0.3, hero.target.z);
      this.camera.lookAt(this.currentLookAt);
      this.target.copy(this.currentLookAt);
      this.desiredTarget.copy(this.currentLookAt);
      this.syncSphericalFromCamera();
      return;
    }

    if (this.transitioning) {
      this.transT = clamp(this.transT + safeDt / this.transDuration, 0, 1);
      const ease =
        this.transT < 0.5
          ? 16 * Math.pow(this.transT, 5)
          : 1 - Math.pow(-2 * this.transT + 2, 5) / 2;

      this.camera.position.lerpVectors(this.transStartPos, this.transEndPos, ease);
      const travelDist = this.transStartPos.distanceTo(this.transEndPos);
      if (travelDist > 30) {
        this.camera.position.y += Math.sin(ease * Math.PI) * Math.min(14, travelDist * 0.12);
      }

      const minY = getTerrainHeight(this.camera.position.x, this.camera.position.z) + 1.6;
      if (this.camera.position.y < minY) this.camera.position.y = minY;

      this.currentLookAt.lerpVectors(this.transStartLook, this.transEndLook, ease);
      this.camera.lookAt(this.currentLookAt);

      if (this.transT >= 1) {
        this.transitioning = false;
        this.mode = this.transEndMode;
        this.target.copy(this.transEndLook);
        this.desiredTarget.copy(this.transEndLook);
        if (this.mode === 'ground') {
          this.syncWalkFromCamera();
        } else {
          this.syncSphericalFromCamera();
        }
        this.onModeChange?.(this.mode);
      }
      return;
    }

    const damp = 1 - Math.exp(-7.2 * safeDt);
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.85 : 1.0;

    if (this.mode === 'aerial') {
      const moveSpeed = clamp(this.desiredSpherical.radius * 0.65, 16, 68) * boost * safeDt;
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0.0001) forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();

      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.desiredTarget.addScaledVector(forward, moveSpeed);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.desiredTarget.addScaledVector(forward, -moveSpeed);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.desiredTarget.addScaledVector(right, moveSpeed);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.desiredTarget.addScaledVector(right, -moveSpeed);
      if (this.keys.has('KeyE') || this.keys.has('Space')) this.desiredTarget.y += moveSpeed * 0.72;
      if (this.keys.has('KeyQ') || this.keys.has('KeyC')) this.desiredTarget.y -= moveSpeed * 0.72;

      this.desiredTarget.x = clamp(this.desiredTarget.x, WORLD_MIN_X, WORLD_MAX_X);
      this.desiredTarget.z = clamp(this.desiredTarget.z, WORLD_MIN_Z, WORLD_MAX_Z);
      const targetFloor = getTerrainHeight(this.desiredTarget.x, this.desiredTarget.z) + 1.2;
      this.desiredTarget.y = clamp(this.desiredTarget.y, targetFloor, 165);

      this.target.lerp(this.desiredTarget, damp);
      this.spherical.radius = lerp(this.spherical.radius, this.desiredSpherical.radius, damp);
      this.spherical.phi = lerp(this.spherical.phi, this.desiredSpherical.phi, damp);
      this.spherical.theta = lerp(this.spherical.theta, this.desiredSpherical.theta, damp);

      const offset = new THREE.Vector3().setFromSpherical(this.spherical);
      this.camera.position.copy(this.target).add(offset);

      const camGround = getTerrainHeight(this.camera.position.x, this.camera.position.z);
      const water = isPointInWater(this.camera.position.x, this.camera.position.z);
      const minCamY = Math.max(camGround, water.inWater ? water.waterY : -100) + 1.5;
      if (this.camera.position.y < minCamY) {
        this.camera.position.y = lerp(this.camera.position.y, minCamY, clamp(safeDt * 18, 0.35, 1));
      }

      this.currentLookAt.copy(this.target);
      this.camera.lookAt(this.currentLookAt);
    } else {
      // UNRESTRICTED GROUND-LEVEL EXPLORATION
      const walkSpeed = 10.5 * boost * safeDt;
      const fwd = new THREE.Vector3(-Math.sin(this.desiredWalkYaw), 0, -Math.cos(this.desiredWalkYaw));
      const right = new THREE.Vector3(Math.cos(this.desiredWalkYaw), 0, -Math.sin(this.desiredWalkYaw));
      const step = new THREE.Vector3();

      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) step.add(fwd);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) step.sub(fwd);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) step.add(right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) step.sub(right);

      if (step.lengthSq() > 0.0001) {
        step.normalize().multiplyScalar(walkSpeed);
        this.tryStepWalk(step);
      }

      this.walkPos.lerp(this.desiredWalkPos, damp);
      this.walkYaw = lerp(this.walkYaw, this.desiredWalkYaw, damp * 1.45);
      this.walkPitch = lerp(this.walkPitch, this.desiredWalkPitch, damp * 1.45);

      const groundY = getTerrainHeight(this.walkPos.x, this.walkPos.z) + 1.95;
      this.walkPos.y = lerp(this.walkPos.y, groundY, clamp(damp * 1.35, 0, 1));

      this.camera.position.copy(this.walkPos);
      const lookDir = new THREE.Vector3(
        -Math.sin(this.walkYaw) * Math.cos(this.walkPitch),
        Math.sin(this.walkPitch),
        -Math.cos(this.walkYaw) * Math.cos(this.walkPitch)
      );
      this.currentLookAt.copy(this.walkPos).addScaledVector(lookDir, 15);
      this.camera.lookAt(this.currentLookAt);
    }
  }
}
