// Aircraft flight dynamics: 6-DOF rigid body, fixed-wing aerodynamics, helicopter rotor model,
// ground contact, weight & balance and damage. Runs at a fixed time step (see core/loop.js).
//
// Body axes (three.js convention): +X right, +Y up, -Z forward.
// Conventional rates: p (roll, right wing down +) = -w.z, q (pitch up +) = w.x, r (yaw right +) = -w.y.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, DEG, KT, FT, G, table } from '../core/math.js';
import { atmosphere } from './atmosphere.js';
import { createEngine } from './engines.js';
import { surfaces, frictionFor } from './surfaces.js';

const V3 = () => new THREE.Vector3();
const _v1 = V3(), _v2 = V3(), _v3 = V3(), _v4 = V3(), _v5 = V3(), _v6 = V3();
const _q1 = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _n = V3();
const _s1 = V3(), _s2 = V3(), _s3 = V3();
const UP = new THREE.Vector3(0, 1, 0);

export class FlightModel {
  constructor(spec, desc, world, weather) {
    this.spec = spec;
    this.desc = desc;
    this.world = world;
    this.weather = weather;
    this.isHeli = spec.cat === 'heli';
    this.pos = V3(); this.vel = V3(); this.q = new THREE.Quaternion(); this.w = V3();
    this.prevPos = V3(); this.prevQ = new THREE.Quaternion();
    this.force = V3(); this.torque = V3();
    this.accelBody = V3();
    this.ctl = {
      pitch: 0, roll: 0, yaw: 0, trim: 0, throttle: [], collective: 0, brakeL: 0, brakeR: 0, parking: true, flapIndex: 0, gearDown: 1,
      spoilers: 0, reverse: 0, mixture: 1, propLever: 1, condition: 1, hoist: 0, rampOpen: 0, droop: 0,
    };
    this.engines = (spec.engines ? Array.from({ length: spec.engines.count }, (_, i) => createEngine(spec.engines, i)) : []);
    for (const e of this.engines) this.ctl.throttle.push(0);
    this.flapDeg = 0; this.gearPos = 1; this.spoilerPos = 0; this.reverserPos = 0;
    this.elevator = 0; this.aileron = 0; this.rudder = 0; this.steer = 0;
    this.damage = { gear: [0, 0, 0, 0, 0, 0], wingL: 0, wingR: 0, tail: 0, fuselage: 0, engines: this.engines.map(() => 0), total: 0, crashed: false, events: [] };
    this.payloadFrac = 0.7; this.fuelFrac = 0.6;
    this.fuel = (spec.mass.fuelMax || 0) * this.fuelFrac;
    this.icing = 0;
    this.time = 0;
    this.atm = {};
    this.telemetry = {};
    this.onGround = true; this.wasOnGround = true; this.airTime = 0; this.groundTime = 0;
    this.touchdown = null;         // last touchdown event
    this.maxG = 1; this.minG = 1;
    this.stallWarn = 0; this.stalled = false;
    this.overspeed = 0;
    this.gLoad = 1;
    this.surfaceType = 'grass';
    this.hydraulic = 1; this.electric = 1;
    this.tailRotorFail = false;
    this.vrs = 0;
    this.cg = computeCG(spec, desc);
    this.initMass();
    this.initAero();
    this.initContacts();
    if (this.isHeli) this.initHeli();
  }

  // ------------------------------------------------------------ mass & inertia
  initMass() {
    const s = this.spec;
    this.paxCount = Math.round(s.pax * this.payloadFrac);
    this.cargo = s.cargoKg * this.payloadFrac;
    this.payload = this.paxCount * 86 + this.cargo + s.crew * 85;
    this.updateMass();
  }
  setLoad(payloadFrac, fuelFrac) {
    this.payloadFrac = clamp(payloadFrac, 0, 1);
    this.fuelFrac = clamp(fuelFrac, 0.02, 1);
    this.fuel = this.spec.mass.fuelMax * this.fuelFrac;
    this.initMass();
  }
  updateMass() {
    const s = this.spec;
    this.mass = Math.min(s.mass.empty + this.payload + this.fuel, s.mass.mtow * 1.08);
    const k = this.mass / s.mass.mtow;
    const I = s.inertia;
    if (I.Ixx) {
      this.I = new THREE.Vector3(I.Iyy * k, I.Izz * k, I.Ixx * k);
    } else {
      const b = s.dims.span, L = s.dims.length, m = this.mass;
      const Ixx = m * (I.kx * b / 2) ** 2, Iyy = m * (I.ky * L / 2) ** 2, Izz = m * (I.kz * (b + L) / 4) ** 2;
      this.I = new THREE.Vector3(Iyy, Izz, Ixx);     // about body x (pitch), y (yaw), z (roll)
    }
    // CG shift: payload aft, fuel slightly forward (fraction of mean chord, + = aft)
    this.cgShift = (this.payloadFrac - 0.55) * 0.08 + (0.5 - this.fuel / Math.max(1, s.mass.fuelMax)) * 0.025;
  }

  // ------------------------------------------------------------ aerodynamics setup
  initAero() {
    this.wingY = 0;
    if (this.isHeli) return;
    const a = this.spec.aero;
    this.AR = a.b * a.b / a.S;
    this.CLa = a.delta ? 2.5 : (2 * Math.PI * this.AR / (2 + Math.sqrt(this.AR * this.AR + 4))) * 0.97;
    const cruise = this.spec.perf.cruiseKt * KT * (this.spec.perf.cruiseKt > 500 ? 0.45 : this.spec.perf.cruiseKt > 300 ? 0.55 : 1);
    const rho = this.spec.perf.cruiseKt > 300 ? 0.45 : this.spec.perf.cruiseKt > 160 ? 0.9 : 1.1;
    const W = (this.spec.mass.empty + this.spec.mass.mtow) / 2 * G;
    const CLc = W / (0.5 * rho * cruise * cruise * a.S);
    this.alphaCruise = (CLc - a.CL0) / this.CLa;
    this.Cm0 = -a.Cma * this.alphaCruise;
    this.Clb = a.Clb ?? (this.desc.wings && this.desc.wings[0].root[1] > 0 ? -0.1 : -0.065);
    this.Clp = a.Clp ?? -0.45;
    this.Cnr = a.Cnr ?? -0.16;
    this.CYb = a.CYb ?? -0.6;
    this.Cnda = a.Cnda ?? -0.012;
    this.alphaStall = a.aStall * DEG;
    this.alphaNegStall = -(a.symmetric ? a.aStall : a.aStall * 0.75) * DEG;
    this.mcrit = this.spec.perf.mmo ? Math.min(0.92, this.spec.perf.mmo - 0.04) : 0.7;
    this.propAircraft = this.spec.engines.type === 'piston' || this.spec.engines.type === 'turboprop';
    this.wingY = this.desc.wings ? this.desc.wings[0].root[1] : 0;
  }

  // Dynamic-pressure increase over the tail from propeller slipstream. Momentum theory gives a
  // total-pressure rise of T/A in the fully developed wake; only part of the tail is immersed
  // (nose-mounted single engine: most of it; wing-mounted twins: very little).
  slipstreamQ() {
    if (!this.propAircraft) return 0;
    let q = 0;
    for (const e of this.engines) if (e.A > 0) q += Math.max(0, e.thrust) / e.A;
    return q * (this.engines.length === 1 ? 0.4 : 0.08);
  }

  flapInfo() {
    const f = this.spec.aero.flaps;
    const d = this.flapDeg;
    if (f.length < 2 || d <= 0) return { dCL: 0, dCD: 0, dA: 0, dCm: 0 };
    for (let i = 1; i < f.length; i++) {
      if (d <= f[i].deg || i === f.length - 1) {
        const a = f[i - 1], b = f[i];
        const t = clamp((d - a.deg) / Math.max(0.01, b.deg - a.deg), 0, 1);
        return { dCL: lerp(a.dCL, b.dCL, t), dCD: lerp(a.dCD, b.dCD, t), dA: lerp(a.dA, b.dA, t), dCm: lerp(a.dCm, b.dCm, t) };
      }
    }
    return { dCL: 0, dCD: 0, dA: 0, dCm: 0 };
  }

  liftCoef(alpha, dCL, dA) {
    const a = this.spec.aero;
    const as = this.alphaStall + dA * DEG - this.icing * 4 * DEG;
    const CLmax = a.CLmax + dCL * 0.92 - this.icing * 0.35;
    if (a.delta) {
      // vortex lift: non-linear growth, gentle "stall" around 22-25 deg
      const al = Math.abs(alpha);
      let cl = 2.5 * al + 2.4 * al * al;
      if (al > as) cl = (2.5 * as + 2.4 * as * as) * (1 - 0.6 * smoothstep(as, as + 0.25, al));
      return Math.sign(alpha) * cl;
    }
    const lin = a.CL0 + this.CLa * alpha + dCL;
    if (alpha >= 0) {
      const knee = as - 4 * DEG;
      if (alpha <= knee) return Math.min(lin, CLmax);
      if (alpha <= as) {
        const clK = a.CL0 + this.CLa * knee + dCL;
        const t = (alpha - knee) / (as - knee);
        return clK + (CLmax - clK) * (2 * t - t * t);
      }
      // post stall: lift collapses then follows flat plate
      const post = CLmax * (1 - 0.38 * smoothstep(as, as + 6 * DEG, alpha));
      const fp = 1.0 * Math.sin(2 * alpha);
      return lerp(post, fp, smoothstep(as + 6 * DEG, as + 25 * DEG, alpha));
    }
    const asn = this.alphaNegStall;
    if (alpha >= asn) return lin;
    const clN = a.CL0 + this.CLa * asn + dCL;
    const post = clN * (1 - 0.4 * smoothstep(-asn, -asn + 6 * DEG, -alpha));
    return lerp(post, Math.sin(2 * alpha), smoothstep(-asn + 6 * DEG, -asn + 25 * DEG, -alpha));
  }

  // ------------------------------------------------------------ contacts
  initContacts() {
    const d = this.desc;
    const gY = d.groundY;
    this.contacts = [];
    const mg = this.spec.mass.mtow * G;
    const heavy = this.spec.mass.mtow > 30000;
    const travel = heavy ? 0.35 : this.isHeli ? 0.12 : 0.18;
    if (d.skids) {
      const s = d.skids;
      for (const sx of [-1, 1]) for (const z of [s.z0 + 0.25, s.z1 - 0.15]) {
        this.contacts.push({ name: 'skid', p: new THREE.Vector3(sx * s.x, s.y - s.r, z), kind: 'skid', k: mg * 0.25 / 0.06, share: 0.25, travel: 0.15, gear: -1 });
      }
    }
    (d.gear || []).forEach((g, i) => {
      const isNose = /nose|tail|front/.test(g.name) && !/rear/.test(g.name);
      const nMain = (d.gear || []).filter((q) => !/nose|tail|front/.test(q.name)).length || 1;
      let share = isNose ? 0.1 : 0.9 / nMain;
      if (this.isHeli) share = 1 / d.gear.length;
      if (g.name.startsWith('body')) share = 0.9 / nMain;
      const stat = heavy ? 0.2 : this.isHeli ? 0.06 : 0.08;
      this.contacts.push({
        // contact at the bottom of this wheel (a tailwheel sits much higher than the mains)
        name: g.name, p: new THREE.Vector3(g.pos[0] + (g.offsetX || 0), Number.isFinite(g.len) && Number.isFinite(g.r) ? g.pos[1] - g.len - g.r : gY, g.pos[2]), kind: 'wheel', gear: i,
        k: mg * share / stat, share, travel, steer: !!g.steer, brake: !isNose || this.isHeli, nose: isNose, radius: g.r, compression: 0, wow: false,
      });
    });
    // scrape points: belly, tail, nose, wingtips, engine pods
    const b = this.desc._bounds;
    const sh = this.desc._shape;
    const add = (name, x, y, z, kind = 'scrape') => this.contacts.push({ name, p: new THREE.Vector3(x, y, z), kind, k: mg * 0.5 / 0.05, travel: 0.4, gear: -1 });
    if (sh) {
      const zs = [sh.zNose + sh.length * 0.12, sh.zNose + sh.length * 0.45, sh.zNose + sh.length * 0.82, sh.zTail - 0.3];
      add('nose', 0, sh.bottomY(zs[0]), zs[0]);
      add('belly', 0, sh.bottomY(zs[1]), zs[1]);
      add('aftbelly', 0, sh.bottomY(zs[2]), zs[2]);
      add('tail', 0, sh.bottomY(zs[3]) + 0.05, zs[3]);
    }
    if (b) {
      add('wingL', b.min.x * 0.98, this.wingY + (this.spec.cat === 'heli' ? 0.5 : 0), 0);
      add('wingR', b.max.x * 0.98, this.wingY + (this.spec.cat === 'heli' ? 0.5 : 0), 0);
    }
    if (this.spec.engines && this.spec.engines.pos && this.spec.engines.type === 'turbofan' && (this.desc.engines || []).length) {
      for (const e of this.desc.engines) if (e.pos[1] < -1) add('engine', e.pos[0], e.pos[1] - e.r * 0.9, e.pos[2] + e.len * 0.3);
    }
    if (this.isHeli && this.desc.rotors) {
      for (const r of this.desc.rotors) add('rotorTip', 0, r.pos[1], r.pos[2] - r.radius * 0.95, 'rotor');
    }
    for (const c of this.contacts) c.p.sub(this.cg);
    this.groundOffset = this.desc.groundY - this.cg.y;     // wheel bottom relative to CG
    // spring rates from the real static load split (lever arms about the CG), so every gear leg
    // compresses by its design static stroke and the aircraft sits at the correct attitude
    if (!this.isHeli) {
      const wh = this.contacts.filter((c) => c.kind === 'wheel');
      const front = wh.filter((c) => c.nose);
      const mains = wh.filter((c) => !c.nose);
      if (front.length && mains.length) {
        const zf = front.reduce((t, c) => t + c.p.z, 0) / front.length;
        const zm = mains.reduce((t, c) => t + c.p.z, 0) / mains.length;
        const ff = clamp(zm / (zm - zf), 0.03, 0.45);
        const stat = heavy ? 0.2 : 0.08;
        for (const c of front) { c.share = ff / front.length; c.k = mg * c.share / stat; }
        for (const c of mains) { c.share = (1 - ff) / mains.length; c.k = mg * c.share / stat; }
      }
    }
    // static ground attitude: taildraggers rest nose-high on mains + tailwheel (three-point attitude)
    this.groundPitch = 0;
    const wheels = this.contacts.filter((c) => c.kind === 'wheel');
    const tail = wheels.find((c) => c.name === 'tail');
    if (tail) {
      const main = wheels.filter((c) => c !== tail).reduce((m, c) => (c.p.y < m.p.y ? c : m));
      this.groundPitch = Math.atan2(tail.p.y - main.p.y, tail.p.z - main.p.z);
      const th = this.groundPitch;
      this.groundOffset = main.p.y * Math.cos(th) - main.p.z * Math.sin(th);
    }
  }

  // ------------------------------------------------------------ helicopter setup
  initHeli() {
    const h = this.spec.heli;
    this.omegaN = h.rpm * 2 * Math.PI / 60;
    this.omega = 0;               // rotor rad/s
    this.lambda = 0.04;
    this.sigma = h.blades * h.chord / (Math.PI * h.R);
    this.A = Math.PI * h.R * h.R;
    this.a1 = 0; this.b1 = 0;     // disk tilt (rad)
    this.rotorThrust = 0; this.rotorPower = 0; this.rotorTorque = 0; this.tailThrust = 0;
    this.collectivePos = 0;
    // reference hover torque for tail rotor sizing
    const W = this.spec.mass.mtow * G;
    const vh = Math.sqrt(W / (2 * 1.225 * this.A));
    this.Phover = W * vh * 1.15 + (this.sigma * 0.011 / 8) * 1.225 * this.A * Math.pow(this.omegaN * h.R, 3);
    this.Qhover = this.Phover / this.omegaN;
    this.vh = vh;
    this.govI = 0;
    this.rotorBrake = 1;
    if (h.tandem) { this.tandem = h.tandem; this.A *= 1; }
  }

  // ------------------------------------------------------------ placement
  placeOnGround(x, z, hdgDeg, groundHeight = null) {
    const h = groundHeight ?? this.world.surfaceAt(x, z);
    this.q.setFromEuler(new THREE.Euler(this.groundPitch || 0, -hdgDeg * DEG, 0, 'YXZ'));
    this.pos.set(x, h - this.groundOffset + 0.02, z);
    this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.prevPos.copy(this.pos); this.prevQ.copy(this.q);
    this.onGround = true; this.wasOnGround = true; this.airTime = 0; this.groundTime = 10;
    if (this.isHeli) { this.omega = 0; }
    this.primeTelemetry();
  }
  primeTelemetry() {
    const atm = atmosphere(this.pos.y, this.weather.tempOffset, this.weather.qnh, this.atm);
    const vb = _v2.copy(this.vel).applyQuaternion(_qi.copy(this.q).invert());
    this.updateTelemetry(atm, vb, vb.length(), vb.length() / atm.a, _v6.set(0, 0, 0));
  }
  placeInAir(x, y, z, hdgDeg, speed, pitchDeg = 0) {
    this.q.setFromEuler(new THREE.Euler(pitchDeg * DEG, -hdgDeg * DEG, 0, 'YXZ'));
    this.pos.set(x, y, z);
    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.q);
    this.vel.copy(fwd).multiplyScalar(speed);
    this.w.set(0, 0, 0);
    this.prevPos.copy(this.pos); this.prevQ.copy(this.q);
    this.onGround = false; this.wasOnGround = false; this.airTime = 30; this.groundTime = 0;
    if (this.isHeli) this.omega = this.omegaN;
    this.primeTelemetry();
  }

  // ------------------------------------------------------------ main step
  step(dt, sys) {
    this.time += dt;
    // sanitise control inputs (never let a NaN reach the integrator)
    const c = this.ctl;
    for (const k of ['pitch', 'roll', 'yaw', 'trim', 'collective', 'brakeL', 'brakeR', 'spoilers']) if (!Number.isFinite(c[k])) c[k] = 0;
    for (let i = 0; i < c.throttle.length; i++) if (!Number.isFinite(c.throttle[i])) c.throttle[i] = 0;
    this.prevPos.copy(this.pos); this.prevQ.copy(this.q);
    const W = this.weather;
    const atm = atmosphere(this.pos.y, W.tempOffset, W.qnh, this.atm);
    // relative air velocity
    const wind = W.windAt(this.pos, this.time, _v6, this.aglEstimate ?? 100);
    const vAir = _v1.copy(this.vel).sub(wind);
    _qi.copy(this.q).invert();
    const vb = _v2.copy(vAir).applyQuaternion(_qi);
    const V = vb.length();
    const tas = V;
    const mach = V / atm.a;
    this.force.set(0, -this.mass * G, 0);          // world frame (gravity)
    this.torque.set(0, 0, 0);                      // body frame

    // actuators
    this.updateActuators(dt, sys);

    // engines
    const envE = this.engineEnv || (this.engineEnv = {});
    envE.rho = atm.rho; envE.sigma = atm.sigma; envE.tas = Math.max(0, -vb.z); envE.mach = mach; envE.oatC = atm.oatC; envE.time = this.time;
    envE.fuel = this.fuel > 0.5;
    envE.ignition = sys ? sys.ignitionOn : true;
    envE.starterPower = sys ? sys.starterPower : true;
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      e.throttle = this.ctl.throttle[i] ?? 0;
      e.reverse = this.reverserPos;
      if (e.propLever !== undefined) e.propLever = this.ctl.propLever;
      if (e.condition !== undefined) e.condition = this.ctl.condition;
      if (e.mixture !== undefined) e.mixture = this.ctl.mixture;
      e.update(dt, envE);
      this.fuel = Math.max(0, this.fuel - e.ff * dt);
    }

    if (this.isHeli) this.heliForces(dt, atm, vb, V, sys);
    else this.fixedWingForces(dt, atm, vb, V, mach);

    // engine thrust (fixed wing)
    if (!this.isHeli && this.spec.engines.pos) {
      for (let i = 0; i < this.engines.length; i++) {
        const e = this.engines[i];
        const p = this.spec.engines.pos[i];
        if (!p) continue;
        const T = e.thrust;
        _v3.set(0, 0, -T);                                    // body force
        this.addBodyForce(_v3, _v4.set(p[0] - this.cg.x, (p[1] - this.cg.y) * 0.3, p[2] - this.cg.z));
        // propeller torque / P-factor (single props yaw left at high power & low speed)
        if (this.propAircraft && this.engines.length === 1 && e.power > 0) {
          const k = e.power / (this.spec.engines.powerKW * 1000);
          const lowSpeed = clamp(1 - envE.tas / 45, 0, 1);
          this.torque.y += k * lowSpeed * this.mass * 0.18;    // yaw left (rotation about +y)
          this.torque.z += k * this.mass * 0.06;                // roll left from engine torque
        }
      }
    }

    // ground contacts
    this.groundContacts(dt, sys);

    // integrate translational
    const acc = _v3.copy(this.force).divideScalar(this.mass);
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    // body accelerations for g-load (specific force)
    const sf = _v4.copy(this.force).addScaledVector(UP, this.mass * G).divideScalar(this.mass * G).applyQuaternion(_qi);
    this.accelBody.copy(sf);
    this.gLoad = damp(this.gLoad, sf.y, 12, dt);
    if (!this.onGround || this.airTime > 0.3) { this.maxG = Math.max(this.maxG, this.gLoad); this.minG = Math.min(this.minG, this.gLoad); }

    // integrate rotational: I dw/dt = M - w x (I w)
    const I = this.I, w = this.w;
    const Iw = _v5.set(I.x * w.x, I.y * w.y, I.z * w.z);
    const gyro = _v4.copy(w).cross(Iw);
    w.x += (this.torque.x - gyro.x) / I.x * dt;
    w.y += (this.torque.y - gyro.y) / I.y * dt;
    w.z += (this.torque.z - gyro.z) / I.z * dt;
    // limit absurd rates
    w.clampLength(0, 8);
    _q1.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
    _q1.multiplyQuaternions(this.q, _q1);
    this.q.x += _q1.x; this.q.y += _q1.y; this.q.z += _q1.z; this.q.w += _q1.w;
    this.q.normalize();

    // world bounds safety
    if (!Number.isFinite(this.pos.x) || !Number.isFinite(this.vel.x)) {
      console.warn('physics reset (NaN)');
      this.pos.copy(this.prevPos); this.vel.set(0, 0, 0); this.w.set(0, 0, 0); this.q.copy(this.prevQ);
    }
    this.updateTelemetry(atm, vb, V, mach, wind);
    this.updateMass();
  }

  addBodyForce(fb, pb) {
    // body-frame force fb applied at body point pb
    const fw = _v5.copy(fb).applyQuaternion(this.q);
    this.force.add(fw);
    const t = _n.copy(pb).cross(fb);
    this.torque.add(t);
  }

  updateActuators(dt, sys) {
    const s = this.spec;
    const c = this.ctl;
    const hyd = this.hydraulic;
    // flaps
    if (!this.isHeli && s.aero.flaps.length > 1) {
      const target = s.aero.flaps[clamp(c.flapIndex, 0, s.aero.flaps.length - 1)].deg;
      const rate = (s.mass.mtow > 20000 ? 2.2 : 4.0) * (s.systems.hydraulics ? (hyd > 0.5 ? 1 : 0.15) : (this.electric > 0.3 ? 1 : 0));
      const before = this.flapDeg;
      this.flapDeg = target > this.flapDeg ? Math.min(target, this.flapDeg + rate * dt) : Math.max(target, this.flapDeg - rate * dt);
      this.flapsMoving = Math.abs(this.flapDeg - before) > 1e-4;
    }
    // gear
    if (s.retract) {
      const t = s.gearTime || 7;
      const target = c.gearDown ? 1 : 0;
      let rate = 1 / t;
      if (s.systems.hydraulics && hyd < 0.5) rate = c.gearDown ? 1 / (t * 2.5) : 0;   // free-fall extension only
      if (this.onGround && !c.gearDown) rate = 0;                                      // squat switch
      const before = this.gearPos;
      this.gearPos = target > this.gearPos ? Math.min(1, this.gearPos + rate * dt) : Math.max(0, this.gearPos - rate * dt);
      this.gearMoving = Math.abs(this.gearPos - before) > 1e-5;
    } else this.gearPos = 1;
    this.spoilerPos = damp(this.spoilerPos, c.spoilers, 3, dt);
    this.reverserPos = damp(this.reverserPos, c.reverse && this.onGround ? 1 : 0, 2.2, dt);
    // control surfaces (actuator lag, rates)
    const rate = this.isHeli ? 8 : (s.mass.mtow > 50000 ? 5 : 9);
    this.elevator = damp(this.elevator, clamp(c.pitch + c.trim, -1, 1), rate, dt);
    this.aileron = damp(this.aileron, c.roll, rate, dt);
    this.rudder = damp(this.rudder, c.yaw, rate * 0.8, dt);
  }

  // ------------------------------------------------------------ fixed wing aero
  fixedWingForces(dt, atm, vb, V, mach) {
    const a = this.spec.aero;
    const qs = this.slipstreamQ();
    if (V < 2) {
      // essentially stationary: only the propeller slipstream acts on elevator and rudder
      this.alpha = 0; this.beta = 0; this.cl = 0; this.qbar = 0.5 * atm.rho * V * V;
      if (qs > 1) {
        this.torque.x += qs * a.S * a.c * a.Cmde * 0.4 * -this.elevator * (1 - this.damage.tail * 0.5);
        this.torque.y += -qs * a.S * a.b * a.Cndr * 0.44 * -this.rudder * (1 - this.damage.tail * 0.4);
      }
      return;
    }
    const u = -vb.z, vSide = vb.x, wDown = -vb.y;
    const alpha = Math.atan2(wDown, Math.max(Math.abs(u), 0.1) * Math.sign(u || 1));
    const beta = Math.asin(clamp(vSide / V, -1, 1));
    this.alpha = alpha; this.beta = beta;
    const qbar = 0.5 * atm.rho * V * V;
    this.qbar = qbar;
    const S = a.S, b = a.b, c = a.c;
    const Vn = Math.max(V, 12);
    const p = -this.w.z, q = this.w.x, r = -this.w.y;
    const ph = p * b / (2 * Vn), qh = q * c / (2 * Vn), rh = r * b / (2 * Vn);
    const fl = this.flapInfo();
    // ground effect (wing height above surface)
    const hWing = Math.max(0.1, (this.aglEstimate ?? 50) + (this.wingY - this.desc.groundY) * 0.7);
    const ge = (16 * hWing / b) ** 2;
    const geF = ge / (1 + ge);
    // lift
    let CL = this.liftCoef(alpha, fl.dCL, fl.dA);
    CL *= 1 + (1 - geF) * 0.12;
    CL -= this.spoilerPos * (this.onGround ? 0.6 : 0.35) * Math.max(0, CL) / Math.max(0.5, a.CLmax);
    const dmg = this.damage;
    CL *= 1 - 0.25 * (dmg.wingL + dmg.wingR) / 2;
    // drag
    const CDi = Math.pow(CL - a.CL0 * 0.25, 2) / (Math.PI * this.AR * a.e) * geF;
    let CD = a.CD0 + fl.dCD + (a.gearCD || 0) * this.gearPos + CDi + this.spoilerPos * 0.06 + this.icing * 0.015 + dmg.total * 0.02;
    const as = this.alphaStall + fl.dA * DEG;
    CD += 1.25 * Math.pow(Math.sin(Math.max(0, Math.abs(alpha) - as * 0.85)), 2) * 1.4;
    if (mach > this.mcrit) CD += 20 * Math.pow(mach - this.mcrit, 4) * (a.delta ? 0.15 : 1) + (a.delta && mach > 0.95 ? 0.012 * Math.exp(-((mach - 1.1) ** 2) * 6) : 0);
    // side force
    let CY = this.CYb * beta - 0.15 * this.rudder;
    // stall & buffet
    const stallMargin = as - alpha;
    this.stallWarn = alpha > 0 ? smoothstep(4 * DEG, 0.5 * DEG, stallMargin) : 0;
    this.stalled = alpha > as + 1 * DEG;
    // control effectiveness (prop slipstream boosts tail at low speed)
    const ctlK = (qbar + qs) / Math.max(qbar, 1);
    const stallK = this.stalled ? 0.65 : 1;
    // pitch moment
    const de = -this.elevator;    // + = trailing edge down
    let Cm = this.Cm0 + a.Cma * alpha + a.Cmq * qh + a.Cmde * 0.4 * de * ctlK * stallK + fl.dCm + CL * this.cgShift;
    Cm += (1 - geF) * -0.04;                     // ground effect nose-down
    if (alpha > as) Cm -= 0.6 * (alpha - as);    // stall break (nose drop)
    if (a.delta) Cm += -0.03 * (this.ctl.droop || 0);
    Cm -= 0.04 * this.spoilerPos;
    Cm *= 1 - this.damage.tail * 0.5;
    // roll moment
    let Cl = this.Clb * beta * (1 + CL * 0.3) + this.Clp * ph + (0.08 + 0.25 * CL) * rh + a.Clda * 0.35 * this.aileron * stallK * Math.min(ctlK, 1.6) * (1 - this.damage.wingL * 0.4) * (1 - this.damage.wingR * 0.4);
    Cl += 0.025 * this.rudder;
    Cl += (dmg.wingR - dmg.wingL) * 0.05 * Math.min(1, CL);       // asymmetric lift from wing damage
    if (this.stalled) Cl += Math.sin(this.time * 2.3 + 1.3) * 0.02 * smoothstep(as, as + 4 * DEG, alpha) + (this.stallDrop || 0);
    // yaw moment
    let Cn = a.Cnb * beta + this.Cnr * rh - 0.04 * CL * ph + a.Cndr * 0.44 * -this.rudder * ctlK + this.Cnda * 0.35 * this.aileron;
    Cn *= 1 - this.damage.tail * 0.4;
    // turbulence rotational disturbance
    const tr = this.weather.turbRates;
    if (tr) { Cl += tr.x * 0.02 / Math.max(1, b / 12); Cm += tr.y * 0.015; Cn += tr.z * 0.006; }
    this.cl = CL; this.cd = CD;
    // forces in body axes: drag opposite airflow, lift perpendicular to airflow and body X
    const vh = _v3.copy(vb).divideScalar(V);
    const lift = _v4.set(1, 0, 0).cross(vh).normalize();         // x̂ × v̂
    const F = _v5.copy(vh).multiplyScalar(-qbar * S * CD).addScaledVector(lift, qbar * S * CL);
    F.x += qbar * S * CY;
    const fw = _v3.copy(F).applyQuaternion(this.q);
    this.force.add(fw);
    // moments: torque.x = M (pitch), torque.y = -N (yaw), torque.z = -L (roll)
    this.torque.x += qbar * S * c * Cm;
    this.torque.y += -qbar * S * b * Cn;
    this.torque.z += -qbar * S * b * Cl;
    // extra yaw/roll damping at very low speed so the aircraft doesn't spin freely on the ground
    this.torque.y -= this.w.y * this.I.y * 0.05;
  }

  // ------------------------------------------------------------ helicopter
  heliForces(dt, atm, vb, V, sys) {
    const h = this.spec.heli;
    const c = this.ctl;
    const rho = atm.rho;
    const eng = this.engines;
    // rotor brake holds the rotor stopped until an engine is running
    const anyRunning = eng.some((e) => e.running);
    // ---- engine power to rotor (freewheel unit)
    let Pavail = 0;
    for (const e of eng) {
      if (e.constructor.name === 'PistonHeli') e.rotorFrac = this.omega / this.omegaN;
      Pavail += e.power;
    }
    const omega = Math.max(this.omega, 0.01);
    // ---- collective and rotor aerodynamics (blade element + momentum)
    this.collectivePos = damp(this.collectivePos, c.collective, 10, dt);
    const theta = h.thetaMin + (h.thetaMax - h.thetaMin) * this.collectivePos;
    const R = h.R, OR = omega * R;
    const rotors = h.tandem ? 2 : 1;
    const cg = this.cg;
    const hubs = h.tandem ? [[0, h.tandem.yF - cg.y, h.tandem.zF - cg.z], [0, h.tandem.yR - cg.y, h.tandem.zR - cg.z]] : [[0, (this.desc.rotors ? this.desc.rotors[0].pos[1] : h.hubH) - cg.y, (this.desc.rotors ? this.desc.rotors[0].pos[2] : 0) - cg.z]];
    const A = this.A;
    let totalP = 0;
    let totalT = 0;
    const agl = this.aglEstimate ?? 100;
    // disk tilt targets from cyclic (+ flapback with forward speed)
    const mu0 = Math.hypot(vb.x, vb.z) / Math.max(OR, 1);
    // a1 < 0: disk tilted back (pull); flapback tilts the disk back with forward speed (speed stability)
    const a1T = -c.pitch * h.cyclic - 0.12 * mu0 * (-vb.z > 0 ? 1 : -1);
    const b1T = c.roll * h.cyclic;
    const lag = 1 - Math.exp(-dt * Math.max(2, omega / 4));
    this.a1 += (a1T - this.a1) * lag;
    this.b1 += (b1T - this.b1) * lag;
    for (let k = 0; k < rotors; k++) {
      let th = theta;
      let a1 = this.a1, b1 = this.b1;
      if (h.tandem) {
        // differential collective for pitch, differential lateral tilt for yaw
        th += (k === 0 ? -1 : 1) * c.pitch * 0.045;
        a1 = this.a1 * 0.35;
        b1 = this.b1 + (k === 0 ? 1 : -1) * c.yaw * h.cyclic * 0.8;
      }
      // shaft (thrust) direction in body axes: up tilted by a1 (about x) and b1 (about z)
      const tdir = _v3.set(Math.sin(b1), Math.cos(a1) * Math.cos(b1), -Math.sin(a1)).normalize();
      // air velocity at the hub (body)
      const hp = _v4.set(hubs[k][0], hubs[k][1], hubs[k][2]);
      const vHub = _v5.copy(this.w).cross(hp).add(vb);
      const vAx = vHub.dot(tdir);                     // + = moving up through disk
      const vIn = Math.sqrt(Math.max(0, vHub.lengthSq() - vAx * vAx));
      const mu = vIn / Math.max(OR, 1);
      const lc = vAx / Math.max(OR, 1);               // climb inflow ratio
      // iterate inflow
      // Solve g(lam) = (lam - lc) - Ct(lam) / (2 sqrt(mu^2 + lam^2 + eps)) = 0 with a guarded Newton
      // iteration (plain fixed-point iteration oscillates near zero thrust, where momentum theory is
      // singular, and produced spurious thrust spikes at flat pitch).
      const k0 = this.sigma * 5.7 / 2, thK = th / 3 * (1 + 1.5 * mu * mu);
      let lam = Number.isFinite(this.lambda) ? this.lambda : 0.05;
      let Ct = 0;
      for (let it = 0; it < 8; it++) {
        Ct = k0 * (thK - lam / 2);
        const S = Math.sqrt(mu * mu + lam * lam + 1e-4);
        const g = (lam - lc) - Ct / (2 * S);
        const dg = Math.max(0.3, 1 + (k0 / 2 * S + Ct * lam / S) / (2 * S * S));
        lam -= clamp(g / dg, -0.04, 0.04);
      }
      Ct = k0 * (thK - lam / 2);
      this.lambda = lam;
      Ct = Math.max(-0.002, Ct);
      // ground effect
      const z = Math.max(0.2, agl + (hubs[k][1] - this.groundOffset));
      let ige = 1;
      if (z < R * 2) ige = 1 / clamp(1 - Math.pow(R / (4 * z), 2), 0.72, 1);
      ige = lerp(ige, 1, clamp(mu / 0.12, 0, 1));
      // vortex ring state: descending through own wake at low airspeed
      const vd = -vAx;
      const vrs = smoothstep(0.35 * this.vh, 0.7 * this.vh, vd) * (1 - smoothstep(1.2 * this.vh, 1.7 * this.vh, vd)) * (1 - smoothstep(0.04, 0.1, mu));
      this.vrs = damp(this.vrs, vrs, 2, dt);
      const vrsK = 1 - 0.32 * this.vrs * (0.8 + 0.2 * Math.sin(this.time * 9));
      let T = Ct * rho * A * OR * OR * ige * vrsK;
      // damaged / failing rotor
      T *= 1 - this.damage.fuselage * 0.2;
      totalT += T;
      // power: induced (with climb), profile
      const Pi = 1.15 * T * (lam - lc) * OR + T * lc * OR;
      const P0 = (this.sigma * 0.011 / 8) * rho * A * OR * OR * OR * (1 + 4.65 * mu * mu);
      totalP += Pi + P0;
      // apply thrust at hub
      _v6.copy(tdir).multiplyScalar(T);
      this.addBodyForce(_v6, hp);
      // hub moment from flap stiffness (rigid rotors) - proportional to tilt and thrust
      const K = h.flapK * this.mass * G * (omega / this.omegaN) ** 2 * 0.6;
      this.torque.x += -K * a1 * (h.tandem ? 0.2 : 1);
      this.torque.z += -K * b1 * (h.tandem ? 0.6 : 1);
    }
    this.rotorThrust = totalT;
    // fuselage parasite drag
    const f = h.f;
    const Vb = _v3.copy(vb);
    const sp = Vb.length();
    if (sp > 0.1) {
      const D = 0.5 * rho * sp * sp * f;
      _v4.copy(Vb).multiplyScalar(-D / sp);
      // downwash on the fuselage in hover
      _v4.y -= totalT * 0.03 * (1 - clamp(sp / 20, 0, 1));
      this.addBodyForce(_v4, _v5.set(0, 0, 0.3));
    }
    // vertical fin / horizontal stab (weathervane & pitch stability in forward flight)
    const u = -vb.z;
    const qf = 0.5 * rho * Math.max(0, u) * Math.abs(u);
    const beta = sp > 1 ? Math.asin(clamp(vb.x / sp, -1, 1)) : 0;
    const alphaF = sp > 1 ? Math.atan2(-vb.y, Math.max(1, Math.abs(u))) : 0;
    const tailArm = h.tail ? h.tail.arm : 6;
    this.torque.y += qf * h.fin * 2.2 * beta * tailArm;              // yaw into wind
    this.torque.x += -qf * h.fin * 2.0 * alphaF * tailArm * 0.7;      // pitch stability
    // ---- torque balance & tail rotor
    const Qrotor = totalP / omega;
    let Qtail = 0;
    if (!h.tandem) {
      const dir = 1;   // counter-clockwise main rotor (seen from above) -> fuselage yaws right
      const Tmax = 2.25 * this.Qhover / h.tail.arm;
      const nrK = (omega / this.omegaN) ** 2;
      let pedal = c.yaw;
      let Ttr = Tmax * nrK * (0.44 - 0.56 * pedal);
      if (this.tailRotorFail) Ttr = 0;
      this.tailThrust = Ttr;
      // reaction torque (nose right = rotation about -y) and tail rotor counter moment
      this.torque.y += -dir * Qrotor * 0.98 + Ttr * h.tail.arm;
      // tail rotor side force at the tail (pushes tail right -> translating tendency)
      this.force.add(_v4.set(Ttr * 0.0, 0, 0));
      const Ptr = Math.pow(Math.abs(Ttr), 1.5) / Math.sqrt(2 * rho * Math.PI * h.tail.R * h.tail.R) * 1.2 + 0.03 * this.Phover * nrK;
      Qtail = Ptr / omega;
    } else {
      this.torque.y += -c.yaw * 0.0;   // yaw handled by differential tilt above
    }
    // rotational damping (rotor + fuselage), scaled with rotor speed and density
    const nr = omega / this.omegaN;
    const damp1 = this.mass * (h.tandem ? 30 : 14) * nr * atm.sigma;
    this.torque.x -= this.w.x * damp1 * (h.tandem ? 3 : 1.4) * (this.I.x / (this.mass * 4));
    this.torque.z -= this.w.z * damp1 * (this.I.z / (this.mass * 2));
    this.torque.y -= this.w.y * this.mass * 2.5 * (0.4 + nr) * (this.I.y / (this.mass * 4));
    // ---- governor & rotor speed dynamics
    const Pneed = (Qrotor + Qtail) * omega;
    this.rotorPower = Pneed;
    this.rotorTorque = Qrotor;
    let govCmd = 0;
    const totalPmax = eng.reduce((s2, e) => s2 + (e.P0 || 0), 0) || 1;
    if (h.governor) {
      const err = 1 - this.omega / this.omegaN;
      this.govI = clamp(this.govI + err * dt * 2.5, -0.3, 0.6);
      govCmd = clamp(Pneed / totalPmax * 1.02 + err * 6 + this.govI, 0, 1.1);
    }
    for (const e of eng) {
      if (e.powerCmd !== undefined) e.powerCmd = (this.govFail ? 0.4 + 0.3 * Math.sin(this.time * 0.8) : govCmd) * (e.running ? 1 : 0);
    }
    // freewheel: engines can only drive, never brake the rotor
    const Peng = anyRunning ? Pavail * 0.97 : 0;
    const Qeng = Peng / omega;
    const fr = 0.015 * this.Qhover * nr + (this.rotorBrake > 0.5 && !anyRunning && this.onGround && this.nr < 0.35 ? this.Qhover * 0.6 : 0);
    let dOm = (Qeng - Qrotor - Qtail - fr * Math.sign(this.omega)) / h.J;
    if (!Number.isFinite(dOm)) dOm = 0;
    this.omega = Math.max(0, this.omega + dOm * dt);
    if (this.omega < 0.5 && !anyRunning && Qrotor >= 0) this.omega = damp(this.omega, 0, 2, dt);
    this.omega = Math.min(this.omega, this.omegaN * 1.25);
    this.nr = this.omega / this.omegaN;
  }

  // ------------------------------------------------------------ ground interaction
  groundContacts(dt, sys) {
    const W = this.weather;
    let any = false, wheelsOn = false;
    let maxImpact = 0;
    this.surfaceType = surfaces.typeAt(this.pos.x, this.pos.z);
    const fr = frictionFor(this.surfaceType, W.wetness, W.snowCover);
    const speed = this.vel.length();
    const steerMax = (this.spec.steerDeg || 0) * DEG * clamp(1.2 - speed / 18, 0.12, 1);
    this.steer = damp(this.steer, this.ctl.yaw * steerMax, 6, dt);
    const brakeAmt = this.ctl.parking ? 1 : 0;
    // static (stick-slip) friction only while essentially stopped
    const lowSpeed = speed < 1.0 && this.w.length() < 0.6;
    let lowest = 1e9;
    for (const ct of this.contacts) {
      ct.wow = false;
      if (ct.kind === 'wheel' && this.spec.retract && this.gearPos < 0.98) { ct.compression = 0; continue; }
      if (ct.kind === 'wheel' && (this.damage.gear[ct.gear] >= 1 || ct.gear === this.gearJamIndex)) { ct.compression = 0; continue; }
      const P = _v1.copy(ct.p).applyQuaternion(this.q).add(this.pos);
      const H = this.world.surfaceAt(P.x, P.z);
      const water = H < 0 && P.y < 0.5;
      const gh = water ? 0 : H;
      const dpen = gh - P.y;
      lowest = Math.min(lowest, P.y - gh);
      if (!(dpen > 0)) { ct.compression = Math.max(0, ct.compression - dt * 2); continue; }
      any = true;
      const r = _v2.copy(P).sub(this.pos);
      const vC = _v3.copy(this.w).applyQuaternion(this.q).cross(r).add(this.vel);
      const n = H > 2 && !water ? this.world.normalAt(P.x, P.z, _n) : _n.set(0, 1, 0);
      const vn = vC.dot(n);
      const travel = ct.travel || 0.2;
      const dEff = Math.min(dpen, travel);
      let Fn = ct.k * dEff;
      if (dpen > travel) Fn += ct.k * 12 * (dpen - travel);           // bottomed out
      const cDamp = 2 * 0.55 * Math.sqrt(ct.k * this.mass * (ct.share || 0.3));
      Fn -= cDamp * vn;
      Fn = Math.max(0, Fn);
      if (vn < -0.2) maxImpact = Math.max(maxImpact, -vn);
      ct.compression = dEff;
      ct.wow = true;
      if (ct.kind === 'wheel') wheelsOn = true;
      // friction
      const F = _v4.copy(n).multiplyScalar(Fn);
      if (water) {
        F.addScaledVector(vC, -Math.min(Fn * 0.8, this.mass * 2) / Math.max(1, vC.length()));
      } else if (ct.kind === 'wheel') {
        // a steerable wheel behind the CG (tailwheel) must turn the opposite way to a nosewheel
        const st = ct.steer ? this.steer * (ct.p.z > 0 ? -1 : 1) : 0;
        const fwd = _v5.set(Math.sin(st), 0, -Math.cos(st)).applyQuaternion(this.q);
        fwd.addScaledVector(n, -fwd.dot(n)).normalize();
        const side = _v6.copy(n).cross(fwd);
        const vl = vC.dot(fwd), vs = vC.dot(side);
        let brake = brakeAmt;
        if (!ct.nose && ct.brake) {
          const left = ct.p.x < 0;
          brake = Math.max(brake, left ? this.ctl.brakeL : this.ctl.brakeR);
        }
        if (!ct.brake) brake = 0;
        const muB = fr.mu * (this.spec.brake ? this.spec.brake / 0.45 : 1) * 0.85;
        if (lowSpeed) {
          // parked / creeping: tyres stick laterally (and longitudinally when braked)
          const braked = brake > 0.5;
          this.stick(ct, P, vC, n, Fn, braked ? null : fwd, (braked ? Math.max(fr.mu * 0.9, muB) : fr.mu * 0.9), F);
          if (!braked) F.addScaledVector(fwd, -(fr.roll + brake * muB) * Fn * Math.tanh(vl / 0.35));
        } else {
          ct.anc = null;
          const Flong = -(fr.roll + brake * muB) * Fn * Math.tanh(vl / 0.35);
          const Flat = -fr.mu * 0.9 * Fn * Math.tanh(vs / 0.22);
          F.addScaledVector(fwd, Flong).addScaledVector(side, Flat);
        }
        ct.rollSpeed = vl;
      } else {
        const mu = (ct.kind === 'skid' ? 0.42 : 0.5) * Math.min(1, fr.mu / 0.8 + 0.25);
        const vt = _v5.copy(vC).addScaledVector(n, -vn);
        const vtl = vt.length();
        if (ct.kind === 'skid' && lowSpeed) this.stick(ct, P, vC, n, Fn, null, mu, F);
        else {
          ct.anc = null;
          if (vtl > 1e-4) F.addScaledVector(vt, -mu * Fn * Math.tanh(vtl / 0.2) / vtl);
        }
        if (ct.kind === 'scrape' || ct.kind === 'rotor') this.scrape(ct, vtl, dpen, dt);
      }
      this.force.add(F);
      const tw = _v5.copy(r).cross(F).applyQuaternion(_qi.copy(this.q).invert());
      this.torque.add(tw);
    }
    this.lowestPoint = lowest;
    // touchdown / liftoff detection
    this.wasOnGround = this.onGround;
    this.onGround = any;
    if (any) { this.groundTime += dt; } else { this.airTime += dt; this.groundTime = 0; }
    if (any && !this.wasOnGround && this.airTime > 2) {
      this.touchdown = { time: this.time, vs: -this.lastVs || maxImpact, impact: maxImpact, speed: this.telemetry.ias || 0, pos: this.pos.clone(), heading: this.telemetry.heading, bank: this.telemetry.bank, pitch: this.telemetry.pitch, wheels: wheelsOn, gLoad: this.gLoad, surface: this.surfaceType };
      this.airTime = 0;
      this.evaluateImpact(maxImpact, wheelsOn);
    } else if (any && maxImpact > 4.5) {
      this.evaluateImpact(maxImpact, wheelsOn);
    }
    if (!any) this.lastVs = this.vel.y;
  }

  // Stick-slip friction: the contact is tied to an anchor on the ground by a stiff spring-damper;
  // when the required force exceeds mu*Fn the anchor slides. freeDir (optional) is a direction in
  // which the contact may roll freely (an unbraked wheel).
  stick(ct, P, vC, n, Fn, freeDir, mu, F) {
    if (!ct.anc) ct.anc = new THREE.Vector3().copy(P);
    const d = _s1.copy(P).sub(ct.anc);
    d.addScaledVector(n, -d.dot(n));
    const vt = _s2.copy(vC).addScaledVector(n, -vC.dot(n));
    if (freeDir) {
      const dl = d.dot(freeDir);
      ct.anc.addScaledVector(freeDir, dl);
      d.addScaledVector(freeDir, -dl);
      vt.addScaledVector(freeDir, -vt.dot(freeDir));
    }
    const mC = this.mass * clamp(ct.share || 0.25, 0.1, 0.5);
    const ks = mC * 250, cs = 2 * 0.5 * Math.sqrt(ks * mC);
    const Fs = _s3.copy(d).multiplyScalar(-ks).addScaledVector(vt, -cs);
    const lim = mu * Fn, L = Fs.length();
    if (L > lim && L > 1e-9) {
      Fs.multiplyScalar(lim / L);
      ct.anc.copy(P).addScaledVector(_s1.copy(Fs).addScaledVector(vt, cs).multiplyScalar(1 / ks), 1);
    }
    F.add(Fs);
  }

  evaluateImpact(vImpact, wheels) {
    const d = this.damage;
    const heli = this.isHeli;
    const hard = heli ? 2.5 : 3.0, collapse = heli ? 4.0 : 4.6, crash = heli ? 6.5 : 7.5;
    if (vImpact > hard) {
      d.events.push({ t: this.time, type: 'hardLanding', v: vImpact });
      for (const ct of this.contacts) if (ct.kind === 'wheel' && ct.wow) d.gear[ct.gear] = Math.min(1, d.gear[ct.gear] + (vImpact - hard) / (collapse - hard) * 0.6);
      d.fuselage = Math.min(1, d.fuselage + (vImpact - hard) * 0.08);
    }
    if (vImpact > collapse) {
      for (const ct of this.contacts) if (ct.kind === 'wheel' && ct.wow && Math.random() < 0.7) d.gear[ct.gear] = 1;
      d.events.push({ t: this.time, type: 'gearCollapse', v: vImpact });
    }
    if (vImpact > crash) { this.crash('impact'); }
    this.recomputeDamage();
  }

  scrape(ct, vt, pen, dt) {
    const d = this.damage;
    const rate = (vt * 0.02 + pen * 0.6) * dt * (ct.kind === 'rotor' ? 6 : 1);
    if (rate <= 0) return;
    if (ct.name === 'wingL') d.wingL = Math.min(1, d.wingL + rate * 4);
    else if (ct.name === 'wingR') d.wingR = Math.min(1, d.wingR + rate * 4);
    else if (ct.name === 'tail') d.tail = Math.min(1, d.tail + rate * 3);
    else if (ct.name === 'engine') { const i = 0; d.engines[i] = Math.min(1, d.engines[i] + rate * 3); }
    else if (ct.kind === 'rotor') { d.fuselage = Math.min(1, d.fuselage + rate * 3); if (vt > 0.5 || this.nr > 0.3) this.crash('rotorStrike'); }
    else d.fuselage = Math.min(1, d.fuselage + rate);
    if (!ct.lastEv || this.time - ct.lastEv > 1.5) { d.events.push({ t: this.time, type: 'scrape', part: ct.name }); ct.lastEv = this.time; }
    if (vt > 70 && pen > 0.3 && !d.crashed) this.crash('belly');
    this.recomputeDamage();
  }

  crash(reason) {
    if (this.damage.crashed) return;
    this.damage.crashed = true;
    this.damage.crashReason = reason;
    this.damage.events.push({ t: this.time, type: 'crash', reason });
    for (const e of this.engines) { e.running = false; e.state = 'spooldown'; e.damage = 1; }
    this.recomputeDamage();
  }

  recomputeDamage() {
    const d = this.damage;
    const gear = d.gear.reduce((s, g) => s + g, 0) / Math.max(1, (this.desc.gear || []).length || 1);
    d.total = clamp(0.25 * gear + 0.2 * (d.wingL + d.wingR) + 0.15 * d.tail + 0.3 * d.fuselage + (d.crashed ? 0.5 : 0), 0, 1);
  }

  // ------------------------------------------------------------ telemetry
  updateTelemetry(atm, vb, V, mach, wind) {
    const t = this.telemetry;
    const e = new THREE.Euler().setFromQuaternion(this.q, 'YXZ');
    t.pitch = e.x / DEG;
    t.bank = -e.z / DEG;
    let hdg = -e.y / DEG;
    t.heading = ((hdg % 360) + 360) % 360;
    t.tas = V;
    t.ias = V * Math.sqrt(atm.rho / 1.225) * (this.pitotFail ? 0 : 1);
    if (this.pitotFail) t.ias = this.pitotFrozen ?? 0;
    t.gs = Math.hypot(this.vel.x, this.vel.z);
    t.vs = this.vel.y;
    t.mach = mach;
    t.alt = this.pos.y;
    const sh = this.world.surfaceAt(this.pos.x, this.pos.z);
    t.agl = this.pos.y + this.groundOffset - Math.max(sh, 0);
    this.aglEstimate = t.agl;
    t.alpha = (this.alpha || 0) / DEG;
    t.beta = (this.beta || 0) / DEG;
    t.g = this.gLoad;
    t.track = ((Math.atan2(this.vel.x, -this.vel.z) / DEG) + 360) % 360;
    t.windX = wind.x; t.windZ = wind.z; t.windY = wind.y;
    t.oat = atm.oatC;
    t.rho = atm.rho;
    t.turnRate = (-this.w.y) / DEG;   // approx deg/s
    t.slip = clamp(this.accelBody.x * 6, -1, 1);
    // stall/overspeed
    const vne = (this.spec.perf.vneKt || 300) * KT;
    this.overspeed = this.isHeli ? (t.ias > vne ? 1 : 0) : ((t.ias > vne || (this.spec.perf.mmo && mach > this.spec.perf.mmo)) ? 1 : 0);
  }

  // Interpolated pose for rendering
  getRenderPose(alpha, outPos, outQ) {
    outPos.lerpVectors(this.prevPos, this.pos, alpha);
    outQ.slerpQuaternions(this.prevQ, this.q, alpha);
  }
}

// Centre of gravity in body coordinates (model origin is not the CG).
export function computeCG(spec, desc) {
  const cg = new THREE.Vector3(0, 0, 0);
  if (spec.cat === 'heli') {
    const h = spec.heli;
    if (h.tandem) cg.z = (h.tandem.zF + h.tandem.zR) / 2 - 0.2;
    else cg.z = (desc.rotors ? desc.rotors[0].pos[2] : 0) - 0.05;
    cg.y = 0.1;
    return cg;
  }
  const wings = desc.wings || [];
  if (!wings.length) return cg;
  let zs = 0;
  for (const w of wings) {
    const P = w.panels;
    const span = P.reduce((s, p) => s + p.span, 0);
    const cr = P[0].c0, ct = P[P.length - 1].c1;
    const lam = ct / cr;
    const sweep = P.reduce((s, p) => s + Math.tan((p.sweep || 0) * DEG) * p.span, 0) / span;
    const yMac = span / 3 * (1 + 2 * lam) / (1 + lam);
    const cMac = (2 / 3) * cr * (1 + lam + lam * lam) / (1 + lam);
    const frac = spec.aero && spec.aero.delta ? 0.42 : 0.25;
    zs += w.root[2] + yMac * sweep + frac * cMac;
  }
  cg.z = zs / wings.length;
  return cg;
}
