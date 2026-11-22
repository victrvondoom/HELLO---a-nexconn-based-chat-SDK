import { afterEach, describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { actOnCall, getCall, pollCall, startCall } from '@/services/calls';
import { acknowledgePrivacyAlert, assertUploadPrivacy, getPrivacyFilter, listPrivacyAlerts, updatePrivacyFilter } from '@/services/privacy-filter';
import { parseUploadPrivacy } from '@/domain/privacy-filter/upload';
import { disconnectTwitch, finishTwitch, resetTwitch, setTwitchDeps, startTwitch, twitchState } from '@/services/privacy-twitch';
import { eraseMe, exportMyData } from '@/services/rights';
import type { EventSocket } from '@/integrations/twitch/monitor';

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

const until = async (check: () => boolean | Promise<boolean>, ms = 2000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('privacy filter settings', () => {
  it('starts from the defaults, merges partial updates, and keeps one record per person', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    expect(await getPrivacyFilter(h.ctx, h.eventId, ada)).toMatchObject({ enabled: false, fps: 15, delay: 2, faceEnabled: true, updatedAt: null });
    await updatePrivacyFilter(h.ctx, h.eventId, ada, { fps: 30 });
    const second = await updatePrivacyFilter(h.ctx, h.eventId, ada, { phoneEnabled: false });
    expect(second).toMatchObject({ fps: 30, phoneEnabled: false, qrEnabled: true });
    expect(await h.store.docList('privacyFilters', { userId: ada })).toHaveLength(1);
    // another person's switches are untouched
    expect((await getPrivacyFilter(h.ctx, h.eventId, h.users.attendeeBen)).fps).toBe(15);
  });

  it('two simultaneous changes from different tabs both land', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    await Promise.all([updatePrivacyFilter(h.ctx, h.eventId, ada, { fps: 20 }), updatePrivacyFilter(h.ctx, h.eventId, ada, { qrEnabled: false })]);
    expect(await getPrivacyFilter(h.ctx, h.eventId, ada)).toMatchObject({ fps: 20, qrEnabled: false });
  });

  it('refuses people who are not in the event', async () => {
    const h = await createHarness();
    await expectDomainError(getPrivacyFilter(h.ctx, h.eventId, 'u-nobody'), 'FORBIDDEN');
    await expectDomainError(updatePrivacyFilter(h.ctx, h.eventId, 'u-nobody', { fps: 20 }), 'FORBIDDEN');
  });
});

async function callWith(h: Awaited<ReturnType<typeof createHarness>>, host: string, others: string[]) {
  const call = await startCall(h.ctx, h.eventId, host, { title: 'Stage check', communityId: null });
  const peers: Record<string, string> = {};
  for (const u of [host, ...others]) {
    const joined = (await actOnCall(h.ctx, h.eventId, u, call.id, { action: 'join' })) as { peerId: string };
    peers[u] = joined.peerId;
  }
  const peer = (u: string) => peers[u] ?? '';
  return { call, peer };
}

describe('privacy alerts in calls', () => {
  it('the host alerts one person; only that person sees it, in their poll and notifications, until acknowledged', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const ben = h.users.attendeeBen;
    const chloe = h.users.attendeeChloe;
    const { call, peer } = await callWith(h, ada, [ben, chloe]);
    expect((await getCall(h.ctx, h.eventId, ada, call.id)).canAlert).toBe(true);
    expect((await getCall(h.ctx, h.eventId, ben, call.id)).canAlert).toBe(false);

    expect(await actOnCall(h.ctx, h.eventId, ada, call.id, { action: 'privacy-alert', peerId: peer(ada), to: peer(ben) })).toEqual({ alerted: 1 });

    const benPoll = await pollCall(h.ctx, h.eventId, ben, call.id, { peerId: peer(ben), since: 0 });
    expect(benPoll.alerts).toHaveLength(1);
    expect(benPoll.alerts[0]?.from).toBe((await h.store.getUser(ada))?.displayName);
    expect((await pollCall(h.ctx, h.eventId, chloe, call.id, { peerId: peer(chloe), since: 0 })).alerts).toHaveLength(0);
    expect((await h.store.listNotifications(ben)).some((n) => n.kind === 'PRIVACY_ALERT')).toBe(true);
    expect((await h.store.listNotifications(chloe)).some((n) => n.kind === 'PRIVACY_ALERT')).toBe(false);

    const alertId = benPoll.alerts[0]?.id ?? '';
    // someone else cannot acknowledge (or learn about) Ben's alert
    await expectDomainError(acknowledgePrivacyAlert(h.ctx, h.eventId, chloe, alertId), 'NOT_FOUND');
    expect((await acknowledgePrivacyAlert(h.ctx, h.eventId, ben, alertId)).acknowledged).toBe(true);
    expect((await pollCall(h.ctx, h.eventId, ben, call.id, { peerId: peer(ben), since: 0 })).alerts).toHaveLength(0);
    expect((await listPrivacyAlerts(h.ctx, h.eventId, ben))[0]?.acknowledged).toBe(true);
  });

  it('a participant who is not the host or staff cannot alert; operations staff can, to everyone else', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const ben = h.users.attendeeBen;
    const kiri = h.users.opsKiri;
    const { call, peer } = await callWith(h, ada, [ben, kiri]);
    await expectDomainError(actOnCall(h.ctx, h.eventId, ben, call.id, { action: 'privacy-alert', peerId: peer(ben), to: null }), 'FORBIDDEN');
    // speaking for someone else's peer id is refused
    await expectDomainError(actOnCall(h.ctx, h.eventId, kiri, call.id, { action: 'privacy-alert', peerId: peer(ada), to: null }), 'FORBIDDEN');
    expect(await actOnCall(h.ctx, h.eventId, kiri, call.id, { action: 'privacy-alert', peerId: peer(kiri), to: null })).toEqual({ alerted: 2 });
    expect((await h.store.listAudit(h.eventId)).some((a) => a.action === 'privacy.alert')).toBe(true);
  });

  it('no alerts once the call has ended', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const { call, peer } = await callWith(h, ada, [h.users.attendeeBen]);
    await actOnCall(h.ctx, h.eventId, ada, call.id, { action: 'end' });
    await expectDomainError(actOnCall(h.ctx, h.eventId, ada, call.id, { action: 'privacy-alert', peerId: peer(ada), to: null }), 'INVALID_TRANSITION');
  });
});

describe('privacy filter export and erasure', () => {
  it('exports switches and received alerts; erasure removes them and unnames the alerts a person sent', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const ben = h.users.attendeeBen;
    await updatePrivacyFilter(h.ctx, h.eventId, ben, { fps: 24 });
    const { call, peer } = await callWith(h, ada, [ben]);
    await actOnCall(h.ctx, h.eventId, ada, call.id, { action: 'privacy-alert', peerId: peer(ada), to: peer(ben) });

    const exported = (await exportMyData(h.ctx, ben)) as unknown as { privacyFilter: { settings: { fps: number }; alertsReceived: unknown[]; peopleKeptVisible: string } };
    expect(exported.privacyFilter.settings.fps).toBe(24);
    expect(exported.privacyFilter.alertsReceived).toHaveLength(1);
    expect(exported.privacyFilter.peopleKeptVisible).toMatch(/never sent to HELLO/);

    // Ada (the sender) is erased: Ben keeps his alert, without Ada's identity.
    const adaReport = await eraseMe(h.ctx, ada);
    expect(adaReport.privacyFilterRecords).toBe(1);
    const [kept] = await h.store.docList('privacyAlerts', { recipientUserId: ben });
    expect(kept?.senderUserId).toBeNull();
    expect(kept?.senderName).toBe('A former participant');

    const benReport = await eraseMe(h.ctx, ben);
    expect(benReport.privacyFilterRecords).toBe(2);
    expect(await h.store.docGet('privacyFilters', ben)).toBeNull();
    expect(await h.store.docList('privacyAlerts', { recipientUserId: ben })).toHaveLength(0);
  });
});

/** Fake Twitch: an HTTP table and scripted sockets (port of upstream test_twitch_* cases). */
function fakeTwitch(scripts: unknown[][]) {
  const requests: Array<{ url: string; body: unknown }> = [];
  const sockets: Array<{ url: string; closed: boolean }> = [];
  const fetchFake = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null });
    const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
    if (url.includes('oauth2/validate')) return json({ client_id: 'abc123', scopes: ['user:read:chat'], user_id: '9', login: 'ada_live' });
    if (url.includes('/streams')) return json({ data: [{ id: 'live' }] });
    return json({ data: [] }, 202);
  }) as typeof fetch;
  const open = (url: string): Promise<EventSocket> => {
    const messages = [...(scripts[sockets.length] ?? [])];
    const record = { url, closed: false };
    sockets.push(record);
    return Promise.resolve({
      next: () => (messages.length ? Promise.resolve(messages.shift()) : new Promise<unknown>(() => undefined)),
      close: () => {
        record.closed = true;
      },
    });
  };
  setTwitchDeps({ fetch: fetchFake, open, now: () => Date.now(), sleep: () => new Promise<void>(() => undefined) });
  return { requests, sockets };
}

const welcome = (id: string) => ({ metadata: { message_type: 'session_welcome' }, payload: { session: { id } } });
const chat = (text: string, badges: string[]) => ({
  metadata: { message_type: 'notification' },
  payload: { subscription: { type: 'channel.chat.message' }, event: { broadcaster_user_id: '9', chatter_user_id: '2', chatter_user_name: 'ModMia', badges: badges.map((set_id) => ({ set_id })), message: { text } } },
});
const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';

describe('Twitch connection', () => {
  afterEach(() => {
    resetTwitch();
    setTwitchDeps(null);
  });

  it('OAuth state is single use, bound to the person who started it, and expires (upstream test_twitch_oauth_*)', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    fakeTwitch([[welcome('s1')]]);
    await expectDomainError(startTwitch(h.ctx, h.eventId, ada, 'a/b', 'http://localhost/twitch/callback'), 'VALIDATION_FAILED');
    const { url } = await startTwitch(h.ctx, h.eventId, ada, 'abc123', 'http://localhost/twitch/callback');
    expect(new URL(url).searchParams.get('scope')).toBe('user:read:chat');
    // Ben cannot finish Ada's sign-in
    await expectDomainError(finishTwitch(h.ctx, h.users.attendeeBen, stateOf(url), 'token'), 'FORBIDDEN');
    expect((await finishTwitch(h.ctx, ada, stateOf(url), 'token')).channel).toBe('ada_live');
    await expectDomainError(finishTwitch(h.ctx, ada, stateOf(url), 'token'), 'FORBIDDEN');

    const again = await startTwitch(h.ctx, h.eventId, ada, 'abc123', 'http://localhost/twitch/callback');
    h.setNow(h.now() + 5 * 60_000 + 1);
    await expectDomainError(finishTwitch(h.ctx, ada, stateOf(again.url), 'token'), 'FORBIDDEN');
  });

  it('subscribes, reports live, and turns a moderator !privacy into a private alert for the broadcaster', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const net = fakeTwitch([[welcome('s1'), chat('!privacy please', ['moderator']), chat('!privacy', []), chat('!privacy', ['moderator'])]]);
    const { url } = await startTwitch(h.ctx, h.eventId, ada, 'abc123', 'http://localhost/twitch/callback');
    await finishTwitch(h.ctx, ada, stateOf(url), 'token');
    await until(async () => (await h.store.docList('privacyAlerts', { recipientUserId: ada })).length === 1);
    const state = await twitchState(h.ctx, h.eventId, ada);
    expect(state).toMatchObject({ connection: 'connected', live: true, channel: 'ada_live', eventId: h.eventId });
    expect(state.alert?.sender).toBe('ModMia');
    const subs = net.requests.filter((r) => r.url.endsWith('/eventsub/subscriptions')).map((r) => (r.body as { type: string }).type);
    expect(subs).toEqual(['stream.online', 'stream.offline', 'channel.chat.message']);
    expect((await listPrivacyAlerts(h.ctx, h.eventId, ada))[0]).toMatchObject({ source: 'TWITCH', from: 'ModMia' });
    // the token never appears in anything stored
    expect(JSON.stringify(await h.store.docList('privacyAlerts'))).not.toContain('token');
    expect(disconnectTwitch(ada)).toBe(true);
    expect((await twitchState(h.ctx, h.eventId, ada)).connection).toBe('disconnected');
  });

  it('a session reconnect moves to the new socket without re-subscribing (upstream test_twitch_reconnect_transfers_existing_subscriptions)', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const net = fakeTwitch([
      [welcome('s1'), { metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?session=123' } } }],
      [{ metadata: { message_type: 'session_welcome' } }, chat('!privacy', ['broadcaster'])],
    ]);
    const { url } = await startTwitch(h.ctx, h.eventId, ada, 'abc123', 'http://localhost/twitch/callback');
    await finishTwitch(h.ctx, ada, stateOf(url), 'token');
    await until(async () => (await h.store.docList('privacyAlerts', { recipientUserId: ada })).length === 1);
    expect(net.sockets.map((s) => s.url)).toEqual(['wss://eventsub.wss.twitch.tv/ws', 'wss://eventsub.wss.twitch.tv/ws?session=123']);
    expect(net.sockets[0]?.closed).toBe(true);
    expect(net.requests.filter((r) => r.url.endsWith('/eventsub/subscriptions'))).toHaveLength(3);
  });

  it('a reconnect to any other host drops the connection', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const net = fakeTwitch([[welcome('s1'), { metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://evil.example/ws' } } }]]);
    const { url } = await startTwitch(h.ctx, h.eventId, ada, 'abc123', 'http://localhost/twitch/callback');
    await finishTwitch(h.ctx, ada, stateOf(url), 'token');
    await until(async () => (await twitchState(h.ctx, h.eventId, ada)).connection.includes('retrying'));
    expect(net.sockets).toHaveLength(1);
    expect(net.sockets[0]?.closed).toBe(true);
  });
});

describe('privacy filter parity settings and uploads', () => {
  it('stores the new switches and the effect, and older records read with the defaults', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    expect(await getPrivacyFilter(h.ctx, h.eventId, ada)).toMatchObject({ peopleEnabled: true, screensEnabled: true, effect: 'pixelate' });
    expect(await updatePrivacyFilter(h.ctx, h.eventId, ada, { effect: 'blackout', peopleEnabled: false })).toMatchObject({ effect: 'blackout', peopleEnabled: false, screensEnabled: true });
    // a record written before these fields existed
    await h.store.docPut('privacyFilters', { id: h.users.attendeeBen, userId: h.users.attendeeBen, enabled: true, fps: 15, delay: 2, faceEnabled: true, qrEnabled: true, phoneEnabled: true, updatedAt: 1 });
    expect(await getPrivacyFilter(h.ctx, h.eventId, h.users.attendeeBen)).toMatchObject({ enabled: true, peopleEnabled: true, screensEnabled: true, effect: 'pixelate' });
  });

  it('with the filter on, refuses uploads that did not go through it; accepts protected or explicitly declined ones', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    // filter off: any upload is accepted, declared or not
    await assertUploadPrivacy(h.ctx, ada, null);
    await updatePrivacyFilter(h.ctx, h.eventId, ada, { enabled: true });
    await expectDomainError(assertUploadPrivacy(h.ctx, ada, null), 'INELIGIBLE');
    await expectDomainError(assertUploadPrivacy(h.ctx, ada, parseUploadPrivacy('off')), 'INELIGIBLE');
    await expectDomainError(assertUploadPrivacy(h.ctx, ada, parseUploadPrivacy('garbage')), 'INELIGIBLE');
    await assertUploadPrivacy(h.ctx, ada, parseUploadPrivacy('protected'));
    await assertUploadPrivacy(h.ctx, ada, parseUploadPrivacy(' Declined '));
    // the rule follows the uploader's own switch, not anyone else's
    await assertUploadPrivacy(h.ctx, h.users.attendeeBen, null);
  });
});
