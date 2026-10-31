// Aircraft systems: electrical, hydraulics, fuel, lights, ignition/starting, anti-ice and the
// caution / warning system (master caution, master warning, GPWS-style alerts).
import { clamp, damp, KT, FT } from '../core/math.js';
import { bus } from '../core/events.js';

export class Systems {
  constructor(spec, fm) {
    this.spec = spec; this.fm = fm;
    this.battery = false; this.batteryCharge = 1; this.avionics = false; this.busVolts = 0;
    this.gens = fm.engines.map(() => true);      // generator switches
    this.genOnline = fm.engines.map(() => false);
    this.apu = { running: false, n: 0, starting: false, avail: !!spec.systems.apu };
    this.fuelPumps = false; this.ignition = false; this.pitotHeat = false; this.antiIce = false;
    this.lights = { nav: false, beacon: false, strobe: false, landing: false, taxi: false, logo: false, panel: 0.6, cabin: true, searchlight: false };
    this.hydPressure = 0; this.hydFail = false; this.elecFail = false; this.fuelLeak = 0;
    this.extinguishers = fm.engines.map(() => 2);
    this.warnings = new Map();
    this.masterWarning = false; this.masterCaution = false;
    this.seq = null;   // running start/stop sequence
    this.apuGen = false;
    this.seatbelt = true;
    this.lastGpws = {};
    this.gpwsMuteUntil = 0;
    this.altCallouts = new Set();
  }

  get ignitionOn() { return this.ignition || this.fm.engines.some((e) => e.state === 'cranking' || e.state === 'lightoff'); }
  get starterPower() { return this.busVolts > 18 || this.apu.running; }
  get powered() { return this.busVolts > 20; }
  get displaysOn() { return this.busVolts > 20 && (this.avionics || this.spec.cat === 'ga'); }

  setColdAndDark() {
    this.battery = false; this.avionics = false; this.fuelPumps = false; this.ignition = false;
    Object.assign(this.lights, { nav: false, beacon: false, strobe: false, landing: false, taxi: false, logo: false });
    for (const e of this.fm.engines) { e.running = false; e.state = 'off'; e.n1 = e.n2 = 0; e.rpm = 0; if (e.omega !== undefined) e.omega = 0; e.fuelCutoff = true; }
    this.apu.running = false; this.apu.n = 0;
    this.fm.ctl.parking = true;
    if (this.fm.isHeli) this.fm.omega = 0;
  }

  setRunning(airborne = false) {
    this.battery = true; this.avionics = true; this.fuelPumps = true; this.ignition = true; this.pitotHeat = true;
    Object.assign(this.lights, { nav: true, beacon: true, strobe: airborne, landing: airborne, taxi: !airborne, logo: true });
    for (const e of this.fm.engines) e.setRunningInstant(15);
    this.busVolts = 28;
    if (this.fm.isHeli) { this.fm.omega = this.fm.omegaN; for (const e of this.fm.engines) if (e.flight !== undefined) e.flight = 1; }
  }

  // Automatic start sequence (realistic order, animated over time).
  autoStart() {
    if (this.seq && this.seq.kind === 'start') return;
    const steps = [];
    const S = (t, label, fn) => steps.push({ t, label, fn });
    let t = 0;
    S(t, 'Battery ON', () => { this.battery = true; });
    S(t += 0.8, 'Beacon ON', () => { this.lights.beacon = true; this.lights.nav = true; });
    S(t += 0.8, 'Fuel pumps ON', () => { this.fuelPumps = true; });
    if (this.apu.avail) {
      S(t += 0.8, 'APU START', () => { this.apu.starting = true; });
      S(t += 6, 'APU generator ON', () => { this.apuGen = true; });
    }
    S(t += 0.8, 'Ignition / magnetos ON', () => { this.ignition = true; });
    const n = this.fm.engines.length;
    const order = n === 4 ? [3, 2, 1, 0] : n === 3 ? [2, 1, 0] : n === 2 ? [1, 0] : [0];
    for (const i of order) {
      S(t += 1.0, `Engine ${i + 1} START`, () => { const e = this.fm.engines[i]; e.fuelCutoff = false; e.requestStart(); });
      steps.push({ t: t + 1, label: `Engine ${i + 1} stabilising`, waitFor: () => this.fm.engines[i].running || this.fm.engines[i].state === 'off', timeout: 70 });
      t += 1;
    }
    S(t += 0.5, 'Generators ON', () => { this.gens = this.gens.map(() => true); });
    S(t += 0.5, 'Avionics ON', () => { this.avionics = true; this.pitotHeat = true; });
    if (this.apu.avail) S(t += 2, 'APU OFF', () => { this.apu.running = false; this.apu.starting = false; this.apuGen = false; });
    if (this.fm.isHeli) S(t += 0.5, 'Throttles to FLIGHT', () => { for (const e of this.fm.engines) if (e.flight !== undefined) e.flight = 1; });
    S(t += 0.3, 'Taxi light ON', () => { this.lights.taxi = true; });
    this.seq = { kind: 'start', steps, i: 0, t: 0 };
    bus.emit('systems:seq', { kind: 'start', label: 'Engine start sequence' });
  }

  autoShutdown() {
    const steps = [];
    let t = 0;
    const S = (dt, label, fn) => steps.push({ t: t += dt, label, fn });
    S(0, 'Throttles IDLE', () => { this.fm.ctl.throttle = this.fm.ctl.throttle.map(() => 0); this.fm.ctl.collective = 0; });
    S(1, 'Parking brake SET', () => { this.fm.ctl.parking = true; });
    S(1, 'Engines CUTOFF', () => { for (const e of this.fm.engines) e.shutdown(); });
    S(2, 'Avionics OFF', () => { this.avionics = false; });
    S(1, 'Lights OFF', () => { Object.assign(this.lights, { landing: false, taxi: false, strobe: false, logo: false }); });
    S(6, 'Beacon OFF', () => { this.lights.beacon = false; this.lights.nav = false; });
    S(1, 'Fuel pumps / ignition OFF', () => { this.fuelPumps = false; this.ignition = false; });
    S(1, 'Battery OFF', () => { this.battery = false; });
    this.seq = { kind: 'stop', steps, i: 0, t: 0 };
    bus.emit('systems:seq', { kind: 'stop', label: 'Shutdown sequence' });
  }

  runSequence(dt) {
    const q = this.seq;
    if (!q) return;
    q.t += dt;
    while (q.i < q.steps.length) {
      const s = q.steps[q.i];
      if (s.waitFor) {
        if (!s.started) { s.started = q.t; }
        if (s.waitFor() || q.t - s.started > (s.timeout || 60)) { q.i++; q.t = Math.max(q.t, s.t); continue; }
        break;
      }
      if (q.t < s.t) break;
      s.fn && s.fn();
      bus.emit('systems:step', s.label);
      q.i++;
    }
    if (q.i >= q.steps.length) { bus.emit('systems:seqDone', q.kind); this.seq = null; }
  }

  update(dt, weather) {
    const fm = this.fm;
    this.runSequence(dt);
    // APU
    if (this.apu.starting && !this.apu.running) { this.apu.n = Math.min(1, this.apu.n + dt / 5); if (this.apu.n >= 1) this.apu.running = true; }
    if (!this.apu.starting && !this.apu.running) this.apu.n = Math.max(0, this.apu.n - dt / 8);
    // electrical
    let genVolts = 0;
    fm.engines.forEach((e, i) => {
      const on = this.gens[i] && !this.elecFail && e.running && e.n2 > (e.rpmMax ? 0.18 : 0.45);
      this.genOnline[i] = on;
      if (on) genVolts = 28.2;
    });
    if (this.apu.running && this.apuGen) genVolts = 28.2;
    if (this.battery) {
      if (genVolts > 0) { this.busVolts = damp(this.busVolts, genVolts, 3, dt); this.batteryCharge = Math.min(1, this.batteryCharge + dt / 1800); }
      else {
        const load = (this.avionics ? 1 : 0.3) + (this.lights.landing ? 0.4 : 0) + (this.pitotHeat ? 0.3 : 0) + fm.engines.filter((e) => e.state === 'cranking').length * 3;
        this.batteryCharge = Math.max(0, this.batteryCharge - load * dt / (this.spec.mass.mtow > 20000 ? 2400 : 1500));
        this.busVolts = damp(this.busVolts, 24.5 * (0.6 + 0.4 * this.batteryCharge) - (this.batteryCharge < 0.15 ? 6 : 0), 3, dt);
      }
    } else this.busVolts = damp(this.busVolts, genVolts > 0 && false ? 28 : 0, 6, dt);
    fm.electric = this.busVolts > 20 ? 1 : 0;
    // hydraulics
    const pump = !this.hydFail && (fm.engines.some((e) => e.running && e.n2 > 0.4) || (this.busVolts > 22 && this.spec.systems.hydraulics) || this.apu.running);
    this.hydPressure = damp(this.hydPressure, pump ? 3000 : 0, pump ? 1.2 : 0.15, dt);
    fm.hydraulic = this.spec.systems.hydraulics ? clamp(this.hydPressure / 2200, 0, 1) : 1;
    // fuel leak
    if (this.fuelLeak > 0) fm.fuel = Math.max(0, fm.fuel - this.fuelLeak * dt);
    // icing: visible moisture below +3 C without anti-ice
    const t = fm.telemetry;
    const moist = weather.precip > 0.15 || (weather.inCloud && weather.inCloud > 0.3);
    if (moist && t.oat !== undefined && t.oat < 3 && !this.antiIce && !fm.onGround) fm.icing = Math.min(1, fm.icing + dt / 240);
    else fm.icing = Math.max(0, fm.icing - dt / (this.antiIce ? 40 : 400));
    if (moist && t.oat < 0 && !this.pitotHeat && !fm.pitotFail && !fm.onGround && Math.random() < dt / 120) { fm.pitotFail = true; fm.pitotFrozen = t.ias; }
    if (this.pitotHeat && fm.pitotFail && fm.pitotFailCause !== 'failure') { fm.pitotFail = false; }
    this.updateWarnings(dt);
  }

  setWarn(id, active, level, text) {
    const w = this.warnings.get(id);
    if (active) {
      if (!w || !w.active) {
        this.warnings.set(id, { id, level, text, active: true, since: performance.now() });
        if (level === 'warning') this.masterWarning = true; else if (level === 'caution') this.masterCaution = true;
        bus.emit('warning', { id, level, text });
      }
    } else if (w && w.active) { w.active = false; bus.emit('warningCleared', { id }); }
  }

  updateWarnings(dt) {
    const fm = this.fm, t = fm.telemetry, s = this.spec;
    const air = !fm.onGround && t.agl > 15;
    fm.engines.forEach((e, i) => {
      const n = fm.engines.length > 1 ? ` ${i + 1}` : '';
      this.setWarn('fire' + i, e.fire && !e.extinguished, 'warning', `ENGINE${n} FIRE`);
      this.setWarn('fail' + i, !!e.failed && !e.running && e.failed !== 'partial' && e.failed !== 'oil', 'caution', `ENGINE${n} FAILURE`);
      this.setWarn('oilp' + i, e.running && e.oilP < (e.oilPmax || 60) * 0.3, 'caution', `ENG${n} OIL PRESS`);
      this.setWarn('oilt' + i, e.oilT > 125, 'caution', `ENG${n} OIL TEMP`);
      this.setWarn('pwr' + i, e.failed === 'partial' && e.running, 'caution', `ENG${n} POWER LOSS`);
      this.setWarn('gen' + i, e.running && !this.genOnline[i], 'caution', `GEN${n} OFF`);
    });
    this.setWarn('fuel', fm.fuel < s.mass.fuelMax * 0.1, 'caution', 'LOW FUEL');
    this.setWarn('fuelLeak', this.fuelLeak > 0, 'caution', 'FUEL IMBALANCE / LEAK');
    this.setWarn('hyd', s.systems.hydraulics && this.hydPressure < 1500 && fm.engines.some((e) => e.running), 'caution', 'HYD PRESS LOW');
    this.setWarn('elec', this.battery && this.busVolts < 22 && this.busVolts > 1, 'caution', 'ELEC BUS LOW');
    this.setWarn('ice', fm.icing > 0.15, 'caution', 'ICE DETECTED');
    this.setWarn('pitot', !!fm.pitotFail, 'caution', 'AIRSPEED UNRELIABLE');
    if (!fm.isHeli) {
      this.setWarn('stall', air && fm.stallWarn > 0.55, 'warning', 'STALL');
      const gearUp = s.retract && fm.gearPos < 0.99;
      const lowIdle = air && t.agl < 230 && fm.ctl.throttle.every((v) => v < 0.25) && t.vs < 0;
      this.setWarn('gear', gearUp && (lowIdle || (fm.flapDeg >= (s.aero.flaps[s.aero.flaps.length - 1]?.deg || 99) * 0.7)), 'warning', 'GEAR NOT DOWN');
      const cfg = fm.onGround && fm.ctl.throttle.some((v) => v > 0.75) && t.ias < 60 * KT && (fm.ctl.parking || fm.spoilerPos > 0.3 || (s.cat === 'airliner' && s.aero.flaps.length > 2 && fm.ctl.flapIndex === 0));
      this.setWarn('config', cfg, 'warning', 'TAKEOFF CONFIG');
    } else {
      this.setWarn('rpmLow', air && fm.nr < 0.92, 'warning', 'ROTOR RPM LOW');
      this.setWarn('rpmHigh', fm.nr > 1.08, 'caution', 'ROTOR RPM HIGH');
      this.setWarn('vrs', air && fm.vrs > 0.4, 'caution', 'VORTEX RING STATE');
      this.setWarn('tr', fm.tailRotorFail, 'warning', 'TAIL ROTOR FAILURE');
    }
    this.setWarn('overspeed', fm.overspeed > 0, 'warning', 'OVERSPEED');
    this.setWarn('damage', fm.damage.total > 0.25 && !fm.damage.crashed, 'caution', 'AIRFRAME DAMAGE');
    // GPWS style alerts (airliners / jets)
    if (s.cat === 'airliner' || s.cat === 'jet') {
      const sink = air && t.agl < 760 && t.vs < -Math.max(5.6, t.agl * 0.025 + 3.5);
      const pull = air && t.agl < 500 && t.vs < -Math.max(8, t.agl * 0.04 + 5);
      this.setWarn('sink', sink && !pull, 'caution', 'SINK RATE');
      this.setWarn('pullup', pull, 'warning', 'PULL UP');
      const terr = air && t.agl < 300 && t.vs < -2 && fm.gearPos < 0.5;
      this.setWarn('terrain', terr && !pull, 'warning', 'TOO LOW TERRAIN');
      this.setWarn('bank', air && Math.abs(t.bank) > 40 && t.agl < 900, 'caution', 'BANK ANGLE');
    }
  }

  activeWarnings() {
    const out = [];
    for (const w of this.warnings.values()) if (w.active) out.push(w);
    out.sort((a, b) => (a.level === b.level ? b.since - a.since : a.level === 'warning' ? -1 : 1));
    return out;
  }

  ackMaster() { this.masterWarning = false; this.masterCaution = false; }

  // Fire handle: shut down engine and discharge a bottle.
  pullFireHandle(i) {
    const e = this.fm.engines[i];
    if (!e) return false;
    e.shutdown();
    if (this.extinguishers[i] > 0) {
      this.extinguishers[i]--;
      if (Math.random() < 0.85) { e.extinguished = true; e.fire = false; bus.emit('toast', `Engine ${i + 1} fire extinguished`); return true; }
      bus.emit('toast', `Engine ${i + 1}: bottle discharged - fire persists!`);
    }
    return false;
  }
}
