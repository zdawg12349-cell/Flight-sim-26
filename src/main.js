// Flight Sim 26 — application entry point: boot, game loop and flight lifecycle.
import * as THREE from 'three';
import { settings } from './core/settings.js';
import { input } from './core/input.js';
import { bus } from './core/events.js';
import { clamp, damp, DEG, KT, FT, NM } from './core/math.js';
import { Renderer, LAYER_OWN, LAYER_WORLD } from './render/renderer.js';
import { Environment } from './render/environment.js';
import { CameraRig } from './render/camera.js';
import { World } from './world/worldgen.js';
import { generateColormap } from './world/colormap.js';
import { Terrain } from './world/terrain.js';
import { Water } from './world/water.js';
import { Scenery } from './world/scenery.js';
import { AirportScenery } from './world/airports.js';
import { AIRPORTS, AIRPORT_BY_ID, spawnPoints, toWorld, noseHeading } from './world/airportData.js';
import { Weather } from './weather/weather.js';
import { AIRCRAFT_BY_ID } from './aircraft/catalog.js';
import { Aircraft } from './aircraft/aircraft.js';
import { buildStaticAircraft } from './aircraft/assemble.js';
import { audio } from './audio/audio.js';
import { LandingEvaluator } from './gameplay/landing.js';
import { FailureManager } from './gameplay/emergency.js';
import { RescueResponse, AirportTraffic } from './gameplay/rescue.js';
import { MissionRunner, challengeSpawn } from './gameplay/missions.js';
import { ATC } from './gameplay/atc.js';
import { Recorder, saveLogEntry, summarize } from './gameplay/flightlog.js';
import { PerfMonitor } from './perf/monitor.js';
import { UI } from './ui/ui.js';

const PHYS_DT = 1 / 120;

class App {
  constructor() {
    this.state = 'boot';
    this.paused = false;
    this.ac = null;
    this.audio = audio;
    this.acc = 0;
    this.lastT = performance.now();
    this.raycaster = new THREE.Raycaster();
    this.mouseMoved = false;
    this.flightCfg = null;
    this.replay = null;
  }

  async boot() {
    const ui = this.ui = new UI(this);
    ui.loading(0.02, 'Initialising renderer…');
    await tick();
    let renderer;
    try { renderer = this.renderer = new Renderer(document.getElementById('app')); }
    catch (e) { fatal('WebGL could not be started on this device/browser. ' + e.message); throw e; }
    input.attach(renderer.canvas);
    this.env = new Environment(renderer);
    this.camRig = new CameraRig(renderer);
    renderer.camera.far = settings.g.drawDistance;
    renderer.camera.updateProjectionMatrix();
    ui.loading(0.06, 'Generating terrain…');
    this.world = new World();
    await this.world.generate((p) => ui.loading(0.06 + p * 0.4, 'Generating terrain…'));
    ui.loading(0.48, 'Painting land cover…'); await tick();
    this.colormap = generateColormap(this.world, settings.g.colormapSize || 2048);
    ui.loading(0.58, 'Building terrain…'); await tick();
    this.terrain = new Terrain(this.world, renderer.scene, this.colormap);
    this.water = new Water(renderer.scene, this.world, this.env);
    ui.loading(0.64, 'Building airports…'); await tick();
    this.airports = new AirportScenery(renderer.scene, this.world);
    this.scenery = new Scenery(this.world, renderer.scene, this.env);
    this.weather = new Weather(renderer.scene, this.env);
    ui.loading(0.72, 'Ground traffic…'); await tick();
    this.traffic = new AirportTraffic(renderer.scene, this.world);
    this.rescue = new RescueResponse(renderer.scene, this.world);
    this.missions = new MissionRunner(renderer.scene);
    this.landing = new LandingEvaluator();
    this.failures = new FailureManager();
    this.atc = new ATC();
    this.recorder = new Recorder(30);
    this.perf = new PerfMonitor(renderer, document.getElementById('fps'));
    ui.loading(0.78, 'Parking aircraft at the gates…'); await tick();
    this.buildParked();
    ui.loading(0.9, 'Preparing the showcase…'); await tick();
    this.setupInput();
    this.setupEvents();
    this.setupMenuScene();
    await this.terrain.preload(this.menuCamPos(), 50, () => {});
    this.scenery.preload(this.menuCamPos());
    ui.loading(1, 'Ready');
    await tick();
    ui.loadingDone();
    this.state = 'menu';
    ui.showMenu();
    requestAnimationFrame((t) => this.loop(t));
    window.__fs = this;    // debugging / automated tests
    window.__fsSettings = settings;
  }

  // ------------------------------------------------------------ parked aircraft
  buildParked() {
    this.parked = [];
    const max = settings.g.parkedAircraft;
    const cache = new Map();
    const get = (id) => { if (!cache.has(id)) cache.set(id, buildStaticAircraft(AIRCRAFT_BY_ID[id], { detail: 0.4, pbr: false })); return cache.get(id).clone(); };
    const plan = [];
    const jets = ['m738', 'rj90', 'm738', 'm787w', 'a740', 't3', 'm738', 'rj90', 'm787w', 'm738', 'commuter', 'rt72', 'm738', 'g750', 'rj90', 'a740'];
    const kp = AIRPORT_BY_ID.KPXR;
    kp.gates.forEach((g, i) => { if (g.bridge) plan.push([kp, g, jets[i % jets.length]]); else if (g.cargo) plan.push([kp, g, i % 2 ? 'a740' : 't3']); else if (g.ga) plan.push([kp, g, ['zephyr', 'duomax', 'vlj'][i % 3]]); });
    const others = { KMVL: ['rt72', 'rj90', 'commuter', 'm738'], KISL: ['rt72', 'm738', 'commuter'], KSKP: ['commuter', 'rj90', 'rt72'], KBRF: ['skylark', 'bushhawk', 'zephyr', 'swallow', 'skylark'] };
    for (const [icao, types] of Object.entries(others)) AIRPORT_BY_ID[icao].gates.forEach((g, i) => plan.push([AIRPORT_BY_ID[icao], g, types[i % types.length]]));
    // spread the budget across airports: interleave
    plan.sort((a, b) => (a[0].icao === 'KPXR' ? 0 : 1) - (b[0].icao === 'KPXR' ? 0 : 1) || Math.random() - 0.5);
    for (const [ap, g, id] of plan.slice(0, max)) {
      const spec = AIRCRAFT_BY_ID[id];
      const obj = get(id);
      const hdg = noseHeading(ap, g.nose) * DEG;
      const [gx, gz] = toWorld(ap, g.u, g.v);
      const desc = spec.model();
      const noseZ = desc.fuselage.stations[0][0];
      const stop = g.ga ? 3 : 10;
      const x = gx + Math.sin(hdg) * (stop + noseZ), z = gz - Math.cos(hdg) * (stop + noseZ);
      obj.position.set(x, this.world.surfaceAt(x, z) - desc.groundY, z);
      obj.rotation.y = -hdg;
      obj.traverse((o) => o.layers.set(LAYER_WORLD));
      this.renderer.scene.add(obj);
      this.parked.push({ obj, x, z, spec });
    }
  }

  // ------------------------------------------------------------ menu showcase
  menuCamPos() { return new THREE.Vector3(-1600, 30, 230); }
  setupMenuScene() {
    this.env.setTime(17.7); this.weather.set('fair');
    this.buildShowcase(settings.data.last.aircraft);
  }
  buildShowcase(id) {
    if (this.showcase) { this.renderer.scene.remove(this.showcase.root); this.showcase = null; }
    const spec = AIRCRAFT_BY_ID[id] || AIRCRAFT_BY_ID.skylark;
    const a = new Aircraft(spec, this.world, this.weather, this.renderer.scene);
    a.fm.placeOnGround(-1650, 150, 250);
    a.root.position.copy(a.fm.pos); a.root.quaternion.copy(a.fm.q);
    a.cockpit.group.visible = false; a.cockpit.cabin.visible = false;
    a.model.root.traverse((o) => o.layers.set(LAYER_WORLD));
    this.showcase = a;
    this.showcaseId = spec.id;
  }

  // ------------------------------------------------------------ spawn options
  spawnOptions(spec, ap) {
    const heli = spec.cat === 'heli';
    const big = spec.mass.mtow > 30000;
    const out = [];
    for (const s of spawnPoints(ap)) {
      if (s.kind === 'runway' && s.rw.surface === 'grass' && spec.mass.mtow > 3000) continue;
      if (s.kind === 'runway' && !heli && s.rw.len < (spec.perf.vr ? spec.perf.vr * 9 : 0)) continue;
      if (s.kind === 'gate' && heli) continue;
      if (s.kind === 'gate' && big && !(s.gate.bridge || s.gate.cargo)) continue;
      if (s.kind === 'gate' && !big && s.gate.cargo) continue;
      if (s.kind === 'helipad' && !heli) continue;
      out.push(s);
    }
    if (heli) {
      for (const r of ap.runways) { out.push(...spawnPoints(ap).filter((s) => s.kind === 'runway' && s.rw === r).slice(0, 1)); }
    }
    if (ap.runways.length || heli) {
      out.push({ kind: 'approach', label: heli ? 'In the air nearby (1,000 ft)' : 'On final approach (6 nm)' });
      out.push({ kind: 'overhead', label: 'Airborne overhead (3,000 ft AGL)' });
    }
    if (!out.length) out.push({ kind: 'overhead', label: 'Airborne overhead (3,000 ft AGL)' });
    return out;
  }

  // ------------------------------------------------------------ flight lifecycle
  quickFlight() {
    const l = settings.data.last;
    const spec = AIRCRAFT_BY_ID[l.aircraft] || AIRCRAFT_BY_ID.skylark;
    let ap = AIRPORT_BY_ID[l.airport] || AIRPORT_BY_ID.KPXR;
    const opts = this.spawnOptions(spec, ap);
    let idx = opts.findIndex((o) => o.kind === (spec.cat === 'heli' ? 'helipad' : 'runway'));
    if (idx < 0) { ap = spec.cat === 'heli' ? AIRPORT_BY_ID.KPXR : AIRPORT_BY_ID.KPXR; idx = 0; }
    this.startFlight({ aircraft: spec.id, airport: ap.icao, spawn: Math.max(0, idx), weather: l.weather || 'fair', time: l.time ?? 10.5, season: l.season || 'summer', fuel: settings.aircraftPref(spec.id).fuel, payload: settings.aircraftPref(spec.id).payload, running: true });
  }

  startMission(m) {
    const ap = AIRPORT_BY_ID[m.from];
    const spec = AIRCRAFT_BY_ID[m.aircraft];
    const opts = this.spawnOptions(spec, ap);
    const [kind, name] = m.spawn.split(':');
    let idx = opts.findIndex((o) => (o.kind === kind) && (o.label.endsWith(' ' + name) || (o.gate && o.gate.name === name)));
    if (idx < 0) idx = 0;
    this.startFlight({ aircraft: m.aircraft, airport: m.from, spawn: idx, weather: m.weather, time: m.time, season: 'summer', fuel: 0.6, payload: m.payload ?? 0.7, running: true, mission: m });
  }

  startChallenge(c) {
    this.startFlight({ aircraft: c.aircraft, airport: c.airport, weather: c.weather, wind: c.wind, time: c.time, season: c.weather === 'snow' ? 'winter' : 'summer', fuel: 0.4, payload: 0.6, running: true, challenge: c });
  }

  startLesson(l) {
    const s = l.spawn;
    const cfg = { aircraft: l.aircraft, airport: s.airport, weather: l.weather, time: l.time, season: 'summer', fuel: 0.6, payload: 0.4, running: true, lesson: l };
    if (s.challenge) cfg.challenge = { ...s.challenge, aircraft: l.aircraft, weather: l.weather, time: l.time };
    else if (s.air) cfg.air = s;
    else {
      const ap = AIRPORT_BY_ID[s.airport];
      const opts = this.spawnOptions(AIRCRAFT_BY_ID[l.aircraft], ap);
      cfg.spawn = Math.max(0, opts.findIndex((o) => o.kind === s.kind && o.label.endsWith(' ' + s.name)));
    }
    this.startFlight(cfg);
  }

  async startFlight(cfg) {
    this.flightCfg = cfg;
    this.state = 'loading';
    this.ui.hideMenu(); this.ui.hidePause(); this.ui.hideHud();
    document.getElementById('results').classList.add('hidden');
    this.ui.loading(0.05, 'Preparing aircraft…');
    await this.audio.init();
    await tick();
    if (this.showcase) { this.showcase.dispose(); this.showcase = null; }
    if (this.ac) { this.ac.dispose(); this.ac = null; }
    this.rescue.clear(); this.missions.clear(); this.replay = null; this.ui.replayBar(null);
    const spec = AIRCRAFT_BY_ID[cfg.aircraft];
    const ac = new Aircraft(spec, this.world, this.weather, this.renderer.scene);
    ac.fm.setLoad(cfg.payload ?? 0.7, cfg.fuel ?? 0.6);
    this.ac = ac;
    this.ui.loading(0.25, 'Setting weather and time…'); await tick();
    this.weather.set(cfg.weather || 'clear', cfg.wind ? { windDir: cfg.wind.windDir, wind: cfg.wind.wind, gust: cfg.wind.gust, turb: cfg.wind.turb } : {});
    this.env.setTime(cfg.time ?? 10.5);
    this.env.setSeason(cfg.season || 'summer');
    this.terrain.uniforms.uSnowLine.value = cfg.season === 'winter' ? 450 : cfg.season === 'autumn' || cfg.season === 'spring' ? 1500 : 2300;
    this.terrain.uniforms.uWet.value = this.weather.wetness;
    // spawn
    let ap = AIRPORT_BY_ID[cfg.airport] || AIRPORT_BY_ID.KPXR;
    let airborne = false;
    const fm = ac.fm;
    if (cfg.challenge) {
      const sp = challengeSpawn(cfg.challenge);
      const v = spec.cat === 'heli' ? 65 * KT : (spec.perf.vref || 80) * KT * 1.12;
      fm.placeInAir(sp.x, sp.y, sp.z, sp.hdg, v, spec.cat === 'heli' ? 2 : 2.5);
      ap = sp.ap; airborne = true;
      if (spec.cat !== 'heli') { fm.ctl.flapIndex = Math.max(0, spec.aero.flaps.length - 2); fm.flapDeg = spec.aero.flaps[fm.ctl.flapIndex].deg; }
      fm.ctl.gearDown = 1; fm.gearPos = 1;
      fm.ctl.throttle = fm.ctl.throttle.map(() => spec.cat === 'heli' ? 1 : 0.45);
      if (spec.cat === 'heli') fm.ctl.collective = 0.45;
      ac.dest = { x: sp.end.x, z: sp.end.z, icao: ap.icao };
    } else if (cfg.air) {
      const s = cfg.air;
      const a2 = AIRPORT_BY_ID[s.airport];
      ap = a2;
      fm.placeInAir(a2.x - 2500, a2.elev + s.alt * FT, a2.z + 2500, 45, s.speed * KT, 1);
      fm.ctl.gearDown = spec.retract ? 0 : 1; fm.gearPos = fm.ctl.gearDown;
      fm.ctl.throttle = fm.ctl.throttle.map(() => 0.7);
      airborne = true;
    } else {
      const opts = this.spawnOptions(spec, ap);
      const o = opts[clamp(cfg.spawn || 0, 0, opts.length - 1)];
      if (o.kind === 'approach' || o.kind === 'overhead') {
        airborne = true;
        if (o.kind === 'approach' && ap.runways.length && spec.cat !== 'heli') {
          const rw = this.atc.activeRunway(ap, this.weather);
          const sp = challengeSpawn({ airport: ap.icao, runway: rw.name, dist: 6 });
          fm.placeInAir(sp.x, sp.y, sp.z, sp.hdg, (spec.perf.vref || 80) * KT * 1.15, 2.5);
          fm.ctl.flapIndex = Math.max(0, spec.aero.flaps.length - 2); fm.flapDeg = spec.aero.flaps[fm.ctl.flapIndex].deg;
          fm.ctl.gearDown = 1; fm.gearPos = 1;
          fm.ctl.throttle = fm.ctl.throttle.map(() => 0.45);
          ac.dest = { x: sp.end.x, z: sp.end.z, icao: ap.icao };
        } else {
          const alt = o.kind === 'approach' ? 1000 : 3000;
          const v = spec.cat === 'heli' ? 80 * KT : Math.max((spec.perf.vref || 80) * 1.5, spec.perf.cruiseKt * 0.55) * KT;
          fm.placeInAir(ap.x - 3000, ap.elev + alt * FT, ap.z, 90, v, 1);
          fm.ctl.gearDown = spec.retract ? 0 : 1; fm.gearPos = fm.ctl.gearDown;
          fm.ctl.throttle = fm.ctl.throttle.map(() => spec.cat === 'heli' ? 1 : 0.7);
          if (spec.cat === 'heli') fm.ctl.collective = 0.55;
        }
      } else if (o.kind === 'gate') {
        const hdg = o.hdg * DEG;
        const noseZ = ac.model.shape.zNose - fm.cg.z;
        const stop = o.gate.ga ? 3 : 10;
        const x = o.x + Math.sin(hdg) * (stop + noseZ), z = o.z - Math.cos(hdg) * (stop + noseZ);
        fm.placeOnGround(x, z, o.hdg);
      } else if (o.kind === 'helipad') {
        fm.placeOnGround(o.x, o.z, o.hdg, o.roof ? o.roof : null);
      } else {
        fm.placeOnGround(o.x, o.z, o.hdg);
      }
    }
    // engines / systems
    if (airborne || cfg.running) ac.systems.setRunning(airborne);
    else ac.systems.setColdAndDark();
    fm.ctl.parking = !airborne;
    if (airborne && spec.cat === 'heli') { fm.omega = fm.omegaN; fm.nr = 1; }
    // hide parked aircraft we would overlap
    for (const p of this.parked) p.obj.visible = Math.hypot(p.x - fm.pos.x, p.z - fm.pos.z) > Math.max(30, spec.dims.span);
    // camera: seated pilot perspective by default
    this.camRig.setMode('cockpit', ac);
    this.camRig.resetLook();
    this.ui.loading(0.45, 'Loading scenery…'); await tick();
    await this.terrain.preload(fm.pos, airborne ? 300 : 2, (p) => this.ui.loading(0.45 + p * 0.25, 'Loading scenery…'));
    this.scenery.preload(fm.pos);
    this.ui.loading(0.75, 'Loading engine sounds…'); await tick();
    await this.audio.setAircraft(ac);
    // gameplay state
    this.landing.reset(); this.failures.reset(); this.recorder.reset();
    this.atc.reset(ac, ap);
    this.landedRes = null; this.emergencyLanding = null; this.crashT = 0; this.stoppedT = 0;
    this.lesson = null;
    this.fuelStart = fm.fuel;
    if (cfg.challenge && cfg.challenge.failure) { const f = cfg.challenge.failure; this.failures.schedule(f.type, f.after, f.engine ?? null); }
    if (cfg.mission) { this.missions.start(cfg.mission, ac); if (cfg.mission.to) ac.dest = { x: AIRPORT_BY_ID[cfg.mission.to].x, z: AIRPORT_BY_ID[cfg.mission.to].z, icao: cfg.mission.to }; }
    if (cfg.lesson) { this.lesson = { l: cfg.lesson, i: 0, st: {} }; if (cfg.lesson.failure) this.failures.schedule(cfg.lesson.failure.type, cfg.lesson.failure.after); this.showLessonStep(); }
    if (!ac.dest && !cfg.mission && !cfg.challenge) {
      // free flight: destination = nearest other airport for the ND / map
      let best = null, bd = 1e12;
      for (const a of AIRPORTS) { if (a === ap || a.type === 'offshore') continue; const d = Math.hypot(a.x - ap.x, a.z - ap.z); if (d < bd) { bd = d; best = a; } }
      if (best) ac.dest = { x: best.x, z: best.z, icao: best.icao };
    }
    this.ui.loading(1, 'Ready'); await tick();
    this.ui.loadingDone();
    this.ui.showHud();
    this.perf.reset();
    this.state = 'flight';
    this.paused = false;
    this.acc = 0;
    this.ui.toast(`${spec.name} — ${airborne ? 'airborne' : ap.name}`);
    if (!cfg.running && !airborne) this.ui.toast('Cold & dark: press I for the engine start sequence', 5000);
    if (spec.cat === 'heli' && !airborne) this.ui.toast('Raise the collective (R) slowly to lift off', 5000);
    this.audio.resume();
  }

  restartFlight() { if (this.flightCfg) this.startFlight(this.flightCfg); }

  toMenu() {
    this.ui.hidePause(); this.ui.hideHud(); this.ui.showTraining(null);
    document.getElementById('results').classList.add('hidden');
    if (this.ac) { this.ac.dispose(); this.ac = null; }
    this.audio.clearAircraft();
    this.audio.setSirens([]);
    this.rescue.clear(); this.missions.clear();
    this.replay = null; this.ui.replayBar(null);
    this.paused = false;
    this.state = 'menu';
    for (const p of this.parked) p.obj.visible = true;
    this.setupMenuScene();
    this.ui.showMenu();
  }

  setPaused(p) {
    if (this.state !== 'flight' && this.state !== 'replay') return;
    this.paused = p;
    if (p) { this.ui.showPause(); this.audio.suspend(); }
    else { this.ui.hidePause(); document.getElementById('dialog').classList.add('hidden'); this.audio.resume(); }
  }

  endFlight(reason = 'ended', extra = {}) {
    if (!this.ac) return;
    const ac = this.ac;
    const sum = summarize(this.recorder, ac, {
      from: this.flightCfg.airport, to: this.flightCfg.mission ? this.flightCfg.mission.to : '', mission: this.flightCfg.mission ? this.flightCfg.mission.title : this.flightCfg.challenge ? this.flightCfg.challenge.title : null,
      landings: this.landing.results.map((r) => ({ score: r.score, grade: r.grade, runway: r.runway, vs: r.vsFpm })),
      emergencies: this.failures.history, result: ac.fm.damage.crashed ? 'crashed' : reason, fuelUsed: this.fuelStart - ac.fm.fuel, rescue: extra.rescue || null,
    });
    saveLogEntry(sum);
    this.lastRecording = this.recorder;
    this.lastSpecId = ac.spec.id;
    this.recorder = new Recorder(30); this.recorder.reset();
    this.ui.hidePause();
    this.paused = true;
    this.audio.suspend();
    const lastLanding = this.landing.results[this.landing.results.length - 1];
    this.ui.showResults({ title: extra.title || 'Flight report', landing: lastLanding, summary: sum, rescue: extra.rescue, mission: extra.mission, emergency: this.failures.history.length > 0, crash: ac.fm.damage.crashed ? (ac.fm.damage.crashReason || 'impact') : null, canContinue: !ac.fm.damage.crashed && reason !== 'ended' });
  }

  canReplay() { return !!(this.lastRecording && this.lastRecording.n > 10) || !!(this.recorder && this.recorder.n > 10 && this.ac); }

  startReplay() {
    const rec = (this.lastRecording && this.lastRecording.n > 10) ? this.lastRecording : this.recorder;
    if (!rec || rec.n < 10) { this.ui.toast('Nothing to replay yet'); return; }
    const specId = this.lastSpecId || (this.ac && this.ac.spec.id);
    if (!this.ac || this.ac.spec.id !== specId) {
      if (this.ac) this.ac.dispose();
      this.ac = new Aircraft(AIRCRAFT_BY_ID[specId], this.world, this.weather, this.renderer.scene);
      this.ac.systems.setRunning(false);
      this.audio.setAircraft(this.ac);
    }
    this.ui.hideMenu(); this.ui.hidePause(); document.getElementById('results').classList.add('hidden');
    this.ui.showHud();
    this.replay = { rec, t: rec.start, duration: rec.duration + rec.start, playing: true, speed: 1, s: {} };
    this.state = 'replay'; this.paused = false;
    this.camRig.setMode('cinematic', this.ac);
    this.ui.replayBar(this.replay);
    this.audio.resume();
  }
  stopReplay() { this.replay = null; this.ui.replayBar(null); this.toMenu(); }

  applyGraphics() {
    const g = settings.g;
    this.env.configureShadows();
    this.renderer.camera.far = g.drawDistance; this.renderer.camera.updateProjectionMatrix();
    this.perf.apply();
  }

  // ------------------------------------------------------------ training
  showLessonStep() {
    const L = this.lesson;
    if (!L) return;
    this.ui.showTraining(L.l, L.i, () => this.nextLessonStep());
    this.highlightKind = L.l.steps[L.i].highlight || null;
  }
  nextLessonStep() {
    const L = this.lesson;
    if (!L) return;
    L.i++; L.st = {};
    if (L.i >= L.l.steps.length) { this.ui.showTraining(null); this.lesson = null; this.highlightKind = null; this.ui.toast('Lesson complete!'); return; }
    this.showLessonStep();
  }

  // ------------------------------------------------------------ input
  setupInput() {
    const A = (n, f) => input.on(n, () => { if (this.state === 'flight' && !this.paused && this.ac) f(this.ac); });
    A('gear', (ac) => ac.toggleGear());
    A('flapsUp', (ac) => ac.flaps(-1));
    A('flapsDown', (ac) => ac.flaps(1));
    A('parkingBrake', (ac) => { ac.fm.ctl.parking = !ac.fm.ctl.parking; this.ui.toast(ac.fm.ctl.parking ? 'Parking brake SET' : 'Parking brake released'); });
    A('spoilers', (ac) => ac.toggleSpoilers());
    A('reverse', (ac) => ac.toggleReverse());
    A('autopilot', (ac) => { ac.ap.engage(); this.ui.toast(ac.ap.engaged ? `Autopilot ON (${ac.ap.lat} / ${ac.ap.vert})` : 'Autopilot OFF'); this.ui.renderApPanel(); });
    A('apPanel', () => this.ui.toggleApPanel());
    A('engineStart', (ac) => {
      if (!ac.fm.onGround && this.failures.tryRelight(ac)) return;
      if (ac.fm.engines.every((e) => e.running)) { this.ui.toast('Engines already running'); return; }
      ac.systems.autoStart();
    });
    A('engineStop', (ac) => ac.systems.autoShutdown());
    A('landingLights', (ac) => { const L = ac.systems.lights; L.landing = !L.landing; this.ui.toast('Landing lights ' + (L.landing ? 'ON' : 'OFF')); });
    A('allLights', (ac) => { const L = ac.systems.lights; const on = !L.nav; L.nav = L.beacon = L.strobe = on; this.ui.toast('Nav / beacon / strobe ' + (on ? 'ON' : 'OFF')); });
    A('throttleFull', (ac) => ac.setThrottleAll(1));
    A('throttleIdle', (ac) => ac.setThrottleAll(0));
    A('hoist', (ac) => ac.toggleHoist());
    const V = (n, f) => input.on(n, () => { if ((this.state === 'flight' || this.state === 'replay') && this.ac) f(this.ac); });
    V('cameraNext', (ac) => this.camRig.next(ac, 1));
    V('cameraPrev', (ac) => this.camRig.next(ac, -1));
    V('cockpitView', (ac) => this.camRig.setMode('cockpit', ac));
    V('cabinView', (ac) => this.camRig.setMode('cabin', ac));
    V('chaseView', (ac) => this.camRig.setMode('chase', ac));
    V('sideView', (ac) => this.camRig.setMode('side', ac));
    V('cinematicView', (ac) => this.camRig.setMode('cinematic', ac));
    V('lookReset', () => this.camRig.resetLook());
    V('map', () => this.ui.toggleMap());
    V('hud', () => { settings.p.hud = !settings.p.hud; settings.save(); });
    V('help', () => this.ui.toggleHelp());
    V('atc', () => this.ui.toggleAtcPanel());
    input.on('pause', () => { if (this.state === 'flight') this.setPaused(!this.paused); });
    input.on('menu', () => {
      const dlg = document.getElementById('dialog');
      if (!dlg.classList.contains('hidden')) { this.ui.closeDialog(); return; }
      if (!document.getElementById('help').classList.contains('hidden')) { this.ui.toggleHelp(false); return; }
      if (!document.getElementById('map').classList.contains('hidden')) { this.ui.toggleMap(); return; }
      if (this.state === 'flight') this.setPaused(!this.paused);
      else if (this.state === 'replay') this.stopReplay();
    });
    bus.on('input:click', (e) => this.onClick(e));
    this.renderer.canvas.addEventListener('mousemove', () => { this.mouseMoved = true; });
    window.addEventListener('blur', () => { if (this.state === 'flight' && !this.paused) this.setPaused(true); });
  }

  pickCockpit(nx, ny) {
    if (!this.ac || this.camRig.effectiveMode !== 'cockpit') return null;
    const cam = this.renderer.camera;
    const near = cam.near;
    cam.near = 0.03; cam.updateProjectionMatrix();
    this.raycaster.setFromCamera({ x: nx, y: ny }, cam);
    this.raycaster.layers.set(LAYER_OWN);
    this.raycaster.far = 3;
    const hits = this.raycaster.intersectObject(this.ac.cockpit.group, true);
    cam.near = near; cam.updateProjectionMatrix();
    for (const h of hits) {
      if (h.object.material && h.object.material.transparent && !h.object.userData.click && !h.object.userData.tip) continue;
      if (h.object.name === 'shell' || h.object.name === 'glass') { if (h.object.name === 'shell') return null; continue; }
      return h.object;
    }
    return null;
  }

  onClick(e) {
    if (this.state !== 'flight' || this.paused) return;
    const obj = this.pickCockpit(e.nx, e.ny);
    if (obj && obj.userData.click) {
      obj.userData.click.onClick && obj.userData.click.onClick(e.button);
      this.audio.play('click', { volume: 0.5 });
      this.ui.renderApPanel();
    }
  }

  setupEvents() {
    bus.on('landing', (res) => {
      this.landedRes = res;
      this.recorder.event('landing', `${res.runway} ${res.grade} ${res.score}`);
      if (this.failures.active || (this.ac && this.ac.fm.damage.crashed)) return;   // emergency flow shows its own report
      if (this.flightCfg && this.flightCfg.mission) return;
      this.ui.toast(`Landing: ${res.grade} (${res.score}) — ${res.vsFpm} fpm`, 5000);
      setTimeout(() => { if (this.state === 'flight' && !this.paused) { this.paused = true; this.ui.showResults({ title: 'Landing results', landing: res, canContinue: true }); } }, 1500);
    });
    bus.on('emergency', (e) => { this.recorder.event('emergency', e.title); this.audio.play('chime', { volume: 0.6 }); });
    bus.on('rescue:dispatched', (d) => {
      this.ui.toast(d.onField ? `Emergency services dispatched from ${d.airport} (${d.units} vehicles)` : `Emergency services dispatched (${d.units} vehicles)`, 6000);
      this.atc.ctrl(`${this.atc.callsign}, emergency vehicles are on their way to your position. Remain in the aircraft, keep the engines shut down.`);
      this.camRig.setMode('orbit', this.ac);
      this.camRig.orbit.dist = Math.max(60, this.ac.spec.dims.length * 3);
      this.camRig.orbit.pitch = 0.35;
    });
    bus.on('rescue:complete', (r) => {
      this.ui.toast('Emergency response complete', 4000);
      setTimeout(() => this.endFlight('emergency landing', { title: this.ac && this.ac.fm.damage.crashed ? 'Crash — emergency response' : 'Emergency landing complete', rescue: r }), 2500);
    });
    bus.on('mission:complete', (m) => {
      this.ui.toast(`Mission complete: ${m.mission.title}`, 6000);
      setTimeout(() => this.endFlight('mission complete', { title: 'Mission complete', mission: m }), 2500);
    });
    bus.on('touchdown', (c) => { if (c.vsFpm > 400) this.camRig.addShake(Math.min(2, c.vsFpm / 400)); });
  }

  // ------------------------------------------------------------ main loop
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    input.pollGamepad();
    const mouse = input.consumeMouse();
    try {
      if (this.state === 'menu') this.frameMenu(dt, mouse);
      else if (this.state === 'flight') this.frameFlight(dt, mouse);
      else if (this.state === 'replay') this.frameReplay(dt, mouse);
      else if (this.state === 'loading') return;
    } catch (e) {
      console.error(e);
      if (!this.errShown) { this.errShown = true; this.ui.toast('Error: ' + e.message, 8000); }
    }
    this.perf.frame(dt, this.state === 'flight' && !this.paused);
  }

  frameMenu(dt, mouse) {
    const cam = this.renderer.camera;
    this.menuT = (this.menuT || 0) + dt * 0.06;
    const sc = this.showcase;
    if (settings.data.last.aircraft !== this.showcaseId && sc) this.buildShowcase(settings.data.last.aircraft);
    const target = this.showcase ? this.showcase.root.position : new THREE.Vector3(-1650, 20, 150);
    const size = this.showcase ? this.showcase.spec.dims.length : 20;
    const d = Math.max(16, size * 1.5);
    cam.position.set(target.x + Math.sin(this.menuT) * d, target.y + size * 0.18 + 2, target.z + Math.cos(this.menuT) * d);
    cam.lookAt(target.x, target.y + size * 0.05, target.z);
    cam.near = 0.5; cam.updateProjectionMatrix();
    this.renderer.cockpitMode = false;
    if (this.showcase) this.showcase.updateVisual(dt, 1, this.env, 'orbit');
    this.updateWorld(dt, cam.position, target);
    this.renderer.render();
  }

  updateWorld(dt, camPos, focus) {
    this.env.update(dt * 0, camPos, focus);
    this.env.shadowHalf = this.ac ? clamp(this.ac.spec.dims.span * 0.9, 25, 80) : 40;
    const agl = camPos.y - this.world.surfaceAt(camPos.x, camPos.z);
    this.terrain.update(camPos, agl);
    this.terrain.uniforms.uNight.value = 1 - clamp((this.env.sunElevation + 3) / 9, 0, 1);
    this.water.update(dt, camPos, this.weather.windKt * KT);
    this.scenery.update(dt, camPos);
    this.weather.update(dt, camPos, this.world);
    this.airports.update(dt, this.renderer.camera, this.env, this.weather, this.renderer);
    this.traffic.update(dt, camPos);
  }

  frameFlight(dt, mouse) {
    const ac = this.ac;
    if (!ac) return;
    const cam = this.renderer.camera;
    if (!this.paused) {
      // look / knobs
      const hovered = mouse.wheel && this.camRig.effectiveMode === 'cockpit' ? this.pickCockpit(input.mouse.nx, input.mouse.ny) : null;
      if (hovered && hovered.userData.click && hovered.userData.click.onWheel) { hovered.userData.click.onWheel(mouse.wheel); this.ui.renderApPanel(); mouse.wheel = 0; }
      this.camRig.handleMouse(mouse, input.mouse.buttons);
      ac.applyInput(dt, input, false);
      // fixed-step physics
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 10) { ac.step(PHYS_DT); this.acc -= PHYS_DT; steps++; }
      if (steps >= 10) this.acc = 0;
      // gameplay
      this.landing.update(dt, ac);
      this.failures.update(dt, ac);
      this.missions.update(dt, ac, this.world, this.landedRes);
      if (this.landedRes && this.missions.mission) this.landedRes = this.landedRes;   // kept for mission check this frame
      this.atc.update(dt, ac, this.weather);
      this.recorder.update(dt, ac);
      this.rescue.update(dt, ac, this.audio);
      this.emergencyFlow(dt, ac);
      if (this.lesson) {
        const L = this.lesson, s = L.l.steps[L.i];
        if (s && s.check && s.check(ac, L.st, dt)) this.nextLessonStep();
      }
      this.env.time = (this.env.time + dt / 3600) % 24;
    }
    const alpha = this.acc / PHYS_DT;
    ac.updateVisual(dt, this.paused ? 1 : alpha, this.env, this.camRig.effectiveMode || this.camRig.mode);
    this.camRig.update(dt, ac, this.env);
    // mission markers should not linger
    if (this.landedRes && !this.paused) this.landedRes = this.landedRes;
    this.updateWorld(dt, cam.position, ac.root.position);
    // instruments
    const d = ac.instrumentData(this.env, this.atc);
    if (this.camRig.effectiveMode === 'cockpit' || this.camRig.effectiveMode === 'cabin') ac.cockpit.update(dt, d, performance.now() / 1000);
    if (this.highlightKind) for (const g of ac.cockpit.gauges) { const s = g.userData.kind === this.highlightKind ? 1 + 0.12 * Math.abs(Math.sin(performance.now() / 250)) : 1; g.scale.setScalar(s); }
    this.audio.update(dt, ac, cam, this.camRig.effectiveMode, this.weather);
    this.ui.updateHud(ac, this.camRig.effectiveMode, dt);
    this.ui.drawMap(ac);
    // tooltips (cockpit hover) at ~10 Hz
    this.tipT = (this.tipT || 0) - dt;
    if (this.tipT <= 0 && this.mouseMoved) {
      this.tipT = 0.1; this.mouseMoved = false;
      const o = !input.mouse.buttons ? this.pickCockpit(input.mouse.nx, input.mouse.ny) : null;
      const r = this.renderer.canvas.getBoundingClientRect();
      this.ui.setTooltip(o && o.userData.tip ? o.userData.tip : null, input.mouse.x + r.left, input.mouse.y + r.top);
      this.renderer.canvas.style.cursor = o && o.userData.click ? 'pointer' : 'default';
    }
    this.renderer.render();
  }

  // Detects the end of an emergency (safe landing or crash) and dispatches the rescue response.
  emergencyFlow(dt, ac) {
    const fm = ac.fm;
    if (this.rescue.active) return;
    if (fm.damage.crashed) {
      this.crashT += dt;
      if (this.crashT > 2.5 && fm.telemetry.gs < 3) { this.rescue.dispatch(ac, 'crash'); this.ui.toast('CRASH — emergency services alerted', 6000); }
      return;
    }
    const emergency = this.failures.active || fm.damage.total > 0.3 || fm.engines.some((e) => e.fire && !e.extinguished);
    if (!emergency) return;
    if (fm.onGround && fm.telemetry.gs < 1.5 && fm.airTime === 0) {
      this.stoppedT += dt;
      if (this.stoppedT > 2.5) {
        if (this.failures.active) this.failures.active.landed = true;
        this.ui.toast('Aircraft stopped — EMERGENCY LANDING SUCCESSFUL', 6000);
        for (const e of fm.engines) if (e.fire) e.shutdown();
        this.rescue.dispatch(ac, this.failures.active ? this.failures.active.title : 'damage');
      }
    } else this.stoppedT = 0;
  }

  frameReplay(dt, mouse) {
    const rp = this.replay, ac = this.ac;
    if (!rp || !ac) return;
    if (rp.playing) rp.t = Math.min(rp.duration, rp.t + dt * rp.speed);
    if (rp.t >= rp.duration) rp.playing = false;
    const rec = rp.rec;
    const i = rec.indexAt(rp.t);
    const a = rec.sample(i, rp.s.a || (rp.s.a = {})), b = rec.sample(Math.min(rec.n - 1, i + 1), rp.s.b || (rp.s.b = {}));
    const k = b.t > a.t ? clamp((rp.t - a.t) / (b.t - a.t), 0, 1) : 0;
    const fm = ac.fm;
    fm.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    fm.q.set(a.qx, a.qy, a.qz, a.qw).slerp(new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw), k);
    fm.prevPos.copy(fm.pos); fm.prevQ.copy(fm.q);
    fm.vel.set((b.x - a.x) * 10, (b.y - a.y) * 10, (b.z - a.z) * 10);
    fm.gearPos = a.gear; fm.flapDeg = a.flap; fm.elevator = a.elev; fm.aileron = a.ail;
    for (const e of fm.engines) { e.n1 = a.n1; e.n2 = Math.max(0.6, a.n1 * 0.4 + 0.6); e.rpm = a.n1 * (e.rpmMax || e.propRpmMax || e.maxRpmN1 || 2400); e.visRpm = e.rpm; e.running = true; e.state = 'running'; e.torque = a.n1; }
    if (fm.isHeli) { fm.nr = a.nr; fm.omega = a.nr * fm.omegaN; }
    fm.telemetry.ias = a.ias; fm.telemetry.vs = a.vs; fm.telemetry.agl = fm.pos.y + fm.groundOffset - this.world.surfaceAt(fm.pos.x, fm.pos.z);
    fm.telemetry.heading = ((-new THREE.Euler().setFromQuaternion(fm.q, 'YXZ').y / DEG) % 360 + 360) % 360;
    fm.telemetry.gs = Math.hypot(fm.vel.x, fm.vel.z);
    this.camRig.handleMouse(mouse, input.mouse.buttons);
    ac.updateVisual(dt, 1, this.env, this.camRig.effectiveMode || 'chase');
    this.camRig.update(dt, ac, this.env);
    this.updateWorld(dt, this.renderer.camera.position, ac.root.position);
    const d = ac.instrumentData(this.env, this.atc);
    if (this.camRig.effectiveMode === 'cockpit') ac.cockpit.update(dt, d, performance.now() / 1000);
    this.audio.update(dt, ac, this.renderer.camera, this.camRig.effectiveMode, this.weather);
    if (rp.ui) { rp.ui.range.value = rp.t; const m = Math.floor((rp.t - rec.start) / 60), s = Math.floor((rp.t - rec.start) % 60); rp.ui.time.textContent = `${m}:${String(s).padStart(2, '0')} / ${Math.floor((rp.duration - rec.start) / 60)}:${String(Math.floor((rp.duration - rec.start) % 60)).padStart(2, '0')}`; }
    this.renderer.render();
  }
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
function fatal(msg) {
  const el = document.getElementById('loadtext');
  if (el) { el.textContent = msg; el.style.color = '#ff6a5a'; }
}

window.addEventListener('error', (e) => { console.error(e.error || e.message); });
const app = new App();
app.boot().catch((e) => { console.error(e); fatal('Failed to start: ' + (e && e.message)); });
