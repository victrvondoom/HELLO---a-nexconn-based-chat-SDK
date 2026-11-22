# HELLO product specification (merged, 2026-11-22)

This merges the "Intelligent Conference Companion" brief into the existing HELLO EventOps product. Each item
says what is **built and verified**, **built but externally blocked**, **partial**, or **planned**. Nothing
here is described as production-ready unless a test proves it.

## Positioning

HELLO is one application for physical technology events with two connected sides that share one event model
(the same `Event`, `Room`, `Session`, `Membership` and `Incident` records):

- **The attendee companion**: what is on, what to see, who to meet, the live room, Plan B, care.
- **Event operations**: incidents, rooms and AV, approvals, and Steadfast schedule verification.

Principle: *more useful context from fewer interactions*. The experience is minimal; the depth is underneath.

## Navigation: five destinations at most

`TODAY | EXPLORE | LIVE | PEOPLE` for everyone, plus `OPERATIONS` for organisers, operations staff and crew
(`src/components/layout/nav-model.ts`). The sidebar also carries one invitation, **Enter the Kingdom** (the 3D
world), because the person asked for it to be in the main view. Every older page still exists under
"Everything else", in the command palette (⌘K) and the phone menu, so nothing was removed. Phones get the same
four tabs plus Menu.

| Destination | Route | What it shows | Status |
|---|---|---|---|
| Today | `/events/:id` | Next session in your plan (or picks to start one), Plan B when it is full, schedule changes, later today, people worth meeting, quick help (report, break, help, connections), the Kingdom door | Built, verified |
| Explore | `/events/:id/explore` | One search (sessions, people, rooms, guides, posts…), the programme with add-to-plan, topics, every other tool | Built, verified |
| Live | `/events/:id/now`, `/now/:sessionId` | Rooms running now; the live room: timeline, questions grouped by similarity, can't hear / can't see, room QR | Built, verified. Captions, audio, slides: externally blocked (no media provider) |
| People | `/events/:id/people` | Existing directory, follows, profiles | Built (existing). Kairos layer planned |
| Operations | `/events/:id/operations` | Tabs: Board, Venue and AV (seats, holds, AV signals, mark full), Resilience (Steadfast) | Built, verified |

Sign-in: `/demo` is one button, **Enter HELLO**, with an optional three-way choice (attending, speaking, on the
team) and a folded "Someone specific" list for testers. `/signin` keeps accounts.

## Feature map (from the brief)

| Feature | Where | Status |
|---|---|---|
| Personal plan | Today, Explore, live room (`plans`) | Built, verified |
| Plan B (Capy) with seat holds | Today, room-full QR, Operations venue board | Built, verified (`docs/HELLO_SCHEDULER.md`) |
| Schedule reconciliation (Grace Period) | — | Partial: approved changes reconcile plans and notify exactly the affected people. The two-minute official-feed reconciler is planned |
| Live captions, listen-in audio, slides | Live room | Externally blocked: needs a media/transcription provider; the room says so |
| Jargon coach, knowledge probe, recap | Live room | Planned (needs captions first) |
| AV signals → one incident | Live room → Operations | Built, verified (3 distinct people in 60 s) |
| Questions with similar-question grouping | Live room | Built, verified |
| Care mode ("I need a break"), offline | Today quick help → `/care` | Built; offline cache via `public/sw.js` (production builds) |
| Steadfast | Operations → Resilience | Built, verified (`docs/HELLO_STEADFAST.md`) |
| Kairos networking, relationship memory, follow-ups | People | Planned (`docs/HELLO_NETWORKING_KAIROS.md`) |
| Speed networking, sponsor offers | People | Planned |
| Graph database (FalkorDB/Neo4j) | — | Planned (`docs/HELLO_EVENT_GRAPH.md`) |
| Create a game (own quiz) | Games | Built, verified |
| Workflow canvas: connected graph | Everything else → Workflow canvas | Fixed, verified (every node connected, edges painted) |
| Nexconn Chat SDK, Chat UI, Call SDK | `src/integrations/nexconn` | Installed; token issuance externally blocked (credentials + docs) |
