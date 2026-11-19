/* global process, console, fetch, Buffer, document */
/**
 * Product flow: accounts, feed with media, communities, games, workflows, MCP, live location and a
 * two-person call, driven through the real API and a real browser. Also checks that one person
 * cannot reach another person's things. Run against a started server: BASE_URL=http://localhost:3000.
 */
import { chromium } from 'playwright';
import { resetDemo } from './reset.mjs';

const BASE = process.env.BASE_URL ?? process.env.BASE ?? 'http://localhost:3000';
const EVENT = 'evt-demo-hello-summit';
const E = `${BASE}/api/events/${EVENT}`;
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};

/** A tiny API client that keeps its own cookie, i.e. one signed-in person. */
function person() {
  let cookie = '';
  const call = async (url, method = 'GET', body, headers = {}) => {
    const response = await fetch(url, {
      method,
      headers: { ...(body !== undefined && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), cookie, ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const set = response.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const json = await response.json().catch(() => null);
    return { status: response.status, json, data: json?.data };
  };
  return { call, cookie: () => cookie };
}

const reset = await resetDemo(BASE);
check('demo reset needs an organiser and works for one', reset.status === 200);
check('demo reset refused without a session', (await fetch(`${BASE}/api/demo/reset`, { method: 'POST' })).status === 401);

// --- accounts ---
const ana = person();
const bo = person();
const suffix = Date.now().toString(36);
const reg = await ana.call(`${BASE}/api/auth/register`, 'POST', { handle: `ana_${suffix}`, displayName: 'Ana Test', password: 'correct horse battery' });
check('register creates an account and a session', reg.status === 201 && ana.cookie().includes('hello_session='));
check('weak password refused', (await person().call(`${BASE}/api/auth/register`, 'POST', { handle: `x_${suffix}`, displayName: 'X', password: 'short' })).status === 422);
check('duplicate handle refused', (await person().call(`${BASE}/api/auth/register`, 'POST', { handle: `ana_${suffix}`, displayName: 'Other', password: 'another long password' })).status === 422);
await bo.call(`${BASE}/api/auth/register`, 'POST', { handle: `bo_${suffix}`, displayName: 'Bo Test', password: 'a different long password' });
check('wrong password refused', (await person().call(`${BASE}/api/auth/login`, 'POST', { handle: `ana_${suffix}`, password: 'wrong password here' })).status === 403);
const again = person();
check('sign in works', (await again.call(`${BASE}/api/auth/login`, 'POST', { handle: `ana_${suffix}`, password: 'correct horse battery' })).status === 200);
check('forged cookie is not a session', (await fetch(`${E}/feed`, { headers: { cookie: 'hello_session=u-org-nadia; hello_demo_user=u-org-nadia' } })).status === 401);
check('signed-out API call refused', (await fetch(`${E}/feed`)).status === 401);

// --- feed and media ---
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = await ana.call(`${E}/media`, 'POST', new Uint8Array(png), { 'content-type': 'image/png' });
check('picture upload accepted', upload.status === 201, JSON.stringify(upload.json));
check('file whose bytes do not match its type refused', (await ana.call(`${E}/media`, 'POST', new Uint8Array(Buffer.from('<script>alert(1)</script>')), { 'content-type': 'image/png' })).status === 422);
check('html upload refused', (await ana.call(`${E}/media`, 'POST', new Uint8Array(Buffer.from('<html></html>')), { 'content-type': 'text/html' })).status === 422);
const big = new Uint8Array(11 * 1024 * 1024);
big.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
check('11 MB video accepted (under the 24 MB limit)', (await ana.call(`${E}/media`, 'POST', big, { 'content-type': 'video/mp4' })).status === 201);
check('oversized upload refused', (await ana.call(`${E}/media`, 'POST', new Uint8Array(25 * 1024 * 1024), { 'content-type': 'video/mp4' })).status === 422);
const post = await ana.call(`${E}/feed`, 'POST', { text: 'Hello from the product flow', mediaId: upload.data.id });
check('post with picture created', post.status === 201);
check('someone else cannot attach my upload', (await bo.call(`${E}/feed`, 'POST', { text: 'steal', mediaId: upload.data.id })).status === 404);
check('empty post refused', (await ana.call(`${E}/feed`, 'POST', { text: '   ' })).status === 422);
const media = await fetch(`${E}/media/${upload.data.id}`, { headers: { cookie: bo.cookie() } });
check('media served to an event member with a safe type', media.status === 200 && media.headers.get('content-type') === 'image/png' && media.headers.get('x-content-type-options') === 'nosniff');
check('media refused when signed out', (await fetch(`${E}/media/${upload.data.id}`)).status === 401);
const range = await fetch(`${E}/media/${upload.data.id}`, { headers: { cookie: bo.cookie(), range: 'bytes=0-9' } });
check('byte ranges supported', range.status === 206 && (await range.arrayBuffer()).byteLength === 10);
await bo.call(`${E}/feed/${post.data.id}`, 'POST', { action: 'like', on: true });
await bo.call(`${E}/feed/${post.data.id}`, 'POST', { action: 'like', on: true });
await bo.call(`${E}/feed/${post.data.id}`, 'POST', { action: 'comment', text: 'Nice' });
const share = await bo.call(`${E}/feed`, 'POST', { text: '', repostOf: post.data.id });
const feed = await ana.call(`${E}/feed`);
const mine = feed.data.posts.find((p) => p.id === post.data.id);
check('likes count once per person, comments counted', mine?.likeCount === 1 && mine?.commentCount === 1);
check('share appears with the original inside', feed.data.posts.some((p) => p.id === share.data.id && p.repost?.id === post.data.id));
check('someone else cannot delete my post', (await bo.call(`${E}/feed/${post.data.id}`, 'POST', { action: 'delete' })).status === 403);
check('query operators in a filter are refused', (await ana.call(`${E}/feed?author[$ne]=x&community={"$gt":""}`)).status === 422);
const notes = await ana.call(`${BASE}/api/events/${EVENT}/flow`);
check('author notified of like, comment and share', Number(notes.data.nodes.find((n) => n.id === 'notifications').metric) >= 3);

// --- communities ---
const com = await ana.call(`${E}/communities`, 'POST', { name: `Makers ${suffix}`, description: 'People who build things', country: '356' });
check('community created', com.status === 201);
check('non-member cannot post in a community', (await bo.call(`${E}/feed`, 'POST', { text: 'hi', communityId: com.data.id })).status === 403);
await bo.call(`${E}/communities/${com.data.id}`, 'POST', { action: 'join' });
check('member can post in a community', (await bo.call(`${E}/feed`, 'POST', { text: 'hi makers', communityId: com.data.id })).status === 201);
check('member cannot delete a community', (await bo.call(`${E}/communities/${com.data.id}`, 'POST', { action: 'delete' })).status === 403);

// --- games: rules are enforced by the server ---
const game = await ana.call(`${E}/games`, 'POST', { kind: 'FOUR' });
check('cannot move before an opponent joins', (await ana.call(`${E}/games/${game.data.id}`, 'POST', { action: 'move', col: 0 })).status === 409);
await bo.call(`${E}/games/${game.data.id}`, 'POST', { action: 'join' });
check('cannot move out of turn', (await bo.call(`${E}/games/${game.data.id}`, 'POST', { action: 'move', col: 0 })).status === 409);
let last;
for (let i = 0; i < 4; i += 1) {
  last = await ana.call(`${E}/games/${game.data.id}`, 'POST', { action: 'move', col: 0 });
  if (i < 3) await bo.call(`${E}/games/${game.data.id}`, 'POST', { action: 'move', col: 1 });
}
check('four in a column wins', last.data.game.status === 'WON' && last.data.game.youWon && last.data.game.line.length === 4);
check('no moves after the game is won', (await bo.call(`${E}/games/${game.data.id}`, 'POST', { action: 'move', col: 2 })).status === 409);
const quiz = await ana.call(`${E}/games`, 'POST', { kind: 'QUIZ' });
const fresh = await bo.call(`${E}/games/${quiz.data.id}`);
check('quiz answers are not sent before you answer', fresh.data.game.questions.length >= 3 && fresh.data.game.questions.every((q) => q.answer === null));
const answered = await bo.call(`${E}/games/${quiz.data.id}`, 'POST', { action: 'answer', question: 0, choice: 0 });
check('answer revealed only after answering', answered.data.game.questions[0].answer !== null && answered.data.game.questions[1].answer === null);
check('cannot answer the same question twice', (await bo.call(`${E}/games/${quiz.data.id}`, 'POST', { action: 'answer', question: 0, choice: 1 })).status === 409);

// --- workflows ---
const run = await ana.call(`${E}/flow/run`, 'POST', { workflowId: 'my-day' });
check('attendee workflow runs every step', run.data.run.status === 'SUCCEEDED' && run.data.run.steps.length === 3);
check('attendee cannot run a staff workflow', (await ana.call(`${E}/flow/run`, 'POST', { workflowId: 'sla-sweep' })).status === 403);
const flowAna = await ana.call(`${E}/flow`);
check('attendee canvas hides staff nodes and workflows', !flowAna.data.nodes.some((n) => n.id === 'signals' || n.id === 'wf:sla-sweep'));
const organiser = person();
await organiser.call(`${BASE}/api/demo/session`, 'POST', { userId: 'u-org-nadia' });
for (const id of ['sla-sweep', 'signal-refresh', 'ops-briefing', 'quiz-round']) {
  const r = await organiser.call(`${E}/flow/run`, 'POST', { workflowId: id });
  check(`organiser workflow ${id} succeeds`, r.data?.run.status === 'SUCCEEDED', JSON.stringify(r.json));
}

// --- MCP ---
const mcp = (token, body) => fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const readToken = (await ana.call(`${BASE}/api/me/tokens`, 'POST', { name: 'reader', scope: 'READ', eventId: EVENT })).data.token;
const writeToken = (await ana.call(`${BASE}/api/me/tokens`, 'POST', { name: 'writer', scope: 'WRITE', eventId: EVENT })).data.token;
check('MCP refuses a missing token', (await mcp(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401);
check('MCP refuses a made-up token', (await mcp('hello_pat_nope', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 401);
check('MCP ignores a session cookie', (await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ana.cookie() }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).status === 401);
const init = await (await mcp(readToken.secret, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
check('MCP initialize', init.result?.protocolVersion === '2025-06-18' && init.result.serverInfo.name === 'hello');
const tools = await (await mcp(readToken.secret, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
check('MCP lists tools with schemas', tools.result.tools.length === 9 && tools.result.tools.every((t) => t.inputSchema.type === 'object'));
const who = await (await mcp(readToken.secret, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hello_whoami', arguments: {} } })).json();
check('MCP tool acts as the token owner', JSON.parse(who.result.content[0].text).name === 'Ana Test');
const denied = await (await mcp(readToken.secret, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'hello_post', arguments: { text: 'x' } } })).json();
check('read-only token cannot write', denied.result.isError === true);
const posted = await (await mcp(writeToken.secret, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'hello_post', arguments: { text: 'Posted through MCP' } } })).json();
check('write token can post', posted.result.isError === false);
const staffRun = await (await mcp(writeToken.secret, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'hello_run_workflow', arguments: { workflowId: 'sla-sweep' } } })).json();
check('token cannot exceed its owner’s permissions', staffRun.result.isError === true);
const extra = await (await mcp(writeToken.secret, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'hello_post', arguments: { text: 'x', eventId: 'evt-other' } } })).json();
check('unexpected tool arguments refused', extra.result.isError === true);
check('cannot revoke someone else’s token', (await bo.call(`${BASE}/api/me/tokens/${readToken.id}`, 'DELETE')).status === 404);
await ana.call(`${BASE}/api/me/tokens/${readToken.id}`, 'DELETE');
check('revoked token stops working at once', (await mcp(readToken.secret, { jsonrpc: '2.0', id: 8, method: 'tools/list' })).status === 401);

// --- live location: visible only to the chosen audience ---
await ana.call(`${E}/location`, 'POST', { audience: 'CONNECTIONS', lat: 12.9716, lng: 77.5946, approximate: true, minutes: 15 });
const boMap = await bo.call(`${E}/location`);
check('connections-only location hidden from a stranger', !boMap.data.people.some((p) => p.name === 'Ana Test'));
const anaMap = await ana.call(`${E}/location`);
check('owner sees their own share, rounded', anaMap.data.me?.lat === 12.97 && anaMap.data.me?.approximate === true);
await ana.call(`${E}/location`, 'POST', { audience: 'EVENT', lat: 12.9716, lng: 77.5946, approximate: false, minutes: 15 });
check('event-wide location visible to members', (await bo.call(`${E}/location`)).data.people.some((p) => p.name === 'Ana Test'));
check('out-of-range coordinates refused', (await ana.call(`${E}/location`, 'POST', { audience: 'EVENT', lat: 999, lng: 0, approximate: false, minutes: 15 })).status === 422);
await ana.call(`${E}/location`, 'DELETE');
check('stopping removes the location for everyone', !(await bo.call(`${E}/location`)).data.people.some((p) => p.name === 'Ana Test'));
await ana.call(`${BASE}/api/me/country`, 'POST', { country: '356' });
// One person from a country is a person, not a statistic: the country is held back until at least three share it.
const countryView = (await bo.call(`${E}/location`)).data;
check('a country with fewer than three people is held back, not listed', !countryView.countries.some((c) => c.code === '356') && countryView.hiddenCountries >= 1);

// --- calls: signalling is limited to people in the call ---
const callRoom = await ana.call(`${E}/calls`, 'POST', { title: 'Flow test call' });
const joined = await ana.call(`${E}/calls/${callRoom.data.id}`, 'POST', { action: 'join' });
check('cannot poll a call with someone else’s peer id', (await bo.call(`${E}/calls/${callRoom.data.id}?peer=${joined.data.peerId}&since=0`)).status === 403);
check('cannot signal as someone else', (await bo.call(`${E}/calls/${callRoom.data.id}`, 'POST', { action: 'signal', peerId: joined.data.peerId, to: joined.data.peerId, data: { type: 'offer', sdp: 'x' } })).status === 403);
check('only the host can end a call', (await bo.call(`${E}/calls/${callRoom.data.id}`, 'POST', { action: 'end' })).status === 403);
await ana.call(`${E}/calls/${callRoom.data.id}`, 'POST', { action: 'leave', peerId: joined.data.peerId });

// --- a real two-person call in two browsers, with fake cameras ---
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const errors = [];
const open = async (who) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  const [name, value] = who.cookie().split('=');
  await context.addCookies([{ name, value, url: BASE }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return page;
};
const pageA = await open(ana);
const pageB = await open(bo);
await pageA.goto(`${BASE}/events/${EVENT}/calls/${callRoom.data.id}`);
await pageA.getByRole('button', { name: 'Join call' }).click();
await pageA.getByRole('toolbar', { name: 'Call controls' }).waitFor();
await pageB.goto(`${BASE}/events/${EVENT}/calls/${callRoom.data.id}`);
await pageB.getByRole('button', { name: 'Join call' }).click();
const playing = (page) =>
  page.waitForFunction(() => {
    const videos = [...document.querySelectorAll('.call-tile video')];
    return videos.length === 2 && videos.every((v) => v.videoWidth > 0 && v.currentTime > 0);
  }, null, { timeout: 20000 }).then(() => true, () => false);
check('both browsers receive each other’s live video', (await playing(pageA)) && (await playing(pageB)));
if (process.env.SHOTS) await pageA.screenshot({ path: `${process.env.SHOTS}/call.png` });
await pageB.getByRole('button', { name: 'Leave' }).click();
check('leaving removes the tile for the other person', await pageA.waitForFunction(() => document.querySelectorAll('.call-tile').length === 1, null, { timeout: 20000 }).then(() => true, () => false));

// --- every new screen renders without a browser error ---
for (const path of ['flow', 'feed', 'communities', `communities/${com.data.id}`, 'calls', 'games', `games/${game.data.id}`, `games/${quiz.data.id}`, 'live-map', 'settings']) {
  const response = await pageA.goto(`${BASE}/events/${EVENT}/${path}`, { waitUntil: 'networkidle' });
  check(`screen /${path} renders`, response?.status() === 200 && (await pageA.locator('h1').count()) > 0);
  if (process.env.SHOTS) await pageA.screenshot({ path: `${process.env.SHOTS}/${path.split('/')[0]}${path.includes('/') ? '-detail' : ''}.png`, fullPage: path !== 'flow' });
}
await pageA.goto(`${BASE}/events/${EVENT}/flow`, { waitUntil: 'networkidle' });
await pageA.locator('.node--workflow').filter({ hasText: 'Plan my day' }).getByRole('button', { name: /Run/ }).click();
check('running a workflow from the canvas shows its result', await pageA.locator('.runs-list li').first().waitFor({ timeout: 8000 }).then(() => true, () => false));
check('no browser errors on the new screens', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();

// --- erasure removes what the person published ---
await bo.call(`${BASE}/api/me/erase`, 'POST', { confirm: 'ERASE' });
const after = await ana.call(`${E}/feed`);
check('erasure removes the person’s posts and likes', !after.data.posts.some((p) => p.author.name === 'Bo Test') && after.data.posts.find((p) => p.id === post.data.id)?.likeCount === 0);
check('erased account can no longer sign in', (await person().call(`${BASE}/api/auth/login`, 'POST', { handle: `bo_${suffix}`, password: 'a different long password' })).status === 403);

console.log(failures === 0 ? '\nAll product-flow checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
