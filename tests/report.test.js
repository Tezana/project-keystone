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
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }
(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE); await p.waitForSelector('.stat');
  await p.click('#menuBtn'); await p.click('[data-nav=\"report\"]'); await p.waitForSelector('.report');
  const txt = await p.textContent('.report');
  ok(txt.includes('Status report') && txt.includes('Prepared by Sofia Marchetti, Project Manager'), 'report header with author');
  ok((await p.textContent('.roverall')).includes('Watch'), 'overall status is Watch');
  const inds = await p.$$eval('.rind', a => a.map(x => x.textContent));
  ok(inds[0].includes('On track') && inds[1].includes('Watch') && inds[1].includes('Equipment near limit') && inds[2].includes('Watch') && inds[2].includes('3 of 8'), 'schedule / budget / decision indicators: ' + inds.join(' | '));
  ok((await p.textContent('.rsum-print')).includes('16% of tasks are done') && (await p.textContent('.rsum-print')).includes('2 program documents are waiting'), 'summary drafted from data');
  ok(await p.$$eval('.rtable >> nth=0', t => t[0].querySelectorAll('tr').length) === 7, 'phase table has 6 phases');
  ok(txt.includes('Confirm inclusion and exclusion criteria') && txt.includes('Needed soon'), 'decisions listed, urgent ones flagged');
  ok(txt.includes('Risk register v0.3') && txt.includes('Communication plan v0.2'), 'documents awaiting approval');
  ok(txt.includes('$26,192') && txt.includes('Near limit'), 'budget table');
  const done14 = await p.$$eval('.rsec:has(h3:text-is("Completed this period")) li', a => a.length);
  ok(done14 >= 1, 'completed this period (' + done14 + ')');
  // edit summary persists
  await p.fill('#r-summary', 'Phase 0 closed on time. Protocol work is under way.');
  ok((await p.textContent('.rsum-print')) === 'Phase 0 closed on time. Protocol work is under way.', 'edited summary shows in report');
  await p.reload(); await p.waitForSelector('.report');
  ok((await p.inputValue('#r-summary')).startsWith('Phase 0 closed'), 'edited summary kept after reload');
  await p.selectOption('#r-by', 'mokafor'); await p.waitForSelector('.rsub:has-text("Dr. Maya Okafor")'); ok(true, 'change author');
  await p.selectOption('#r-days', '30'); await p.waitForSelector('.rsub:has-text("Period")'); ok((await p.inputValue('#r-days')) === '30', 'change period');
  await p.click('button:text-is("Copy for email")'); await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok(clip.includes('OVERALL: WATCH') && clip.includes('Budget: Watch') && clip.includes('Phase 0 closed on time') && clip.includes('DECISIONS NEEDED'), 'copy for email gives plain text');
  await p.click('.linkbtn:text-is("Redo draft")'); ok((await p.inputValue('#r-summary')).includes('% of tasks are done'), 'redo draft restores generated summary');
  await p.screenshot({ path: S + '/report-screen.png', fullPage: true });
  // reacts to data: mark decisions done → indicator changes
  for (const n of [17, 18, 23]){ await p.goto(PAGE + '#/task/' + n); await p.waitForSelector('h2.t'); await p.click('button:text-is("Mark done")'); await p.waitForSelector('.chip.st-Done'); }
  await p.goto(PAGE + '#/report'); await p.waitForSelector('.report');
  ok((await p.textContent('.rind >> nth=2')).includes('On track'), 'decision indicator goes On track after decisions are made');
  await p.click('button:text-is("Reset demo")'); await p.waitForTimeout(300);
  // print
  await p.goto(PAGE + '#/report'); await p.waitForSelector('.report');
  await p.selectOption('#r-by', 'smarchetti'); await p.selectOption('#r-days', '14'); await p.waitForSelector('.rsub:has-text("Sofia")');
  await p.emulateMedia({ media: 'print' });
  ok(!(await p.isVisible('.rctl')) && !(await p.isVisible('#banner')) && await p.isVisible('.rhead'), 'print hides controls and site chrome, keeps report header');
  await p.pdf({ path: S + '/Project_Keystone_Status_Report.pdf', format: 'Letter', printBackground: true, margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });
  await p.emulateMedia({ media: 'screen' });
  const dk = await b.newPage({ viewport: { width: 1280, height: 1100 }, colorScheme: 'dark' });
  await dk.goto(PAGE + '#/report'); await dk.waitForSelector('.report'); await dk.emulateMedia({ media: 'print', colorScheme: 'dark' });
  await dk.pdf({ path: S + '/report-dark-print.pdf', format: 'Letter', printBackground: true });
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  await ph.goto(PAGE + '#/report'); await ph.waitForSelector('.report');
  ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: no sideways scroll');
  await ph.screenshot({ path: S + '/report-phone.png', fullPage: true });
  ok(errs.length === 0, 'no script errors ' + JSON.stringify(errs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
