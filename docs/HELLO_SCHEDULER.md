# Scheduler: personal plan, Plan B (Capy), seat holds, reconciliation (2026-11-22)

## Personal plan (built)

`plans/{eventId:userId}`: the sessions a person chose and whether they asked for step-free routes. Private.
Add from Explore, the live room or Today. Today shows the next planned session.

## Plan B (built, verified)

`rankPlanB` (`src/domain/companion/planb.ts`) is pure. Hard filters, never broken: ended, starts more than 90
minutes out, closed by staff, no verified free seats, not step-free when asked, clashes with another planned
session, no route, already running and unreachable within its first 15 minutes. Then a weighted score: topic
0.4, starting soon 0.2, free seats 0.2, walking time 0.2. Walking minutes come from the venue graph
(`findRoute`, step-free when asked). Every option carries plain reasons ("Shares robotics · Starts in 6 min · 3
min walk, step-free · 18 verified seats free").

## Seat holds (built, verified)

`seatLedgers/{sessionId}` holds `userId → expiry`. `holdSeat` prunes expired holds and checks
`capacity − enrolled − active holds > 0` inside one conditional `docMutate`, so concurrent requests cannot
over-allocate: in the test, 10 people race for 3 free seats and exactly 3 succeed. A hold lasts 10 minutes and
shows as held only after the server answers. Staff can mark a room full; its door display shows a QR code that
opens Today with `?planb=<session>`, i.e. each person's own alternatives with "Hold my seat".

## Reconciliation (partial)

Built: when an organiser approves a Steadfast change, the sessions move and exactly the people concerned are
notified (speakers, attendees with the session in their plan or a held seat, staff); Today shows the change.
Planned (Grace Period): ingesting an official schedule feed (iCal/JSON/CSV with ETag) every two minutes into
versioned snapshots, a diff against each plan, and Plan B for plans that no longer fit.

Tests: `tests/integration/live-room.test.ts` (Test F), `tests/integration/resilience.test.ts`.
