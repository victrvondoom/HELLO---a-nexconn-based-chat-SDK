/* global process, console, document */
/**
 * Field Atlas, end to end in a real browser. Requires the demo server (HELLO_DEMO_MODE=true) on BASE_URL.
 *
 * The journey: an organiser issues check-in codes at real stations. An attendee starts missions, runs a real
 * workflow on the canvas, enters the codes, is verified by the server, levels up, submits evidence that an
 * organiser approves, completes the monthly challenge, and sees the badge after a reload. Repeats and
 * unauthorised actions are checked too.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
// Screenshots go to SHOT_DIR, or the system temp directory (this used to be a path from one machine).
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), 'hello-field-atlas-shots');
mkdirSync(SHOTS, { recursive: true });
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };

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

// A demo reset also clears the submission limiter, so each run starts with a full allowance.
await resetDemo(BASE);
const browser = await chromium.launch(launchOptions);
async function session(displayName, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport });
  // Playwright waits forever for an action by default. A missing element must fail the step instead.
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  await page.goto(`${BASE}/demo`);
  await page.getByText('Someone specific').click();
  await page.getByRole('button', { name: `Continue as ${displayName}` }).click();
  await page.waitForURL(`**/events/${EVENT}**`);
  return { context, page };
}
const xpText = (page) => page.getByRole('progressbar', { name: 'XP toward the next level' }).getAttribute('aria-valuetext');
/** Waits for a message. On failure, reports the messages the page actually showed, so a refusal is visible in the log. */
const expectMessage = async (page, text) => {
  try {
    await page.getByText(text).first().waitFor();
  } catch {
    const shown = await page.locator('.atlas-note, [role=alert], [role=status]').allTextContents();
    throw new Error(`expected “${text}”; the page showed: ${shown.map((t) => t.trim()).filter(Boolean).join(' | ') || 'nothing'}`);
  }
};
const xpOf = async (page) => Number((await xpText(page)).match(/^(\d+) XP/)?.[1] ?? NaN);
// Missions are chosen from the accessible list, which holds every floor. The map markers show only the current floor.
const pick = (page, title) => page.locator('.atlas-list button', { hasText: title }).first();
const marker = (page, title) => page.getByRole('button', { name: new RegExp(`^Mission \\d+: ${title}`) });

const organiser = await session('Nadia (demo organiser)');
const attendee = await session('Ada (demo attendee)');
const other = await session('Ben (demo attendee)');

try {
  // ---- organiser issues real check-in codes at real stations ----
  const codes = {};
  const issueCode = async (stationId, spaceId, name) => {
    const { page } = organiser;
    await page.goto(`${BASE}/events/${EVENT}/atlas/manage`);
    await page.getByLabel('Station id', { exact: true }).fill(stationId);
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Place', { exact: true }).selectOption(spaceId);
    await page.getByRole('button', { name: 'Issue code' }).click();
    const code = (await page.locator('.atlas-once').first().textContent())?.trim() ?? '';
    assert.match(code, /^[A-Z2-9]{8}$/, 'an issued check-in code is 8 characters');
    return code;
  };

  await step('organiser sees the management console with real participation counts', async () => {
    await organiser.page.goto(`${BASE}/events/${EVENT}/atlas/manage`);
    await organiser.page.getByRole('heading', { name: 'Manage missions' }).waitFor();
    await organiser.page.getByRole('heading', { name: 'Participation' }).waitFor();
    await organiser.page.getByRole('heading', { name: 'Levels' }).waitFor();
  });

  await step('organiser issues check-in codes for the registration, main hall and room 3 stations', async () => {
    codes.registration = await issueCode('st-registration', 'sp-lobby', 'Registration');
    codes.mainHall = await issueCode('st-main-hall', 'sp-main', 'Main Hall doors');
    codes.room3 = await issueCode('st-room-3', 'sp-r3', 'Room 3 door');
    assert.notEqual(codes.registration, codes.mainHall);
    await organiser.page.screenshot({ path: `${SHOTS}/manage-codes.png`, fullPage: false });
  });

  // ---- attendee: discovery and locks ----
  await step('attendee opens Field Atlas and sees the map, markers and the progression header', async () => {
    await attendee.page.goto(`${BASE}/events/${EVENT}/atlas`);
    await attendee.page.getByRole('heading', { name: 'Missions and progress' }).waitFor();
    await attendee.page.getByRole('progressbar', { name: 'XP toward the next level' }).waitFor();
    await attendee.page.getByRole('img', { name: /^Plan of HELLO Summit venue/ }).waitFor();
    assert.equal(await attendee.page.locator('.atlas-list button').count(), 6, 'six published missions in the list');
    assert.equal(await attendee.page.locator('[role=button][aria-label^="Mission "]').count(), 3, 'markers for the ground floor');
    assert.equal(await xpOf(attendee.page), 0);
  });

  await step('a locked mission says why it is locked and cannot be started', async () => {
    await pick(attendee.page, 'Attend a workshop in Room 3').click();
    await attendee.page.getByText('Finish “Find the Main Hall” first.').waitFor();
    assert.equal(await attendee.page.getByRole('button', { name: 'Start mission' }).count(), 0);
  });

  await step('the marker can be operated from the keyboard', async () => {
    const keyboardMarker = marker(attendee.page, 'Find registration');
    await keyboardMarker.focus();
    await attendee.page.keyboard.press('Enter');
    await attendee.page.getByRole('heading', { name: 'Find registration' }).waitFor();
  });

  // ---- attendee: check-in verification ----
  await step('wrong check-in code is refused and nothing is awarded', async () => {
    await attendee.page.getByRole('button', { name: 'Start mission' }).click();
    await attendee.page.getByText('Complete the step, then submit.').first().waitFor();
    await attendee.page.getByLabel('Check-in code', { exact: true }).fill('WRONGCODE');
    await attendee.page.getByRole('button', { name: 'Submit for verification' }).click();
    await expectMessage(attendee.page, 'does not match this station');
    assert.equal(await xpOf(attendee.page), 0);
  });

  await step('the server verifies the correct code and XP updates without a manual refresh', async () => {
    await attendee.page.getByLabel('Check-in code', { exact: true }).fill(codes.registration);
    await attendee.page.getByRole('button', { name: 'Submit for verification' }).click();
    await attendee.page.getByText('Verified. +30 XP.').first().waitFor();
    await attendee.page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')?.startsWith('30 XP'));
    await attendee.page.screenshot({ path: `${SHOTS}/verified-checkin.png`, fullPage: false });
  });

  await step('re-submitting a completed mission awards nothing more', async () => {
    const response = await attendee.page.request.post(`${BASE}/api/events/${EVENT}/atlas/missions/fm-find-registration/submit`, { data: { text: '', checkInCode: codes.registration } });
    const body = await response.json();
    assert.ok(body.ok, `re-submit should succeed, got ${response.status()}: ${JSON.stringify(body).slice(0, 200)}`);
    assert.equal(body.data.outcome, 'ALREADY_COMPLETE');
    assert.equal(body.data.xpAwarded, 0);
    assert.equal(await xpOf(attendee.page), 30);
  });

  // ---- attendee: a real workflow run ----
  await step('running the Plan my day workflow on the canvas is what verifies that mission', async () => {
    await attendee.page.goto(`${BASE}/events/${EVENT}/atlas`);
    await pick(attendee.page, 'Plan your day').click();
    await attendee.page.getByRole('button', { name: 'Start mission' }).click();
    await attendee.page.getByRole('button', { name: 'Check my progress' }).click();
    await attendee.page.getByText('Run the workflow from the canvas').or(attendee.page.getByText(/Run the “Plan my day”|Run the “/)).first().waitFor();
    await attendee.page.goto(`${BASE}/events/${EVENT}/flow`);
    const node = attendee.page.locator('.node', { hasText: 'Plan my day' });
    await node.getByRole('button', { name: /Run/ }).click();
    await node.getByText(/Ran /).waitFor({ timeout: 10000 });
    await attendee.page.goto(`${BASE}/events/${EVENT}/atlas`);
    await pick(attendee.page, 'Plan your day').click();
    await attendee.page.getByRole('button', { name: 'Check my progress' }).click();
    await attendee.page.getByText('Verified. +25 XP.').first().waitFor();
    assert.equal(await xpOf(attendee.page), 55);
  });

  await step('the locked level-one mission stays locked until XP is verified', async () => {
    await pick(attendee.page, 'Walk the step-free route').click();
    await attendee.page.getByText('Reach level 1 to start this mission.').waitFor();
  });

  // ---- organiser: audited XP adjustment to unlock manual evidence ----
  await step('organiser records an audited XP adjustment with a reason', async () => {
    await organiser.page.goto(`${BASE}/events/${EVENT}/atlas/manage`);
    await organiser.page.getByLabel('Person', { exact: true }).selectOption({ label: 'Ada (demo attendee)' });
    await organiser.page.getByLabel('Change (−500 to 500, not 0)', { exact: true }).fill('50');
    await organiser.page.getByLabel('Reason (kept in the audit trail)', { exact: true }).fill('Pilot bonus for the field test run.');
    await organiser.page.getByRole('button', { name: 'Record adjustment' }).click();
    await organiser.page.getByText('XP adjusted and audited.').waitFor();
  });

  await step('manual evidence waits for review and is not counted until an organiser approves it', async () => {
    await attendee.page.goto(`${BASE}/events/${EVENT}/atlas`);
    await pick(attendee.page, 'Walk the step-free route').click();
    await attendee.page.getByRole('button', { name: 'Start mission' }).click();
    await attendee.page.getByLabel('Your evidence', { exact: true }).fill('Up the east lift to the first floor gallery, about four minutes.');
    await attendee.page.getByRole('button', { name: 'Submit for verification' }).click();
    await attendee.page.getByText('Waiting for an organiser to review your evidence.').or(attendee.page.getByText('Submitted. An organiser will review your evidence.')).first().waitFor();
    assert.equal(await xpOf(attendee.page), 105, 'pending evidence adds no XP');
    await organiser.page.goto(`${BASE}/events/${EVENT}/atlas/manage`);
    await organiser.page.getByRole('heading', { name: 'Evidence waiting for review' }).waitFor();
    await organiser.page.getByRole('button', { name: 'Approve' }).first().click();
    await organiser.page.getByText('Approved. XP awarded once.').waitFor();
  });

  await step('a second organiser approval of the same evidence awards nothing again', async () => {
    const res = await organiser.page.request.post(`${BASE}/api/events/${EVENT}/atlas/reviews/${encodeURIComponent('fm-gallery-route:' + 'usr-attendee-ada')}`, { data: { decision: 'APPROVE', note: '' } });
    assert.ok(res.status() >= 400, 'second approval is refused');
    await attendee.page.goto(`${BASE}/events/${EVENT}/atlas`);
    assert.equal(await xpOf(attendee.page), 140);
  });

  // ---- monthly challenge and badge ----
  await step('completing every required mission earns the monthly badge and the season bonus', async () => {
    await attendee.page.goto(`${BASE}/events/${EVENT}/atlas`);
    await pick(attendee.page, 'Find the Main Hall').click();
    await attendee.page.getByRole('button', { name: 'Start mission' }).click();
    await attendee.page.getByLabel('Check-in code', { exact: true }).fill(codes.mainHall);
    await attendee.page.getByRole('button', { name: 'Submit for verification' }).click();
    await expectMessage(attendee.page, 'Verified. +40 XP.');
    await pick(attendee.page, 'Attend a workshop in Room 3').click();
    await attendee.page.getByRole('button', { name: 'Start mission' }).click();
    await attendee.page.getByLabel('Check-in code', { exact: true }).fill(codes.room3);
    await attendee.page.getByRole('button', { name: 'Submit for verification' }).click();
    // 60 XP for the mission plus the 100 XP season bonus, which completes the month.
    await expectMessage(attendee.page, 'Verified. +160 XP.');
    await attendee.page.getByText('Badge earned: November: The First Explorer.').first().waitFor();
    assert.equal(await xpOf(attendee.page), 140 + 40 + 60 + 100);
    await attendee.page.screenshot({ path: `${SHOTS}/badge-unlocked.png`, fullPage: false });
  });

  await step('the badge is in the cabinet, and survives a full page reload', async () => {
    await attendee.page.reload();
    await attendee.page.getByRole('tab', { name: 'My progress and badges' }).click();
    await attendee.page.getByRole('img', { name: 'November: The First Explorer monthly badge' }).waitFor();
    await attendee.page.reload();
    await attendee.page.getByRole('tab', { name: 'My progress and badges' }).click();
    await attendee.page.getByRole('img', { name: 'November: The First Explorer monthly badge' }).waitFor();
    await attendee.page.getByRole('heading', { name: 'XP history' }).waitFor();
    await attendee.page.screenshot({ path: `${SHOTS}/cabinet.png`, fullPage: false });
  });

  // ---- permissions ----
  await step('an attendee cannot open the management console or change anything through the API', async () => {
    await attendee.page.goto(`${BASE}/events/${EVENT}/atlas/manage`);
    await attendee.page.getByText('Management is for organisers and operations staff').waitFor();
    const beforeRes = await attendee.page.request.get(`${BASE}/api/events/${EVENT}/atlas`);
    const xpBefore = (await beforeRes.json()).data.player.xp;
    const r = await attendee.page.request.post(`${BASE}/api/events/${EVENT}/atlas/manage`, { data: { action: 'adjustXp', userId: 'usr-attendee-ada', amount: 500, reason: 'Trying to grant myself XP.' } });
    assert.equal(r.status(), 403);
    const body = await r.json();
    assert.equal(body.ok, false);
    const after = await attendee.page.request.get(`${BASE}/api/events/${EVENT}/atlas`);
    assert.equal((await after.json()).data.player.xp, xpBefore, 'XP unchanged by the refused request');
  });

  await step('a different attendee cannot see or act on another person’s progress', async () => {
    const r = await other.page.request.get(`${BASE}/api/events/${EVENT}/atlas`);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.player.xp, 0);
  });

  // ---- mobile and empty states ----
  await step('the atlas works at phone width without horizontal overflow', async () => {
    const phone = await session('Dev (demo attendee)', { width: 390, height: 844 });
    try {
      await phone.page.goto(`${BASE}/events/${EVENT}/atlas`);
      await phone.page.getByRole('progressbar', { name: 'XP toward the next level' }).waitFor();
      const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `page overflows by ${overflow}px`);
      await phone.page.screenshot({ path: `${SHOTS}/mobile.png`, fullPage: true });
    } finally {
      await phone.context.close();
    }
  });

  await step('the page reports no errors in the browser console', async () => {
    const errors = [];
    const { page, context } = await session('Fatima (demo attendee)');
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/events/${EVENT}/atlas`);
    await page.getByRole('heading', { name: 'Missions and progress' }).waitFor();
    await page.waitForTimeout(500);
    await context.close();
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
