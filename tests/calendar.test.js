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
const calFile = fs.readFileSync(path.join(ROOT, 'tracker/calendar.json'), 'utf8');
const PAGE = (process.env.SITE_URL || 'http://localhost:8766') + '/index.html';
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } }
(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('https://api.github.com/**', r => r.abort());
  await p.goto(PAGE); await p.waitForSelector('.stat');
  // header corner
  const hdr = await p.$eval('header', h => h.getBoundingClientRect()); const corner = await p.$eval('.corner', c => c.getBoundingClientRect());
  ok(Math.abs(corner.right - hdr.right) < 2 && corner.top - hdr.top < 10, 'menu, bell, and New task sit in the top-right corner');
  ok((await p.getAttribute('#msgLink', 'aria-label')) === 'Messages, 2 unread' && (await p.textContent('#msgBadge')) === '2', 'message alert shows 2 unread');
  ok((await p.textContent('.dash')).includes('This week') && (await p.textContent('.dash')).includes('Team status meeting'), 'dashboard has a This week panel');
  await p.click('#menuBtn');
  const items = await p.$$eval('#menuPanel a b', a => a.map(x => x.textContent));
  ok(items.join('|') === 'Dashboard|Tasks|Calendar|Messages|Team|Documents|Budget|Progress report|About this build', 'menu lists Calendar: ' + items.join(', '));
  await p.click('#menuPanel [data-nav="calendar"]'); await p.waitForSelector('.cgrid');
  ok((await p.textContent('.cmonth')) === 'October 2026', 'calendar opens on the current month');
  ok((await p.textContent('#menuBtn')).includes('Calendar'), 'menu button shows Calendar');
  const day = d => p.locator(`.cday[data-date="${d}"]`);
  ok((await day('2026-10-12').textContent()).includes('Team status meeting'), 'weekly study-wide meeting on Mondays');
  ok((await day('2026-10-15').textContent()).includes('Decision review'), 'weekly leadership meeting on Thursdays');
  ok((await day('2026-10-09').textContent()).includes('Data and Analyt') && !(await day('2026-10-16').textContent()).includes('Data and Analyt'), 'every-2-weeks meeting skips alternate weeks');
  ok((await day('2026-10-16').textContent()).includes('Due: #17'), 'task due dates appear');
  ok((await day('2026-10-31').textContent()).includes('Deadline: Phase 2'), 'phase deadline appears');
  await day('2026-10-16').click();
  const dv = await p.textContent('.dayview');
  ok(dv.includes('Friday, October 16, 2026') && dv.includes('#17 Confirm inclusion') && dv.includes('Dr. Maya Okafor'), 'clicking a day shows its details');
  // filters
  await p.selectOption('#c-flevel', 'Laboratory');
  ok((await day('2026-10-14').textContent()).includes('Laboratory ch') && !(await day('2026-10-12').textContent()).includes('Team status'), 'level filter: Laboratory only');
  await p.selectOption('#c-flevel', ''); await p.selectOption('#c-fperson', 'tadeyemi');
  const t20 = await day('2026-10-20').textContent(), t15 = await day('2026-10-15').textContent();
  ok(t20.includes('#23') && !t15.includes('Decision review') && (await day('2026-10-12').textContent()).includes('Team status'), "person filter: Tom's meetings and tasks");
  await p.selectOption('#c-fperson', ''); await p.uncheck('#c-show-meetings');
  ok(!(await day('2026-10-12').textContent()).includes('Team status') && (await day('2026-10-16').textContent()).includes('#17'), 'hide meetings');
  await p.check('#c-show-meetings');
  // closures
  await p.click('button[aria-label="Next month"]'); ok((await p.textContent('.cmonth')) === 'November 2026', 'next month');
  ok((await day('2026-11-26').textContent()).includes('Thanksgiving') && !(await day('2026-11-26').textContent()).includes('Decision review'), 'closure skips the recurring meeting');
  ok((await day('2026-11-18').textContent()).includes('Ethics board meeting'), 'one-off meeting');
  await p.click('button[aria-label="Next month"]'); ok((await day('2026-12-21').textContent()).includes('Lab closed') && !(await day('2026-12-21').textContent()).includes('Team status'), 'holiday closure');
  await p.click('button:text-is("Today")'); ok((await p.textContent('.cmonth')) === 'October 2026', 'Today button');
  // add a meeting
  await p.click('button:text-is("+ Add meeting")'); await p.click('button:text-is("Add meeting")');
  ok((await p.textContent('.sheet .error')).includes('name'), 'meeting needs a name');
  await p.fill('#c-title', 'Consent form review'); await p.selectOption('#c-level', 'dept:Clinical Operations');
  const checked = await p.$$eval('fieldset .checks input:checked', a => a.map(x => x.value));
  ok(checked.sort().join(',') === 'dreyes,pnatarajan', 'department level preselects its people');
  await p.check('#c-a-glin'); await p.fill('#c-date', '2026-10-21'); await p.fill('#c-time', '11:00'); await p.selectOption('#c-mins', '45');
  await p.click('button:text-is("Add meeting")'); await p.waitForSelector('.cday[data-date="2026-10-21"] .ev:has-text("Consent form review")');
  ok((await p.textContent('.dayview')).includes('11 am–11:45 am') && (await p.textContent('.dayview')).includes('Clinical Operations meeting'), 'meeting added and shown on its day');
  // repeating meeting
  await p.click('button:text-is("+ Add meeting")'); await p.fill('#c-title', 'Recruitment stand-up'); await p.selectOption('#c-level', 'study'); await p.fill('#c-date', '2026-10-13'); await p.fill('#c-time', '08:30'); await p.selectOption('#c-every', '1'); await p.fill('#c-until', '2026-10-27');
  await p.click('button:text-is("Add meeting")'); await p.waitForSelector('.cday[data-date="2026-10-20"] .ev:has-text("Recruitment")');
  ok((await day('2026-10-27').textContent()).includes('Recruitment') && !(await day('2026-11-03').textContent()).includes('Recruitment'), 'repeats weekly until the end date');
  // edit + delete
  await day('2026-10-21').click(); await p.click('button[aria-label="Edit Consent form review"]'); await p.fill('#c-title', 'Consent form review (final)'); await p.click('button:text-is("Save meeting")');
  await p.waitForSelector('.cday[data-date="2026-10-21"] .ev:has-text("(final)")'); ok(true, 'edit meeting');
  await day('2026-10-20').click(); await p.click('button[aria-label="Delete Recruitment stand-up"]'); await p.waitForTimeout(300);
  ok(!(await day('2026-10-27').textContent()).includes('Recruitment'), 'delete removes all repeats');
  await p.reload(); await p.waitForSelector('.cgrid'); ok((await day('2026-10-21').textContent()).includes('(final)'), 'meetings survive reload');
  // list view
  await p.click('.seg button:text-is("List")'); await p.waitForSelector('.agenda');
  ok(await p.$$eval('.aday', a => a.length) > 15, 'list view groups the month by day');
  await p.click('.seg button:text-is("Month")');
  // task due date change shows on calendar
  await p.goto(PAGE + '#/task/18'); await p.waitForSelector('h2.t'); await p.click('button:text-is("Edit")'); await p.fill('#f-due', '2026-10-19'); await p.click('button:text-is("Save changes")'); await p.waitForSelector('.facts:has-text("Oct 19")');
  await p.goto(PAGE + '#/calendar'); await p.waitForSelector('.cgrid'); ok((await day('2026-10-19').textContent()).includes('#18'), 'changing a due date moves it on the calendar');
  await p.click('button:text-is("Reset demo")'); await p.waitForTimeout(400); await p.goto(PAGE + '#/calendar'); await p.waitForSelector('.cgrid');
  ok(!(await day('2026-10-21').textContent()).includes('Consent form review'), 'reset demo restores the calendar');
  await p.screenshot({ path: S + '/cal-final.png', fullPage: true });
  // phone
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
  for (const h of ['', '#/calendar']){ await ph.goto(PAGE + h); await ph.waitForTimeout(500); ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'phone: no sideways scroll ' + (h || 'home')); }
  await ph.click('.cday[data-date="2026-10-16"]'); ok((await ph.textContent('.dayview')).includes('#17'), 'phone: tap a day to see it');
  await ph.click('#menuBtn'); ok(await ph.evaluate(() => { const r = document.getElementById('menuPanel').getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }), 'phone: menu fits on screen');
  await ph.screenshot({ path: S + '/cal-phone-menu.png' });
  const dk = await b.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'dark' });
  await dk.goto(PAGE + '#/calendar'); await dk.waitForSelector('.cgrid'); await dk.screenshot({ path: S + '/cal-dark.png' });
  ok(errs.length === 0, 'no script errors in demo ' + JSON.stringify(errs));

  // owner mode
  const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const oerrs = []; o.on('pageerror', e => oerrs.push(e.message)); o.on('dialog', d => d.accept());
  let reg = calFile, sha = 'c1';
  await o.route('https://api.github.com/**', async r => {
    const req = r.request(); const u = new URL(req.url()); const path = decodeURIComponent(u.pathname); const m = req.method();
    const json = (st, body) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/repos/Tezana/project-keystone') return json(200, { permissions: { push: true } });
    if (path.endsWith('/milestones')) return json(200, u.searchParams.get('page') === '1' ? milestones : []);
    if (path.endsWith('/issues') && m === 'GET') return json(200, u.searchParams.get('page') === '1' ? issues : []);
    if (path.endsWith('/contents/tracker/calendar.json')){
      if (m === 'GET') return json(200, { sha, content: Buffer.from(reg).toString('base64') });
      const body = JSON.parse(req.postData()); if (body.sha !== sha) return json(409, { message: 'sha mismatch' });
      reg = Buffer.from(body.content, 'base64').toString(); sha = 'c' + Date.now(); return json(200, { content: { sha } });
    }
    if (/\/contents\//.test(path)) return json(404, { message: 'Not Found' });
    return json(404, { message: 'not mocked ' + m + ' ' + path });
  });
  await o.goto(PAGE + '#/owner'); await o.fill('#key', 'github_pat_TEST'); await o.click('button:text-is("Unlock owner mode")'); await o.waitForSelector('.stat');
  await o.goto(PAGE + '#/calendar'); await o.waitForSelector('.cgrid');
  ok((await o.textContent('.cday[data-date="2026-10-16"]')).includes('#17'), 'owner mode reads due dates from GitHub issues');
  await o.click('button:text-is("+ Add meeting")'); await o.fill('#c-title', 'Budget check'); await o.selectOption('#c-level', 'leadership'); await o.fill('#c-date', '2026-10-22'); await o.fill('#c-time', '16:00');
  await o.click('button:text-is("Add meeting")'); await o.waitForSelector('.cday[data-date="2026-10-22"] .ev:has-text("Budget check")');
  const saved = JSON.parse(reg).meetings.find(x => x.title === 'Budget check');
  ok(saved && saved.id === 'mt11' && saved.level === 'leadership' && saved.attendees.sort().join(',') === 'mokafor,smarchetti', 'owner: meeting saved to calendar.json');
  ok(oerrs.length === 0, 'no script errors in owner mode ' + JSON.stringify(oerrs));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch(e => { console.error(e); process.exit(1); }).then(() => { if (fail) process.exitCode = 1; });
