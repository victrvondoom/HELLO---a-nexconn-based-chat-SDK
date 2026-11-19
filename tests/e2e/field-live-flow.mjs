/* global process, console, document */
/**
 * Field Conditions and Season Pulse, end to end in a real browser. Requires the demo server
 * (HELLO_DEMO_MODE=true) on BASE_URL.
 *
 * The journey: an attendee opens the Field Atlas and sees Room 3 flagged from its real open incidents and
 * occupancy, with no incident text. Operations staff cancel the incidents in another session. Without a reload,
 * the attendee's mission panel stops mentioning the incidents (the crowding figure remains). The season pulse
 * shows "fewer than 3" until three people take part.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${String(error).split('\n')[0]}`);
  }
}

await resetDemo(BASE);
const browser = await chromium.launch(launchOptions);

async function session(userId, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const r = await page.request.post(`${BASE}/api/demo/session`, { data: { userId } });
  assert.ok(r.ok(), `sign-in as ${userId} failed: ${r.status()}`);
  return { context, page, errors };
}

async function post(page, path, data) {
  const r = await page.request.post(`${BASE}${path}`, { data });
  return { status: r.status(), body: await r.json().catch(() => null) };
}

const ada = await session('u-att-ada');
const ops = await session('u-ops-kiri');

await step('Room 3 is flagged on the map from its open incidents and occupancy', async () => {
  await ada.page.goto(`${BASE}/events/${EVENT}/atlas`, { waitUntil: 'networkidle' });
  await ada.page.locator('.space--cond-avoid').first().waitFor();
  const advisories = await ada.page.locator('.atlas-advisories').innerText();
  assert.match(advisories, /Room 3/);
  assert.match(advisories, /crowding issue/);
  assert.match(advisories, /130% of capacity/);
});

await step('the attendee never sees what was reported, only a category and a count', async () => {
  const text = await ada.page.locator('body').innerText();
  assert.doesNotMatch(text, /crackling|overcrowded|cannot get in/i);
});

await step('the mission panel shows live conditions and momentum for the mission', async () => {
  await ada.page.getByRole('button', { name: /Find the Main Hall|Main Hall/ }).first().click();
  const now = await ada.page.getByTestId('mission-condition').innerText();
  assert.ok(now.length > 0);
  const pulse = await ada.page.getByTestId('mission-pulse').innerText();
  assert.match(pulse, /completed in total/);
});

await step('the season pulse hides counts below three', async () => {
  const pulse = await ada.page.getByTestId('season-pulse').innerText();
  assert.match(pulse, /fewer than 3 taking part/);
});

await step('staff cancel the incidents and the attendee’s map updates without a reload', async () => {
  for (const id of ['inc-seed-av-r3', 'inc-seed-cap-r3']) {
    let done = false;
    for (const expectedVersion of [0, 1, 2]) {
      const r = await post(ops.page, `/api/events/${EVENT}/incidents/${id}`, { action: 'transition', to: 'CANCELLED', expectedVersion, resolutionNote: 'Handled at the door.' });
      if (r.status === 200) { done = true; break; }
    }
    assert.ok(done, `could not cancel ${id}`);
  }
  // The atlas polls every 15 seconds. Wait for the next poll to drop the incident lines.
  await ada.page.waitForFunction(() => {
    const el = document.querySelector('.atlas-advisories');
    return el !== null && !/issue/.test(el.textContent ?? '') && /capacity/.test(el.textContent ?? '');
  }, null, { timeout: 25000 });
});

await step('three people completing a mission makes its momentum visible', async () => {
  for (const userId of ['u-att-ada', 'u-att-ben', 'u-att-chloe']) {
    const s = userId === 'u-att-ada' ? ada : await session(userId);
    await post(s.page, `/api/events/${EVENT}/atlas/missions/fm-plan-day/start`, {});
    await post(s.page, `/api/events/${EVENT}/flow/run`, { workflowId: 'my-day' });
    const r = await post(s.page, `/api/events/${EVENT}/atlas/missions/fm-plan-day/submit`, {});
    assert.equal(r.body?.data?.outcome, 'APPROVED', `${userId}: ${JSON.stringify(r.body)}`);
  }
  await ada.page.reload({ waitUntil: 'networkidle' });
  await ada.page.getByRole('button', { name: /Plan your day/ }).first().click();
  await ada.page.waitForFunction(() => /3 verified in the last hour/.test(document.querySelector('[data-testid="mission-pulse"]')?.textContent ?? ''), null, { timeout: 20000 });
  assert.match(await ada.page.getByTestId('season-pulse').innerText(), /3 taking part/);
});

await step('the live layer fits at phone width without horizontal overflow', async () => {
  const phone = await session('u-att-dev', { width: 390, height: 844 });
  await phone.page.goto(`${BASE}/events/${EVENT}/atlas`, { waitUntil: 'networkidle' });
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  await phone.context.close();
});

await step('no browser errors', async () => {
  assert.deepEqual(ada.errors, []);
});

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) process.exitCode = 1;
