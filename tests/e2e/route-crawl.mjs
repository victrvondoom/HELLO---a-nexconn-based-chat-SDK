/* global process, console, fetch */
/** Route crawl: visits every page as every demo role and reports HTTP errors, error boundaries and page exceptions. */
import { chromium } from 'playwright';
const E = 'evt-demo-hello-summit';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ROUTES = ['', '/conversation', '/incidents', '/incidents?filter=all', '/incidents?filter=attention', '/incidents/inc-seed-av-r3', '/incidents/inc-seed-cap-r3', '/incidents/inc-seed-fac-r2', '/operations', '/team', '/announcements', '/sessions', '/sessions?current=s-sat-power', '/people?q=satellite', '/notifications', '/settings', '/audit', '/audit?action=sla.sweep', '/agents', '/map', '/map?to=r-3', '/people?tab=network', '/people/u-att-ada', '/messages', '/messages/u-spk-ines'];
const USERS = { ada: 'u-att-ada', ben: 'u-att-ben', fatima: 'u-att-fatima', chloe: 'u-att-chloe', speaker: 'u-spk-ines', volunteer: 'u-vol-jamal', kiri: 'u-ops-kiri', lena: 'u-ops-lena', nadia: 'u-org-nadia', owen: 'u-org-owen' };
(async () => {
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
  const problems = [];
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
      const body = await page.locator('body').innerText().catch(() => '');
      const boundary = /Something went wrong|We could not load this page|Application error/.test(body);
      if (status >= 500 || boundary || errs.length) {
        problems.push(`${who} ${route} status=${status} boundary=${boundary} ${errs.slice(0, 3).join(' | ')}`);
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
  console.log('total problems:', problems.length);
})().catch(e => { console.error(e); process.exit(1); });
