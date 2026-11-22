// Deterministic seeded PRNG & procedural noise library for THE EARTH REMEMBERS

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Fast 2D / 3D Perlin-style gradient noise with deterministic permutation table
const PERM = new Uint8Array(512);
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

(function initPerm() {
  const rand = mulberry32(19950527);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function noise2D(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[PERM[X] + Y] & 7;
  const ab = PERM[PERM[X] + Y + 1] & 7;
  const ba = PERM[PERM[X + 1] + Y] & 7;
  const bb = PERM[PERM[X + 1] + Y + 1] & 7;

  const gaa = GRAD2[aa];
  const gab = GRAD2[ab];
  const gba = GRAD2[ba];
  const gbb = GRAD2[bb];

  const x1 = lerp(gaa[0] * xf + gaa[1] * yf, gba[0] * (xf - 1) + gba[1] * yf, u);
  const x2 = lerp(gab[0] * xf + gab[1] * (yf - 1), gbb[0] * (xf - 1) + gbb[1] * (yf - 1), u);
  return lerp(x1, x2, v);
}

export function fbm2D(
  x: number,
  y: number,
  octaves = 5,
  lacunarity = 2.02,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(x * freq, y * freq);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

export function ridged2D(
  x: number,
  y: number,
  octaves = 5,
  lacunarity = 2.08,
  gain = 0.52
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2D(x * freq, y * freq));
    n = n * n * weight;
    weight = clamp(n * 1.8, 0, 1);
    sum += n * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

export function warpedFbm2D(x: number, y: number, warpStrength = 0.65, octaves = 4): number {
  const qx = fbm2D(x + 5.2, y + 1.3, 3);
  const qy = fbm2D(x + 1.7, y + 9.2, 3);
  return fbm2D(x + qx * warpStrength, y + qy * warpStrength, octaves);
}

// Hash for procedural cellular/Voronoi patterns (cracked earth, rocks)
export function hash2(ix: number, iy: number): [number, number] {
  const n1 = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  const n2 = Math.sin(ix * 269.5 + iy * 183.3) * 43758.5453123;
  return [n1 - Math.floor(n1), n2 - Math.floor(n2)];
}

export function voronoiEdge2D(x: number, y: number): { edge: number; cellId: number } {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  let md1 = 8.0;
  let md2 = 8.0;
  let bestId = 0;

  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [rx, ry] = hash2(ix + i, iy + j);
      const dx = i + rx - fx;
      const dy = j + ry - fy;
      const d = Math.hypot(dx, dy);
      if (d < md1) {
        md2 = md1;
        md1 = d;
        bestId = rx * 13.7 + ry * 7.3;
      } else if (d < md2) {
        md2 = d;
      }
    }
  }
  return { edge: md2 - md1, cellId: bestId };
}
