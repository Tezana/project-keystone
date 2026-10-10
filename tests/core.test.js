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
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }

(async () => {
  const b = await chromium.launch(LAUNCH);

  // ---------------- DEMO MODE ----------------
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let apiCalls = 0; await p.route('https://api.github.com/**', r => { apiCalls++; r.abort(); });
  await p.goto(PAGE); await p.waitForSelector('.stat');
  ok((await p.textContent('#banner')).includes('Live demo'), 'demo banner shows');
  const pct0 = await p.textContent('.stat .v');
  ok(pct0.trim() === '16%', 'starts at 16% (' + pct0 + ')');
  ok(!(await p.$('a.item[href*="github.com"]')), 'task rows link inside the site');

  await p.goto(PAGE + '#/tasks'); await p.waitForSelector('a.item'); await p.click('a.item[href="#/task/17"]'); await p.waitForSelector('h2.t');
  ok((await p.textContent('h2.t')).includes('Confirm inclusion'), 'task page opens in-site');
  await p.click('button:text-is("Mark done"), a:text-is("Mark done")'); await p.waitForSelector('.chip.st-Done');
  ok(true, 'mark done works');
  await p.fill('#note', 'Went with the four recommended setup questions.');
  await p.click('button:text-is("Add note"), a:text-is("Add note")'); await p.waitForSelector('.notes .txt:has-text("four recommended")');
  ok(true, 'note added');
  await p.click('button:text-is("Edit"), a:text-is("Edit")'); await p.fill('#f-title', 'Confirm inclusion questions (final)');
  await p.fill('#f-due', '2026-10-20'); await p.click('button:text-is("Save changes"), a:text-is("Save changes")'); await p.waitForSelector('h2.t:has-text("(final)")');
  ok((await p.textContent('.facts')).includes('Oct 20, 2026'), 'edit saves title and due date');

  await p.click('button:text-is("← Back to dashboard"), a:text-is("← Back to dashboard")'); await p.waitForSelector('.stat');
  const pct1 = await p.textContent('.stat .v');
  ok(pct1.trim() === '18%', 'progress updates to 18% (' + pct1 + ')');

  await p.click('[data-nav="new"]'); await p.waitForSelector('#f-title');
  await p.click('button:text-is("Create task"), a:text-is("Create task")'); ok(await p.isVisible('.error'), 'empty title is rejected');
  await p.fill('#f-title', 'Film the tracker walkthrough'); await p.fill('#f-body', 'Two-minute screen recording.');
  await p.check('#f-l-writeup'); await p.click('button:text-is("Create task"), a:text-is("Create task")'); await p.waitForSelector('h2.t:has-text("Film the tracker")');
  ok(p.url().includes('#/task/56'), 'new task created as #56 (' + p.url() + ')');
  await p.click('text=Won\'t do'); await p.waitForSelector('.chip.st-Won');
  ok(true, "won't do works");

  await p.reload(); await p.waitForSelector('h2.t');
  ok((await p.textContent('h2.t')).includes('Film the tracker'), 'demo changes survive a reload');

  await p.goto(PAGE + '#/about'); await p.waitForSelector('article');
  ok(await p.isVisible('a[href="build-history.pdf"]'), 'about page has PDF download');
  const pdf = await p.request.get((process.env.SITE_URL || 'http://localhost:8766') + '/build-history.pdf'); ok(pdf.status() === 200, 'PDF is served');

  await p.goto(PAGE); await p.waitForSelector('.stat');
  await p.click('button:text-is("Reset demo"), a:text-is("Reset demo")'); await p.waitForTimeout(500);
  ok((await p.textContent('.stat .v')).trim() === '16%', 'reset demo restores 16%');
  await p.screenshot({ path: S + '/v2-home.png' });
  await p.goto(PAGE + '#/task/19'); await p.waitForSelector('h2.t'); await p.screenshot({ path: S + '/v2-task.png' });
  await p.goto(PAGE + '#/about'); await p.waitForSelector('article'); await p.screenshot({ path: S + '/v2-about.png', fullPage: true });
  ok(apiCalls === 0, 'demo mode never calls GitHub (' + apiCalls + ')');
  ok(errs.length === 0, 'no script errors in demo: ' + JSON.stringify(errs));

  // phone
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  await ph.goto(PAGE + '#/task/19'); await ph.waitForSelector('h2.t');
  ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on phone');
  await ph.screenshot({ path: S + '/v2-phone.png' });

  // ---------------- OWNER MODE (simulated GitHub) ----------------
  const octx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const o = await octx.newPage();
  const oerrs = []; o.on('pageerror', e => oerrs.push(e.message));
  const calls = [];
  let db = JSON.parse(JSON.stringify(issues)); const comments = {};
  await o.route('https://api.github.com/**', async r => {
    const req = r.request(); const u = new URL(req.url()); const path = u.pathname; const m = req.method();
    const auth = req.headers()['authorization'] || '';
    calls.push(m + ' ' + path);
    if (auth !== 'Bearer github_pat_TEST') return r.fulfill({ status: 401, body: '{"message":"Bad credentials"}' });
    const json = (s, b) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/repos/Tezana/project-keystone' ) return json(200, { permissions: { push: true } });
    if (path.endsWith('/milestones')) return json(200, u.searchParams.get('page') === '1' ? milestones : []);
    if (path.endsWith('/issues') && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? db.slice(0,100) : []);
    if (path.endsWith('/issues') && m === 'POST'){ const body = JSON.parse(req.postData()); const ms = milestones.find(x => x.number === body.milestone); const i = { number: 56, title: body.title, body: body.body, state: 'open', state_reason: null, labels: body.labels.map(n => ({ name: n })), milestone: ms || null, created_at: '2026-10-10T20:00:00Z', closed_at: null, comments: 0 }; db.push(i); return json(201, i); }
    let mm = /\/issues\/(\d+)\/comments$/.exec(path);
    if (mm && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? (comments[mm[1]] || []) : []);
    if (mm && m === 'POST'){ const c = { body: JSON.parse(req.postData()).body, created_at: '2026-10-10T20:00:00Z' }; (comments[mm[1]] = comments[mm[1]] || []).push(c); return json(201, c); }
    mm = /\/issues\/(\d+)$/.exec(path);
    if (mm && m === 'PATCH'){ const i = db.find(x => x.number == mm[1]); const body = JSON.parse(req.postData()); Object.assign(i, body); if (body.state === 'closed'){ i.closed_at = '2026-10-10T20:00:00Z'; i.state_reason = body.state_reason; } if (body.state === 'open') i.state_reason = 'reopened'; if (body.labels) i.labels = body.labels.map(n => ({ name: n })); if ('milestone' in body) i.milestone = milestones.find(x => x.number === body.milestone) || null; return json(200, i); }
    return json(404, { message: 'not mocked ' + m + ' ' + path });
  });
  await o.goto(PAGE + '#/owner'); await o.waitForSelector('#key');
  await o.fill('#key', 'wrong'); await o.click('button:text-is("Unlock owner mode"), a:text-is("Unlock owner mode")'); await o.waitForSelector('.error:not([hidden])');
  ok(true, 'bad key rejected');
  await o.fill('#key', 'github_pat_TEST'); await o.click('button:text-is("Unlock owner mode"), a:text-is("Unlock owner mode")'); await o.waitForSelector('.banner.owner');
  ok((await o.textContent('#banner')).includes('Owner mode'), 'owner mode unlocks');
  await o.waitForSelector('.stat');
  await o.goto(PAGE + '#/tasks'); await o.waitForSelector('a.item'); await o.click('a.item[href="#/task/18"]'); await o.waitForSelector('h2.t');
  await o.click('button:text-is("Mark done"), a:text-is("Mark done")'); await o.waitForSelector('.chip.st-Done');
  ok(calls.some(c => c === 'PATCH /repos/Tezana/project-keystone/issues/18'), 'mark done sends PATCH to GitHub');
  await o.fill('#note', 'Default: check-in only.'); await o.click('button:text-is("Add note"), a:text-is("Add note")'); await o.waitForSelector('.notes .txt:has-text("check-in only")');
  ok(calls.some(c => c === 'POST /repos/Tezana/project-keystone/issues/18/comments'), 'note posts a GitHub comment');
  await o.click('button:text-is("Edit"), a:text-is("Edit")'); await o.fill('#f-due', '2026-10-25'); await o.click('button:text-is("Save changes"), a:text-is("Save changes")'); await o.waitForSelector('.facts:has-text("Oct 25, 2026")');
  ok(db.find(x => x.number === 18).body.includes('keystone:due=2026-10-25'), 'due date stored in the GitHub issue');
  await o.click('[data-nav="new"]'); await o.fill('#f-title', 'Owner-made task'); await o.selectOption('#f-phase', 'Phase 3: Lab setup'); await o.check('#f-l-lab');
  await o.click('button:text-is("Create task"), a:text-is("Create task")'); await o.waitForSelector('h2.t:has-text("Owner-made task")');
  const created = db.find(x => x.number === 56);
  ok(created && created.milestone && created.milestone.title === 'Phase 3: Lab setup', 'new task POSTs with the right phase');
  await o.click('button:text-is("Lock owner mode"), a:text-is("Lock owner mode")'); await o.waitForSelector('.banner:not(.owner)');
  ok(await o.evaluate(() => !localStorage.getItem('keystone-owner-token')), 'lock removes the key');
  ok(oerrs.length === 0, 'no script errors in owner mode: ' + JSON.stringify(oerrs));

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
