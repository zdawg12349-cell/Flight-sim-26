// User interface: menus, dialogs, HUD, overlays. Pure DOM, styled by styles/main.css.
import * as THREE from 'three';
import { settings, GRAPHICS_PRESETS, ACTION_LABELS } from '../core/settings.js';
import { input, keyLabel } from '../core/input.js';
import { bus } from '../core/events.js';
import { AIRCRAFT, AIRCRAFT_BY_ID, CATEGORIES } from '../aircraft/catalog.js';
import { AIRPORTS, AIRPORT_BY_ID, spawnPoints, runwayEnds, toWorld } from '../world/airportData.js';
import { WEATHER_PRESETS } from '../weather/weather.js';
import { MISSIONS, CHALLENGES } from '../gameplay/missions.js';
import { LESSONS } from '../gameplay/training.js';
import { FREQ_LABELS } from '../gameplay/emergency.js';
import { loadLog, clearLog } from '../gameplay/flightlog.js';
import { VIEW_LABELS } from '../render/camera.js';
import { buildAircraftModel } from '../aircraft/assemble.js';
import { clamp, KT, FT, FPM, NM, pad, wrap360 } from '../core/math.js';
import { WORLD_HALF, WORLD_SIZE } from '../world/worldgen.js';

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

const TIPS = [
  'Press H in flight for the complete list of controls.',
  'Hold the right mouse button and drag to look around the cockpit. Space re-centres the view.',
  'Simplified mode auto-coordinates the rudder and trims the aircraft when you release the stick.',
  'Press I to run the realistic engine start sequence when you start "cold & dark".',
  'In a helicopter, R/F move the collective. Lower it immediately if the engine fails!',
  'The PAPI lights beside the runway: two white and two red means you are on the glide path.',
  'Click switches, levers and buttons in the cockpit — most of them work.',
  'Emergencies are rare by default. Change the frequency under Settings → Gameplay.',
  'Press M for the moving map and ` (backtick) for the ATC radio panel.',
  'The autopilot APP mode flies the ILS approach down to minimums.',
];

export class UI {
  constructor(app) {
    this.app = app;
    this.toastEl = $('toast');
    this.alertsEl = $('alerts');
    this.hudVisible = settings.p.hud;
    this.helpVisible = false;
    this.ffSel = { aircraft: settings.data.last.aircraft, airport: settings.data.last.airport, spawn: 0, weather: settings.data.last.weather, time: settings.data.last.time, season: settings.data.last.season, wind: null, running: settings.p.startEnginesRunning };
    bus.on('toast', (m) => this.toast(m));
    bus.on('atc:msg', (m) => this.atcMsg(m));
    bus.on('emergency', (e) => this.showEmergency(e));
    bus.on('warning', () => this.refreshAlerts());
    bus.on('warningCleared', () => this.refreshAlerts());
    bus.on('mission:objective', (o) => this.missionObjective(o));
    bus.on('mission:progress', (t) => { const el = $('mission'); if (el && !el.classList.contains('hidden')) el.querySelector('.prog') && (el.querySelector('.prog').textContent = t); });
    bus.on('systems:step', (s) => this.toast(s, 1600));
    let tipI = 0;
    this.tipTimer = setInterval(() => { const t = $('loadtip'); if (t) t.textContent = TIPS[tipI++ % TIPS.length]; }, 3500);
    $('loadtip').textContent = TIPS[0];
    this.buildHelp();
  }

  // ---------------------------------------------------------------- loading
  loading(p, text) {
    $('loading').classList.remove('hidden');
    $('loadbar').style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    if (text) $('loadtext').textContent = text;
  }
  loadingDone() { $('loading').classList.add('hidden'); }

  // ---------------------------------------------------------------- toasts / alerts
  toast(msg, ms = 3200) {
    const d = h('div', {}, msg);
    d.style.animationDuration = ms + 'ms';
    this.toastEl.append(d);
    while (this.toastEl.children.length > 4) this.toastEl.firstChild.remove();
    setTimeout(() => d.remove(), ms);
  }
  refreshAlerts() {
    const ac = this.app.ac;
    this.alertsEl.innerHTML = '';
    if (!ac) return;
    for (const w of ac.systems.activeWarnings().slice(0, 3)) this.alertsEl.append(h('div', { class: 'alert ' + (w.level === 'warning' ? '' : 'caution') }, w.text));
  }
  showEmergency(e) {
    const el = $('emergency');
    el.innerHTML = '';
    el.append(h('h2', {}, '⚠ ' + e.title), h('p', {}, e.text));
    const row = h('div', { class: 'chips', style: 'justify-content:center' });
    row.append(h('button', { class: 'btn2 danger', onclick: () => { this.app.atc.declareEmergency(this.app.ac, this.app.weather, 'MAYDAY'); el.classList.add('hidden'); } }, 'Declare MAYDAY'));
    if (e.type === 'fire') row.append(h('button', { class: 'btn2', onclick: () => { this.app.ac.systems.pullFireHandle(e.engine); el.classList.add('hidden'); } }, `Pull fire handle ${e.engine + 1}`));
    row.append(h('button', { class: 'btn2', onclick: () => el.classList.add('hidden') }, 'Continue'));
    el.append(row);
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 20000);
    this.app.ac.failure = e;
  }

  // ---------------------------------------------------------------- main menu
  showMenu() {
    const el = $('menu');
    el.innerHTML = '';
    const spec = AIRCRAFT_BY_ID[this.ffSel.aircraft] || AIRCRAFT[0];
    const left = h('div', { class: 'left' },
      h('h1', { class: 'title' }, 'FLIGHT SIM ', h('span', {}, '26')),
      h('div', { class: 'subtitle' }, '21 aircraft · real physics · living world'),
      this.menuBtn('Quick flight', 'Take off right away in the selected aircraft', () => this.app.quickFlight(), true),
      this.menuBtn('Free flight', 'Choose aircraft, airport, weather and time', () => this.showFreeFlight()),
      this.menuBtn('Missions', 'Passenger runs, rescue, offshore, heavy lift…', () => this.showList('missions')),
      this.menuBtn('Landing challenges', 'Crosswinds, storms, fog, engine-out', () => this.showList('challenges')),
      this.menuBtn('Training', 'Step-by-step lessons for beginners', () => this.showList('training')),
      this.menuBtn('Flight log & replay', 'Your flights, landings and statistics', () => this.showLog()),
      this.menuBtn('Settings', 'Graphics, audio, controls, gameplay', () => this.showSettings()),
      this.menuBtn('About & credits', 'Licences and attribution', () => this.showAbout()),
      h('div', { class: 'foot' }, 'Original aircraft designs, procedural world. Engine sounds: FlightGear community recordings (GPL-2.0).', h('br'), 'Best in Chrome / Edge. Press H in flight for controls.'),
    );
    el.append(left, h('div', { class: 'showcase' }, h('div', { class: 'name' }, spec.name), h('div', { class: 'role' }, spec.role)));
    el.classList.remove('hidden');
    $('hud').classList.add('hidden');
  }
  menuBtn(label, sub, fn, primary) { return h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: () => { this.app.audio.init(); fn(); } }, label, h('small', {}, sub)); }
  hideMenu() { $('menu').classList.add('hidden'); }

  dialog(title, body, footer = []) {
    const el = $('dialog');
    el.innerHTML = '';
    const d = h('div', { class: 'panel dialog' },
      h('header', {}, h('h2', {}, title), h('button', { class: 'close', onclick: () => this.closeDialog() }, '×')),
      h('div', { class: 'body' }, body),
      footer.length ? h('footer', {}, ...footer) : null);
    el.append(d);
    el.classList.remove('hidden');
    return d;
  }
  closeDialog() {
    $('dialog').classList.add('hidden');
    $('dialog').innerHTML = '';
    if (this.previewR) { this.previewActive = false; }
    if (this.app.state === 'menu') this.showMenu();
    else if (this.app.paused) this.showPause();
  }

  // ---------------------------------------------------------------- aircraft preview (separate small renderer)
  ensurePreview(container) {
    if (!this.previewR) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.previewR = r;
      const s = new THREE.Scene();
      s.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3428, 1.6));
      const sun = new THREE.DirectionalLight(0xfff2e0, 2.6); sun.position.set(30, 40, -25); s.add(sun);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(120, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a313b, roughness: 0.9 }));
      s.add(floor);
      const pm = new THREE.PMREMGenerator(r);
      const envS = new THREE.Scene(); envS.background = new THREE.Color(0x8fa6bf);
      s.environment = pm.fromScene(envS).texture;
      this.previewScene = s; this.previewFloor = floor;
      this.previewCam = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
      const loop = () => {
        requestAnimationFrame(loop);
        if (!this.previewActive || !this.previewModel) return;
        this.previewAngle = (this.previewAngle || 0.9) + 0.004;
        const b = this.previewSize;
        const c = this.previewCam;
        c.position.set(Math.sin(this.previewAngle) * b * 1.6, b * 0.36, Math.cos(this.previewAngle) * b * 1.6);
        c.lookAt(0, 0, 0);
        this.previewR.render(this.previewScene, c);
      };
      loop();
    }
    container.innerHTML = '';
    container.append(this.previewR.domElement);
    const rect = container.getBoundingClientRect();
    const w = Math.max(200, rect.width), hh = Math.max(180, rect.height);
    this.previewR.setSize(w, hh);
    this.previewCam.aspect = w / hh; this.previewCam.updateProjectionMatrix();
    this.previewActive = true;
  }
  setPreviewAircraft(spec) {
    if (this.previewModel) { this.previewScene.remove(this.previewModel.root); this.previewModel.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const m = buildAircraftModel(spec, { detail: 0.7, pbr: true });
    for (const k of ['strobeL', 'strobeR', 'beaconTop', 'beaconBottom']) if (m.lights[k]) m.lights[k].visible = false;
    m.root.position.y = -m.desc.groundY;
    this.previewScene.add(m.root);
    this.previewModel = m;
    const sz = m.bounds.getSize(new THREE.Vector3());
    this.previewSize = Math.max(sz.x, sz.z) * 1.05;
    this.previewFloor.position.y = 0;
  }

  // ---------------------------------------------------------------- free flight
  showFreeFlight() {
    this.hideMenu();
    const sel = this.ffSel;
    const list = h('div', { class: 'list' });
    for (const cat of CATEGORIES) {
      list.append(h('div', { class: 'cat' }, cat.label));
      for (const a of AIRCRAFT.filter((x) => x.cat === cat.id)) {
        list.append(h('div', { class: 'item' + (a.id === sel.aircraft ? ' sel' : ''), 'data-id': a.id, onclick: (e) => { sel.aircraft = a.id; list.querySelectorAll('.item').forEach((n) => n.classList.toggle('sel', n.dataset.id === a.id)); updateAc(); updateSpawns(); } }, h('b', {}, a.name), h('span', {}, a.role)));
      }
    }
    const preview = h('div', { class: 'preview', style: 'height:300px' });
    const specs = h('div', {});
    const desc = h('p', { class: 'muted small', style: 'line-height:1.5;margin:10px 0 0' });
    const updateAc = () => {
      const a = AIRCRAFT_BY_ID[sel.aircraft];
      this.setPreviewAircraft(a);
      desc.textContent = a.desc;
      const p = a.perf;
      const rows = [
        ['Type', a.role], ['Engines', a.engines.label], ['Passengers', a.pax], ['Crew', a.crew],
        ['Length', a.dims.length + ' m'], [a.cat === 'heli' ? 'Rotor diameter' : 'Wingspan', a.dims.span + ' m'],
        ['Max take-off weight', (a.mass.mtow / 1000).toFixed(1) + ' t'], ['Cruise speed', p.cruiseKt + ' kt'],
        ['Ceiling', p.ceilingFt.toLocaleString() + ' ft'], ['Range', p.rangeNm.toLocaleString() + ' nm'],
        [a.cat === 'heli' ? 'Vne' : 'Rotate / Vref', a.cat === 'heli' ? p.vneKt + ' kt' : `${p.vr} / ${p.vref} kt`], ['Autopilot', a.systems.autopilot],
      ];
      specs.innerHTML = '';
      specs.append(h('div', { class: 'specs' }, rows.map(([k, v]) => h('div', {}, h('b', {}, k), h('span', {}, String(v))))));
    };
    // airport & spawn
    const apSel = h('select', { onchange: () => { sel.airport = apSel.value; sel.spawn = 0; updateSpawns(); } }, AIRPORTS.map((a) => h('option', { value: a.icao, selected: a.icao === sel.airport }, `${a.icao} — ${a.name}`)));
    const spSel = h('select', { onchange: () => { sel.spawn = +spSel.value; } });
    const apDesc = h('p', { class: 'muted small', style: 'margin:6px 0 0;line-height:1.45' });
    const updateSpawns = () => {
      const a = AIRCRAFT_BY_ID[sel.aircraft], ap = AIRPORT_BY_ID[sel.airport];
      apDesc.textContent = ap.desc;
      const opts = this.app.spawnOptions(a, ap);
      spSel.innerHTML = '';
      opts.forEach((o, i) => spSel.append(h('option', { value: i, selected: i === sel.spawn }, o.label)));
      if (sel.spawn >= opts.length) sel.spawn = 0;
    };
    // weather & time
    const wx = h('div', { class: 'chips' });
    for (const [k, w] of Object.entries(WEATHER_PRESETS)) wx.append(h('button', { class: 'chip' + (k === sel.weather ? ' sel' : ''), 'data-k': k, onclick: () => { sel.weather = k; sel.wind = null; wx.querySelectorAll('.chip').forEach((c) => c.classList.toggle('sel', c.dataset.k === k)); syncWind(); } }, w.label));
    const tOut = h('output', {});
    const tIn = h('input', { type: 'range', min: 0, max: 23.9, step: 0.1, value: sel.time, oninput: () => { sel.time = +tIn.value; tOut.textContent = fmtTime(sel.time); } });
    tOut.textContent = fmtTime(sel.time);
    const season = h('select', { onchange: () => { sel.season = season.value; } }, ['spring', 'summer', 'autumn', 'winter'].map((s) => h('option', { value: s, selected: s === sel.season }, s[0].toUpperCase() + s.slice(1))));
    const wDir = h('input', { type: 'range', min: 0, max: 359, step: 1 }), wSpd = h('input', { type: 'range', min: 0, max: 45, step: 1 }), wGst = h('input', { type: 'range', min: 0, max: 60, step: 1 }), turb = h('input', { type: 'range', min: 0, max: 1, step: 0.05 });
    const oDir = h('output'), oSpd = h('output'), oGst = h('output'), oTurb = h('output');
    const syncWind = () => {
      const p = WEATHER_PRESETS[sel.weather];
      const w = sel.wind || { windDir: p.windDir, wind: p.wind, gust: Math.max(p.wind, p.gust), turb: p.turb };
      wDir.value = w.windDir; wSpd.value = w.wind; wGst.value = w.gust; turb.value = w.turb;
      oDir.textContent = pad(w.windDir, 3) + '°'; oSpd.textContent = w.wind + ' kt'; oGst.textContent = w.gust + ' kt'; oTurb.textContent = Math.round(w.turb * 100) + '%';
    };
    for (const el of [wDir, wSpd, wGst, turb]) el.addEventListener('input', () => { sel.wind = { windDir: +wDir.value, wind: +wSpd.value, gust: Math.max(+wSpd.value, +wGst.value), turb: +turb.value }; syncWind(); });
    syncWind();
    const fuel = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: settings.aircraftPref(sel.aircraft).fuel });
    const payload = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: settings.aircraftPref(sel.aircraft).payload });
    const oFuel = h('output', {}, Math.round(fuel.value * 100) + '%'), oPay = h('output', {}, Math.round(payload.value * 100) + '%');
    fuel.oninput = () => { oFuel.textContent = Math.round(fuel.value * 100) + '%'; };
    payload.oninput = () => { oPay.textContent = Math.round(payload.value * 100) + '%'; };
    const running = h('input', { type: 'checkbox', checked: sel.running });
    const emerg = h('select', { onchange: () => { settings.p.emergencyFrequency = emerg.value; settings.save(); } }, Object.entries(FREQ_LABELS).map(([k, v]) => h('option', { value: k, selected: k === settings.p.emergencyFrequency }, v)));
    const field = (label, out, ctl) => h('div', { class: 'field' }, h('label', {}, label, out || ''), ctl);
    const body = h('div', { class: 'ff' },
      h('div', { style: 'display:flex;flex-direction:column;min-height:0' }, h('h3', {}, 'Aircraft'), list),
      h('div', { style: 'overflow:auto' }, preview, desc, specs),
      h('div', { style: 'overflow:auto' },
        h('h3', {}, 'Departure'), field('Airport', null, apSel), apDesc, field('Start position', null, spSel),
        h('h3', {}, 'Conditions'), wx, h('div', { style: 'height:8px' }), field('Time of day', tOut, tIn), field('Season', null, season),
        field('Wind from', oDir, wDir), field('Wind speed', oSpd, wSpd), field('Gusts', oGst, wGst), field('Turbulence', oTurb, turb),
        h('h3', {}, 'Load & options'), field('Fuel', oFuel, fuel), field('Payload (passengers / cargo)', oPay, payload),
        h('label', { class: 'toggle' }, 'Engines running (off = cold & dark)', running), field('Random emergencies', null, emerg)));
    const go = h('button', { class: 'btn2 go', onclick: () => {
      const pref = settings.aircraftPref(sel.aircraft); pref.fuel = +fuel.value; pref.payload = +payload.value;
      Object.assign(settings.data.last, { aircraft: sel.aircraft, airport: sel.airport, weather: sel.weather, time: sel.time, season: sel.season });
      settings.p.startEnginesRunning = running.checked; settings.save();
      $('dialog').classList.add('hidden'); this.previewActive = false;
      this.app.startFlight({ aircraft: sel.aircraft, airport: sel.airport, spawn: sel.spawn, weather: sel.weather, wind: sel.wind, time: sel.time, season: sel.season, fuel: +fuel.value, payload: +payload.value, running: running.checked });
    } }, 'Fly now ✈');
    this.dialog('Free flight', body, [h('span', { class: 'muted small', style: 'margin-right:auto' }, 'Tip: hover over cockpit instruments for explanations.'), h('button', { class: 'btn2', onclick: () => this.closeDialog() }, 'Back'), go]);
    this.ensurePreview(preview);
    updateAc(); updateSpawns();
  }

  // ---------------------------------------------------------------- missions / challenges / training lists
  showList(kind) {
    this.hideMenu();
    const cards = h('div', { class: 'cards' });
    if (kind === 'missions') {
      for (const m of MISSIONS) cards.append(h('div', { class: 'card', onclick: () => this.brief(m, 'mission') }, h('h4', {}, m.title), h('p', {}, m.brief), h('div', { class: 'meta' }, `${AIRCRAFT_BY_ID[m.aircraft].name} · ${m.from}${m.to ? ' → ' + m.to : ''}`)));
      this.dialog('Missions', cards);
    } else if (kind === 'challenges') {
      for (const c of CHALLENGES) cards.append(h('div', { class: 'card', onclick: () => this.brief(c, 'challenge') }, h('h4', {}, h('span', { class: 'lvl ' + c.level }, c.level), c.title), h('p', {}, c.brief), h('div', { class: 'meta' }, `${AIRCRAFT_BY_ID[c.aircraft].name} · ${c.airport} RWY ${c.runway}`)));
      this.dialog('Landing challenges', cards);
    } else {
      for (const l of LESSONS) cards.append(h('div', { class: 'card', onclick: () => { $('dialog').classList.add('hidden'); this.app.startLesson(l); } }, h('h4', {}, l.title), h('p', {}, l.desc), h('div', { class: 'meta' }, AIRCRAFT_BY_ID[l.aircraft].name)));
      this.dialog('Training', cards);
    }
  }
  brief(m, kind) {
    const a = AIRCRAFT_BY_ID[m.aircraft];
    const body = h('div', { style: 'max-width:720px' },
      h('h3', {}, kind === 'mission' ? 'Briefing' : `${m.level} challenge`),
      h('p', { style: 'line-height:1.6;font-size:15px' }, m.brief),
      h('div', { class: 'specs' },
        h('div', {}, h('b', {}, 'Aircraft'), h('span', {}, a.name)),
        h('div', {}, h('b', {}, kind === 'mission' ? 'Departure' : 'Airport'), h('span', {}, AIRPORT_BY_ID[m.from || m.airport].name)),
        m.to ? h('div', {}, h('b', {}, 'Destination'), h('span', {}, AIRPORT_BY_ID[m.to].name)) : null,
        h('div', {}, h('b', {}, 'Weather'), h('span', {}, WEATHER_PRESETS[m.weather].label)),
        h('div', {}, h('b', {}, 'Time'), h('span', {}, fmtTime(m.time))),
      ),
      m.objectives ? h('div', {}, h('h3', {}, 'Objectives'), h('ol', {}, m.objectives.map((o) => h('li', {}, this.app.missions.label(o))))) : null);
    this.dialog(m.title, body, [h('button', { class: 'btn2', onclick: () => this.showList(kind === 'mission' ? 'missions' : 'challenges') }, 'Back'), h('button', { class: 'btn2 go', onclick: () => { $('dialog').classList.add('hidden'); kind === 'mission' ? this.app.startMission(m) : this.app.startChallenge(m); } }, 'Start')]);
  }

  // ---------------------------------------------------------------- settings
  showSettings(tab = 'graphics') {
    if (this.app.state === 'menu') this.hideMenu();
    $('pause').classList.add('hidden');
    const tabs = h('div', { class: 'tabs' });
    const body = h('div', {});
    const names = { graphics: 'Graphics', audio: 'Audio', controls: 'Controls', gameplay: 'Gameplay' };
    const show = (t) => { tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('sel', b.dataset.t === t)); body.innerHTML = ''; body.append(this['settings_' + t]()); };
    for (const [k, v] of Object.entries(names)) tabs.append(h('button', { class: 'tab', 'data-t': k, onclick: () => show(k) }, v));
    const d = this.dialog('Settings', body, [h('button', { class: 'btn2', onclick: () => { settings.reset(); show(tab); this.toast('Settings reset to defaults'); } }, 'Reset all'), h('button', { class: 'btn2 go', onclick: () => { settings.saveNow(); this.closeDialog(); } }, 'Done')]);
    d.querySelector('header').insertBefore(tabs, d.querySelector('header .close'));
    show(tab);
  }
  slider(label, obj, key, min, max, step, fmt = (v) => v, onchange) {
    const out = h('output', {}, fmt(obj[key]));
    const inp = h('input', { type: 'range', min, max, step, value: obj[key], oninput: () => { obj[key] = +inp.value; out.textContent = fmt(obj[key]); settings.save(); onchange && onchange(obj[key]); } });
    return h('div', { class: 'field' }, h('label', {}, label, out), inp);
  }
  check(label, obj, key, onchange) {
    const c = h('input', { type: 'checkbox', checked: !!obj[key], onchange: () => { obj[key] = c.checked; settings.save(); onchange && onchange(c.checked); } });
    return h('label', { class: 'toggle' }, label, c);
  }
  settings_graphics() {
    const g = settings.g;
    const presets = h('div', { class: 'chips' });
    for (const [k, p] of Object.entries(GRAPHICS_PRESETS)) presets.append(h('button', { class: 'chip' + (g.preset === k ? ' sel' : ''), onclick: () => { settings.applyPreset(k); this.app.applyGraphics(); this.showSettings('graphics'); this.toast(`Graphics preset: ${p.label}. Some changes apply fully after reloading.`); } }, p.label));
    const apply = () => this.app.applyGraphics();
    return h('div', {},
      h('h3', {}, 'Preset'), presets,
      h('p', { class: 'muted small' }, 'Low: weak Chromebooks · Medium: balanced (older laptops) · High: more detail & shadows · Ultra: strong GPUs.'),
      h('div', { class: 'grid2' },
        h('div', {},
          this.check('Adaptive quality (auto-adjust to keep FPS)', g, 'autoQuality'),
          this.slider('Target FPS', g, 'targetFps', 30, 60, 5, (v) => v),
          this.slider('Render resolution', g, 'renderScale', 0.5, 1, 0.05, (v) => Math.round(v * 100) + '%', apply),
          this.slider('Field of view', g, 'fov', 45, 90, 1, (v) => v + '°'),
          this.check('Show FPS / performance overlay', g, 'showFps'),
          this.check('Shadows', g, 'shadows', apply),
          this.check('Physically based aircraft materials', g, 'pbr')),
        h('div', {},
          this.slider('Draw distance', g, 'drawDistance', 15000, 70000, 1000, (v) => Math.round(v / 1000) + ' km', apply),
          this.slider('Terrain detail', g, 'terrainDetail', 0.4, 1.4, 0.05, (v) => v.toFixed(2)),
          this.slider('Tree density', g, 'treeDensity', 0.1, 1.4, 0.05, (v) => v.toFixed(2)),
          this.slider('Tree distance', g, 'treeRadius', 800, 7000, 100, (v) => (v / 1000).toFixed(1) + ' km'),
          this.slider('Building distance', g, 'buildingRadius', 2000, 20000, 500, (v) => (v / 1000).toFixed(1) + ' km'),
          this.slider('Cloud detail', g, 'cloudPuffs', 100, 2500, 50, (v) => v),
          this.slider('Rain / snow particles', g, 'precipCount', 300, 12000, 100, (v) => v),
          this.slider('Cockpit display refresh', g, 'displayHz', 4, 30, 1, (v) => v + ' Hz'))));
  }
  settings_audio() {
    const a = settings.a;
    const ap = () => bus.emit('settings:audio', a);
    return h('div', { class: 'grid2' },
      h('div', {},
        this.slider('Master volume', a, 'master', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', ap),
        this.slider('Engines & rotors', a, 'engine', 0, 1.5, 0.01, (v) => Math.round(v * 100) + '%', ap),
        this.slider('Environment (wind, rain, sirens)', a, 'environment', 0, 1.5, 0.01, (v) => Math.round(v * 100) + '%', ap),
        this.slider('Cockpit alerts & callouts', a, 'cockpit', 0, 1.5, 0.01, (v) => Math.round(v * 100) + '%', ap),
        this.slider('Interface', a, 'ui', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', ap)),
      h('div', {},
        this.check('Mute all', a, 'muted', ap),
        this.check('Spoken ATC (speech synthesis)', a, 'atcVoice'),
        this.check('GPWS altitude callouts', a, 'gpws'),
        h('p', { class: 'muted small', style: 'line-height:1.5' }, 'Engine sounds are layered recordings of real engines (see credits), re-pitched continuously from the simulated N1 / N2 / RPM / rotor speed so they stay in sync with the instruments and spinning parts.')));
  }
  settings_controls() {
    const c = settings.c, as = settings.p.assists;
    const mode = h('div', { class: 'chips' },
      ['simplified', 'advanced'].map((m) => h('button', { class: 'chip' + (c.mode === m ? ' sel' : ''), onclick: () => { c.mode = m; settings.save(); this.showSettings('controls'); } }, m === 'simplified' ? 'Simplified (assists)' : 'Advanced (raw)')));
    const binds = h('div', {});
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      const keys = c.bindings[action] || [];
      const btn = (i) => {
        const b = h('button', { onclick: () => {
          b.textContent = 'press a key…'; b.classList.add('cap');
          input.capture = (code) => {
            if (code === 'Escape') { keys.splice(i, 1); } else { keys[i] = code; }
            c.bindings[action] = keys.filter(Boolean); settings.save(); input.rebuild(); this.showSettings('controls');
          };
        } }, keys[i] ? keyLabel(keys[i]) : '—');
        return b;
      };
      binds.append(h('div', { class: 'bind' }, h('span', {}, label), btn(0), btn(1)));
    }
    return h('div', {},
      h('h3', {}, 'Control mode'), mode,
      h('div', { class: 'grid2', style: 'margin-top:12px' },
        h('div', {},
          h('h3', {}, 'Assists (simplified mode)'),
          this.check('Auto rudder / turn coordination', as, 'autoRudder'),
          this.check('Auto trim (holds attitude when released)', as, 'autoTrim'),
          this.check('Stall protection', as, 'stallProtection'),
          this.check('Helicopter stability (SAS, auto anti-torque)', as, 'heliStability')),
        h('div', {},
          h('h3', {}, 'Feel'),
          this.check('Invert pitch', c, 'invertPitch'),
          this.slider('Mouse look sensitivity', c, 'mouseSensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2)),
          this.slider('Keyboard control rate', c, 'keyboardRate', 0.4, 2, 0.05, (v) => v.toFixed(2)),
          this.check('Mouse flies the aircraft in outside views (hold left button)', c, 'mouseYoke'),
          this.check('Gamepad / joystick', c, 'gamepad'))),
      h('h3', {}, 'Key bindings'), h('p', { class: 'muted small' }, 'Click a slot and press a key (Shift combinations allowed). Escape clears the slot.'),
      binds, h('button', { class: 'btn2', style: 'margin-top:10px', onclick: () => { settings.resetBindings(); input.rebuild(); this.showSettings('controls'); } }, 'Reset key bindings'));
  }
  settings_gameplay() {
    const p = settings.p;
    const emerg = h('select', { onchange: () => { p.emergencyFrequency = emerg.value; settings.save(); } }, Object.entries(FREQ_LABELS).map(([k, v]) => h('option', { value: k, selected: k === p.emergencyFrequency }, v)));
    return h('div', { class: 'grid2' },
      h('div', {},
        h('div', { class: 'field' }, h('label', {}, 'Random emergencies'), emerg),
        h('p', { class: 'muted small', style: 'line-height:1.5' }, 'Failures only happen in the air (above 400 ft) and have real effects: engines lose power or catch fire, hydraulics or electrics fail, gear can jam. Land safely and the airport emergency services respond.'),
        this.check('Start with engines running', p, 'startEnginesRunning'),
        this.check('Crash detection', p, 'crashDetection')),
      h('div', {},
        h('div', { class: 'field' }, h('label', {}, 'Start view'), (() => { const sv = h('select', { onchange: () => { p.startView = sv.value; settings.save(); } }, [['cockpit', 'Cockpit (seated pilot)'], ['chase', 'Chase camera (3rd person)']].map(([k, v]) => h('option', { value: k, selected: k === (p.startView || 'cockpit') }, v))); return sv; })()),
        h('p', { class: 'muted small', style: 'line-height:1.5' }, 'The cockpit is only built the first time you look inside, so flying from the outside views costs nothing extra.'),
        this.check('Flight information overlay (U)', p, 'hud'),
        this.check('On-screen control hints', p, 'trainingHints'),
        this.check('ATC text messages', p, 'atcText')));
  }

  // ---------------------------------------------------------------- flight log
  showLog() {
    this.hideMenu();
    const log = loadLog();
    const body = h('div', {});
    const chart = h('canvas', { width: 1000, height: 220, style: 'width:100%;height:200px;background:rgba(0,0,0,.25);border-radius:8px;margin-bottom:10px' });
    const detail = h('div', {});
    const showEntry = (e) => {
      const x = chart.getContext('2d');
      x.clearRect(0, 0, 1000, 220);
      const pr = e.profile || [];
      if (pr.length > 1) {
        const tMax = pr[pr.length - 1][0] || 1, aMax = Math.max(1000, ...pr.map((p) => p[1]));
        x.strokeStyle = 'rgba(255,255,255,.1)'; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(40, 20 + i * 45); x.lineTo(990, 20 + i * 45); x.stroke(); }
        x.fillStyle = '#98a6b5'; x.font = '12px sans-serif';
        for (let i = 0; i <= 4; i++) x.fillText(Math.round(aMax * (1 - i / 4)) + ' ft', 2, 24 + i * 45);
        x.strokeStyle = '#f0a828'; x.lineWidth = 2; x.beginPath();
        pr.forEach((p, i) => { const X = 40 + p[0] / tMax * 950, Y = 200 - p[1] / aMax * 180; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke();
        x.strokeStyle = '#38c6d9'; x.lineWidth = 1.5; x.beginPath();
        const sMax = Math.max(50, ...pr.map((p) => p[2]));
        pr.forEach((p, i) => { const X = 40 + p[0] / tMax * 950, Y = 200 - p[2] / sMax * 180; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke();
        x.fillStyle = '#f0a828'; x.fillText('altitude', 900, 14); x.fillStyle = '#38c6d9'; x.fillText('airspeed', 840, 14);
      }
      detail.innerHTML = '';
      detail.append(h('div', { class: 'statgrid' },
        stat(e.durationMin + ' min', 'Duration'), stat(e.distanceNm + ' nm', 'Distance'), stat(e.maxAltFt.toLocaleString() + ' ft', 'Max altitude'), stat(e.maxIasKt + ' kt', 'Max airspeed'),
        stat(e.maxG + ' g', 'Max load'), stat((e.fuelUsedKg || 0) + ' kg', 'Fuel used'), stat(e.landings.length ? e.landings.map((l) => l.score).join(', ') : '—', 'Landing scores'), stat(e.emergencies.length ? e.emergencies.map((x) => x.title).join(', ') : 'None', 'Emergencies')));
    };
    if (!log.length) body.append(h('p', { class: 'muted' }, 'No flights logged yet. Complete a flight (Pause → End flight) to see it here.'));
    else {
      body.append(chart, detail, h('div', { class: 'logrow', style: 'font-weight:700;color:var(--muted);cursor:default' }, 'Date', 'Aircraft / route', 'Duration', 'Distance', 'Landing', 'Result'));
      for (const e of log) body.append(h('div', { class: 'logrow', onclick: () => showEntry(e) }, new Date(e.date).toLocaleString(), `${e.aircraft} ${e.from ? '· ' + e.from : ''}${e.to ? ' → ' + e.to : ''}${e.mission ? ' (' + e.mission + ')' : ''}`, e.durationMin + ' min', e.distanceNm + ' nm', e.landings.length ? e.landings[e.landings.length - 1].grade + ' ' + e.landings[e.landings.length - 1].score : '—', e.result));
      showEntry(log[0]);
    }
    const replayBtn = h('button', { class: 'btn2 go', onclick: () => { $('dialog').classList.add('hidden'); this.app.startReplay(); }, disabled: !this.app.canReplay() }, 'Replay last flight');
    this.dialog('Flight log', body, [h('button', { class: 'btn2 danger', onclick: () => { clearLog(); this.showLog(); } }, 'Clear log'), h('span', { style: 'flex:1' }), replayBtn]);
  }

  showAbout() {
    this.hideMenu();
    this.dialog('About & credits', h('div', { style: 'max-width:820px;line-height:1.6' },
      h('p', {}, 'Flight Sim 26 is a browser flight simulator built with three.js. All 21 aircraft, their cockpits, the airports and the 80 km procedural world are original, generated in code — no third-party 3D models or textures are used.'),
      h('h3', {}, 'Audio'),
      h('p', {}, 'Engine, rotor, wind, gear and GPWS recordings come from FlightGear projects (fgdata, c172p, 727-230, 737-800, 747-8i, A320-family, CRJ700-family, CitationX, EC135, EC145, UH-1, IDG-MD-11, Alphajet, PC-12) and are used under the GNU GPL v2. See ATTRIBUTION.md for file-by-file sources. Sirens, the fire bell and propeller blade-pass tones are synthesised.'),
      h('h3', {}, 'Libraries'), h('p', {}, 'three.js (MIT). Bundled with esbuild.'),
      h('h3', {}, 'Disclaimer'), h('p', {}, 'Aircraft names and airlines are fictional. Not for real-world navigation or flight training.')));
  }

  // ---------------------------------------------------------------- pause & results
  showPause() {
    const el = $('pause');
    el.innerHTML = '';
    const app = this.app;
    el.append(h('div', { class: 'panel' },
      h('h2', {}, 'Paused'),
      h('button', { class: 'btn2 go', onclick: () => app.setPaused(false) }, 'Resume'),
      h('button', { class: 'btn2', onclick: () => { el.classList.add('hidden'); this.showSettings(); } }, 'Settings'),
      h('button', { class: 'btn2', onclick: () => { this.toggleHelp(true); } }, 'Controls help'),
      h('button', { class: 'btn2', onclick: () => app.restartFlight() }, 'Restart flight'),
      h('button', { class: 'btn2', onclick: () => app.endFlight('ended') }, 'End flight & report'),
      h('button', { class: 'btn2 danger', onclick: () => app.toMenu() }, 'Main menu')));
    el.classList.remove('hidden');
  }
  hidePause() { $('pause').classList.add('hidden'); }

  showResults(r) {
    const el = $('results');
    el.innerHTML = '';
    const blocks = [];
    if (r.landing) {
      const L = r.landing;
      blocks.push(h('div', { style: 'display:flex;gap:26px;align-items:center' },
        h('div', { style: 'text-align:center' }, h('div', { class: 'score' }, String(L.score)), h('div', { class: 'grade' }, 'Grade ' + L.grade)),
        h('div', { style: 'flex:1' }, h('div', { class: 'statgrid' }, stat(L.vsFpm + ' fpm', 'Touchdown rate'), stat(L.g + ' g', 'Load'), stat(L.speedKt + ' kt', 'Speed'), stat(L.runway, 'Runway / pad'), stat(L.centre !== null ? L.centre + ' m' : '—', 'Centreline offset'), stat(L.fromThr !== null ? L.fromThr + ' m' : '—', 'From threshold'), stat(L.rollout + ' m', 'Rollout'), stat(r.emergency ? 'Yes' : 'No', 'Emergency')))),
        h('ul', { class: 'notes' }, L.notes.map(([t, v]) => h('li', {}, h('span', {}, t), h('span', { class: v < 0 ? 'neg' : v > 0 ? 'pos' : '' }, v ? (v > 0 ? '+' : '') + v : '✓')))));
    }
    if (r.mission) blocks.push(h('div', {}, h('h3', {}, 'Mission complete: ' + r.mission.mission.title), h('div', { class: 'statgrid' }, stat(r.mission.minutes.toFixed(1) + ' min', 'Time'), stat(r.mission.comfort + '%', 'Passenger comfort'), stat(r.mission.maxBank + '°', 'Max bank'), stat(r.mission.maxG + ' g', 'Max load'))));
    if (r.rescue) blocks.push(h('div', {}, h('h3', {}, 'Emergency response'), h('p', {}, `Emergency services from ${r.rescue.airport || 'the nearest town'} reached the aircraft ${Math.round(r.rescue.responseTime)} s after dispatch with ${r.rescue.units} vehicles${r.rescue.fire ? (r.rescue.extinguished != null ? `; the fire was put out ${Math.max(1, Math.round(r.rescue.extinguished))} s after the first unit arrived` : ' and fought the fire') : ''}. All occupants are safe.`)));
    if (r.summary) { const s = r.summary; blocks.push(h('div', {}, h('h3', {}, 'Flight report'), h('div', { class: 'statgrid' }, stat(s.durationMin + ' min', 'Duration'), stat(s.distanceNm + ' nm', 'Distance'), stat(s.maxAltFt.toLocaleString() + ' ft', 'Max altitude'), stat(s.fuelUsedKg + ' kg', 'Fuel used')))); }
    if (r.crash) blocks.unshift(h('h2', { style: 'color:var(--bad)' }, 'Crash — ' + r.crash));
    const d = h('div', { class: 'panel dialog', style: 'height:auto;max-height:92vh' },
      h('header', {}, h('h2', {}, r.title || 'Flight results')),
      h('div', { class: 'body' }, ...blocks),
      h('footer', {},
        r.canContinue ? h('button', { class: 'btn2', onclick: () => { el.classList.add('hidden'); this.app.setPaused(false); } }, 'Continue flying') : null,
        h('button', { class: 'btn2', onclick: () => { el.classList.add('hidden'); this.app.startReplay(); } }, 'Replay'),
        h('button', { class: 'btn2', onclick: () => { el.classList.add('hidden'); this.app.restartFlight(); } }, 'Fly again'),
        h('button', { class: 'btn2 go', onclick: () => { el.classList.add('hidden'); this.app.toMenu(); } }, 'Main menu')));
    el.append(d);
    el.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- HUD
  showHud() {
    $('hud').classList.remove('hidden');
    $('atclog').classList.toggle('hidden', !settings.p.atcText);
    $('hints').classList.toggle('hidden', !settings.p.trainingHints);
    this.buildHints();
    this.refreshAlerts();
  }
  hideHud() { $('hud').classList.add('hidden'); $('map').classList.add('hidden'); }

  buildHints() {
    const b = settings.c.bindings, k = (a) => `<kbd>${keyLabel((b[a] || [])[0] || '')}</kbd>`;
    const ac = this.app.ac;
    const heli = ac && ac.fm.isHeli;
    $('hints').innerHTML = [
      `${k('pitchUp')}${k('pitchDown')}${k('rollLeft')}${k('rollRight')} ${heli ? 'cyclic' : 'pitch / roll'}`,
      `${k('yawLeft')}${k('yawRight')} ${heli ? 'pedals' : 'rudder'}`,
      `${k('throttleUp')}${k('throttleDown')} ${heli ? 'collective' : 'throttle'}`,
      heli ? `${k('hoist')} hoist / hook` : `${k('flapsUp')}${k('flapsDown')} flaps · ${k('gear')} gear`,
      `${k('brakes')} brakes · ${k('parkingBrake')} parking`,
      `${k('engineStart')} engine start · ${k('cameraNext')} camera`,
      `${k('autopilot')} autopilot · ${k('map')} map · ${k('help')} help`,
      '<span class="muted">Right-drag: look around · click cockpit controls</span>',
    ].join('<br>');
  }

  buildHelp() {
    const el = $('help');
    const rows = Object.entries(ACTION_LABELS).map(([a, label]) => `<div><span>${label}</span><span>${(settings.c.bindings[a] || []).map((k) => `<kbd>${keyLabel(k)}</kbd>`).join(' ')}</span></div>`).join('');
    el.innerHTML = `<h2>Controls</h2><div class="keys">${rows}</div>
      <h3>Mouse</h3><p class="small">Right-drag (or left-drag on empty space): look around in the cockpit / orbit outside. Wheel: zoom. Click: operate switches, levers, autopilot buttons and knobs (scroll on knobs). Hover over instruments for explanations.</p>
      <h3>Getting started</h3><p class="small">Quick flight places you on the runway with engines running. Release the parking brake (Shift+B), apply full throttle (R), keep straight with Q/E and gently pull back (S) at the rotation speed. Helicopters: raise the collective (R) slowly to lift off.</p>
      <p style="text-align:right"><button class="btn2" onclick="document.getElementById('help').classList.add('hidden')">Close (H)</button></p>`;
  }
  toggleHelp(force) {
    this.buildHelp();
    const el = $('help');
    const show = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
  }

  toggleAtcPanel() {
    const el = $('atcpanel');
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
    const app = this.app, atc = app.atc;
    el.innerHTML = '';
    el.append(h('div', {}, h('b', {}, atc.station ? atc.station.short : 'Approach'), ' ', h('span', { class: 'freq' }, atc.freq)));
    const req = (k, t) => h('button', { onclick: () => atc.request(k, app.ac, app.weather) }, t);
    el.append(h('div', { class: 'row' }, req('atis', 'ATIS'), req('taxi', 'Request taxi'), req('takeoff', 'Request take-off'), req('position', 'Report position'), req('landing', 'Request landing'), h('button', { style: 'border-color:#ff6a5a', onclick: () => atc.request('mayday', app.ac, app.weather) }, 'MAYDAY')));
    el.classList.remove('hidden');
    $('atclog').classList.remove('hidden');
  }
  atcMsg(m) {
    const el = $('atclog');
    el.append(h('div', { class: 'm ' + m.from }, m.text));
    while (el.children.length > 7) el.firstChild.remove();
  }

  toggleApPanel() {
    const el = $('appanel');
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.renderApPanel();
  }
  renderApPanel() {
    const el = $('appanel');
    if (el.classList.contains('hidden')) return;
    const ap = this.app.ac.ap;
    el.innerHTML = '';
    if (!ap.available) { el.append(h('span', {}, 'No autopilot fitted')); return; }
    const btn = (t, on, fn) => h('button', { class: on ? 'on' : '', onclick: () => { fn(); this.renderApPanel(); } }, t);
    const knob = (label, get, set, step) => h('span', {}, h('button', { onclick: () => { set(get() - step); this.renderApPanel(); } }, '−'), h('span', { class: 'val' }, `${label} ${get()}`), h('button', { onclick: () => { set(get() + step); this.renderApPanel(); } }, '+'));
    const heli = this.app.ac.fm.isHeli;
    el.append(btn('AP', ap.engaged, () => ap.engage()), btn('HDG', ap.engaged && ap.lat === 'HDG', () => ap.setMode('lat', 'HDG')));
    if (!heli) el.append(btn('NAV', ap.engaged && ap.lat === 'NAV', () => ap.setMode('lat', 'NAV')), btn('APP', ap.engaged && ap.lat === 'LOC', () => this.app.ac.armApproach()), btn('ALT', ap.engaged && ap.vert === 'ALT', () => ap.setMode('vert', 'ALT')), btn('V/S', ap.engaged && ap.vert === 'VS', () => ap.setMode('vert', 'VS')), btn('A/T', ap.engaged && ap.at, () => ap.setMode('at')));
    else el.append(btn('HOVER', ap.engaged && ap.hover, () => ap.setMode('hover')));
    el.append(knob('HDG', () => Math.round(ap.hdg), (v) => { ap.hdg = wrap360(v); }, 10), knob('ALT', () => ap.alt, (v) => { ap.alt = clamp(v, 0, 60000); }, 500));
    if (!heli) el.append(knob('VS', () => ap.vs, (v) => { ap.vs = clamp(v, -6000, 6000); }, 100));
    el.append(knob('SPD', () => Math.round(ap.spd), (v) => { ap.spd = clamp(v, 0, 600); }, 5));
  }

  missionObjective(o) {
    const el = $('mission');
    el.classList.remove('hidden');
    el.innerHTML = `<div class="small muted">Objective ${o.i + 1} / ${o.total}</div><div class="obj">${o.label}</div><div class="small prog"></div>`;
    this.toast('Objective: ' + o.label);
  }

  showTraining(lesson, i, onNext) {
    const el = $('training');
    if (!lesson) { el.classList.add('hidden'); return; }
    const s = lesson.steps[i];
    el.innerHTML = '';
    el.append(h('div', { class: 'step' }, `${lesson.title} — step ${i + 1} of ${lesson.steps.length}`), h('p', {}, s.text));
    const row = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' });
    if (!s.check || i === lesson.steps.length - 1) row.append(h('button', { class: 'btn2 go', onclick: onNext }, i === lesson.steps.length - 1 ? 'Finish' : 'Next'));
    else row.append(h('span', { class: 'muted small' }, 'Complete the action to continue…'), h('button', { class: 'btn2', onclick: onNext }, 'Skip'));
    el.append(row);
    el.classList.remove('hidden');
  }

  setTooltip(text, x, y) {
    const el = $('tooltip');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.style.left = (x + 16) + 'px'; el.style.top = (y + 14) + 'px';
    el.classList.remove('hidden');
  }

  updateHud(ac, viewMode, dt) {
    if (!ac) return;
    this.hudTimer = (this.hudTimer || 0) - dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.1;
    const show = settings.p.hud;
    $('fltinfo').classList.toggle('hidden', !show);
    $('config').classList.toggle('hidden', !show);
    $('viewname').textContent = VIEW_LABELS[viewMode] || viewMode;
    if (!show) return;
    const d = ac.data, fm = ac.fm;
    const rows = [
      ['IAS', `${Math.round(d.iasKt)} kt`], ['ALT', `${Math.round(d.altFt).toLocaleString()} ft`], ['V/S', `${Math.round(d.vsFpm / 10) * 10} fpm`],
      ['HDG', pad(Math.round(d.hdg) % 360, 3) + '°'], ['GS', `${Math.round(d.gsKt)} kt`], ['AGL', d.aglFt < 5000 ? `${Math.round(d.aglFt)} ft` : '—'],
    ];
    if (fm.isHeli) rows.push(['ROTOR', `${Math.round(fm.nr * 100)}%`]);
    else rows.push(['AOA', d.iasKt > 25 ? `${(fm.telemetry.alpha || 0).toFixed(1)}°` : '—']);
    $('fltinfo').innerHTML = rows.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('');
    const thr = fm.isHeli ? fm.ctl.collective : (fm.ctl.throttle[0] || 0);
    const eng = fm.engines[0];
    const engTxt = eng ? (eng.state === 'running' ? (d.engineType === 'turbofan' ? `N1 ${Math.round(eng.n1 * 100)}%` : d.engineType === 'piston' ? `${Math.round(eng.rpm)} rpm` : `TQ ${Math.round(eng.torque * 100)}%`) : eng.state.toUpperCase()) : '';
    const flaps = !fm.isHeli && ac.spec.aero.flaps.length > 1 ? `${ac.spec.aero.flaps[fm.ctl.flapIndex].deg}°` : '—';
    $('config').innerHTML =
      `<div><div class="k">${fm.isHeli ? 'Collective' : 'Throttle'}</div><div class="meter"><div style="width:${Math.round(thr * 100)}%"></div></div></div>` +
      `<div><div class="k">Engine</div><div class="v">${engTxt}</div></div>` +
      (fm.isHeli ? '' : `<div><div class="k">Flaps</div><div class="v">${flaps}</div></div>`) +
      (ac.spec.retract ? `<div><div class="k">Gear</div><div class="v" style="color:${fm.gearPos > 0.99 ? 'var(--good)' : fm.gearPos < 0.01 ? 'var(--muted)' : 'var(--warn)'}">${fm.gearPos > 0.99 ? 'DOWN' : fm.gearPos < 0.01 ? 'UP' : 'TRANSIT'}</div></div>` : '') +
      `<div><div class="k">Brake</div><div class="v" style="color:${fm.ctl.parking ? 'var(--bad)' : 'inherit'}">${fm.ctl.parking ? 'PARK' : fm.ctl.brakeL ? 'ON' : 'OFF'}</div></div>` +
      (fm.spoilerPos > 0.1 ? '<div><div class="k">Spoilers</div><div class="v">EXT</div></div>' : '') +
      (fm.reverserPos > 0.1 ? '<div><div class="k">Reverse</div><div class="v">ON</div></div>' : '') +
      (ac.ap.engaged ? `<div><div class="k">Autopilot</div><div class="v" style="color:var(--good)">${ac.ap.lat} ${ac.ap.vert}</div></div>` : '') +
      `<div><div class="k">Fuel</div><div class="v">${Math.round(d.fuelKg)} kg</div></div>`;
    this.alertTimer = (this.alertTimer || 0) - 0.1;
    if (this.alertTimer <= 0) { this.alertTimer = 0.5; this.refreshAlerts(); }
  }

  // ---------------------------------------------------------------- moving map
  toggleMap() {
    const el = $('map');
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) {
      const c = $('mapcanvas');
      c.width = c.clientWidth; c.height = c.clientHeight;
      this.mapZoom = this.mapZoom || 1;
      c.onwheel = (e) => { this.mapZoom = clamp(this.mapZoom * (e.deltaY > 0 ? 0.85 : 1.18), 0.6, 12); e.preventDefault(); };
    }
  }
  drawMap(ac) {
    const el = $('map');
    if (el.classList.contains('hidden') || !ac) return;
    this.mapT = (this.mapT || 0) + 1;
    if (this.mapT % 4) return;
    const c = $('mapcanvas'), x = c.getContext('2d');
    const W = c.width, H = c.height;
    const cm = this.app.colormap.canvas;
    const zoom = this.mapZoom || 1;
    const mpp = WORLD_SIZE / Math.min(W, H) / zoom;   // metres per pixel
    const cx = ac.fm.pos.x, cz = ac.fm.pos.z;
    const toPx = (wx, wz) => [W / 2 + (wx - cx) / mpp, H / 2 + (wz - cz) / mpp];
    x.fillStyle = '#1a3a52'; x.fillRect(0, 0, W, H);
    const [x0, y0] = toPx(-WORLD_HALF, -WORLD_HALF);
    x.globalAlpha = 0.95; x.drawImage(cm, x0, y0, WORLD_SIZE / mpp, WORLD_SIZE / mpp); x.globalAlpha = 1;
    x.font = 'bold 13px sans-serif';
    for (const ap of AIRPORTS) {
      const [px, py] = toPx(ap.x, ap.z);
      x.strokeStyle = '#ff4fe4'; x.lineWidth = 3;
      for (const rw of ap.runways) { const e = runwayEnds(ap, rw); const [a1, b1] = toPx(e.a.x, e.a.z), [a2, b2] = toPx(e.b.x, e.b.z); x.beginPath(); x.moveTo(a1, b1); x.lineTo(a2, b2); x.stroke(); }
      x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 3;
      x.strokeText(`${ap.icao} ${ap.short}`, px + 8, py - 8); x.fillText(`${ap.icao} ${ap.short}`, px + 8, py - 8);
    }
    for (const t of this.app.world.towns) { const [px, py] = toPx(t.x, t.z); x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '12px sans-serif'; x.fillText(t.name, px - 20, py); }
    if (ac.dest) { const [a, b] = toPx(cx, cz), [c2, d2] = toPx(ac.dest.x, ac.dest.z); x.strokeStyle = '#ff4fe4'; x.setLineDash([8, 6]); x.lineWidth = 2; x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d2); x.stroke(); x.setLineDash([]); }
    // aircraft icon
    x.save(); x.translate(W / 2, H / 2); x.rotate(ac.fm.telemetry.heading * Math.PI / 180);
    x.fillStyle = '#ffd23a'; x.strokeStyle = '#000'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(0, -12); x.lineTo(9, 8); x.lineTo(0, 4); x.lineTo(-9, 8); x.closePath(); x.fill(); x.stroke();
    x.restore();
    // scale bar
    const nm = mpp * 100 / NM;
    x.fillStyle = '#fff'; x.fillRect(16, H - 22, 100, 3); x.font = '12px sans-serif'; x.fillText(`${nm.toFixed(1)} nm`, 16, H - 28);
  }

  replayBar(rp) {
    const el = $('replaybar');
    if (!rp) { el.classList.add('hidden'); return; }
    el.innerHTML = '';
    const range = h('input', { type: 'range', min: 0, max: rp.duration, step: 0.1, value: rp.t, oninput: () => { rp.t = +range.value; } });
    const play = h('button', { class: 'btn2', onclick: () => { rp.playing = !rp.playing; play.textContent = rp.playing ? '❚❚' : '▶'; } }, rp.playing ? '❚❚' : '▶');
    const sp = h('select', { onchange: () => { rp.speed = +sp.value; } }, [0.5, 1, 2, 4, 8].map((s) => h('option', { value: s, selected: s === rp.speed }, s + '×')));
    const time = h('span', { class: 'small', style: 'min-width:90px;text-align:right' });
    el.append(h('b', { class: 'small' }, 'REPLAY'), play, range, time, sp, h('button', { class: 'btn2', onclick: () => this.app.stopReplay() }, 'Exit'));
    el.classList.remove('hidden');
    rp.ui = { range, time };
  }
}

function stat(v, label) { return h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, label)); }
export function fmtTime(t) { const hh = Math.floor(t), mm = Math.round((t - hh) * 60); return `${pad(hh, 2)}:${pad(mm % 60, 2)}`; }
