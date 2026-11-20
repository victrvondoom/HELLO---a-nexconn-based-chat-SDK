/* global process, console, document, indexedDB */
/**
 * Real-time push, end to end in real browsers. Requires the demo server (HELLO_DEMO_MODE=true) on BASE_URL.
 *
 * Two connected people (Ada and Ines) open their private thread in separate browsers. Typing indicators and
 * the "online" pill have no polling path at all, so seeing them proves the live stream works; a message
 * arriving in seconds, while the page polls only once a minute when the stream is up, proves the same for
 * data. A feed post and an incident page are checked the same way, and the stream refuses non-members.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
// Optional second app instance (same Postgres database). Ines and Ben use it, so every pushed change has to
// cross from one server process to the other through Postgres LISTEN/NOTIFY.
const BASE_B = process.env.BASE_URL_B ?? BASE;
const EVENT = 'evt-demo-hello-summit';
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {};

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
const browser = await chromium.launch(launchOptions);
async function as(userId, base = BASE) {
  const context = await browser.newContext({ baseURL: base });
  context.setDefaultTimeout(15000);
  const r = await context.request.post(`${base}/api/demo/session`, { data: { userId } });
  assert.ok(r.ok(), `sign-in as ${userId} failed`);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors, base };
}

const ada = await as('u-att-ada');
const ines = await as('u-spk-ines', BASE_B);
const ben = await as('u-att-ben', BASE_B);
if (BASE_B !== BASE) console.log(`Two instances: Ada on ${BASE}, Ines and Ben on ${BASE_B}.`);

await step('both people open the thread and their devices publish keys', async () => {
  await ines.page.goto(`${BASE_B}/events/${EVENT}/messages/u-att-ada`);
  await ines.page.waitForFunction(() => indexedDB.databases().then((d) => d.some((x) => x.name === 'hello-e2ee')));
  await ada.page.goto(`${BASE}/events/${EVENT}/messages/u-spk-ines`);
  await ada.page.waitForFunction(() => !document.querySelector('#dm-text')?.hasAttribute('disabled'));
  await ines.page.waitForFunction(() => !document.querySelector('#dm-text')?.hasAttribute('disabled'));
});

await step('each sees the other is online (presence, pushed)', async () => {
  await ada.page.getByTestId('peer-online').waitFor({ timeout: 8000 });
  await ines.page.getByTestId('peer-online').waitFor({ timeout: 8000 });
});

await step('typing shows on the other screen within seconds (typing, pushed)', async () => {
  await ines.page.getByLabel(/Private message to/).pressSequentially('On my way', { delay: 30 });
  await ada.page.getByTestId('peer-typing').waitFor({ timeout: 5000 });
});

await step('a sent message appears on the other screen within seconds, not after a poll', async () => {
  const text = `Live check ${Date.now()}`;
  await ines.page.getByLabel(/Private message to/).fill(text);
  const sentAt = Date.now();
  await ines.page.getByRole('button', { name: 'Send encrypted message' }).click();
  await ada.page.getByText(text).waitFor({ timeout: 5000 });
  const took = Date.now() - sentAt;
  assert.ok(took < 5000, `took ${took} ms`);
  // The typing line goes when the message lands.
  await ada.page.getByTestId('peer-typing').waitFor({ state: 'detached', timeout: 3000 });
});

await step('closing the thread takes the person offline for the other', async () => {
  await ines.page.goto('about:blank');
  await ada.page.getByTestId('peer-online').waitFor({ state: 'detached', timeout: 8000 });
});

await step('a new post reaches another person’s open feed within seconds', async () => {
  await ben.page.goto(`${BASE_B}/events/${EVENT}/feed`);
  await ben.page.waitForLoadState('networkidle');
  const text = `Pushed post ${Date.now()}`;
  const posted = await ada.context.request.post(`${BASE}/api/events/${EVENT}/feed`, { data: { text } });
  assert.equal(posted.status(), 201);
  await ben.page.getByText(text).waitFor({ timeout: 5000 });
});

await step('a server-rendered page reports that it is live on the stream', async () => {
  const kiri = await as('u-ops-kiri');
  await kiri.page.goto(`${BASE}/events/${EVENT}/incidents`);
  await kiri.page.locator('[data-live="stream"]').waitFor({ timeout: 8000 });
  await kiri.context.close();
});

await step('the stream refuses someone who is not signed in', async () => {
  const anonymous = await browser.newContext();
  const r = await anonymous.request.get(`${BASE}/api/events/${EVENT}/stream`);
  assert.equal(r.status(), 401);
  await anonymous.close();
});

await step('no page errors', async () => {
  assert.deepEqual([...ada.errors, ...ines.errors, ...ben.errors], []);
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} live checks passed`);
if (passed !== results.length) process.exitCode = 1;
