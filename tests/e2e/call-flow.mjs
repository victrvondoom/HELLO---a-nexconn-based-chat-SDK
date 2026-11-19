/* global process, console, document */
/**
 * A real two-person video call: two separate browsers with fake camera and microphone devices join the same
 * call, signal through HELLO, and connect peer to peer. Passing means each browser receives the other's
 * video frames, which only happens over an established WebRTC connection. Requires the demo server.
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
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
async function as(userId) {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  context.setDefaultTimeout(20000);
  await context.request.post(`${BASE}/api/demo/session`, { data: { userId } });
  return { context, page: await context.newPage() };
}
const ada = await as('u-att-ada');
const ben = await as('u-att-ben');
let callId = '';

await step('Ada starts a call', async () => {
  const r = await ada.context.request.post(`${BASE}/api/events/${EVENT}/calls`, { data: { title: 'Two-person check' } });
  assert.equal(r.status(), 201);
  callId = (await r.json()).data.id;
});

await step('both join from their own browsers', async () => {
  for (const p of [ada, ben]) {
    await p.page.goto(`${BASE}/events/${EVENT}/calls/${callId}`);
    await p.page.getByRole('button', { name: 'Join call' }).click();
  }
});

const receivingFrames = (page) =>
  page.waitForFunction(() => {
    const remote = [...document.querySelectorAll('video')].find((v) => /’s video$/.test(v.getAttribute('aria-label') ?? ''));
    return remote !== undefined && remote.readyState >= 2 && remote.videoWidth > 0;
  }, null, { timeout: 25000 });

await step('each browser receives the other’s video, peer to peer', async () => {
  await receivingFrames(ada.page);
  await receivingFrames(ben.page);
});

await step('when Ben leaves, his tile goes from Ada’s screen', async () => {
  await ben.page.getByRole('button', { name: /Leave/ }).first().click();
  await ada.page.waitForFunction(() => ![...document.querySelectorAll('video')].some((v) => /’s video$/.test(v.getAttribute('aria-label') ?? '')), null, { timeout: 25000 });
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} call checks passed`);
if (passed !== results.length) process.exitCode = 1;
