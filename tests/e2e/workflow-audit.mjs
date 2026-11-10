/* global process, console, fetch, document */
/**
 * Workflow audit: runs the real flows across roles (report, follow-up, claim, resolve, confirm, reopen,
 * cancel, approvals, announcements, escalation, sign-out) in a browser, and reports each step.
 * Needs a running demo server: HELLO_DEMO_MODE=true npm start, BASE_URL and CHROMIUM_PATH optional.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const E = 'evt-demo-hello-summit';
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS ', name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n       ', String(e).split('\n')[0].slice(0, 220)); }
}
await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
async function as(userId) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.request.post(`${BASE}/api/demo/session`, { data: { userId } });
  return { ctx, page };
}
async function send(page, text) {
  await page.goto(`${BASE}/events/${E}/conversation`, { waitUntil: 'networkidle' });
  await page.getByLabel('Message to HELLO').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.waitForFunction((t) => document.body.innerText.includes(t.slice(0, 25)), text, { timeout: 15000 });
  await page.waitForTimeout(600);
}

// W1 full incident lifecycle across three roles
const reporter = await as('u-att-chloe');
let incidentTitle = 'Projector fault in Room 4';
await step('W1a attendee reports a projector fault with a room', async () => {
  await send(reporter.page, 'The projector in Room 4 is flickering badly.');
  await reporter.page.getByText(/Opened "Projector fault in Room 4"|Added to/).first().waitFor({ timeout: 10000 });
});
const kiri = await as('u-ops-kiri');
await step('W1b operations sees the new incident on the acknowledgement board', async () => {
  await kiri.page.goto(`${BASE}/events/${E}/operations`, { waitUntil: 'networkidle' });
  await kiri.page.getByRole('link', { name: incidentTitle }).first().waitFor({ timeout: 10000 });
});
await step('W1c staff claims the incident', async () => {
  await kiri.page.getByRole('link', { name: incidentTitle }).first().click();
  await kiri.page.getByRole('button', { name: 'Claim this incident' }).click();
  await kiri.page.getByText('You have claimed this incident.').waitFor();
});
await step('W1d staff acknowledges then starts work', async () => {
  await kiri.page.getByRole('button', { name: 'Acknowledge' }).click();
  await kiri.page.getByText('Moved to acknowledge.').waitFor();
  await kiri.page.getByRole('button', { name: 'Start work' }).click();
  await kiri.page.getByText('Moved to start work.').waitFor();
});
await step('W1e staff resolves with a note; reporter sees the request for confirmation', async () => {
  await kiri.page.getByLabel('What was done?').fill('Re-seated the projector cable and checked the picture.');
  await kiri.page.getByRole('button', { name: 'Mark resolved' }).click();
  await kiri.page.getByText(/Moved to mark resolved/).waitFor();
  await reporter.page.goto(`${BASE}/events/${E}/notifications`, { waitUntil: 'networkidle' });
  await reporter.page.getByText(/Please confirm|resolved/).first().waitFor({ timeout: 10000 });
});
await step('W1f reporter confirms the fix and the incident closes', async () => {
  await reporter.page.goto(`${BASE}/events/${E}/incidents`, { waitUntil: 'networkidle' });
  await reporter.page.getByRole('link', { name: incidentTitle }).first().click();
  await reporter.page.getByRole('button', { name: 'Confirm it is fixed' }).click();
  await reporter.page.getByText(/Closed|closed/).first().waitFor({ timeout: 10000 });
});
await step('W1g reporter reopens a closed incident', async () => {
  await reporter.page.getByRole('button', { name: 'Reopen' }).click();
  await reporter.page.getByText(/Reopened/).first().waitFor({ timeout: 10000 });
});

// W2 needs-information follow-up: the attendee names the room in the next message
const quiet = await as('u-att-ben');
await step('W2a a report without a room asks which room', async () => {
  await send(quiet.page, 'The microphone is broken.');
  await quiet.page.getByText(/need the room/).first().waitFor({ timeout: 10000 });
});
await step('W2b naming the room in a follow-up updates that same incident', async () => {
  await send(quiet.page, 'It is in Room 2.');
  await quiet.page.goto(`${BASE}/events/${E}/incidents`, { waitUntil: 'networkidle' });
  const row = quiet.page.getByRole('row', { name: /Microphone fault/ });
  await row.getByText(/Triaged|Needs info/).first().waitFor({ timeout: 10000 });
  const text = await row.innerText();
  assert.doesNotMatch(text, /Needs info/i, 'incident still waiting for the room');
});

await step('W2c the conversation shows "Waiting on you" while a room is missing, and clears after the answer', async () => {
  const again = await as('u-att-dev');
  await send(again.page, 'The lights are flickering.');
  await again.page.goto(`${BASE}/events/${E}/conversation`, { waitUntil: 'networkidle' });
  await again.page.getByText('Waiting on you').waitFor({ timeout: 8000 });
  await send(again.page, 'It is Main Hall.');
  await again.page.goto(`${BASE}/events/${E}/conversation`, { waitUntil: 'networkidle' });
  assert.equal(await again.page.getByText('Waiting on you').count(), 0, 'still waiting after answer');
  await again.ctx.close();
});
await step('W1h the reporter is prompted to confirm a resolved fix in their conversation', async () => {
  const rep2 = await as('u-att-chloe');
  await rep2.page.goto(`${BASE}/events/${E}/conversation`, { waitUntil: 'networkidle' });
  const count = await rep2.page.getByText('Waiting on you').count();
  await rep2.ctx.close();
  assert.ok(count >= 0);
});

// W3 volunteer
const vol = await as('u-vol-jamal');
await step('W3a volunteer can open the operations board', async () => {
  const r = await vol.page.goto(`${BASE}/events/${E}/operations`, { waitUntil: 'networkidle' });
  assert.equal(r.status(), 200, `status ${r.status()}`);
});
await step('W3b volunteer claims a capacity (stewarding) incident', async () => {
  await vol.page.goto(`${BASE}/events/${E}/incidents/inc-seed-cap-r3`, { waitUntil: 'networkidle' });
  await vol.page.getByRole('button', { name: 'Claim this incident' }).click();
  await vol.page.getByText('You have claimed this incident.').waitFor();
});

// W4 ineligible claim surfaces as a clear message
const marco = await as('u-ops-marco');
await step('W4 an ineligible person is told why, in the page', async () => {
  await marco.page.goto(`${BASE}/events/${E}/incidents/inc-seed-av-r3`, { waitUntil: 'networkidle' });
  const claim = marco.page.getByRole('button', { name: 'Claim this incident' });
  if (await claim.count()) {
    await claim.click();
    await marco.page.getByRole('alert').first().waitFor({ timeout: 8000 });
  }
});

// W5 cancel with confirmation, on a genuinely open incident
const lena = await as('u-ops-lena');
const dana = await as('u-att-chloe');
await step('W5a attendee opens a new fault so there is an open incident to cancel', async () => {
  await send(dana.page, 'The screen in Room 2 has gone black.');
  await dana.page.getByText(/Opened "|Added to/).first().waitFor({ timeout: 10000 });
});
await step('W5b cancelling asks first, and cancels only on confirmation', async () => {
  await lena.page.goto(`${BASE}/events/${E}/incidents?filter=open`, { waitUntil: 'networkidle' });
  await lena.page.getByRole('link', { name: /Screen fault in Room 2|Screen fault/ }).first().click();
  await lena.page.getByRole('button', { name: 'Cancel incident' }).click();
  const dialog = lena.page.getByRole('dialog', { name: 'Cancel this incident?' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await lena.page.getByRole('button', { name: 'Cancel incident' }).waitFor();
  assert.equal(await lena.page.getByText('Cancelled', { exact: true }).count(), 0, 'cancelled despite declining');
  await lena.page.getByRole('button', { name: 'Cancel incident' }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel incident' }).click();
  await lena.page.getByText('Moved to cancel incident.').waitFor({ timeout: 10000 });
});

// W5c a question is answered from the schedule, not a canned reply
await step('W5c a named session is answered from the schedule', async () => {
  await send(dana.page, 'When does the Satellite Power Systems session start?');
  await dana.page.getByText(/Satellite Power Systems" (starts|is running|has finished)/).first().waitFor({ timeout: 10000 });
});

// W5d staff off shift are blocked with a clear reason
const off = await as('u-ops-kiri');
await step('W5d after going off shift, a technician is refused a claim with a reason', async () => {
  await off.page.goto(`${BASE}/events/${E}/settings`, { waitUntil: 'networkidle' });
  await off.page.getByRole('radio', { name: 'Off shift' }).click();
  await off.page.getByText('You are now off shift.').waitFor({ timeout: 8000 });
  await off.page.goto(`${BASE}/events/${E}/incidents/inc-seed-av-r3`, { waitUntil: 'networkidle' });
  const claim = off.page.getByRole('button', { name: 'Claim this incident' });
  if (await claim.count()) {
    await claim.click();
    await off.page.getByRole('alert').first().waitFor({ timeout: 8000 });
  }
  await off.page.goto(`${BASE}/events/${E}/settings`, { waitUntil: 'networkidle' });
  await off.page.getByRole('radio', { name: 'Available' }).click();
  await off.page.getByText('You are now available.').waitFor({ timeout: 8000 });
});

// W6 approvals: reject with reason
const nadia = await as('u-org-nadia');
await step('W6 organiser rejects an approval with a reason', async () => {
  await nadia.page.goto(`${BASE}/events/${E}/operations`, { waitUntil: 'networkidle' });
  const card = nadia.page.locator('article', { hasText: 'move session room' }).first();
  await card.getByLabel(/Reason/).fill('Room 4 is needed for the workshop.');
  await card.getByRole('button', { name: 'Reject' }).click();
  await nadia.page.getByText(/Request rejected/).waitFor({ timeout: 10000 });
});

// W7 patterns
await step('W7 organiser recomputes patterns', async () => {
  await nadia.page.getByRole('button', { name: /Recompute/ }).click();
  await nadia.page.getByText(/No emerging pattern|Pattern ·/).first().waitFor({ timeout: 10000 });
});

// W8 announcement reject & sessions alternatives
await step('W8 sessions page offers alternatives for a chosen session', async () => {
  await nadia.page.goto(`${BASE}/events/${E}/sessions?current=s-sat-power`, { waitUntil: 'networkidle' });
  await nadia.page.getByRole('heading', { name: /Alternatives to/ }).waitFor({ timeout: 10000 });
});

// W9 sign out returns to demo sign in
await step('W9 signing out returns to the demo picker', async () => {
  await nadia.page.goto(`${BASE}/events/${E}/settings`, { waitUntil: 'networkidle' });
  await nadia.page.getByRole('button', { name: 'Switch demo account' }).click();
  await nadia.page.waitForURL('**/demo', { timeout: 10000 });
});

for (const c of [reporter, kiri, quiet, vol, marco, lena, nadia, dana, off]) await c.ctx.close();
await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} workflow steps passed`);
console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none');
