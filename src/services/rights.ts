import { DomainError } from '../domain/errors';
import { audit, type ServiceContext } from './context';
import { ownProfileText } from './social';

/**
 * A person's rights over their data: to get a copy of it, and to have it erased.
 *
 * Erasure removes everything that is only about the person (profile, follows in both directions,
 * device keys, private messages) and redacts the text of what they told HELLO. It keeps the
 * operational skeleton (that an incident existed, its status, who handled it), because staff
 * acted on it and the audit trail must stay complete. That trade-off is stated, not hidden.
 */

export const ERASED_TEXT = '[Erased at the person’s request]';

async function eventsOf(ctx: ServiceContext, userId: string): Promise<string[]> {
  return (await ctx.store.listMembershipsOfUser(userId)).map((m) => m.eventId);
}

export async function exportMyData(ctx: ServiceContext, userId: string) {
  const user = await ctx.store.getUser(userId);
  if (!user) throw new DomainError('NOT_FOUND', 'No account found.');
  const eventIds = await eventsOf(ctx, userId);
  const profile = await ownProfileText(ctx, userId);
  const [followers, following, keys, sealed, notifications] = await Promise.all([
    ctx.store.listFollowers(userId),
    ctx.store.listFollowing(userId),
    ctx.store.listKeyBundles(userId),
    ctx.store.listSealedInvolving(userId),
    ctx.store.listNotifications(userId),
  ]);
  const perEvent = [];
  for (const eventId of eventIds) {
    const [membership, messages, reports, auditEntries] = await Promise.all([
      ctx.store.findMembership(eventId, userId),
      ctx.store.listMessages(eventId),
      ctx.store.listReportsForEvent(eventId),
      ctx.store.listAudit(eventId),
    ]);
    perEvent.push({
      eventId,
      role: membership?.role ?? null,
      messagesToHello: messages.filter((m) => m.senderUserId === userId).map((m) => ({ id: m.id, at: new Date(m.createdAt).toISOString(), text: m.text })),
      incidentReports: reports
        .filter((r) => r.reporterUserId === userId)
        .map((r) => ({ id: r.id, incidentId: r.incidentId, at: new Date(r.createdAt).toISOString(), text: r.text })),
      actionsYouTook: auditEntries.filter((a) => a.actorUserId === userId).map((a) => ({ action: a.action, at: new Date(a.at).toISOString(), detail: a.detail })),
    });
  }
  return {
    format: 'hello-data-export/v1',
    generatedAt: new Date(ctx.now()).toISOString(),
    account: {
      id: user.id,
      displayName: user.displayName,
      interests: user.interests,
      discoverable: user.discoverable,
      accessibilityRequired: user.accessibilityRequired,
    },
    profile: { headline: profile.text.headline, bio: profile.text.bio, visibility: profile.visibility },
    followers: followers.map((f) => f.followerId),
    following: following.map((f) => f.followeeId),
    deviceKeys: keys.map((k) => ({ id: k.id, fingerprint: k.fingerprint, publishedAt: new Date(k.createdAt).toISOString() })),
    privateMessages: {
      note: 'These are exactly what HELLO stores: ciphertext. HELLO has no key that opens them. Your device can.',
      items: sealed.map((m) => ({ id: m.id, from: m.senderId, to: m.recipientId, at: new Date(m.createdAt).toISOString(), iv: m.iv, ciphertext: m.ciphertext })),
    },
    notifications: notifications.map((n) => ({ at: new Date(n.createdAt).toISOString(), body: n.body, read: n.readAt !== null })),
    events: perEvent,
  };
}

export interface ErasureReport {
  follows: number;
  deviceKeys: number;
  privateMessages: number;
  messagesRedacted: number;
  reportsRedacted: number;
}

export async function eraseMe(ctx: ServiceContext, userId: string): Promise<ErasureReport> {
  const user = await ctx.store.getUser(userId);
  if (!user) throw new DomainError('NOT_FOUND', 'No account found.');
  const eventIds = await eventsOf(ctx, userId);
  await ctx.store.deleteProfile(userId);
  const report: ErasureReport = {
    follows: await ctx.store.removeAllFollows(userId),
    deviceKeys: await ctx.store.deleteKeyBundles(userId),
    privateMessages: await ctx.store.deleteSealedInvolving(userId),
    messagesRedacted: await ctx.store.redactMessagesFrom(userId, ERASED_TEXT),
    reportsRedacted: await ctx.store.redactReportsFrom(userId, ERASED_TEXT),
  };
  await ctx.store.updateUser(userId, { displayName: 'Erased person', interests: [], discoverable: false, accessibilityRequired: false });
  for (const eventId of eventIds) {
    // The audit entry records that erasure happened and what it touched, never what was erased.
    await audit(
      ctx,
      eventId,
      userId,
      'privacy.erase',
      'user',
      userId,
      `Erased on request: ${report.follows} follows, ${report.deviceKeys} keys, ${report.privateMessages} private messages; ${report.messagesRedacted} messages and ${report.reportsRedacted} reports redacted.`,
    );
  }
  return report;
}
