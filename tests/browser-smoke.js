// Browser smoke test: boot to menu, start a flight, screenshot cockpit. Usage: node tests/browser-smoke.js [outdir]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || path.join(__dirname, 'out');
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + e.stack));
  const t0 = Date.now();
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.__fs && window.__fs.state === 'menu', null, { timeout: 120000 });
  console.log('menu after', (Date.now() - t0) / 1000, 's');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, '01_menu.png') });
  const id = process.argv[3] || 'skylark';
  await page.evaluate((id) => window.__fs.startFlight({ aircraft: id, airport: 'KPXR', spawn: 0, weather: 'fair', time: 10.5, season: 'summer', fuel: 0.6, payload: 0.6, running: true }), id);
  await page.waitForFunction(() => window.__fs.state === 'flight', null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '02_cockpit.png') });
  const info = await page.evaluate(() => { const f = window.__fs; const a = f.ac; return { state: f.state, pos: a.fm.pos.toArray().map((v) => +v.toFixed(1)), onGround: a.fm.onGround, eng: a.fm.engines.map((e) => [e.state, +e.rpm.toFixed(0)]), stats: f.renderer.stats, fps: f.perf.fps, view: f.camRig.effectiveMode }; });
  console.log(JSON.stringify(info));
  console.log(errors.slice(0, 25).join('\n'));
  await browser.close();
})();
