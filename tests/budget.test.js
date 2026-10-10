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
const fs = require('fs');
const issues = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/issues.json')));
const milestones = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/milestones.json')));
const budgetFile = fs.readFileSync(path.join(ROOT, 'tracker/budget.json'), 'utf8');
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }
(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE); await p.waitForSelector('.stat');
  await p.click('#menuBtn'); await p.click('[data-nav=\"budget\"]'); await p.waitForSelector('.donut');
  const kp = await p.textContent('.stats');
  ok(kp.includes('$184,250') && kp.includes('$26,192') && kp.includes('14% of budget') && kp.includes('$158,058'), 'summary tiles: budget, spent, remaining');
  ok(kp.includes('Equipment (near limit)'), 'lines to watch flags Equipment');
  ok(await p.$$eval('.meters li', a => a.length) === 8, '8 budget line bars');
  ok((await p.textContent('.meters li:has-text("Equipment")')).includes('Near limit'), 'Equipment bar labeled Near limit');
  ok(await p.$$eval('.donut .slice', a => a.length) === 5, 'donut has 5 slices (lines with spending)');
  ok((await p.textContent('.legend')).includes('Personnel$14,00053%'), 'legend shows name, amount, share');
  const bx = await p.$eval('.donut', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2 + r.width * 0.39 * Math.sin(0.3), y: r.top + r.height / 2 - r.height * 0.39 * Math.cos(0.3) }; }); await p.mouse.move(bx.x, bx.y); ok(await p.isVisible('.vtip') && (await p.textContent('.vtip')).includes('Personnel'), 'donut hover tooltip');
  await p.hover('.meters li >> nth=2'); ok((await p.textContent('.vtip')).includes('$898 left'), 'bar hover tooltip shows what is left');
  ok(await p.$$eval('.exp li', a => a.length) === 7, '7 expenses listed');
  ok((await p.textContent('.exp li >> nth=0')).includes('Spare sensor batteries'), 'newest expense first');
  ok((await p.request.get((process.env.SITE_URL || 'http://localhost:8766') + '/' + await p.getAttribute('.exp li:has-text("70 hydration") a:text-is("Voucher")', 'href'))).status() === 200, 'voucher link opens');
  await p.selectOption('#expLine', 'equipment'); ok((await p.textContent('#expCount')) === '3 expenses · $8,902', 'line filter with total');
  await p.selectOption('#expLine', ''); await p.selectOption('#expPerson', 'glin'); ok((await p.textContent('#expCount')) === '1 expense · $1,500', 'person filter');
  await p.selectOption('#expPerson', ''); await p.fill('#expSearch', 'northwind'); ok((await p.textContent('#expCount')) === '3 expenses · $8,902', 'search by vendor');
  await p.fill('#expSearch', '');
  await p.screenshot({ path: S + '/budget-page.png', fullPage: true });
  // log expense
  await p.click('button:text-is("+ Log expense")'); await p.click('button:text-is("Log expense")');
  ok((await p.textContent('.sheet .error')).includes('amount'), 'amount required');
  await p.fill('#x-amount', '$2,250.50'); await p.fill('#x-desc', 'Recruitment flyers and printing'); await p.selectOption('#x-line', 'reimburse');
  await p.fill('#x-vendor', 'Print shop'); await p.selectOption('#x-task', '22'); await p.selectOption('#x-by', 'pnatarajan');
  await p.setInputFiles('#x-file', { name: 'receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF receipt') });
  await p.click('button:text-is("Log expense")'); await p.waitForSelector('.exp li:has-text("Recruitment flyers")');
  ok((await p.textContent('.stats')).includes('$28,442.50'), 'spent updates with cents');
  ok(await p.$$eval('.donut .slice', a => a.length) === 6, 'donut gains a slice');
  await p.waitForFunction(() => [...document.querySelectorAll('.exp a')].some(a => a.textContent === 'Voucher' && a.href.startsWith('blob:')));
  const vh = await p.$$eval('.exp li', ls => { const li = ls.find(l => l.textContent.includes('Recruitment')); return [...li.querySelectorAll('a')].find(a => a.textContent === 'Voucher').href; });
  ok((await p.evaluate(h => fetch(h).then(r => r.text()), vh)).includes('receipt'), 'uploaded receipt opens');
  // over budget warning
  p.once('dialog', d => { ok(d.message().includes('over budget'), 'over-budget warning asks first'); d.accept(); });
  await p.click('button:text-is("+ Log expense")'); await p.fill('#x-amount', '1200'); await p.fill('#x-desc', 'Extra sensors'); await p.selectOption('#x-line', 'equipment'); await p.selectOption('#x-by', 'mbell');
  await p.click('button:text-is("Log expense")'); await p.waitForSelector('.exp li:has-text("Extra sensors")');
  ok((await p.textContent('.meters li:has-text("Equipment")')).includes('Over budget') && (await p.textContent('.stats')).includes('Equipment (over)'), 'Equipment shows Over budget');
  // edit + delete
  await p.click('button[aria-label="Edit expense: Extra sensors"]'); await p.fill('#x-amount', '500'); await p.click('button:text-is("Save changes")');
  await p.waitForSelector('.exp li:has-text("Extra sensors"):has-text("$500")'); ok((await p.textContent('.meters li:has-text("Equipment")')).includes('Near limit'), 'edit amount moves it back to Near limit');
  p.once('dialog', d => d.accept());
  await p.click('button[aria-label="Delete expense: Extra sensors"]'); await p.waitForTimeout(400);
  ok(!(await p.$('.exp li:has-text("Extra sensors")')), 'delete expense');
  await p.reload(); await p.waitForSelector('.exp li:has-text("Recruitment flyers")'); ok(true, 'expenses survive reload');
  await p.click('button:text-is("Reset demo")'); await p.waitForTimeout(400); await p.goto(PAGE + '#/budget'); await p.waitForSelector('.donut');
  ok((await p.textContent('.stats')).includes('$26,192'), 'reset demo restores the budget');
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  await ph.goto(PAGE + '#/budget'); await ph.waitForSelector('.donut');
  ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: no sideways scroll');
  await ph.screenshot({ path: S + '/budget-phone.png', fullPage: true });
  const dk = await b.newPage({ viewport: { width: 1280, height: 1100 }, colorScheme: 'dark' });
  await dk.goto(PAGE + '#/budget'); await dk.waitForSelector('.donut'); await dk.screenshot({ path: S + '/budget-dark.png' });
  ok(errs.length === 0, 'no script errors in demo ' + JSON.stringify(errs));

  // owner mode
  const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const oerrs = []; o.on('pageerror', e => oerrs.push(e.message)); o.on('dialog', d => d.accept());
  let reg = budgetFile, sha = 'b1'; const files = {};
  await o.route('https://api.github.com/**', async r => {
    const req = r.request(); const u = new URL(req.url()); const path = decodeURIComponent(u.pathname); const m = req.method();
    const json = (st, body) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/repos/Tezana/project-keystone') return json(200, { permissions: { push: true } });
    if (path.endsWith('/milestones')) return json(200, u.searchParams.get('page') === '1' ? milestones : []);
    if (path.endsWith('/issues') && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? issues : []);
    if (path.endsWith('/contents/tracker/budget.json')){
      if (m === 'GET') return json(200, { sha, content: Buffer.from(reg).toString('base64') });
      const body = JSON.parse(req.postData()); if (body.sha !== sha) return json(409, { message: 'sha mismatch' });
      reg = Buffer.from(body.content, 'base64').toString(); sha = 'b' + Date.now(); return json(200, { content: { sha } });
    }
    const mm = /\/contents\/(docs\/budget\/vouchers\/.+)$/.exec(path);
    if (mm && m === 'PUT'){ files[mm[1]] = JSON.parse(req.postData()).content; return json(201, { content: { sha: 'v' } }); }
    if (/\/contents\//.test(path)) return json(404, { message: 'Not Found' });
    if (/\/comments$/.test(path)) return json(200, []);
    return json(404, { message: 'not mocked ' + m + ' ' + path });
  });
  await o.goto(PAGE + '#/owner'); await o.fill('#key', 'github_pat_TEST'); await o.click('button:text-is("Unlock owner mode")'); await o.waitForSelector('.stat');
  await o.goto(PAGE + '#/budget'); await o.waitForSelector('.donut');
  ok((await o.textContent('#view .eyebrow')).includes('saves to GitHub'), 'owner mode budget page');
  await o.click('button:text-is("+ Log expense")'); await o.fill('#x-amount', '640'); await o.fill('#x-desc', 'Data platform first month'); await o.selectOption('#x-line', 'software'); await o.selectOption('#x-by', 'tadeyemi');
  await o.setInputFiles('#x-file', { name: 'invoice 1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF inv') });
  await o.click('button:text-is("Log expense")'); await o.waitForSelector('.exp li:has-text("Data platform first month")');
  const saved = JSON.parse(reg).expenses.find(e => e.description === 'Data platform first month');
  ok(saved && saved.amount === 640 && saved.id === 'e8' && /^budget\/vouchers\/\d{4}-\d{2}-\d{2}--invoice_1\.pdf$/.test(saved.voucher), 'owner expense saved to budget.json with voucher path (' + (saved && saved.voucher) + ')');
  ok(Object.keys(files).length === 1, 'owner voucher uploaded to docs/budget/vouchers');
  ok((await o.getAttribute('.exp li:has-text("Data platform first month") a:text-is("Voucher")', 'href')).startsWith('https://raw.githubusercontent.com/'), 'owner voucher link opens from the repo');
  ok(oerrs.length === 0, 'no script errors in owner mode ' + JSON.stringify(oerrs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
