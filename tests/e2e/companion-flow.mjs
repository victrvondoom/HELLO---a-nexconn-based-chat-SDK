/* global process, console, navigator */
/**
 * Companion journey (2026-11-22): one-button entry, the five destinations, the connected workflow canvas,
 * the live room, a room marked full leading to a Plan B seat hold, a CON-FUZZ check approved by an organiser,
 * and the care page opening offline. Needs a production demo server (the offline worker registers only in
 * production builds): HELLO_DEMO_MODE=true npx next start -p 3000. BASE_URL and CHROMIUM_PATH are optional.
 *
 * AV signals need a session running "now"; the demo clock sits before the next session, so they are covered by
 * tests/integration/live-room.test.ts with a controlled clock instead.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const E = 'evt-demo-hello-summit';
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
    console.log('PASS ', name);
  } catch (e) {
    results.push(['FAIL', name]);
    console.log('FAIL ', name, '\n       ', String(e).split('\n')[0].slice(0, 240));
  }
}

await resetDemo(BASE);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await step('C1 entering the demo is one button', async () => {
  await page.goto(`${BASE}/demo`);
  assert.equal(await page.locator('.enter__people').isVisible(), false, 'the people list should start folded');
  await page.getByRole('button', { name: 'Enter HELLO' }).click();
  await page.waitForURL(`**/events/${E}`);
});

await step('C2 the sidebar offers Today, Explore, Live, People and the Kingdom door', async () => {
  const nav = (await page.locator('nav[aria-label="Primary"] .nav-section').first().locator('a').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(nav, ['Today', 'Explore', 'Live', 'People']);
  await page.getByRole('link', { name: /Enter the Kingdom/ }).first().waitFor();
});

await step('C3 the workflow canvas paints its connections', async () => {
  await page.goto(`${BASE}/events/${E}/flow`);
  // A horizontal path has a zero-height box, which Playwright calls invisible: wait for it to exist instead.
  await page.locator('.canvas__edges path').first().waitFor({ state: 'attached' });
  const box = await page.locator('.canvas__edges').boundingBox();
  assert.ok(box && box.width > 200 && box.height > 200, `edge layer is ${box?.width}x${box?.height}`);
  assert.ok((await page.locator('.canvas__edges path').count()) >= 15, 'too few edges');
});

await step('C4 Explore adds a session to the plan, and Today shows it next', async () => {
  await page.goto(`${BASE}/events/${E}/explore`);
  const row = page.locator('.discover__session', { hasText: 'Satellite Power Systems' });
  await row.getByRole('button', { name: /Add/ }).click();
  await row.getByRole('button', { name: /In plan/ }).waitFor();
  await page.goto(`${BASE}/events/${E}`);
  await page.getByRole('heading', { name: 'Satellite Power Systems' }).waitFor();
});

await step('C5 the live room takes a question', async () => {
  await page.goto(`${BASE}/events/${E}/now/s-sat-power`);
  await page.getByLabel('Your question').fill('Will the slides be shared after the talk?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await page.getByText('Will the slides be shared after the talk?').waitFor();
  await page.getByText('not available at this event yet', { exact: false }).waitFor();
});

const staff = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const kiri = await staff.newPage();
kiri.on('pageerror', (e) => errors.push(e.message));
await kiri.request.post(`${BASE}/api/demo/session`, { data: { userId: 'u-ops-kiri' } });

await step('C6 staff mark a room full; its QR leads an attendee to Plan B with a held seat', async () => {
  await kiri.goto(`${BASE}/events/${E}/operations?tab=venue`);
  const row = kiri.locator('tr', { hasText: 'Satellite Power Systems' });
  await row.getByRole('button', { name: 'Mark full' }).click();
  await row.getByRole('link', { name: 'Room-full QR' }).waitFor();
  await page.goto(`${BASE}/events/${E}?planb=s-sat-power`);
  await page.getByRole('heading', { name: 'Satellite Power Systems is full' }).waitFor();
  await page.getByRole('button', { name: 'Hold my seat' }).first().click();
  await page.getByText(/Seat held until/).first().waitFor();
});

const org = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const nadia = await org.newPage();
nadia.on('pageerror', (e) => errors.push(e.message));
await nadia.request.post(`${BASE}/api/demo/session`, { data: { userId: 'u-org-nadia' } });

await step('C7 an organiser runs CON-FUZZ and approves a fix verified on all 256 combinations', async () => {
  await nadia.goto(`${BASE}/events/${E}/operations?tab=resilience`);
  await nadia.getByRole('button', { name: 'Run resilience check' }).click();
  await nadia.getByRole('button', { name: 'Approve change' }).waitFor({ timeout: 30000 });
  await nadia.getByText(/256 of 256 subsets pass/).first().waitFor();
  await nadia.getByRole('button', { name: 'Approve change' }).click();
  await nadia.getByText('Approved and applied').first().waitFor({ timeout: 15000 });
});

await step('C8 "I need a break" opens offline after one visit', async () => {
  await page.goto(`${BASE}/events/${E}`);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => undefined);
  await page.reload();
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.goto(`${BASE}/events/${E}/care`);
  await page.getByRole('heading', { name: 'Take a moment' }).waitFor();
  assert.ok(await page.getByText('Quiet room').first().isVisible());
  await context.setOffline(false);
});

await step('C9 a custom quiz can be created', async () => {
  await page.goto(`${BASE}/events/${E}/games`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Title').fill('Coffee break quiz');
  const qs = [
    ['Which room is the largest?', 'Main Hall', 'Room 3'],
    ['What does AV stand for?', 'Audio-visual', 'Any venue'],
    ['Which day is it?', 'Event day', 'Some other day'],
  ];
  for (const [i, [q, a, b]] of qs.entries()) {
    await page.getByLabel(`Question ${i + 1}`, { exact: true }).fill(q);
    await page.getByLabel(`Question ${i + 1}, option 1`).fill(a);
    await page.getByLabel(`Question ${i + 1}, option 2`).fill(b);
  }
  await page.getByRole('button', { name: 'Create and play' }).click();
  await page.waitForURL(`**/events/${E}/games/**`);
});

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} companion steps passed`);
console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none');
process.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
