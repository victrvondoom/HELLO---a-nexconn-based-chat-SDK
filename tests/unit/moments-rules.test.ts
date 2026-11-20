import { describe, expect, it } from 'vitest';
import { extractTags, normaliseTag, trendingTags, TRENDING_MAX } from '@/domain/moments/tags';
import { canSeeStory, orderRings, storyPlayOrder, STORY_TTL_MS } from '@/domain/moments/stories';
import { checkAttachment, isRepeat, paceRetryAfter, POSTING_RULES, ruleMessage, tooLong, tooManyTags, type AttachedMedia } from '@/domain/moments/rules';
import { describeEnvelope, MOMENT_MESSAGE_TYPES, NEXCONN_CHANNEL, postEnvelope, reactionFor, storyEnvelope, storyReplyEnvelope, type MomentEnvelope } from '@/integrations/nexconn/moments';
import { REACTION_IDS, type Post, type Story } from '@/domain/product';

const NOW = Date.UTC(2026, 10, 10, 12, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

const story = (over: Partial<Story> = {}): Story => ({
  id: 'sty-1',
  eventId: 'evt-x',
  authorId: 'u-author',
  kind: 'TEXT',
  text: 'Hello',
  backdrop: 'sky',
  mediaId: null,
  spaceId: 'sp-r3',
  audience: 'EVENT',
  createdAt: NOW,
  expiresAt: NOW + STORY_TTL_MS,
  views: [],
  reactions: [],
  ...over,
});

describe('hashtags', () => {
  it('extracts unique lower-case tags in order, and ignores what is not a tag', () => {
    const text = '#Robotics and #robotics, #hallway_track #a #12 #x9 C#sharp &#39; ##double #ŝtar #toolongtoolongtoolongtoolongtool end';
    expect(extractTags(text)).toEqual(['robotics', 'hallway_track', 'x9', 'ŝtar']);
    expect(extractTags('＃ＲＯＢＯＴＩＣＳ at the summit')).toEqual(['robotics']);
    expect(extractTags('#ab12 #' + 'a'.repeat(30))).toEqual(['ab12', 'a'.repeat(30)]);
    expect(extractTags('no tags here')).toEqual([]);
  });

  it('normalises a tag typed into a search or a link', () => {
    expect(normaliseTag('#Robotics')).toBe('robotics');
    expect(normaliseTag('  hallwaytrack ')).toBe('hallwaytrack');
    expect(normaliseTag('12')).toBeNull();
    expect(normaliseTag('a')).toBeNull();
    expect(normaliseTag('robotics!')).toBeNull();
  });

  it('trends a tag only when three different people used it in the window', () => {
    const p = (authorId: string, text: string, minutesAgo = 10) => ({ authorId, text, createdAt: NOW - minutesAgo * MIN });
    const two = [p('u-a', '#robotics'), p('u-b', '#robotics'), p('u-a', '#robotics again'), p('u-a', '#robotics third')];
    expect(trendingTags(two, NOW)).toEqual([]);
    const three = [...two, p('u-c', 'Me too #Robotics')];
    expect(trendingTags(three, NOW)).toEqual([{ tag: 'robotics', people: 3 }]);
    // Outside the window, or in the future, a post does not count.
    expect(trendingTags([...two, p('u-c', '#robotics', 25 * 60)], NOW)).toEqual([]);
    expect(trendingTags([...two, p('u-c', '#robotics', -5)], NOW)).toEqual([]);
  });

  it('sorts trending tags by people, then name, and keeps at most 12', () => {
    const p = (authorId: string, text: string) => ({ authorId, text, createdAt: NOW - MIN });
    const posts = [p('u-a', '#zeta #beta #alpha'), p('u-b', '#zeta #beta #alpha'), p('u-c', '#zeta #beta #alpha'), p('u-d', '#zeta'), p('u-d', '#zeta')];
    expect(trendingTags(posts, NOW)).toEqual([
      { tag: 'zeta', people: 4 },
      { tag: 'alpha', people: 3 },
      { tag: 'beta', people: 3 },
    ]);
    const many = Array.from({ length: 15 }, (_, i) => `#tag${String.fromCharCode(97 + i)}`).join(' ');
    const lots = ['u-a', 'u-b', 'u-c'].map((authorId) => ({ authorId, text: many, createdAt: NOW }));
    expect(trendingTags(lots, NOW)).toHaveLength(TRENDING_MAX);
  });
});

describe('story visibility and order', () => {
  it('shows a story to its author always, and to others only while live and in its audience', () => {
    const open = story();
    const followers = story({ audience: 'FOLLOWERS' });
    expect(canSeeStory(open, 'u-other', false, NOW)).toBe(true);
    expect(canSeeStory(open, 'u-other', false, open.expiresAt - 1)).toBe(true);
    expect(canSeeStory(open, 'u-other', false, open.expiresAt)).toBe(false);
    expect(canSeeStory(open, 'u-author', false, open.expiresAt + HOUR)).toBe(true);
    expect(canSeeStory(followers, 'u-other', false, NOW)).toBe(false);
    expect(canSeeStory(followers, 'u-other', true, NOW)).toBe(true);
    expect(canSeeStory(followers, 'u-other', true, followers.expiresAt)).toBe(false);
  });

  it('orders rings: yours, unseen, followed, latest, then account id; stories oldest first', () => {
    const ring = (authorId: string, hasUnseen: boolean, followed: boolean, latestAt: number | null) => ({ authorId, hasUnseen, followed, latestAt });
    const rings = [
      ring('u-seen-new', false, true, NOW),
      ring('u-b', true, false, NOW - 10 * MIN),
      ring('u-a', true, false, NOW - 10 * MIN),
      ring('u-me', false, false, null),
      ring('u-followed', true, true, NOW - HOUR),
      ring('u-newest', true, false, NOW),
    ];
    expect(orderRings(rings, 'u-me').map((r) => r.authorId)).toEqual(['u-me', 'u-followed', 'u-newest', 'u-a', 'u-b', 'u-seen-new']);
    const played = storyPlayOrder([story({ id: 'sty-c', createdAt: NOW }), story({ id: 'sty-b', createdAt: NOW - HOUR }), story({ id: 'sty-a', createdAt: NOW })]);
    expect(played.map((s) => s.id)).toEqual(['sty-b', 'sty-a', 'sty-c']);
  });
});

describe('posting rules', () => {
  it('publishes five rules and quotes the broken one, with its id, in every refusal', () => {
    expect(POSTING_RULES.map((r) => r.id)).toEqual(['R1-length', 'R2-tags', 'R3-duplicate', 'R4-pace', 'R5-media']);
    for (const r of POSTING_RULES) expect(ruleMessage(r.id)).toBe(`${r.rule} (rule ${r.id})`);
  });

  it('R1 and R2: length per kind, and at most 10 distinct hashtags', () => {
    expect(tooLong('x'.repeat(1000), 'POST')).toBe(false);
    expect(tooLong('x'.repeat(1001), 'POST')).toBe(true);
    expect(tooLong('x'.repeat(200), 'STORY')).toBe(false);
    expect(tooLong('x'.repeat(201), 'STORY')).toBe(true);
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `#tag${String.fromCharCode(97 + i)}`).join(' ');
    expect(tooManyTags(tags(10))).toBe(false);
    expect(tooManyTags(tags(11))).toBe(true);
    expect(tooManyTags('#same '.repeat(20))).toBe(false);
  });

  it('R3: the same text from the same person within 10 minutes, ignoring case and spacing', () => {
    const recent = [{ text: 'See you at   the Main Hall', createdAt: NOW - 9 * MIN }];
    expect(isRepeat('see you at the main hall ', recent, NOW)).toBe(true);
    expect(isRepeat('See you at the Main Hall', recent, NOW + MIN)).toBe(false);
    expect(isRepeat('Something else', recent, NOW)).toBe(false);
    expect(isRepeat('', [{ text: '', createdAt: NOW }], NOW)).toBe(false);
  });

  it('R4: ten stories an hour, counted over stored stories, with the wait until the next one', () => {
    const times = Array.from({ length: 9 }, (_, i) => NOW - i * 5 * MIN);
    expect(paceRetryAfter(times, NOW)).toBeNull();
    expect(paceRetryAfter([...times, NOW - 50 * MIN], NOW)).toBe(10 * 60);
    expect(paceRetryAfter([...times, NOW - 61 * MIN, NOW - 70 * MIN], NOW)).toBeNull();
  });

  it('R5: only your own file from this event, used once, of the kind the story needs', () => {
    const actor = { eventId: 'evt-x', userId: 'u-me' };
    const media = (over: Partial<AttachedMedia> = {}): AttachedMedia => ({ eventId: 'evt-x', ownerId: 'u-me', kind: 'IMAGE', inUse: false, ...over });
    expect(checkAttachment(null, actor, 'ANY')).toBe('NOT_YOURS');
    expect(checkAttachment(media({ ownerId: 'u-other' }), actor, 'ANY')).toBe('NOT_YOURS');
    expect(checkAttachment(media({ eventId: 'evt-y' }), actor, 'ANY')).toBe('NOT_YOURS');
    expect(checkAttachment(media({ inUse: true }), actor, 'ANY')).toBe('IN_USE');
    expect(checkAttachment(media(), actor, 'VIDEO')).toBe('WRONG_KIND');
    expect(checkAttachment(media({ kind: 'VIDEO' }), actor, 'ANY')).toBe('OK');
    expect(checkAttachment(media(), actor, 'IMAGE')).toBe('OK');
  });
});

describe('Nexconn mapping', () => {
  const stringsOnly = (env: MomentEnvelope) => Object.values(env.metadata).every((v) => typeof v === 'string');
  const post: Post = {
    id: 'pst-1',
    eventId: 'evt-x',
    authorId: 'u-a',
    communityId: null,
    text: 'Robotics at 13:00 #robotics #hallwaytrack',
    mediaId: null,
    mediaKind: null,
    backdrop: 'dusk',
    repostOf: null,
    likes: [],
    createdAt: NOW,
  };

  it('sends a story to the event community sub-channel, asks for read receipts, and keeps metadata as strings', () => {
    const env = storyEnvelope(story());
    expect(env.channel).toEqual({ type: NEXCONN_CHANNEL.COMMUNITY, channelId: 'evt:evt-x', subChannelId: 'stories' });
    expect(env.channel.type).toBe(10);
    expect(env.messageType).toBe('HL:Story');
    expect(env.needReceipt).toBe(true);
    expect(env.metadata).toEqual({ expiresAt: String(NOW + STORY_TTL_MS), audience: 'EVENT', spaceId: 'sp-r3' });
    expect(stringsOnly(env)).toBe(true);
    expect(env.directedUserIds).toBeNull();
    expect(storyEnvelope(story({ spaceId: null })).metadata).not.toHaveProperty('spaceId');
    expect(describeEnvelope(env)).toBe('HL:Story · community evt:evt-x / stories · read receipts');
  });

  it('directs a followers-only story at the followers instead of the whole channel', () => {
    const env = storyEnvelope(story({ audience: 'FOLLOWERS' }), ['u-f1', 'u-f2']);
    expect(env.directedUserIds).toEqual(['u-f1', 'u-f2']);
    expect(storyEnvelope(story({ audience: 'FOLLOWERS' })).directedUserIds).toEqual([]);
    expect(describeEnvelope(env)).toContain('· directed');
  });

  it('sends a post to its community sub-channel or to feed, with string metadata', () => {
    const env = postEnvelope(post);
    expect(env.channel).toEqual({ type: 10, channelId: 'evt:evt-x', subChannelId: 'feed' });
    expect(env.messageType).toBe('HL:Post');
    expect(env.metadata).toEqual({ tags: 'robotics,hallwaytrack', backdrop: 'dusk' });
    expect(stringsOnly(env)).toBe(true);
    const shared = postEnvelope({ ...post, communityId: 'com-1', repostOf: 'pst-0', mediaId: 'med-1', mediaKind: 'IMAGE', backdrop: null, text: '' });
    expect(shared.channel.subChannelId).toBe('community:com-1');
    expect(shared.metadata).toEqual({ repostOf: 'pst-0' });
    expect(shared.content.mediaUrl).toBe('/api/events/evt-x/media/med-1');
    expect(stringsOnly(shared)).toBe(true);
  });

  it('keeps every reaction id within the 16 characters Nexconn allows', () => {
    for (const id of REACTION_IDS) {
      expect(reactionFor(id)).toEqual({ reactionId: id });
      expect(id.length).toBeLessThanOrEqual(16);
    }
  });

  it('maps a story reply to a direct reference message quoting the story', () => {
    const env = storyReplyEnvelope(story(), 'Saving a seat');
    expect(env.channel).toEqual({ type: NEXCONN_CHANNEL.DIRECT, channelId: 'u-author', subChannelId: null });
    expect(env.messageType).toBe('RC:ReferenceMsg');
    expect(env.content).toMatchObject({ text: 'Saving a seat', referMsgId: 'sty-1', referMsgType: 'HL:Story', referMsgSenderId: 'u-author' });
    expect(stringsOnly(env)).toBe(true);
  });

  it('registers both message types as persisted, not counted, with the file URL field', () => {
    expect(MOMENT_MESSAGE_TYPES).toEqual([
      { messageType: 'HL:Story', isPersisted: true, isCounted: false, remoteFileUrlField: 'mediaUrl' },
      { messageType: 'HL:Post', isPersisted: true, isCounted: false, remoteFileUrlField: 'mediaUrl' },
    ]);
  });
});
