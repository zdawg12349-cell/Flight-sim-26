// End-to-end feature test in a real (headless) Chromium. Drives the actual UI and the simulator
// through keyboard input and the debug handle window.__fs, and reports PASS/FAIL per feature.
//
//   node tests/feature-test.js [outdir] [only=name1,name2]
//
// Screenshots and a JSON report are written to outdir (default: test-output/).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || path.join(__dirname, '..', 'test-output');
const only = (process.argv.find((a) => a.startsWith('only=')) || '').slice(5).split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });
const results = [];
const errors = [];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

async function main() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 576 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const url = 'file://' + path.join(__dirname, '..', 'index.html');
  const E = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  const waitFor = (fn, timeout = 120000, arg) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
  const startFlight = async (cfg) => {
    await E((c) => window.__fs.startFlight(c), cfg);
    await waitFor(() => window.__fs.state === 'flight');
    await E(() => { window.__fsSettings.p.trainingHints = false; document.getElementById('hints').classList.add('hidden'); });
  };
  const toMenu = () => E(() => window.__fs.toMenu());
  // Waits for N seconds of *simulated* time (software rendering in CI runs far below real time).
  const simWait = async (sec, maxWallMs = 300000) => {
    const t0s = await E(() => window.__fs.ac.fm.time);
    // (returns early if the simulation is paused, e.g. by a results screen, or the flight ended)
    await waitFor((a) => !window.__fs.ac || window.__fs.state !== 'flight' || window.__fs.paused || window.__fs.ac.fm.time - a.t0 >= a.sec, maxWallMs, { t0: t0s, sec });
  };
  // Holds a key until a condition (evaluated in the page) is met or maxSimSec of sim time passes.
  // The key is pressed with a real keyboard event; release is frame-accurate (a page-side hook
  // dispatches the keyup in the very frame the condition becomes true).
  const holdKeyUntil = async (key, cond, maxSimSec = 8) => {
    await E((a) => {
      const ac = window.__fs.ac, t0 = ac.fm.time, f = new Function('return (' + a.cond + ')()');
      window.__holdDone = false;
      const prev = ac.applyInput;
      ac.applyInput = (dt, inp, lock) => {
        if (!window.__holdDone && (f() || ac.fm.time - t0 > a.max)) {
          window.__holdDone = true;
          window.dispatchEvent(new KeyboardEvent('keyup', { code: a.key, key: a.key }));
          ac.applyInput = prev;
        }
        return prev(dt, inp, lock);
      };
    }, { cond: cond.toString(), max: maxSimSec, key });
    await page.keyboard.down(key);
    try { await waitFor(() => window.__holdDone, 300000); } finally { await page.keyboard.up(key); }
  };
  // Installs a scripted pilot that runs after the normal input/assist/autopilot processing.
  const installPilot = (kind) => E((kind) => {
    const ac = window.__fs.ac;
    if (!ac._origApply) ac._origApply = ac.applyInput.bind(ac);
    const st = { flare: false };
    ac.applyInput = (dt, input, lock) => {
      ac._origApply(dt, input, lock);
      const t = ac.fm.telemetry, c = ac.fm.ctl, w = ac.fm.w;
      if (kind === 'land' || kind === 'glide') {
        const agl = t.agl;
        // track a 3-degree glide path to an aim point 250 m past the threshold, flare below 9 m
        const d = ac.dest ? Math.hypot(ac.fm.pos.x - ac.dest.x, ac.fm.pos.z - ac.dest.z) : 0;
        const hDes = (d + 250) * Math.tan(3 * Math.PI / 180);
        let vsT = agl > 9 ? Math.max(-5, Math.min(1, -t.gs * 0.0524 + (hDes - agl) * 0.25)) : -0.35 - agl * 0.09;
        const vref = (ac.spec.perf.vref || 65) * 0.5144;
        c.pitch = Math.max(-1, Math.min(1, (vsT - t.vs) * 0.16 - (w.x * 57.3) * 0.05 + (t.ias < vref * 0.85 ? -0.15 : 0)));
        const hdgErr = ((t.heading - (ac._rwyHdg ?? t.heading) + 540) % 360) - 180;
        const bankT = Math.max(-8, Math.min(8, -hdgErr * 1.5));
        c.roll = Math.max(-1, Math.min(1, (bankT - t.bank) * 0.05 + (w.z * 57.3) * 0.02));
        c.yaw = ac.fm.onGround ? Math.max(-1, Math.min(1, -hdgErr * 0.08)) : 0;
        if (kind === 'land' || kind === 'glide') {
          const thr = agl < 8 ? 0 : Math.max(0, Math.min(1, 0.45 + (vref * 1.05 - t.ias) * 0.08));
          for (let i = 0; i < c.throttle.length; i++) c.throttle[i] = thr;
        }
        if (ac.fm.onGround) { c.pitch = 0; c.roll = 0; for (let i = 0; i < c.throttle.length; i++) c.throttle[i] = 0; c.brakeL = c.brakeR = t.gs > 2 ? 0.7 : 1; }
      }
    };
    ac._rwyHdg = ac.fm.telemetry.heading;
  }, kind);

  async function test(name, fn) {
    if (only.length && !only.includes(name)) return;
    const e0 = errors.length;
    log('▶', name);
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + (e && e.message ? e.message.split('\n')[0] : e) }; }
    if (errors.length > e0) { r.ok = false; r.info = (r.info || '') + ' | console errors: ' + errors.slice(e0).slice(0, 3).join(' ; '); }
    results.push({ name, ...r });
    log(r.ok ? '  PASS' : '  FAIL', name, '-', r.info || '');
  }

  // ------------------------------------------------------------------ boot
  await test('boot', async () => {
    const s = Date.now();
    await page.goto(url);
    await waitFor(() => window.__fs && window.__fs.state === 'menu', 180000);
    const ms = Date.now() - s;
    await wait(1500);
    await shot('01_menu');
    const menuVisible = await E(() => !document.getElementById('menu').classList.contains('hidden'));
    // functional tests run on the Low preset (software rendering is slow); presets are tested separately
    await E(() => { window.__fsSettings.applyPreset('low'); window.__fsSettings.g.autoQuality = false; window.__fs.applyGraphics(); });
    return { ok: menuVisible, info: `menu after ${(ms / 1000).toFixed(1)} s` };
  });

  // ------------------------------------------------------------------ menu dialogs
  await test('menu-dialogs', async () => {
    const info = [];
    const clickMenu = (label) => E((label) => { const b = [...document.querySelectorAll('#menu .btn')].find((x) => x.textContent.startsWith(label)); b.click(); return !!b; }, label);
    const dlgOpen = () => E(() => !document.getElementById('dialog').classList.contains('hidden'));
    const close = () => E(() => window.__fs.ui.closeDialog());
    await clickMenu('Free flight'); await wait(1200);
    const ff = await E(() => ({ items: document.querySelectorAll('#dialog .item').length, canvas: !!document.querySelector('#dialog canvas'), chips: document.querySelectorAll('#dialog .chip').length }));
    info.push(`free flight: ${ff.items} aircraft, preview canvas ${ff.canvas}, ${ff.chips} chips`);
    // select a different aircraft and check preview/specs update
    await E(() => { const it = [...document.querySelectorAll('#dialog .item')].find((n) => n.dataset.id === 'a740'); it.click(); });
    await wait(1500);
    await shot('02_freeflight');
    const specTxt = await E(() => document.getElementById('dialog').innerText.includes('A-740'));
    await close();
    await clickMenu('Missions'); await wait(300);
    const missions = await E(() => document.querySelectorAll('#dialog .card').length); await close();
    await clickMenu('Landing challenges'); await wait(300);
    const ch = await E(() => document.querySelectorAll('#dialog .card').length); await close();
    await clickMenu('Training'); await wait(300);
    const tr = await E(() => document.querySelectorAll('#dialog .card').length); await close();
    await clickMenu('Settings'); await wait(300);
    const tabs = await E(() => document.querySelectorAll('#dialog .tab').length);
    let tabsOk = true;
    for (let i = 0; i < tabs; i++) { await E((i) => document.querySelectorAll('#dialog .tab')[i].click(), i); await wait(200); if (!(await dlgOpen())) tabsOk = false; }
    await shot('03_settings_controls');
    await close();
    await clickMenu('Flight log'); await wait(300); const logOpen = await dlgOpen(); await close();
    await clickMenu('About'); await wait(300); const about = await E(() => document.getElementById('dialog').innerText.includes('GPL')); await close();
    info.push(`missions ${missions}, challenges ${ch}, lessons ${tr}, settings tabs ${tabs}, log ${logOpen}, about mentions GPL ${about}`);
    return { ok: ff.items === 21 && ff.canvas && specTxt && missions >= 10 && ch >= 8 && tr >= 5 && tabs === 4 && tabsOk && logOpen && about, info: info.join('; ') };
  });

  // ------------------------------------------------------------------ cold & dark engine start, throttle, RPM, prop and audio
  await test('engine-start-throttle-audio', async () => {
    await startFlight({ aircraft: 'skylark', airport: 'KPXR', spawn: 0, weather: 'clear', time: 11, season: 'summer', fuel: 0.6, payload: 0.5, running: false });
    const sample = () => E(() => {
      const ac = window.__fs.ac, e = ac.fm.engines[0], a = window.__fs.audio;
      const g = a.groups && a.groups[0];
      const voices = g ? g.voices.map((x) => ({ clip: x.L.clip, g: +x.v.g.toFixed(3), r: +x.v.r.toFixed(3) })) : [];
      const prop = ac.model.props[0];
      return { state: e.state, rpm: Math.round(e.rpm), running: e.running, thr: ac.fm.ctl.throttle[0], propAngle: prop ? +prop.spin.rotation.z.toFixed(3) : null, blur: prop ? +prop.disc.material.opacity.toFixed(2) : null, voices, synth: g && g.synth ? +g.synth.gn.gain.value.toFixed(3) : null, ctx: a.ctx && a.ctx.state, nVoices: a.voices.length };
    });
    const s0 = await sample();
    await page.keyboard.press('KeyI');           // auto-start sequence
    const seq = [];
    for (let i = 0; i < 30; i++) {
      await simWait(0.5);
      const s = await sample();
      if (seq[seq.length - 1] !== s.state) seq.push(s.state);
      if (s.running && (await E(() => !window.__fs.ac.systems.seq))) break;
    }
    await simWait(2.5);
    const idle = await sample();
    await shot('04_engine_running_cockpit');
    await holdKeyUntil('KeyR', () => window.__fs.ac.fm.ctl.throttle[0] > 0.95, 4);
    await simWait(2.5);
    const high = await sample();
    const loudIdle = idle.voices.reduce((s, v) => s + v.g, 0), loudHigh = high.voices.reduce((s, v) => s + v.g, 0);
    const rateIdle = Math.max(...idle.voices.map((v) => (v.g > 0.01 ? v.r : 0))), rateHigh = Math.max(...high.voices.map((v) => (v.g > 0.01 ? v.r : 0)));
    const propMoved = idle.propAngle !== high.propAngle;
    const info = `cold rpm ${s0.rpm} (${s0.state}); start sequence ${seq.join(' → ')}; idle ${idle.rpm} rpm; throttle ${high.thr.toFixed(2)} → ${high.rpm} rpm; audio ctx ${high.ctx}, ${high.nVoices} voices, engine loudness ${loudIdle.toFixed(2)} → ${loudHigh.toFixed(2)}, max pitch-rate ${rateIdle} → ${rateHigh}; prop blur ${idle.blur} → ${high.blur}`;
    return { ok: s0.rpm === 0 && idle.running && idle.rpm > 500 && high.rpm > idle.rpm + 400 && loudHigh > loudIdle && rateHigh > rateIdle && propMoved, info };
  });

  // ------------------------------------------------------------------ keyboard take-off
  await test('takeoff-keyboard', async () => {
    await startFlight({ aircraft: 'skylark', airport: 'KPXR', spawn: 0, weather: 'clear', time: 11, season: 'summer', fuel: 0.5, payload: 0.4, running: true });
    await page.keyboard.press('Shift+KeyB');     // release parking brake
    await page.keyboard.press('Shift+KeyR');     // full throttle
    let ias = 0, i = 0;
    for (; i < 60; i++) { await simWait(1); ias = await E(() => window.__fs.ac.fm.telemetry.ias / 0.5144); if (ias > 58) break; }
    await holdKeyUntil('KeyS', () => window.__fs.ac.fm.telemetry.pitch > 7, 2.5);
    let st = null;
    for (let k = 0; k < 25; k++) { await simWait(1); st = await E(() => { const t = window.__fs.ac.fm.telemetry; return { agl: t.agl / 0.3048, vs: t.vs / 0.00508, ias: t.ias / 0.5144, pitch: t.pitch, onG: window.__fs.ac.fm.onGround, crashed: window.__fs.ac.fm.damage.crashed }; }); if (st.agl > 150) break; }
    await E(() => window.__fs.camRig.setMode('chase', window.__fs.ac)); await wait(1500);
    await shot('05_takeoff_chase');
    return { ok: !st.onG && st.agl > 60 && !st.crashed, info: `rotated at ${ias.toFixed(0)} kt after ~${i} s; now ${st.agl.toFixed(0)} ft AGL, ${st.vs.toFixed(0)} fpm, ${st.ias.toFixed(0)} kt` };
  });

  // ------------------------------------------------------------------ camera views
  await test('camera-views', async () => {
    const seen = [];
    await E(() => window.__fs.camRig.setMode('cockpit', window.__fs.ac));
    for (let k = 0; k < 10; k++) {
      await page.keyboard.press('KeyC'); await wait(700);
      const m = await E(() => window.__fs.camRig.mode);
      seen.push(m);
      if (['cabin', 'side', 'tower', 'flyby'].includes(m)) await shot('06_view_' + m);
    }
    const uniq = [...new Set(seen)];
    return { ok: uniq.length >= 8, info: 'cycled: ' + seen.join(', ') };
  });

  // ------------------------------------------------------------------ jet spool-up (N1 lag) and audio
  await test('jet-spool-audio', async () => {
    await startFlight({ aircraft: 'm738', airport: 'KPXR', spawn: 0, weather: 'clear', time: 11, season: 'summer', fuel: 0.5, payload: 0.5, running: true });
    const n1 = () => E(() => { const e = window.__fs.ac.fm.engines[0]; const g = window.__fs.audio.groups[0]; return { n1: e.n1, thrust: e.thrust, loud: g.voices.reduce((s, x) => s + x.v.g, 0), fan: window.__fs.ac.model.fans[0] ? window.__fs.ac.model.fans[0].spin.rotation.z : 0 }; });
    await simWait(1);
    const a = await n1();
    await page.keyboard.press('Shift+KeyR');
    await simWait(1.5); const b = await n1();
    await simWait(5); const c = await n1();
    await page.keyboard.press('Shift+KeyF');
    await shot('07_jet_cockpit_spool');
    return { ok: b.n1 > a.n1 && c.n1 > b.n1 + 0.03 && c.n1 > 0.85 && c.loud > a.loud, info: `N1 idle ${(a.n1 * 100).toFixed(0)}% → 1.5 s ${(b.n1 * 100).toFixed(0)}% → 6.5 s ${(c.n1 * 100).toFixed(0)}% (spool lag), thrust ${(c.thrust / 1000).toFixed(0)} kN, loudness ${a.loud.toFixed(2)} → ${c.loud.toFixed(2)}` };
  });

  // ------------------------------------------------------------------ helicopter lift-off, rotor and audio
  await test('helicopter-liftoff', async () => {
    await startFlight({ aircraft: 'h22', airport: 'KPXR', spawn: 0, weather: 'clear', time: 11, season: 'summer', fuel: 0.6, payload: 0.5, running: true });
    const st = () => E(() => { const ac = window.__fs.ac, fm = ac.fm; const r = ac.model.rotors[0]; return { agl: fm.telemetry.agl, nr: fm.nr, col: fm.ctl.collective, rot: r ? r.spin.rotation.y : 0, onG: fm.onGround, bank: fm.telemetry.bank, pitch: fm.telemetry.pitch, loud: window.__fs.audio.groups[0].voices.reduce((s, x) => s + x.v.g, 0), crashed: fm.damage.crashed }; });
    await simWait(1);
    const a = await st();
    await holdKeyUntil('KeyR', () => !window.__fs.ac.fm.onGround && window.__fs.ac.fm.telemetry.agl > 1.2, 6);
    await simWait(2.5);
    const c = await st();
    await E(() => window.__fs.camRig.setMode('chase', window.__fs.ac)); await wait(1500);
    await shot('08_heli_hover');
    return { ok: a.onG && !c.onG && c.agl > 1.0 && Math.abs(c.bank) < 20 && c.nr > 0.9 && c.nr < 1.1 && !c.crashed && a.rot !== c.rot, info: `collective ${c.col.toFixed(2)}, ${c.agl.toFixed(1)} m AGL, rotor ${(c.nr * 100).toFixed(0)}%, attitude ${c.pitch.toFixed(1)}/${c.bank.toFixed(1)}°, loudness ${a.loud.toFixed(2)} → ${c.loud.toFixed(2)}` };
  });

  // ------------------------------------------------------------------ landing + evaluation
  await test('landing-evaluation', async () => {
    await E(() => window.__fs.startChallenge({ id: 't_land', title: 'Test landing', level: 'Easy', aircraft: 'skylark', airport: 'KMVL', runway: '36', dist: 1.0, weather: 'clear', time: 11 }));
    await waitFor(() => window.__fs.state === 'flight');
    await E(() => document.getElementById('hints').classList.add('hidden'));
    await installPilot('land');
    await E(() => window.__fs.camRig.setMode('chase', window.__fs.ac));
    let s;
    for (let i = 0; i < 150; i++) {
      await simWait(1);
      s = await E(() => ({ results: !document.getElementById('results').classList.contains('hidden'), agl: window.__fs.ac.fm.telemetry.agl, gs: window.__fs.ac.fm.telemetry.gs, crashed: window.__fs.ac.fm.damage.crashed }));
      if (s.results || s.crashed) break;
    }
    await wait(800);
    await shot('09_landing_results');
    const txt = await E(() => document.getElementById('results').innerText.replace(/\s+/g, ' ').slice(0, 300));
    return { ok: s.results && !s.crashed, info: txt };
  });

  // ------------------------------------------------------------------ failures, warnings, emergency landing, rescue response
  await test('emergency-rescue', async () => {
    await E(() => document.getElementById('results').classList.add('hidden'));
    await E(() => window.__fs.startChallenge({ id: 't_em', title: 'Test emergency', level: 'Hard', aircraft: 'skylark', airport: 'KMVL', runway: '36', dist: 1.0, weather: 'clear', time: 11 }));
    await waitFor(() => window.__fs.state === 'flight');
    await E(() => document.getElementById('hints').classList.add('hidden'));
    await installPilot('glide');
    await E(() => { const f = window.__fs; f.failures.trigger(f.ac, 'fire', 0); });
    await simWait(1.5);
    const em = await E(() => ({ banner: !document.getElementById('emergency').classList.contains('hidden'), text: document.getElementById('emergency').innerText.slice(0, 80), master: window.__fs.ac.systems.masterWarning, fire: window.__fs.ac.fm.engines[0].fire, warn: [...window.__fs.ac.systems.warnings.keys()].join(',') }));
    await shot('10_emergency_banner');
    await E(() => window.__fs.camRig.setMode('chase', window.__fs.ac));
    let dispatched = false, i = 0;
    for (; i < 160; i++) { await simWait(1); dispatched = await E(() => window.__fs.rescue.active); if (dispatched) break; const cr = await E(() => window.__fs.ac.fm.damage.crashed); if (cr && i > 30) break; }
    const d0 = await E(() => window.__fs.rescue.units.map((u) => ({ k: u.kind, x: u.v.root.position.x, z: u.v.root.position.z })));
    await simWait(8);
    const d1 = await E(() => window.__fs.rescue.units.map((u) => ({ k: u.kind, x: u.v.root.position.x, z: u.v.root.position.z, sp: u.drv.speed || 0 })));
    const moved = d1.filter((u, k) => Math.hypot(u.x - d0[k].x, u.z - d0[k].z) > 5).length;
    await shot('11_rescue_driving');
    let arrived = 0, done = false, j = 0, lightsOk = false, sprayOk = false;
    for (; j < 300; j++) {
      await simWait(1);
      const s = await E(() => { const r = window.__fs.rescue; return { arrived: r.units.filter((u) => u.arrived).length, n: r.units.length, completed: r.completed, results: !document.getElementById('results').classList.contains('hidden'), lights: r.units.some((u) => u.drv.lightsOn && u.v.lamps.some((l) => l.glow && l.glow.visible)), spray: r.units.some((u) => u.spray && u.spray.material && u.spray.material.uniforms && u.spray.material.uniforms.uOn.value > 0.3) }; });
      arrived = s.arrived; lightsOk = lightsOk || s.lights; sprayOk = sprayOk || s.spray;
      if (s.arrived >= 2 && j % 10 === 0) await shot('12_rescue_on_scene');
      if (s.results) { done = true; break; }
    }
    await wait(800);
    await shot('13_rescue_report');
    const rep = await E(() => document.getElementById('results').innerText.replace(/\s+/g, ' ').slice(0, 400));
    return { ok: em.banner && em.fire && dispatched && moved >= 3 && done, info: `banner "${em.text.replace(/\s+/g, ' ')}", master warning ${em.master}, warnings [${em.warn}]; dispatched after ${i} s; ${moved}/${d1.length} units moving; arrived ${arrived}; flashing lights ${lightsOk}; water spray ${sprayOk}; report: ${rep}` };
  });

  // ------------------------------------------------------------------ replay + flight log
  await test('replay-and-log', async () => {
    const logN = await E(() => JSON.parse(localStorage.getItem('fs26.flightlog.v1') || '[]').length);
    const ok1 = await E(() => window.__fs.canReplay());
    await E(() => window.__fs.startReplay());
    await wait(500);
    const p0 = await E(() => ({ s: window.__fs.state, t: window.__fs.replay && window.__fs.replay.t }));
    await wait(3000);
    const p1 = await E(() => ({ s: window.__fs.state, t: window.__fs.replay && window.__fs.replay.t }));
    await shot('14_replay');
    await E(() => window.__fs.stopReplay());
    return { ok: ok1 && p0.s === 'replay' && p1.t > p0.t, info: `log entries in storage: ${logN}; replay t ${p0.t && p0.t.toFixed(1)} → ${p1.t && p1.t.toFixed(1)}` };
  });

  // ------------------------------------------------------------------ pause / ATC / map / help / AP panel
  await test('hud-panels', async () => {
    await startFlight({ aircraft: 'zephyr', airport: 'KPXR', spawn: 0, weather: 'fair', time: 11, season: 'summer', fuel: 0.5, payload: 0.5, running: true });
    const vis = (id) => E((id) => !document.getElementById(id).classList.contains('hidden'), id);
    await page.keyboard.press('KeyP'); await wait(300); const paused = await vis('pause') && await E(() => window.__fs.paused);
    await page.keyboard.press('KeyP'); await wait(300); const resumed = !(await vis('pause'));
    await page.keyboard.press('KeyY'); await wait(300); const atc = await vis('atcpanel');
    await E(() => { const b = [...document.querySelectorAll('#atcpanel button')].find((x) => x.textContent.includes('ATIS')); b && b.click(); });
    await wait(800);
    const atcLog = await E(() => document.getElementById('atclog').innerText.length);
    await page.keyboard.press('KeyY');
    await page.keyboard.press('KeyM'); await wait(800); const map = await vis('map');
    await shot('15_map');
    await page.keyboard.press('KeyM');
    await page.keyboard.press('KeyH'); await wait(300); const help = await vis('help');
    await page.keyboard.press('KeyH');
    await page.keyboard.press('Shift+KeyZ'); await wait(300); const ap = await vis('appanel');
    await page.keyboard.press('Shift+KeyZ');
    return { ok: paused && resumed && atc && atcLog > 10 && map && help && ap, info: `pause ${paused}, resume ${resumed}, ATC panel ${atc} (log ${atcLog} chars), map ${map}, help ${help}, AP panel ${ap}` };
  });

  // ------------------------------------------------------------------ missions / training start
  await test('missions-training', async () => {
    const m = await E(() => { const f = window.__fs; return { n: 0 }; });
    await E(() => { const b = document.querySelector('#menu'); });
    await E(() => window.__fs.toMenu());
    await E(() => { const b = [...document.querySelectorAll('#menu .btn')].find((x) => x.textContent.startsWith('Missions')); b.click(); });
    await wait(300);
    await E(() => document.querySelectorAll('#dialog .card')[0].click());
    await wait(300);
    await E(() => { const b = [...document.querySelectorAll('#dialog button')].find((x) => x.textContent === 'Start'); b.click(); });
    await waitFor(() => window.__fs.state === 'flight');
    await wait(1500);
    const mission = await E(() => ({ panel: !document.getElementById('mission').classList.contains('hidden'), text: document.getElementById('mission').innerText.slice(0, 80) }));
    await shot('16_mission');
    await E(() => window.__fs.toMenu());
    await E(() => { const b = [...document.querySelectorAll('#menu .btn')].find((x) => x.textContent.startsWith('Training')); b.click(); });
    await wait(300);
    await E(() => document.querySelectorAll('#dialog .card')[0].click());
    await waitFor(() => window.__fs.state === 'flight');
    await wait(1500);
    const training = await E(() => ({ panel: !document.getElementById('training').classList.contains('hidden'), text: document.getElementById('training').innerText.slice(0, 80) }));
    await shot('17_training');
    return { ok: mission.panel && training.panel, info: `mission: "${mission.text.replace(/\s+/g, ' ')}"; training: "${training.text.replace(/\s+/g, ' ')}"` };
  });

  // ------------------------------------------------------------------ graphics presets + performance
  await test('graphics-presets', async () => {
    await startFlight({ aircraft: 'skylark', airport: 'KPXR', spawn: 0, weather: 'scattered', time: 11, season: 'summer', fuel: 0.5, payload: 0.5, running: true });
    const res = {};
    for (const p of ['low', 'medium', 'high', 'ultra']) {
      await E((p) => { window.__fsSettings.applyPreset(p); window.__fs.applyGraphics(); window.__fs.perf.reset(); }, p);
      await wait(6000);
      res[p] = await E(() => { const r = window.__fs.renderer; const info = r.r ? r.r.info : r.renderer.info; return { fps: Math.round(window.__fs.perf.fps), draws: info.render.calls, tris: Math.round(info.render.triangles / 1000), w: r.canvas.width, h: r.canvas.height }; });
      await shot('18_preset_' + p);
    }
    await E(() => { window.__fsSettings.applyPreset('medium'); window.__fs.applyGraphics(); });
    const okDraws = res.low.draws <= res.ultra.draws && res.low.tris <= res.ultra.tris;
    return { ok: okDraws, info: Object.entries(res).map(([k, v]) => `${k}: ${v.fps} fps, ${v.draws} draws, ${v.tris}k tris, ${v.w}x${v.h}`).join(' | ') + ' (SwiftShader CPU rendering — FPS not representative of a GPU)' };
  });

  // ------------------------------------------------------------------ settings persistence across reload
  await test('settings-persistence', async () => {
    await E(() => { const s = window.__fsSettings; s.applyPreset('low'); s.g.fov = 71; s.a.master = 0.42; s.c.bindings.gear = ['KeyJ']; s.p.emergencyFrequency = 'often'; s.saveNow(); });
    await page.reload();
    await waitFor(() => window.__fs && window.__fs.state === 'menu', 180000);
    const s = await E(() => { const s = window.__fsSettings; return { preset: s.g.preset, fov: s.g.fov, master: s.a.master, gear: s.c.bindings.gear.join(','), freq: s.p.emergencyFrequency }; });
    await E(() => { window.__fsSettings.reset(); });
    return { ok: s.preset === 'low' && s.fov === 71 && s.master === 0.42 && s.gear === 'KeyJ' && s.freq === 'often', info: JSON.stringify(s) };
  });

  // ------------------------------------------------------------------ every aircraft: spawn without errors
  await test('all-aircraft-spawn', async () => {
    const ids = await E(() => Object.keys(window.__fsCatalog || {}));
    const bad = [];
    for (const id of ids) {
      await startFlight({ aircraft: id, airport: 'KPXR', spawn: 0, weather: 'fair', time: 11, season: 'summer', fuel: 0.6, payload: 0.6, running: true });
      await wait(1500);
      const s = await E(() => { const fm = window.__fs.ac.fm; return { nan: !Number.isFinite(fm.pos.x + fm.pos.y + fm.vel.y + fm.fuel), crashed: fm.damage.crashed, bank: Math.abs(fm.telemetry.bank), warn: [...window.__fs.ac.systems.warnings.keys()].join(',') }; });
      if (s.nan || s.crashed || s.bank > 5) bad.push(`${id}(${JSON.stringify(s)})`);
      else if (s.warn) bad.push(`${id} warnings:${s.warn}`);
    }
    return { ok: ids.length === 21 && bad.length === 0, info: `${ids.length} aircraft; problems: ${bad.join(' ; ') || 'none'}` };
  });

  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('\n================ SUMMARY ================');
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name.padEnd(30) + (r.info || ''));
  console.log(`console errors: ${errors.length}`);
  errors.slice(0, 15).forEach((e) => console.log('  ' + e));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
