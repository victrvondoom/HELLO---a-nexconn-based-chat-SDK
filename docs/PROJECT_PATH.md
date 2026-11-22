# HELLO: the clear path

Written for: the owner, and anyone you hand the Next.js work to. No prior knowledge assumed.
Date: 2026-11-22. The live version of the feature list is the page `/guide`; its source is `src/domain/guide/map.ts`.

## 1. What HELLO is, in three sentences

HELLO is one app where people at an event can **share** (posts, stories, reels), **talk** (messages, groups, calls),
**play** (games, missions), **find their way** (schedule, map, live place reports) and where organisers **run the event**
(incidents, approvals, safety holds). It works in a phone browser. The goal you set is a single place with the best
parts of X, YouTube, Instagram and Facebook; section 3 says honestly which parts exist.

## 2. How the code is organised (read this first if you are the developer)

| Layer | Folder | Rule |
|---|---|---|
| Pages | `src/app` | Server components call `loadEventViewer`. Interactive parts are small `'use client'` files. |
| Services | `src/services` | All business rules and permission checks. Pages and API routes only call these. |
| Domain | `src/domain` | Pure rules, no storage, no clock. Unit tested. |
| Store | `src/store` | One contract (`store.ts`), two adapters: memory and Postgres. |
| Styles | `src/styles` | One file per area. A class belongs to one file (a test enforces it). |

Run it: `npm run build`, then `npm start`, open `/guide`, then `/demo`. Checks: `npx vitest run`, `npx tsc --noEmit`,
`npx eslint src tests`. Storage choices are in `docs/database.md`.

## 3. What exists, compared with the apps you named

| You want | In HELLO today | Gap |
|---|---|---|
| X / Threads: posts, likes, reposts, follow, trends, DMs | Posts, comments, likes, reposts, follow, trending tags (3 people minimum), encrypted DMs | Polls, threads, quote posts, long text |
| Instagram: photos, stories, reels, saves, explore | All five, with 24-hour stories and highlights | Filters and editing tools, carousels |
| YouTube: upload, watch, channels, live | Short videos and reels only | Long videos, channel pages, **live streaming**, comments on a watch page |
| Facebook: groups, people, events, messaging | Communities, people, the event itself, calls | Pages for brands, marketplace |
| Streamers | Calls between people | Broadcast to many viewers (needs a media server), tips and subscriptions |

Everything listed as **LIVE** on `/guide` has tests. Nothing was removed in this pass.

## 4. The order to build the rest (each step is small and shippable)

1. **Make it persistent.** Set `DATABASE_URL` to a hosted Postgres, run `npm run test:postgres` against a separate test
   database. Until then every restart erases the data. *Done when:* a post survives a restart on the hosted database.
2. **Commit and review.** About 50 files are uncommitted. Commit by area (domain, services, UI, tests, docs).
3. **Polish the first ten minutes.** Landing → `/guide` → demo → post → report a problem → save a place. Fix whatever a
   new person trips on, one page at a time, with a browser run after each.
4. **Creators.** Long video upload and a watch page; then channel pages. This is the step that makes streamers care.
5. **Live streaming.** Needs a media service (for example LiveKit or Mux) and credentials. The app side is a "go live"
   page, a viewer page and chat. Do not start before step 4 works.
6. **Phone.** Push notifications, then an installable app (PWA first, native iOS and Android later, which needs a Mac for iOS).
7. **Real chat network.** Nexconn, when credentials exist. The stand-in bridge and its tests are already there.

Rule for every step: write the test first, keep `/guide` and this file in sync, never delete a feature.

## 5. About "addictive"

Engagement is welcome; tricks that work against people are not. The app already has honest hooks: stories that expire,
levels and badges, missions, games, a feed that explains its order. Good next hooks that keep trust: streaks that
never punish a missed day, "what's new since you left", and creator analytics. Avoid: infinite autoplay with no stop,
fake urgency, hidden ranking, notification spam. Those lose users after the first week and cause real harm.
Whichever you choose, keep the open feed rules page true.

## 6. Handing it to another developer

Give them: this file, `/guide`, `AGENTS.md`, `docs/database.md`, `docs/INTEGRATION_STATUS.md`. Ask them to start at step 1
in section 4. Every claim of "works" must point to a test or a browser run.
