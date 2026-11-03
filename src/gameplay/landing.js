// Landing evaluation: touchdown rate, g-load, centreline, touchdown zone, alignment, speed, rollout.
import { surfaces } from '../sim/surfaces.js';
import { bus } from '../core/events.js';
import { clamp, KT, FT, FPM, DEG, angDiffDeg } from '../core/math.js';
import { AIRPORTS, toWorld } from '../world/airportData.js';

export class LandingEvaluator {
  constructor() { this.reset(); }
  reset() { this.current = null; this.results = []; this.lastTd = null; }

  update(dt, ac) {
    const fm = ac.fm, t = fm.telemetry;
    const td = fm.touchdown;
    if (td && td !== this.lastTd) {
      this.lastTd = td;
      this.begin(ac, td);
    }
    const c = this.current;
    if (!c) return;
    c.time += dt;
    if (!fm.onGround) {
      // bounced
      if (c.time < 4 && t.agl > 1.5) c.bounce = true;
      if (t.agl > 25) { this.current = null; return; }   // go-around / touch-and-go
    }
    if (c.rw) {
      const rr = surfaces.runwayAt(fm.pos.x, fm.pos.z, 0);
      if (!rr && fm.onGround && t.gs > 5) c.excursion = true;
      if (rr) c.maxDev = Math.max(c.maxDev, Math.abs(rr.across));
    }
    c.minG = Math.min(c.minG, fm.gLoad); c.maxG = Math.max(c.maxG, fm.gLoad);
    const stopped = t.gs < (ac.spec.cat === 'heli' ? 1.0 : 2.5) && fm.onGround;
    if (stopped && c.time > 2) { c.rollout = Math.hypot(fm.pos.x - c.x, fm.pos.z - c.z); this.finish(ac); }
    else if (c.time > 90) this.finish(ac);
  }

  begin(ac, td) {
    const fm = ac.fm, spec = ac.spec;
    const vsFpm = Math.abs(td.vs || 0) / FPM;
    const r = surfaces.runwayAt(td.pos.x, td.pos.z, 3);
    const c = {
      time: 0, x: td.pos.x, z: td.pos.z, vsFpm, g: Math.max(td.gLoad || 1, fm.maxG > 1 ? Math.min(fm.maxG, 4) : 1), speedKt: (td.speed || 0) / KT,
      bank: Math.abs(td.bank || 0), pitch: td.pitch || 0, heading: td.heading, bounce: false, excursion: false, maxDev: 0, minG: 1, maxG: td.gLoad || 1,
      wheels: td.wheels, surface: td.surface, rw: null, crashed: fm.damage.crashed,
    };
    if (r) {
      // which end did we land on? the end we are rolling away from
      const hdgA = r.r.rw.hdg, hdgB = (hdgA + 180) % 360;
      const useA = Math.abs(angDiffDeg(td.heading, hdgA)) < 90;
      const along = useA ? r.along + r.r.hl : r.r.hl - r.along;
      const across = useA ? r.across : -r.across;
      c.rw = { name: `${r.r.ap.icao} ${useA ? r.r.rw.name : r.r.rw.recip}`, icao: r.r.ap.icao, fromThr: along, len: r.r.rw.len, width: r.r.rw.wid, centre: across, align: angDiffDeg(useA ? hdgA : hdgB, td.heading) };
    }
    // helipad
    if (spec.cat === 'heli') {
      let best = null, bd = 1e9;
      for (const ap of AIRPORTS) for (const h of ap.helipads) {
        const [x, z] = toWorld(ap, h.u, h.v);
        const d = Math.hypot(x - td.pos.x, z - td.pos.z);
        if (d < bd) { bd = d; best = { name: `${ap.icao} ${h.name}`, d, icao: ap.icao }; }
      }
      if (best && best.d < 40) c.pad = best;
    }
    this.current = c;
    bus.emit('touchdown', c);
  }

  finish(ac) {
    const c = this.current;
    this.current = null;
    const spec = ac.spec, fm = ac.fm;
    const notes = [];
    let score = 100;
    const v = c.vsFpm;
    const heli = spec.cat === 'heli';
    const lim = heli ? [80, 200, 350, 500] : [120, 300, 480, 650];
    if (v <= lim[0]) notes.push(['Butter-smooth touchdown', 0]);
    else if (v <= lim[1]) { score -= 5; notes.push(['Smooth touchdown', -5]); }
    else if (v <= lim[2]) { score -= 15; notes.push(['Firm touchdown', -15]); }
    else if (v <= lim[3]) { score -= 30; notes.push(['Hard landing — inspection required', -30]); }
    else { score -= 50; notes.push(['Very hard landing — structural damage likely', -50]); }
    if (c.g > 2.0) { score -= 15; notes.push([`High touchdown load ${c.g.toFixed(2)} g`, -15]); }
    else if (c.g > 1.6) { score -= 6; notes.push([`Touchdown load ${c.g.toFixed(2)} g`, -6]); }
    if (c.bounce) { score -= 10; notes.push(['Bounced', -10]); }
    if (!heli) {
      if (c.rw) {
        const dev = Math.abs(c.rw.centre);
        if (dev < 2) notes.push([`On the centreline (${dev.toFixed(1)} m)`, 0]);
        else if (dev < 5) { score -= 4; notes.push([`Slightly off centreline (${dev.toFixed(1)} m)`, -4]); }
        else if (dev < c.rw.width / 2 - 2) { score -= 12; notes.push([`Off centreline (${dev.toFixed(1)} m)`, -12]); }
        else { score -= 25; notes.push(['Touched down at the runway edge', -25]); }
        const big = spec.mass.mtow > 20000;
        const zone = big ? [150, 750] : [40, 400];
        const d = c.rw.fromThr;
        if (d < 0) { score -= 30; notes.push([`Landed short of the threshold (${Math.round(-d)} m)`, -30]); }
        else if (d < zone[0]) { score -= 8; notes.push([`Touchdown early (${Math.round(d)} m past threshold)`, -8]); }
        else if (d <= zone[1]) notes.push([`In the touchdown zone (${Math.round(d)} m)`, 0]);
        else if (d < c.rw.len / 2) { score -= 10; notes.push([`Long landing (${Math.round(d)} m)`, -10]); }
        else { score -= 20; notes.push([`Very long landing (${Math.round(d)} m)`, -20]); }
        const al = Math.abs(c.rw.align);
        if (al > 10) { score -= 15; notes.push([`Large crab / side load (${al.toFixed(0)}°)`, -15]); }
        else if (al > 5) { score -= 5; notes.push([`Some crab at touchdown (${al.toFixed(0)}°)`, -5]); }
        if (c.excursion) { score -= 30; notes.push(['Runway excursion during rollout', -30]); }
      } else {
        score -= 20; notes.push([c.surface === 'grass' ? 'Off-runway landing (field)' : 'Landed off the runway', -20]);
      }
      const vref = spec.perf.vref || 0;
      if (vref) {
        const dv = c.speedKt - vref;
        if (dv > 18) { score -= 10; notes.push([`Fast touchdown (${Math.round(c.speedKt)} kt, Vref ${vref})`, -10]); }
        else if (dv < -15) { score -= 8; notes.push([`Slow touchdown (${Math.round(c.speedKt)} kt)`, -8]); }
        else notes.push([`Good speed (${Math.round(c.speedKt)} kt)`, 0]);
      }
      if (c.bank > 6) { score -= 8; notes.push([`Wing low (${c.bank.toFixed(0)}° bank)`, -8]); }
      if (c.pitch > 12 && !spec.aero.delta) { score -= 10; notes.push(['Tail strike risk (high pitch)', -10]); }
      if (!c.wheels) { score -= 40; notes.push(['Gear-up / belly landing', -40]); }
    } else {
      if (c.pad) { score += 5; notes.push([`Landed on helipad ${c.pad.name} (${c.pad.d.toFixed(1)} m from centre)`, 5]); }
      if (c.speedKt > 10) { score -= 10; notes.push(['Running landing (groundspeed > 10 kt)', -10]); }
      if (c.bank > 6) { score -= 8; notes.push(['Not level at touchdown', -8]); }
    }
    if (fm.damage.crashed) { score = 0; notes.push(['Aircraft destroyed', -100]); }
    score = clamp(Math.round(score), 0, 100);
    const grade = score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    const res = { score, grade, vsFpm: Math.round(v), g: +c.g.toFixed(2), speedKt: Math.round(c.speedKt), runway: c.rw ? c.rw.name : c.pad ? c.pad.name : 'Off-airport', centre: c.rw ? +c.rw.centre.toFixed(1) : null, fromThr: c.rw ? Math.round(c.rw.fromThr) : null, rollout: Math.round(c.rollout || 0), notes, time: Date.now(), icao: c.rw ? c.rw.icao : c.pad ? c.pad.icao : null, heli };
    this.results.push(res);
    bus.emit('landing', res);
    return res;
  }
}
