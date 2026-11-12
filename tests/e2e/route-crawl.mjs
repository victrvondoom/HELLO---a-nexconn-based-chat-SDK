/* global process, console, fetch */
/**
 * Route crawl: visits every page as every demo role and reports HTTP errors, error boundaries and page exceptions.
 * Some pages are deliberately hidden from some roles (they answer 404 so their existence is not revealed).
 * `expectDenied` encodes that access matrix: an intended denial passes, while an unexpected 404, or a page that
 * should be denied but loads, is reported as a problem.
 */
import { chromium } from 'playwright';
const E = 'evt-demo-hello-summit';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ROUTES = ['', '/conversation', '/incidents', '/incidents?filter=all', '/incidents?filter=attention', '/incidents/inc-seed-av-r3', '/incidents/inc-seed-cap-r3', '/incidents/inc-seed-fac-r2', '/operations', '/team', '/announcements', '/sessions', '/sessions?current=s-sat-power', '/people?q=satellite', '/notifications', '/settings', '/audit', '/audit?action=sla.sweep', '/agents', '/map', '/map?to=r-3', '/people?tab=network', '/people/u-att-ada', '/messages', '/messages/u-spk-ines'];
const USERS = { ada: 'u-att-ada', ben: 'u-att-ben', fatima: 'u-att-fatima', chloe: 'u-att-chloe', speaker: 'u-spk-ines', volunteer: 'u-vol-jamal', kiri: 'u-ops-kiri', lena: 'u-ops-lena', nadia: 'u-org-nadia', owen: 'u-org-owen' };
const PUBLIC_ROLES = new Set(['ada', 'ben', 'fatima', 'chloe', 'speaker']);
const ORGANISERS = new Set(['nadia', 'owen']);
// Seeded incidents and who reported them: a reporter may always read their own incident.
const REPORTER_OF = { '/incidents/inc-seed-av-r3': 'fatima', '/incidents/inc-seed-cap-r3': null, '/incidents/inc-seed-fac-r2': 'chloe' };
function expectDenied(who, route) {
  const path = route.split('?')[0];
  if (path === '/audit') return !ORGANISERS.has(who);
  if (PUBLIC_ROLES.has(who)) {
    if (['/operations', '/team', '/agents'].includes(path)) return true;
    if (path in REPORTER_OF) return REPORTER_OF[path] !== who;
  }
  if (path === `/messages/${USERS[who]}`) return true; // nobody can open a thread with themselves
  return false;
}
(async () => {
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
  const problems = [];
  let denied = 0;
  let visited = 0;
  for (const [who, uid] of Object.entries(USERS)) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
    const r = await page.request.post(`${BASE}/api/demo/session`, { data: { userId: uid } });
    if (!r.ok()) { problems.push(`${who} sign-in ${r.status()}`); continue; }
    for (const route of ROUTES) {
      errs.length = 0;
      const url = `${BASE}/events/${E}${route}`;
      let status = 0;
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        status = resp ? resp.status() : 0;
      } catch (e) { problems.push(`${who} ${route} NAV: ${e.message.slice(0, 120)}`); continue; }
      visited += 1;
      const body = await page.locator('body').innerText().catch(() => '');
      const boundary = /Something went wrong|We could not load this page|Application error/.test(body);
      const shouldDeny = expectDenied(who, route);
      if (shouldDeny) {
        // The 404 for the document itself is logged by the browser as a console error; that one is expected.
        const unexpected = errs.filter((e) => !/status of 404/.test(e));
        if (status !== 404) problems.push(`${who} ${route} should be denied (404) but answered ${status}`);
        else denied += 1;
        if (boundary || unexpected.length) problems.push(`${who} ${route} denied page broke: boundary=${boundary} ${unexpected.slice(0, 3).join(' | ')}`);
        continue;
      }
      if (status >= 400 || boundary || errs.length) {
        problems.push(`${who} ${route} status=${status} boundary=${boundary} ${errs.slice(0, 3).join(' | ')}`);
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
  console.log(`visited ${visited} pages, ${denied} correctly denied, total problems: ${problems.length}`);
  if (problems.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
