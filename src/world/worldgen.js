// Procedural world: terrain heights, land classes, lakes, rivers, towns and roads.
// The macro height field is sampled into a grid at load; heightAt() adds bicubic
// interpolation, fine detail noise and exact airport flattening analytically so that
// physics and rendering agree.
import { fbm, ridged, noise2, smoothstep, clamp, lerp, mulberry32 } from '../core/math.js';
import { AIRPORTS, toWorld, frame, elevatedPlatforms } from './airportData.js';

export const WORLD_HALF = 40960;
export const WORLD_SIZE = WORLD_HALF * 2;
const GRID_N = 641;                 // samples per side
const CELL = WORLD_SIZE / (GRID_N - 1);

export const LC = { WATER: 0, BEACH: 1, GRASS: 2, FARM: 3, FOREST: 4, URBAN: 5, ROCK: 6, SNOW: 7, AIRPORT: 8, SUBURB: 9 };

export const TOWNS = [
  { name: 'Port Aurelia', x: 10800, z: 2600, r: 4200, tall: 1.0 },
  { name: 'Marlow', x: 9600, z: -16500, r: 1500, tall: 0.35 },
  { name: 'Birchfield', x: -14200, z: -9200, r: 950, tall: 0.15 },
  { name: 'Summit Village', x: 17200, z: -29300, r: 650, tall: 0.1 },
  { name: 'Coral Bay', x: -16600, z: 22600, r: 520, tall: 0.12 },
  { name: 'Eastbrook', x: 22000, z: -7000, r: 1200, tall: 0.25 },
  { name: 'Westhaven', x: -25500, z: 1500, r: 900, tall: 0.18 },
  { name: 'Oakridge', x: -5200, z: -12500, r: 800, tall: 0.12 },
  { name: 'Pinecrest', x: 26000, z: -19500, r: 850, tall: 0.12 },
  { name: 'Harborview', x: 20500, z: 3500, r: 1100, tall: 0.3 },
];

const LAKES = [
  { name: 'Lake Marlow', x: 1500, z: -13500, r: 1500 },
  { name: 'Crystal Lake', x: 6200, z: -34200, r: 850 },
  { name: 'Mirror Pond', x: -21000, z: -15500, r: 700 },
];

const RIVER = [[12500, -39000], [9500, -30500], [6200, -26500], [3200, -21500], [1500, -13500], [-1200, -7500], [-4800, -2600], [-6400, 2500], [-7600, 7000]];

export const ROADS = [
  // highways
  { w: 14, kind: 'highway', pts: [[1500, 120], [4000, 600], [7000, 1800], [10800, 2600], [15000, 3000], [20500, 3500], [26000, 4000], [34000, 4600]] },
  { w: 14, kind: 'highway', pts: [[10800, 2600], [10200, -3000], [9800, -9000], [9600, -16500], [8200, -19000], [7000, -20000]] },
  { w: 12, kind: 'highway', pts: [[-36000, 900], [-25500, 1500], [-16000, 1200], [-8000, 1000], [-3200, 600], [1500, 120]] },
  // regional roads
  { w: 9, kind: 'road', pts: [[-16000, 1200], [-15500, -3500], [-14200, -9200], [-16300, -7300]] },
  { w: 9, kind: 'road', pts: [[9600, -16500], [13500, -21500], [16200, -26000], [17200, -29300], [15800, -30600]] },
  { w: 9, kind: 'road', pts: [[10200, -3000], [16000, -5000], [22000, -7000], [25000, -13000], [26000, -19500]] },
  { w: 9, kind: 'road', pts: [[-3200, 600], [-4500, -6000], [-5200, -12500], [-9000, -15000], [-14200, -9200]] },
  { w: 8, kind: 'road', pts: [[-5200, -12500], [-500, -16500], [4000, -18500], [5500, -19700]] },
  { w: 8, kind: 'road', pts: [[22000, -7000], [21000, -1500], [20500, 3500]] },
  { w: 8, kind: 'road', pts: [[-15000, 20400], [-16600, 22600], [-17800, 23400]] },
  // airport access
  { w: 10, kind: 'road', pts: [[900, 0], [1300, 50], [1500, 120]] },
];

const ISLAND = { x: -15300, z: 21300, r: 3600 };

function coastZ(x) { return 4000 + 2200 * Math.sin(x / 8500 + 1.3) + 1400 * fbm(x / 5200, 3.7, 3); }

// Distance from point to polyline (2D) - used only during generation.
function distToPolyline(px, pz, pts) {
  let best = 1e12;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    const d = qx * qx + qz * qz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Flatten rectangles (in world space) for an airport, oriented by its frame.
function buildFlatZones() {
  const zones = [];
  for (const ap of AIRPORTS) {
    if (ap.type === 'heliport' || ap.type === 'offshore') continue;
    const f = frame(ap);
    const rects = [];
    for (const rw of ap.runways) {
      const [cx, cz] = toWorld(ap, rw.u, rw.v);
      const r = rw.hdg * Math.PI / 180;
      rects.push({ cx, cz, ax: Math.sin(r), az: -Math.cos(r), hl: rw.len / 2 + 350, hw: rw.wid / 2 + 160 });
    }
    // Everything else (aprons, buildings, taxiways): bounding rect in the airport frame.
    let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
    const addPt = (u, v, m) => { umin = Math.min(umin, u - m); umax = Math.max(umax, u + m); vmin = Math.min(vmin, v - m); vmax = Math.max(vmax, v + m); };
    for (const a of ap.aprons) { addPt(a.u - a.w / 2, a.v - a.l / 2, 60); addPt(a.u + a.w / 2, a.v + a.l / 2, 60); }
    for (const b of ap.buildings) addPt(b.u, b.v, Math.max(b.w || 40, b.d || 40) * 0.6 + 60);
    for (const t of ap.taxiways) for (const p of t.pts) addPt(p[0], p[1], 50);
    if (umin < umax) {
      const cu = (umin + umax) / 2, cv = (vmin + vmax) / 2;
      const [cx, cz] = toWorld(ap, cu, cv);
      rects.push({ cx, cz, ax: f.fx, az: f.fz, hl: (umax - umin) / 2, hw: (vmax - vmin) / 2 });
    }
    zones.push({ ap, elev: ap.elev, rects, falloff: ap.type === 'mountain' ? 450 : 700 });
  }
  return zones;
}

export class World {
  constructor() {
    this.N = GRID_N;
    this.cell = CELL;
    this.h = new Float32Array(GRID_N * GRID_N);
    this.lc = new Uint8Array(GRID_N * GRID_N);
    this.zones = buildFlatZones();
    this.platforms = elevatedPlatforms();
    this.lakes = LAKES.map((l) => ({ ...l, level: 0 }));
    this.towns = TOWNS;
    this.roads = ROADS;
    this.river = RIVER;
    this.ready = false;
  }

  // Natural macro terrain (before lakes/rivers/airports).
  natural(x, z) {
    const coast = coastZ(x) - z;                  // > 0 inland
    let h = 30 + 85 * fbm(x / 14000 + 3.1, z / 14000 - 1.7, 4) + 28 * fbm(x / 4200, z / 4200, 3);
    const inland = smoothstep(0, 32000, coast);
    h += inland * 190;
    // Eastern and western hills
    h += 260 * smoothstep(0.15, 0.7, fbm(x / 9000 - 5, z / 9000 + 9, 3)) * smoothstep(2000, 9000, coast);
    // Northern mountain range
    const m = smoothstep(-19000, -29000, z);
    if (m > 0) {
      const rg = ridged(x / 8500 + 11, z / 8500 - 4, 5);
      h += m * (250 + 2300 * Math.pow(rg, 1.35));
    }
    // Summit valley carved along the runway direction (50 deg)
    const ap = AIRPORTS[2];
    const vx = x - ap.x, vz = z - ap.z;
    const along = vx * 0.766 + vz * -0.643;
    const across = Math.abs(vx * 0.643 + vz * 0.766);
    const floor = 1390 + (along > 0 ? along * 0.06 : along * 0.055);
    const vw = 1 - smoothstep(900 + Math.max(0, -along) * 0.08, 3800 + Math.max(0, -along) * 0.12, across);
    const valleyMask = smoothstep(-26000, -2000, along) * (1 - smoothstep(6000, 11000, along));
    if (vw > 0 && valleyMask > 0) h = lerp(h, Math.max(floor, 300), vw * valleyMask * m);
    // Coast and sea floor
    const landF = smoothstep(-300, 2600, coast);
    const sea = -12 - Math.min(90, Math.max(0, -coast) * 0.006);
    h = lerp(sea, Math.max(h, 2.0), landF);
    // Island
    const dI = Math.hypot(x - ISLAND.x, z - ISLAND.z) * (1 + 0.25 * fbm(x / 2500, z / 2500, 2));
    if (dI < ISLAND.r * 1.6) {
      const ih = 22 * (1 - smoothstep(ISLAND.r * 0.55, ISLAND.r, dI)) + 30 * Math.max(0, fbm(x / 1800, z / 1800, 3)) * (1 - smoothstep(0, ISLAND.r, dI)) - 14 * smoothstep(ISLAND.r * 0.85, ISLAND.r * 1.5, dI);
      h = Math.max(h, ih);
    }
    return h;
  }

  async generate(onProgress) {
    const N = this.N, H = this.h;
    // Lake levels from natural terrain.
    for (const l of this.lakes) l.level = this.natural(l.x, l.z) - 6;
    const t0 = performance.now();
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * CELL;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * CELL;
        let h = this.natural(x, z);
        // Airport basins: blend macro terrain toward airport elevation over a few km.
        for (const zn of this.zones) {
          const d = Math.hypot(x - zn.ap.x, z - zn.ap.z);
          const R = zn.ap.type === 'mountain' ? 2600 : 4200;
          if (d < R) h = lerp(zn.elev, h, smoothstep(R * 0.35, R, d));
        }
        // Rivers
        const dr = distToPolyline(x, z, RIVER);
        if (dr < 420) h -= 7 * (1 - smoothstep(60, 420, dr));
        // Lakes
        for (const l of this.lakes) {
          const d = Math.hypot(x - l.x, z - l.z) * (1 + 0.18 * noise2(x / 900, z / 900));
          if (d < l.r * 1.35) {
            const bed = l.level - 3 - 12 * (1 - Math.min(1, d / l.r));
            h = lerp(Math.min(h, bed), h, smoothstep(l.r * 0.85, l.r * 1.35, d));
          }
        }
        H[j * N + i] = h;
      }
      if ((j & 31) === 31) {
        onProgress && onProgress(j / N * 0.7);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    // Land classes
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * CELL;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * CELL;
        this.lc[j * N + i] = this._classify(x, z, i, j);
      }
      if ((j & 63) === 63) {
        onProgress && onProgress(0.7 + j / N * 0.3);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    this.ready = true;
    this.genMs = performance.now() - t0;
  }

  _classify(x, z, i, j) {
    const N = this.N;
    const h = this.h[j * N + i];
    if (this.airportWeight(x, z) > 0.55) return LC.AIRPORT;
    for (const l of this.lakes) {
      if (h < l.level - 0.5 && Math.hypot(x - l.x, z - l.z) < l.r * 1.4) return LC.WATER;
    }
    if (h < 0.4) return LC.WATER;
    const i1 = Math.min(N - 1, i + 1), j1 = Math.min(N - 1, j + 1);
    const slope = Math.hypot(this.h[j * N + i1] - h, this.h[j1 * N + i] - h) / CELL;
    const n = fbm(x / 2400 + 7, z / 2400 - 3, 3);
    if (h < 4.5 && (coastZ(x) - z < 1800 || Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND.r * 1.2)) return LC.BEACH;
    if (h > 2350 + n * 250) return LC.SNOW;
    if (slope > 0.62 || h > 1950 + n * 260) return LC.ROCK;
    for (const t of TOWNS) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < t.r * 1.3) {
        const q = d / t.r + 0.22 * noise2(x / 700, z / 700);
        if (q < 0.55) return LC.URBAN;
        if (q < 1.05) return LC.SUBURB;
      }
    }
    const dRoad = 1e9; // (roads handled in colormap)
    if (n > 0.18 || (h > 450 && n > -0.12) || slope > 0.22) return LC.FOREST;
    if (slope < 0.09 && h < 700) return (fbm(x / 1100, z / 1100, 2) > -0.25) ? LC.FARM : LC.GRASS;
    return LC.GRASS;
  }

  // Weight (0..1) of airport flattening at a world position.
  airportWeight(x, z) {
    let best = 0;
    for (const zn of this.zones) {
      if (Math.abs(x - zn.ap.x) > 6000 || Math.abs(z - zn.ap.z) > 6000) continue;
      for (const r of zn.rects) {
        const dx = x - r.cx, dz = z - r.cz;
        const a = Math.abs(dx * r.ax + dz * r.az) - r.hl;
        const b = Math.abs(dx * -r.az + dz * r.ax) - r.hw;
        const out = Math.hypot(Math.max(a, 0), Math.max(b, 0));
        const w = 1 - smoothstep(0, zn.falloff, out);
        if (w > best) best = w;
      }
    }
    return best;
  }

  _flatten(x, z, h, detailOut) {
    for (const zn of this.zones) {
      if (Math.abs(x - zn.ap.x) > 6000 || Math.abs(z - zn.ap.z) > 6000) continue;
      let best = 0;
      for (const r of zn.rects) {
        const dx = x - r.cx, dz = z - r.cz;
        const a = Math.abs(dx * r.ax + dz * r.az) - r.hl;
        const b = Math.abs(dx * -r.az + dz * r.ax) - r.hw;
        const out = Math.hypot(Math.max(a, 0), Math.max(b, 0));
        const w = 1 - smoothstep(0, zn.falloff, out);
        if (w > best) best = w;
      }
      if (best > 0) return lerp(h, zn.elev, best);
    }
    return h;
  }

  // Raw grid value with clamping.
  _g(i, j) {
    const N = this.N;
    i = i < 0 ? 0 : i >= N ? N - 1 : i;
    j = j < 0 ? 0 : j >= N ? N - 1 : j;
    return this.h[j * N + i];
  }

  // Bicubic (Catmull-Rom) sample of the macro grid.
  macroAt(x, z) {
    const fx = (x + WORLD_HALF) / CELL, fz = (z + WORLD_HALF) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const r0 = cr(this._g(i - 1, j - 1), this._g(i, j - 1), this._g(i + 1, j - 1), this._g(i + 2, j - 1), tx);
    const r1 = cr(this._g(i - 1, j), this._g(i, j), this._g(i + 1, j), this._g(i + 2, j), tx);
    const r2 = cr(this._g(i - 1, j + 1), this._g(i, j + 1), this._g(i + 1, j + 1), this._g(i + 2, j + 1), tx);
    const r3 = cr(this._g(i - 1, j + 2), this._g(i, j + 2), this._g(i + 1, j + 2), this._g(i + 2, j + 2), tx);
    return cr(r0, r1, r2, r3, tz);
  }

  // Terrain height (m) at a world position including fine detail and airport flattening.
  heightAt(x, z) {
    let h = this.macroAt(x, z);
    if (h > 0.5) {
      const amp = (3.5 + 4.5 * smoothstep(150, 400, h) + 14 * smoothstep(700, 1300, h)) * smoothstep(0.5, 8, h);
      h += amp * noise2(x / 520, z / 520) + amp * 0.3 * noise2(x / 140 + 3.3, z / 140 - 1.1);
    }
    return this._flatten(x, z, h);
  }

  // Ground surface including elevated platforms (rooftop helipads, offshore deck). Water = 0.
  surfaceAt(x, z) {
    let h = this.heightAt(x, z);
    for (const p of this.platforms) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > 6400) continue;
      const r = p.hdg * Math.PI / 180;
      const fx = Math.sin(r), fz = -Math.cos(r);
      const u = dx * fx + dz * fz, v = dx * Math.cos(r) + dz * Math.sin(r);
      if (Math.abs(u) < p.w / 2 && Math.abs(v) < p.d / 2) h = Math.max(h, p.top);
    }
    return h;
  }

  isWater(x, z) {
    const h = this.heightAt(x, z);
    if (h < 0) return true;
    for (const l of this.lakes) if (h < l.level && Math.hypot(x - l.x, z - l.z) < l.r * 1.4) return true;
    return false;
  }

  normalAt(x, z, out) {
    const e = 3;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    const nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  landclassAt(x, z) {
    const i = Math.round((x + WORLD_HALF) / CELL), j = Math.round((z + WORLD_HALF) / CELL);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return LC.WATER;
    return this.lc[j * this.N + i];
  }

  nearestTown(x, z) {
    let best = null, bd = 1e12;
    for (const t of TOWNS) { const d = Math.hypot(x - t.x, z - t.z); if (d < bd) { bd = d; best = t; } }
    return { town: best, dist: bd };
  }
}

export function seededRandom(seed) { return mulberry32(seed); }
