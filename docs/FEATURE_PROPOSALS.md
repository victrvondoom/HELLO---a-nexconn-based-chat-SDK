# Feature proposals: an interconnected HELLO

Status: proposals. Two of them are built and tested (marked **Built**). The rest are designed against the code as it
is today, so each names the records it reads, what it writes, and the rule that keeps it safe. Nothing here is a
static page: every feature is computed from live records and changes when they change.

The thread through all of them: HELLO already has the pieces (incidents, rooms with occupancy, sessions, the venue
graph, workflows, approvals, communities, games, Field Atlas). They mostly do not talk to each other. Each proposal
connects at least three of them.

---

## 1. Field Conditions (**Built**)

Incidents + rooms + sessions + venue map → Field Atlas map, mission panel, field guide, Quest Director.

- Reads: open incidents per room (`isOpen`), occupancy/capacity with its `DataSource`, the session running now.
- Writes: nothing. Computed on every 15-second poll.
- Rule: attendees see a category and a count ("Staff are handling a reported crowding issue here"), never report
  text, titles or incident ids.
- Effect: a room over capacity or with an urgent access issue is ranked lower, cited as `condition:<spaceId>`. A
  step-free search avoids places with an open access incident.

## 2. Season Pulse (**Built**)

Field Atlas attempts + badges → atlas header, mission panel, Quest Director.

- Reads: attempts and season badges across the event.
- Writes: nothing.
- Rule: k-anonymity. Every count below 3 is null and shown as "fewer than 3". There is no per-person leaderboard.
- Effect: "4 verified in the last hour" nudges people toward missions that work right now; many people underway in an
  already busy place lowers its rank, which spreads people out.

## 3. Crowd-balancing missions

Field Conditions + `domain/sessions/recommend.ts` + Quest Director drafting → missions that move people away from a
full room.

- When a space has been AVOID for crowding for 10 minutes, Quest Director drafts "Catch the same topic in Room 4"
  from the alternative session that `recommend.ts` already finds for the sessions page.
- Verified by `CHECK_IN` at the destination station, so it needs a real station and a real move.
- Rule: drafts, never auto-published (XP above the auto-publish cap). The XP is capped per person per day, so moving
  back and forth earns nothing extra. Missions expire when the room drops below 80%.
- Tests: a room crossing 100% produces one draft; a second crossing the same day does not; expiry when it clears.

## 4. Condition-triggered workflows

Field Conditions + workflow canvas (`services/workflows.ts`) + approvals (`services/approvals.ts`).

- A workflow can start on "space turns AVOID" instead of a button. Example: notify the room's zone lead, open the
  existing room-move proposal from `pipeline.ts`, and post a holding announcement for organiser approval.
- Rule: a trigger can only *propose*. Room moves and announcements keep their existing two-person approval. Each
  trigger is debounced per space (one run per 15 minutes) and audited.

## 5. Helper missions for staff and volunteers

Incidents + assignments (`domain/assignments/scoring.ts`) + Field Atlas.

- An open incident that needs hands ("guide people from Room 3 to Room 4") becomes a COORDINATION mission visible
  only to staff, with the incident as its source.
- Verified when the incident reaches CONFIRMED (the reporter or an organiser confirms the fix), not when the helper
  says it is done.
- Rule: the person who reported an incident can never earn XP from it, so reporting stays honest.

## 6. Community seasons

Communities + Field Atlas seasons + the people network.

- A community runs its own monthly challenge with its own badge. Badges appear on the member's profile card in the
  people network, only if the person opts in.
- The pulse is scoped to the community and suppressed below 3, like the event pulse.

## 7. Game-verified missions

Games (`services/games.ts`) + Field Atlas verification.

- A new method, `GAME_RESULT`: approved when a finished game of the named kind includes this person and started after
  the attempt (the same rule shape as `WORKFLOW_RUN`).
- Rule: winning is not required; taking part is. That keeps it a connection mission, not a contest.

## 8. Operations view of the live layer

Field Conditions + Season Pulse + workplace SLA (`services/workplace.ts`) → `/operations`.

- One map for staff: every space's condition, open incidents with their SLA timer, and where missions send people
  next. Staff see incident titles (they already may); attendees never do.
- Rule: read-only; every action goes through the existing incident and approval flows.

## 9. Season forecast for organisers

Season Pulse history + level table → atlas management.

- "At the current rate, about 40% of participants will earn this month's badge." Deterministic: completions per day
  projected to the season's end, labelled as a projection.
- Rule: shown to organisers only, with the formula next to it. No model call.

## 10. Advisories over Nexconn

Field Conditions + `integrations/nexconn`.

- When Nexconn is connected, a person with a started mission in a space that turns AVOID gets one message, sent once
  per mission and space.
- Until Nexconn is connected (see `docs/INTEGRATION_STATUS.md`), it goes to the in-app notification store, which is
  what Field Atlas uses today.

---

### Order

3 and 4 build directly on Field Conditions and close the loop from "the room is full" to "people were offered
somewhere better, and staff were asked to act". 5 and 7 add new verification sources using the same
conditional-approval pattern as today. 6, 8, 9 and 10 are mostly presentation on top of data that already exists.
