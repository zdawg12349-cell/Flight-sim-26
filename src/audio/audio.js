// Audio engine (Web Audio). Engine/rotor layers are real recordings (see ATTRIBUTION.md) looped and
// re-pitched from the simulated engine state; a handful of persistent voices are created once per
// aircraft and only their gain / playback-rate parameters are automated (~30 Hz), keeping CPU low.
import * as THREE from 'three';
import { PROFILES, COMMON_CLIPS } from './profiles.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { clamp, table, lerp, KT, FT, FPM, smoothstep } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function b64ToBuf(b64) {
  const bin = atob(b64);
  const n = bin.length;
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

class Voice {
  constructor(eng, buffer, dest, { loop = true, pan = false } = {}) {
    const ctx = eng.ctx;
    this.ctx = ctx;
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = loop;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.gain);
    if (pan && ctx.createStereoPanner) { this.pan = ctx.createStereoPanner(); this.gain.connect(this.pan); this.pan.connect(dest); }
    else this.gain.connect(dest);
    this.src.start(0, loop ? Math.random() * Math.max(0.01, buffer.duration - 0.05) : 0);
    this.g = 0; this.r = 1;
  }
  set(g, r = null, p = null, tc = 0.06) {
    const t = this.ctx.currentTime;
    if (!Number.isFinite(g)) g = 0;
    if (Math.abs(g - this.g) > 0.002) { this.gain.gain.setTargetAtTime(Math.max(0, g), t, tc); this.g = g; }
    if (r !== null && Number.isFinite(r) && Math.abs(r - this.r) > 0.002) { this.src.playbackRate.setTargetAtTime(clamp(r, 0.02, 4), t, tc); this.r = r; }
    if (p !== null && this.pan) this.pan.pan.setTargetAtTime(clamp(p, -1, 1), t, 0.08);
  }
  stop() { try { this.src.stop(); } catch (e) {} this.src.disconnect(); this.gain.disconnect(); if (this.pan) this.pan.disconnect(); }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.pending = new Map();
    this.ready = false;
    this.voices = [];
    this.ac = null;
    this.timer = 0;
    this.camPrev = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.lastAlt = null;
    this.callouts = new Set();
    this.lastWarnSound = {};
    this.sirens = [];
    this.oneShots = 0;
    bus.on('sound', (n) => this.playUI(n));
    bus.on('warning', (w) => this.onWarning(w));
    bus.on('click', () => this.play('click', { bus: 'cockpit', volume: 0.5 }));
  }

  // Must be called from a user gesture.
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn('Web Audio not supported'); return; }
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.ratio.value = 4; this.comp.attack.value = 0.01; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    const mk = () => { const g = ctx.createGain(); g.connect(this.master); return g; };
    this.engineGain = mk();
    this.envBus = mk(); this.cockpitBus = mk(); this.uiBus = mk(); this.worldBus = mk();
    this.extFilter = ctx.createBiquadFilter(); this.extFilter.type = 'lowpass'; this.extFilter.frequency.value = 18000; this.extFilter.Q.value = 0.5;
    this.extBus = ctx.createGain(); this.extBus.connect(this.extFilter); this.extFilter.connect(this.engineGain);
    this.intBus = ctx.createGain(); this.intBus.connect(this.engineGain);
    // noise buffer for synthesis
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    this.applyVolumes();
    bus.on('settings:audio', () => this.applyVolumes());
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = settings.a;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.master, t, 0.05);
    this.engineGain.gain.setTargetAtTime(a.engine, t, 0.05);
    this.envBus.gain.setTargetAtTime(a.environment, t, 0.05);
    this.cockpitBus.gain.setTargetAtTime(a.cockpit, t, 0.05);
    this.uiBus.gain.setTargetAtTime(a.ui, t, 0.05);
    this.worldBus.gain.setTargetAtTime(a.environment, t, 0.05);
  }

  async load(name) {
    if (!this.ctx) return null;
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (this.pending.has(name)) return this.pending.get(name);
    const b64 = window.FS_AUDIO_PACK && window.FS_AUDIO_PACK[name];
    if (!b64) { console.warn('missing audio clip', name); return null; }
    const p = this.ctx.decodeAudioData(b64ToBuf(b64)).then((buf) => { this.buffers.set(name, buf); return buf; }).catch((e) => { console.warn('decode failed', name, e); return null; });
    this.pending.set(name, p);
    return p;
  }

  async preload(names, onProgress) {
    let k = 0;
    await Promise.all([...new Set(names)].map(async (n) => { await this.load(n); onProgress && onProgress(++k / names.length); }));
  }

  play(name, { volume = 1, rate = 1, bus: b = 'cockpit', pan = 0 } = {}) {
    if (!this.ctx || this.oneShots > 24) return;
    const buf = this.buffers.get(name);
    if (!buf) { this.load(name); return; }
    const dest = b === 'env' ? this.envBus : b === 'world' ? this.worldBus : b === 'ui' ? this.uiBus : this.cockpitBus;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = volume;
    src.connect(g);
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest); } else g.connect(dest);
    this.oneShots++;
    src.onended = () => { this.oneShots--; g.disconnect(); };
    src.start();
  }

  playUI(name) {
    if (!this.ctx) return;
    const map = { gear_down: ['gear_down', 0.7], gear_up: ['gear_up', 0.7], flaps_click: ['flaps_click', 0.6], ap_disc: ['ap_disc', 0.7], thunder1: ['thunder1', 0.9], thunder2: ['thunder2', 0.9] };
    const m = map[name];
    if (m) this.play(m[0], { volume: m[1], bus: name.startsWith('thunder') ? 'world' : 'cockpit' });
  }

  // ---------------------------------------------------------- aircraft setup
  async setAircraft(ac) {
    this.clearAircraft();
    this.ac = ac;
    if (!this.ctx) return;
    const prof = PROFILES[ac.spec.sound] || PROFILES.piston_trainer;
    this.profile = prof;
    const clips = new Set([...COMMON_CLIPS, ...prof.layers.map((l) => l.clip)]);
    if (ac.spec.cat === 'airliner' || ac.spec.cat === 'jet') for (const n of Object.keys(window.FS_AUDIO_PACK || {})) if (n.startsWith('gpws_')) clips.add(n);
    await this.preload([...clips]);
    if (this.ac !== ac) return;
    // engine groups: by lateral position (left / centre / right)
    const pos = ac.spec.engines.pos || ac.fm.engines.map(() => [0, 0, 0]);
    const groups = [];
    ac.fm.engines.forEach((e, i) => {
      const x = (pos[i] || [0])[0];
      const key = Math.abs(x) < 0.5 ? 'C' : x < 0 ? 'L' : 'R';
      let g = groups.find((q) => q.key === key);
      if (!g) { g = { key, engines: [], x: 0, y: 0, z: 0, voices: [] }; groups.push(g); }
      g.engines.push(e); g.x += pos[i] ? pos[i][0] : 0; g.y += pos[i] ? pos[i][1] : 0; g.z += pos[i] ? pos[i][2] : 0;
    });
    if (ac.fm.isHeli && groups.length > 1) { const all = { key: 'C', engines: ac.fm.engines, x: 0, y: 1, z: 0, voices: [] }; groups.length = 0; groups.push(all); }
    for (const g of groups) { g.x /= g.engines.length; g.y /= g.engines.length; g.z /= g.engines.length; }
    this.groups = groups;
    const gainScale = 1 / Math.sqrt(groups.length);
    for (const g of groups) {
      for (const L of prof.layers) {
        const buf = this.buffers.get(L.clip);
        if (!buf) continue;
        const wheres = L.where === 'both' ? ['ext', 'int'] : [L.where];
        for (const w of wheres) {
          const v = new Voice(this, buf, w === 'ext' ? this.extBus : this.intBus, { pan: true });
          g.voices.push({ v, L, w, scale: gainScale });
          this.voices.push(v);
        }
      }
      // synthesized propeller blade-pass tone / fan buzz-saw
      if (prof.synth.prop || prof.synth.buzz) {
        const o = this.ctx.createOscillator(); o.type = 'sawtooth';
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 0.8;
        const gn = this.ctx.createGain(); gn.gain.value = 0;
        const pn = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        o.connect(f); f.connect(gn); if (pn) { gn.connect(pn); pn.connect(this.extBus); } else gn.connect(this.extBus);
        o.start();
        g.synth = { o, f, gn, pn, kind: prof.synth.prop ? 'prop' : 'buzz' };
      }
      if (prof.synth.ab) {
        const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
        const gn = this.ctx.createGain(); gn.gain.value = 0;
        s.connect(f); f.connect(gn); gn.connect(this.extBus); s.start();
        g.ab = { s, gn };
      }
    }
    // environment & systems loops
    const mkLoop = (clip, dest) => { const b = this.buffers.get(clip); if (!b) return null; const v = new Voice(this, b, dest, { pan: false }); this.voices.push(v); return v; };
    this.env = {
      windIn: mkLoop('wind_in', this.envBus), windOut: mkLoop('wind_out', this.envBus), windHi: mkLoop('wind_hi', this.envBus),
      rumble: mkLoop('rumble', this.envBus), tires: mkLoop('tires_roll', this.envBus), rain: mkLoop('rain', this.envBus), rainIn: mkLoop('rain_shield', this.envBus),
      gear: mkLoop('gear_motor', this.cockpitBus), flaps: mkLoop(ac.spec.cat === 'ga' ? 'flaps_motor' : 'flaps_hyd', this.cockpitBus), reverser: mkLoop('reverser', this.extBus),
      apu: mkLoop('apu_run', this.extBus), stall: mkLoop('stall_horn', this.cockpitBus), gearHorn: mkLoop('gear_horn', this.cockpitBus), avionics: mkLoop('avionics', this.cockpitBus),
    };
    this.prevState = ac.fm.engines.map((e) => e.state);
    this.prevTouchdown = ac.fm.touchdown;
    this.prevCrash = false;
    this.crankTimer = 0;
    this.callouts.clear();
  }

  clearAircraft() {
    for (const v of this.voices) v.stop();
    this.voices = [];
    if (this.groups) for (const g of this.groups) {
      if (g.synth) { try { g.synth.o.stop(); } catch (e) {} g.synth.gn.disconnect(); }
      if (g.ab) { try { g.ab.s.stop(); } catch (e) {} g.ab.gn.disconnect(); }
    }
    this.groups = [];
    this.env = null;
  }

  // ---------------------------------------------------------- per-frame mix
  update(dt, ac, camera, viewMode, weather) {
    if (!this.ctx || !this.env || ac !== this.ac) return;
    // camera velocity for doppler
    this.camVel.copy(camera.position).sub(this.camPrev).divideScalar(Math.max(dt, 1e-3));
    this.camPrev.copy(camera.position);
    this.timer -= dt;
    if (this.timer > 0) return;
    const step = 1 / 30;
    this.timer = step;
    const fm = ac.fm, prof = this.profile, t = fm.telemetry;
    const inside = viewMode === 'cockpit' || viewMode === 'jumpseat' || viewMode === 'cabin';
    const cabin = viewMode === 'cabin';
    const tNow = this.ctx.currentTime;
    // view mix
    const root = ac.root;
    const dist = inside ? 0 : camera.position.distanceTo(root.position);
    const size = Math.max(10, fm.spec.dims.length);
    const att = inside ? 1 : clamp(size * 1.6 / (size * 1.6 + Math.max(0, dist - size * 0.5)), 0, 1);
    const lp = inside ? prof.lpInside * (cabin ? 0.75 : 1) : 600 + 19000 * Math.exp(-dist / 2200);
    this.extFilter.frequency.setTargetAtTime(lp, tNow, 0.1);
    this.extBus.gain.setTargetAtTime((inside ? prof.extInside * (cabin ? 1.4 : 1) : prof.extGain * att), tNow, 0.08);
    this.intBus.gain.setTargetAtTime(inside ? (cabin ? 0.55 : 1) : 0, tNow, 0.08);
    // doppler (exterior)
    let doppler = 1;
    if (!inside && dist > 1) {
      _v.copy(camera.position).sub(root.position).normalize();
      const vr = _v2.copy(fm.vel).sub(this.camVel).dot(_v);
      doppler = clamp(343 / (343 - clamp(vr, -150, 150)), 0.75, 1.3);
    }
    // listener orientation relative to aircraft (front/rear emphasis)
    _v.copy(camera.position).sub(root.position);
    const fwd = _v2.set(0, 0, -1).applyQuaternion(root.quaternion);
    const frontness = inside ? 0.3 : clamp(_v.normalize().dot(fwd), -1, 1);
    // per group engine params
    for (const g of this.groups) {
      const E = g.engines, n = E.length;
      const avg = (f) => E.reduce((s, e) => s + f(e), 0) / n;
      const P = {
        n1: avg((e) => e.n1), n2: avg((e) => e.n2), load: avg((e) => clamp(e.torque || 0, 0, 1.2)),
        rpm: avg((e) => (e.rpmMax ? e.rpm / e.rpmMax : e.propRpmMax ? e.rpm / e.propRpmMax : e.n1)),
        start: avg((e) => (e.state === 'cranking' ? 0.5 + 0.5 * clamp(e.n2 / 0.25, 0, 1) : 0)),
        thrust: avg((e) => (e.T0 ? clamp(e.thrust / e.T0, 0, 1.3) : clamp(e.torque || 0, 0, 1))),
        nr: fm.nr || 0,
      };
      if (fm.isHeli) {
        const descent = clamp((-t.vs - 1.5) / 3, 0, 1) * clamp(t.gs / 20, 0, 1) * (1 - clamp((t.gs - 50) / 20, 0, 1));
        const loadS = clamp((fm.rotorThrust / (fm.mass * 9.81) - 1.05) * 3, 0, 1);
        const speed = clamp(((t.ias || 0) / KT - 95) / 40, 0, 1);
        P.slap = clamp(Math.max(descent, loadS, speed) * P.nr, 0, 1);
      }
      // pan: in cockpit by engine side, outside by camera-relative position
      let pan = 0;
      if (inside) pan = clamp(g.x / Math.max(4, fm.spec.dims.span * 0.5), -0.7, 0.7);
      else {
        _v.set(g.x - fm.cg.x, g.y - fm.cg.y, g.z - fm.cg.z).applyQuaternion(root.quaternion).add(root.position);
        _v.applyMatrix4(camera.matrixWorldInverse);
        pan = clamp(_v.x / Math.max(5, Math.hypot(_v.x, _v.z)), -0.85, 0.85);
      }
      for (const { v, L, w, scale } of g.voices) {
        const x = P[L.p] ?? 0;
        let gain = table(L.gain, x) * scale;
        let rate = table(L.rate, x) * (prof.rotorRate && (L.p === 'nr') ? prof.rotorRate : 1);
        if (L.nrRate) rate *= Math.max(0.1, P.nr);
        if (w === 'ext' && !inside) {
          if (L.pos === 'front') gain *= 0.55 + 0.45 * Math.max(0, frontness) * 1.6;
          if (L.pos === 'rear') gain *= 0.45 + 0.55 * Math.max(0, -frontness) * 1.6;
          rate *= doppler;
        }
        // engine running state shaping (no combustion -> mostly windmill/whine)
        v.set(gain, rate, pan);
      }
      if (g.synth) {
        const e = E[0];
        if (g.synth.kind === 'prop') {
          const blades = ac.spec.engines.prop ? ac.spec.engines.prop.blades : 2;
          const prpm = e.rpm;
          const bpf = Math.max(1, prpm / 60 * blades);
          g.synth.o.frequency.setTargetAtTime(bpf * (inside ? 1 : doppler), tNow, 0.05);
          g.synth.f.frequency.setTargetAtTime(bpf * 4 + 120, tNow, 0.05);
          g.synth.gn.gain.setTargetAtTime(clamp(prpm / 2000, 0, 1) * (0.05 + 0.1 * P.load) / Math.sqrt(this.groups.length), tNow, 0.06);
        } else {
          const f = Math.max(1, (e.rpm || 0) / 60);
          g.synth.o.frequency.setTargetAtTime(f * 6 * (inside ? 1 : doppler), tNow, 0.05);
          g.synth.f.frequency.setTargetAtTime(2400, tNow, 0.1);
          const front = inside ? 0.15 : Math.max(0, frontness);
          g.synth.gn.gain.setTargetAtTime(smoothstep(0.78, 1.0, P.n1) * (prof.synth.buzz || 0) * 0.05 * front, tNow, 0.08);
        }
        if (g.synth.pn) g.synth.pn.pan.setTargetAtTime(pan, tNow, 0.08);
      }
      if (g.ab) g.ab.gn.gain.setTargetAtTime(avg((e) => e.ab || 0) * 0.5, tNow, 0.1);
    }
    // ---- environment
    const E = this.env;
    const ias = t.ias || 0, gs = t.gs || 0;
    const vref = (fm.spec.perf.vref || fm.spec.perf.cruiseKt * 0.6) * KT;
    const w = clamp(ias / Math.max(30, vref * 1.6), 0, 1.6);
    const windG = w * w * (fm.isHeli ? 0.4 : 0.85) * (1 + fm.spoilerPos * 0.5 + (fm.gearPos > 0.5 && fm.spec.retract ? 0.2 : 0));
    E.windIn && E.windIn.set(inside ? windG * 0.7 : 0, 0.75 + clamp(ias / 200, 0, 0.6));
    E.windOut && E.windOut.set(inside ? 0 : windG * att * 0.9, (0.8 + clamp(ias / 200, 0, 0.5)) * (inside ? 1 : doppler));
    E.windHi && E.windHi.set(clamp((ias - 110) / 120, 0, 1) * (inside ? 0.35 : 0.6 * att), 0.9 + clamp(ias / 400, 0, 0.4));
    const roll = fm.onGround && fm.contacts.some((c) => c.wow && c.kind === 'wheel') ? clamp(gs / 35, 0, 1.2) : 0;
    const grass = fm.surfaceType === 'grass' ? 1.6 : 1;
    E.rumble && E.rumble.set(roll * 0.75 * grass * (inside ? 1 : att), 0.75 + gs / 120);
    E.tires && E.tires.set(roll * 0.6 * (inside ? 1 : att) * (fm.spec.mass.mtow < 6000 ? 1.4 : 0.8), 0.8 + gs / 90);
    const rain = weather.precip * (weather.precipType === 'rain' ? 1 : 0.15) * (t.agl < weather.cloudBase + 300 ? 1 : 0);
    E.rain && E.rain.set(inside ? 0 : rain * 0.6, 1);
    E.rainIn && E.rainIn.set(inside ? rain * (0.4 + clamp(ias / 80, 0, 0.6)) : 0, 0.9 + clamp(ias / 200, 0, 0.3));
    E.gear && E.gear.set(fm.gearMoving ? 0.55 * (inside ? 1 : att * 0.6) : 0, 1, null, 0.15);
    E.flaps && E.flaps.set(fm.flapsMoving ? 0.4 * (inside ? 1 : att * 0.5) : 0, 1, null, 0.15);
    E.reverser && E.reverser.set(fm.reverserPos * clamp(fm.engines.reduce((s, e) => s + e.n1, 0) / fm.engines.length, 0, 1) * 0.9, 1);
    E.apu && E.apu.set(ac.systems.apu.n * 0.5, 0.6 + ac.systems.apu.n * 0.4);
    const stall = ac.systems.warnings.get('stall')?.active && !fm.onGround;
    E.stall && E.stall.set(stall ? 0.55 : 0, 1, null, 0.02);
    E.gearHorn && E.gearHorn.set(ac.systems.warnings.get('gear')?.active ? 0.5 : 0, 1, null, 0.02);
    E.avionics && E.avionics.set(inside && ac.systems.displaysOn ? 0.035 : 0, 1);
    // ---- events
    this.events(ac, inside, att);
    this.updateSirens(camera, inside);
  }

  events(ac, inside, att) {
    const fm = ac.fm, t = fm.telemetry, prof = this.profile;
    // touchdown
    if (fm.touchdown && fm.touchdown !== this.prevTouchdown) {
      const td = fm.touchdown;
      this.prevTouchdown = td;
      const v = Math.abs(td.vs || td.impact || 1);
      this.play('touchdown', { volume: clamp(0.3 + v / 3, 0.3, 1.2) * (inside ? 1 : att), bus: 'env', rate: fm.spec.mass.mtow > 50000 ? 0.85 : 1.05 });
      if ((td.speed || 0) > 15) this.play('squeal', { volume: 0.6 * (inside ? 1 : att), bus: 'env', rate: 0.9 + Math.random() * 0.2 });
    }
    if (fm.damage.crashed && !this.prevCrash) { this.prevCrash = true; this.play('crash', { volume: 1, bus: 'env' }); this.play('damage', { volume: 0.8, bus: 'env' }); }
    // engine start / stop transients
    fm.engines.forEach((e, i) => {
      const prev = this.prevState[i];
      if (prev !== e.state) {
        if (e.state === 'lightoff' && (e.T0 || e.P0)) this.play('cfm_start', { volume: 0.4 * (inside ? 0.7 : att), bus: 'env', rate: e.T0 ? 1 : 0.8 });
        if (e.constructor.name === 'Piston' || e.constructor.name === 'PistonHeli') {
          if (e.state === 'running' && prev === 'cranking') this.play('pist_start', { volume: 0.7 * (inside ? 1 : att), bus: 'env' });
          if (prev === 'running' && e.state !== 'running') this.play('pist_cut', { volume: 0.6 * (inside ? 1 : att), bus: 'env' });
        }
        this.prevState[i] = e.state;
      }
      if (e.state === 'cranking' && (e.constructor.name === 'Piston' || e.constructor.name === 'PistonHeli')) {
        this.crankTimer -= 1 / 30;
        if (this.crankTimer <= 0) { this.crankTimer = 0.32; this.play('pist_crank', { volume: 0.5 * (inside ? 1 : att), bus: 'env', rate: 0.9 + Math.random() * 0.15 }); }
      }
    });
    // rotor low rpm horn
    if (fm.isHeli && ac.systems.warnings.get('rpmLow')?.active) this.repeat('lowrpm', 'lowrpm_horn', 0.6, 0.8);
    // GPWS altitude callouts (airliners / jets)
    if ((ac.spec.cat === 'airliner' || ac.spec.cat === 'jet') && settings.a.gpws && !fm.onGround) {
      const agl = (t.agl || 0) / FT;
      const prev = this.lastAlt ?? agl;
      const desc = agl < prev;
      const calls = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];
      if (desc && fm.gearPos > 0.9) {
        for (const c of calls) {
          if (prev > c && agl <= c && !this.callouts.has(c)) {
            this.callouts.add(c);
            const clip = c === 200 && ac.spec.cat === 'airliner' ? 'gpws_minimums' : `gpws_altitude_${c}`;
            this.play(clip, { volume: 0.9, bus: 'cockpit' });
            if (c === 20 && ac.spec.cat === 'airliner' && fm.ctl.throttle.some((v) => v > 0.15)) setTimeout(() => this.play('gpws_retard', { volume: 0.9 }), 450);
          }
        }
      }
      if (agl > 2700) this.callouts.clear();
      this.lastAlt = agl;
      const W = ac.systems.warnings;
      if (W.get('pullup')?.active) this.repeat('pullup', 'gpws_pull_up', 1.6, 1);
      else if (W.get('sink')?.active) this.repeat('sink', 'gpws_sink_rate', 2.0, 0.9);
      if (W.get('terrain')?.active) this.repeat('terrain', 'gpws_too_low_terrain' in (window.FS_AUDIO_PACK || {}) ? 'gpws_too_low_terrain' : 'gpws_terrain', 2.5, 0.9);
      if (W.get('gear')?.active && agl < 500) this.repeat('tlg', 'gpws_too_low_gear', 3, 0.9);
      if (W.get('bank')?.active) this.repeat('bank', 'gpws_bank_angle', 2.5, 0.9);
    }
    // altitude alerter: 900 ft before selected altitude
    if (ac.ap.available) {
      const altFt = fm.pos.y / FT;
      const diff = Math.abs(altFt - ac.ap.alt);
      const was = this.altArmed;
      if (diff > 1100) this.altArmed = true;
      if (was && diff < 900) { this.altArmed = false; this.play('alt_alert', { volume: 0.6 }); }
    }
  }

  repeat(key, clip, interval, vol) {
    const now = performance.now() / 1000;
    if (!this.lastWarnSound[key] || now - this.lastWarnSound[key] > interval) { this.lastWarnSound[key] = now; this.play(clip, { volume: vol, bus: 'cockpit' }); }
  }

  onWarning(w) {
    if (!this.ctx) return;
    if (w.id.startsWith('fire')) this.fireBell(3);
    else if (w.level === 'warning' && !['stall', 'gear', 'sink', 'pullup', 'terrain', 'bank', 'rpmLow'].includes(w.id)) { this.play('chime', { volume: 0.6 }); setTimeout(() => this.play('chime', { volume: 0.6 }), 700); }
    else if (w.level === 'caution') this.play('chime', { volume: 0.45 });
  }

  // Synthesised fire bell (rapid strikes of a bell partial set).
  fireBell(seconds) {
    const ctx = this.ctx;
    for (let k = 0; k < seconds * 8; k++) {
      const t0 = ctx.currentTime + k * 0.125;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      g.connect(this.cockpitBus);
      for (const f of [920, 2410, 3560]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t0); o.stop(t0 + 0.13); }
    }
  }

  // ---------------------------------------------------------- emergency vehicle sirens (synthesised, max 3 voices)
  setSirens(list) { this.sirenTargets = list; }
  updateSirens(camera, inside) {
    const ctx = this.ctx;
    const list = (this.sirenTargets || []).filter((s) => s.on).map((s) => ({ ...s, d: camera.position.distanceTo(s.pos) })).sort((a, b) => a.d - b.d).slice(0, 3);
    while (this.sirens.length < list.length) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.28;
      const lg = ctx.createGain(); lg.gain.value = 420;
      lfo.connect(lg); lg.connect(o.frequency);
      o.frequency.value = 1000;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.connect(f); f.connect(g); if (p) { g.connect(p); p.connect(this.worldBus); } else g.connect(this.worldBus);
      o.start(); lfo.start();
      this.sirens.push({ o, lfo, g, p, f });
    }
    const tNow = ctx.currentTime;
    this.sirens.forEach((s, i) => {
      const L = list[i];
      if (!L) { s.g.gain.setTargetAtTime(0, tNow, 0.2); return; }
      const att = clamp(40 / (40 + L.d), 0, 1) * (inside ? 0.35 : 1);
      s.g.gain.setTargetAtTime(att * 0.18, tNow, 0.1);
      s.lfo.frequency.setTargetAtTime(L.kind === 'police' ? 3.2 : 0.3, tNow, 0.1);
      s.f.frequency.setTargetAtTime(L.kind === 'police' ? 1300 : 1000, tNow, 0.1);
      if (s.p) { _v.copy(L.pos).applyMatrix4(camera.matrixWorldInverse); s.p.pan.setTargetAtTime(clamp(_v.x / Math.max(5, Math.hypot(_v.x, _v.z)), -0.9, 0.9), tNow, 0.1); }
    });
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}

export const audio = new AudioEngine();
