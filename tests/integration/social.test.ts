import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { follow, getProfileView, myNetwork, unfollow, updateProfileText } from '@/services/social';
import { getThread, inbox, publishKey, sendSealed } from '@/services/private-messages';
import { createIdentity, deriveConversationKey, open, seal } from '@/lib/e2ee/crypto';
import { DomainError } from '@/domain/errors';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : 'THROWN';
  }
}

describe('profiles and follows', () => {
  it('requires a mutual follow for CONNECTIONS profiles; a one-sided follow is not enough', async () => {
    const h = await createHarness();
    const { attendeeChloe: chloe, attendeeDev: dev } = h.users;
    // Chloe's demo profile is CONNECTIONS-only.
    expect((await getProfileView(h.ctx, h.eventId, dev, chloe)).bio).toBeNull();
    await follow(h.ctx, h.eventId, dev, chloe);
    expect((await getProfileView(h.ctx, h.eventId, dev, chloe)).bio).toBeNull();
    await follow(h.ctx, h.eventId, chloe, dev);
    const view = await getProfileView(h.ctx, h.eventId, dev, chloe);
    expect(view.bio).toMatch(/wheelchair/);
    expect(view.canMessage).toBe(true);
  });

  it('hides people who are not discoverable, unless they already follow you', async () => {
    const h = await createHarness();
    const { attendeeEli: eli, attendeeAda: ada } = h.users; // Eli is not discoverable
    expect(await code(getProfileView(h.ctx, h.eventId, ada, eli))).toBe('NOT_FOUND');
    expect(await code(follow(h.ctx, h.eventId, ada, eli))).toBe('NOT_FOUND');
    await h.store.addFollow({ followerId: eli, followeeId: ada, createdAt: h.now() });
    expect(await code(follow(h.ctx, h.eventId, ada, eli))).toBe('OK');
  });

  it('lets only the owner list followers and following; others get counts', async () => {
    const h = await createHarness();
    const net = await myNetwork(h.ctx, h.eventId, h.users.attendeeAda);
    expect(net.followers.map((p) => p.userId).sort()).toEqual([h.users.attendeeBen, h.users.attendeeDev, h.users.speakerInes].sort());
    const seen = await getProfileView(h.ctx, h.eventId, h.users.attendeeBen, h.users.attendeeAda);
    expect(seen.followers).toBe(3);
    expect(Object.keys(seen)).not.toContain('followerList');
  });

  it('stores profile text sealed, and never in plaintext', async () => {
    const h = await createHarness();
    await updateProfileText(h.ctx, h.users.attendeeAda, { headline: 'Solar array whisperer', bio: 'Ask me about MPPT', visibility: 'EVENT' });
    const record = await h.store.getProfile(h.users.attendeeAda);
    expect(record?.sealed).not.toContain('MPPT');
    expect((await getProfileView(h.ctx, h.eventId, h.users.attendeeBen, h.users.attendeeAda)).headline).toBe('Solar array whisperer');
  });

  it('notifies on a new follow once, and unfollow ends the connection', async () => {
    const h = await createHarness();
    const { attendeeBen: ben, attendeeDev: dev } = h.users;
    await follow(h.ctx, h.eventId, ben, dev);
    await follow(h.ctx, h.eventId, ben, dev);
    expect((await h.store.listNotifications(dev)).filter((n) => n.kind === 'NEW_FOLLOWER')).toHaveLength(1);
    expect((await unfollow(h.ctx, h.eventId, ben, dev)).following).toBe(false);
    expect(await code(follow(h.ctx, h.eventId, ben, ben))).toBe('VALIDATION_FAILED');
  });
});

describe('end-to-end encrypted private messages through the relay', () => {
  it('relays ciphertext the server cannot read, only between connections', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, speakerInes: ines, attendeeBen: ben } = h.users; // Ada and Ines are connected in the seed
    const a = await createIdentity();
    const i = await createIdentity();
    const bundleA = await publishKey(h.ctx, ada, a.publicKey);
    const bundleI = await publishKey(h.ctx, ines, i.publicKey);
    expect(bundleA.id).toBe(a.keyId); // the server computes the same key id as the browser

    const kA = await deriveConversationKey(a.keyPair.privateKey, i.publicKey, { userId: ada, keyId: a.keyId }, { userId: ines, keyId: i.keyId });
    const secret = 'My badge number is 4471, can you reprint it?';
    const sealed = await seal(kA, secret, ada, ines);
    await sendSealed(h.ctx, h.eventId, ada, ines, { senderKeyId: bundleA.id, recipientKeyId: bundleI.id, ...sealed });

    // Nothing the server holds contains the plaintext: not the message, not the notification.
    const everything = JSON.stringify({
      sealed: await h.store.listSealedInvolving(ada),
      notifications: await h.store.listNotifications(ines),
      messages: await h.store.listMessages(h.eventId),
    });
    expect(everything).not.toContain('4471');
    expect(everything).not.toContain('badge number');

    const thread = await getThread(h.ctx, h.eventId, ines, ada);
    const kI = await deriveConversationKey(i.keyPair.privateKey, a.publicKey, { userId: ines, keyId: i.keyId }, { userId: ada, keyId: a.keyId });
    const first = thread.messages[0];
    expect(first && (await open(kI, first, ada, ines))).toBe(secret);

    // Ben is not connected to Ada: he can neither read the thread nor write to it.
    expect(await code(getThread(h.ctx, h.eventId, ben, ada))).toBe('FORBIDDEN');
    expect((await inbox(h.ctx, h.eventId, ines)).find((r) => r.peerId === ada)?.count).toBe(1);
  });

  it('rejects malformed keys, foreign key ids and oversized payloads', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, speakerInes: ines } = h.users;
    expect(await code(publishKey(h.ctx, ada, { kty: 'RSA' }))).toBe('VALIDATION_FAILED');
    const a = await createIdentity();
    const i = await createIdentity();
    const ka = await publishKey(h.ctx, ada, a.publicKey);
    await publishKey(h.ctx, ines, i.publicKey);
    // Ada names her own key as the recipient key: refused.
    expect(await code(sendSealed(h.ctx, h.eventId, ada, ines, { senderKeyId: ka.id, recipientKeyId: ka.id, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(40) }))).toBe('VALIDATION_FAILED');
    expect(await code(sendSealed(h.ctx, h.eventId, ada, ines, { senderKeyId: ka.id, recipientKeyId: i.keyId, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(9000) }))).toBe('VALIDATION_FAILED');
  });
});

import { eraseMe, ERASED_TEXT, exportMyData } from '@/services/rights';
import { handleMessage } from '@/services/pipeline';

describe('data rights', () => {
  it('exports everything about the person, with private messages only as ciphertext', async () => {
    const h = await createHarness();
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'The microphone in Room 3 has stopped working.' });
    const data = await exportMyData(h.ctx, h.users.attendeeAda);
    expect(data.account.id).toBe(h.users.attendeeAda);
    expect(data.profile.headline).toMatch(/Satellite power engineer/);
    expect(data.followers.length).toBe(3);
    expect(data.events[0]?.messagesToHello[0]?.text).toMatch(/microphone/);
  });

  it('erases personal data, redacts operational text, and keeps the accountable record', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const res = await handleMessage(h.ctx, { eventId: h.eventId, userId: ada, text: 'The microphone in Room 3 has stopped working.' });
    const a = await createIdentity();
    await publishKey(h.ctx, ada, a.publicKey);
    const report = await eraseMe(h.ctx, ada);
    expect(report.follows).toBeGreaterThan(0);
    expect(report.deviceKeys).toBe(1);
    expect(await h.store.getProfile(ada)).toBeNull();
    expect(await h.store.listFollowers(ada)).toHaveLength(0);
    expect((await h.store.getUser(ada))?.displayName).toBe('Erased person');
    const msgs = (await h.store.listMessages(h.eventId)).filter((m) => m.senderUserId === ada);
    expect(msgs.every((m) => m.text === ERASED_TEXT)).toBe(true);
    // The incident staff acted on still exists, without Ada's words.
    const incidentId = res.incidents[0]?.incidentId ?? '';
    expect(await h.store.getIncident(incidentId)).not.toBeNull();
    expect((await h.store.listReportsForIncident(incidentId)).filter((r) => r.reporterUserId === ada).every((r) => r.text === ERASED_TEXT)).toBe(true);
    const entry = (await h.store.listAudit(h.eventId)).find((e) => e.action === 'privacy.erase');
    expect(entry?.detail).not.toMatch(/microphone/);
  });
});
