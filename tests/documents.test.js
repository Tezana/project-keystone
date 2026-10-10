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
const docsFile = fs.readFileSync(path.join(ROOT, 'tracker/documents.json'), 'utf8');
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }
const file = (name, txt) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF ' + txt) });

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE); await p.waitForSelector('.stat');
  await p.click('#menuBtn'); await p.click('[data-nav=\"documents\"]'); await p.waitForSelector('.doc');
  ok(await p.$$eval('.doc', a => a.length) === 6, '6 program documents listed');
  ok((await p.textContent('#view')).includes('6 program documents (4 approved, 2 draft) · 3 task files'), 'header counts are right');
  const plan = p.locator('.doc[aria-label="Program plan"]');
  ok((await plan.textContent()).includes('Approved by Dr. Maya Okafor · Oct 2, 2026') && (await plan.textContent()).includes('v1.2'), 'plan shows version and who approved it');
  ok((await p.request.get((process.env.SITE_URL || 'http://localhost:8766') + '/' + await plan.locator('a.dtitle').getAttribute('href'))).status() === 200, 'program plan file opens');
  await plan.locator('summary').click();
  const hl = await plan.locator('.hist a').evaluateAll(a => a.map(x => x.getAttribute('href')));
  ok(hl.length === 2, 'plan has 2 previous versions');
  ok((await Promise.all(hl.map(h => p.request.get((process.env.SITE_URL || 'http://localhost:8766') + '/' + h).then(r => r.status())))).every(s => s === 200), 'previous versions open');
  await p.click('.seg button:text-is("Draft")'); ok(await p.$$eval('.doc', a => a.length) === 2, 'Draft filter shows 2');
  await p.click('.seg button:text-is("Approved")'); ok(await p.$$eval('.doc', a => a.length) === 4, 'Approved filter shows 4');
  await p.click('.seg button:text-is("All")');
  await p.screenshot({ path: S + '/docs-page.png', fullPage: true });

  // approve the draft risk register
  await p.click('button[aria-label="Approve Risk register"]'); await p.selectOption('#ap-risks', 'smarchetti');
  await p.click('button:text-is("Confirm approval")'); await p.waitForSelector('.doc[aria-label="Risk register"] .chip.approved');
  ok((await p.textContent('.doc[aria-label="Risk register"]')).includes('Approved by Sofia Marchetti'), 'approve records who approved it');
  // new version of the plan → v1.3 Draft, history 3
  await p.click('button[aria-label="Upload a new version of Program plan"]');
  await p.click('button:text-is("Upload v1.3")'); ok(await p.isVisible('.doc[aria-label="Program plan"] .error'), 'new version without a file is rejected');
  await p.setInputFiles('#nv-plan', file('plan v13.pdf', 'version 1.3')); await p.click('button:text-is("Upload v1.3")');
  await p.waitForSelector('.doc[aria-label="Program plan"] .ver:text-is("v1.3")');
  const plan2 = await p.textContent('.doc[aria-label="Program plan"]');
  ok(plan2.includes('Draft') && plan2.includes('Previous versions (3)'), 'new version goes back to Draft and keeps history');
  await p.waitForFunction(() => document.querySelector('.doc[aria-label="Program plan"] a.dtitle').href.startsWith('blob:'));
  const bh = await p.getAttribute('.doc[aria-label="Program plan"] a.dtitle', 'href');
  ok((await p.evaluate(h => fetch(h).then(r => r.text()), bh)).includes('version 1.3'), 'new version file opens');
  // add a document
  await p.click('button:text-is("+ Add document")'); await p.click('button:text-is("Add document")');
  ok((await p.textContent('.sheet .error')).includes('title'), 'add document needs a title');
  await p.fill('#d-title', 'Data management plan'); await p.click('button:text-is("Add document")');
  ok((await p.textContent('.sheet .error')).includes('file'), 'add document needs a file');
  await p.selectOption('#d-kind', 'other'); await p.selectOption('#d-owner', 'tadeyemi'); await p.fill('#d-summary', 'How data is collected, checked, and stored.');
  await p.selectOption('#d-status', 'approved'); await p.selectOption('#d-approver', 'mokafor');
  await p.setInputFiles('#d-file', file('dmp.pdf', 'dmp')); await p.click('button:text-is("Add document")');
  await p.waitForSelector('.doc[aria-label="Data management plan"]');
  const dmp = await p.textContent('.doc[aria-label="Data management plan"]');
  ok(dmp.includes('v1.0') && dmp.includes('Approved by Dr. Maya Okafor') && dmp.includes('Tom Adeyemi'), 'added approved document starts at v1.0');
  await p.reload(); await p.waitForSelector('.doc[aria-label="Data management plan"]'); ok(await p.$$eval('.doc', a => a.length) === 7, 'documents survive a reload');
  await p.click('button[aria-label="Remove Data management plan"]'); await p.waitForTimeout(400);
  ok(await p.$$eval('.doc', a => a.length) === 6, 'remove document');

  // task files
  const rows = () => p.$$eval('.files li:not(.fnone)', a => a.length);
  ok(await rows() === 3, '3 task files listed');
  ok((await p.textContent('.files')).includes('#17 Confirm inclusion and exclusion criteria'), 'task file shows its task');
  await p.selectOption('#attKind', 'memo'); ok(await rows() === 1, 'type filter');
  await p.selectOption('#attKind', ''); await p.selectOption('#attPhase', 'Phase 0: Study concept'); ok(await rows() === 2, 'phase filter');
  await p.selectOption('#attPhase', ''); await p.selectOption('#attPerson', 'smarchetti'); ok(await rows() === 1, 'person filter');
  await p.selectOption('#attPerson', ''); await p.fill('#attSearch', 'voucher'); ok(await rows() === 1, 'search');
  ok((await p.textContent('#attCount')) === '1 of 3 files', 'count shows filtered');
  await p.fill('#attSearch', '');
  await p.click('.files a.tlink >> nth=0'); await p.waitForSelector('h2.t'); ok(p.url().includes('#/task/'), 'task link opens the task');
  await p.goto(PAGE + '#/task/30'); await p.waitForSelector('#a-file');
  await p.setInputFiles('#a-file', file('DB setup report.pdf', 'db')); await p.click('button:text-is("Attach")'); await p.waitForSelector('.files li:has-text("DB setup report")');
  await p.goto(PAGE + '#/documents'); await p.waitForSelector('.files li');
  ok(await rows() === 4 && (await p.textContent('.files li >> nth=0')).includes('DB setup report'), 'new task attachment appears at the top');
  await p.waitForFunction(() => [...document.querySelectorAll('.files li a')].some(a => a.href.startsWith('blob:')));
  ok(true, 'demo file link resolves');
  await p.click('button:text-is("Reset demo")'); await p.waitForTimeout(400); await p.goto(PAGE + '#/documents'); await p.waitForSelector('.doc');
  ok((await p.textContent('#view')).includes('6 program documents (4 approved, 2 draft) · 3 task files'), 'reset demo restores documents');
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  await ph.goto(PAGE + '#/documents'); await ph.waitForSelector('.doc');
  ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: no sideways scroll');
  await ph.screenshot({ path: S + '/docs-phone.png' });
  await ph.goto(PAGE); await ph.waitForSelector('.stat');
  ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: menu fits on dashboard');
  await ph.screenshot({ path: S + '/docs-phone-home.png' });
  ok(errs.length === 0, 'no script errors in demo ' + JSON.stringify(errs));

  // ---------- Owner mode ----------
  const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const oerrs = []; o.on('pageerror', e => oerrs.push(e.message)); o.on('dialog', d => d.accept());
  let reg = docsFile, regSha = 'r1'; const files = { 'docs/documents/Study_charter_v1.0.pdf': 'c1' }; const log = [];
  await o.route('https://api.github.com/**', async r => {
    const req = r.request(); const u = new URL(req.url()); const path = decodeURIComponent(u.pathname); const m = req.method();
    const json = (st, body) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/repos/Tezana/project-keystone') return json(200, { permissions: { push: true } });
    if (path.endsWith('/milestones')) return json(200, u.searchParams.get('page') === '1' ? milestones : []);
    if (path.endsWith('/issues') && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? issues : []);
    if (path.endsWith('/contents/tracker/team.json')) return json(404, { message: 'Not Found' });
    if (path.endsWith('/contents/tracker/documents.json')){
      if (m === 'GET') return json(200, { sha: regSha, content: Buffer.from(reg).toString('base64') });
      const body = JSON.parse(req.postData()); log.push('PUT reg ' + body.message);
      if (body.sha !== regSha) return json(409, { message: 'sha mismatch' });
      reg = Buffer.from(body.content, 'base64').toString(); regSha = 'r' + (log.length + 1); return json(200, { content: { sha: regSha } });
    }
    const mm = /\/contents\/(docs\/documents\/.+)$/.exec(path);
    if (mm && m === 'PUT'){ files[mm[1]] = 'f' + log.length; log.push('PUT file ' + mm[1]); return json(201, { content: { sha: files[mm[1]] } }); }
    if (mm && m === 'GET') return files[mm[1]] ? json(200, { sha: files[mm[1]] }) : json(404, { message: 'Not Found' });
    if (mm && m === 'DELETE'){ log.push('DELETE ' + mm[1]); delete files[mm[1]]; return json(200, {}); }
    if (/\/contents\/docs\/attachments/.test(path)) return json(404, { message: 'Not Found' });
    if (/\/comments$/.test(path)) return json(200, []);
    return json(404, { message: 'not mocked ' + m + ' ' + path });
  });
  await o.goto(PAGE + '#/owner'); await o.fill('#key', 'github_pat_TEST'); await o.click('button:text-is("Unlock owner mode")'); await o.waitForSelector('.stat');
  await o.goto(PAGE + '#/documents'); await o.waitForSelector('.doc');
  ok((await o.getAttribute('.doc[aria-label="Study charter"] a.dtitle', 'href')).startsWith('https://raw.githubusercontent.com/Tezana/project-keystone/main/docs/documents/'), 'owner links open from the repo');
  await o.click('button[aria-label="Approve Communication plan"]'); await o.click('button:text-is("Confirm approval")');
  await o.waitForSelector('.doc[aria-label="Communication plan"] .chip.approved');
  const r1 = JSON.parse(reg).find(d => d.id === 'comms');
  ok(r1.status === 'approved' && r1.approvedBy === 'mokafor' && /^\d{4}-\d{2}-\d{2}$/.test(r1.approved), 'owner approve saves to documents.json');
  ok(!reg.includes('"size"'), 'register file stays clean (no sizes)');
  await o.click('button[aria-label="Upload a new version of Study budget"]'); await o.setInputFiles('#nv-budget', file('b.pdf', 'budget 1.2')); await o.click('button:text-is("Upload v1.2")');
  await o.waitForSelector('.doc[aria-label="Study budget"] .ver:text-is("v1.2")');
  const r2 = JSON.parse(reg).find(d => d.id === 'budget');
  ok(files['docs/documents/Study_budget_v1.2.pdf'] && r2.file === 'documents/Study_budget_v1.2.pdf' && r2.status === 'draft' && r2.history[0].version === '1.1' && r2.history[0].approvedBy === 'mokafor', 'owner new version uploads the file and keeps v1.1 in history');
  await o.click('button[aria-label="Remove Study charter"]'); await o.waitForTimeout(600);
  ok(log.includes('DELETE docs/documents/Study_charter_v1.0.pdf') && !JSON.parse(reg).some(d => d.id === 'charter'), 'owner remove deletes the file and the register entry');
  ok(oerrs.length === 0, 'no script errors in owner mode ' + JSON.stringify(oerrs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
