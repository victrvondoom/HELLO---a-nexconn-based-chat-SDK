/* global process, console, URL */
/**
 * Captures the README screenshots from a running demo server, so they can be regenerated after UI changes.
 *
 *   HELLO_DEMO_MODE=true npm run build && HELLO_DEMO_MODE=true npm start   # terminal 1
 *   BASE_URL=http://localhost:3000 npm run screenshots                      # terminal 2
 *
 * The demo is reset first, so every image shows the seeded demo event. Images are written to docs/screenshots/
 * as JPEG (quality 82) to keep the repository small.
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const OUT = new URL('../../docs/screenshots/', import.meta.url);
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {};

await mkdir(OUT, { recursive: true });
const reset = await resetDemo(BASE);
if (!reset.ok) throw new Error(`demo reset failed (${reset.status}); start the server with HELLO_DEMO_MODE=true`);

const browser = await chromium.launch(launchOptions);
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const page = (path) => `${BASE}/events/${EVENT}${path}`;

async function as(displayName, options = desktop) {
  const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
  const p = await context.newPage();
  if (displayName) {
    await p.goto(`${BASE}/demo`);
    await p.getByRole('button', { name: `Continue as ${displayName}` }).click();
    await p.waitForURL(`**/events/${EVENT}/conversation`);
  }
  return { context, page: p };
}

async function shot(p, name) {
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(500);
  await p.screenshot({ path: fileURLToPath(new URL(`${name}.jpg`, OUT)), type: 'jpeg', quality: 82 });
  console.log(`saved docs/screenshots/${name}.jpg`);
}

try {
  // Signed out: the landing page and the demo role picker. Motion is allowed here so the scene is lit.
  const visitorContext = await browser.newContext(desktop);
  const visitor = await visitorContext.newPage();
  await visitor.goto(BASE);
  await visitor.getByRole('heading', { name: /One conversation/ }).waitFor();
  await visitor.waitForTimeout(1200);
  await shot(visitor, 'landing');
  await visitor.goto(`${BASE}/demo`);
  await shot(visitor, 'demo-sign-in');
  await visitorContext.close();

  // Ada, an attendee: home, Moments, a story, reels, explore, the charter, a profile with a highlight.
  const ada = await as('Ada (demo attendee)');
  await ada.page.goto(page(''));
  await shot(ada.page, 'home');
  await ada.page.goto(page('/feed'));
  await shot(ada.page, 'moments');
  await ada.page.getByRole('button', { name: /^Stories by Dr Ines/ }).click();
  await ada.page.getByRole('dialog', { name: /Story by Dr Ines/ }).waitFor();
  await ada.page.getByRole('button', { name: 'Pause' }).click();
  await shot(ada.page, 'story');
  await ada.page.keyboard.press('Escape');
  await ada.page.goto(page('/feed/reels'));
  await shot(ada.page, 'reels');
  await ada.page.goto(page('/feed/explore'));
  await shot(ada.page, 'explore');
  await ada.page.goto(page('/feed/charter'));
  await shot(ada.page, 'charter');
  await ada.page.goto(page('/people/u-spk-ines'));
  await ada.page.getByRole('button', { name: /^Highlight:/ }).first().scrollIntoViewIfNeeded();
  await shot(ada.page, 'profile');

  // The judge scenario: an attendee reports two problems in one sentence.
  await ada.page.goto(page('/conversation'));
  await ada.page.getByLabel('Message to HELLO').fill('The microphone is not working, and there are too many people in Room 3.');
  await ada.page.getByRole('button', { name: 'Send message' }).click();
  await ada.page.getByRole('link', { name: 'View incident' }).first().waitFor();
  await shot(ada.page, 'conversation');
  await ada.page.goto(page('/map?to=r-3'));
  await shot(ada.page, 'venue-map');
  await ada.page.goto(page('/atlas'));
  await shot(ada.page, 'field-atlas');
  await ada.page.keyboard.press('Control+k');
  await ada.page.getByLabel('Search the event').fill('reels');
  await shot(ada.page, 'command-palette');
  await ada.context.close();

  // Staff view of the incident, with explained assignment ranking.
  const kiri = await as('Kiri (demo AV technician)');
  await kiri.page.goto(page('/incidents/inc-seed-av-r3'));
  await kiri.page.getByRole('heading', { name: 'Recommended for this work' }).waitFor();
  await shot(kiri.page, 'incident');
  await kiri.context.close();

  // Organiser operations view with the approval queue.
  const nadia = await as('Nadia (demo organiser)');
  await nadia.page.goto(page('/operations'));
  await nadia.page.getByRole('button', { name: 'Approve and execute' }).first().waitFor();
  await shot(nadia.page, 'operations');
  await nadia.context.close();

  // Phone width: Moments with the tab bar, and the conversation.
  const mobile = await as('Ada (demo attendee)', phone);
  await mobile.page.goto(page('/feed'));
  await shot(mobile.page, 'moments-mobile');
  await mobile.page.goto(page('/conversation'));
  await shot(mobile.page, 'conversation-mobile');
  await mobile.context.close();
} finally {
  await browser.close();
  await resetDemo(BASE).catch(() => undefined);
}
