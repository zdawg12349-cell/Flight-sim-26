// Random in-flight failures with configurable frequency, and their real effects on the simulation.
import { bus } from '../core/events.js';
import { settings } from '../core/settings.js';
import { FT } from '../core/math.js';

// Mean airborne time between random failures, in minutes (0 = never).
export const FREQ = { off: 0, rare: 120, normal: 35, frequent: 8, training: 2.5 };
export const FREQ_LABELS = { off: 'Off', rare: 'Rare (≈ every 2 h)', normal: 'Occasional (≈ every 35 min)', frequent: 'Frequent (≈ every 8 min)', training: 'Training (soon after takeoff)' };

const INFO = {
  flameout: { title: 'ENGINE FAILURE', text: 'Engine flame-out. Maintain control and best-glide / single-engine speed. Rudder against the yaw (twins). Try a restart (I) or plan a landing at the nearest airport.' },
  fire: { title: 'ENGINE FIRE', text: 'Engine fire! Throttle idle, pull the FIRE handle (click it in the cockpit or press F at the alert) to cut fuel and discharge the extinguisher. Land as soon as possible.' },
  oil: { title: 'OIL PRESSURE DROPPING', text: 'Oil leak: pressure falling and temperature rising. Reduce power and land soon — the engine will seize if it runs too long without oil.' },
  partial: { title: 'PARTIAL POWER LOSS', text: 'The engine is running rough with reduced power. Keep speed up, avoid steep climbs and divert to the nearest suitable airport.' },
  hydraulic: { title: 'HYDRAULIC FAILURE', text: 'Hydraulic pressure lost. Flaps slow / unavailable, gear extends by gravity only (slowly). Plan a long, flat approach with a higher speed.' },
  electrical: { title: 'ELECTRICAL FAILURE', text: 'Generators offline — running on battery. Shed loads; glass displays will fail as the battery drains. Land soon.' },
  gear: { title: 'GEAR MALFUNCTION', text: 'One landing-gear leg is jammed. Cycle the gear, or prepare for a landing on the remaining gear / belly. Emergency services will be ready.' },
  fuelLeak: { title: 'FUEL LEAK', text: 'Fuel is leaking rapidly. Check fuel remaining and land at the nearest airport.' },
  pitot: { title: 'AIRSPEED UNRELIABLE', text: 'Pitot tube blocked — airspeed indication is frozen. Fly pitch and power, use ground speed and the stall warning.' },
  tailrotor: { title: 'TAIL ROTOR FAILURE', text: 'Loss of tail-rotor thrust. Maintain forward speed (the fin keeps the nose straight), reduce power and make a running landing.' },
  governor: { title: 'GOVERNOR FAILURE', text: 'Rotor RPM governor failed: rotor speed fluctuates. Manage rotor RPM with collective and land.' },
  heliEngine: { title: 'ENGINE FAILURE', text: 'Engine failure! LOWER THE COLLECTIVE immediately to keep rotor RPM, enter autorotation (~65 kt), flare at about 50 ft and cushion the landing with collective.' },
  oei: { title: 'ONE ENGINE INOPERATIVE', text: 'One engine has failed. The remaining engine provides contingency power — avoid hover out of ground effect and land at a suitable site.' },
};

export class FailureManager {
  constructor() {
    this.active = null;
    this.history = [];
    this.airborneTime = 0;
    this.armed = true;
    this.forced = null;
  }
  reset() { this.active = null; this.history = []; this.airborneTime = 0; this.forced = null; }

  update(dt, ac) {
    const fm = ac.fm, t = fm.telemetry;
    if (!fm.onGround && t.agl > 15) this.airborneTime += dt; else if (fm.onGround) this.airborneTime = Math.min(this.airborneTime, 30);
    if (this.forced && this.airborneTime > this.forced.after && t.agl > (this.forced.minAgl ?? 0)) { this.trigger(ac, this.forced.type, this.forced.engine); this.forced = null; return; }
    if (this.active || fm.damage.crashed) return;
    const freq = settings.p.emergencyFrequency;
    const mean = FREQ[freq] || 0;
    if (!mean) return;
    if (fm.onGround || t.agl < 400 * FT || this.airborneTime < (freq === 'training' ? 60 : 45)) return;
    const p = dt / (mean * 60);
    if (Math.random() < p) this.trigger(ac, this.pick(ac));
  }

  // Schedule a specific failure (missions / challenges).
  schedule(type, after = 0, engine = null, minAgl = 0) { this.forced = { type, after, engine, minAgl }; }

  pick(ac) {
    const s = ac.spec, n = ac.fm.engines.length;
    let table;
    if (s.cat === 'heli') table = n > 1 ? [['oei', 35], ['fire', 12], ['oil', 15], ['governor', 12], ['hydraulic', 12], ['tailrotor', s.heli.tandem ? 0 : 8], ['electrical', 6]] : [['heliEngine', 35], ['oil', 18], ['partial', 15], ['governor', 12], ['tailrotor', 10], ['fire', 10]];
    else if (n > 1) table = [['flameout', 30], ['fire', 18], ['oil', 15], ['partial', 10], ['hydraulic', s.systems.hydraulics ? 8 : 0], ['electrical', 6], ['gear', s.retract ? 6 : 0], ['fuelLeak', 4], ['pitot', 3]];
    else table = [['partial', 28], ['flameout', 22], ['oil', 20], ['fire', 10], ['electrical', 8], ['pitot', 7], ['fuelLeak', 5]];
    const total = table.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of table) { if ((r -= w) <= 0) return k; }
    return table[0][0];
  }

  trigger(ac, type, engineIdx = null) {
    const fm = ac.fm, sys = ac.systems;
    const n = fm.engines.length;
    const ei = engineIdx ?? Math.floor(Math.random() * n);
    const e = fm.engines[ei];
    switch (type) {
      case 'flameout': e.fail('flameout'); break;
      case 'heliEngine': for (const en of fm.engines) en.fail('flameout'); break;
      case 'oei': e.fail('flameout'); for (const en of fm.engines) if (en !== e) en.maxPowerFactor = 1.12; break;
      case 'fire': e.fail('fire'); break;
      case 'oil': e.fail('oil'); break;
      case 'partial': e.fail('partial'); break;
      case 'hydraulic': sys.hydFail = true; break;
      case 'electrical': sys.elecFail = true; break;
      case 'gear': fm.gearJamIndex = Math.min(fm.contacts.filter((c) => c.kind === 'wheel').length - 1, 1 + Math.floor(Math.random() * 2)); break;
      case 'fuelLeak': sys.fuelLeak = Math.max(0.05, ac.spec.mass.fuelMax * 0.0025); break;
      case 'pitot': fm.pitotFail = true; fm.pitotFrozen = fm.telemetry.ias; fm.pitotFailCause = 'failure'; break;
      case 'tailrotor': fm.tailRotorFail = true; break;
      case 'governor': fm.govFail = true; break;
    }
    const info = INFO[type] || { title: 'SYSTEM FAILURE', text: '' };
    this.active = { type, engine: ei, time: performance.now(), title: info.title + (['flameout', 'fire', 'oil', 'partial', 'oei'].includes(type) && n > 1 ? ` (ENG ${ei + 1})` : ''), text: info.text, landed: false };
    this.history.push({ type, title: this.active.title, alt: Math.round(fm.pos.y / FT), t: fm.time });
    bus.emit('emergency', this.active);
  }

  // Engine relight attempt (I key while airborne with a flamed-out engine).
  tryRelight(ac) {
    const fm = ac.fm;
    let tried = false;
    for (const e of fm.engines) {
      if (e.failed === 'flameout' && !e.running) {
        tried = true;
        if (Math.random() < 0.45 && fm.fuel > 1) { e.failed = null; e.requestStart(); bus.emit('toast', 'Relight in progress…'); }
        else bus.emit('toast', 'Relight unsuccessful — try again or plan a forced landing');
      }
    }
    return tried;
  }
}
