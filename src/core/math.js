// Shared math helpers, unit conversions, seeded random and noise.
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const KT = 0.514444;          // m/s per knot
export const FT = 0.3048;            // m per foot
export const FPM = 0.00508;          // m/s per ft/min
export const NM = 1852;              // m per nautical mile
export const G = 9.80665;
export const LB = 0.453592;
export const HP = 745.7;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };
export const sign = (v) => (v < 0 ? -1 : 1);
// Frame-rate independent exponential approach.
export const damp = (cur, target, lambda, dt) => target + (cur - target) * Math.exp(-lambda * dt);
export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export const angDiffDeg = (a, b) => { let d = wrap360(b - a); if (d > 180) d -= 360; return d; };
export const moveTowards = (cur, target, maxDelta) => {
  if (Math.abs(target - cur) <= maxDelta) return target;
  return cur + Math.sign(target - cur) * maxDelta;
};

// Piecewise-linear table lookup: table = [[x0,y0],[x1,y1],...] sorted by x.
export function table(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  const n = tab.length;
  if (x >= tab[n - 1][0]) return tab[n - 1][1];
  for (let i = 1; i < n; i++) {
    if (x < tab[i][0]) {
      const a = tab[i - 1], b = tab[i];
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  }
  return tab[n - 1][1];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// --- 2D gradient noise (fast, deterministic) ---
const PERM = new Uint8Array(512);
const GRAD = new Float32Array(512 * 2);
(function initNoise() {
  const rnd = mulberry32(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
    const a = rnd() * Math.PI * 2;
    GRAD[i * 2] = Math.cos(a); GRAD[i * 2 + 1] = Math.sin(a);
  }
})();

export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const aa = PERM[X + PERM[Y]], ab = PERM[X + PERM[Y + 1]];
  const ba = PERM[X + 1 + PERM[Y]], bb = PERM[X + 1 + PERM[Y + 1]];
  const g = (h, dx, dy) => GRAD[h * 2] * dx + GRAD[h * 2 + 1] * dy;
  const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf));
  const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1));
  return (x1 + v * (x2 - x1)) * 1.41;   // ~[-1,1]
}

export function fbm(x, y, oct = 5, lac = 2.0, gain = 0.5) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}

export function ridged(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise2(x * f, y * f));
    n *= n; s += n * a * prev; prev = n; a *= 0.5; f *= 2.0;
  }
  return s;
}

// 1D smooth noise for time series (gusts, turbulence).
export function noise1(t, seed = 0) { return noise2(t, seed * 17.13 + 0.5); }

export function fmt(n, d = 0) { return Number.isFinite(n) ? n.toFixed(d) : '--'; }
export function pad(n, w) { const s = String(Math.round(n)); return s.length >= w ? s : '0'.repeat(w - s.length) + s; }
