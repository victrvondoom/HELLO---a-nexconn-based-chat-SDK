import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { roleHasCapability } from '../domain/permissions';
import { CATEGORY_LABEL, STATUS_LABEL } from '../domain/labels';
import { queryTerms, scoreFields, snippet, type SearchField } from '../domain/search';
import { requireCapability, type ServiceContext } from './context';
import { incidentHref, listIncidentsForViewer } from './incidents';

/**
 * Search across the event: people, sessions, rooms, requests, missions, communities, posts, guide pages,
 * announcements and the viewer's own conversation with HELLO.
 *
 * Every kind of record is filtered by the same rule the page that shows it uses, before it is scored:
 * - people: only those who are discoverable, or who follow the viewer (as on profiles);
 * - requests (incidents): staff see all, attendees only those they reported;
 * - guide pages written for staff: staff only;
 * - conversation messages: the viewer's own, or all for staff (as on the conversation page);
 * - missions: published only. Private messages are end-to-end encrypted and are never searched.
 * A search therefore never reveals that a hidden record exists.
 */

export const SearchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });

export type SearchKind = 'person' | 'session' | 'room' | 'request' | 'mission' | 'community' | 'post' | 'guide' | 'announcement' | 'messages';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  detail: string;
  href: string;
  score: number;
}

const PER_KIND = 5;
const TOTAL = 30;

const clock = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

export async function searchEvent(ctx: ServiceContext, eventId: string, userId: string, rawQuery: string): Promise<{ query: string; hits: SearchHit[] }> {
  const parsed = SearchQuerySchema.safeParse({ q: rawQuery });
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Search for 2 to 80 characters.');
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  const staff = roleHasCapability(membership.role, 'incident.read.operational');
  const terms = queryTerms(parsed.data.q);
  const base = `/events/${eventId}`;
  const hits: SearchHit[] = [];

  const consider = (kind: SearchKind, id: string, title: string, detail: string, href: string, fields: SearchField[]) => {
    const score = scoreFields(terms, fields);
    if (score !== null) hits.push({ kind, id, title, detail, href, score });
  };

  const [memberships, followers, rooms, sessions, incidents, missions, communities, posts, docs, announcements, messages] = await Promise.all([
    ctx.store.listMemberships(eventId),
    ctx.store.listFollowers(userId),
    ctx.store.listRooms(eventId),
    ctx.store.listSessions(eventId),
    listIncidentsForViewer(ctx, eventId, userId),
    ctx.store.docList('fieldMissions', { eventId }),
    ctx.store.docList('communities', { eventId }),
    ctx.store.docList('posts', { eventId }),
    ctx.store.listReferenceDocs(eventId),
    ctx.store.listAnnouncements(eventId),
    ctx.store.listMessages(eventId),
  ]);

  const followsMe = new Set(followers.map((f) => f.followerId));
  const names = new Map<string, string>();
  for (const m of memberships) {
    const user = await ctx.store.getUser(m.userId);
    if (!user) continue;
    names.set(user.id, user.displayName);
    if (user.id !== userId && !user.discoverable && !followsMe.has(user.id)) continue;
    consider('person', user.id, user.displayName, user.discoverable ? user.interests.slice(0, 3).join(', ') : '', `${base}/people/${user.id}`, [
      { text: user.displayName, weight: 3 },
      { text: user.discoverable ? user.interests.join(' ') : '', weight: 1 },
    ]);
  }

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  for (const r of rooms) consider('room', r.id, r.name, `${r.zone} zone · ${r.capacity} seats`, `${base}/map?to=${encodeURIComponent(r.id)}`, [{ text: r.name, weight: 3 }, { text: r.zone, weight: 1 }]);
  for (const s of sessions) {
    consider('session', s.id, s.title, `${roomName.get(s.roomId) ?? 'Room to be confirmed'} · ${clock(s.startsAt)}`, `${base}/sessions?current=${encodeURIComponent(s.id)}`, [
      { text: s.title, weight: 3 },
      { text: s.topics.join(' '), weight: 2 },
      { text: roomName.get(s.roomId) ?? '', weight: 1 },
    ]);
  }
  for (const { incident } of incidents) {
    consider('request', incident.id, incident.title, `${STATUS_LABEL[incident.status]} · ${CATEGORY_LABEL[incident.category]}`, incidentHref(eventId, incident.id), [
      { text: incident.title, weight: 3 },
      { text: `${CATEGORY_LABEL[incident.category]} ${STATUS_LABEL[incident.status]} ${incident.equipment.join(' ')}`, weight: 1 },
    ]);
  }
  for (const m of missions.filter((x) => x.status !== 'DRAFT')) {
    consider('mission', m.id, m.title, `${m.xp} XP · Field Atlas`, `${base}/atlas`, [{ text: m.title, weight: 3 }, { text: m.description, weight: 1 }]);
  }
  for (const c of communities) {
    consider('community', c.id, c.name, `${c.memberIds.length} members`, `${base}/communities/${c.id}`, [{ text: c.name, weight: 3 }, { text: c.description, weight: 1 }]);
  }
  for (const p of posts.sort((a, b) => b.createdAt - a.createdAt).slice(0, 400)) {
    if (!p.text) continue;
    consider('post', p.id, `${names.get(p.authorId) ?? 'Someone'}: ${snippet(p.text, terms, 70)}`, snippet(p.text, terms), `${base}/feed`, [
      { text: p.text, weight: 1 },
      { text: names.get(p.authorId) ?? '', weight: 1 },
    ]);
  }
  for (const d of docs.filter((x) => x.audience === 'EVERYONE' || staff)) {
    consider('guide', d.id, d.title, snippet(d.body, terms), `${base}/conversation`, [{ text: d.title, weight: 3 }, { text: d.tags.join(' '), weight: 2 }, { text: d.body, weight: 1 }]);
  }
  for (const a of announcements) {
    consider('announcement', a.id, a.title, snippet(a.body, terms), `${base}/announcements`, [{ text: a.title, weight: 3 }, { text: a.body, weight: 1 }]);
  }

  // The conversation is summarised as one result that opens the conversation filtered to the query.
  const visible = messages.filter((m) => staff || m.senderUserId === userId);
  const matching = visible.filter((m) => scoreFields(terms, [{ text: m.text, weight: 1 }]) !== null);
  if (matching.length > 0) {
    hits.push({
      kind: 'messages',
      id: 'messages',
      title: `${matching.length} message${matching.length === 1 ? '' : 's'} ${staff ? 'to HELLO' : 'you sent HELLO'} mention this`,
      detail: snippet(matching[matching.length - 1]?.text ?? '', terms),
      href: `${base}/conversation?q=${encodeURIComponent(parsed.data.q)}`,
      score: 0.5,
    });
  }

  const perKind = new Map<SearchKind, number>();
  const ranked = hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .filter((h) => {
      const n = (perKind.get(h.kind) ?? 0) + 1;
      perKind.set(h.kind, n);
      return n <= PER_KIND;
    })
    .slice(0, TOTAL);
  return { query: parsed.data.q, hits: ranked };
}
