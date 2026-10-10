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
const msgFile = fs.readFileSync(path.join(ROOT, 'tracker/messages.json'), 'utf8');
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }
(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE); await p.waitForSelector('.stat');
  ok((await p.textContent('#msgBadge')) === '2', 'unread badge shows 2');
  // task page shows links
  await p.goto(PAGE + '#/task/10'); await p.waitForSelector('.deps');
  const d10 = await p.textContent('.deps');
  ok(d10.includes('Waiting on #17 and #19') && d10.includes('✓ Done#8') && d10.includes('(same person, no message)'), 'task #10 shows what it waits on and what waits on it');
  // mark #19 done (Daniel) → message to Grace (#10, still waiting on #17); #29 (Sofia) waits on 19 and 21 → message to Sofia
  await p.goto(PAGE + '#/task/19'); await p.waitForSelector('h2.t'); await p.click('button:text-is("Mark done")');
  await p.waitForSelector('.toast:not([hidden])'); const t1 = await p.textContent('.toast');
  ok(t1.includes('Message sent to') && t1.includes('Grace Lin') && t1.includes('Sofia Marchetti'), 'marking #19 done messages the next owners: ' + t1);
  ok((await p.textContent('#msgBadge')) === '4', 'badge goes to 4');
  // mark #17 (Maya) → #10 Grace now clear, #19 done already, #22 Priya (waits 4 done, 17) clear; #18? no
  await p.goto(PAGE + '#/task/17'); await p.waitForSelector('h2.t'); await p.click('button:text-is("Mark done")'); await p.waitForSelector('.chip.st-Done');
  await p.goto(PAGE + '#/messages'); await p.waitForSelector('.msgs li');
  const all = await p.$$eval('.msgs>li', a => a.map(x => x.textContent));
  ok(all.some(t => t.includes('To Grace Lin') && t.includes('You can start #10')), 'Grace is told she can start #10');
  ok(all.some(t => t.includes('To Priya Natarajan') && t.includes('You can start #22')), 'Priya is told she can start #22');
  ok(all.some(t => t.includes('To Grace Lin') && t.includes('#19 Write the informed consent form is done') && t.includes('still waiting on #17')), 'earlier message said #10 was still waiting on #17');
  // same person: #23 (Tom) → #24 (Tom) no message; #20 Tom (waits 9 done, 23) — same → none
  const before = all.length;
  await p.goto(PAGE + '#/task/23'); await p.waitForSelector('h2.t'); await p.click('button:text-is("Mark done")');
  await p.waitForSelector('.toast:not([hidden])'); const t2 = await p.textContent('.toast');
  ok(t2.includes('No message needed') && t2.includes('Tom Adeyemi'), 'same person gets no message: ' + t2);
  await p.goto(PAGE + '#/messages'); await p.waitForSelector('.msgs li');
  ok(await p.$$eval('.msgs>li', a => a.length) === before, 'no new message for the same person');
  // filters + read
  await p.selectOption('#m-to', 'glin'); ok((await p.$$eval('.msgs>li', a => a.length)) === 3, 'filter to Grace: 3 messages');
  await p.click('.seg button:text-is("Unread")'); ok((await p.$$eval('.msgs>li', a => a.length)) === 3, 'Grace unread: 3');
  await p.click('.msgs>li >> nth=0 >> button:has-text("Mark read")'); await p.waitForTimeout(200);
  ok((await p.$$eval('.msgs>li', a => a.length)) === 2, 'mark read removes it from Unread');
  await p.click('button:text-is("Mark all as read")'); await p.waitForTimeout(200);
  ok((await p.textContent('.msgs')).includes('Nothing here'), 'mark all read (for Grace)');
  await p.selectOption('#m-to', ''); await p.click('.seg button:text-is("All")');
  await p.click('.msgs>li:has-text("You can start #22") a:text-is("Open #22")'); await p.waitForSelector('h2.t');
  ok(p.url().endsWith('#/task/22'), 'Open # link goes to the next task');
  await p.screenshot({ path: S + '/task22.png' });
  // form: add/remove dependency, loop prevention
  await p.goto(PAGE + '#/task/31'); await p.waitForSelector('h2.t'); await p.click('button:text-is("Edit")');
  ok(await p.$$eval('.dchip', a => a.length) === 4, 'edit form shows 4 must-finish-first tasks');
  await p.selectOption('#f-after', '34'); ok((await p.textContent('.dep-err')).includes('loop'), 'loop is blocked (#34 waits on #31)');
  await p.click('.dchip:has-text("#30") button'); await p.selectOption('#f-after', '26'); ok(await p.$$eval('.dchip', a => a.length) === 4, 'remove one, add another');
  await p.click('button:text-is("Save changes")'); await p.waitForSelector('.deps');
  const d31 = await p.textContent('.deps'); ok(d31.includes('#26') && !d31.includes('#30 '), 'links saved');
  await p.reload(); await p.waitForSelector('.deps'); ok((await p.textContent('.deps')).includes('#26'), 'links survive reload');
  // new task with dependency
  await p.click('[data-nav="new"]'); await p.fill('#f-title', 'Order replacement sensors'); await p.selectOption('#f-owner', 'smarchetti'); await p.selectOption('#f-after', '27');
  await p.click('button:text-is("Create task")'); await p.waitForSelector('.deps'); ok((await p.textContent('.deps')).includes('Waiting on #27'), 'new task can wait on another');
  await p.goto(PAGE + '#/task/27'); await p.waitForSelector('.deps'); ok((await p.textContent('.deps')).includes('Order replacement sensors') && (await p.textContent('.deps')).includes('gets a message'), 'shows on the earlier task as next');
  await p.click('button:text-is("Reset demo")'); await p.waitForTimeout(400);
  ok((await p.textContent('#msgBadge')) === '2', 'reset demo restores messages');
  ok(errs.length === 0, 'no script errors in demo ' + JSON.stringify(errs));

  // owner mode
  const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const oerrs = []; o.on('pageerror', e => oerrs.push(e.message));
  let db = JSON.parse(JSON.stringify(issues)), reg = msgFile, sha = 'm1';
  await o.route('https://api.github.com/**', async r => {
    const req = r.request(); const u = new URL(req.url()); const path = decodeURIComponent(u.pathname); const m = req.method();
    const json = (st, body) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/repos/Tezana/project-keystone') return json(200, { permissions: { push: true } });
    if (path.endsWith('/milestones')) return json(200, u.searchParams.get('page') === '1' ? milestones : []);
    if (path.endsWith('/issues') && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? db : []);
    if (path.endsWith('/contents/tracker/messages.json')){
      if (m === 'GET') return json(200, { sha, content: Buffer.from(reg).toString('base64') });
      const body = JSON.parse(req.postData()); if (body.sha !== sha) return json(409, { message: 'sha mismatch' });
      reg = Buffer.from(body.content, 'base64').toString(); sha = 'm' + Date.now(); return json(200, { content: { sha } });
    }
    const mm = /\/issues\/(\d+)$/.exec(path);
    if (mm && m === 'PATCH'){ const i = db.find(x => x.number == mm[1]); const body = JSON.parse(req.postData()); Object.assign(i, body); if (body.state === 'closed'){ i.closed_at = '2026-10-10T20:00:00Z'; i.state_reason = body.state_reason; } return json(200, i); }
    if (/\/contents\//.test(path)) return json(404, { message: 'Not Found' });
    if (/\/comments$/.test(path)) return json(200, []);
    return json(404, { message: 'not mocked ' + m + ' ' + path });
  });
  await o.goto(PAGE + '#/owner'); await o.fill('#key', 'github_pat_TEST'); await o.click('button:text-is("Unlock owner mode")'); await o.waitForSelector('.stat');
  await o.goto(PAGE + '#/task/10'); await o.waitForSelector('.deps'); ok((await o.textContent('.deps')).includes('Waiting on #17 and #19'), 'owner mode reads links from issue bodies');
  await o.goto(PAGE + '#/task/17'); await o.waitForSelector('h2.t'); await o.click('button:text-is("Mark done")'); await o.waitForSelector('.chip.st-Done');
  const saved = JSON.parse(reg);
  ok(saved.length === 6 && saved.filter(x => x.done === 17).map(x => x.to).sort().join(',') === 'dreyes,glin,pnatarajan', 'owner: messages saved to messages.json (Daniel, Grace, Priya)');
  ok(reg.split('\n').length === saved.length + 3, 'messages file keeps one message per line');
  await o.goto(PAGE + '#/task/31'); await o.waitForSelector('h2.t'); await o.click('button:text-is("Edit")'); await o.click('.dchip:has-text("#30") button'); await o.click('button:text-is("Save changes")'); await o.waitForSelector('.deps');
  ok(/<!-- keystone:after=27,28,29 -->/.test(db.find(x => x.number === 31).body) && db.find(x => x.number === 31).body.includes('keystone:owner=dreyes'), 'owner: links saved in the issue body, owner kept');
  ok(oerrs.length === 0, 'no script errors in owner mode ' + JSON.stringify(oerrs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
