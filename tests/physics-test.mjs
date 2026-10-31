// Headless physics checks: takeoff roll, rotation, climb, cruise trim, helicopter hover.
import * as THREE from 'three';
import { AIRCRAFT_BY_ID } from '../src/aircraft/catalog.js';
import { FlightModel } from '../src/sim/flight.js';
import { FuselageShape } from '../src/aircraft/modeler.js';
import { Systems } from '../src/sim/systems.js';
import { KT, FT, FPM, DEG } from '../src/core/math.js';

const world = { surfaceAt: () => 0, heightAt: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), isWater: () => false };
const weather = { tempOffset: 0, qnh: 1013.25, wetness: 0, snowCover: 0, precip: 0, inCloud: 0, windAt: (p, t, o) => o.set(0, 0, 0), turbRates: null };

function make(id) {
  const spec = AIRCRAFT_BY_ID[id];
  const desc = spec.model();
  desc._shape = new FuselageShape(desc.fuselage.stations);
  const hs = spec.dims.span / 2;
  desc._bounds = new THREE.Box3(new THREE.Vector3(-hs, desc.groundY, -spec.dims.length / 2), new THREE.Vector3(hs, 3, spec.dims.length / 2));
  const fm = new FlightModel(spec, desc, world, weather);
  const sys = new Systems(spec, fm);
  return { spec, fm, sys };
}

function fixedWing(id, opts = {}) {
  const { spec, fm, sys } = make(id);
  fm.setLoad(0.6, 0.5);
  fm.placeOnGround(0, 0, 90);
  sys.setRunning(false);
  fm.ctl.parking = false;
  const toFlap = spec.aero.flaps.length > 2 ? 2 : spec.aero.flaps.length > 1 ? 1 : 0;
  fm.ctl.flapIndex = toFlap;
  const dt = 1 / 120;
  let t = 0, rotated = false, liftoff = null, gearUp = false;
  const log = [];
  let settle = 0;
  for (let i = 0; i < 120 * 3; i++) { fm.step(dt, sys); }   // settle on gear
  const settledY = fm.pos.y;
  for (let i = 0; i < 120 * 150; i++) {
    t += dt;
    const tl = fm.telemetry;
    fm.ctl.throttle = fm.ctl.throttle.map(() => 1);
    const vr = (spec.perf.vr || 60) * KT;
    if (!rotated && tl.ias >= vr) rotated = true;
    // simple pilot: target pitch
    let targetPitch = rotated ? (spec.aero.delta ? 12 : opts.climbPitch ?? 9) : 0;
    if (liftoff && t - liftoff > 25) targetPitch = opts.cruisePitch ?? 4;
    const pe = targetPitch - tl.pitch;
    fm.ctl.pitch = Math.max(-1, Math.min(1, pe * 0.08 - fm.w.x / DEG * 0.06));
    fm.ctl.roll = Math.max(-1, Math.min(1, -tl.bank * 0.05 + fm.w.z / DEG * 0.02));
    fm.ctl.yaw = Math.max(-1, Math.min(1, (tl.heading - 90) * -0.05));
    fm.step(dt, sys);
    if (!liftoff && !fm.onGround && tl.agl > 2) liftoff = t;
    if (liftoff && !gearUp && t - liftoff > 4) { fm.ctl.gearDown = 0; gearUp = true; fm.ctl.flapIndex = 0; }
    if (Math.abs(t - Math.round(t)) < dt / 2 && Math.round(t) % 10 === 0) log.push(`t=${t.toFixed(0)} ias=${(tl.ias / KT).toFixed(0)}kt alt=${(tl.agl / FT).toFixed(0)}ft vs=${(tl.vs / FPM).toFixed(0)}fpm pitch=${tl.pitch.toFixed(1)} aoa=${tl.alpha.toFixed(1)} bank=${tl.bank.toFixed(1)} hdg=${tl.heading.toFixed(0)} n1=${fm.engines[0].n1.toFixed(2)} thr=${(fm.engines.reduce((s, e) => s + e.thrust, 0) / 1000).toFixed(1)}kN`);
    if (fm.damage.crashed) { log.push('CRASHED ' + fm.damage.crashReason); break; }
  }
  const tl = fm.telemetry;
  console.log(`=== ${id}: settled compression ${(settledY - (0 - fm.desc.groundY)).toFixed(3)} m; liftoff at t=${liftoff?.toFixed(1)}s`);
  console.log(log.join('\n'));
}

function heli(id) {
  const { spec, fm, sys } = make(id);
  fm.setLoad(0.5, 0.5);
  fm.placeOnGround(0, 0, 0);
  sys.setRunning(false);
  const dt = 1 / 120;
  fm.ctl.collective = 0;
  for (let i = 0; i < 120 * 4; i++) fm.step(dt, sys);
  // find hover collective: ramp until lift-off, then hold altitude with simple controller
  let col = 0.2, t = 0, iErr = 0;
  const log = [];
  for (let i = 0; i < 120 * 60; i++) {
    t += dt;
    const tl = fm.telemetry;
    const targetAlt = t < 40 ? 10 : 30;
    const vsCmd = Math.max(-3, Math.min(3, (targetAlt - tl.agl) * 0.5));
    iErr += (vsCmd - tl.vs) * dt * 0.02;
    fm.ctl.collective = Math.max(0, Math.min(1, 0.45 + iErr + (vsCmd - tl.vs) * 0.05));
    fm.ctl.pitch = Math.max(-1, Math.min(1, (0 - tl.pitch) * 0.05 - fm.w.x / DEG * 0.05));
    fm.ctl.roll = Math.max(-1, Math.min(1, (0 - tl.bank) * 0.05 + fm.w.z / DEG * 0.05));
    const need = fm.rotorTorque / Math.max(1, fm.Qhover);
    fm.ctl.yaw = spec.heli.tandem ? 0 : Math.max(-1, Math.min(1, (0.44 - 0.99 * need) / 0.56 - (((tl.heading + 180) % 360) - 180) * 0.02 + fm.w.y / DEG * -0.05 * -1));
    fm.step(dt, sys);
    if (Math.abs(t - Math.round(t)) < dt / 2 && Math.round(t) % 5 === 0) log.push(`t=${t.toFixed(0)} agl=${tl.agl.toFixed(1)}m vs=${tl.vs.toFixed(2)} col=${fm.ctl.collective.toFixed(2)} nr=${fm.nr.toFixed(3)} P=${(fm.rotorPower / 1000).toFixed(0)}kW Pav=${(fm.engines.reduce((s, e) => s + e.power, 0) / 1000).toFixed(0)}kW pitch=${tl.pitch.toFixed(1)} bank=${tl.bank.toFixed(1)} hdg=${tl.heading.toFixed(0)} gs=${tl.gs.toFixed(1)}`);
    if (fm.damage.crashed) { log.push('CRASHED ' + fm.damage.crashReason); break; }
  }
  console.log(`=== ${id}`);
  console.log(log.join('\n'));
}

const which = process.argv[2] || 'skylark';
if (which === 'cg') {} else if (['h22', 'h139', 'u205', 'r145', 'hl47'].includes(which)) heli(which); else fixedWing(which);
if (which === 'cg') {
  for (const id of Object.keys(AIRCRAFT_BY_ID)) {
    const { spec, fm } = make(id);
    const g = (fm.desc.gear || []).map((q) => `${q.name}:${(q.pos[2] - fm.cg.z).toFixed(2)}`).join(' ');
    console.log(id.padEnd(9), 'cgZ', fm.cg.z.toFixed(2), g, fm.desc.skids ? 'skids' : '');
  }
}
