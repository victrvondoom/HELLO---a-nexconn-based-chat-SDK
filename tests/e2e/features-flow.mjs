/* global process, console, fetch */
/**
 * Browser checks for the workplace features: live timers, escalation, consent, availability,
 * announcements through a second organiser, notification read state, team and audit access.
 *
 * Same requirements as judge-flow.mjs: a running demo server (HELLO_DEMO_MODE=true).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {};

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${String(error).split('\n')[0]}`);
  }
}

await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
const browser = await chromium.launch(launchOptions);
const open = async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  return { context, page: await context.newPage() };
};
async function signInAs(page, displayName) {
  await page.goto(`${BASE}/demo`);
  await page.getByRole('button', { name: `Continue as ${displayName}` }).click();
  await page.waitForURL(`**/events/${EVENT}/conversation`);
}

try {
  const ops = await open();
  await step('operations shows the acknowledgement board and a live indicator', async () => {
    await signInAs(ops.page, 'Kiri (demo AV technician)');
    await ops.page.goto(`${BASE}/events/${EVENT}/operations`);
    await ops.page.getByRole('heading', { name: 'Acknowledgement board' }).waitFor();
    await ops.page.getByText('Live', { exact: false }).first().waitFor();
  });

  await step('the escalation check reports its result as a notification', async () => {
    await ops.page.getByRole('button', { name: 'Run escalation check' }).click();
    await ops.page.getByText(/Escalated \d+ overdue incident|Sweep complete/).first().waitFor();
  });

  await step('team directory lists availability and load for staff', async () => {
    await ops.page.goto(`${BASE}/events/${EVENT}/team`);
    await ops.page.getByRole('heading', { name: 'Team' }).waitFor();
    await ops.page.getByText('Kiri (demo AV technician)').first().waitFor();
    await ops.page.getByText('Available', { exact: true }).first().waitFor();
  });

  await step('staff can set their availability and see it reflected in the team view', async () => {
    await ops.page.goto(`${BASE}/events/${EVENT}/settings`);
    await ops.page.getByRole('radio', { name: 'Busy' }).click();
    await ops.page.getByText('You are now busy.').waitFor();
    await ops.page.goto(`${BASE}/events/${EVENT}/team`);
    const row = ops.page.getByRole('row', { name: /Kiri/ });
    await row.getByText('Busy', { exact: true }).waitFor();
    // Restore for later checks.
    await ops.page.goto(`${BASE}/events/${EVENT}/settings`);
    await ops.page.getByRole('radio', { name: 'Available' }).click();
    await ops.page.getByText('You are now available.').waitFor();
  });

  await step('an organiser can open the audit trail, and staff cannot', async () => {
    const check = await open();
    await signInAs(check.page, 'Nadia (demo organiser)');
    await check.page.goto(`${BASE}/events/${EVENT}/audit`);
    await check.page.getByRole('heading', { name: 'Audit trail' }).waitFor();
    const denied = await ops.page.goto(`${BASE}/events/${EVENT}/audit`);
    assert.equal(denied.status(), 404);
    await check.context.close();
  });

  const attendee = await open();
  await step('an attendee turns off people-search visibility and is removed from search', async () => {
    await signInAs(attendee.page, 'Ben (demo attendee)');
    await attendee.page.goto(`${BASE}/events/${EVENT}/settings`);
    const toggle = attendee.page.getByRole('checkbox', { name: /Appear in people search/ });
    await toggle.uncheck();
    await attendee.page.getByRole('button', { name: 'Save profile' }).click();
    await attendee.page.getByText(/hidden from people search/).waitFor();
    await attendee.page.goto(`${BASE}/events/${EVENT}/people?q=cybersecurity`);
    await attendee.page.getByText('No discoverable person').waitFor();
    // Restore visibility.
    await attendee.page.goto(`${BASE}/events/${EVENT}/settings`);
    await attendee.page.getByRole('checkbox', { name: /Appear in people search/ }).check();
    await attendee.page.getByRole('button', { name: 'Save profile' }).click();
    await attendee.page.getByText(/appear in people search/).first().waitFor();
  });

  await step('an announcement is proposed by an organiser and published only after another organiser approves', async () => {
    const nadia = await open();
    await signInAs(nadia.page, 'Nadia (demo organiser)');
    await nadia.page.goto(`${BASE}/events/${EVENT}/announcements`);
    await nadia.page.getByLabel('Title').fill('Lunch moves to 13:30');
    await nadia.page.getByLabel('Message').fill('Lunch is served at 13:30 in the Main Hall foyer today.');
    await nadia.page.getByRole('button', { name: 'Request publication' }).click();
    await nadia.page.getByText(/Sent to organisers for approval/).waitFor();
    await nadia.page.getByText('Lunch moves to 13:30').first().waitFor();
    const beforeApproval = await attendee.page.goto(`${BASE}/events/${EVENT}/announcements`);
    assert.equal(beforeApproval.status(), 200);
    assert.equal(await attendee.page.getByText('Lunch moves to 13:30').count(), 0);

    const owen = await open();
    await signInAs(owen.page, 'Owen (demo organiser)');
    await owen.page.goto(`${BASE}/events/${EVENT}/operations`);
    const card = owen.page.locator('article', { hasText: 'announcement' }).first();
    await card.getByRole('button', { name: 'Approve and execute' }).click();
    await owen.page.getByRole('dialog').getByRole('button', { name: 'Approve and execute' }).click();
    await owen.page.getByText(/Announcement .* published/).first().waitFor();
    await attendee.page.goto(`${BASE}/events/${EVENT}/announcements`);
    await attendee.page.getByText('Lunch moves to 13:30').first().waitFor();
    await nadia.context.close();
    await owen.context.close();
  });

  const ada = await open();
  await step('notifications show unread items, and marking them read clears the navigation count', async () => {
    await signInAs(ada.page, 'Ada (demo attendee)');
    await ada.page.goto(`${BASE}/events/${EVENT}/notifications`);
    await ada.page.getByRole('button', { name: /Mark \d+ as read/ }).click();
    await ada.page.getByText('You are up to date.').waitFor();
    assert.equal(await ada.page.locator('.nav-count').count(), 0);
  });

  await step('the conversation search narrows the thread to matching messages', async () => {
    const chat = await open();
    await signInAs(chat.page, 'Ben (demo attendee)');
    await chat.page.getByLabel('Message to HELLO').fill('The projector is flickering in Room 2.');
    await chat.page.getByRole('button', { name: 'Send message' }).click();
    await chat.page.getByText(/projector is flickering/).first().waitFor();
    await chat.page.getByLabel('Message to HELLO').fill('Is there a quiet room for lunch?');
    await chat.page.getByRole('button', { name: 'Send message' }).click();
    await chat.page.getByText(/quiet room/).first().waitFor();
    await chat.page.goto(`${BASE}/events/${EVENT}/conversation?q=projector`);
    const log = await chat.page.getByRole('log', { name: 'Messages' }).innerText();
    assert.match(log, /projector/i);
    assert.doesNotMatch(log, /quiet room/i);
    await chat.context.close();
  });

  await step('the incident page shows the workflow rail and an acknowledgement timer', async () => {
    const fatima = await open();
    await signInAs(fatima.page, 'Fatima (demo attendee)');
    await fatima.page.goto(`${BASE}/events/${EVENT}/incidents`);
    await fatima.page.getByRole('link', { name: /Microphone crackling in Room 3/ }).first().click();
    await fatima.page.getByRole('list', { name: 'Workflow stages' }).waitFor();
    await fatima.page.getByText(/to acknowledge|Overdue by|Acknowledged/).first().waitFor();
    await fatima.context.close();
  });

  await ada.context.close();
  await attendee.context.close();
  await ops.context.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} feature checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
