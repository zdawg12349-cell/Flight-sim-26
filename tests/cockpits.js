// Screenshot every aircraft's cockpit (and an exterior chase view). Usage: node tests/cockpits.js outdir [ids,...]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2]; require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.__fs && window.__fs.state === 'menu', null, { timeout: 120000 });
  const ids = process.argv[3] ? process.argv[3].split(',') : await page.evaluate(() => Object.keys(window.__fsCatalog || {}));
  for (const id of ids) {
    await page.evaluate((id) => { const f = window.__fs; f.startFlight({ aircraft: id, airport: ['h22','h139','u205','r145','hl47'].includes(id) ? 'KPXR' : 'KPXR', spawn: 0, weather: 'fair', time: 11, season: 'summer', fuel: 0.6, payload: 0.6, running: true }); }, id);
    await page.waitForFunction(() => window.__fs.state === 'flight', null, { timeout: 120000 });
    await page.evaluate(() => { const s = window.__fsSettings; if (s) s.p.trainingHints = false; document.getElementById('hints').classList.add('hidden'); });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, `cp_${id}.png`) });
    if (process.argv[4] === 'ext') {
      await page.evaluate(() => window.__fs.camRig.setMode('chase', window.__fs.ac));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(out, `ex_${id}.png`) });
    }
    console.log(id, 'ok');
  }
  console.log(errors.slice(0, 20).join('\n'));
  await browser.close();
})();
