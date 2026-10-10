// Run with: tests/run.sh   (see tests/README.md)
const path = require('path');
const S = process.env.OUT || path.join(__dirname, 'output');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
// Every test runs as if today were TEST_DATE, so dates and counts stay the same.
const _launch = chromium.launch.bind(chromium);
chromium.launch = async (o) => {
  const b = await _launch(o);
  const fix = async pg => { await pg.clock.setFixedTime(new Date(process.env.TEST_DATE || '2026-10-10T16:00:00')); return pg; };
  const np = b.newPage.bind(b), nc = b.newContext.bind(b);
  b.newPage = async (...a) => fix(await np(...a));
  b.newContext = async (...a) => { const c = await nc(...a); const cnp = c.newPage.bind(c); c.newPage = async (...x) => fix(await cnp(...x)); return c; };
  return b;
};
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE); await p.waitForSelector('.stat');
  ok(!(await p.$('#list')), 'dashboard no longer has the task list');
  ok(await p.$$eval('.dash .donut .slice', a => a.length) === 5, 'dashboard has the budget pie chart');
  ok((await p.textContent('.bpanel')).includes('Equipment is near its limit'), 'budget panel flags Equipment');
  const count = () => p.$$eval('#list a.item', a => a.length);
  const home = async () => { await p.click('#project'); await p.waitForSelector('.stat'); };
  const card = async n => { await p.click(`button.stat:has(.k:text-is("${n}"))`); await p.waitForSelector('#list'); };
  await card('Decisions waiting');
  ok(p.url().endsWith('#/tasks'), 'card opens the Tasks page');
  const dec = await p.$$eval('#list a.item', a => a.map(x => x.textContent));
  ok(dec.length === 8 && dec.every(t => t.includes('decision')), 'Decisions waiting → 8 decision tasks (' + dec.length + ')');
  ok((await p.textContent('.filterbar')).includes('Decisions waiting'), 'filter bar names the filter');
  await home(); await card('Tasks done'); ok(await count() === 9, 'Tasks done → 9');
  await home(); await card('Next deadline');
  const dl = await p.$$eval('#list a.item', a => a.map(x => x.textContent));
  ok(dl.length === 7 && dl.every(t => t.includes('Protocol and materials')), 'Next deadline → 7 Protocol tasks');
  await home(); await card('Overall progress'); ok(await count() === 55, 'Overall progress → all 55');
  await p.click('button:text-is("Clear filter")'); await p.waitForTimeout(200); ok(await count() === 46, 'Clear filter → 46 open');
  await home(); await p.click('button.phase:has-text("Phase 0")'); await p.waitForSelector('#list'); ok(await count() === 9, 'phase card → its tasks');
  await home(); await p.click('a.more:has-text("waiting on other tasks")'); await p.waitForSelector('#list');
  const bl = await p.$$eval('#list a.item', a => a.map(x => x.textContent));
  ok(bl.length === 21 && bl.every(t => t.includes('Waiting on')), 'blocked link → 21 waiting tasks');
  await home(); await p.focus('button.stat'); await p.keyboard.press('Enter'); await p.waitForSelector('#list'); ok(await count() === 55, 'keyboard Enter works on a box');
  // menu
  await home(); await p.click('#menuBtn');
  ok(await p.isVisible('#menuPanel') && (await p.getAttribute('#menuBtn', 'aria-expanded')) === 'true', 'menu opens');
  await p.keyboard.press('Escape'); ok(!(await p.isVisible('#menuPanel')), 'Escape closes menu');
  await p.click('#menuBtn'); await p.click('h1'); ok(!(await p.isVisible('#menuPanel')), 'click outside closes menu');
  await p.click('#menuBtn'); await p.click('#menuPanel [data-nav="budget"]'); await p.waitForSelector('.meters');
  ok(!(await p.isVisible('#menuPanel')) && (await p.textContent('#menuBtn')).includes('Budget'), 'menu link navigates, closes, and button shows the page name');
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  for (const h of ['', '#/tasks', '#/messages', '#/task/10']){ await ph.goto(PAGE + h); await ph.waitForTimeout(500); ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: no sideways scroll ' + (h || 'home')); }
  await ph.goto(PAGE); await ph.waitForSelector('.stat'); await ph.click('#menuBtn'); await ph.screenshot({ path: S + '/phone-menu.png' });
  ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: open menu fits');
  ok(errs.length === 0, 'no script errors ' + JSON.stringify(errs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
