import type { MemoryHelloStore } from './memory';
import type { Backdrop, Post, PostComment, ReactionId, Story, StoryHighlight } from '../domain/product';
import { STORY_TTL_MS } from '../domain/moments/stories';

/**
 * DEMO SEED for Moments: stories, posts, comments and one highlight. Every word is fictional and written
 * for the demo event (HELLO Global Technology Summit); no real person is quoted. Times are relative to
 * `now` (the demo's 12:00 UTC), so stories are live when the demo starts and expire 24 hours after they
 * were posted, like any other. Ids are fixed (`*-seed-*`) so tests and journeys can refer to them.
 *
 * The user ids are the demo people from seed.ts, written out here so this module does not import it.
 * Hashtags are chosen so #hallwaytrack, #robotics and #satellites are each used by at least three people
 * and trend in Explore. No community is seeded, so every post is in the main feed.
 */

const MIN = 60_000;
const U = {
  ada: 'u-att-ada',
  ben: 'u-att-ben',
  chloe: 'u-att-chloe',
  dev: 'u-att-dev',
  ines: 'u-spk-ines',
  jamal: 'u-vol-jamal',
  kiri: 'u-ops-kiri',
  lena: 'u-ops-lena',
  nadia: 'u-org-nadia',
} as const;

type Seen = { by: string; minutesAgo: number; reaction?: ReactionId };

export async function seedMoments(store: MemoryHelloStore, eventId: string, now: number): Promise<void> {
  const ago = (minutes: number) => now - minutes * MIN;

  const story = (
    id: string,
    authorId: string,
    minutesAgo: number,
    backdrop: Backdrop,
    spaceId: string | null,
    audience: Story['audience'],
    text: string,
    seen: Seen[] = [],
  ): Story => ({
    id,
    eventId,
    authorId,
    kind: 'TEXT',
    text,
    backdrop,
    mediaId: null,
    spaceId,
    audience,
    createdAt: ago(minutesAgo),
    expiresAt: ago(minutesAgo) + STORY_TTL_MS,
    views: seen.map((s) => ({ userId: s.by, at: ago(s.minutesAgo) })),
    reactions: seen.flatMap((s) => (s.reaction ? [{ userId: s.by, reactionId: s.reaction, at: ago(s.minutesAgo) }] : [])),
  });

  const stories: Story[] = [
    story('sty-seed-ines-1', U.ines, 45, 'sun', 'sp-r3', 'EVENT', 'Satellite Power Systems at 13:00 in Room 3. It is nearly full, so the overflow screen in the Atrium carries it too.', [
      { by: U.ada, minutesAgo: 40, reaction: 'fire' },
      { by: U.dev, minutesAgo: 30 },
      { by: U.chloe, minutesAgo: 28, reaction: 'clap' },
    ]),
    story('sty-seed-ines-2', U.ines, 150, 'meadow', 'sp-r3', 'FOLLOWERS', 'Last run-through of the eclipse demo rig. Followers get the slides first.', [{ by: U.dev, minutesAgo: 120, reaction: 'heart' }]),
    story('sty-seed-dev-1', U.dev, 90, 'sky', 'sp-atrium', 'EVENT', 'Ground-station demo in the Atrium all afternoon. Ask me about link budgets.', [
      { by: U.ada, minutesAgo: 80 },
      { by: U.ben, minutesAgo: 60, reaction: 'sprout' },
    ]),
    story('sty-seed-dev-2', U.dev, 110, 'dusk', null, 'FOLLOWERS', 'Missed the keynote? What stuck with me: plan the route, staff the doors, tell people early.'),
    story('sty-seed-ben-1', U.ben, 60, 'night', 'sp-r2', 'EVENT', 'Zero trust for event networks, 14:00 in Room 2. Bring your hardest threat model.', [{ by: U.chloe, minutesAgo: 50 }]),
    story('sty-seed-chloe-1', U.chloe, 120, 'clover', 'sp-r4', 'EVENT', 'Step-free to Room 4: the lift behind registration, then along the gallery. Four minutes from the lobby.', [
      { by: U.ben, minutesAgo: 100, reaction: 'heart' },
      { by: U.ada, minutesAgo: 90 },
    ]),
    story('sty-seed-kiri-1', U.kiri, 20, 'dusk', 'sp-r3', 'EVENT', 'Spare handheld microphone on its way to Room 3.'),
    story('sty-seed-nadia-1', U.nadia, 25, 'sun', 'sp-atrium', 'EVENT', 'Lunch from 12:30 in the Atrium. Vegan, halal and gluten-free counters are labelled.', [{ by: U.ada, minutesAgo: 20, reaction: 'clap' }]),
    story('sty-seed-lena-1', U.lena, 280, 'sky', 'sp-main', 'EVENT', 'Main Hall set for the day: 300 seats, two aisles kept clear for wheelchairs.', [{ by: U.kiri, minutesAgo: 190 }]),
  ];

  const post = (id: string, authorId: string, minutesAgo: number, backdrop: Backdrop | null, text: string, likes: string[] = []): Post => ({
    id,
    eventId,
    authorId,
    communityId: null,
    text,
    mediaId: null,
    mediaKind: null,
    backdrop,
    repostOf: null,
    likes,
    createdAt: ago(minutesAgo),
  });

  const posts: Post[] = [
    post('pst-seed-01', U.ines, 40, 'sun', 'Final rehearsal done. Satellite Power Systems at 13:00 in Room 3: how a small array keeps a cubesat alive through eclipse. #satellites', [U.ada, U.dev, U.chloe]),
    post('pst-seed-02', U.dev, 180, 'sky', 'Our demo ground station heard its first pass at 06:12 this morning. Small dish, big grin. #satellites #groundstation', [U.ada, U.ines]),
    post('pst-seed-03', U.ben, 95, 'night', 'Thought for the zero trust session at 14:00: the badge printer is part of your attack surface. #zerotrust #hallwaytrack', [U.chloe, U.ada]),
    post('pst-seed-04', U.chloe, 75, 'clover', 'The lift behind registration is the quickest way to Room 4. Edge Computing at Scale at 14:00, step-free all the way. #edgecomputing #accessibility', [U.ben, U.ada, U.ines]),
    post('pst-seed-05', U.kiri, 5, 'dusk', 'Robotics in Practice is in the Main Hall at 13:00. Testing the arm demo camera now. #robotics', [U.dev]),
    post('pst-seed-06', U.dev, 20, 'meadow', 'Watching the robotics crew calibrate in the Main Hall. That arm is steadier than my coffee. #robotics #hallwaytrack', [U.ada]),
    post('pst-seed-07', U.ines, 150, 'sun', 'Best conversation so far happened in the coffee queue. Hardware people, find me in the Atrium before 12:45. #hallwaytrack', [U.dev, U.ada, U.ben]),
    post('pst-seed-08', U.ben, 240, null, 'Satellite links need zero trust too: a ground station is just another network edge. #satellites #zerotrust', [U.dev]),
    post('pst-seed-09', U.chloe, 120, 'sky', 'Edge nodes on robots: ask the robotics team how they cope when the network drops. #robotics #edgecomputing', [U.kiri]),
    post('pst-seed-10', U.nadia, 30, 'sun', 'Lunch is from 12:30 in the Atrium. Counters are labelled for vegan, halal and gluten-free. #hallwaytrack', [U.chloe, U.ben]),
    post('pst-seed-11', U.lena, 60, 'night', 'If the room you want is full, the overflow screen in the Atrium streams the Main Hall sessions.'),
    post('pst-seed-12', U.jamal, 230, 'clover', 'Volunteers are at the lobby desk all day. Lost a badge? We can reprint it.', [U.ada]),
  ];

  const comment = (id: string, postId: string, authorId: string, minutesAgo: number, text: string): PostComment => ({ id, eventId, postId, authorId, text, createdAt: ago(minutesAgo) });
  const comments: PostComment[] = [
    comment('cmt-seed-01', 'pst-seed-01', U.ada, 35, 'Saving a seat near the front.'),
    comment('cmt-seed-02', 'pst-seed-01', U.dev, 30, 'Will you share the slides afterwards?'),
    comment('cmt-seed-03', 'pst-seed-02', U.ines, 170, 'Lovely clean signal.'),
    comment('cmt-seed-04', 'pst-seed-03', U.chloe, 90, 'And the charging lockers?'),
    comment('cmt-seed-05', 'pst-seed-04', U.ben, 70, 'Thanks, that saved me a hunt for the stairs.'),
    comment('cmt-seed-06', 'pst-seed-06', U.kiri, 15, 'Come and say hello after the session.'),
    comment('cmt-seed-07', 'pst-seed-08', U.dev, 230, 'Agreed. Our station sits behind its own gateway.'),
  ];

  const highlight: StoryHighlight = {
    id: 'hlt-seed-ines',
    eventId,
    ownerId: U.ines,
    title: 'Talk day',
    storyIds: ['sty-seed-ines-2', 'sty-seed-ines-1'],
    createdAt: ago(10),
    updatedAt: ago(10),
  };

  for (const s of stories) await store.docPut('stories', s);
  for (const p of posts) await store.docPut('posts', p);
  for (const c of comments) await store.docPut('comments', c);
  await store.docPut('storyHighlights', highlight);
}
