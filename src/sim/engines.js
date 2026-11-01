// Engine simulation: piston (with propeller load & governor), turboprop, turbofan/turbojet, turboshaft.
// Every engine exposes the same telemetry so instruments, sounds and animations stay in sync:
//   n1, n2 (0..~1.05), rpm (shaft/prop rpm), visRpm (component rotation rpm), thrust (N), power (W),
//   torque (0..1), egt/itt (C), oilT (C), oilP (psi), ff (kg/s), state, running, fire, failed.
import { clamp, lerp, damp, KT } from '../core/math.js';

const START_FAST = { value: 1 };

// Smooth blend between static thrust (momentum theory) and power-limited thrust eta*P/V.
function propThrust(Tstatic, etaP, V) {
  if (Tstatic <= 0 || etaP <= 0) return 0;
  const a = 1 / Tstatic, b = V / etaP;
  return 1 / Math.cbrt(a * a * a + b * b * b);
}     // global start-time multiplier (simplified mode speeds starts up)
export function setStartSpeed(k) { START_FAST.value = k; }

class EngineBase {
  constructor(spec, index) {
    this.spec = spec;
    this.index = index;
    this.throttle = 0;          // pilot command 0..1
    this.reverse = 0;           // 0..1 reverser deployed
    this.state = 'off';         // off | cranking | lightoff | running | spooldown | failed
    this.running = false;
    this.starter = false;
    this.ignition = false;
    this.fuelCutoff = false;    // condition lever / mixture cutoff / fire handle
    this.n1 = 0; this.n2 = 0; this.rpm = 0; this.visRpm = 0;
    this.thrust = 0; this.power = 0; this.torque = 0; this.ff = 0;
    this.egt = 15; this.oilT = 15; this.oilP = 0; this.cht = 15; this.map = 29.9;
    this.fire = false; this.failed = null; this.damage = 0;
    this.maxPowerFactor = 1;    // partial power loss
    this.oilLeak = 0;           // 0..1 oil lost
    this.vibration = 0;
    this.startTimer = 0;
    this.startT = 0;
    this.roughPhase = Math.random() * 10;
    this.extinguished = false;
  }
  // engine already running at idle (spawn with engines running / airborne): oil pressure established
  setRunningInstant(oat) { this.running = true; this.state = 'running'; this.oilP = (this.oilPmax || 60) * 0.72; }
  fail(type) {
    this.failed = type;
    if (type === 'fire') { this.fire = true; }
    if (type === 'flameout' || type === 'seize') { this.running = false; this.state = 'spooldown'; }
    if (type === 'partial') { this.maxPowerFactor = 0.35 + Math.random() * 0.25; }
    if (type === 'oil') { this.oilLeak = 0.0001; }
  }
  repair() { this.failed = null; this.fire = false; this.maxPowerFactor = 1; this.oilLeak = 0; this.damage = 0; this.extinguished = false; }
  shutdown() { this.fuelCutoff = true; if (this.running) { this.running = false; this.state = 'spooldown'; } this.starter = false; }
  requestStart() {
    if (this.failed === 'seize' || this.damage >= 1) return false;
    if (this.running || this.state === 'cranking' || this.state === 'lightoff') return false;
    this.fuelCutoff = false;
    this.starter = true; this.state = 'cranking'; this.startT = 0;
    return true;
  }
  commonTemps(dt, env, load) {
    // oil temperature tends to a load dependent value; oil pressure from rpm and oil quantity
    const target = this.running ? lerp(60, 95, load) + (this.oilLeak > 0.6 ? (this.oilLeak - 0.6) * 150 : 0) : env.oatC;
    this.oilT = damp(this.oilT, target, this.running ? 0.012 : 0.004, dt);
    if (this.oilLeak > 0 && this.running) this.oilLeak = Math.min(1, this.oilLeak + dt / 90);
    const sf = this.spinFrac();
    const op = (this.running ? (0.5 + 0.5 * Math.min(1, sf)) : Math.min(1, sf) * 0.8) * (this.oilPmax || 60) * (1 - Math.max(0, this.oilLeak - 0.3) * 1.4);
    this.oilP = damp(this.oilP, Math.max(0, op), 2, dt);
    if (this.oilLeak >= 1 && this.running) { this.fail('seize'); }
    if (this.fire && !this.extinguished) {
      this.damage = Math.min(1, this.damage + dt / 75);
      if (this.damage >= 1 && this.running) { this.running = false; this.state = 'spooldown'; }
    }
  }
  spinFrac() { return this.n2; }
}

// ------------------------------------------------------------------ Turbofan / turbojet
export class Turbofan extends EngineBase {
  // explicit type tag (class names are mangled by the minifier, so never test constructor.name)
  get kind() { return 'turbofan'; }
  constructor(spec, index) {
    super(spec, index);
    this.T0 = spec.thrustKN * 1000;
    this.bypass = spec.bypass ?? 5;
    this.spool = spec.spool ?? 6;
    this.idleN2 = 0.6; this.idleN1 = 0.21;
    this.ab = 0;
    this.oilPmax = 55;
    this.fanBlades = spec.fanBlades || 24;
    this.maxRpmN1 = this.bypass > 6 ? 2600 : this.bypass > 3 ? 4800 : 7000;
  }
  setRunningInstant(oat) {
    super.setRunningInstant(oat);
    this.n2 = this.idleN2; this.n1 = this.idleN1; this.egt = 450; this.oilT = 60; this.oilP = 40; this.fuelCutoff = false;
  }
  update(dt, env) {
    const s = START_FAST.value;
    let n2Target = 0;
    const fuelOK = env.fuel && !this.fuelCutoff;
    if (this.state === 'cranking') {
      // starter accelerates the core to ~22 % N2
      this.startT += dt * s;
      n2Target = env.starterPower ? 0.25 : 0;
      if (this.n2 > 0.19 && fuelOK && env.ignition) { this.state = 'lightoff'; this.startT = 0; }
      if (this.startT > 60) { this.state = 'off'; this.starter = false; }
    } else if (this.state === 'lightoff') {
      this.startT += dt * s;
      n2Target = this.idleN2 + 0.02;
      if (this.n2 > this.idleN2 - 0.02) { this.state = 'running'; this.running = true; this.starter = false; }
      if (!fuelOK) { this.state = 'spooldown'; this.starter = false; }
    } else if (this.running) {
      if (!fuelOK) { this.running = false; this.state = 'spooldown'; }
      const thr = clamp(this.throttle, 0, 1) * this.maxPowerFactor;
      n2Target = this.idleN2 + (1.0 - this.idleN2) * Math.pow(thr, 0.75);
      if (this.reverse > 0.5) n2Target = this.idleN2 + (0.92 - this.idleN2) * thr;
    }
    // windmilling in flight keeps the spools turning
    const windmill = clamp(env.tas / 250, 0, 0.32) * (this.failed === 'seize' ? 0 : 1);
    n2Target = Math.max(n2Target, windmill * 0.5);
    // spool dynamics: slow near idle, faster at high rpm; spool-down slower than up at low N2
    const up = n2Target > this.n2;
    let tau;
    if (this.state === 'cranking') tau = 6 / s;
    else if (this.state === 'lightoff') tau = 4.5 / s;
    else if (!this.running) tau = up ? 3 : 4.0 + (1 - this.n2) * 6;
    else tau = (this.spool / 3.2) * (up ? (1.75 - this.n2 * 0.95) : (1.2 - this.n2 * 0.35));
    if (this.failed === 'seize') tau = 0.6;
    this.n2 += (n2Target - this.n2) * (1 - Math.exp(-dt / Math.max(0.05, tau)));
    // N1 follows N2 with the fan's own lag
    const n2 = this.n2;
    const n1T = n2 >= this.idleN2 ? this.idleN1 + (1 - this.idleN1) * Math.pow((n2 - this.idleN2) / (1 - this.idleN2), 1.35) : this.idleN1 * Math.pow(n2 / this.idleN2, 2.2);
    this.n1 = damp(this.n1, Math.max(n1T, windmill), up ? 2.2 : 1.6, dt);
    // thrust
    const n1 = this.n1;
    const combustion = this.running || this.state === 'lightoff';
    let core = combustion ? clamp((n1 - 0.2) / 0.8, 0, 1) : 0;
    let f = combustion ? 0.05 * clamp(n1 / this.idleN1, 0, 1) + 0.95 * Math.pow(core, 1.8) : 0;
    const M = env.mach;
    const lapse = this.bypass > 3 ? (1 - 0.5 * M + 0.12 * M * M) : (1 - 0.15 * M + 0.35 * M * M);
    let T = this.T0 * f * Math.pow(env.sigma, this.bypass > 3 ? 0.78 : 0.7) * clamp(lapse, 0.15, 2);
    // afterburner (SST): engaged near full throttle in reheat-capable engines
    this.ab = damp(this.ab, (this.spec.afterburner && this.running && this.throttle > 0.97 && this.reverse < 0.5) ? 1 : 0, 1.5, dt);
    T *= 1 + (this.spec.afterburner || 0) * this.ab * (1 + 0.6 * M);
    if (this.reverse > 0) T *= 1 - this.reverse * 1.45;     // reverse thrust ~45 %
    // ram drag of a windmilling engine
    if (!combustion) T = -0.004 * this.T0 * clamp(env.tas / 100, 0, 3) * (this.failed === 'seize' ? 2 : 1);
    this.thrust = T;
    this.power = Math.abs(T) * Math.max(env.tas, 1);
    // fuel flow (kg/s)
    const tsfc = this.bypass > 3 ? 1.55e-5 : this.bypass > 0.5 ? 2.05e-5 : 2.6e-5;
    this.ff = combustion ? (tsfc * Math.max(T, 0) * (1 + 0.25 * M) + 0.00004 * this.T0 / 1000 * 0.012 + this.ab * 2.5e-5 * this.T0 * f) : 0;
    // temperatures
    let egtT = combustion ? 380 + 520 * Math.pow(n2, 3) : env.oatC + n2 * 40;
    if (this.state === 'lightoff') egtT = 480 + 260 * Math.sin(Math.min(1, this.startT / 10) * Math.PI);
    if (this.fire && !this.extinguished) egtT += 350;
    if (this.oilLeak > 0.7) egtT += (this.oilLeak - 0.7) * 300;
    this.egt = damp(this.egt, egtT, combustion ? 0.7 : 0.15, dt);
    this.commonTemps(dt, env, n2);
    this.torque = n1;
    this.rpm = n1 * this.maxRpmN1;
    this.visRpm = this.rpm;
    this.vibration = (this.failed === 'partial' ? 0.5 : 0) + (this.fire ? 0.3 : 0) + (this.oilLeak > 0.6 ? 0.5 : 0);
  }
}

// ------------------------------------------------------------------ Turboprop (free turbine, constant speed prop)
export class Turboprop extends EngineBase {
  // explicit type tag (class names are mangled by the minifier, so never test constructor.name)
  get kind() { return 'turboprop'; }
  constructor(spec, index) {
    super(spec, index);
    this.P0 = spec.powerKW * 1000;
    this.prop = spec.prop;
    this.propRpmMax = spec.prop.rpm;
    this.A = Math.PI * (spec.prop.diam / 2) ** 2;
    this.np = 0;          // prop rpm fraction
    this.feather = 1;     // 1 = feathered
    this.oilPmax = 95;
    this.idleN2 = 0.62;   // here n2 = gas generator Ng
    this.condition = 1;   // prop rpm lever (0.8..1)
  }
  setRunningInstant() { super.setRunningInstant(); this.n2 = this.idleN2; this.np = 0.7; this.feather = 0; this.egt = 560; this.oilT = 55; this.fuelCutoff = false; }
  update(dt, env) {
    const s = START_FAST.value;
    const fuelOK = env.fuel && !this.fuelCutoff;
    let ngT = 0;
    if (this.state === 'cranking') {
      this.startT += dt * s;
      ngT = env.starterPower ? 0.18 : 0;
      if (this.n2 > 0.12 && fuelOK && env.ignition) { this.state = 'lightoff'; this.startT = 0; }
      if (this.startT > 60) { this.state = 'off'; this.starter = false; }
    } else if (this.state === 'lightoff') {
      this.startT += dt * s;
      ngT = this.idleN2 + 0.02;
      if (this.n2 > this.idleN2 - 0.03) { this.state = 'running'; this.running = true; this.starter = false; }
      if (!fuelOK) { this.state = 'spooldown'; this.starter = false; }
    } else if (this.running) {
      if (!fuelOK) { this.running = false; this.state = 'spooldown'; }
      const thr = clamp(this.throttle, 0, 1) * this.maxPowerFactor;
      ngT = this.reverse > 0.5 ? this.idleN2 + 0.2 * thr : this.idleN2 + (1.02 - this.idleN2) * Math.pow(thr, 0.8);
    }
    const tau = this.state === 'cranking' ? 5 / s : this.state === 'lightoff' ? 4 / s : this.running ? (ngT > this.n2 ? 1.6 : 1.3) : 3.5;
    this.n2 += (ngT - this.n2) * (1 - Math.exp(-dt / tau));
    if (this.failed === 'seize') this.n2 = damp(this.n2, 0, 3, dt);
    const combustion = this.running || this.state === 'lightoff';
    // gas power available
    const ng = this.n2;
    let P = combustion ? this.P0 * Math.pow(clamp((ng - 0.5) / 0.52, 0, 1.05), 1.5) * Math.min(1, Math.pow(env.sigma, 0.7) * 1.15) : 0;
    P = Math.min(P, this.P0 * this.maxPowerFactor);
    // propeller: unfeathers once running; rpm governed between 70 % (ground idle) and 100 %
    this.feather = damp(this.feather, combustion ? 0 : 1, combustion ? 0.8 : 0.5, dt);
    const npGov = combustion ? lerp(0.72, 0.82 + 0.18 * this.condition, clamp((this.throttle - 0.05) / 0.5, 0, 1)) : 0;
    const windmill = (1 - this.feather) * clamp(env.tas / 120, 0, 0.6);
    this.np = damp(this.np, Math.max(npGov * clamp((ng - 0.35) / 0.25, 0, 1), windmill), combustion ? 0.7 : 0.35, dt);
    // thrust from power and airspeed (momentum theory static limit)
    const V = Math.max(env.tas, 0);
    const Tstatic = Math.pow(2 * env.rho * this.A * P * P, 1 / 3) * 0.8;
    const eta = 0.84;
    let T = combustion ? propThrust(Tstatic, eta * P, V) : 0;
    if (this.reverse > 0) T = -this.reverse * Tstatic * 0.45 * (0.3 + this.throttle);
    if (!combustion) T = -(1 - this.feather) * 0.5 * env.rho * V * V * this.A * 0.045;   // windmilling drag
    this.thrust = T;
    this.power = P;
    this.torque = P / this.P0 / Math.max(0.3, this.np);
    this.ff = combustion ? (0.26 / 3.6e6 * 1000) * P * 1.0 + 0.012 : 0;   // ~0.26 kg/kWh
    let ittT = combustion ? 420 + 380 * Math.pow(P / this.P0, 0.9) + 60 * (1 - env.sigma) : env.oatC;
    if (this.state === 'lightoff') ittT = 600 + 250 * Math.sin(Math.min(1, this.startT / 8) * Math.PI);
    if (this.fire && !this.extinguished) ittT += 300;
    this.egt = damp(this.egt, ittT, combustion ? 0.8 : 0.15, dt);
    this.commonTemps(dt, env, P / this.P0);
    this.n1 = this.np;          // n1 telemetry = prop rpm fraction for gauges
    this.rpm = this.np * this.propRpmMax;
    this.visRpm = this.rpm;
    this.vibration = (this.failed === 'partial' ? 0.5 : 0) + (this.fire ? 0.3 : 0);
  }
}

// ------------------------------------------------------------------ Piston engine + propeller
export class Piston extends EngineBase {
  // explicit type tag (class names are mangled by the minifier, so never test constructor.name)
  get kind() { return 'piston'; }
  constructor(spec, index) {
    super(spec, index);
    this.Pmax = spec.powerKW * 1000;
    this.rpmMax = spec.rpmMax || 2700;
    this.prop = spec.prop || { diam: 2, blades: 2, fixed: true };
    this.A = Math.PI * (this.prop.diam / 2) ** 2;
    this.fixed = !!this.prop.fixed;
    this.mixture = 1;
    this.propLever = 1;         // constant-speed rpm lever
    this.omega = 0;             // rad/s crankshaft
    this.I = 1.6 + this.Pmax / 1000 * 0.04 + (spec.heli ? 0 : this.prop.diam * 0.6);
    this.oilPmax = 75;
    this.heli = !!spec.heli;
    this.catchTimer = 0;
    // fixed-pitch prop absorbs ~Pmax at ~2350 rpm static
    const n = 2350 / 60;
    this.kq = this.Pmax * 0.93 / (2 * Math.PI * n) / (1.225 * n * n * Math.pow(this.prop.diam, 5));
    this.cht = 15;
  }
  setRunningInstant() { super.setRunningInstant(); this.omega = 800 / 60 * 2 * Math.PI; this.rpm = this.visRpm = 800; this.n1 = this.n2 = 800 / this.rpmMax; this.oilT = 60; this.cht = 140; this.egt = 600; this.fuelCutoff = false; }
  spinFrac() { return clamp(this.rpm / this.rpmMax, 0, 1.2); }
  update(dt, env) {
    const s = START_FAST.value;
    const rpm = this.omega * 60 / (2 * Math.PI);
    const fuelOK = env.fuel && !this.fuelCutoff && this.mixture > 0.05;
    let starterQ = 0;
    if (this.state === 'cranking') {
      this.startT += dt * s;
      starterQ = env.starterPower ? 180 + this.Pmax / 1000 * 0.4 : 0;
      if (rpm > 120 && fuelOK && env.ignition) {
        this.catchTimer += dt * s;
        if (this.catchTimer > 0.6 + Math.random() * 1.2) { this.state = 'running'; this.running = true; this.starter = false; this.catchTimer = 0; }
      }
      if (this.startT > 30) { this.state = 'off'; this.starter = false; }
    } else if (this.running) {
      if (!fuelOK || !env.ignition) { this.running = false; this.state = 'spooldown'; }
    }
    const combustion = this.running;
    // manifold pressure (inHg) and power
    const thr = clamp(this.throttle, 0, 1);
    const map = combustion ? lerp(10.5, 29.6, Math.pow(thr, 0.85)) * Math.min(1, env.sigma * 1.02 + 0.02) : 29.92 * env.sigma * 0.98;
    this.map = damp(this.map, map, 4, dt);
    const rpmF = clamp(rpm / this.rpmMax, 0, 1.15);
    let P = combustion ? this.Pmax * clamp((this.map - 9) / 20.6, 0, 1.1) * (0.25 + 0.75 * rpmF) * this.maxPowerFactor : 0;
    if (combustion && this.failed === 'partial') P *= 0.85 + 0.15 * Math.sin(env.time * 13 + this.roughPhase) * Math.sin(env.time * 3.1);
    P = Math.max(P, combustion ? this.Pmax * 0.035 : 0);     // idle power
    const Qe = this.omega > 1 ? P / this.omega : P / 1;
    // propeller absorbed torque
    let Qp;
    const n = this.omega / (2 * Math.PI);
    const V = Math.max(0, env.tas);
    const J = n > 0.5 ? V / (n * this.prop.diam) : 0;
    if (this.heli) {
      Qp = env.heliLoadTorque || 0;
    } else if (this.fixed) {
      const cq = Math.max(0.15, 1 - 0.55 * J / 0.95);
      Qp = this.kq * env.rho * n * n * Math.pow(this.prop.diam, 5) * cq * (1 + 0.04 * Math.sign(n));
    } else {
      // governor: pitch varies to hold target rpm; below that power absorbs as fine pitch
      const target = combustion ? lerp(2100, this.rpmMax, this.propLever) * (thr < 0.15 ? 0.3 + thr * 4 : 1) : 0;
      const fineQ = this.kq * 0.55 * env.rho * n * n * Math.pow(this.prop.diam, 5) * Math.max(0.1, 1 - J / 1.3);
      const govQ = Qe + (rpm - target) * 0.9;
      Qp = Math.max(fineQ, Math.min(govQ, fineQ * 6));
      if (!combustion) Qp = fineQ * (this.failed === 'seize' ? 1 : 0.6);
    }
    // windmill: airflow drives the prop
    const windQ = !combustion && !this.heli ? 0.5 * env.rho * V * V * this.A * 0.012 * this.prop.diam * (this.failed === 'seize' ? 0 : 1) : 0;
    const friction = 6 + this.omega * 0.18 + (this.failed === 'seize' ? 4000 : 0) + (this.oilLeak > 0.8 ? (this.oilLeak - 0.8) * 3000 : 0);
    const dw = (Qe + starterQ + windQ - Qp - friction * Math.sign(this.omega)) / this.I;
    this.omega = Math.max(0, this.omega + dw * dt);
    if (this.omega < 2 && !combustion && starterQ === 0) this.omega = damp(this.omega, 0, 3, dt);
    this.rpm = this.omega * 60 / (2 * Math.PI);
    this.visRpm = this.rpm;
    this.n1 = clamp(this.rpm / this.rpmMax, 0, 1.2);
    this.n2 = this.n1;
    // propeller thrust
    let T = 0;
    if (!this.heli) {
      const Pprop = Math.max(0, Qp * this.omega);
      const Tstatic = Math.pow(2 * env.rho * this.A * Pprop * Pprop, 1 / 3) * 0.72;
      const eta = 0.8 * clamp(1 - Math.pow(Math.max(0, J - 0.9) / 0.5, 2), 0.2, 1);
      T = propThrust(Tstatic, eta * Pprop, V);
      if (!combustion) T = -0.5 * env.rho * V * V * this.A * (this.failed === 'seize' ? 0.06 : 0.035);
    }
    this.thrust = T;
    this.power = P;
    this.torque = P / this.Pmax;
    this.ff = combustion ? P * (0.085 / 1000 / 3600 * (0.7 + 0.6 * this.mixture)) * 3.6 + 0.0015 : 0;   // ~0.3 kg/kWh
    // temperatures
    const egtT = combustion ? 520 + 220 * (P / this.Pmax) - 120 * (this.mixture - 0.75) : env.oatC + 20;
    this.egt = damp(this.egt, egtT + (this.fire ? 300 : 0), 0.5, dt);
    const chtT = combustion ? 120 + 95 * (P / this.Pmax) - Math.min(40, V * 0.25) + (this.oilLeak > 0.6 ? 80 : 0) : env.oatC;
    this.cht = damp(this.cht, chtT, 0.02, dt);
    this.commonTemps(dt, env, P / this.Pmax);
    this.vibration = (this.failed === 'partial' ? 0.6 : 0) + (this.oilLeak > 0.7 ? 0.5 : 0) + (this.fire ? 0.3 : 0);
  }
}

// ------------------------------------------------------------------ Turboshaft (helicopters)
export class Turboshaft extends EngineBase {
  // explicit type tag (class names are mangled by the minifier, so never test constructor.name)
  get kind() { return 'turboshaft'; }
  constructor(spec, index) {
    super(spec, index);
    this.P0 = spec.powerKW * 1000;
    this.idleN2 = 0.62;      // Ng ground idle
    this.oilPmax = 85;
    this.powerCmd = 0;       // from governor (0..1)
    this.flight = 1;         // throttle twist / engine mode: 0 = idle, 1 = flight
  }
  setRunningInstant() { super.setRunningInstant(); this.n2 = 0.8; this.egt = 600; this.oilT = 60; this.flight = 1; this.fuelCutoff = false; }
  update(dt, env) {
    const s = START_FAST.value;
    const fuelOK = env.fuel && !this.fuelCutoff;
    let ngT = 0;
    if (this.state === 'cranking') {
      this.startT += dt * s;
      ngT = env.starterPower ? 0.2 : 0;
      if (this.n2 > 0.14 && fuelOK && env.ignition) { this.state = 'lightoff'; this.startT = 0; }
      if (this.startT > 60) { this.state = 'off'; this.starter = false; }
    } else if (this.state === 'lightoff') {
      this.startT += dt * s;
      ngT = this.idleN2 + 0.02;
      if (this.n2 > this.idleN2 - 0.03) { this.state = 'running'; this.running = true; this.starter = false; }
      if (!fuelOK) { this.state = 'spooldown'; this.starter = false; }
    } else if (this.running) {
      if (!fuelOK) { this.running = false; this.state = 'spooldown'; }
      // governor power command maps to Ng; idle when the twist grip is at idle
      const cmd = this.flight > 0.5 ? clamp(this.powerCmd, 0, 1.1) * this.maxPowerFactor : 0.05;
      ngT = this.idleN2 + (1.03 - this.idleN2) * Math.pow(cmd, 0.8);
    }
    const tau = this.state === 'cranking' ? 5 / s : this.state === 'lightoff' ? 5 / s : this.running ? (ngT > this.n2 ? 1.1 : 0.9) : 3.0;
    this.n2 += (ngT - this.n2) * (1 - Math.exp(-dt / tau));
    if (this.failed === 'seize') this.n2 = damp(this.n2, 0, 2.5, dt);
    const combustion = this.running || this.state === 'lightoff';
    const ng = this.n2;
    let P = combustion ? this.P0 * Math.pow(clamp((ng - 0.55) / 0.48, 0, 1.08), 1.3) * Math.min(1, Math.pow(env.sigma, 0.75) * 1.12) : 0;
    this.power = Math.min(P, this.P0 * 1.08 * this.maxPowerFactor);
    this.torque = this.power / this.P0;
    this.thrust = 0;
    this.ff = combustion ? this.power * (0.3 / 3.6e6) + 0.01 : 0;
    let tT = combustion ? 450 + 380 * Math.pow(this.power / this.P0, 0.9) : env.oatC;
    if (this.state === 'lightoff') tT = 620 + 230 * Math.sin(Math.min(1, this.startT / 9) * Math.PI);
    if (this.fire && !this.extinguished) tT += 300;
    this.egt = damp(this.egt, tT, combustion ? 0.8 : 0.15, dt);
    this.commonTemps(dt, env, this.power / this.P0);
    this.n1 = ng;
    this.rpm = ng * 45000;
    this.visRpm = 0;
    this.vibration = (this.failed === 'partial' ? 0.5 : 0) + (this.fire ? 0.3 : 0);
  }
}

// ------------------------------------------------------------------ Piston engine driving a helicopter rotor
// Engine rpm is mechanically tied to the rotor through the belt drive once the clutch is engaged,
// so the helicopter model sets `rotorFrac`; the governor sets `powerCmd`.
export class PistonHeli extends EngineBase {
  // explicit type tag (class names are mangled by the minifier, so never test constructor.name)
  get kind() { return 'pistonHeli'; }
  constructor(spec, index) {
    super(spec, index);
    this.P0 = spec.powerKW * 1000;
    this.rpmMax = spec.rpmMax || 2700;
    this.powerCmd = 0; this.rotorFrac = 0; this.flight = 1; this.oilPmax = 75;
    this.crankRpm = 0;
  }
  setRunningInstant() { super.setRunningInstant(); this.oilT = 60; this.cht = 140; this.egt = 620; this.fuelCutoff = false; this.crankRpm = 0; this.rpm = this.visRpm = this.rpmMax; this.n1 = this.n2 = 1; }
  spinFrac() { return clamp(this.rpm / this.rpmMax, 0, 1.2); }
  update(dt, env) {
    const s = START_FAST.value;
    const fuelOK = env.fuel && !this.fuelCutoff;
    if (this.state === 'cranking') {
      this.startT += dt * s;
      this.crankRpm = damp(this.crankRpm, env.starterPower ? 260 : 0, 3, dt);
      if (this.crankRpm > 150 && fuelOK && env.ignition && this.startT > 1.2) { this.state = 'running'; this.running = true; this.starter = false; }
      if (this.startT > 30) { this.state = 'off'; this.starter = false; }
    } else if (this.running && (!fuelOK || !env.ignition)) { this.running = false; this.state = 'spooldown'; }
    const combustion = this.running;
    const cmd = combustion ? (this.flight > 0.5 ? clamp(this.powerCmd, 0.04, 1) : 0.06) : 0;
    const rpmF = clamp(this.rotorFrac, 0, 1.1);
    const P = combustion ? this.P0 * cmd * Math.min(1, env.sigma * 1.05) * (0.35 + 0.65 * rpmF) * this.maxPowerFactor : 0;
    this.power = damp(this.power, P, 6, dt);
    if (this.failed === 'partial' && combustion) this.power *= 0.9 + 0.1 * Math.sin(env.time * 11 + this.roughPhase);
    // engine rpm: clutch engaged -> rotor-coupled; otherwise idle/cranking rpm
    const coupled = this.rotorFrac * this.rpmMax;
    const idle = combustion ? 1100 + cmd * 600 : this.crankRpm;
    this.rpm = Math.max(coupled, combustion ? Math.min(idle, coupled + 900) : this.crankRpm * (this.state === 'cranking' ? 1 : 0));
    if (!combustion && this.state !== 'cranking') this.crankRpm = damp(this.crankRpm, 0, 2, dt);
    this.visRpm = this.rpm;
    this.n1 = this.n2 = clamp(this.rpm / this.rpmMax, 0, 1.2);
    this.map = combustion ? lerp(12, 28.5, cmd) * Math.min(1, env.sigma + 0.05) : 29.9 * env.sigma;
    this.torque = this.power / this.P0;
    this.thrust = 0;
    this.ff = combustion ? this.power * (0.3 / 3.6e6) + 0.0012 : 0;
    this.egt = damp(this.egt, combustion ? 560 + 200 * this.torque : env.oatC + 20, 0.5, dt);
    this.cht = damp(this.cht, combustion ? 130 + 80 * this.torque : env.oatC, 0.02, dt);
    this.commonTemps(dt, env, this.torque);
    this.vibration = (this.failed === 'partial' ? 0.6 : 0) + (this.oilLeak > 0.7 ? 0.5 : 0);
  }
}

export function createEngine(spec, index) {
  switch (spec.type) {
    case 'turbofan': return new Turbofan(spec, index);
    case 'turboprop': return new Turboprop(spec, index);
    case 'turboshaft': return new Turboshaft(spec, index);
    default: return spec.heli ? new PistonHeli(spec, index) : new Piston(spec, index);
  }
}
