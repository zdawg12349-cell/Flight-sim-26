// Missions, landing challenges and their runtime (objectives, markers, scoring).
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { clamp, DEG, KT, FT, FPM, NM } from '../core/math.js';
import { AIRPORT_BY_ID, toWorld, runwayEnds } from '../world/airportData.js';
import { LAYER_WORLD } from '../render/renderer.js';

const AP = (icao) => AIRPORT_BY_ID[icao];
const pad = (icao, i = 0) => { const a = AP(icao); const h = a.helipads[i]; const [x, z] = toWorld(a, h.u, h.v); return { x, z, roof: h.roof || 0 }; };

export const MISSIONS = [
  { id: 'commuter_hop', title: 'Morning commuter hop', aircraft: 'commuter', from: 'KPXR', spawn: 'gate:B6', to: 'KMVL', weather: 'fair', time: 7.6,
    brief: 'Fly 17 commuters from Port Aurelia International to Marlow Valley Regional (21 km north). Keep the ride smooth: passengers notice bank angles over 30° and loads above 1.5 g.',
    objectives: [{ type: 'takeoff' }, { type: 'land', icao: 'KMVL' }, { type: 'stop' }], comfort: true, payload: 0.9 },
  { id: 'island_shuttle', title: 'Island shuttle', aircraft: 'rt72', from: 'KPXR', spawn: 'runway:27L', to: 'KISL', weather: 'scattered', time: 15.5,
    brief: 'A full load of holiday-makers to Isla Coral, 26 km south-west over the sea. Expect a sea breeze crosswind on runway 07/25.',
    objectives: [{ type: 'takeoff' }, { type: 'land', icao: 'KISL' }, { type: 'stop' }], comfort: true, payload: 1.0 },
  { id: 'mountain_strip', title: 'Into the mountains', aircraft: 'zephyr', from: 'KBRF', spawn: 'runway:31', to: 'KSKP', weather: 'fair', time: 10,
    brief: 'Climb over the ridges and land at Summit Peak (1,390 m elevation). Thin air means longer take-off rolls and higher true airspeeds on approach.',
    objectives: [{ type: 'takeoff' }, { type: 'altitude', ft: 7500, label: 'Climb above 7,500 ft' }, { type: 'land', icao: 'KSKP' }, { type: 'stop' }] },
  { id: 'night_arrival', title: 'Night arrival', aircraft: 'm738', from: 'KMVL', spawn: 'runway:18', to: 'KPXR', weather: 'clear', time: 21.5,
    brief: 'A late evening positioning flight to Port Aurelia. Use the approach lights, PAPI and the autopilot APP mode to the ILS.',
    objectives: [{ type: 'takeoff' }, { type: 'land', icao: 'KPXR' }, { type: 'stop' }] },
  { id: 'air_ambulance', title: 'Air ambulance', aircraft: 'r145', from: 'KPXR', spawn: 'helipad:H1', weather: 'fair', time: 13,
    brief: 'A farm accident 9 km west. Land near the orange smoke, wait while the patient is loaded, then fly to the Aurelia Medical Center rooftop helipad.',
    objectives: [{ type: 'takeoff' }, { type: 'landAt', x: -9200, z: -3200, radius: 45, time: 20, label: 'Land at the accident site' }, { type: 'takeoff' }, { type: 'helipad', icao: 'HMED', label: 'Land on the hospital roof' }], marker: { x: -9200, z: -3200, smoke: true } },
  { id: 'offshore', title: 'Offshore crew change', aircraft: 'h139', from: 'KPXR', spawn: 'helipad:H1', weather: 'scattered', time: 9,
    brief: 'Take 12 workers to platform OP-7, 20 km offshore. The helideck is 38 m above the sea — make a steep, controlled approach into wind.',
    objectives: [{ type: 'takeoff' }, { type: 'helipad', icao: 'OP7', label: 'Land on the OP-7 helideck' }, { type: 'stop' }], payload: 0.8 },
  { id: 'sar', title: 'Search and rescue', aircraft: 'r145', from: 'KISL', spawn: 'helipad:H1', weather: 'broken', time: 16,
    brief: 'A sailing boat is in distress south of Isla Coral. Find it (look for the flare), hover 10–30 m above it, lower the hoist (K) and hold for 15 seconds, then return to Isla Coral.',
    objectives: [{ type: 'takeoff' }, { type: 'hover', x: -12500, z: 27500, radius: 18, aglMin: 8, aglMax: 35, time: 15, hoist: true, label: 'Hover over the boat with the hoist down' }, { type: 'helipad', icao: 'KISL', label: 'Return to Isla Coral' }], marker: { x: -12500, z: 27500, boat: true } },
  { id: 'heavy_lift', title: 'Heavy lift', aircraft: 'hl47', from: 'KMVL', spawn: 'helipad:H1', weather: 'fair', time: 11,
    brief: 'Sling a 6-tonne generator to a construction site near Marlow town. Hover low over the load to hook it (K), fly it to the site and set it down gently.',
    objectives: [{ type: 'hover', x: 6400, z: -19700, radius: 15, aglMin: 3, aglMax: 18, time: 4, hoist: true, label: 'Hook the load (hover over it, press K)' }, { type: 'hover', x: 9400, z: -15400, radius: 20, aglMin: 3, aglMax: 18, time: 4, hoistRelease: true, label: 'Set the load down at the site (K to release)' }, { type: 'landAt', x: 6280, z: -19640, radius: 120, time: 3, label: 'Return to Marlow Regional' }], marker: { x: 6400, z: -19700, cargo: true }, sling: true },
  { id: 'sightseeing', title: 'Sightseeing tour', aircraft: 'h22', from: 'KBRF', spawn: 'helipad:H1', weather: 'clear', time: 17.8,
    brief: 'A sunset tour: fly over Lake Marlow, the Crystal Lake in the mountains and back to Birchfield.',
    objectives: [{ type: 'takeoff' }, { type: 'reach', x: 1500, z: -13500, radius: 900, label: 'Overfly Lake Marlow' }, { type: 'reach', x: 6200, z: -34200, radius: 900, label: 'Overfly Crystal Lake' }, { type: 'helipad', icao: 'KBRF', label: 'Land back at Birchfield' }] },
  { id: 'supersonic', title: 'Supersonic dash', aircraft: 'sst', from: 'KPXR', spawn: 'runway:09L', weather: 'clear', time: 11,
    brief: 'Climb above 45,000 ft and accelerate beyond Mach 1.6 (full throttle engages reheat), then return and land at Port Aurelia. Remember: the delta wing lands nose-high.',
    objectives: [{ type: 'takeoff' }, { type: 'altitude', ft: 45000, label: 'Climb above FL450' }, { type: 'mach', m: 1.6, label: 'Exceed Mach 1.6' }, { type: 'land', icao: 'KPXR' }] },
  { id: 'aerobatics', title: 'Aerobatic practice', aircraft: 'swallow', from: 'KBRF', spawn: 'runway:13', weather: 'clear', time: 12,
    brief: 'Climb to a safe altitude and fly a loop and an aileron roll, then land back at Birchfield.',
    objectives: [{ type: 'takeoff' }, { type: 'loop', label: 'Fly a loop (pitch through 360°)' }, { type: 'roll', label: 'Fly an aileron roll' }, { type: 'land', icao: 'KBRF' }] },
  { id: 'jumbo_ferry', title: 'Jumbo ferry flight', aircraft: 'a740', from: 'KPXR', spawn: 'gate:A3', to: 'KMVL', weather: 'overcast', time: 14,
    brief: 'Push the giant from the gate, taxi to runway 09L and fly the heavy quad-jet to Marlow Regional\'s 2,400 m runway — plan the descent early!',
    objectives: [{ type: 'takeoff' }, { type: 'land', icao: 'KMVL' }, { type: 'stop' }] },
];

export const CHALLENGES = [
  { id: 'c_easy', title: 'Calm evening', level: 'Easy', aircraft: 'skylark', airport: 'KBRF', runway: '13', dist: 3.5, weather: 'clear', time: 18, brief: 'Land the trainer on Birchfield runway 13 in calm air.' },
  { id: 'c_glass', title: 'Glass cockpit approach', level: 'Easy', aircraft: 'zephyr', airport: 'KMVL', runway: '36', dist: 5, weather: 'fair', time: 9, brief: 'A routine approach with light winds.' },
  { id: 'c_cross', title: 'Gusty crosswind', level: 'Medium', aircraft: 'rt72', airport: 'KPXR', runway: '15', dist: 6, weather: 'crosswind', wind: { windDir: 70, wind: 18, gust: 28 }, time: 14, brief: 'Strong gusting crosswind from the east on runway 15. Crab, then de-crab with rudder just before touchdown.' },
  { id: 'c_island', title: 'Island in the storm', level: 'Hard', aircraft: 'm738', airport: 'KISL', runway: '07', dist: 8, weather: 'storm', time: 17, brief: 'Thunderstorms over Isla Coral: heavy rain, turbulence and low visibility.' },
  { id: 'c_mountain', title: 'Mountain night & snow', level: 'Expert', aircraft: 'rj90', airport: 'KSKP', runway: '05', dist: 7, weather: 'snow', time: 22.5, brief: 'Snow showers at night into the high valley airport. Terrain on both sides of the approach!' },
  { id: 'c_fog', title: 'Fog — Cat III', level: 'Expert', aircraft: 'a740', airport: 'KPXR', runway: '09L', dist: 10, weather: 'fog', time: 6.5, brief: 'Visibility 500 m. Use the APP autopilot mode to fly the ILS and take over for the flare.' },
  { id: 'c_eo', title: 'Engine-out approach', level: 'Hard', aircraft: 'duomax', airport: 'KMVL', runway: '36', dist: 5, weather: 'fair', time: 11, failure: { type: 'flameout', engine: 0, after: 3 }, brief: 'The left engine will fail on final. Keep the speed above Vmc, use rudder and land.' },
  { id: 'c_auto', title: 'Autorotation', level: 'Hard', aircraft: 'h22', airport: 'KBRF', runway: '13', dist: 1.6, alt: 1500, weather: 'clear', time: 10, failure: { type: 'heliEngine', after: 4 }, heli: true, brief: 'Engine failure at 1,500 ft! Lower the collective at once, glide at ~65 kt and flare to land on the field.' },
  { id: 'c_short', title: 'Short grass strip', level: 'Medium', aircraft: 'bushhawk', airport: 'KBRF', runway: '04', dist: 2.5, weather: 'fair', time: 16, brief: 'Bring the tail-dragger onto the 680 m grass strip. Full flaps, slow and steady.' },
  { id: 'c_sst', title: 'Delta-wing arrival', level: 'Hard', aircraft: 'sst', airport: 'KPXR', runway: '27R', dist: 10, weather: 'scattered', time: 19, brief: 'Land the supersonic transport: very nose-high attitude, high approach speed (~160 kt).' },
];

export class MissionRunner {
  constructor(scene) {
    this.scene = scene;
    this.mission = null;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  start(m, ac) {
    this.clear();
    this.mission = m; this.i = 0; this.t0 = performance.now();
    this.timer = 0; this.state = {}; this.maxBank = 0; this.maxG = 1; this.minG = 1;
    this.done = false;
    if (m.marker) this.addMarker(m.marker);
    this.setTargetMarker(ac);
    bus.emit('mission:objective', { i: 0, label: this.label(m.objectives[0]), total: m.objectives.length });
  }

  clear() {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.mission = null; this.target = null; this.sling = null;
  }

  label(o) {
    if (!o) return '';
    if (o.label) return o.label;
    switch (o.type) {
      case 'takeoff': return 'Take off';
      case 'land': return `Land at ${AP(o.icao).short}`;
      case 'stop': return 'Come to a full stop';
      case 'helipad': return `Land on the helipad at ${AP(o.icao).short}`;
      case 'altitude': return `Climb to ${o.ft.toLocaleString()} ft`;
      default: return o.type;
    }
  }

  addMarker(mk) {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 400, 16, 1, true), new THREE.MeshBasicMaterial({ color: mk.smoke ? 0xff7a1a : 0x33ddff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    col.position.y = 200;
    g.add(col);
    if (mk.boat) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 8).translate(0, 0.4, 0), new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9).translate(0, 5, 0), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
      mast.rotation.z = 0.5;
      g.add(hull); g.add(mast);
    }
    if (mk.cargo) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 6).translate(0, 1.3, 0), new THREE.MeshLambertMaterial({ color: 0x2a6aa8 }));
      g.add(box);
      this.cargoBox = box;
    }
    if (mk.smoke) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.55, depthWrite: false }));
      s.position.y = 6; g.add(s); this.smokeBall = s;
    }
    g.userData.ground = true;
    g.position.set(mk.x, 0, mk.z);
    g.traverse((o) => o.layers.set(LAYER_WORLD));
    this.group.add(g);
    this.markerObj = g;
  }

  setTargetMarker(ac) {
    if (this.ring) { this.group.remove(this.ring); this.ring = null; }
    const o = this.mission && this.mission.objectives[this.i];
    if (!o) return;
    let p = null;
    if (o.x !== undefined) p = { x: o.x, z: o.z };
    else if (o.icao) { const a = AP(o.icao); p = o.type === 'helipad' ? pad(o.icao) : { x: a.x, z: a.z }; }
    this.target = p;
    if (p && ac) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(o.radius || 30, 1.2, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.8 }));
      ring.position.set(p.x, (p.roof || 0) + 2, p.z);
      ring.layers.set(LAYER_WORLD);
      this.group.add(ring);
      this.ring = ring;
      ac.dest = { x: p.x, z: p.z, icao: o.icao || 'TGT' };
    }
  }

  update(dt, ac, world, landingResult) {
    const m = this.mission;
    if (!m || this.done) return;
    const fm = ac.fm, t = fm.telemetry;
    if (this.markerObj) this.markerObj.position.y = world.surfaceAt(this.markerObj.position.x, this.markerObj.position.z);
    if (this.ring) { this.ring.rotation.y += dt * 0.4; if (this.ring.position.y < world.surfaceAt(this.ring.position.x, this.ring.position.z) + 1) this.ring.position.y = world.surfaceAt(this.ring.position.x, this.ring.position.z) + 2; }
    if (this.smokeBall) { this.smokeBall.scale.setScalar(1 + 0.3 * Math.sin(performance.now() / 300)); }
    if (!fm.onGround) { this.maxBank = Math.max(this.maxBank, Math.abs(t.bank)); this.maxG = Math.max(this.maxG, fm.gLoad); this.minG = Math.min(this.minG, fm.gLoad); }
    // sling load follows the hook
    if (this.sling && this.cargoBox) {
      const hook = fm.pos.clone().add(new THREE.Vector3(0, -2.5, 0));
      this.slingPos = this.slingPos || this.cargoBox.getWorldPosition(new THREE.Vector3());
      const L = 14;
      const d = this.slingPos.clone().sub(hook);
      if (d.length() > L) this.slingPos.copy(hook).add(d.setLength(L));
      this.slingPos.y = Math.max(world.surfaceAt(this.slingPos.x, this.slingPos.z), this.slingPos.y - dt * 9.8 * 0.5);
      this.markerObj.position.set(this.slingPos.x, 0, this.slingPos.z);
      this.cargoBox.position.y = this.slingPos.y - world.surfaceAt(this.slingPos.x, this.slingPos.z);
    }
    const o = m.objectives[this.i];
    let ok = false;
    const dist = this.target ? Math.hypot(fm.pos.x - this.target.x, fm.pos.z - this.target.z) : 0;
    switch (o.type) {
      case 'takeoff': ok = !fm.onGround && t.agl > 15; break;
      case 'stop': ok = fm.onGround && t.gs < 1; break;
      case 'altitude': ok = fm.pos.y / FT >= o.ft; break;
      case 'mach': ok = t.mach >= o.m; break;
      case 'reach': ok = dist < o.radius; break;
      case 'land': ok = landingResult && landingResult.icao === o.icao; break;
      case 'helipad': ok = fm.onGround && t.gs < 1.5 && dist < 25; break;
      case 'landAt': if (fm.onGround && t.gs < 1 && dist < o.radius) { this.timer += dt; ok = this.timer >= o.time; if (Math.floor(this.timer) !== Math.floor(this.timer - dt)) bus.emit('mission:progress', `${Math.ceil(o.time - this.timer)} s`); } else this.timer = 0; break;
      case 'hover': {
        const inBox = dist < o.radius && t.agl >= o.aglMin && t.agl <= o.aglMax && t.gs < 4;
        const hoistOk = !o.hoist || fm.ctl.hoist > 0;
        const relOk = !o.hoistRelease || fm.ctl.hoist === 0 || true;
        if (inBox && hoistOk && relOk) { this.timer += dt; ok = this.timer >= o.time; } else this.timer = Math.max(0, this.timer - dt * 2);
        if (ok && m.sling && o.hoist) { this.sling = true; }
        if (ok && m.sling && o.hoistRelease) { this.sling = false; }
        break;
      }
      case 'loop': {
        const p = t.pitch;
        this.state.pitchAcc = (this.state.pitchAcc || 0) + (fm.w.x / DEG) * dt;
        if (Math.abs(fm.w.x / DEG) < 2 && Math.abs(p) < 20) this.state.pitchAcc *= 0.995;
        ok = this.state.pitchAcc > 330;
        break;
      }
      case 'roll': {
        this.state.rollAcc = (this.state.rollAcc || 0) + (-fm.w.z / DEG) * dt;
        if (Math.abs(fm.w.z / DEG) < 5) this.state.rollAcc *= 0.99;
        ok = Math.abs(this.state.rollAcc) > 330;
        break;
      }
    }
    if (ok) {
      this.i++; this.timer = 0;
      if (this.i >= m.objectives.length) {
        this.done = true;
        const mins = (performance.now() - this.t0) / 60000;
        let comfort = 100;
        if (m.comfort) { comfort -= Math.max(0, this.maxBank - 30) * 2 + Math.max(0, this.maxG - 1.5) * 60 + Math.max(0, 0.5 - this.minG) * 60; }
        bus.emit('mission:complete', { mission: m, minutes: mins, comfort: Math.max(0, Math.round(comfort)), maxBank: Math.round(this.maxBank), maxG: +this.maxG.toFixed(2) });
        ac.dest = null;
      } else {
        bus.emit('mission:objective', { i: this.i, label: this.label(m.objectives[this.i]), total: m.objectives.length });
        this.setTargetMarker(ac);
      }
    }
  }
}

// Spawn description for a landing challenge: position on final at given distance (nm) on a 3° path.
export function challengeSpawn(ch) {
  const ap = AP(ch.airport);
  for (const rw of ap.runways) {
    const e = runwayEnds(ap, rw);
    for (const [end, other, hdg] of [[e.a, e.b, rw.hdg], [e.b, e.a, (rw.hdg + 180) % 360]]) {
      if (end.name !== ch.runway) continue;
      const r = hdg * DEG, dx = Math.sin(r), dz = -Math.cos(r);
      const d = ch.dist * NM;
      const alt = ch.alt ? ch.alt * FT : ap.elev + 15 + d * Math.tan(3 * DEG);
      return { x: end.x - dx * d, z: end.z - dz * d, y: ch.alt ? ap.elev + ch.alt * FT : alt, hdg, ap, rw, end };
    }
  }
  return null;
}
