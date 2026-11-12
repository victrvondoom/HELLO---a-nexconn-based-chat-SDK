/* global process, console, fetch, URL */
/**
 * Captures the README screenshots from a running demo server, so they can be regenerated after UI changes.
 *
 *   HELLO_DEMO_MODE=true npm run build && HELLO_DEMO_MODE=true npm start   # terminal 1
 *   BASE_URL=http://localhost:3000 npm run screenshots                      # terminal 2
 *
 * The demo is reset first, so every image shows the seeded demo event. Images are written to docs/screenshots/.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const OUT = new URL('../../docs/screenshots/', import.meta.url);
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {};

await mkdir(OUT, { recursive: true });
const reset = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
if (!reset.ok) throw new Error(`demo reset failed (${reset.status}); start the server with HELLO_DEMO_MODE=true`);

const browser = await chromium.launch(launchOptions);
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };

async function as(displayName, options = desktop) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  if (displayName) {
    await page.goto(`${BASE}/demo`);
    await page.getByRole('button', { name: `Continue as ${displayName}` }).click();
    await page.waitForURL(`**/events/${EVENT}/conversation`);
  }
  return { context, page };
}

async function shot(page, name, { fullPage = false } = {}) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600); // let the halo canvas and transitions settle
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname, fullPage });
  console.log(`saved docs/screenshots/${name}.png`);
}

try {
  // Landing page and demo sign-in, signed out.
  const visitor = await as(null);
  await visitor.page.goto(BASE);
  await visitor.page.getByRole('heading', { name: /One conversation/ }).waitFor();
  await visitor.page.waitForTimeout(1200);
  await shot(visitor.page, 'landing');
  await visitor.page.goto(`${BASE}/demo`);
  await shot(visitor.page, 'demo-sign-in');
  await visitor.context.close();

  // The judge scenario: an attendee reports two problems in one sentence.
  const ada = await as('Ada (demo attendee)');
  await ada.page.getByLabel('Message to HELLO').fill('The microphone is not working, and there are too many people in Room 3.');
  await ada.page.getByRole('button', { name: 'Send message' }).click();
  await ada.page.getByRole('link', { name: 'View incident' }).first().waitFor();
  await shot(ada.page, 'conversation');
  await ada.page.goto(`${BASE}/events/${EVENT}/map?to=r-3`);
  await shot(ada.page, 'venue-map');
  await ada.context.close();

  // Staff view of the incident, with explained assignment ranking.
  const kiri = await as('Kiri (demo AV technician)');
  await kiri.page.goto(`${BASE}/events/${EVENT}/incidents/inc-seed-av-r3`);
  await kiri.page.getByRole('heading', { name: 'Recommended for this work' }).waitFor();
  await shot(kiri.page, 'incident');
  await kiri.context.close();

  // Organiser operations view with the approval queue.
  const nadia = await as('Nadia (demo organiser)');
  await nadia.page.goto(`${BASE}/events/${EVENT}/operations`);
  await nadia.page.getByRole('button', { name: 'Approve and execute' }).first().waitFor();
  await shot(nadia.page, 'operations');
  await nadia.context.close();

  // Phone width conversation.
  const phone = await as('Ada (demo attendee)', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await shot(phone.page, 'conversation-mobile');
  await phone.context.close();
} finally {
  await browser.close();
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' }).catch(() => undefined);
}
