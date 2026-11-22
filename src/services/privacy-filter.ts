import { authorize } from '../domain/permissions';
import { DomainError } from '../domain/errors';
import type { PrivacyAlert, PrivacyFilterRecord } from '../domain/product';
import { DEFAULT_PRIVACY_FILTER, type PrivacyFilterSettings } from '../domain/privacy-filter/settings';
import { uploadPrivacyRefusal, type UploadPrivacy } from '../domain/privacy-filter/upload';
import { audit, notify, requireCapability, type ServiceContext } from './context';

/**
 * Privacy filter, server side (integrated from Offleak, AGPL-3.0; see docs/UPSTREAM_INTEGRATION_AUDIT.md).
 *
 * The filter itself runs in the person's browser, before a frame leaves the device: HELLO's server never receives
 * camera frames, and never receives face pictures or face embeddings either. What the server keeps is:
 *
 * - the person's switches (on/off, fps, lookahead, faces / people from behind / QR codes / phone numbers / screens,
 *   and the redaction effect), one record per person;
 * - privacy alerts: "check your frame", raised by a call's host or by event staff who can place safety holds, or by
 *   `!privacy` from the broadcaster or a moderator in the person's own Twitch chat. Only the recipient sees one.
 */

/** Alerts older than this are no longer shown in a call (they stay in the person's notifications). */
export const ALERT_SHOW_MS = 10 * 60 * 1000;
export const ALERT_SENDER_FALLBACK = 'A former participant';

function settingsOf(record: PrivacyFilterRecord | null): PrivacyFilterSettings {
  if (!record) return { ...DEFAULT_PRIVACY_FILTER };
  return {
    enabled: record.enabled,
    fps: record.fps,
    delay: record.delay,
    faceEnabled: record.faceEnabled,
    peopleEnabled: record.peopleEnabled ?? DEFAULT_PRIVACY_FILTER.peopleEnabled,
    qrEnabled: record.qrEnabled,
    phoneEnabled: record.phoneEnabled,
    screensEnabled: record.screensEnabled ?? DEFAULT_PRIVACY_FILTER.screensEnabled,
    effect: record.effect ?? DEFAULT_PRIVACY_FILTER.effect,
  };
}

export async function getPrivacyFilter(ctx: ServiceContext, eventId: string, userId: string): Promise<PrivacyFilterSettings & { updatedAt: number | null }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const record = await ctx.store.docGet('privacyFilters', userId);
  return { ...settingsOf(record), updatedAt: record?.updatedAt ?? null };
}

/** `patch` has already passed PrivacyFilterPatchSchema. The write is a read-modify-write, so two tabs cannot lose a change. */
export async function updatePrivacyFilter(ctx: ServiceContext, eventId: string, userId: string, patch: Partial<PrivacyFilterSettings>): Promise<PrivacyFilterSettings & { updatedAt: number }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const now = ctx.now();
  const fresh: PrivacyFilterRecord = { id: userId, userId, ...DEFAULT_PRIVACY_FILTER, ...patch, updatedAt: now };
  const created = await ctx.store.docPutIfAbsent('privacyFilters', fresh);
  const saved = created ? fresh : await ctx.store.docMutate('privacyFilters', userId, (doc) => ({ ...doc, ...patch, id: userId, userId, updatedAt: now }));
  if (!saved) throw new DomainError('NOT_FOUND', 'Your privacy filter settings could not be saved. Try again.');
  return { ...settingsOf(saved), updatedAt: saved.updatedAt };
}

/**
 * Refuses a media upload that did not come through the privacy filter while the uploader has it switched on (see
 * src/domain/privacy-filter/upload.ts). Called before a byte of the file is read.
 */
export async function assertUploadPrivacy(ctx: ServiceContext, userId: string, declared: UploadPrivacy | null): Promise<void> {
  const record = await ctx.store.docGet('privacyFilters', userId);
  const refusal = uploadPrivacyRefusal(record?.enabled ?? false, declared);
  if (refusal) throw new DomainError('INELIGIBLE', refusal);
}

/** Whether this person may raise privacy alerts in this call: its host, or staff who can place safety holds. */
export async function canAlertInCall(ctx: ServiceContext, eventId: string, userId: string, hostId: string): Promise<boolean> {
  if (hostId === userId) return true;
  const membership = await ctx.store.findMembership(eventId, userId);
  return authorize(membership, 'safety.hold', eventId).allowed;
}

async function deliver(ctx: ServiceContext, alert: PrivacyAlert, href: string): Promise<void> {
  await ctx.store.docPut('privacyAlerts', alert);
  const where = alert.source === 'TWITCH' ? 'in your Twitch chat' : 'in your call';
  await notify(ctx, {
    eventId: alert.eventId,
    recipientUserId: alert.recipientUserId,
    kind: 'PRIVACY_ALERT',
    body: `Privacy alert from ${alert.senderName} ${where}: check what your camera shows.`,
    href,
    dedupeParts: [alert.id],
  });
}

/**
 * Raise a privacy alert in a call, for one person (`toPeerId`) or for everyone else in it (null). The sender must
 * be in the call and be its host or event staff with `safety.hold`. Returns how many people were alerted.
 */
export async function raiseCallPrivacyAlert(ctx: ServiceContext, eventId: string, userId: string, callId: string, fromPeerId: string, toPeerId: string | null): Promise<{ alerted: number }> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const call = await ctx.store.docGet('calls', callId);
  if (!call || call.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That call does not exist.');
  if (call.endedAt !== null) throw new DomainError('INVALID_TRANSITION', 'This call has ended.');
  if (!call.participants.some((p) => p.peerId === fromPeerId && p.userId === userId)) throw new DomainError('FORBIDDEN', 'You are not in this call.');
  if (!(await canAlertInCall(ctx, eventId, userId, call.hostId))) {
    throw new DomainError('FORBIDDEN', 'Only the person who started the call, or event staff, can send a privacy alert.');
  }
  const targets = call.participants.filter((p) => p.userId !== userId && (toPeerId === null || p.peerId === toPeerId));
  if (toPeerId !== null && !targets.length) throw new DomainError('NOT_FOUND', 'That person is no longer in the call.');
  const sender = await ctx.store.getUser(userId);
  const now = ctx.now();
  const recipients = [...new Set(targets.map((t) => t.userId))];
  for (const recipientUserId of recipients) {
    const alert: PrivacyAlert = {
      id: ctx.newId('pfa'),
      eventId,
      recipientUserId,
      senderUserId: userId,
      senderName: sender?.displayName ?? 'Someone',
      source: 'CALL',
      callId,
      createdAt: now,
      acknowledgedAt: null,
    };
    await deliver(ctx, alert, `/events/${eventId}/calls/${callId}`);
  }
  if (recipients.length) await audit(ctx, eventId, userId, 'privacy.alert', 'call', callId, `Privacy alert sent to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}.`);
  return { alerted: recipients.length };
}

/** Called by the Twitch monitor when the broadcaster or a moderator types `!privacy`. */
export async function raiseTwitchPrivacyAlert(ctx: ServiceContext, eventId: string, userId: string, sender: string): Promise<PrivacyAlert> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const alert: PrivacyAlert = {
    id: ctx.newId('pfa'),
    eventId,
    recipientUserId: userId,
    senderUserId: null,
    senderName: sender.slice(0, 40) || 'Moderator',
    source: 'TWITCH',
    callId: null,
    createdAt: ctx.now(),
    acknowledgedAt: null,
  };
  await deliver(ctx, alert, `/events/${eventId}/privacy-filter`);
  return alert;
}

export interface AlertView {
  id: string;
  from: string;
  source: PrivacyAlert['source'];
  callId: string | null;
  at: number;
  acknowledged: boolean;
}

const view = (a: PrivacyAlert): AlertView => ({ id: a.id, from: a.senderName, source: a.source, callId: a.callId, at: a.createdAt, acknowledged: a.acknowledgedAt !== null });

/** The caller's own alerts in this event, newest first. */
export async function listPrivacyAlerts(ctx: ServiceContext, eventId: string, userId: string): Promise<AlertView[]> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const mine = await ctx.store.docList('privacyAlerts', { eventId, recipientUserId: userId });
  return mine.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, 50).map(view);
}

/** Unacknowledged, recent alerts for the caller in one call (delivered with each call poll). */
export async function callAlertsFor(ctx: ServiceContext, eventId: string, userId: string, callId: string): Promise<AlertView[]> {
  const now = ctx.now();
  const mine = await ctx.store.docList('privacyAlerts', { eventId, recipientUserId: userId, callId });
  return mine.filter((a) => a.acknowledgedAt === null && now - a.createdAt <= ALERT_SHOW_MS).sort((a, b) => a.createdAt - b.createdAt).map(view);
}

export async function acknowledgePrivacyAlert(ctx: ServiceContext, eventId: string, userId: string, alertId: string): Promise<AlertView> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const alert = await ctx.store.docGet('privacyAlerts', alertId);
  // Someone else's alert is reported as missing, so its existence is not revealed.
  if (!alert || alert.eventId !== eventId || alert.recipientUserId !== userId) throw new DomainError('NOT_FOUND', 'That alert does not exist.');
  const now = ctx.now();
  const saved = await ctx.store.docMutate('privacyAlerts', alertId, (a) => (a.acknowledgedAt === null ? { ...a, acknowledgedAt: now } : null));
  return view(saved ?? alert);
}

/** Data export: the person's switches and the alerts they received. */
export async function exportPrivacyFilter(ctx: ServiceContext, userId: string) {
  const record = await ctx.store.docGet('privacyFilters', userId);
  const alerts = await ctx.store.docList('privacyAlerts', { recipientUserId: userId });
  return {
    settings: record ? { ...settingsOf(record), updatedAt: new Date(record.updatedAt).toISOString() } : null,
    peopleKeptVisible: 'Stored only in your browser on each device you used; never sent to HELLO. Remove them from the privacy filter page.',
    alertsReceived: alerts.map((a) => ({ from: a.senderName, source: a.source, at: new Date(a.createdAt).toISOString(), acknowledged: a.acknowledgedAt !== null })),
  };
}

/** Erasure: deletes the person's switches and received alerts; alerts they sent keep the recipient's record but lose the sender. */
export async function erasePrivacyFilter(ctx: ServiceContext, userId: string): Promise<{ settings: number; alerts: number; unlinked: number }> {
  const settings = (await ctx.store.docDelete('privacyFilters', userId)) ? 1 : 0;
  let alerts = 0;
  for (const a of await ctx.store.docList('privacyAlerts', { recipientUserId: userId })) {
    if (await ctx.store.docDelete('privacyAlerts', a.id)) alerts += 1;
  }
  let unlinked = 0;
  for (const a of await ctx.store.docList('privacyAlerts', { senderUserId: userId })) {
    await ctx.store.docMutate('privacyAlerts', a.id, (doc) => ({ ...doc, senderUserId: null, senderName: ALERT_SENDER_FALLBACK }));
    unlinked += 1;
  }
  return { settings, alerts, unlinked };
}
