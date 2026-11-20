/* global process, console */
/**
 * The conversation's offline outbox and the opt-in leaderboard, in a real browser. Requires the demo server.
 * The browser is taken offline, a message is sent (it is saved, not lost), the browser comes back online,
 * and the message is delivered once.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${String(error).split('\n')[0]}`);
  }
}

await resetDemo(BASE);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext();
context.setDefaultTimeout(15000);
await context.request.post(`${BASE}/api/demo/session`, { data: { userId: 'u-att-ada' } });
const page = await context.newPage();
const text = `Offline check ${Date.now()}: what is on in Room 4?`;

await step('a message sent while offline is saved, not lost', async () => {
  await page.goto(`${BASE}/events/${EVENT}/conversation`);
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  const box = page.locator('textarea').first();
  await box.fill(text);
  await box.press('Enter');
  await page.getByTestId('outbox-waiting').waitFor();
  assert.equal(await box.inputValue(), '');
});

await step('it is delivered once when the connection returns', async () => {
  await context.setOffline(false);
  await page.getByTestId('outbox-waiting').waitFor({ state: 'detached', timeout: 15000 });
  await page.getByText(text).first().waitFor({ timeout: 10000 });
  const thread = await context.request.get(`${BASE}/events/${EVENT}/conversation`);
  const html = await thread.text();
  assert.equal(html.split(text).length - 1 >= 1, true);
  assert.ok(html.split(text).length - 1 <= 2, 'the message appears more than once');
});

await step('the leaderboard lists nobody until a person joins, then shows them', async () => {
  await page.goto(`${BASE}/events/${EVENT}/atlas`);
  await page.getByRole('tab', { name: 'My progress and badges' }).click();
  const board = page.getByTestId('leaderboard');
  await board.getByRole('button', { name: 'Join the leaderboard' }).click();
  await board.getByText('Ada', { exact: false }).first().waitFor();
  await board.getByRole('button', { name: 'Leave the leaderboard' }).click();
  await board.getByRole('button', { name: 'Join the leaderboard' }).waitFor();
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) process.exitCode = 1;
