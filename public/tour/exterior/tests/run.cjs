const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Serve the folder first: python3 -m http.server 8765
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
const mock = fs.readFileSync(path.join(__dirname, 'mock-maps.js'), 'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SHOTS = process.env.SHOTS;

const cases = [
  // name, url query, scenario, google handling, expected mode, extra checks
  { name: 'no key', q: '?nokey', expect: 'photo', reason: 'missing-key' },
  { name: 'panorama ok', q: '?key=TESTKEY', scenario: 'ok', google: 'mock', expect: 'panorama' },
  { name: 'address only (geocode)', q: '?key=TESTKEY&lat=&lng=', scenario: 'ok', google: 'mock', expect: 'panorama' },
  { name: 'coverage at 150m retry', q: '?key=TESTKEY', scenario: 'far', google: 'mock', expect: 'panorama', radii: [50, 150] },
  { name: 'no coverage -> static map', q: '?key=TESTKEY', scenario: 'zero', google: 'mock', expect: 'static-map' },
  { name: 'no coverage + static fails -> photo', q: '?key=TESTKEY', scenario: 'zero-staticfail', google: 'mock', expect: 'photo' },
  { name: 'auth failure at load', q: '?key=TESTKEY', scenario: 'auth-load', google: 'mock', expect: 'photo', reason: 'auth-failure' },
  { name: 'auth failure during lookup', q: '?key=TESTKEY', scenario: 'auth-during', google: 'mock', expect: 'photo', reason: 'auth-failure' },
  { name: 'auth failure after panorama', q: '?key=TESTKEY', scenario: 'auth-late', google: 'mock', expect: 'photo', reason: 'auth-failure', wait: 600 },
  { name: 'offline (all google blocked)', q: '?key=TESTKEY', google: 'abort', expect: 'photo' },
  { name: 'script hangs -> timeout -> static fails -> photo', q: '?key=TESTKEY', google: 'hang', expect: 'photo', timeout: 20000 },
  { name: 'photo 404 -> placeholder', q: '?nokey&photo=missing.jpg', expect: 'photo', placeholder: true },
  { name: 'REAL google, fake key', q: '?key=AIzaSyFAKE_KEY_FOR_TESTING_000000000000', google: 'real', expect: 'photo', reason: 'auth-failure', wait: 4000 },
];

(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((s) => { window.__scenario = s; }, c.scenario || 'ok');
    if (c.google === 'mock') {
      await page.route(/maps\.googleapis\.com\/maps\/api\/js/, (r) => r.fulfill({ contentType: 'text/javascript', body: mock }));
      await page.route(/maps\.googleapis\.com\/maps\/api\/staticmap/, (r) =>
        c.scenario === 'zero-staticfail' ? r.fulfill({ status: 403, contentType: 'text/plain', body: 'denied' }) : r.fulfill({ contentType: 'image/png', body: png }));
    } else if (c.google === 'abort') {
      await page.route(/googleapis\.com|gstatic\.com/, (r) => r.abort('internetdisconnected'));
    } else if (c.google === 'hang') {
      await page.route(/maps\.googleapis\.com\/maps\/api\/js/, () => {});
      await page.route(/maps\.googleapis\.com\/maps\/api\/staticmap/, (r) => r.abort());
    }
    await page.goto(BASE + c.q, { waitUntil: 'domcontentloaded' });
    const mode = await page.evaluate(() => window.ext.ready);
    if (c.wait) await page.waitForTimeout(c.wait);
    const state = await page.evaluate(() => ({
      mode: window.ext.mode,
      status: document.getElementById('status').textContent,
      heading: document.querySelector('#exterior').dataset.heading,
      panoOpts: window.__panoOpts,
      reqs: window.__reqs,
      placeholder: !!document.querySelector('.tx-photo.tx-placeholder svg'),
      enterVisible: !!document.querySelector('.tx-enter')?.offsetParent,
    }));
    // Enter fires tour:room
    await page.click('.tx-enter');
    await page.waitForTimeout(500);
    const room = await page.textContent('#room-name');
    const hidden = await page.evaluate(() => document.querySelector('#exterior').classList.contains('tx-hidden'));
    let ok = state.mode === c.expect && room === 'Now in: hallway' && hidden && state.enterVisible && errors.length === 0;
    if (c.reason && !state.status.includes(c.reason)) ok = false;
    if (c.placeholder && !state.placeholder) ok = false;
    if (c.radii && JSON.stringify(state.reqs.map((r) => r.radius)) !== JSON.stringify(c.radii)) ok = false;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(48)} ready=${mode} final=${state.mode} | ${state.status}` +
      (state.heading ? ` | heading=${state.heading}` : '') + (state.reqs ? ` | radii=${state.reqs.map((r) => r.radius)}` : '') +
      (errors.length ? ` | ERRORS ${errors}` : ''));
    if (c.name === 'panorama ok') console.log('      pano opts:', JSON.stringify(state.panoOpts), 'req:', JSON.stringify(state.reqs[0]));
    if (SHOTS && ['no key', 'no coverage -> static map', 'panorama ok', 'photo 404 -> placeholder'].includes(c.name)) {
      await page.click('#back'); await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOTS, c.name.replace(/\W+/g, '-') + '.png') });
    }
    await page.close();
  }
  // Mobile size check
  const m = await browser.newPage({ viewport: { width: 375, height: 700 } });
  await m.goto(BASE + '?nokey'); await m.evaluate(() => window.ext.ready);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const btn = await m.evaluate(() => document.querySelector('.tx-enter').getBoundingClientRect().width);
  console.log(`${!overflow && btn > 300 ? 'PASS' : 'FAIL'}  mobile 375px: no h-scroll=${!overflow}, button width=${Math.round(btn)}`);
  if (SHOTS) await m.screenshot({ path: path.join(SHOTS, 'mobile.png') });
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
