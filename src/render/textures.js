// Procedural canvas textures (generated once, shared everywhere).
import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Tileable value noise generated on a small lattice and smoothly interpolated with wrap.
function tileNoise(size, cells, seed) {
  const rnd = mulberry32(seed);
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = y / size * cells, iy = Math.floor(fy), ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = x / size * cells, ix = Math.floor(fx), tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells, x1 = (ix + 1) % cells, y0 = iy % cells, y1 = (iy + 1) % cells;
      const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1], c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function fractalTile(size, seed, octaves = [[4, 0.5], [8, 0.25], [16, 0.14], [32, 0.08], [64, 0.04]]) {
  const acc = new Float32Array(size * size);
  let norm = 0;
  octaves.forEach(([cells, amp], k) => {
    const n = tileNoise(size, cells, seed + k * 101);
    for (let i = 0; i < acc.length; i++) acc[i] += n[i] * amp;
    norm += amp;
  });
  for (let i = 0; i < acc.length; i++) acc[i] /= norm;
  return acc;
}

function toTexture(canvas, { srgb = true, repeat = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// RGB channels: R = fine detail, G = medium, B = coarse speckle. Linear data.
export function terrainDetailTexture() {
  return cached('terrainDetail', () => {
    const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const r = fractalTile(S, 11), g = fractalTile(S, 57, [[2, 0.5], [4, 0.3], [8, 0.2]]), b = fractalTile(S, 91, [[32, 0.5], [64, 0.5]]);
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      img.data[i * 4] = Math.min(255, r[i] * 255); img.data[i * 4 + 1] = Math.min(255, g[i] * 255);
      img.data[i * 4 + 2] = Math.min(255, b[i] * 255); img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false });
  });
}

export function asphaltTexture(tint = [70, 72, 76]) {
  return cached('asphalt' + tint.join(), () => {
    const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const n = fractalTile(S, 3, [[8, 0.3], [32, 0.3], [128, 0.4]]);
    const img = ctx.createImageData(S, S);
    const rnd = mulberry32(5);
    for (let i = 0; i < S * S; i++) {
      const v = 0.82 + n[i] * 0.3 + (rnd() - 0.5) * 0.12;
      img.data[i * 4] = tint[0] * v; img.data[i * 4 + 1] = tint[1] * v; img.data[i * 4 + 2] = tint[2] * v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

export function concreteTexture() {
  return cached('concrete', () => {
    const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const n = fractalTile(S, 21, [[4, 0.3], [16, 0.3], [64, 0.4]]);
    const img = ctx.createImageData(S, S);
    const rnd = mulberry32(9);
    for (let i = 0; i < S * S; i++) {
      const v = 0.86 + n[i] * 0.2 + (rnd() - 0.5) * 0.06;
      img.data[i * 4] = 168 * v; img.data[i * 4 + 1] = 166 * v; img.data[i * 4 + 2] = 160 * v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // expansion joints (texture covers 25 m, slabs 6.25 m)
    ctx.strokeStyle = 'rgba(60,60,58,0.55)'; ctx.lineWidth = 1.2;
    for (let k = 0; k <= 4; k++) {
      ctx.beginPath(); ctx.moveTo(k * S / 4, 0); ctx.lineTo(k * S / 4, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k * S / 4); ctx.lineTo(S, k * S / 4); ctx.stroke();
    }
    // stains
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = `rgba(40,38,34,${0.04 + rnd() * 0.06})`;
      ctx.beginPath(); ctx.ellipse(rnd() * S, rnd() * S, 4 + rnd() * 18, 3 + rnd() * 10, rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }
    return toTexture(c);
  });
}

export function grassTexture() {
  return cached('grass', () => {
    const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const n = fractalTile(S, 33, [[4, 0.3], [16, 0.3], [64, 0.4]]);
    const img = ctx.createImageData(S, S);
    const rnd = mulberry32(13);
    for (let i = 0; i < S * S; i++) {
      const v = 0.75 + n[i] * 0.45 + (rnd() - 0.5) * 0.15;
      img.data[i * 4] = 78 * v; img.data[i * 4 + 1] = 104 * v; img.data[i * 4 + 2] = 52 * v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

// Soft round sprite for lights / glows.
export function glowTexture() {
  return cached('glow', () => {
    const S = 64, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return toTexture(c, { srgb: false, repeat: false, aniso: 1 });
  });
}

// Cloud puff texture: soft lumpy blob, alpha in A, shading hint in G (top lit).
export function cloudPuffTexture() {
  return cached('cloud', () => {
    const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const n = fractalTile(S, 77, [[4, 0.45], [8, 0.3], [16, 0.15], [32, 0.1]]);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        const i = y * S + x;
        let a = Math.max(0, 1 - r * (0.85 + 0.5 * (n[i] - 0.5) * 2));
        a = Math.pow(a, 1.2) * (0.6 + 0.6 * n[i]);
        const shade = 0.55 + 0.45 * (1 - (dy + 1) / 2) + (n[i] - 0.5) * 0.3;
        img.data[i * 4] = 255; img.data[i * 4 + 1] = Math.max(0, Math.min(255, shade * 255)); img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = Math.max(0, Math.min(255, a * 255));
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = toTexture(c, { srgb: false, repeat: false, aniso: 1 });
    return t;
  });
}

export function noiseTexture() {
  return cached('noise', () => {
    const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
    const n = fractalTile(S, 201), m = fractalTile(S, 303);
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      img.data[i * 4] = n[i] * 255; img.data[i * 4 + 1] = m[i] * 255; img.data[i * 4 + 2] = (n[i] * 0.5 + m[i] * 0.5) * 255; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false });
  });
}

export { toTexture, fractalTile };
