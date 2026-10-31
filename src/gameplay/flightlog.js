// Flight recorder (for replays and statistics) and persistent flight log.
import { safeGet, safeSet } from '../core/settings.js';
import { FT, KT, NM } from '../core/math.js';

const LOG_KEY = 'fs26.flightlog.v1';
const STRIDE = 16;   // floats per sample

export class Recorder {
  constructor(maxMinutes = 30) {
    this.rate = 10;                       // samples per second
    this.max = maxMinutes * 60 * this.rate;
    this.data = new Float32Array(this.max * STRIDE);
    this.n = 0; this.acc = 0; this.t = 0;
    this.events = [];
    this.stats = null;
  }
  reset() { this.n = 0; this.acc = 0; this.t = 0; this.events = []; this.stats = { maxAlt: 0, maxIas: 0, dist: 0, maxG: 1, airborne: 0, lastX: null, lastZ: null }; }
  event(type, text) { this.events.push({ t: this.t, type, text }); }
  update(dt, ac) {
    this.t += dt;
    const fm = ac.fm, tl = fm.telemetry, s = this.stats;
    if (s.lastX !== null) s.dist += Math.hypot(fm.pos.x - s.lastX, fm.pos.z - s.lastZ);
    s.lastX = fm.pos.x; s.lastZ = fm.pos.z;
    s.maxAlt = Math.max(s.maxAlt, fm.pos.y); s.maxIas = Math.max(s.maxIas, tl.ias || 0); s.maxG = Math.max(s.maxG, fm.gLoad);
    if (!fm.onGround) s.airborne += dt;
    this.acc += dt;
    if (this.acc < 1 / this.rate) return;
    this.acc = 0;
    if (this.n >= this.max) { this.data.copyWithin(0, STRIDE * this.rate * 60); this.n -= this.rate * 60; }
    const o = this.n * STRIDE, d = this.data;
    d[o] = this.t; d[o + 1] = fm.pos.x; d[o + 2] = fm.pos.y; d[o + 3] = fm.pos.z;
    d[o + 4] = fm.q.x; d[o + 5] = fm.q.y; d[o + 6] = fm.q.z; d[o + 7] = fm.q.w;
    d[o + 8] = fm.gearPos; d[o + 9] = fm.flapDeg;
    d[o + 10] = fm.engines.length ? fm.engines.reduce((a, e) => a + e.n1, 0) / fm.engines.length : 0;
    d[o + 11] = fm.nr || 0; d[o + 12] = tl.ias || 0; d[o + 13] = tl.vs || 0; d[o + 14] = fm.elevator; d[o + 15] = fm.aileron;
    this.n++;
  }
  sample(i, out) {
    const o = i * STRIDE, d = this.data;
    out.t = d[o]; out.x = d[o + 1]; out.y = d[o + 2]; out.z = d[o + 3];
    out.qx = d[o + 4]; out.qy = d[o + 5]; out.qz = d[o + 6]; out.qw = d[o + 7];
    out.gear = d[o + 8]; out.flap = d[o + 9]; out.n1 = d[o + 10]; out.nr = d[o + 11]; out.ias = d[o + 12]; out.vs = d[o + 13]; out.elev = d[o + 14]; out.ail = d[o + 15];
    return out;
  }
  // index of the sample at time t (binary search)
  indexAt(t) {
    let lo = 0, hi = this.n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.data[m * STRIDE] <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  get duration() { return this.n ? this.data[(this.n - 1) * STRIDE] - this.data[0] : 0; }
  get start() { return this.n ? this.data[0] : 0; }
  profile(points = 160) {
    const out = [];
    if (!this.n) return out;
    const step = Math.max(1, Math.floor(this.n / points));
    for (let i = 0; i < this.n; i += step) out.push([+(this.data[i * STRIDE] / 60).toFixed(2), Math.round(this.data[i * STRIDE + 2] / FT), Math.round(this.data[i * STRIDE + 12] / KT)]);
    return out;
  }
}

export function loadLog() {
  try { return JSON.parse(safeGet(LOG_KEY) || '[]'); } catch (e) { return []; }
}
export function saveLogEntry(entry) {
  const log = loadLog();
  log.unshift(entry);
  while (log.length > 40) log.pop();
  safeSet(LOG_KEY, JSON.stringify(log));
  return log;
}
export function clearLog() { safeSet(LOG_KEY, '[]'); }

export function summarize(rec, ac, extra) {
  const s = rec.stats || {};
  return {
    id: Date.now(), date: new Date().toISOString(), aircraft: ac.spec.name, aircraftId: ac.spec.id,
    from: extra.from || '', to: extra.to || '', mission: extra.mission || null,
    durationMin: +(rec.t / 60).toFixed(1), airborneMin: +((s.airborne || 0) / 60).toFixed(1), distanceNm: +((s.dist || 0) / NM).toFixed(1),
    maxAltFt: Math.round((s.maxAlt || 0) / FT), maxIasKt: Math.round((s.maxIas || 0) / KT), maxG: +(s.maxG || 1).toFixed(2),
    landings: extra.landings || [], emergencies: extra.emergencies || [], result: extra.result || 'completed', profile: rec.profile(),
    events: rec.events.slice(-30), fuelUsedKg: Math.round(extra.fuelUsed || 0), rescue: extra.rescue || null,
  };
}
