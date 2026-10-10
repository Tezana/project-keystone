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
const pdf = { name: 'Lab invoice Oct.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test file') };

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE + '#/tasks'); await p.waitForSelector('.item');
  ok((await p.textContent('a.item[href="#/task/17"] .clip')).includes('1'), 'task row shows a paperclip count');
  await p.goto(PAGE + '#/task/17'); await p.waitForSelector('.files a');
  ok((await p.textContent('.files')).includes('Eligibility criteria memo.pdf') && (await p.textContent('.files .kind')) === 'Memo', 'sample memo listed with its type');
  const href = await p.getAttribute('.files a', 'href');
  ok((await p.request.get((process.env.SITE_URL || 'http://localhost:8766') + '/' + href)).status() === 200, 'sample memo opens (' + href + ')');
  await p.click('button:text-is("Attach")'); ok(await p.isVisible('.attach .error'), 'attach with no file is rejected');
  await p.setInputFiles('#a-file', { name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1048576) });
  await p.click('button:text-is("Attach")'); await p.waitForSelector('.attach .error:has-text("over 10 MB")'); ok(true, 'files over 10 MB are rejected');
  await p.selectOption('#a-kind', 'voucher'); await p.setInputFiles('#a-file', pdf);
  await p.click('button:text-is("Attach")'); await p.waitForSelector('.files li:has-text("Lab invoice Oct.pdf")');
  ok((await p.textContent('.files li:has-text("Lab invoice") .kind')) === 'Voucher', 'new voucher attached');
  await p.waitForSelector('.notes .txt:has-text("Attached a voucher")'); ok(true, 'attaching adds a note to the timeline');
  const blobHref = await p.getAttribute('.files li:has-text("Lab invoice") a', 'href');
  ok(blobHref.startsWith('blob:') && (await p.evaluate(h => fetch(h).then(r => r.text()), blobHref)).includes('%PDF'), 'attached file opens with its contents');
  await p.setInputFiles('#a-file', pdf); await p.click('button:text-is("Attach")'); await p.waitForSelector('.files li:has-text("Lab invoice Oct(2).pdf")');
  ok(true, 'duplicate name gets a (2) suffix');
  await p.screenshot({ path: S + '/attach-task.png', fullPage: true });
  await p.reload(); await p.waitForSelector('.files li:has-text("Lab invoice Oct.pdf")'); ok(true, 'demo attachments survive a reload');
  p.on('dialog', d => d.accept());
  await p.click('button[aria-label="Remove Lab_invoice_Oct.pdf"]'); await p.waitForTimeout(400);
  ok(!(await p.$('.files li:has-text("Lab invoice Oct.pdf")')), 'remove an attached file');
  await p.click('button[aria-label="Remove Eligibility_criteria_memo.pdf"]'); await p.waitForTimeout(400);
  ok(!(await p.$('.files li:has-text("Eligibility")')), 'remove a sample file (demo only)');
  await p.goto(PAGE + '#/tasks'); await p.waitForSelector('.item');
  ok((await p.textContent('a.item[href="#/task/17"] .clip')).includes('1'), 'row count updates (1 left)');
  await p.click('button:text-is("Reset demo")'); await p.waitForTimeout(500);
  await p.goto(PAGE + '#/task/17'); await p.waitForSelector('.files li');
  const after = await p.textContent('.files');
  ok(after.includes('Eligibility') && !after.includes('Lab invoice'), 'reset demo restores the sample and clears added files');
  await p.goto(PAGE + '#/task/5'); await p.waitForSelector('.files a'); ok((await p.textContent('.files .kind')) === 'Voucher', 'task #5 has the sample voucher');
  await p.goto(PAGE + '#/task/4'); await p.waitForSelector('.files a'); ok((await p.textContent('.files .kind')) === 'Report', 'task #4 has the sample report');
  await p.goto(PAGE + '#/task/30'); await p.waitForSelector('.files li'); ok((await p.textContent('.files')).includes('Nothing attached'), 'empty state shows');
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  await ph.goto(PAGE + '#/task/17'); await ph.waitForSelector('.files a');
  ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: no sideways scroll on task page');
  await ph.evaluate(() => document.querySelector('.files').scrollIntoView()); await ph.screenshot({ path: S + '/attach-phone.png' });
  ok(errs.length === 0, 'no script errors in demo ' + JSON.stringify(errs));

  // ---------- Owner mode ----------
  const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const oerrs = []; o.on('pageerror', e => oerrs.push(e.message)); o.on('dialog', d => d.accept());
  const repo = { 'docs/attachments/task-17/memo--2026-10-08--Eligibility_criteria_memo.pdf': { sha: 's1', content: 'x' } };
  const calls = []; const comments = {};
  await o.route('https://api.github.com/**', async r => {
    const req = r.request(); const u = new URL(req.url()); const path = decodeURIComponent(u.pathname); const m = req.method();
    calls.push(m + ' ' + path);
    const json = (st, body) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/repos/Tezana/project-keystone') return json(200, { permissions: { push: true } });
    if (path.endsWith('/milestones')) return json(200, u.searchParams.get('page') === '1' ? milestones : []);
    if (path.endsWith('/issues') && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? issues : []);
    if (path.endsWith('/contents/tracker/team.json')) return json(404, { message: 'Not Found' });
    let mm = /\/contents\/(docs\/attachments\/task-\d+)$/.exec(path);
    if (mm && m === 'GET'){ const items = Object.keys(repo).filter(k => k.startsWith(mm[1] + '/')).map(k => ({ name: k.split('/').pop(), path: k, sha: repo[k].sha, size: 1234, download_url: 'https://raw.githubusercontent.com/Tezana/project-keystone/main/' + k })); return items.length ? json(200, items) : json(404, { message: 'Not Found' }); }
    mm = /\/contents\/(docs\/attachments\/.+)$/.exec(path);
    if (mm && m === 'PUT'){ const body = JSON.parse(req.postData()); repo[mm[1]] = { sha: 's' + Date.now(), content: body.content, msg: body.message }; return json(201, { content: { sha: repo[mm[1]].sha } }); }
    if (mm && m === 'DELETE'){ const body = JSON.parse(req.postData()); if (!repo[mm[1]] || repo[mm[1]].sha !== body.sha) return json(409, { message: 'sha mismatch' }); delete repo[mm[1]]; return json(200, {}); }
    mm = /\/issues\/(\d+)\/comments$/.exec(path);
    if (mm && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? (comments[mm[1]] || []) : []);
    if (mm && m === 'POST'){ const c = { body: JSON.parse(req.postData()).body, created_at: '2026-10-10T20:00:00Z' }; (comments[mm[1]] = comments[mm[1]] || []).push(c); return json(201, c); }
    return json(404, { message: 'not mocked ' + m + ' ' + path });
  });
  await o.goto(PAGE + '#/owner'); await o.fill('#key', 'github_pat_TEST'); await o.click('button:text-is("Unlock owner mode")'); await o.waitForSelector('.stat');
  await o.goto(PAGE + '#/task/17'); await o.waitForSelector('.files a');
  ok((await o.getAttribute('.files a', 'href')).startsWith('https://raw.githubusercontent.com/'), 'owner mode lists attachments from the repo');
  await o.selectOption('#a-kind', 'report'); await o.setInputFiles('#a-file', { name: 'Week 1 status.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF owner') });
  await o.click('button:text-is("Attach")'); await o.waitForSelector('.files li:has-text("Week 1 status.pdf")');
  const key = Object.keys(repo).find(k => k.includes('Week_1_status'));
  ok(key && /task-17\/report--\d{4}-\d{2}-\d{2}--Week_1_status\.pdf$/.test(key) && Buffer.from(repo[key].content, 'base64').toString() === '%PDF owner', 'owner upload PUTs the file to docs/attachments/task-17 (' + key + ')');
  ok((comments['17'] || []).some(c => c.body.includes('Attached a report: Week 1 status.pdf')), 'owner upload logs a GitHub comment');
  await o.click('button[aria-label="Remove Week_1_status.pdf"]'); await o.waitForTimeout(500);
  ok(!Object.keys(repo).some(k => k.includes('Week_1')) && !(await o.$('.files li:has-text("Week 1")')), 'owner remove DELETEs the file with its sha');
  await o.goto(PAGE + '#/task/30'); await o.waitForSelector('.files li'); ok((await o.textContent('.files')).includes('Nothing attached'), 'owner: task with no folder shows empty state');
  ok(oerrs.length === 0, 'no script errors in owner mode ' + JSON.stringify(oerrs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
