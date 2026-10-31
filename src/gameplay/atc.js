// Simulated air traffic control: ATIS, clearances, frequency changes, emergency handling.
// Text log + optional speech synthesis (different voices for controller and pilot).
import { bus } from '../core/events.js';
import { settings } from '../core/settings.js';
import { AIRPORTS, runwayEnds } from '../world/airportData.js';
import { DEG, KT, FT, NM, angDiffDeg } from '../core/math.js';

const PHON = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
const DIG = ['zero', 'one', 'two', 'tree', 'four', 'fife', 'six', 'seven', 'eight', 'niner'];
const sayNum = (s) => String(s).split('').map((c) => (c >= '0' && c <= '9' ? DIG[+c] : c === '.' ? 'decimal' : c)).join(' ');
const sayRwy = (r) => r.replace(/(\d+)([LRC]?)/, (_, n, l) => sayNum(n) + (l ? ' ' + ({ L: 'left', R: 'right', C: 'center' })[l] : ''));

export class ATC {
  constructor() {
    this.log = [];
    this.freq = '118.70';
    this.station = null;
    this.phase = 'ground';
    this.callsign = 'Skylark 172';
    this.cleared = { takeoff: false, landing: false };
    this.emergency = false;
    this.lastAuto = 0;
    this.atisLetter = 'K';
    this.voices = null;
    if (window.speechSynthesis) {
      const load = () => { this.voices = window.speechSynthesis.getVoices().filter((v) => /en/i.test(v.lang)); };
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  }

  reset(ac, ap) {
    this.log = []; this.cleared = { takeoff: false, landing: false }; this.emergency = false; this.phase = ac.fm.onGround ? 'ground' : 'air';
    const reg = ac.model.desc.livery.reg || 'N123';
    this.callsign = `${ac.spec.name.split(' ')[0]} ${reg.slice(-3).split('').map((c) => PHON[c] || c).join(' ')}`;
    this.setStation(ap);
  }

  setStation(ap) {
    if (!ap || this.station === ap) return;
    this.station = ap;
    this.freq = ap.freq.tower || ap.freq.approach;
    bus.emit('atc:freq', { name: ap.short, freq: this.freq });
  }

  activeRunway(ap, weather) {
    if (!ap.runways.length) return null;
    const wdir = weather.windDir;
    let best = null, bd = 1e9;
    for (const rw of ap.runways) {
      if (rw.surface === 'grass' && ap.runways.length > 1) continue;
      for (const [name, hdg] of [[rw.name, rw.hdg], [rw.recip, (rw.hdg + 180) % 360]]) {
        const d = Math.abs(angDiffDeg(hdg, wdir)) - (rw.len / 1000);
        if (d < bd) { bd = d; best = { name, hdg, rw }; }
      }
    }
    return best;
  }

  say(from, text, spoken = text) {
    const entry = { from, text, t: Date.now() };
    this.log.push(entry);
    if (this.log.length > 60) this.log.shift();
    bus.emit('atc:msg', entry);
    if (settings.a.atcVoice && window.speechSynthesis && !settings.a.muted) {
      try {
        const u = new SpeechSynthesisUtterance(spoken);
        u.rate = from === 'pilot' ? 1.15 : 1.08; u.pitch = from === 'pilot' ? 1.05 : 0.85; u.volume = settings.a.master * 0.9;
        if (this.voices && this.voices.length) u.voice = this.voices[from === 'pilot' ? Math.min(1, this.voices.length - 1) : 0];
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
  }

  ctrl(text, spoken) { this.say('atc', `${this.station ? this.station.short : 'Approach'}: ${text}`, spoken || text); }
  pilot(text) { this.say('pilot', `${this.callsign}: ${text}`); }

  request(kind, ac, weather) {
    const ap = this.station || nearestAirport(ac.fm.pos.x, ac.fm.pos.z);
    this.setStation(ap);
    const rw = this.activeRunway(ap, weather);
    const wind = `wind ${String(Math.round(weather.windDir / 10) * 10).padStart(3, '0')} at ${Math.round(weather.windKt)}${weather.gustKt > weather.windKt + 4 ? ' gusting ' + Math.round(weather.gustKt) : ''}`;
    const qnh = Math.round(weather.qnh);
    const cs = this.callsign;
    switch (kind) {
      case 'atis': {
        const txt = `${ap.name} information ${PHON[this.atisLetter]}. ${weather.metar(ap.icao)}. ${rw ? 'Landing and departing runway ' + rw.name + '.' : 'Helicopter operations only.'}`;
        this.ctrl(txt, `${ap.name} information ${PHON[this.atisLetter]}. ${wind}. visibility ${weather.visibility >= 10000 ? 'one zero kilometres or more' : Math.round(weather.visibility / 100) * 100 + ' metres'}. QNH ${sayNum(qnh)}. ${rw ? 'runway ' + sayRwy(rw.name) + ' in use' : ''}.`);
        break;
      }
      case 'taxi':
        this.pilot(`ready to taxi, information ${PHON[this.atisLetter]}`);
        setTimeout(() => this.ctrl(rw ? `${cs}, taxi to holding point runway ${rw.name} via ${ap.taxiways.find((t) => t.name)?.name || 'Alpha'}, QNH ${qnh}` : `${cs}, cleared for departure from the helipad, QNH ${qnh}`), 1500);
        break;
      case 'takeoff':
        this.pilot(rw ? `ready for departure runway ${rw.name}` : 'ready for departure');
        setTimeout(() => { this.cleared.takeoff = true; this.ctrl(rw ? `${cs}, ${wind}, runway ${rw.name} cleared for take-off` : `${cs}, ${wind}, cleared for take-off, own discretion`, `${cs}, ${wind}, ${rw ? 'runway ' + sayRwy(rw.name) + ' ' : ''}cleared for take-off`); }, 1600);
        break;
      case 'landing': {
        const dist = Math.hypot(ap.x - ac.fm.pos.x, ap.z - ac.fm.pos.z) / NM;
        this.pilot(`${Math.round(dist)} miles out, request landing ${ap.short}`);
        setTimeout(() => { this.cleared.landing = true; this.ctrl(rw ? `${cs}, ${wind}, runway ${rw.name} cleared to land` : `${cs}, ${wind}, cleared to land helipad`, `${cs}, ${wind}, ${rw ? 'runway ' + sayRwy(rw.name) : 'helipad'}, cleared to land`); }, 1700);
        break;
      }
      case 'position': {
        const alt = Math.round(ac.fm.pos.y / FT / 100) * 100;
        this.pilot(`level ${alt} feet, heading ${Math.round(ac.fm.telemetry.heading)}`);
        setTimeout(() => this.ctrl(`${cs}, radar contact, ${Math.round(Math.hypot(ap.x - ac.fm.pos.x, ap.z - ac.fm.pos.z) / NM)} miles from ${ap.short}. QNH ${qnh}`), 1400);
        break;
      }
      case 'mayday': this.declareEmergency(ac, weather, 'MAYDAY'); break;
    }
  }

  declareEmergency(ac, weather, kind = 'PAN') {
    if (this.emergency) return;
    this.emergency = true;
    const ap = nearestAirport(ac.fm.pos.x, ac.fm.pos.z);
    this.setStation(ap);
    const rw = this.activeRunway(ap, weather);
    const cs = this.callsign;
    this.pilot(`${kind} ${kind} ${kind}, ${cs}, ${ac.failure ? ac.failure.title.toLowerCase() : 'emergency'}, ${Math.round(ac.fm.pos.y / FT)} feet, request immediate landing`);
    setTimeout(() => this.ctrl(`${cs}, ${kind === 'MAYDAY' ? 'roger MAYDAY' : 'roger PAN PAN'}. ${rw ? 'Cleared to land any runway, runway ' + rw.name + ' preferred' : 'cleared to land'}, wind ${Math.round(weather.windDir)} at ${Math.round(weather.windKt)}. Emergency services are standing by.`), 2200);
    this.cleared.landing = true;
  }

  // Automatic advisories depending on flight phase.
  update(dt, ac, weather) {
    const fm = ac.fm, t = fm.telemetry;
    const ap = nearestAirport(fm.pos.x, fm.pos.z);
    const d = Math.hypot(ap.x - fm.pos.x, ap.z - fm.pos.z);
    if (d < 18000) this.setStation(ap);
    const now = performance.now() / 1000;
    if (now - this.lastAuto < 6) return;
    if (this.phase === 'ground' && !fm.onGround && t.agl > 100) {
      this.phase = 'departure'; this.lastAuto = now;
      if (!this.cleared.takeoff && this.station && this.station.runways.length) this.ctrl(`${this.callsign}, you departed without a clearance. Contact approach on ${this.station.freq.approach}`);
      else this.ctrl(`${this.callsign}, airborne, climb at pilot's discretion, contact approach ${this.station ? this.station.freq.approach : '124.35'}. Good day`);
    } else if (this.phase === 'departure' && t.agl > 900) {
      this.phase = 'cruise'; this.lastAuto = now;
      this.ctrl(`${this.callsign}, radar contact. Proceed on course, report when ready for the approach`);
    } else if ((this.phase === 'cruise' || this.phase === 'departure') && ac.dest && Math.hypot(ac.dest.x - fm.pos.x, ac.dest.z - fm.pos.z) < 16000 && t.agl > 150) {
      this.phase = 'approach'; this.lastAuto = now;
      const a = AIRPORTS.find((x) => x.icao === ac.dest.icao);
      if (a) { this.setStation(a); const rw = this.activeRunway(a, weather); this.ctrl(`${this.callsign}, ${rw ? 'expect runway ' + rw.name + ', ' : ''}descend at your discretion, QNH ${Math.round(weather.qnh)}. Report final`); }
    } else if (this.phase !== 'ground' && fm.onGround && t.gs < 15) {
      this.phase = 'ground'; this.lastAuto = now; this.cleared.takeoff = false; this.cleared.landing = false;
      this.ctrl(`${this.callsign}, welcome to ${this.station ? this.station.short : 'the field'}. Vacate when able, contact ground ${this.station && this.station.freq.ground ? this.station.freq.ground : ''}`);
    }
  }
}

export function nearestAirport(x, z) {
  let best = null, bd = 1e12;
  for (const ap of AIRPORTS) { const d = Math.hypot(ap.x - x, ap.z - z); if (d < bd) { bd = d; best = ap; } }
  return best;
}
