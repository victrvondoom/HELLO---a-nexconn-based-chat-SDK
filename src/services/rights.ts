import { exportCompanion, eraseCompanion } from './live-room';
import { DomainError } from '../domain/errors';
import { audit, type ServiceContext } from './context';
import { ownProfileText } from './social';
import { deletePost } from './feed';
import { deleteStory } from './moments';
import { endAllSessions } from './auth';
import { erasePlaces, exportPlaces } from './places';
import { eraseCustomMaps, exportCustomMaps } from './custom-maps';
import { erasePrivacyFilter, exportPrivacyFilter } from './privacy-filter';
import { disconnectTwitch } from './privacy-twitch';
import { eraseKingdoms, exportKingdomData } from './kingdoms';

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
    const [fieldAttempts, fieldLedger, fieldBadges] = await Promise.all([
      ctx.store.docList('fieldAttempts', { eventId, userId }),
      ctx.store.docList('fieldLedger', { eventId, userId }),
      ctx.store.docList('fieldBadges', { eventId, userId }),
    ]);
    perEvent.push({
      eventId,
      role: membership?.role ?? null,
      fieldAtlas: {
        xpTotal: fieldLedger.reduce((sum, e) => sum + e.amount, 0),
        xpEntries: fieldLedger.map((e) => ({ amount: e.amount, kind: e.kind, reason: e.reason, at: new Date(e.createdAt).toISOString() })),
        badges: fieldBadges.map((b) => ({ name: b.name, kind: b.kind, earnedAt: new Date(b.earnedAt).toISOString() })),
        missionAttempts: fieldAttempts.map((a) => ({ missionId: a.missionId, status: a.status, submissions: a.submissions, evidenceText: a.evidenceText, startedAt: new Date(a.startedAt).toISOString() })),
      },
      kingdom: await exportKingdomData(ctx, userId, eventId),
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
    country: (await ctx.store.docGet('prefs', userId))?.country ?? null,
    posts: (await ctx.store.docList('posts', { authorId: userId })).map((p) => ({ id: p.id, at: new Date(p.createdAt).toISOString(), text: p.text, mediaId: p.mediaId, backdrop: p.backdrop ?? null })),
    moments: await exportMoments(ctx, userId, eventIds),
    comments: (await ctx.store.docList('comments', { authorId: userId })).map((c) => ({ postId: c.postId, at: new Date(c.createdAt).toISOString(), text: c.text })),
    communities: (await ctx.store.docList('communities')).filter((c) => c.memberIds.includes(userId)).map((c) => ({ id: c.id, name: c.name, owner: c.ownerId === userId })),
    liveLocation: (await ctx.store.docList('locations', { userId })).map((l) => ({ audience: l.audience, approximate: l.approximate, until: new Date(l.expiresAt).toISOString() })),
    accessTokens: (await ctx.store.docList('apiTokens', { userId })).map((t) => ({ name: t.name, scope: t.scope, createdAt: new Date(t.createdAt).toISOString() })),
    placeMemory: await exportPlaces(ctx, userId),
    customMaps: await exportCustomMaps(ctx, userId),
    companion: await exportCompanion(ctx, userId),
    privacyFilter: await exportPrivacyFilter(ctx, userId),
    workflowRuns: (await ctx.store.docList('workflowRuns', { actorId: userId })).map((r) => ({ workflow: r.workflowId, status: r.status, at: new Date(r.startedAt).toISOString() })),
    linkedChatAccounts: (await ctx.store.docList('chatLinks', { userId })).map((l) => ({ transport: l.transport, account: l.externalUserId, linkedAt: new Date(l.createdAt).toISOString() })),
    notifications: notifications.map((n) => ({ at: new Date(n.createdAt).toISOString(), body: n.body, read: n.readAt !== null })),
    events: perEvent,
  };
}

/**
 * Moments: the person's stories, highlights and saves, and what they did on other people's stories (views
 * and reactions). The other side of a view, who watched your story, belongs to your stories and is in them.
 */
async function exportMoments(ctx: ServiceContext, userId: string, eventIds: string[]) {
  const iso = (at: number) => new Date(at).toISOString();
  const [stories, highlights, saves] = await Promise.all([
    ctx.store.docList('stories', { authorId: userId }),
    ctx.store.docList('storyHighlights', { ownerId: userId }),
    ctx.store.docList('savedPosts', { userId }),
  ]);
  const others = (await Promise.all(eventIds.map((eventId) => ctx.store.docList('stories', { eventId })))).flat().filter((s) => s.authorId !== userId);
  return {
    stories: stories.map((s) => ({
      id: s.id,
      kind: s.kind,
      text: s.text,
      backdrop: s.backdrop,
      mediaId: s.mediaId,
      spaceId: s.spaceId,
      audience: s.audience,
      createdAt: iso(s.createdAt),
      expiresAt: iso(s.expiresAt),
      views: s.views.length,
      reactions: s.reactions.length,
    })),
    highlights: highlights.map((h) => ({ id: h.id, title: h.title, storyIds: h.storyIds })),
    saves: saves.map((s) => ({ postId: s.postId, at: iso(s.createdAt) })),
    storyReactions: others.flatMap((s) => s.reactions.filter((r) => r.userId === userId).map((r) => ({ storyId: s.id, reactionId: r.reactionId, at: iso(r.at) }))),
    storyViews: others.flatMap((s) => s.views.filter((v) => v.userId === userId).map((v) => ({ storyId: s.id, at: iso(v.at) }))),
  };
}

export interface ErasureReport {
  fieldAtlasRecords: number;
  /** Personal places and collections, in every event. */
  placeRecords: number;
  customMapRecords: number;
  /** Plan, AV signals, live questions and votes, Plan B seat holds. */
  companionRecords: number;
  /** Own stories (with their files), highlights and saves. */
  momentsRecords: number;
  /** The person's views and reactions removed from other people's stories. */
  storyInteractions: number;
  /** Notifications addressed to the person. They used to be left behind. */
  notifications: number;
  /** Notes the person wrote on payments they made. The payment record is kept for accountability. */
  paymentNotesRedacted: number;
  follows: number;
  deviceKeys: number;
  privateMessages: number;
  messagesRedacted: number;
  reportsRedacted: number;
  /** Privacy filter switches and the alerts the person received; alerts they sent lose their name. */
  privacyFilterRecords: number;
  /** Kingdom citizenship, wishes and chronicle entries; a kingdom the person founded goes with its contents. */
  kingdomRecords: number;
}

/**
 * Field Atlas: the person's attempts (which hold their evidence), XP entries and badges are deleted.
 * Organiser flags about them keep the flag but lose the link to the person. Nothing is erased from
 * the ledger of other people. Returns how many records were removed.
 */
async function eraseFieldAtlas(ctx: ServiceContext, userId: string, eventIds: string[]): Promise<number> {
  let removed = 0;
  for (const eventId of eventIds) {
    for (const a of await ctx.store.docList('fieldAttempts', { eventId, userId })) {
      await ctx.store.docDelete('fieldAttempts', a.id);
      removed += 1;
    }
    for (const e of await ctx.store.docList('fieldLedger', { eventId, userId })) {
      await ctx.store.docDelete('fieldLedger', e.id);
      removed += 1;
    }
    for (const b of await ctx.store.docList('fieldBadges', { eventId, userId })) {
      await ctx.store.docDelete('fieldBadges', b.id);
      removed += 1;
    }
    for (const f of await ctx.store.docList('fieldFlags', { eventId, userId })) {
      await ctx.store.docMutate('fieldFlags', f.id, (x) => ({ ...x, userId: null, detail: ERASED_TEXT }));
      removed += 1;
    }
  }
  return removed;
}

/**
 * Moments: own stories (with their files), highlights and saves are deleted, and the person's views and
 * reactions are taken off everyone else's stories, so no story's viewer list still names them.
 */
async function eraseMoments(ctx: ServiceContext, userId: string, eventIds: string[]): Promise<{ records: number; interactions: number }> {
  let records = 0;
  let interactions = 0;
  for (const h of await ctx.store.docList('storyHighlights', { ownerId: userId })) {
    await ctx.store.docDelete('storyHighlights', h.id);
    records += 1;
  }
  for (const s of await ctx.store.docList('stories', { authorId: userId })) {
    await deleteStory(ctx, s);
    records += 1;
  }
  for (const s of await ctx.store.docList('savedPosts', { userId })) {
    await ctx.store.docDelete('savedPosts', s.id);
    records += 1;
  }
  for (const eventId of eventIds) {
    for (const s of await ctx.store.docList('stories', { eventId })) {
      const count = s.views.filter((v) => v.userId === userId).length + s.reactions.filter((r) => r.userId === userId).length;
      if (count === 0) continue;
      await ctx.store.docMutate('stories', s.id, (x) => ({ ...x, views: x.views.filter((v) => v.userId !== userId), reactions: x.reactions.filter((r) => r.userId !== userId) }));
      interactions += count;
    }
  }
  return { records, interactions };
}

export async function eraseMe(ctx: ServiceContext, userId: string): Promise<ErasureReport> {
  const user = await ctx.store.getUser(userId);
  if (!user) throw new DomainError('NOT_FOUND', 'No account found.');
  const eventIds = await eventsOf(ctx, userId);
  await ctx.store.deleteProfile(userId);
  // Before the media sweep below: a story's file is deleted with the story.
  const moments = await eraseMoments(ctx, userId, eventIds);
  // The Twitch token lives only in server memory; erasure drops it with the connection.
  disconnectTwitch(userId);
  const privacy = await erasePrivacyFilter(ctx, userId);
  const report: ErasureReport = {
    privacyFilterRecords: privacy.settings + privacy.alerts + privacy.unlinked,
    kingdomRecords: await eraseKingdoms(ctx, userId, eventIds),
    fieldAtlasRecords: await eraseFieldAtlas(ctx, userId, eventIds),
    placeRecords: await erasePlaces(ctx, userId),
    customMapRecords: await eraseCustomMaps(ctx, userId),
    companionRecords: await eraseCompanion(ctx, userId),
    momentsRecords: moments.records,
    storyInteractions: moments.interactions,
    notifications: await ctx.store.deleteNotificationsFor(userId),
    paymentNotesRedacted: await ctx.store.redactPaymentNotesFrom(userId, ERASED_TEXT),
    follows: await ctx.store.removeAllFollows(userId),
    deviceKeys: await ctx.store.deleteKeyBundles(userId),
    privateMessages: await ctx.store.deleteSealedInvolving(userId),
    messagesRedacted: await ctx.store.redactMessagesFrom(userId, ERASED_TEXT),
    reportsRedacted: await ctx.store.redactReportsFrom(userId, ERASED_TEXT),
  };
  // Everything the person published or switched on: posts (with their media and comments), comments
  // elsewhere, likes, communities, live location, access tokens, country, sessions and the sign-in account.
  for (const post of await ctx.store.docList('posts', { authorId: userId })) await deletePost(ctx, post);
  for (const c of await ctx.store.docList('comments', { authorId: userId })) await ctx.store.docDelete('comments', c.id);
  for (const m of await ctx.store.docList('media', { ownerId: userId })) {
    await ctx.store.docDelete('media', m.id);
    await ctx.store.blobDelete(m.id);
  }
  for (const eventId of eventIds) {
    for (const p of await ctx.store.docList('posts', { eventId })) {
      if (p.likes.includes(userId)) await ctx.store.docMutate('posts', p.id, (x) => ({ ...x, likes: x.likes.filter((u) => u !== userId) }));
      // A vote on someone else's poll is removed too; the poll keeps its other votes.
      if (p.poll && p.poll.votes[userId] !== undefined) {
        await ctx.store.docMutate('posts', p.id, (x) => {
          if (!x.poll) return null;
          const votes = Object.fromEntries(Object.entries(x.poll.votes).filter(([voter]) => voter !== userId));
          return { ...x, poll: { ...x.poll, votes } };
        });
      }
    }
    for (const c of await ctx.store.docList('communities', { eventId })) {
      if (c.ownerId === userId) {
        for (const post of await ctx.store.docList('posts', { communityId: c.id })) await deletePost(ctx, post);
        await ctx.store.docDelete('communities', c.id);
      } else if (c.memberIds.includes(userId)) {
        await ctx.store.docMutate('communities', c.id, (x) => ({ ...x, memberIds: x.memberIds.filter((u) => u !== userId) }));
      }
    }
  }
  for (const l of await ctx.store.docList('locations', { userId })) await ctx.store.docDelete('locations', l.id);
  for (const t of await ctx.store.docList('apiTokens', { userId })) await ctx.store.docDelete('apiTokens', t.id);
  // Chat gateway: linked accounts, unused link codes, queued deliveries and the record of handled messages.
  for (const l of await ctx.store.docList('chatLinks', { userId })) await ctx.store.docDelete('chatLinks', l.id);
  for (const c of await ctx.store.docList('chatLinkCodes', { userId })) await ctx.store.docDelete('chatLinkCodes', c.id);
  for (const d of await ctx.store.docList('chatDeliveries', { recipientUserId: userId })) await ctx.store.docDelete('chatDeliveries', d.id);
  for (const i of await ctx.store.docList('chatInbound', { userId })) await ctx.store.docDelete('chatInbound', i.id);
  for (const a of await ctx.store.docList('accounts', { userId })) await ctx.store.docDelete('accounts', a.id);
  await ctx.store.docDelete('prefs', userId);
  await endAllSessions(ctx, userId);
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
      `Erased on request: ${report.fieldAtlasRecords} Field Atlas records, ${report.kingdomRecords} Kingdom records, ${report.momentsRecords} Moments records (stories, highlights, saves), ${report.storyInteractions} story views and reactions, ${report.notifications} notifications, ${report.follows} follows, ${report.deviceKeys} keys, ${report.privateMessages} private messages; ${report.messagesRedacted} messages, ${report.reportsRedacted} reports and ${report.paymentNotesRedacted} payment notes redacted.`,
    );
  }
  return report;
}
