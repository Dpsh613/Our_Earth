import * as THREE from 'three';
import { clamp, fbm2D, lerp, mulberry32, smoothstep, voronoiEdge2D } from './noise';

export interface WorldTextures {
  barkMap: THREE.CanvasTexture;
  barkNormal: THREE.DataTexture;
  charredBarkMap: THREE.CanvasTexture;
  charredBarkNormal: THREE.DataTexture;
  burnedCanopyMap: THREE.CanvasTexture;
  fossilBoneMap: THREE.CanvasTexture;
  crackedMap: THREE.CanvasTexture;
  crackedNormal: THREE.DataTexture;
  rockMap: THREE.CanvasTexture;
  rockNormal: THREE.DataTexture;
  grassGroundMap: THREE.CanvasTexture;
  ancientLeafMap: THREE.CanvasTexture;
  coniferBoughMap: THREE.CanvasTexture;
  broadleafMap: THREE.CanvasTexture;
  fernFrondMap: THREE.CanvasTexture;
  cloudPuffMap: THREE.CanvasTexture;
  rustMap: THREE.CanvasTexture;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function heightToNormalTexture(
  heights: Float32Array,
  size: number,
  strength: number
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const hL = heights[y * size + xm];
      const hR = heights[y * size + xp];
      const hD = heights[ym * size + x];
      const hU = heights[yp * size + x];

      const dx = (hL - hR) * strength;
      const dy = (hD - hU) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);

      const idx = (y * size + x) * 4;
      data[idx] = Math.round((dx * invLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function configureRepeat(tex: THREE.CanvasTexture, srgb = true): THREE.CanvasTexture {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function tileableFbm(u: number, v: number, freqX: number, freqY: number, octaves = 4): number {
  // Periodic torus mapping approximation for seamless textures using blended 2D noise
  const x = u * freqX;
  const y = v * freqY;
  // Blend periodic wrap
  const n00 = fbm2D(x, y, octaves);
  const n10 = fbm2D(x - freqX, y, octaves);
  const n01 = fbm2D(x, y - freqY, octaves);
  const n11 = fbm2D(x - freqX, y - freqY, octaves);
  const wx = smoothstep(0, 1, u);
  const wy = smoothstep(0, 1, v);
  return lerp(lerp(n00, n10, wx), lerp(n01, n11, wx), wy);
}

function generateBarkTextures(size = 512): { map: THREE.CanvasTexture; normal: THREE.DataTexture } {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Longitudinal twisted furrows
      const twist = tileableFbm(u, v, 3, 2, 3) * 0.14;
      const ridgeAngle = (u + twist) * Math.PI * 2 * 14;
      const primaryFurrow = Math.sin(ridgeAngle) * 0.5 + 0.5;
      const fineNoise = tileableFbm(u, v, 24, 6, 4) * 0.5 + 0.5;
      const deepCrevice = smoothstep(0.18, 0.72, primaryFurrow * 0.68 + fineNoise * 0.42);
      const horizontalCrack = smoothstep(0.35, 0.85, tileableFbm(u, v, 6, 18, 3) * 0.5 + 0.5);
      const h = clamp(deepCrevice * 0.78 + horizontalCrack * 0.22, 0, 1);
      heights[y * size + x] = h;

      // Rich organic ancient bark color: warm umber in crevices, weathered cedar-oak on ridges, subtle moss specks
      const mossPatch = smoothstep(0.56, 0.76, tileableFbm(u + 0.3, v + 0.1, 7, 7, 3) * 0.5 + 0.5) * (1 - h * 0.65);

      let r = lerp(64, 152, h);
      let g = lerp(50, 128, h);
      let b = lerp(39, 104, h);

      // Subtle silver-gray lichen on high ridges
      const lichen = smoothstep(0.74, 0.94, h * fineNoise);
      r = lerp(r, 176, lichen * 0.42);
      g = lerp(g, 172, lichen * 0.42);
      b = lerp(b, 156, lichen * 0.42);

      // Deep woodland moss nestled in crevices
      r = lerp(r, 68, mossPatch * 0.65);
      g = lerp(g, 108, mossPatch * 0.65);
      b = lerp(b, 52, mossPatch * 0.65);

      const idx = (y * size + x) * 4;
      img.data[idx] = clamp(Math.round(r), 0, 255);
      img.data[idx + 1] = clamp(Math.round(g), 0, 255);
      img.data[idx + 2] = clamp(Math.round(b), 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = configureRepeat(new THREE.CanvasTexture(canvas), true);
  const normal = heightToNormalTexture(heights, size, 4.2);
  return { map, normal };
}

function generateCrackedEarthTextures(size = 512): { map: THREE.CanvasTexture; normal: THREE.DataTexture } {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);

  const cells = 11;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Warp coordinates gently so cracks look like dried clay plates, not stiff geometry
      const wx = tileableFbm(u, v, 5, 5, 3) * 0.28;
      const wy = tileableFbm(u + 0.5, v + 0.5, 5, 5, 3) * 0.28;
      // Make Voronoi periodic on [0, cells) by wrapping in voronoi
      const vx = ((u * cells + wx) % cells + cells) % cells;
      const vy = ((v * cells + wy) % cells + cells) % cells;
      const v1 = voronoiEdge2D(vx, vy);
      const v2 = voronoiEdge2D(vx * 2.1 + 3.1, vy * 2.1 + 1.7);

      const mainCrack = smoothstep(0.035, 0.14, v1.edge);
      const subCrack = smoothstep(0.02, 0.09, v2.edge);
      // Slight cupped plate edges curling upward near cracks
      const cup = smoothstep(0.08, 0.25, v1.edge) * (1 - smoothstep(0.25, 0.65, v1.edge)) * 0.22;
      const grit = tileableFbm(u, v, 18, 18, 3) * 0.12;

      const h = clamp(mainCrack * (0.72 + subCrack * 0.22) + cup + grit, 0, 1);
      heights[y * size + x] = h;

      // Parched earth palette: deep shadowed fissures, weathered dusty ochre-taupe clay plates
      const plateVar = (Math.sin(v1.cellId * 4.3) * 0.5 + 0.5) * 0.18;
      const r = lerp(46, 168 + plateVar * 26, h);
      const g = lerp(39, 146 + plateVar * 20, h);
      const b = lerp(34, 122 + plateVar * 16, h);

      const idx = (y * size + x) * 4;
      img.data[idx] = clamp(Math.round(r), 0, 255);
      img.data[idx + 1] = clamp(Math.round(g), 0, 255);
      img.data[idx + 2] = clamp(Math.round(b), 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = configureRepeat(new THREE.CanvasTexture(canvas), true);
  const normal = heightToNormalTexture(heights, size, 5.2);
  return { map, normal };
}

function generateRockTextures(size = 512): { map: THREE.CanvasTexture; normal: THREE.DataTexture } {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Horizontal geological strata + diagonal fracture lines
      const strataWarp = tileableFbm(u, v, 4, 4, 3) * 0.12;
      const strata = Math.sin((v + strataWarp) * Math.PI * 2 * 9) * 0.5 + 0.5;
      const micro = tileableFbm(u, v, 16, 16, 4) * 0.5 + 0.5;
      const fracture = smoothstep(0.05, 0.24, voronoiEdge2D(u * 6, v * 6).edge);
      const h = clamp(strata * 0.42 + micro * 0.43 + fracture * 0.15, 0, 1);
      heights[y * size + x] = h;

      // Slate basalt & weathered granite tones with natural sunlit legibility
      const warmMineral = smoothstep(0.52, 0.85, tileableFbm(u + 0.2, v + 0.4, 7, 7, 3) * 0.5 + 0.5);
      let r = lerp(78, 166, h);
      let g = lerp(80, 162, h);
      let b = lerp(85, 158, h);
      r = lerp(r, 168, warmMineral * 0.32);
      g = lerp(g, 148, warmMineral * 0.32);
      b = lerp(b, 124, warmMineral * 0.32);

      const idx = (y * size + x) * 4;
      img.data[idx] = clamp(Math.round(r), 0, 255);
      img.data[idx + 1] = clamp(Math.round(g), 0, 255);
      img.data[idx + 2] = clamp(Math.round(b), 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = configureRepeat(new THREE.CanvasTexture(canvas), true);
  const normal = heightToNormalTexture(heights, size, 3.6);
  return { map, normal };
}

function generateGrassGroundTexture(size = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const macro = tileableFbm(u, v, 5, 5, 4) * 0.5 + 0.5;
      const micro = tileableFbm(u, v, 24, 24, 3) * 0.5 + 0.5;
      const t = clamp(macro * 0.65 + micro * 0.35, 0, 1);

      const r = lerp(42, 92, t);
      const g = lerp(64, 126, t);
      const b = lerp(31, 56, t);
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round(r);
      img.data[idx + 1] = Math.round(g);
      img.data[idx + 2] = Math.round(b);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return configureRepeat(new THREE.CanvasTexture(canvas), true);
}

// High-detail botanical leaf spray card for the Ancient Tree (individual veined leaves on fine twigs)
function generateAncientLeafCard(size = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(40411);

  // Draw delicate branching twigs first
  ctx.strokeStyle = '#3b2c20';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.96);
  ctx.quadraticCurveTo(size * 0.48, size * 0.55, size * 0.51, size * 0.16);
  ctx.stroke();

  const branches = [
    [0.5, 0.78, 0.22, 0.54],
    [0.5, 0.74, 0.78, 0.52],
    [0.49, 0.56, 0.18, 0.32],
    [0.5, 0.52, 0.82, 0.30],
    [0.5, 0.34, 0.28, 0.14],
    [0.51, 0.32, 0.74, 0.15],
  ];
  ctx.lineWidth = 3.5;
  for (const [x0, y0, x1, y1] of branches) {
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.quadraticCurveTo(size * ((x0 + x1) * 0.5), size * (y0 - 0.06), size * x1, size * y1);
    ctx.stroke();
  }

  function drawLeaf(cx: number, cy: number, angle: number, len: number, wid: number, tone: number) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // High-contrast painterly leaf shading (deep forest emerald base -> vibrant sunlit leaf tip)
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    const rBase = Math.round(lerp(24, 62, tone));
    const gBase = Math.round(lerp(56, 112, tone));
    const bBase = Math.round(lerp(26, 42, tone));
    const rTip = Math.round(lerp(54, 136, tone));
    const gTip = Math.round(lerp(116, 184, tone));
    const bTip = Math.round(lerp(36, 56, tone));
    grad.addColorStop(0, `rgb(${rBase},${gBase},${bBase})`);
    grad.addColorStop(0.65, `rgb(${Math.round((rBase + rTip) * 0.48)},${Math.round((gBase + gTip) * 0.5)},${bBase})`);
    grad.addColorStop(1, `rgb(${rTip},${gTip},${bTip})`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-wid, -len * 0.24, -wid * 0.9, -len * 0.74, 0, -len);
    ctx.bezierCurveTo(wid * 0.9, -len * 0.74, wid, -len * 0.24, 0, 0);
    ctx.closePath();
    ctx.fill();

    // Subtle dark botanical outline & central vein for crisp individual leaf separation
    ctx.strokeStyle = `rgba(18, 36, 16, 0.32)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.strokeStyle = `rgba(${rTip + 24}, ${gTip + 24}, ${bTip + 12}, 0.42)`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.08);
    ctx.lineTo(0, -len * 0.86);
    ctx.stroke();

    ctx.restore();
  }

  // Airy, lacy botanical spray (~38 distinct leaves arranged around twigs so sky filters organically through!)
  for (let i = 0; i < 38; i++) {
    const a = rand() * Math.PI * 2;
    const r = (0.14 + Math.pow(rand(), 0.78) * 0.34) * size;
    const cx = size * 0.5 + Math.cos(a) * r;
    const cy = size * 0.48 + Math.sin(a) * r * 0.88;
    const outwardAngle = Math.atan2(cy - size * 0.58, cx - size * 0.5) + Math.PI * 0.5 + (rand() - 0.5) * 0.85;
    const len = size * (0.095 + rand() * 0.075);
    const wid = len * (0.32 + rand() * 0.12);
    const heightLight = clamp(1 - cy / size, 0, 1);
    const tone = clamp(heightLight * 0.55 + rand() * 0.45, 0, 1);
    drawLeaf(cx, cy, outwardAngle, len, wid, tone);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Feathery conifer bough card for pine/spruce/cedar forests
function generateConiferBoughCard(size = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(99121);

  ctx.lineCap = 'round';
  // Central stem + lateral sub-shoots
  const drawShoot = (x0: number, y0: number, x1: number, y1: number, needleLen: number, count: number) => {
    ctx.strokeStyle = '#3a2b1e';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const bx = lerp(x0, x1, t);
      const by = lerp(y0, y1, t);
      for (const side of [-1, 1]) {
        const na = ang + side * (0.48 + rand() * 0.42);
        const len = needleLen * (0.55 + 0.55 * (1 - t * 0.45)) * (0.8 + rand() * 0.35);
        const tone = clamp(t * 0.45 + rand() * 0.45, 0, 1);
        const r = Math.round(lerp(24, 62, tone));
        const g = Math.round(lerp(56, 114, tone));
        const b = Math.round(lerp(34, 54, tone));
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = 2.6 + rand() * 1.4;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(na) * len, by + Math.sin(na) * len);
        ctx.stroke();
      }
    }
  };

  drawShoot(size * 0.5, size * 0.94, size * 0.5, size * 0.1, size * 0.12, 46);
  drawShoot(size * 0.5, size * 0.8, size * 0.16, size * 0.56, size * 0.095, 28);
  drawShoot(size * 0.5, size * 0.8, size * 0.84, size * 0.56, size * 0.095, 28);
  drawShoot(size * 0.5, size * 0.62, size * 0.14, size * 0.36, size * 0.09, 26);
  drawShoot(size * 0.5, size * 0.62, size * 0.86, size * 0.36, size * 0.09, 26);
  drawShoot(size * 0.5, size * 0.42, size * 0.24, size * 0.18, size * 0.08, 22);
  drawShoot(size * 0.5, size * 0.42, size * 0.76, size * 0.18, size * 0.08, 22);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Broadleaf deciduous tree foliage spray
function generateBroadleafCard(size = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(77312);

  for (let i = 0; i < 64; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.65) * size * 0.39;
    const cx = size * 0.5 + Math.cos(a) * r;
    const cy = size * 0.5 + Math.sin(a) * r;
    const rot = rand() * Math.PI * 2;
    const len = size * (0.1 + rand() * 0.085);
    const wid = len * 0.46;
    const tone = clamp((1 - cy / size) * 0.55 + rand() * 0.45, 0, 1);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = `rgb(${Math.round(lerp(56, 128, tone))},${Math.round(lerp(94, 168, tone))},${Math.round(lerp(34, 58, tone))})`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-wid, -len * 0.3, -wid * 0.8, -len * 0.8, 0, -len);
    ctx.bezierCurveTo(wid * 0.8, -len * 0.8, wid, -len * 0.3, 0, 0);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Sword fern frond card
function generateFernFrondCard(size = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);

  // Central rachis stem
  ctx.strokeStyle = '#3b6628';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.98);
  ctx.lineTo(size * 0.5, size * 0.04);
  ctx.stroke();

  const pairs = 22;
  for (let i = 0; i < pairs; i++) {
    const t = i / (pairs - 1);
    const y = lerp(size * 0.92, size * 0.08, t);
    const envelope = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.95 + 0.08;
    const pinnaLen = size * 0.42 * envelope;
    const pinnaW = size * 0.025 * (0.65 + 0.35 * envelope);

    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(size * 0.5, y);
      ctx.rotate(side * (-0.28 - t * 0.22));
      const grad = ctx.createLinearGradient(0, 0, side * pinnaLen, 0);
      grad.addColorStop(0, '#366924');
      grad.addColorStop(0.65, '#599432');
      grad.addColorStop(1, '#84b844');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -pinnaW * 0.7);
      ctx.quadraticCurveTo(side * pinnaLen * 0.55, -pinnaW * 1.15, side * pinnaLen, 0);
      ctx.quadraticCurveTo(side * pinnaLen * 0.55, pinnaW * 1.15, 0, pinnaW * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Soft organic FBM cloud & mist puff
function generateCloudPuff(size = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const ny = (y / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const dist = Math.hypot(nx, ny);
      const radial = Math.pow(clamp(1 - dist, 0, 1), 1.65);
      const n = fbm2D(nx * 2.4 + 4.1, ny * 2.4 - 2.3, 4) * 0.5 + 0.5;
      const alpha = clamp(radial * (0.45 + n * 0.95) * 1.15 - 0.08, 0, 1);

      // Subtle vertical self-shading baked into RGB
      const shade = clamp(0.74 + (-ny * 0.22) + n * 0.14, 0.55, 1.0);
      const c = Math.round(shade * 255);
      const idx = (y * size + x) * 4;
      img.data[idx] = c;
      img.data[idx + 1] = c;
      img.data[idx + 2] = c;
      img.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Weathered rusted iron texture for subtle human relics
function generateRustTexture(size = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = tileableFbm(u, v, 8, 8, 4) * 0.5 + 0.5;
      const n2 = tileableFbm(u + 0.3, v + 0.2, 20, 20, 3) * 0.5 + 0.5;
      const rust = smoothstep(0.32, 0.72, n1 * 0.7 + n2 * 0.3);
      const r = lerp(52, 134, rust);
      const g = lerp(50, 68, rust);
      const b = lerp(48, 42, rust);
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round(r);
      img.data[idx + 1] = Math.round(g);
      img.data[idx + 2] = Math.round(b);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return configureRepeat(new THREE.CanvasTexture(canvas), true);
}

// Blistered carbon-black charred "alligator-skin" burned bark + ash-dusted fissures (inspired by burned-land-2.jpg)
function generateCharredBarkTextures(size = 512): { map: THREE.CanvasTexture; normal: THREE.DataTexture } {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Deep vertical bark furrows intersected by horizontal heat-blister alligator cracks!
      const twist = tileableFbm(u, v, 3, 2, 3) * 0.1;
      const vCrack = Math.pow(Math.abs(Math.sin((u + twist) * Math.PI * 18)), 0.45);
      const cell = voronoiEdge2D(((u * 14) % 14 + 14) % 14, ((v * 24) % 24 + 24) % 24);
      const blister = smoothstep(0.04, 0.19, cell.edge);
      const grit = tileableFbm(u, v, 26, 26, 3) * 0.5 + 0.5;
      const h = clamp(vCrack * 0.52 * blister + blister * 0.36 + grit * 0.14, 0, 1);
      heights[y * size + x] = h;

      // Deep matte carbon-black charred wood with pale wood-ash caught on dry blistered ridges
      const ashDust = smoothstep(0.68, 0.92, h * (0.65 + 0.35 * grit));
      let r = lerp(14, 44, h);
      let g = lerp(13, 40, h);
      let b = lerp(13, 38, h);

      // Ash-white weathered char flecks on protruding blister scales
      r = lerp(r, 118, ashDust * 0.45);
      g = lerp(g, 112, ashDust * 0.45);
      b = lerp(b, 105, ashDust * 0.45);

      const idx = (y * size + x) * 4;
      img.data[idx] = clamp(Math.round(r), 0, 255);
      img.data[idx + 1] = clamp(Math.round(g), 0, 255);
      img.data[idx + 2] = clamp(Math.round(b), 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: configureRepeat(new THREE.CanvasTexture(canvas), true),
    normal: heightToNormalTexture(heights, size, 5.5),
  };
}

// Lacy scorched skeletal branch & burnt-needle canopy card (inspired by burned land.jpg & burned-land-2.jpg)
function generateBurnedCanopyCard(size = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(88421);

  ctx.lineCap = 'round';
  const drawCharredLimb = (x0: number, y0: number, len: number, ang: number, width: number, depth: number) => {
    if (depth <= 0 || len < 10) return;
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    const mx = (x0 + x1) * 0.5 + (rand() - 0.5) * len * 0.22;
    const my = (y0 + y1) * 0.5 + (rand() - 0.5) * len * 0.22;

    const charShade = Math.round(lerp(18, 42, rand()));
    ctx.strokeStyle = `rgb(${charShade + 4},${charShade},${charShade - 2})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();

    // Sparse brittle burnt-rust dead needle/leaf wisps clinging to fine scorched twigs
    if (depth <= 2) {
      const wisps = 4 + Math.floor(rand() * 5);
      for (let w = 0; w < wisps; w++) {
        const f = 0.25 + rand() * 0.72;
        const wx = lerp(x0, x1, f);
        const wy = lerp(y0, y1, f);
        const wa = ang + (rand() - 0.5) * 1.9;
        const wl = 9 + rand() * 18;
        const isRustDead = rand() > 0.62;
        ctx.strokeStyle = isRustDead ? 'rgba(72, 42, 26, 0.88)' : 'rgba(26, 23, 21, 0.92)';
        ctx.lineWidth = 1.5 + rand() * 1.6;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + Math.cos(wa) * wl, wy + Math.sin(wa) * wl);
        ctx.stroke();
      }
    }

    const forks = depth === 3 ? 3 : 2;
    for (let i = 0; i < forks; i++) {
      const startF = lerp(0.42, 0.96, i / Math.max(1, forks - 1));
      const sx = lerp(x0, x1, startF);
      const sy = lerp(y0, y1, startF);
      const side = i % 2 === 0 ? 1 : -1;
      const nextAng = ang + side * (0.38 + rand() * 0.55) + (rand() - 0.5) * 0.25;
      drawCharredLimb(sx, sy, len * (0.58 + rand() * 0.22), nextAng, width * 0.62, depth - 1);
    }
  };

  // Radiating gnarly burnt skeletal bough web
  drawCharredLimb(size * 0.5, size * 0.92, size * 0.36, -Math.PI * 0.5 + (rand() - 0.5) * 0.14, 9.5, 4);
  drawCharredLimb(size * 0.5, size * 0.78, size * 0.30, -Math.PI * 0.78, 6.8, 3);
  drawCharredLimb(size * 0.5, size * 0.78, size * 0.30, -Math.PI * 0.22, 6.8, 3);
  drawCharredLimb(size * 0.5, size * 0.56, size * 0.26, -Math.PI * 0.88, 5.2, 3);
  drawCharredLimb(size * 0.5, size * 0.56, size * 0.26, -Math.PI * 0.12, 5.2, 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Ancient weathered mineralized fossil bone texture (ivory-limestone with porous cracks & ochre mineralization)
function generateFossilBoneTexture(size = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const grain = tileableFbm(u, v, 6, 20, 4) * 0.5 + 0.5;
      const pore = tileableFbm(u + 0.3, v + 0.6, 24, 24, 3) * 0.5 + 0.5;
      const crack = smoothstep(0.03, 0.12, voronoiEdge2D(u * 8, v * 8).edge);
      const stain = smoothstep(0.45, 0.85, tileableFbm(u, v, 4, 4, 3) * 0.5 + 0.5);

      let r = lerp(155, 226, grain * 0.65 + pore * 0.35);
      let g = lerp(142, 214, grain * 0.65 + pore * 0.35);
      let b = lerp(120, 188, grain * 0.65 + pore * 0.35);

      // Mineral ochre-sediment aging patches & dark hairline fossil fractures
      r = lerp(r, 146, stain * 0.34);
      g = lerp(g, 124, stain * 0.34);
      b = lerp(b, 94, stain * 0.34);

      const crackShade = lerp(0.45, 1.0, crack);
      const idx = (y * size + x) * 4;
      img.data[idx] = clamp(Math.round(r * crackShade), 0, 255);
      img.data[idx + 1] = clamp(Math.round(g * crackShade), 0, 255);
      img.data[idx + 2] = clamp(Math.round(b * crackShade), 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return configureRepeat(new THREE.CanvasTexture(canvas), true);
}

let cachedTextures: WorldTextures | null = null;

export function getWorldTextures(): WorldTextures {
  if (cachedTextures) return cachedTextures;
  const bark = generateBarkTextures(512);
  const charredBark = generateCharredBarkTextures(512);
  const cracked = generateCrackedEarthTextures(512);
  const rock = generateRockTextures(512);

  cachedTextures = {
    barkMap: bark.map,
    barkNormal: bark.normal,
    charredBarkMap: charredBark.map,
    charredBarkNormal: charredBark.normal,
    burnedCanopyMap: generateBurnedCanopyCard(512),
    fossilBoneMap: generateFossilBoneTexture(256),
    crackedMap: cracked.map,
    crackedNormal: cracked.normal,
    rockMap: rock.map,
    rockNormal: rock.normal,
    grassGroundMap: generateGrassGroundTexture(512),
    ancientLeafMap: generateAncientLeafCard(512),
    coniferBoughMap: generateConiferBoughCard(512),
    broadleafMap: generateBroadleafCard(512),
    fernFrondMap: generateFernFrondCard(512),
    cloudPuffMap: generateCloudPuff(256),
    rustMap: generateRustTexture(256),
  };
  return cachedTextures;
}
