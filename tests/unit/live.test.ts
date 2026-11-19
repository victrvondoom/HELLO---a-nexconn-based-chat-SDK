import { describe, expect, it } from 'vitest';
import { EVERYONE, LiveBus, people, visibleTo, type LiveEvent } from '@/lib/live/bus';
import { describeWrite } from '@/lib/live/store';
import { PresenceRegistry, REMOTE_TTL_MS } from '@/lib/live/presence';
import { topicMatches } from '@/components/live/stream';
import { topicsForApi, topicsForPage } from '@/components/live/topics';

const ev = (partial: Partial<LiveEvent>): LiveEvent => ({ eventId: 'evt-1', topic: 't', audience: EVERYONE, at: 1, ...partial });
const attendee = { eventId: 'evt-1', userId: 'u-ada', staff: false };
const staffer = { eventId: 'evt-1', userId: 'u-kiri', staff: true };

describe('who receives a live event', () => {
  it('delivers event-wide changes to every member of that event only', () => {
    expect(visibleTo(ev({}), attendee)).toBe(true);
    expect(visibleTo(ev({ eventId: 'evt-2' }), attendee)).toBe(false);
    // A global record (null event) reaches members of any event.
    expect(visibleTo(ev({ eventId: null }), attendee)).toBe(true);
  });

  it('delivers personal changes to the people named, and staff changes to staff', () => {
    expect(visibleTo(ev({ audience: people(['u-ada'], false) }), attendee)).toBe(true);
    expect(visibleTo(ev({ audience: people(['u-ben'], false) }), attendee)).toBe(false);
    expect(visibleTo(ev({ audience: people(['u-ben'], false) }), staffer)).toBe(false);
    expect(visibleTo(ev({ audience: people([], true) }), staffer)).toBe(true);
    expect(visibleTo(ev({ audience: people([], true) }), attendee)).toBe(false);
  });
});

describe('which writes publish what', () => {
  it('tells only the recipient about a new notification, and nothing about a duplicate', () => {
    const n = { id: 'n1', eventId: 'evt-1', recipientUserId: 'u-ada', kind: 'X', body: 'secret body', href: '/', dedupeKey: 'k', createdAt: 1, readAt: null };
    const [draft] = describeWrite('insertNotificationIfNew', [n], true);
    expect(draft).toEqual({ eventId: 'evt-1', topic: 'notifications', audience: { kind: 'PEOPLE', userIds: ['u-ada'], staff: false } });
    expect(JSON.stringify(draft)).not.toContain('secret body');
    expect(describeWrite('insertNotificationIfNew', [n], false)).toEqual([]);
  });

  it('tells staff and the people involved about an incident, not other attendees', () => {
    const incident = { id: 'i1', eventId: 'evt-1', createdByUserId: 'u-ada', assigneeUserId: 'u-kiri', title: 'Projector fault' };
    const [draft, conditions] = describeWrite('updateIncident', ['i1', 1, {}, 2], { ...incident, roomId: 'r-3' });
    expect(draft?.audience).toEqual({ kind: 'PEOPLE', userIds: ['u-ada', 'u-kiri'], staff: true });
    // The public room summary changes, so everyone gets a nudge with no detail at all.
    expect(conditions).toEqual({ eventId: 'evt-1', topic: 'conditions', audience: EVERYONE });
    expect(describeWrite('updateIncident', ['i1', 1, {}, 2], { ...incident, roomId: null })).toHaveLength(1);
    if (!draft) throw new Error('expected an event');
    expect(visibleTo({ ...draft, at: 1 }, { eventId: 'evt-1', userId: 'u-ben', staff: false })).toBe(false);
  });

  it('keeps personal mission records to their owner and staff, and public records public', () => {
    expect(describeWrite('docPut', ['fieldAttempts', { id: 'a', eventId: 'evt-1', userId: 'u-ada' }], undefined)[0]?.audience).toEqual({ kind: 'PEOPLE', userIds: ['u-ada'], staff: true });
    expect(describeWrite('docPut', ['posts', { id: 'p', eventId: 'evt-1' }], undefined)[0]?.audience).toEqual(EVERYONE);
    expect(describeWrite('docPutIfAbsent', ['posts', { id: 'p', eventId: 'evt-1' }], false)).toEqual([]);
  });

  it('never publishes sign-in records, tokens or reads', () => {
    expect(describeWrite('docPut', ['authSessions', { id: 's', userId: 'u-ada' }], undefined)).toEqual([]);
    expect(describeWrite('docPut', ['apiTokens', { id: 't', userId: 'u-ada' }], undefined)).toEqual([]);
    expect(describeWrite('docPut', ['accounts', { id: 'ada', userId: 'u-ada' }], undefined)).toEqual([]);
    expect(describeWrite('getIncident', ['i1'], {})).toEqual([]);
  });

  it('tells only the two people in a private thread about a new sealed message', () => {
    const [draft] = describeWrite('insertSealedMessage', [{ id: 'dm1', senderId: 'u-ada', recipientId: 'u-ines', ciphertext: 'xyz' }], undefined);
    expect(draft?.audience).toEqual({ kind: 'PEOPLE', userIds: ['u-ada', 'u-ines'], staff: false });
    expect(JSON.stringify(draft)).not.toContain('xyz');
  });
});

describe('live bus', () => {
  it('delivers locally, sends its own events to other instances, and ignores them coming back', () => {
    const bus = new LiveBus();
    const got: string[] = [];
    const sent: LiveEvent[] = [];
    bus.subscribe((e) => got.push(e.topic));
    bus.attachRemote({ send: (e) => sent.push(e) });
    bus.publish(ev({ topic: 'posts' }));
    expect(got).toEqual(['posts']);
    expect(sent).toHaveLength(1);
    const echo = sent[0];
    if (!echo) throw new Error('expected a sent event');
    bus.receiveRemote(echo);
    expect(got).toEqual(['posts']);
    bus.receiveRemote({ ...ev({ topic: 'games' }), origin: 'other-instance' });
    expect(got).toEqual(['posts', 'games']);
  });

  it('keeps delivering when one subscriber throws', () => {
    const bus = new LiveBus();
    const got: string[] = [];
    bus.subscribe(() => {
      throw new Error('closed stream');
    });
    bus.subscribe((e) => got.push(e.topic));
    bus.publish(ev({ topic: 'calls' }));
    expect(got).toEqual(['calls']);
  });
});

describe('presence', () => {
  it('counts a person online while any of their streams is open', () => {
    const p = new PresenceRegistry();
    const tab1 = p.join('evt-1', 'u-ada');
    const tab2 = p.join('evt-1', 'u-ada');
    expect(tab1.changed).toBe(true);
    expect(tab2.changed).toBe(false);
    expect(p.online('evt-1', 0)).toEqual(new Set(['u-ada']));
    expect(tab1.leave()).toBe(false);
    expect(tab1.leave()).toBe(false); // leaving twice counts once
    expect(tab2.leave()).toBe(true);
    expect(p.online('evt-1', 0).size).toBe(0);
  });

  it('merges reports from other instances and forgets an instance that stops reporting', () => {
    const p = new PresenceRegistry();
    expect(p.applyRemote('i-2', 'evt-1', 1000, ['u-ben'])).toBe(true);
    expect(p.applyRemote('i-2', 'evt-1', 1000, ['u-chloe'])).toBe(true); // a second chunk of the same report
    expect(p.online('evt-1', 2000)).toEqual(new Set(['u-ben', 'u-chloe']));
    expect(p.applyRemote('i-2', 'evt-1', 500, ['u-old'])).toBe(false); // an older report is ignored
    expect(p.applyRemote('i-2', 'evt-1', 3000, ['u-ben'])).toBe(true); // a newer report replaces it
    expect(p.online('evt-1', 3000)).toEqual(new Set(['u-ben']));
    expect(p.online('evt-1', 3000 + REMOTE_TTL_MS + 1).size).toBe(0);
  });
});

describe('views and their topics', () => {
  it('matches exact, prefix and wildcard topics', () => {
    expect(topicMatches(['field*'], 'fieldAttempts')).toBe(true);
    expect(topicMatches(['posts'], 'post')).toBe(false);
    expect(topicMatches(['*'], 'anything')).toBe(true);
  });

  it('recognises views from the URLs they already use', () => {
    expect(topicsForApi('/api/events/evt-1/games/game-2')).toEqual({ eventId: 'evt-1', topics: ['games'] });
    expect(topicsForApi('/api/events/evt-1/feed?scope=all').topics).toContain('posts');
    expect(topicsForApi('/api/me/tokens')).toEqual({ eventId: null, topics: [] });
    expect(topicsForPage('/events/evt-1/incidents/inc-1').topics).toContain('incidents');
    expect(topicsForPage('/events/evt-1').topics).toEqual(['*']);
  });
});
