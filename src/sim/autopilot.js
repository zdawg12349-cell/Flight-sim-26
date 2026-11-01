// Autopilot / flight director and pilot assists (simplified-mode helpers).
import { clamp, damp, angDiffDeg, DEG, KT, FT, FPM } from '../core/math.js';
import { bus } from '../core/events.js';

export class Autopilot {
  constructor(spec, fm) {
    this.spec = spec; this.fm = fm;
    this.available = spec.systems.autopilot !== 'none';
    this.full = spec.systems.autopilot === 'full';
    this.engaged = false;
    this.lat = 'ROLL'; this.vert = 'PITCH'; this.at = false;
    this.hdg = 0; this.alt = 3000; this.vs = 0; this.spd = 250; this.pitchHold = 0; this.bankHold = 0;
    this.nav = null;          // { x, z, name } waypoint (NAV mode)
    this.app = null;          // { thrX, thrZ, hdg, elev, name } approach (LOC/GS)
    this.iE = 0; this.iVs = 0; this.iSpd = 0; this.iCol = 0; this.iPos = [0, 0];
    this.hover = false;
    this.locCaptured = false; this.gsCaptured = false;
  }

  engage(on = !this.engaged) {
    if (!this.available) { bus.emit('toast', 'No autopilot in this aircraft'); return; }
    const t = this.fm.telemetry;
    if (on && !this.engaged) {
      this.engaged = true;
      this.hdg = Math.round(t.heading); this.bankHold = 0;
      this.alt = Math.round(t.alt / FT / 100) * 100;
      this.vs = Math.round(t.vs / FPM / 100) * 100;
      this.pitchHold = t.pitch;
      this.lat = this.full ? 'HDG' : 'ROLL';
      this.vert = Math.abs(this.vs) < 200 ? 'ALT' : 'VS';
      this.iE = 0; this.iVs = 0; this.iCol = this.fm.ctl.collective || 0;
      this.spd = Math.round(t.ias / KT);
      bus.emit('ap', { engaged: true });
    } else if (!on && this.engaged) {
      this.engaged = false; this.at = false; this.hover = false;
      bus.emit('ap', { engaged: false });
      bus.emit('sound', 'ap_disc');
    }
  }
  setMode(kind, mode) {
    if (!this.engaged) this.engage(true);
    if (kind === 'lat') { this.lat = this.lat === mode ? (this.full ? 'HDG' : 'ROLL') : mode; this.locCaptured = false; }
    if (kind === 'vert') { this.vert = this.vert === mode ? 'PITCH' : mode; if (mode === 'VS') this.vs = Math.round(this.fm.telemetry.vs / FPM / 100) * 100; this.gsCaptured = false; }
    if (kind === 'at') { this.at = !this.at; this.spd = Math.round(this.fm.telemetry.ias / KT); }
    if (kind === 'hover') { this.hover = !this.hover; this.iPos = [0, 0]; }
    bus.emit('ap', { engaged: this.engaged });
  }

  // ------------------------------------------------------------ fixed wing
  update(dt, ctl) {
    if (!this.engaged) return;
    const fm = this.fm;
    if (fm.isHeli) return this.updateHeli(dt, ctl);
    const t = fm.telemetry;
    const s = this.spec;
    const ctrlK = 1 / (s.aero.ctrl || 1);
    // ---- lateral
    let bankCmd = 0;
    let hdgTarget = this.hdg;
    if (this.lat === 'NAV' && this.nav) {
      hdgTarget = (Math.atan2(this.nav.x - fm.pos.x, -(this.nav.z - fm.pos.z)) / DEG + 360) % 360;
    } else if (this.lat === 'LOC' && this.app) {
      const a = this.app;
      const r = a.hdg * DEG, dx = Math.sin(r), dz = -Math.cos(r);
      const ox = fm.pos.x - a.thrX, oz = fm.pos.z - a.thrZ;
      const cross = -ox * dz + oz * dx;         // + = right of centreline
      const along = ox * dx + oz * dz;          // negative before threshold
      const corr = clamp(-cross * 0.035, -30, 30);
      if (Math.abs(cross) < 1200) this.locCaptured = true;
      hdgTarget = (a.hdg + (this.locCaptured ? corr : clamp(corr, -45, 45)) + 360) % 360;
      // wind correction from track error
      hdgTarget += clamp(angDiffDeg(t.track, t.heading), -15, 15) * 0.5;
      this.locDev = cross; this.locAlong = along;
    }
    if (this.lat === 'ROLL') bankCmd = this.bankHold;
    else {
      const err = angDiffDeg(t.heading, hdgTarget);
      bankCmd = clamp(err * 1.5, -25, 25);
    }
    const p = -fm.w.z / DEG;
    ctl.roll = clamp((bankCmd - t.bank) * 0.045 * ctrlK - p * 0.02 * ctrlK, -0.6, 0.6);
    // yaw damper + coordination
    ctl.yaw = clamp(-fm.w.y * 0 + (fm.telemetry.beta || 0) * -0.04 + fm.w.y * 1.5, -0.4, 0.4);
    // ---- vertical
    let vsCmd = 0;
    const altFt = t.alt / FT;
    if (this.vert === 'ALT') vsCmd = clamp((this.alt - altFt) * 4, -1500, 1500);
    else if (this.vert === 'VS') {
      vsCmd = this.vs;
      if ((this.vs > 0 && altFt > this.alt - Math.abs(this.vs) * 0.2) || (this.vs < 0 && altFt < this.alt + Math.abs(this.vs) * 0.2)) this.vert = 'ALT';
    } else if (this.vert === 'GS' && this.app) {
      const a = this.app;
      const r = a.hdg * DEG;
      const along = (fm.pos.x - a.thrX) * Math.sin(r) + (fm.pos.z - a.thrZ) * -Math.cos(r);
      const dist = Math.max(0, -along + 300);
      const gsAlt = a.elev + dist * Math.tan(3 * DEG);
      const dev = (fm.pos.y + fm.desc.groundY) - gsAlt;
      if (Math.abs(dev) < 60) this.gsCaptured = true;
      const gsRate = -t.gs * Math.tan(3 * DEG) / FPM;
      vsCmd = this.gsCaptured ? clamp(gsRate - dev / FT * 6, -2000, 400) : Math.min(0, clamp(-dev / FT * 4, -1500, 0));
      this.gsDev = dev;
      if (t.agl < 15) { this.engage(false); bus.emit('toast', 'Autopilot disconnected at minimums'); return; }
    } else if (this.vert === 'PITCH') {
      vsCmd = null;
    }
    let pitchCmd;
    if (vsCmd === null) pitchCmd = this.pitchHold;
    else {
      const vsErr = vsCmd - t.vs / FPM;
      this.iVs = clamp(this.iVs + vsErr * dt * 0.0006, -6, 8);
      pitchCmd = clamp(t.pitch * 0 + (t.alpha || 0) * 0.0 + Math.atan2(vsCmd * FPM, Math.max(30, t.tas)) / DEG + 1.5 + this.iVs + vsErr * 0.0015, -12, 18);
      if (s.aero.delta) pitchCmd += 4;
    }
    const q = fm.w.x / DEG;
    const pErr = pitchCmd - t.pitch;
    this.iE = clamp(this.iE + pErr * dt * 0.02 * ctrlK, -0.6, 0.6);
    ctl.pitch = clamp(pErr * 0.06 * ctrlK - q * 0.08 * ctrlK + this.iE, -0.8, 0.8);
    // ---- autothrottle
    if (this.at && s.systems.autothrottle) {
      const e = this.spd - t.ias / KT;
      this.iSpd = clamp(this.iSpd + e * dt * 0.004, -0.5, 0.5);
      const thr = clamp(0.55 + e * 0.035 + this.iSpd, 0, 1);
      ctl.throttle = ctl.throttle.map(() => thr);
    }
  }

  // ------------------------------------------------------------ helicopter
  updateHeli(dt, ctl) {
    const fm = this.fm, t = fm.telemetry;
    const r = -fm.w.y / DEG;
    // heading hold via pedals
    const err = angDiffDeg(t.heading, this.hdg);
    ctl.yaw = clamp(-err * 0.03 + r * 0.04, -0.7, 0.7);
    // altitude hold via collective
    const altFt = t.alt / FT;
    const vsCmd = clamp((this.alt - altFt) * 3, -800, 800);
    const vsErr = vsCmd - t.vs / FPM;
    this.iCol = clamp(this.iCol + vsErr * dt * 0.00012, 0.05, 0.95);
    ctl.collective = clamp(this.iCol + vsErr * 0.0004, 0, 1);
    // speed / hover hold via cyclic
    const fwd = { x: -Math.sin(-t.heading * DEG) * 0 + Math.sin(t.heading * DEG), z: -Math.cos(t.heading * DEG) };
    const vF = fm.vel.x * fwd.x + fm.vel.z * fwd.z;
    const vR = fm.vel.x * -fwd.z + fm.vel.z * fwd.x;
    let vTarget = this.hover ? 0 : this.spd * KT;
    const pitchCmd = clamp(-(vTarget - vF) * 0.6, -12, 10);
    const rollCmd = clamp(-vR * (this.hover ? 1.2 : 0.4), -12, 12) + (this.hover ? 0 : clamp(angDiffDeg(t.heading, this.hdg) * 0.4, -15, 15));
    ctl.pitch = clamp((pitchCmd - t.pitch) * 0.08 - (fm.w.x / DEG) * 0.05, -0.7, 0.7);
    ctl.roll = clamp((rollCmd - t.bank) * 0.06 - (-fm.w.z / DEG) * 0.04, -0.7, 0.7);
  }
}

// ------------------------------------------------------------ simplified-mode assists
export class Assists {
  constructor(spec, fm, settings) {
    this.spec = spec; this.fm = fm; this.settings = settings;
    this.trimI = 0;
    this.holdPitch = null;
    this.holdHdg = null;
    this.sasAtt = { pitch: 0, bank: 0, hold: false };
    // helicopter SAS gains (attitude P per degree, rate D per deg/s, authority limit, yaw P/D)
    this.sasK = { kp: 0.05, kd: 0.04, lim: 0.4, yp: 0.02, yd: 0.05 };
    this.sasI = { p: 0, r: 0, vF: 0, vR: 0 };   // integral trims: attitude (CG offset) and velocity (hover hold)
  }
  apply(dt, ctl, raw, apEngaged) {
    const a = this.settings.p.assists, fm = this.fm, t = fm.telemetry;
    const simplified = this.settings.c.mode === 'simplified';
    if (!Number.isFinite(t.pitch)) return;
    if (fm.isHeli) return this.heli(dt, ctl, raw, apEngaged, simplified && a.heliStability);
    if (apEngaged) return;
    const air = !fm.onGround && t.agl > 3;
    // auto rudder: coordinate turns and damp yaw in the air
    if (simplified && a.autoRudder && air) {
      ctl.yaw = clamp(raw.yaw + (t.beta || 0) * -0.06 + fm.w.y * 0.9 + raw.roll * 0.08, -1, 1);
    }
    // auto trim: hold pitch attitude when the stick is released
    if (simplified && a.autoTrim && air) {
      if (Math.abs(raw.pitch) < 0.04) {
        if (this.holdPitch === null) this.holdPitch = t.pitch;
        const err = this.holdPitch - t.pitch;
        this.trimI = clamp(this.trimI + (err * 0.012 - fm.w.x / DEG * 0.01) * dt * 6, -0.6, 0.6);
      } else {
        this.holdPitch = null;
      }
      ctl.trim = this.trimI;
    } else if (!air) { this.holdPitch = null; this.trimI = damp(this.trimI, 0, 0.5, dt); if (simplified) ctl.trim = this.trimI; }
    // stall protection: limit nose-up command near the critical angle of attack
    if (simplified && a.stallProtection && air) {
      const margin = (fm.alphaStall / DEG + fm.flapInfo().dA) - (t.alpha || 0);
      if (margin < 3) ctl.pitch = Math.min(ctl.pitch, -0.15 + margin * 0.12) - (margin < 0 ? 0.25 : 0);
      if (margin < 3) ctl.trim = Math.min(ctl.trim, this.trimI = Math.min(this.trimI, 0));
    }
    // ground roll: damp yaw (catches the ground-loop tendency of taildraggers) and hold the heading
    // the pilot was tracking when the rudder keys are released
    if (simplified && a.autoRudder && fm.onGround && t.gs > 4) {
      if (Math.abs(raw.yaw) < 0.05) {
        if (this.holdHdg === null) this.holdHdg = t.heading;
        const err = ((t.heading - this.holdHdg + 540) % 360) - 180;
        ctl.yaw = clamp(ctl.yaw - err * 0.05 + fm.w.y * 2.2, -1, 1);
      } else {
        this.holdHdg = null;
        ctl.yaw = clamp(ctl.yaw + fm.w.y * 1.2, -1, 1);
      }
    } else if (!fm.onGround || t.gs <= 4) this.holdHdg = null;
    // taildraggers: hold the stick back on the ground at low speed (as a pilot would) so that power
    // against the brakes or a hard brake application does not tip the aircraft onto its propeller
    if (simplified && this.spec.gearType === 'taildragger' && fm.onGround && raw.pitch > -0.3) {
      const k = clamp(1 - (t.ias / 0.5144 - 20) / 15, 0, 1);       // full below 20 kt, released by 35 kt
      ctl.pitch = Math.max(ctl.pitch, 0.75 * k);
    }
    // differential braking for castering nose wheels
    if (this.spec.castering && fm.onGround && Math.abs(raw.yaw) > 0.1) {
      if (raw.yaw > 0) ctl.brakeR = Math.max(ctl.brakeR, raw.yaw * 0.6); else ctl.brakeL = Math.max(ctl.brakeL, -raw.yaw * 0.6);
    }
  }
  heli(dt, ctl, raw, apEngaged, sas) {
    const fm = this.fm, t = fm.telemetry;
    if (apEngaged || !sas || !Number.isFinite(t.pitch)) return;
    const air = t.agl > 1.2 || !fm.onGround;
    // attitude-command / rate-damping SAS
    const p = -fm.w.z / DEG, q = fm.w.x / DEG, r = -fm.w.y / DEG;
    const centred = Math.abs(raw.pitch) < 0.05 && Math.abs(raw.roll) < 0.05;
    if (centred) {
      if (!this.sasAtt.hold) { this.sasAtt.hold = true; this.sasAtt.pitch = Math.max(-8, Math.min(8, t.pitch)); this.sasAtt.bank = 0; }
      // outer loop: at low speed hold position (ground velocity -> attitude target), otherwise
      // return to a gentle level attitude
      let pT = 2, bT = 0;
      const I0 = this.sasI;
      if (t.gs < 6 && air) {
        const hd = t.heading * DEG;
        const vF = fm.vel.x * Math.sin(hd) + fm.vel.z * -Math.cos(hd);
        const vR = fm.vel.x * Math.cos(hd) + fm.vel.z * Math.sin(hd);
        I0.vF = clamp(I0.vF + vF * 0.6 * dt, -6, 6);
        I0.vR = clamp(I0.vR + vR * 0.6 * dt, -6, 6);
        pT = 2 + clamp(vF * 2.2 + I0.vF, -10, 10);           // moving forward -> raise the nose to stop
        bT = clamp(-(vR * 2.2 + I0.vR), -10, 10);            // drifting right -> bank left
      } else { I0.vF = damp(I0.vF, 0, 0.5, dt); I0.vR = damp(I0.vR, 0, 0.5, dt); }
      this.sasAtt.pitch = damp(this.sasAtt.pitch, pT, 1.5, dt);
      this.sasAtt.bank = damp(this.sasAtt.bank, bT, 1.5, dt);
      // inner loop: attitude P + rate D + slow integral trim (CG offset, wind)
      const K = this.sasK, I = this.sasI;
      if (air) {
        I.p = clamp(I.p + (this.sasAtt.pitch - t.pitch) * 0.03 * dt, -0.35, 0.35);
        I.r = clamp(I.r + (this.sasAtt.bank - t.bank) * 0.03 * dt, -0.35, 0.35);
      } else { I.p = damp(I.p, 0, 0.5, dt); I.r = damp(I.r, 0, 0.5, dt); }
      ctl.pitch = clamp((this.sasAtt.pitch - t.pitch) * K.kp - q * K.kd * 1.25 + I.p, -K.lim - 0.2, K.lim + 0.2);
      ctl.roll = clamp((this.sasAtt.bank - t.bank) * K.kp - p * K.kd + I.r, -K.lim - 0.2, K.lim + 0.2);
    } else {
      this.sasAtt.hold = false;
      ctl.pitch = clamp(raw.pitch * 0.8 - q * 0.03, -1, 1);
      ctl.roll = clamp(raw.roll * 0.8 - p * 0.025, -1, 1);
    }
    // auto anti-torque + heading hold when pedals centred
    if (!fm.spec.heli.tandem) {
      // feed-forward: the pedal at which the tail rotor exactly balances the main-rotor torque.
      // Tail thrust model (flight.js): Ttr = Tmax * nr^2 * (0.44 - 0.56 * pedal), Tmax = 2.25 Qhover / arm,
      // balance Ttr * arm = 0.98 Qrotor  =>  pedal = (0.44 - 0.98 Qrotor / (2.25 Qhover nr^2)) / 0.56
      const nrK = Math.max(0.2, (fm.nr || 1) ** 2);
      const need = fm.rotorTorque / Math.max(1, fm.Qhover);
      const ff = clamp((0.44 - 0.98 * need / (2.25 * nrK)) / 0.56, -1, 1);
      // heading hold / yaw damping: angDiffDeg(a, b) = b - a, r = heading rate (deg/s, + = right)
      if (Math.abs(raw.yaw) < 0.05 && air) {
        if (this.holdHdg === null) this.holdHdg = t.heading;
        ctl.yaw = clamp(ff + angDiffDeg(t.heading, this.holdHdg) * this.sasK.yp - r * this.sasK.yd, -1, 1);
      } else {
        this.holdHdg = null;
        ctl.yaw = clamp(ff + raw.yaw * 0.7 - r * 0.02, -1, 1);
      }
      if (!air) ctl.yaw = clamp(ff + raw.yaw, -1, 1);
    } else {
      ctl.yaw = clamp(raw.yaw - r * 0.03, -1, 1);
    }
  }
}
