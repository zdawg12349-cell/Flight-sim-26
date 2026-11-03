// Generates the world colour map ("satellite imagery") and night-light mask on canvases.
import * as THREE from 'three';
import { LC, WORLD_HALF, WORLD_SIZE } from './worldgen.js';
import { AIRPORTS, toWorld, runwayEnds } from './airportData.js';
import { mulberry32, fbm, noise2, clamp } from '../core/math.js';
import { makeCanvas } from '../render/textures.js';

const BASE = {
  [LC.WATER]: [38, 72, 98], [LC.BEACH]: [196, 184, 146], [LC.GRASS]: [92, 118, 62], [LC.FARM]: [118, 128, 70],
  [LC.FOREST]: [44, 70, 38], [LC.URBAN]: [128, 126, 122], [LC.ROCK]: [118, 112, 104], [LC.SNOW]: [236, 240, 245],
  [LC.AIRPORT]: [104, 128, 70], [LC.SUBURB]: [112, 120, 96],
};
const CROPS = [[142, 150, 70], [176, 160, 92], [110, 136, 58], [150, 120, 78], [96, 120, 52], [190, 176, 110], [128, 108, 70], [84, 112, 48]];

export function generateColormap(world, size) {
  const N = world.N;
  const mpp = WORLD_SIZE / size;                     // metres per pixel
  const w2p = (x) => (x + WORLD_HALF) / WORLD_SIZE * size;
  // 1) base image at grid resolution
  const base = makeCanvas(N, N), bctx = base.getContext('2d');
  const img = bctx.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    const z = -WORLD_HALF + j * world.cell;
    for (let i = 0; i < N; i++) {
      const x = -WORLD_HALF + i * world.cell;
      const k = j * N + i;
      const lc = world.lc[k];
      const h = world.h[k];
      let [r, g, b] = BASE[lc];
      const n = fbm(x / 3000, z / 3000, 3) * 0.5 + noise2(x / 600, z / 600) * 0.25;
      let v = 1 + n * 0.28;
      if (lc === LC.WATER) {
        const depth = clamp(-h / 60, 0, 1);
        r = 52 - 24 * depth; g = 96 - 34 * depth; b = 112 - 22 * depth; v = 1;
        if (h > -4) { r += 30; g += 36; b += 18; }
      } else if (lc === LC.FOREST) {
        v = 0.9 + n * 0.35;
        if (h > 900) { r -= 6; g -= 4; b += 4; }
      } else if (lc === LC.GRASS && h > 1200) { r += 12; g -= 6; b -= 2; }
      img.data[k * 4] = clamp(r * v, 0, 255); img.data[k * 4 + 1] = clamp(g * v, 0, 255);
      img.data[k * 4 + 2] = clamp(b * v, 0, 255); img.data[k * 4 + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);

  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(base, 0, 0, size, size);

  const L = makeCanvas(1024, 1024), lctx = L.getContext('2d');
  lctx.fillStyle = '#000'; lctx.fillRect(0, 0, 1024, 1024);
  const lw = (x) => (x + WORLD_HALF) / WORLD_SIZE * 1024;

  const rnd = mulberry32(4242);
  // 2) Field patchwork in farmland
  const patch = 260;
  for (let z = -WORLD_HALF; z < WORLD_HALF; z += patch) {
    for (let x = -WORLD_HALF; x < WORLD_HALF; x += patch) {
      const lc = world.landclassAt(x + patch / 2, z + patch / 2);
      if (lc !== LC.FARM && lc !== LC.GRASS) continue;
      if (lc === LC.GRASS && rnd() < 0.6) continue;
      const ang = fbm(x / 9000, z / 9000, 2) * 1.2;
      const cols = 1 + Math.floor(rnd() * 3);
      for (let q = 0; q < cols; q++) {
        const col = CROPS[Math.floor(rnd() * CROPS.length)];
        const f = 0.85 + rnd() * 0.3;
        ctx.save();
        ctx.translate(w2p(x + patch * (0.2 + rnd() * 0.6)), w2p(z + patch * (0.2 + rnd() * 0.6)));
        ctx.rotate(ang);
        ctx.fillStyle = `rgb(${col[0] * f | 0},${col[1] * f | 0},${col[2] * f | 0})`;
        const fw = (90 + rnd() * 200) / mpp, fh = (60 + rnd() * 160) / mpp;
        ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
        ctx.restore();
      }
    }
  }
  // 3) Urban texture: street grid + blocks
  for (const t of world.towns) {
    const R = t.r * 1.1;
    const step = 85;
    for (let z = t.z - R; z < t.z + R; z += step) {
      for (let x = t.x - R; x < t.x + R; x += step) {
        const lc = world.landclassAt(x, z);
        if (lc !== LC.URBAN && lc !== LC.SUBURB) continue;
        const urban = lc === LC.URBAN;
        const g = urban ? 105 + rnd() * 40 : 120 + rnd() * 30;
        ctx.fillStyle = urban ? `rgb(${g | 0},${g - 2 | 0},${g - 6 | 0})` : `rgb(${g - 10 | 0},${g | 0},${g - 22 | 0})`;
        const s = (step - 18) / mpp;
        ctx.fillRect(w2p(x) - s / 2, w2p(z) - s / 2, s, s);
        if (!urban && rnd() < 0.5) {
          ctx.fillStyle = 'rgba(60,90,45,0.6)';
          ctx.fillRect(w2p(x) - s / 4, w2p(z) - s / 4, s / 2, s / 2);
        }
        // night lights
        const li = urban ? 0.9 : 0.45;
        lctx.fillStyle = `rgba(255,255,255,${li * (0.5 + rnd() * 0.5)})`;
        const ls = Math.max(1, (step - 20) / (WORLD_SIZE / 1024));
        lctx.fillRect(lw(x) - ls / 2, lw(z) - ls / 2, ls, ls);
      }
    }
  }
  // 4) River
  ctx.strokeStyle = 'rgb(46,84,104)'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, 55 / mpp);
  ctx.beginPath();
  world.river.forEach((p, i) => { const X = w2p(p[0]), Y = w2p(p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.stroke();
  // 5) Roads
  for (const r of world.roads) {
    const hw = r.kind === 'highway';
    ctx.strokeStyle = hw ? 'rgb(78,78,80)' : 'rgb(96,94,90)';
    ctx.lineWidth = Math.max(1, (r.w * 1.6) / mpp);
    ctx.beginPath();
    r.pts.forEach((p, i) => { const X = w2p(p[0]), Y = w2p(p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.stroke();
    lctx.strokeStyle = hw ? 'rgba(255,200,140,0.35)' : 'rgba(255,200,140,0.15)';
    lctx.lineWidth = 1;
    lctx.beginPath();
    r.pts.forEach((p, i) => { const X = lw(p[0]), Y = lw(p[1]); i ? lctx.lineTo(X, Y) : lctx.moveTo(X, Y); });
    lctx.stroke();
  }
  // 6) Airports
  for (const ap of AIRPORTS) {
    if (ap.type === 'heliport' || ap.type === 'offshore') continue;
    const fhR = ap.fh * Math.PI / 180;
    const quad = (u, v, w, l, rot, style) => {
      const [x, z] = toWorld(ap, u, v);
      ctx.save(); ctx.translate(w2p(x), w2p(z)); ctx.rotate(rot);
      ctx.fillStyle = style; ctx.fillRect(-w / 2 / mpp, -l / 2 / mpp, w / mpp, l / mpp);
      ctx.restore();
    };
    // airport grass (lighter, mowed)
    for (const rw of ap.runways) {
      const rot = (rw.hdg - 90) * Math.PI / 180;
      quad(rw.u, rw.v, rw.len + 500, rw.wid + 300, rot, 'rgba(122,146,80,0.9)');
    }
    for (const a of ap.aprons) quad(a.u, a.v, a.w, a.l, fhR - Math.PI / 2, 'rgb(150,148,142)');
    for (const t of ap.taxiways) {
      ctx.strokeStyle = 'rgb(110,110,108)'; ctx.lineWidth = Math.max(1, t.w / mpp);
      ctx.beginPath();
      t.pts.forEach((p, i) => { const [x, z] = toWorld(ap, p[0], p[1]); i ? ctx.lineTo(w2p(x), w2p(z)) : ctx.moveTo(w2p(x), w2p(z)); });
      ctx.stroke();
    }
    for (const rw of ap.runways) {
      const rot = (rw.hdg - 90) * Math.PI / 180;
      quad(rw.u, rw.v, rw.len, rw.wid, rot, rw.surface === 'grass' ? 'rgb(96,128,60)' : 'rgb(62,62,64)');
    }
    for (const b of ap.buildings) {
      if (!b.w) continue;
      quad(b.u, b.v, b.w, b.d, fhR - Math.PI / 2, 'rgb(170,170,168)');
    }
    // lights
    const [ax, az] = [ap.x, ap.z];
    lctx.fillStyle = 'rgba(255,240,210,0.8)';
    lctx.beginPath(); lctx.arc(lw(ax), lw(az), ap.type === 'international' ? 4 : 2, 0, Math.PI * 2); lctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const ltex = new THREE.CanvasTexture(L);
  ltex.wrapS = ltex.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas: c, texture: tex, lightCanvas: L, lightTexture: ltex };
}
