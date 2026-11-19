/* global process, console, Buffer, fetch, setTimeout */
/**
 * The chat gateway end to end, with this script playing the chat-network bridge (what a Nexconn bridge does):
 * it receives HELLO's signed deliveries on a local HTTP port and sends signed messages to HELLO's inbound
 * endpoint. Run the server with the gateway pointed at it:
 *
 *   HELLO_CHAT_SECRET=<40+ chars> HELLO_CHAT_OUTBOUND_URL=http://localhost:4100/hello \
 *     HELLO_DEMO_MODE=true npx next start -p 3000
 *   HELLO_CHAT_SECRET=<same> node tests/e2e/chat-bridge-flow.mjs
 */
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const SECRET = process.env.HELLO_CHAT_SECRET ?? '';
const PORT = Number(process.env.BRIDGE_PORT ?? 4100);
if (SECRET.length < 32) {
  console.error('Set HELLO_CHAT_SECRET (the same value the server uses, 32+ characters).');
  process.exit(1);
}

// --- the bridge: the same signing scheme as src/integrations/chat/signature.ts, written independently ---
const signature = (timestamp, body) => `v1=${createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')}`;
const deliveries = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const expected = Buffer.from(signature(req.headers['x-hello-timestamp'], raw));
    const given = Buffer.from(String(req.headers['x-hello-signature'] ?? ''));
    const verified = expected.length === given.length && timingSafeEqual(expected, given);
    deliveries.push({ verified, key: req.headers['idempotency-key'], body: JSON.parse(raw) });
    res.writeHead(verified ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ reference: `bridge-${deliveries.length}` }));
  });
});
await new Promise((resolve) => server.listen(PORT, resolve));

async function toHello(payload, { tamper = false } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = Date.now();
  const response = await fetch(`${BASE}/api/integrations/chat/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hello-timestamp': String(timestamp), 'x-hello-signature': tamper ? signature(timestamp, `${body} `) : signature(timestamp, body) },
    body,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

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
let code = '';

await step('settings show the chat network as connected', async () => {
  await page.goto(`${BASE}/events/${EVENT}/settings`);
  assert.match(await page.getByTestId('chat-transport').innerText(), /Chat network connected/);
});

await step('a message from an unlinked chat account is told how to link, and runs nothing', async () => {
  const r = await toHello({ eventId: EVENT, externalUserId: 'nx-ada', messageId: 'm-1', text: 'Hello?' });
  assert.equal(r.status, 200);
  assert.match(r.body.data.reply, /LINK <code>/);
  assert.equal(r.body.data.linked, false);
});

await step('Ada creates a one-time code in HELLO and sends it from her chat app', async () => {
  await page.getByRole('button', { name: 'Link a chat app' }).click();
  code = (await page.getByTestId('chat-link-code').innerText()).match(/LINK ([A-Z0-9]{8})/)?.[1] ?? '';
  assert.ok(code, 'no code shown');
  const r = await toHello({ eventId: EVENT, externalUserId: 'nx-ada', messageId: 'm-2', text: `LINK ${code}` });
  assert.match(r.body.data.reply, /^Linked to Ada/);
});

await step('her settings page shows the link without a reload (pushed)', async () => {
  await page.getByTestId('chat-links').waitFor({ timeout: 8000 });
});

await step('a message from the chat app runs through HELLO as Ada', async () => {
  const r = await toHello({ eventId: EVENT, externalUserId: 'nx-ada', messageId: 'm-3', text: 'What is on in Room 4 today?' });
  assert.match(r.body.data.reply, /Room 4 hosts: .* at \d{2}:\d{2} UTC/);
});

await step('a retried webhook gets the same reply and runs nothing again', async () => {
  const again = await toHello({ eventId: EVENT, externalUserId: 'nx-ada', messageId: 'm-3', text: 'What is on in Room 4 today?' });
  assert.equal(again.body.data.replayed, true);
  assert.match(again.body.data.reply, /Room 4 hosts/);
});

await step('a forged or tampered request is refused', async () => {
  const r = await toHello({ eventId: EVENT, externalUserId: 'nx-ada', messageId: 'm-4', text: 'Hi' }, { tamper: true });
  assert.equal(r.status, 401);
});

await step('a notification for Ada reaches the bridge, signed, within seconds', async () => {
  const ben = await browser.newContext();
  await ben.request.post(`${BASE}/api/demo/session`, { data: { userId: 'u-att-ben' } });
  const post = await context.request.post(`${BASE}/api/events/${EVENT}/feed`, { data: { text: `Chat bridge check ${Date.now()}` } });
  const postId = (await post.json()).data.id;
  await ben.request.post(`${BASE}/api/events/${EVENT}/feed/${postId}`, { data: { action: 'like', on: true } });
  const deadline = Date.now() + 8000;
  while (!deliveries.some((d) => d.body.externalUserId === 'nx-ada' && /liked your post/.test(d.body.body)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const delivery = deliveries.find((d) => /liked your post/.test(d.body.body));
  assert.ok(delivery, 'no delivery arrived');
  assert.equal(delivery.verified, true);
  assert.match(delivery.key, /^dlv_/);
  await ben.close();
});

await step('unlinking stops it', async () => {
  await page.getByRole('button', { name: 'Unlink' }).click();
  // HELLO asks for confirmation in its own modal dialog.
  await page.locator('dialog[open]').getByRole('button', { name: 'Unlink' }).click();
  await page.getByTestId('chat-links').waitFor({ state: 'detached' });
  const r = await toHello({ eventId: EVENT, externalUserId: 'nx-ada', messageId: 'm-5', text: 'Hello again' });
  assert.equal(r.body.data.linked, false);
});

await browser.close();
server.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} chat gateway checks passed`);
if (passed !== results.length) process.exitCode = 1;
