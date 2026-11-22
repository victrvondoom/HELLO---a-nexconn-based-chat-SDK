/* global process, console, document, Image, URL, Buffer */
/**
 * Privacy filter (integrated from Offleak), in real browsers against the demo server:
 *
 * 1. Settings persist through the page.
 * 2. Live preview: the real YuNet model and Tesseract load in the browser and the filter reports face and
 *    code/number checks per second on the fake camera.
 * 3. Fail closed: when the face model cannot load, the filter blurs everything and says why.
 * 4. A picture posted to Moments is protected on the device: the face is detected by the real model, the upload is a
 *    re-encoded JPEG, and the face region in what was uploaded is pixelated. The picture is
 *    tests/fixtures/privacy/crew.jpg (a public-domain NASA crew portrait, see tests/fixtures/privacy/PROVENANCE.md).
 * 5. A call with the filter on: the other person receives video; the host sends a privacy alert, only the recipient
 *    sees it, and acknowledges it.
 * 6. Twitch sign-in starts with only the chat-reading scope (no real Twitch account is used).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const FIXTURE = process.env.PRIVACY_FACE_FIXTURE ?? fileURLToPath(new URL('../fixtures/privacy/crew.jpg', import.meta.url));
/** The face of the crew member standing on the left in crew.jpg (1280 x 1024), in picture pixels. */
const FACE = { x0: 215, x1: 290, y0: 235, y1: 320 };
const results = [];
async function step(name, fn) {
  try {
    const outcome = await fn();
    if (outcome === 'skip') {
      console.log(`SKIP  ${name}`);
      return;
    }
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
  context.setDefaultTimeout(30000);
  await context.request.post(`${BASE}/api/demo/session`, { data: { userId } });
  return { context, page: await context.newPage() };
}
const api = (p, path, method = 'GET', data) => p.context.request.fetch(`${BASE}/api/events/${EVENT}${path}`, { method, data, headers: { origin: BASE } });
const settled = (page) => page.waitForFunction(() => !document.querySelector('.pf-switch input')?.disabled);

const ada = await as('u-att-ada');
const ben = await as('u-att-ben');

await step('the privacy filter page saves a setting that survives a reload', async () => {
  await ada.page.goto(`${BASE}/events/${EVENT}/privacy-filter`);
  await settled(ada.page);
  const box = ada.page.getByLabel('Use the privacy filter in calls');
  assert.equal(await box.isChecked(), false, 'off by default');
  await box.check();
  await ada.page.waitForTimeout(500);
  await ada.page.reload();
  await settled(ada.page);
  assert.equal(await ada.page.getByLabel('Use the privacy filter in calls').isChecked(), true);
  const r = await (await api(ada, '/privacy-filter')).json();
  assert.equal(r.data.settings.enabled, true);
});

const statValue = (page, label) =>
  page.evaluate((l) => {
    const dt = [...document.querySelectorAll('.pf-stats__grid dt')].find((d) => d.textContent === l);
    return Number.parseFloat(dt?.nextElementSibling?.textContent ?? 'NaN');
  }, label);

await step('live preview: real models load in the browser and check the camera continuously', async () => {
  await ada.page.getByRole('button', { name: 'Start preview' }).click();
  await ada.page.getByText('Protecting').waitFor({ timeout: 60000 });
  await ada.page.waitForFunction(
    () => {
      const read = (l) => Number.parseFloat([...document.querySelectorAll('.pf-stats__grid dt')].find((d) => d.textContent === l)?.nextElementSibling?.textContent ?? '0');
      return read('Face checks') > 0 && read('Code and number checks') > 0;
    },
    null,
    { timeout: 90000 },
  );
  await ada.page.waitForTimeout(8000);
  console.log(`      after 8 s more: face checks/s ${await statValue(ada.page, 'Face checks')}, code+number checks/s ${await statValue(ada.page, 'Code and number checks')}, output ${await statValue(ada.page, 'Output')} fps`);
  assert.equal(await ada.page.locator('.pf-stats__errors').count(), 0);
  await ada.page.getByRole('button', { name: 'Stop preview' }).click();
});

await step('fails closed: without the face model the whole picture is blurred, and the page says why', async () => {
  const chloe = await as('u-att-chloe');
  await chloe.context.route('**/face_detection_yunet_2023mar.onnx', (route) => route.abort());
  await api(chloe, '/privacy-filter', 'PUT', { enabled: true });
  await chloe.page.goto(`${BASE}/events/${EVENT}/privacy-filter`);
  await settled(chloe.page);
  await chloe.page.getByRole('button', { name: 'Start preview' }).click();
  await chloe.page.getByText('Blurring everything').waitFor({ timeout: 60000 });
  await chloe.page.getByText(/Face detector \(YuNet\) could not load/).waitFor();
  await chloe.page.waitForFunction(() => Number.parseFloat([...document.querySelectorAll('.pf-stats__grid dt')].find((d) => d.textContent === 'Fully blurred frames')?.nextElementSibling?.textContent ?? '0') > 0);
  await chloe.context.close();
});

const SHARPNESS = async ([original, uploaded, face]) => {
      const sharp = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const { data, width } = g.getImageData(0, 0, c.width, c.height);
        let sum = 0;
        let n = 0;
        for (let y = face.y0; y < face.y1; y += 1) {
          for (let x = face.x0; x < face.x1; x += 1) {
            const at = (dx, dy) => data[((y + dy) * width + x + dx) * 4 + 1];
            sum += Math.abs(4 * at(0, 0) - at(1, 0) - at(-1, 0) - at(0, 1) - at(0, -1));
            n += 1;
          }
        }
        return sum / n;
      };
      return (await sharp(uploaded)) / (await sharp(original));
    };

let png = '';
/** Posts the fixture picture through the composer; returns the face area's detail in what the server stored, relative to the original. */
async function postFixture() {
  await ada.page.goto(`${BASE}/events/${EVENT}/feed`);
  await ada.page.getByRole('button', { name: /Share something with the event/ }).click();
  await ada.page.locator('.pcomposer input[type=file]').setInputFiles({ name: 'crowd.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await ada.page.waitForFunction(() => document.querySelector('.pf-guard input')?.checked === true, null, { timeout: 10000 });
  const upload = ada.page.waitForResponse((r) => r.url().endsWith('/media') && r.request().method() === 'POST', { timeout: 120000 });
  await ada.page.getByRole('button', { name: 'Post', exact: true }).click();
  const mediaId = (await (await upload).json()).data.id;
  const stored = await api(ada, `/media/${mediaId}`);
  assert.equal(stored.headers()['content-type'], 'image/jpeg', 'the server received the re-encoded JPEG, not the original PNG');
  const sent = Buffer.from(await stored.body());
  return ada.page.evaluate(SHARPNESS, [`data:image/png;base64,${png}`, `data:image/jpeg;base64,${sent.toString('base64')}`, FACE]);
}

await step('a picture posted to Moments is protected on the device before upload', async () => {
  if (!existsSync(FIXTURE)) return 'skip';
  // Post the fixture as a PNG, so the test can tell the original from the re-encoded JPEG the server stores.
  const scratch = await ada.context.newPage();
  png = await scratch.evaluate(async (jpg) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${jpg}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, readFileSync(FIXTURE).toString('base64'));
  await scratch.close();
  const ratio = await postFixture();
  console.log(`      face-area detail after/before: ${ratio.toFixed(2)}`);
  assert.ok(ratio < 0.5, 'the face area in the uploaded picture is pixelated');
});

await step('a person kept visible stays sharp; removing them blurs them again', async () => {
  if (!png) return 'skip';
  await ada.page.goto(`${BASE}/events/${EVENT}/privacy-filter`);
  await settled(ada.page);
  // "Add me": a photo of only the crew member on the left (the measured face), cut from the same picture
  const me = await ada.page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 240;
    c.getContext('2d').drawImage(img, 150, 170, 220, 240, 0, 0, 220, 240);
    return c.toDataURL('image/png').split(',')[1];
  }, `data:image/png;base64,${png}`);
  await ada.page.locator('section[aria-labelledby="pf-people"] .pf-file input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(me, 'base64') });
  await ada.page.getByText('Person 1').waitFor({ timeout: 60000 });
  const kept = await postFixture();
  console.log(`      kept visible: face-area detail after/before ${kept.toFixed(2)}`);
  assert.ok(kept > 0.7, 'the chosen person is left sharp (only JPEG re-encoding)');
  await ada.page.goto(`${BASE}/events/${EVENT}/privacy-filter`);
  await ada.page.getByRole('button', { name: 'Remove everyone' }).click();
  await ada.page.getByText(/Nobody yet/).waitFor();
  const again = await postFixture();
  assert.ok(again < 0.5, 'after removal the face is blurred again');
});

let callId = '';
await step('a call with the privacy filter on still reaches the other person', async () => {
  const r = await ada.context.request.post(`${BASE}/api/events/${EVENT}/calls`, { data: { title: 'Filtered call' }, headers: { origin: BASE } });
  callId = (await r.json()).data.id;
  for (const p of [ada, ben]) {
    await p.page.goto(`${BASE}/events/${EVENT}/calls/${callId}`);
    await p.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Join call') && !b.disabled));
    await p.page.getByRole('button', { name: 'Join call' }).click();
  }
  await ada.page.getByText(/Protecting|Warming up/).first().waitFor();
  await ben.page.waitForFunction(
    () => {
      const remote = [...document.querySelectorAll('video')].find((v) => /’s video$/.test(v.getAttribute('aria-label') ?? ''));
      return remote !== undefined && remote.readyState >= 2 && remote.videoWidth > 0;
    },
    null,
    { timeout: 40000 },
  );
});

await step('the host sends a privacy alert; only its recipient sees it, and acknowledges it', async () => {
  await ada.page.getByRole('button', { name: 'Privacy alert' }).first().click();
  await ben.page.getByText(/asks you to check what your camera or screen shows/).waitFor({ timeout: 15000 });
  assert.equal(await ben.page.getByRole('button', { name: 'Privacy alert' }).count(), 0, 'an attendee who is not the host gets no alert controls');
  await ben.page.getByRole('button', { name: 'I have checked' }).click();
  await ben.page.getByText(/asks you to check/).waitFor({ state: 'detached', timeout: 15000 });
  const benAlerts = (await (await api(ben, '/privacy-filter')).json()).data.alerts;
  assert.equal(benAlerts[0].acknowledged, true);
  assert.equal((await (await api(ada, '/privacy-filter')).json()).data.alerts.length, 0);
});

await step('Twitch sign-in asks only for chat-reading access', async () => {
  const r = await api(ada, '/privacy-filter/twitch', 'POST', { action: 'start', clientId: 'abc123' });
  const url = new URL((await r.json()).data.url);
  assert.equal(url.host, 'id.twitch.tv', url.href);
  assert.equal(url.searchParams.get('scope'), 'user:read:chat', url.href);
  assert.equal(url.searchParams.get('redirect_uri'), `${BASE}/twitch/callback`, url.href);
  const bad = await api(ada, '/privacy-filter/twitch', 'POST', { action: 'start', clientId: 'a/b' });
  assert.equal(bad.status(), 422, 'HELLO answers a validation failure with 422');
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} privacy filter checks passed`);
if (passed !== results.length) process.exitCode = 1;
