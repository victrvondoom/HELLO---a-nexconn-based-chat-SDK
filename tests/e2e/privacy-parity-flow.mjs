/* global process, console, document, window, navigator, setInterval, setTimeout, URL, DOMException, Image, Buffer, MediaRecorder, Blob, FileReader, performance, AudioContext, OfflineAudioContext, MediaStream, atob */
/**
 * Privacy filter parity (Offleak features in HELLO), in real Chromium against a running HELLO, with the real models.
 * Every check below reads pixels of what the filter actually produced; nothing is mocked.
 *
 * Test media (tests/fixtures/privacy/PROVENANCE.md): crew.jpg (six people facing the camera) and control.jpg (people
 * seen from behind, wall screens and console monitors) are public-domain NASA photographs. QR codes, phone numbers
 * and the video are generated here from those pictures.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM_PATH=... node tests/e2e/privacy-parity-flow.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const fixture = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/privacy/${name}`, import.meta.url)));
const CREW = fixture('crew.jpg');
const CONTROL = fixture('control.jpg');
const CREW_SRC = `data:image/jpeg;base64,${CREW.toString('base64')}`;
/** Faces in crew.jpg (1280 x 1024): A stands on the left, B sits next to A. */
const FACE_A = { x0: 215, x1: 290, y0: 235, y1: 320 };
const FACE_B = { x0: 390, x1: 470, y0: 310, y1: 400 };
const ONLY = process.env.PF_ONLY ? new RegExp(process.env.PF_ONLY) : null;
const results = [];
const metrics = {};

async function step(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push(true);
    console.log(`PASS  ${name} (${String(Math.round((Date.now() - t0) / 1000))} s)`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${String(error).split('\n').slice(0, 3).join('\n      ')}`);
  }
}

function qrMatrix(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (q.isDark(r, c) ? 1 : 0)));
}
const QR_OK = qrMatrix('https://tickets.example.test/seat/14C?holder=8812');
const QR_BAD = qrMatrix('https://tickets.example.test/seat/15D?holder=9907');

/** Page-side helpers, installed into every page. */
const HELPERS = () => {
  window.pf = {
    async image(src) {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    },
    /** Mean absolute Laplacian of the green channel inside a region: how much fine detail is left. */
    detail(source, w, h, r) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(source, 0, 0, w, h);
      const { data } = g.getImageData(0, 0, w, h);
      let sum = 0;
      let n = 0;
      for (let y = Math.max(1, Math.round(r.y0)); y < Math.min(h - 1, Math.round(r.y1)); y += 1) {
        for (let x = Math.max(1, Math.round(r.x0)); x < Math.min(w - 1, Math.round(r.x1)); x += 1) {
          const at = (dx, dy) => data[((y + dy) * w + x + dx) * 4 + 1];
          sum += Math.abs(4 * at(0, 0) - at(1, 0) - at(-1, 0) - at(0, 1) - at(0, -1));
          n += 1;
        }
      }
      return n ? sum / n : 0;
    },
    qr(g, m, x, y, cell, damage) {
      g.fillStyle = '#fff';
      g.fillRect(x - 4 * cell, y - 4 * cell, (m.length + 8) * cell, (m.length + 8) * cell);
      g.fillStyle = '#111';
      m.forEach((row, r) => {
        row.forEach((v, c) => {
          if (v) g.fillRect(x + c * cell, y + r * cell, cell, cell);
        });
      });
      if (damage) {
        // scribble over the data area: the finder squares stay, the code can no longer be decoded
        let seed = 11;
        for (let r = 9; r < m.length; r += 1) {
          for (let c = 9; c < m.length; c += 1) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            g.fillStyle = seed % 2 ? '#111' : '#fff';
            g.fillRect(x + c * cell, y + r * cell, cell, cell);
          }
        }
      }
    },
    /** crew.jpg cut to only person A's head and shoulders. */
    async faceA(src) {
      const img = await window.pf.image(src);
      const c = document.createElement('canvas');
      c.width = 220;
      c.height = 240;
      c.getContext('2d').drawImage(img, 150, 170, 220, 240, 0, 0, 220, 240);
      return c;
    },
    toBase64(blob) {
      return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => {
          resolve(String(fr.result).split(',')[1]);
        };
        fr.readAsDataURL(blob);
      });
    },
  };
};

await resetDemo(BASE);
const dir = mkdtempSync(join(tmpdir(), 'hello-pf-'));
// Chromium's fake camera plays this file: the crew portrait, as motion JPEG.
const camFile = join(dir, 'crew.mjpeg');
writeFileSync(camFile, Buffer.concat([CREW, CREW, CREW]));
const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch({
  ...exe,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camFile}`, '--autoplay-policy=no-user-gesture-required'],
});

async function as(userId, b = browser, permissions = ['camera', 'microphone']) {
  const context = await b.newContext({ permissions, viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(30000);
  await context.addInitScript(HELPERS);
  await context.request.post(`${BASE}/api/demo/session`, { data: { userId } });
  return { context, page: await context.newPage() };
}
const api = (p, path, method = 'GET', data, headers = {}) => p.context.request.fetch(`${BASE}/api/events/${EVENT}${path}`, { method, data, headers: { origin: BASE, ...headers } });
const settled = (page) => page.waitForFunction(() => !document.querySelector('.pf-switch input')?.disabled);
const stat = (page, label) =>
  page.evaluate((l) => Number.parseFloat([...document.querySelectorAll('.pf-stats__grid dt')].find((d) => d.textContent === l)?.nextElementSibling?.textContent ?? 'NaN'), label);
const openDock = async (p) => {
  await p.page.goto(`${BASE}/events/${EVENT}/privacy-filter`);
  await settled(p.page);
};
const mediaInput = (page) => page.locator('section[aria-labelledby="pf-media"] .pf-file input[type=file]');

const ada = await as('u-att-ada');
await api(ada, '/privacy-filter', 'PUT', { enabled: true, effect: 'pixelate' });

await step('settings: the effect and the new switches are saved and survive a reload', async () => {
  await openDock(ada);
  await ada.page.getByLabel('How hidden areas look').selectOption('blur');
  await ada.page.getByLabel('People seen from behind or turned away').uncheck();
  await ada.page.waitForTimeout(800);
  await ada.page.reload();
  await settled(ada.page);
  assert.equal(await ada.page.getByLabel('How hidden areas look').inputValue(), 'blur');
  assert.equal(await ada.page.getByLabel('People seen from behind or turned away').isChecked(), false);
  const s = (await (await api(ada, '/privacy-filter')).json()).data.settings;
  assert.equal(s.effect, 'blur');
  assert.equal(s.peopleEnabled, false);
  await api(ada, '/privacy-filter', 'PUT', { effect: 'pixelate', peopleEnabled: true });
});

await step('models: every model file is installed and reported on the page', async () => {
  await openDock(ada);
  await ada.page.waitForFunction(() => !document.querySelector('.pf-models__checking'));
  assert.equal(await ada.page.locator('.pf-models__missing').count(), 0, 'no model is missing');
  assert.equal(await ada.page.locator('.pf-models__installed').count(), 6);
});

/** Puts a picture into the page's media tool and waits until detection has finished. */
async function detectInTool(p, name, mimeType, buffer) {
  await openDock(p);
  await mediaInput(p.page).setInputFiles({ name, mimeType, buffer });
  await p.page.getByRole('button', { name: 'Protect picture' }).waitFor({ timeout: 180000 });
  const labels = await p.page.locator('.pf-found label').allInnerTexts();
  return { labels, faces: labels.filter((l) => l.includes('face or head')).length, qr: labels.filter((l) => l.includes('QR code')).length, phone: labels.filter((l) => l.includes('phone number')).length };
}

await step('people seen from behind: the pose model finds heads that face detection alone cannot', async () => {
  await api(ada, '/privacy-filter', 'PUT', { peopleEnabled: false });
  const off = await detectInTool(ada, 'control.jpg', 'image/jpeg', CONTROL);
  await api(ada, '/privacy-filter', 'PUT', { peopleEnabled: true });
  const on = await detectInTool(ada, 'control.jpg', 'image/jpeg', CONTROL);
  console.log(`      control.jpg heads: faces only ${String(off.faces)}, with people from behind ${String(on.faces)}`);
  metrics.controlHeads = { facesOnly: off.faces, withPose: on.faces };
  assert.ok(on.faces >= off.faces + 3, 'several more heads are found with the pose model');
  await ada.page.getByRole('button', { name: 'Protect picture' }).click();
  const summary = await ada.page.locator('.pf-result [role=status]').innerText({ timeout: 60000 });
  console.log(`      summary: ${summary}`);
  metrics.controlSummary = summary;
  assert.match(summary, /screens? zoomed into/, 'the wall screens and monitors were found for crop zoom');
});

let sheet = '';
const SHEET = { face: { x0: 80, x1: 165, y0: 95, y1: 190 }, qrOk: { x0: 470, x1: 640, y0: 80, y1: 250 }, qrBad: { x0: 760, x1: 930, y0: 80, y1: 250 }, phone: { x0: 60, x1: 760, y0: 420, y1: 500 }, note: { x0: 820, x1: 1200, y0: 560, y1: 660 } };

await step('picture review: faces, a readable and an unreadable QR code and a phone number are found; manual areas and exclusions apply', async () => {
  // A synthetic notice board: a face cut from crew.jpg, two QR codes (one damaged), a phone number, a private note.
  sheet = await ada.page.evaluate(
    async ([crew, ok, bad]) => {
      const c = document.createElement('canvas');
      c.width = 1280;
      c.height = 720;
      const g = c.getContext('2d');
      g.fillStyle = '#f4f1ea';
      g.fillRect(0, 0, 1280, 720);
      g.drawImage(await window.pf.faceA(crew), 20, 40);
      window.pf.qr(g, ok, 480, 90, 5, false);
      window.pf.qr(g, bad, 770, 90, 5, true);
      g.fillStyle = '#111';
      g.font = 'bold 54px Arial';
      g.fillText('Call me: +1 (415) 555-0132', 70, 480);
      g.font = '40px Georgia';
      g.fillText('PRIVATE NOTE: door 4471', 830, 625);
      return c.toDataURL('image/png').split(',')[1];
    },
    [CREW_SRC, QR_OK, QR_BAD],
  );
  const found = await detectInTool(ada, 'board.png', 'image/png', Buffer.from(sheet, 'base64'));
  console.log(`      found: ${String(found.faces)} faces, ${String(found.qr)} QR codes, ${String(found.phone)} phone numbers`);
  metrics.sheetFound = found;
  assert.ok(found.faces >= 1, 'the face');
  assert.ok(found.qr >= 2, 'both QR codes, including the one that cannot be decoded');
  assert.ok(found.phone >= 1, 'the phone number');
  // leave the phone number visible (a false alarm, say), and hide the private note by hand
  for (const label of await ada.page.locator('.pf-found label').filter({ hasText: 'phone number' }).all()) await label.locator('input').uncheck();
  const svg = await ada.page.locator('.pf-regions').boundingBox();
  const sx = svg.width / 1280;
  const sy = svg.height / 720;
  await ada.page.mouse.move(svg.x + SHEET.note.x0 * sx, svg.y + SHEET.note.y0 * sy);
  await ada.page.mouse.down();
  await ada.page.mouse.move(svg.x + SHEET.note.x1 * sx, svg.y + SHEET.note.y1 * sy, { steps: 5 });
  await ada.page.mouse.up();
  await ada.page.getByText('Area 1:').waitFor();
  await ada.page.getByRole('button', { name: 'Protect picture' }).click();
  await ada.page.locator('.pf-result img').waitFor({ timeout: 60000 });
  const ratios = await ada.page.evaluate(
    async ([orig, regions]) => {
      const a = await window.pf.image(`data:image/png;base64,${orig}`);
      const b = await window.pf.image(document.querySelector('.pf-result img').src);
      const out = {};
      for (const [k, r] of Object.entries(regions)) out[k] = window.pf.detail(b, 1280, 720, r) / window.pf.detail(a, 1280, 720, r);
      return out;
    },
    [sheet, SHEET],
  );
  console.log(`      detail kept (after/before): ${Object.entries(ratios).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
  metrics.sheet = ratios;
  for (const k of ['face', 'qrOk', 'qrBad', 'note']) assert.ok(ratios[k] < 0.5, `${k} is hidden`);
  assert.ok(ratios.phone > 0.7, 'the excluded phone number is left as it was');
});

await step('posting the reviewed picture: the server stores the protected JPEG, not the original', async () => {
  const upload = ada.page.waitForResponse((r) => r.url().endsWith('/media') && r.request().method() === 'POST', { timeout: 60000 });
  await ada.page.getByRole('button', { name: 'Post the protected copy to Moments' }).click();
  const res = await upload;
  assert.equal(res.request().headers()['x-hello-privacy'], 'protected');
  assert.equal(res.request().headers()['content-type'], 'image/jpeg');
  const stored = await api(ada, `/media/${(await res.json()).data.id}`);
  assert.equal(stored.headers()['content-type'], 'image/jpeg');
  const ratio = await ada.page.evaluate(
    async ([orig, got, r]) => window.pf.detail(await window.pf.image(`data:image/jpeg;base64,${got}`), 1280, 720, r) / window.pf.detail(await window.pf.image(`data:image/png;base64,${orig}`), 1280, 720, r),
    [sheet, Buffer.from(await stored.body()).toString('base64'), SHEET.qrOk],
  );
  assert.ok(ratio < 0.5, `the stored picture's QR code is hidden (${ratio.toFixed(2)})`);
});

await step('no bypass: with the filter on, an upload that did not go through it is refused by the server', async () => {
  const raw = await api(ada, '/media', 'POST', CREW, { 'content-type': 'image/jpeg' });
  assert.equal(raw.ok(), false);
  assert.match((await raw.json()).error.message, /privacy filter is on/);
  const ben = await as('u-att-ben');
  const benRaw = await api(ben, '/media', 'POST', CREW, { 'content-type': 'image/jpeg' });
  assert.equal(benRaw.status(), 201, 'someone whose filter is off uploads as before');
  await ben.context.close();
});

let clip = '';
/** One frame of the test video at time t: A's face moves left to right; a QR code and a phone number stay put. */
const DRAW_FRAME = `(async (g, t, face) => {
  g.fillStyle = '#dfe7ef';
  g.fillRect(0, 0, 640, 360);
  g.drawImage(face, 0, 0, 220, 240, 20 + t * 90, 40, 165, 180);
  window.pf.qr(g, window.QR, 470, 30, 4, false);
  g.fillStyle = '#111';
  g.font = 'bold 34px Arial';
  g.fillText('+1 415 555 0132', 40, 320);
})`;

await step('video: a recorded clip is processed frame by frame; the moving face is tracked and hidden in the export', async () => {
  clip = await ada.page.evaluate(
    async ([crew, qr, draw]) => {
      window.QR = qr;
      const drawFrame = (0, eval)(draw);
      const face = await window.pf.faceA(crew);
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d');
      await drawFrame(g, 0, face);
      // a 440 Hz tone as the sound track, so the audio path is exercised too
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const sink = audio.createMediaStreamDestination();
      tone.connect(sink);
      tone.start();
      const stream = new MediaStream([...c.captureStream(15).getVideoTracks(), ...sink.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 2_000_000 });
      const parts = [];
      rec.ondataavailable = (e) => {
        parts.push(e.data);
      };
      const stopped = new Promise((r) => {
        rec.onstop = r;
      });
      rec.start();
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        await drawFrame(g, (performance.now() - t0) / 1000, face);
        await new Promise((r) => setTimeout(r, 33));
      }
      rec.stop();
      await stopped;
      tone.stop();
      await audio.close();
      return window.pf.toBase64(new Blob(parts, { type: 'video/webm' }));
    },
    [CREW_SRC, QR_OK, DRAW_FRAME],
  );
  await openDock(ada);
  await mediaInput(ada.page).setInputFiles({ name: 'walk.webm', mimeType: 'video/webm', buffer: Buffer.from(clip, 'base64') });
  await ada.page.getByRole('button', { name: 'Protect video' }).click();
  await ada.page.locator('.pf-progress').waitFor({ timeout: 60000 });
  await ada.page.locator('.pf-result video').waitFor({ timeout: 600000 });
  const summary = await ada.page.locator('.pf-result [role=status]').innerText();
  console.log(`      ${summary}`);
  metrics.videoSummary = summary;
  assert.ok(Number(/(\d+) frames checked/.exec(summary)?.[1] ?? 0) >= 40, 'about four seconds of frames were processed');
  assert.match(summary, /audio carried over/, 'the sound track was kept');
  // the file the person gets from the Download link
  const download = ada.page.waitForEvent('download');
  await ada.page.getByRole('link', { name: 'Download' }).click();
  const exported = readFileSync(await (await download).path());
  assert.equal(exported.subarray(0, 4).toString('hex'), '1a45dfa3', 'a WebM file');
  const sound = await ada.page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.buffer);
    const data = decoded.getChannelData(0);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    return { seconds: decoded.duration, peak };
  }, exported.toString('base64'));
  console.log(`      exported sound: ${sound.seconds.toFixed(2)} s, peak ${sound.peak.toFixed(2)}`);
  metrics.videoSound = sound;
  assert.ok(sound.seconds > 3 && sound.peak > 0.1, 'the exported file plays the tone');
  const checks = await ada.page.evaluate(
    async ([crew, qr, draw, times]) => {
      window.QR = qr;
      const drawFrame = (0, eval)(draw);
      const face = await window.pf.faceA(crew);
      const v = document.querySelector('.pf-result video');
      if (v.readyState < 1) await new Promise((r) => { v.onloadedmetadata = r; });
      const ref = document.createElement('canvas');
      ref.width = 640;
      ref.height = 360;
      const out = [];
      for (const t of times) {
        v.currentTime = t;
        await new Promise((r) => { v.onseeked = r; });
        await drawFrame(ref.getContext('2d'), t, face);
        // the face box in the video at time t (the face sits in the middle of the moving cut-out)
        const fx = { x0: 20 + t * 90 + 55, x1: 20 + t * 90 + 115, y0: 90, y1: 160 };
        const q = { x0: 470, x1: 600, y0: 30, y1: 160 };
        out.push({ t, w: v.videoWidth, face: window.pf.detail(v, 640, 360, fx) / window.pf.detail(ref, 640, 360, fx), qr: window.pf.detail(v, 640, 360, q) / window.pf.detail(ref, 640, 360, q) });
      }
      return out;
    },
    [CREW_SRC, QR_OK, DRAW_FRAME, [0.5, 1.5, 2.5, 3.3]],
  );
  console.log(`      exported frames (after/before): ${checks.map((c) => `t=${String(c.t)}s face ${c.face.toFixed(2)} qr ${c.qr.toFixed(2)}`).join('; ')}`);
  metrics.video = checks;
  assert.equal(checks[0].w, 640);
  for (const c of checks) {
    assert.ok(c.face < 0.5, `the face is hidden at ${String(c.t)}s`);
    assert.ok(c.qr < 0.5, `the QR code is hidden at ${String(c.t)}s`);
  }
});

await step('Moments: a video posted with protection on is processed on the device; the server stores the new WebM', async () => {
  await ada.page.goto(`${BASE}/events/${EVENT}/feed`);
  await ada.page.getByRole('button', { name: /Share something with the event/ }).click();
  await ada.page.locator('.pcomposer input[type=file]').setInputFiles({ name: 'walk.webm', mimeType: 'video/webm', buffer: Buffer.from(clip, 'base64') });
  await ada.page.waitForFunction(() => document.querySelector('.pf-guard input')?.checked === true, null, { timeout: 10000 });
  const upload = ada.page.waitForResponse((r) => r.url().endsWith('/media') && r.request().method() === 'POST', { timeout: 600000 });
  await ada.page.getByRole('button', { name: 'Post', exact: true }).click();
  await ada.page.locator('.pf-guard progress').waitFor({ timeout: 60000 });
  const res = await upload;
  assert.equal(res.request().headers()['x-hello-privacy'], 'protected');
  const stored = await api(ada, `/media/${(await res.json()).data.id}`);
  assert.equal(stored.headers()['content-type'], 'video/webm');
  assert.notDeepEqual(Buffer.from(await stored.body()), Buffer.from(clip, 'base64'), 'the server did not receive the original recording');
});

await step('GIFs are refused while protection is on (they cannot be checked), never sent unchecked', async () => {
  await ada.page.goto(`${BASE}/events/${EVENT}/feed`);
  await ada.page.getByRole('button', { name: /Share something with the event/ }).click();
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  let posted = false;
  ada.page.on('request', (r) => {
    if (r.url().endsWith('/media') && r.method() === 'POST') posted = true;
  });
  await ada.page.locator('.pcomposer input[type=file]').setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: gif });
  await ada.page.getByRole('button', { name: 'Post', exact: true }).click();
  await ada.page.getByText(/Animated GIFs cannot be checked on this device/).first().waitFor();
  assert.equal(posted, false);
});

/** Live: samples the protected preview; returns each sample's detail in the given crew.jpg regions. */
async function sampleLive(page, seconds, regions) {
  return page.evaluate(
    async ([s, crewSrc, regs]) => {
      const v = document.querySelector('.pf-stage video');
      const crew = await window.pf.image(crewSrc);
      const samples = [];
      const t0 = performance.now();
      let ref = null;
      while (performance.now() - t0 < s * 1000) {
        if (v.videoWidth) {
          const w = v.videoWidth;
          const h = v.videoHeight;
          // Chromium's fake camera centre-crops the 1280 x 1024 picture to the requested shape, then scales it
          const k = w / 1280;
          const offY = (1024 - h / k) / 2;
          if (!ref) {
            ref = document.createElement('canvas');
            ref.width = w;
            ref.height = h;
            ref.getContext('2d').drawImage(crew, 0, offY, 1280, h / k, 0, 0, w, h);
          }
          const row = { t: Math.round(performance.now() - t0) };
          for (const [name, r] of Object.entries(regs)) {
            const rr = { x0: r.x0 * k, x1: r.x1 * k, y0: (r.y0 - offY) * k, y1: (r.y1 - offY) * k };
            row[name] = window.pf.detail(v, w, h, rr) / window.pf.detail(ref, w, h, rr);
          }
          samples.push(row);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return samples;
    },
    [seconds, CREW_SRC, regions],
  );
}

await step('live camera with real faces: nothing unfiltered is shown from the first frame, and strangers stay hidden', async () => {
  const chloe = await as('u-att-chloe');
  await api(chloe, '/privacy-filter', 'PUT', { enabled: true });
  await openDock(chloe);
  await chloe.page.getByRole('button', { name: 'Start preview' }).click();
  const samples = await sampleLive(chloe.page, 25, { a: FACE_A, b: FACE_B });
  const worst = Math.max(...samples.map((s) => Math.max(s.a, s.b)));
  console.log(`      ${String(samples.length)} samples over 25 s from the start; most face detail ever shown: ${worst.toFixed(2)} of the original`);
  metrics.liveWorst = worst;
  assert.ok(samples.length > 50);
  assert.ok(worst < 0.5, 'no sample showed a face');
  await chloe.page.getByText('Protecting').waitFor({ timeout: 60000 });
  await chloe.page.waitForTimeout(5000);
  const m = {};
  for (const k of ['Output', 'Delay', 'Face checks', 'Code and number checks', 'Screen zoom checks', 'Faces seen', 'People seen', 'Fully blurred frames', 'Dropped', 'Work per frame']) m[k] = await stat(chloe.page, k);
  console.log(`      measured: ${JSON.stringify(m)}`);
  metrics.liveCamera = m;
  assert.ok(m['Faces seen'] >= 4, 'the faces in the camera are detected');
  await chloe.page.getByRole('button', { name: 'Stop preview' }).click();
  await chloe.context.close();
});

await step('live camera: a person kept visible stays sharp while the stranger next to them stays hidden, even when the device is slow', async () => {
  const ben = await as('u-att-ben');
  await api(ben, '/privacy-filter', 'PUT', { enabled: true });
  await openDock(ben);
  const me = await ben.page.evaluate(async (src) => (await window.pf.faceA(src)).toDataURL('image/png').split(',')[1], CREW_SRC);
  await ben.page.locator('section[aria-labelledby="pf-people"] .pf-file input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(me, 'base64') });
  await ben.page.getByText('Person 1').waitFor({ timeout: 120000 });
  await ben.page.getByRole('button', { name: 'Start preview' }).click();
  await ben.page.getByText('Protecting').waitFor({ timeout: 90000 });
  await ben.page.waitForTimeout(8000);
  const samples = await sampleLive(ben.page, 6, { a: FACE_A, b: FACE_B });
  const mean = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
  console.log(`      kept person A detail ${mean('a').toFixed(2)}, stranger B ${mean('b').toFixed(2)} (of the original, at the output size)`);
  metrics.liveKept = { a: mean('a'), b: mean('b') };
  assert.ok(mean('a') > 0.6, 'the chosen person is visible');
  assert.ok(Math.max(...samples.map((s) => s.b)) < 0.5, 'the stranger is never visible');
  const cdp = await ben.context.newCDPSession(ben.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
  const slow = await sampleLive(ben.page, 10, { b: FACE_B });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const slowWorst = Math.max(...slow.map((s) => s.b));
  console.log(`      under 8x CPU throttling: stranger max detail ${slowWorst.toFixed(2)}, fully blurred frames ${String(await stat(ben.page, 'Fully blurred frames'))}, dropped ${String(await stat(ben.page, 'Dropped'))}`);
  metrics.throttled = slowWorst;
  assert.ok(slowWorst < 0.5, 'slow inference never exposes the stranger');
  await ben.page.getByRole('button', { name: 'Stop preview' }).click();
  await ben.page.getByRole('button', { name: 'Remove everyone' }).click();
  await ben.context.close();
});

/**
 * Screen sharing. Real OS screen capture cannot start on this test machine (Chromium reports NotReadableError for
 * tab, window and whole-screen capture, headless and headed), so the test replaces only the capture source:
 * getDisplayMedia returns a 1280 x 720 "screen" drawn on a canvas, with a face, a QR code and a phone number.
 * Everything after that is HELLO's real code: the preview, and a call where the other person receives the share.
 */
const BOARD = { face: { x0: 140, x1: 248, y0: 140, y1: 262 }, qr: { x0: 560, x1: 820, y0: 80, y1: 340 }, phone: { x0: 40, x1: 700, y0: 505, y1: 570 } };
const SCREEN_SOURCE = ([crewSrc, qr]) => {
  window.drawBoard = async (g) => {
    const face = await window.pf.faceA(crewSrc);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 1280, 720);
    g.drawImage(face, 40, 40, 330, 360);
    window.pf.qr(g, qr, 560, 80, 8, false);
    g.fillStyle = '#111';
    g.font = 'bold 56px Arial';
    g.fillText('Call +1 (415) 555-0132', 40, 560);
  };
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d');
    await window.drawBoard(g);
    setInterval(() => void window.drawBoard(g), 200);
    return c.captureStream(15);
  };
};
/** Detail left in each board region of `video` (found by selector), relative to the board itself. */
const boardDetail = (page, selector) =>
  page.evaluate(
    async ([sel, regions]) => {
      const v = [...document.querySelectorAll('video')].find((x) => x.matches(sel));
      const w = v.videoWidth;
      const h = v.videoHeight;
      const ref = document.createElement('canvas');
      ref.width = 1280;
      ref.height = 720;
      await window.drawBoard(ref.getContext('2d'));
      const k = w / 1280;
      const out = { width: w };
      for (const [name, r] of Object.entries(regions)) {
        const rr = { x0: r.x0 * k, x1: r.x1 * k, y0: r.y0 * k, y1: r.y1 * k };
        out[name] = window.pf.detail(v, w, h, rr) / window.pf.detail(ref, w, h, rr);
      }
      return out;
    },
    [selector, BOARD],
  );

await step('screen sharing: the preview of a shared screen hides its face, QR code and phone number', async () => {
  const sam = await as('u-att-chloe');
  await sam.context.addInitScript(SCREEN_SOURCE, [CREW_SRC, QR_OK]);
  await openDock(sam);
  await sam.page.getByRole('button', { name: 'Preview a shared screen' }).click();
  await sam.page.getByText('Protecting').waitFor({ timeout: 90000 });
  await sam.page.waitForTimeout(10000);
  const m = {};
  for (const k of ['Output', 'Delay', 'Face checks', 'Code and number checks', 'Screen zoom checks', 'Faces seen', 'Fully blurred frames', 'Dropped']) m[k] = await stat(sam.page, k);
  console.log(`      screen preview measured: ${JSON.stringify(m)}`);
  metrics.screen = m;
  const ratios = await boardDetail(sam.page, '.pf-stage video');
  console.log(`      shared screen detail kept (after/before): ${JSON.stringify(ratios)}`);
  metrics.screenRatios = ratios;
  for (const k of ['face', 'qr', 'phone']) assert.ok(ratios[k] < 0.5, `${k} on the shared screen is hidden`);
  await sam.page.getByRole('button', { name: 'Stop preview' }).click();
  await sam.context.close();
});

await step('screen sharing in a call: the other person receives the protected screen, not the original', async () => {
  const host = await as('u-att-ada');
  const guest = await as('u-att-ben');
  await host.context.addInitScript(SCREEN_SOURCE, [CREW_SRC, QR_OK]);
  await guest.context.addInitScript(SCREEN_SOURCE, [CREW_SRC, QR_OK]);
  await api(host, '/privacy-filter', 'PUT', { enabled: true });
  const r = await host.context.request.post(`${BASE}/api/events/${EVENT}/calls`, { data: { title: 'Screen share check' }, headers: { origin: BASE } });
  const callId = (await r.json()).data.id;
  for (const p of [host, guest]) {
    await p.page.goto(`${BASE}/events/${EVENT}/calls/${callId}`);
    await p.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Join call') && !b.disabled));
    await p.page.getByRole('button', { name: 'Join call' }).click();
  }
  await guest.page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => /’s video$/.test(v.getAttribute('aria-label') ?? '') && v.videoWidth > 0), null, { timeout: 60000 });
  await host.page.getByRole('button', { name: 'Share screen' }).click();
  await host.page.getByRole('button', { name: 'Stop sharing' }).waitFor({ timeout: 90000 });
  // the share starts black (lookahead filling), then models load; give it time to be protected and steady
  await guest.page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => /’s video$/.test(v.getAttribute('aria-label') ?? '') && v.videoWidth >= 1000), null, { timeout: 60000 });
  await guest.page.waitForTimeout(15000);
  const got = await boardDetail(guest.page, 'video[aria-label$="’s video"]');
  console.log(`      received by the other person (after/before): ${JSON.stringify(got)}`);
  metrics.callShare = got;
  assert.ok(got.width >= 1000, 'the shared screen arrived');
  for (const k of ['face', 'qr', 'phone']) assert.ok(got[k] < 0.5, `${k} is hidden in what the other person receives`);
  await host.context.close();
  await guest.context.close();
});


await step('fails closed: the people model unavailable, or a corrupt screen model, hides everything and says why', async () => {
  const p = await as('u-att-ada');
  await p.context.route('**/yolov8n-pose.onnx', (route) => route.abort());
  await p.context.route('**/yolo11n.onnx', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('not a model') }));
  await openDock(p);
  await p.page.getByRole('button', { name: 'Start preview' }).click();
  await p.page.getByText('Blurring everything').waitFor({ timeout: 60000 });
  await p.page.getByText(/People detector \(YOLOv8n-pose\) could not load/).waitFor();
  await p.page.getByText(/Screen detector \(YOLO11n\) could not load/).waitFor();
  const samples = await sampleLive(p.page, 5, { a: FACE_A, b: FACE_B });
  assert.ok(Math.max(...samples.map((s) => Math.max(s.a, s.b))) < 0.5);
  await p.context.close();
});

await step('fails closed: a model download that never finishes is reported after 30 s and the picture stays hidden', async () => {
  const p = await as('u-att-ada');
  await p.context.route('**/eng.traineddata.gz', () => undefined); // never answered
  await openDock(p);
  await p.page.getByRole('button', { name: 'Start preview' }).click();
  await p.page.getByText(/did not load within 30 seconds/).first().waitFor({ timeout: 60000 });
  await p.page.getByText('Blurring everything').waitFor();
  const samples = await sampleLive(p.page, 4, { a: FACE_A });
  assert.ok(Math.max(...samples.map((s) => s.a)) < 0.5);
  await p.context.close();
});

await step('permissions denied: camera and screen refusals are explained and nothing is captured', async () => {
  const strict = await chromium.launch({ ...exe, args: ['--use-fake-device-for-media-stream'] });
  const p = await as('u-att-ada', strict, []);
  // Headless Chromium never answers the screen picker; this is what the browser returns when the person cancels it.
  await p.context.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await openDock(p);
  await p.page.getByRole('button', { name: 'Start preview' }).click();
  await p.page.getByText(/Permission to use your camera was not given/).waitFor({ timeout: 20000 });
  await p.page.getByRole('button', { name: 'Preview a shared screen' }).click();
  await p.page.getByText(/Permission to use your screen was not given|Could not start the preview/).first().waitFor({ timeout: 20000 });
  assert.equal(await p.page.getByRole('button', { name: 'Stop preview' }).count(), 0);
  await strict.close();
});

await step('unsupported media, network loss and a refresh mid-way: nothing unchecked is ever uploaded', async () => {
  await openDock(ada);
  await mediaInput(ada.page).setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('this is not a video at all') });
  await ada.page.getByRole('button', { name: 'Protect video' }).click();
  await ada.page.getByText(/cannot play that video file/).waitFor({ timeout: 30000 });
  let attempts = 0;
  await ada.context.route('**/media', (route) => {
    attempts += 1;
    return route.abort('internetdisconnected');
  });
  await ada.page.goto(`${BASE}/events/${EVENT}/feed`);
  await ada.page.getByRole('button', { name: /Share something with the event/ }).click();
  await ada.page.locator('.pcomposer input[type=file]').setInputFiles({ name: 'board.png', mimeType: 'image/png', buffer: Buffer.from(sheet, 'base64') });
  await ada.page.getByRole('button', { name: 'Post', exact: true }).click();
  await ada.page.getByText(/did not finish|Failed to fetch|Could not post/).first().waitFor({ timeout: 180000 });
  assert.equal(attempts, 1, 'one attempt, cut by the network');
  await ada.context.unroute('**/media');
  let sent = false;
  ada.page.on('request', (r) => {
    if (r.url().endsWith('/media') && r.method() === 'POST') sent = true;
  });
  await openDock(ada);
  await mediaInput(ada.page).setInputFiles({ name: 'walk.webm', mimeType: 'video/webm', buffer: Buffer.from(clip, 'base64') });
  await ada.page.getByRole('button', { name: 'Protect video' }).click();
  await ada.page.locator('.pf-progress').waitFor({ timeout: 60000 });
  await ada.page.reload();
  await settled(ada.page);
  assert.equal(await ada.page.locator('.pf-progress').count(), 0);
  assert.equal(sent, false);
  assert.equal((await (await api(ada, '/privacy-filter')).json()).data.settings.enabled, true, 'settings survive the refresh');
});

writeFileSync(join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2));
console.log(`\nmetrics: ${join(dir, 'metrics.json')}`);
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${String(passed)}/${String(results.length)} privacy parity checks passed`);
process.exit(passed === results.length ? 0 : 1);
