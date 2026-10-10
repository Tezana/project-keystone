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
const teamFile = fs.readFileSync(path.join(ROOT, 'tracker/team.json'), 'utf8');
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE); await p.waitForSelector('.stat');
  const count = () => p.$$eval('#list a.item', a => a.length);

  ok(await p.$$eval('.load .lrow', a => a.length) === 8, "Who's on what panel lists 8 people");
  await p.goto(PAGE + '#/tasks'); await p.waitForSelector('a.item');
  ok((await p.textContent('a.item[href="#/task/17"]')).includes('Dr. Maya Okafor'), 'task row shows who it is assigned to');
  await p.selectOption('#personFilter', 'mbell'); await p.waitForTimeout(200);
  const mb = await p.$$eval('#list a.item', a => a.map(x => x.textContent));
  ok(mb.length > 0 && mb.every(t => t.includes('Marcus Bell')), 'person filter shows only Marcus Bell tasks (' + mb.length + ')');
  ok((await p.textContent('.filterbar')).includes('assigned to: Marcus Bell'), 'filter bar names the person');
  await p.click('button:text-is("Clear filter")'); await p.waitForTimeout(200);
  ok(await count() === 46, 'clear filter resets person');
  await p.goto(PAGE); await p.waitForSelector('.lrow'); await p.click('.lrow[aria-label^="Hannah Kowalski"]'); await p.waitForSelector('#list a.item');
  const hk = await p.$$eval('#list a.item', a => a.map(x => x.textContent));
  ok(hk.length > 0 && hk.every(t => t.includes('Hannah Kowalski')), 'clicking a name in the panel filters to them (' + hk.length + ')');
  await p.screenshot({ path: S + '/team-home.png' });

  // Task detail + reassign
  await p.goto(PAGE + '#/task/17'); await p.waitForSelector('.assignee');
  ok((await p.textContent('.assignee')).includes('Principal Investigator · Study Leadership'), 'task page shows name, title, department');
  await p.screenshot({ path: S + '/team-task.png' });
  await p.click('button:text-is("Edit")'); await p.selectOption('#f-owner', 'glin');
  await p.click('button:text-is("Save changes")'); await p.waitForSelector('.assignee:has-text("Grace Lin")');
  ok(true, 'reassigning a task saves');

  // Team page
  await p.click('#menuBtn'); await p.click('[data-nav=\"team\"]'); await p.waitForSelector('.person');
  ok(await p.$$eval('.dept', a => a.length) === 5, 'team page groups into 5 departments');
  ok(await p.$$eval('.person', a => a.length) === 8, 'team page shows 8 people');
  await p.screenshot({ path: S + '/team-page.png', fullPage: true });
  await p.click('button:text-is("+ Add member")'); await p.click('button:text-is("Add member")');
  ok(await p.isVisible('.error'), 'empty member form is rejected');
  await p.fill('#m-name', 'Jordan Ellis'); await p.fill('#m-title', 'Quality Assurance Lead'); await p.fill('#m-team', 'Quality Assurance');
  await p.click('button:text-is("Add member")'); await p.waitForSelector('.person[aria-label="Jordan Ellis"]');
  ok(await p.$$eval('.dept', a => a.length) === 6, 'new department appears');
  await p.click('button[aria-label="Edit Jordan Ellis"]'); await p.fill('#m-title', 'QA Lead'); await p.click('button:text-is("Save changes")');
  await p.waitForSelector('.person[aria-label="Jordan Ellis"]:has-text("QA Lead")'); ok(true, 'edit member saves');
  // assign new task to new member
  await p.click('[data-nav="new"]'); await p.fill('#f-title', 'Audit the consent forms'); await p.selectOption('#f-owner', 'jellis');
  await p.click('button:text-is("Create task")'); await p.waitForSelector('.assignee:has-text("Jordan Ellis")');
  ok(true, 'new task can be assigned to the new member');
  await p.reload(); await p.waitForSelector('.assignee'); ok((await p.textContent('.assignee')).includes('Jordan Ellis'), 'team + assignment survive reload');
  // remove member → shows unassigned
  await p.goto(PAGE + '#/team'); await p.waitForSelector('.person');
  p.once('dialog', d => d.accept());
  await p.click('button[aria-label="Remove Jordan Ellis"]'); await p.waitForTimeout(300);
  ok(!(await p.$('.person[aria-label="Jordan Ellis"]')), 'remove member works');
  ok((await p.textContent('main, #view')).includes('1 open task unassigned'), 'team page flags unassigned work');
  await p.goto(PAGE + '#/task/56'); await p.waitForSelector('.assignee'); ok((await p.textContent('.assignee')).includes('Unassigned'), 'orphaned task shows Unassigned');
  // View tasks button
  await p.goto(PAGE + '#/team'); await p.waitForSelector('.person');
  await p.click('.person[aria-label="Daniel Reyes"] button:text-is("View tasks")'); await p.waitForSelector('.filterbar');
  ok((await p.textContent('.filterbar')).includes('Daniel Reyes'), 'View tasks opens the task list filtered to that person');
  await p.click('button:text-is("Reset demo")'); await p.waitForTimeout(400);
  await p.goto(PAGE + '#/team'); await p.waitForSelector('.person'); ok(await p.$$eval('.person', a => a.length) === 8, 'reset demo restores the team');

  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  for (const h of ['', '#/team', '#/task/17', '#/new']){
    await ph.goto(PAGE + h); await ph.waitForTimeout(500);
    ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone, no sideways scroll ' + (h || 'home'));
  }
  await ph.goto(PAGE + '#/team'); await ph.waitForSelector('.person'); await ph.screenshot({ path: S + '/team-phone.png' });
  ok(errs.length === 0, 'no script errors in demo ' + JSON.stringify(errs));

  // ---------- Owner mode: team saves to tracker/team.json ----------
  const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const oerrs = []; o.on('pageerror', e => oerrs.push(e.message));
  let db = JSON.parse(JSON.stringify(issues)); let file = teamFile, sha = 'sha1', puts = [];
  await o.route('https://api.github.com/**', async r => {
    const req = r.request(); const u = new URL(req.url()); const path = u.pathname; const m = req.method();
    const json = (s, body) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/repos/Tezana/project-keystone') return json(200, { permissions: { push: true } });
    if (path.endsWith('/milestones')) return json(200, u.searchParams.get('page') === '1' ? milestones : []);
    if (path.endsWith('/issues') && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? db : []);
    if (path.endsWith('/contents/tracker/team.json') && m === 'GET') return json(200, { sha, content: Buffer.from(file).toString('base64').replace(/(.{60})/g, '$1\n') });
    if (path.endsWith('/contents/tracker/team.json') && m === 'PUT'){ const body = JSON.parse(req.postData()); puts.push(body); if (body.sha !== sha) return json(409, { message: 'sha mismatch' }); file = Buffer.from(body.content, 'base64').toString('utf8'); sha = 'sha' + (puts.length + 1); return json(200, { content: { sha } }); }
    let mm = /\/issues\/(\d+)\/comments$/.exec(path); if (mm) return json(200, []);
    mm = /\/issues\/(\d+)$/.exec(path);
    if (mm && m === 'PATCH'){ const i = db.find(x => x.number == mm[1]); Object.assign(i, JSON.parse(req.postData())); return json(200, i); }
    return json(404, { message: 'not mocked ' + m + ' ' + path });
  });
  await o.goto(PAGE + '#/owner'); await o.fill('#key', 'github_pat_TEST'); await o.click('button:text-is("Unlock owner mode")'); await o.waitForSelector('.stat');
  await o.goto(PAGE + '#/tasks'); await o.waitForSelector('a.item');
  ok((await o.textContent('a.item[href="#/task/17"]')).includes('Dr. Maya Okafor'), 'owner mode reads assignee from GitHub issue');
  await o.goto(PAGE + '#/task/17'); await o.waitForSelector('.assignee');
  await o.click('button:text-is("Edit")'); await o.selectOption('#f-owner', 'tadeyemi'); await o.click('button:text-is("Save changes")');
  await o.waitForSelector('.assignee:has-text("Tom Adeyemi")');
  const b17 = db.find(x => x.number === 17).body;
  ok(b17.includes('keystone:owner=tadeyemi') && !b17.includes('owner=mokafor'), 'reassign PATCHes the owner marker in the issue');
  await o.goto(PAGE + '#/team'); await o.waitForSelector('.person');
  await o.click('button:text-is("+ Add member")'); await o.fill('#m-name', 'Dr. Ana Ruiz'); await o.fill('#m-title', 'Medical Monitor'); await o.fill('#m-team', 'Study Leadership');
  await o.click('button:text-is("Add member")'); await o.waitForSelector('.person[aria-label="Dr. Ana Ruiz"]');
  ok(puts.length === 1 && puts[0].sha === 'sha1' && JSON.parse(file).some(x => x.id === 'aruiz' && x.team === 'Study Leadership'), 'add member PUTs tracker/team.json with sha');
  ok(file.split('\n').length === 12, 'team file keeps one person per line');
  o.once('dialog', d => d.accept()); await o.click('button[aria-label="Remove Dr. Ana Ruiz"]'); await o.waitForTimeout(400);
  ok(puts.length === 2 && puts[1].sha === 'sha2' && !file.includes('aruiz'), 'remove member PUTs with the new sha');
  ok(oerrs.length === 0, 'no script errors in owner mode ' + JSON.stringify(oerrs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
