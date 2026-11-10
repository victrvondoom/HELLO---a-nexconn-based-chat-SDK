/* global process, console, fetch, document */
/**
 * End-to-end check of the judge demonstration, in a real browser.
 *
 * Requires a running HELLO server with demo sign-in enabled:
 *   HELLO_DEMO_MODE=true npm run build && HELLO_DEMO_MODE=true npm start
 *   BASE_URL=http://localhost:3000 npm run test:e2e
 *
 * CHROMIUM_PATH optionally points at a Chromium binary. Without it, Playwright's bundled browser is used.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
  : {};

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error) });
    console.log(`FAIL  ${name}\n      ${String(error).split('\n')[0]}`);
  }
}

// Start from the seeded state so the run is repeatable.
const reset = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
assert.equal(reset.status, 200, 'demo reset must be enabled for the browser suite (HELLO_DEMO_MODE=true)');

const browser = await chromium.launch(launchOptions);
const newPage = async (viewport = { width: 1280, height: 820 }) => {
  const context = await browser.newContext({ viewport });
  return { context, page: await context.newPage() };
};

async function signInAs(page, displayName) {
  await page.goto(`${BASE}/demo`);
  await page.getByRole('button', { name: `Continue as ${displayName}` }).click();
  await page.waitForURL(`**/events/${EVENT}/conversation`);
}

try {
  // 1. The landing page presents the product and links to the demo.
  await step('landing page explains HELLO and links to the demo', async () => {
    const { context, page } = await newPage();
    await page.goto(BASE);
    await assert.doesNotReject(page.getByRole('heading', { name: /One conversation/ }).waitFor());
    await assert.doesNotReject(page.getByRole('link', { name: 'Enter the demo' }).first().waitFor());
    await context.close();
  });

  // 2. An attendee reports the combined problem and sees HELLO's structured answer.
  const attendee = await newPage();
  await step('attendee signs in and lands on the conversation', async () => {
    await signInAs(attendee.page, 'Ada (demo attendee)');
    await attendee.page.getByText('Tell HELLO what is happening.').waitFor();
  });

  await step('attendee sends a two-concern report and HELLO replies in the thread', async () => {
    const box = attendee.page.getByLabel('Message to HELLO');
    await box.fill('The microphone is not working, and there are too many people in Room 3.');
    await attendee.page.getByRole('button', { name: 'Send message' }).click();
    await attendee.page.getByText(/Added to 2 open reports|Added to the open report/).first().waitFor();
    const thread = await attendee.page.getByRole('log', { name: 'Messages' }).innerText();
    assert.match(thread, /Added to (2 open reports|the open report)/);
    assert.match(thread, /sessions with free seats are listed below/);
  });

  await step('the reply is an action card with a link to the existing incident', async () => {
    await attendee.page.getByRole('link', { name: 'View incident' }).first().waitFor();
    const count = await attendee.page.getByRole('link', { name: 'View incident' }).count();
    assert.ok(count >= 2, `expected two incident cards, saw ${count}`);
  });

  await step('the conversation survives a reload (answer is stored, not client state)', async () => {
    await attendee.page.reload();
    await attendee.page.getByText(/Added to (2 open reports|the open report)/).first().waitFor();
  });

  await step('the approval is shown as pending, not as done', async () => {
    await attendee.page.getByText('Waiting for an organiser').first().waitFor();
    const text = await attendee.page.locator('body').innerText();
    assert.doesNotMatch(text, /has been moved to Room 4/);
  });

  // 3. Staff claim the work; the attendee's view reflects the change.
  const staff = await newPage();
  await step('AV technician opens the incident and sees ranked staff', async () => {
    await signInAs(staff.page, 'Kiri (demo AV technician)');
    await staff.page.goto(`${BASE}/events/${EVENT}/incidents/inc-seed-av-r3`);
    await staff.page.getByRole('heading', { name: 'Recommended staff' }).waitFor();
    await staff.page.getByText('Kiri (demo AV technician)').first().waitFor();
  });

  await step('AV technician claims the incident and the status becomes Assigned', async () => {
    await staff.page.getByRole('button', { name: 'Claim this incident' }).click();
    await staff.page.getByText('Assigned', { exact: false }).first().waitFor();
    assert.equal(await staff.page.getByRole('button', { name: 'Claim this incident' }).count(), 0);
  });

  await step('a second person cannot claim the same incident', async () => {
    const lena = await newPage();
    await signInAs(lena.page, 'Lena (demo operations)');
    await lena.page.goto(`${BASE}/events/${EVENT}/incidents/inc-seed-av-r3`);
    await lena.page.getByText('Assigned', { exact: false }).first().waitFor();
    assert.equal(await lena.page.getByRole('button', { name: 'Claim this incident' }).count(), 0);
    await lena.context.close();
  });

  // 4. The organiser decides the approval; the result is recorded.
  const organiser = await newPage();
  await step('organiser approves the room move and sees the executed result', async () => {
    await signInAs(organiser.page, 'Nadia (demo organiser)');
    await organiser.page.goto(`${BASE}/events/${EVENT}/operations`);
    await organiser.page.getByRole('button', { name: 'Approve and execute' }).first().click();
    // Approval asks for confirmation in the app's own dialog, then executes.
    const dialog = organiser.page.getByRole('dialog', { name: 'Approve and execute this change?' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Approve and execute' }).click();
    await organiser.page.getByText(/moved to Room 4/).first().waitFor();
  });

  // 5. The attendee's request status reflects the work.
  await step('attendee sees the team has taken the request', async () => {
    await attendee.page.goto(`${BASE}/events/${EVENT}/conversation`);
    await attendee.page.getByText('Your requests').waitFor();
    const text = await attendee.page.locator('body').innerText();
    assert.match(text, /Assigned/);
  });

  // 6. Layout holds at phone width: no horizontal scroll.
  await step('conversation has no horizontal overflow at phone width', async () => {
    const phone = await newPage({ width: 390, height: 844 });
    await signInAs(phone.page, 'Ada (demo attendee)');
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `page overflows by ${overflow}px`);
    await phone.context.close();
  });

  // 7. Access control is enforced in the browser too.
  await step('an attendee cannot open the operations view', async () => {
    const { context, page } = await newPage();
    await signInAs(page, 'Ada (demo attendee)');
    const response = await page.goto(`${BASE}/events/${EVENT}/operations`);
    assert.equal(response.status(), 404);
    await context.close();
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
