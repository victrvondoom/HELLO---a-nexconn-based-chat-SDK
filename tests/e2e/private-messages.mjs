/* global process, console, document, indexedDB */
// End-to-end encryption in real browsers: two separate profiles, one message, and proof that the
// server's copy cannot be read. Run against a demo server (see README): BASE_URL=http://localhost:3000.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const SECRET = `Meet me at the quiet room at 13:40 (${Date.now()})`;
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`ok    ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${String(error).split('\n')[0]}`);
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const reset = await browser.newContext();
await reset.request.post(`${BASE}/api/demo/reset`);
await reset.close();

async function as(userId) {
  const context = await browser.newContext();
  await context.request.post(`${BASE}/api/demo/session`, { data: { userId } });
  const page = await context.newPage();
  return { context, page };
}

const ada = await as('u-att-ada');
const ines = await as('u-spk-ines');

await step('each device publishes a key when its person opens HELLO', async () => {
  await ines.page.goto(`${BASE}/events/${EVENT}/messages`);
  await ines.page.waitForFunction(() => indexedDB.databases().then((d) => d.some((x) => x.name === 'hello-e2ee')));
  await ada.page.goto(`${BASE}/events/${EVENT}/messages/u-spk-ines`);
  await ada.page.getByText('End-to-end encrypted').first().waitFor();
});

await step('a connection sends a message sealed on their device', async () => {
  const box = ada.page.getByLabel(/Private message to/);
  await assert.doesNotReject(box.waitFor());
  await ada.page.waitForFunction(() => !document.querySelector('#dm-text')?.hasAttribute('disabled'));
  await box.fill(SECRET);
  await ada.page.getByRole('button', { name: 'Send encrypted message' }).click();
  await ada.page.getByText(SECRET).waitFor();
});

await step('the server stores only ciphertext', async () => {
  const response = await ada.context.request.get(`${BASE}/api/events/${EVENT}/dm/u-spk-ines`);
  const raw = await response.text();
  assert.ok(raw.includes('ciphertext'));
  assert.ok(!raw.includes('quiet room'), 'plaintext found in the server response');
  const exported = await ada.context.request.get(`${BASE}/api/me/export`);
  assert.ok(!(await exported.text()).includes('quiet room'), 'plaintext found in the data export');
});

await step('the recipient opens it on their own device', async () => {
  await ines.page.goto(`${BASE}/events/${EVENT}/messages/u-att-ada`);
  await ines.page.getByText(SECRET).waitFor({ timeout: 15000 });
});

await step('both people see the same safety number', async () => {
  const read = async (page) => {
    await page.getByText('Verify this conversation in person').click();
    return page.locator('.safety-number').innerText();
  };
  assert.equal(await read(ada.page), await read(ines.page));
});

await step('someone who is not connected cannot read the thread', async () => {
  const ben = await as('u-att-ben');
  const response = await ben.context.request.get(`${BASE}/api/events/${EVENT}/dm/u-spk-ines`);
  assert.equal(response.status(), 403);
  await ben.context.close();
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} private-message checks passed`);
process.exit(passed === results.length ? 0 : 1);
