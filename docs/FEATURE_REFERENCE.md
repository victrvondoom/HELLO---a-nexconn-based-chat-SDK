# HELLO feature reference

Detailed descriptions of HELLO's established features, moved here from the README on 2026-11-22 when the README was
rewritten around the five-destination companion. Pages that used to be in the sidebar are now under "Everything else",
in the command palette and in the phone menu; their behaviour is unchanged.

## Moments

Instagram-style social features for the people in the same building, built so the ordering is explainable.

- **Stories** (`/feed`): text on six painted backdrops, or a picture or video. Optional place (a room you choose,
  never your location) and audience (everyone at the event, or your followers). Deleted after 24 hours unless kept in
  a highlight; views are recorded once and visible only to the author. Six quick reactions and a private reply.
- **Feed, memoreels, explore, saved** (`/feed`, `/feed/reels`, `/feed/explore`, `/feed/saved`): double-tap to like,
  comments, shares and private saves. The feed ends with "You are all caught up" instead of scrolling forever.
- **Open Feed Charter** (`/feed/charter`, `src/domain/moments/charter.ts`): "For you" is the sum of six announced
  criteria (your fresh post, people you follow, your communities, freshness, distinct commenters, likes by people you
  follow). The ranking function receives only author, time, community, commenters and likers, so it cannot use
  anything else; ties break by time, then id. Unit tests check determinism and that every point comes from an
  announced rule.
- **Posting rules R1–R5** (`src/domain/moments/rules.ts`): length, at most 10 hashtags, no identical text within
  10 minutes, at most 10 stories an hour, your own media only. The server enforces them and names the rule in the error.
- **Built on Nexconn messages** (`src/integrations/nexconn/moments.ts`): stories and posts map to custom message types
  (`HL:Story`, `HL:Post`) on the event's community channel, likes and reactions to message reactions, a story view to a
  read receipt, and a story reply to a reference message. The shapes were checked against `@nexconn/chat@26.5.1`. It is
  a mapping only: Nexconn is not connected in this build.
- **Privacy:** data export includes your stories, highlights, saves and reactions; erasure deletes them and removes
  your views and reactions from other people's stories.

## The problem

Physical events run on disconnected channels: informal messages, several inboxes, volunteers who don't know
what is already being handled, technicians who receive half a description, and attendees who never learn
whether anyone is acting. HELLO's premise is that every important conversation should be able to become an
accountable workflow.

## What it does (implemented)

- **One conversation for every role.** Attendees, speakers, volunteers, operations and organisers use the
  same entry point. What they can see and do depends on their membership.
- **Incident intelligence.** Messages become incidents. A report matching an open incident (same room,
  category, within 30 minutes) is attached to it, with its match confidence and signals. Each person's
  report is kept. Reports are never merged on wording alone.
- **Lifecycle.** REPORTED → TRIAGED → ASSIGNED → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CONFIRMED → CLOSED,
  plus REOPENED, CANCELLED, NEEDS_INFORMATION and ESCALATED. Moves are checked on the server against the
  state machine and against who is making the move.
- **Assignment.** Eligible staff are ranked by skill, workload, availability and location. Each score
  shows its reasons. Claims are version-checked, so two simultaneous claims cannot both succeed.
- **Capacity-aware alternatives.** Sessions that are full, ended, inaccessible (when required) or clash with
  the person's schedule are excluded. Remaining sessions are scored with configurable weights and explained.
- **Approvals.** A consequential change (moving a session to another room) is requested by HELLO only when
  over-capacity is recorded and two or more independent people report it. An organiser must approve it.
  Approval and execution are recorded separately, so an approved move can still fail, and the UI says so.
- **Signal intelligence.** Three or more independent reporters of the same category in one room within ten
  minutes produce a suggested insight. It is built only from stored reports, counts each person once, and
  waits for an organiser's review. Review decisions are not overwritten by later recomputation.
- **People discovery.** Search by declared interest. Only people who opted in appear, the matched interest is shown,
  and no contact details are exposed.
- **Operations view.** Rooms with occupancy and its data source, open incidents, the approval queue and signal review.
- **Honest data labels.** Every occupancy figure states whether it is live verified, administrator entered,
  attendee reported, or demo data.

## Quick navigation and voice input

- **Command palette.** Press **⌘K** (Ctrl+K on Windows and Linux), or click **Search or jump to…** in the top bar, then
  type a page name or a keyword ("feed" finds Moments). It lists only the pages your role can open (an attendee never sees the audit trail), and each page still
  re-checks access on the server. Arrow keys move, Enter opens and Esc closes.
- **Speak instead of typing.** In browsers with speech recognition (Chrome, Edge, Safari), the composer shows a
  microphone button. What you say is added to the message box for you to check before sending; nothing is sent
  automatically. The browser's own speech service does the transcription and may send the audio to its provider. The
  button says so, and the microphone is allowed for HELLO's own pages only (`Permissions-Policy: microphone=(self)`).

## Why HELLO, and what it solves that other event apps don't

Seven hidden problems sit under the usual "chat, schedule and map" event app: the read-and-act paradox
of AI plus encryption, encryption claims nobody can check, social graphs that leak, connections that end
with the event, erasure versus accountability, wayfinding that ignores accessibility, and safety messages
stuck in a queue. Each one, and what HELLO does about it, is in [docs/vision.md](vision.md).

## People, privacy and private messages

- **Profiles, follow, followers, following.** Follows are global, so connections outlive the event.
  "Connections only" profiles need a mutual follow. Follower lists are visible only to their owner.
- **End-to-end encrypted private messages** between mutual connections (`src/lib/e2ee/crypto.ts`):
  browser-generated ECDH P-256 keys with non-extractable private keys kept in IndexedDB, HKDF-SHA-256
  bound to both people and both keys, then AES-256-GCM with the direction as associated data. The server
  validates and relays ciphertext only. "Show what HELLO stores" displays it, and safety numbers let two
  people check their keys in person.
- **Encryption at rest** for profile text (`src/lib/vault.ts`, AES-256-GCM with `HELLO_DATA_KEY`, bound to
  the record). This is not end-to-end, and the UI says so.
- **Your rights:** download everything (`/api/me/export`) and erase (`/api/me/erase`). Erasure deletes
  personal data and redacts operational text while keeping the accountable record.
- **Browser-enforced no-leak policy:** a Content-Security-Policy with `connect-src 'self'`, and a cross-site
  Origin check on every state-changing API call (`src/proxy.ts`).

## Venue map

One venue model (`src/domain/venue`), three engines: **Plan** (2D floor plan), **3D** (exploded, turnable
isometric model) and **Live heat** (rooms coloured by recorded occupancy, with open-incident counts for
staff). Directions are computed on the device with Dijkstra. Step-free mode removes stairs from the graph,
so it finds a route with no steps or says none exists. It is the default for people whose profile asks for
it. No third-party map tiles are loaded. Chat replies about a room link to directions.

## Agent mesh

Every message is handled by seven small agents, each with one job and a declared scope (`src/agents/`).
Agents read, rank and cite. Only the coordinator changes state, and only through the domain services.

| Agent | Job | Scope |
|---|---|---|
| Triage | Classifies the message (fault, question, status check, person search, change needing approval) | Read only |
| Safety sentinel | Detects medical, fire and security emergencies; raises them to critical and puts the event guide's emergency guidance first | Read only |
| Context | Resolves the room, session and schedule facts from stored records | Read only |
| Event guide | BM25 retrieval over the organisers' event guide; answers only above a relevance threshold, with citations. Staff-only procedures never reach attendees | Read only |
| Web research | Only for outside-the-venue questions the guide cannot answer. Redacts personal details, scopes to the venue city, caches for 10 minutes, labels results as unverified | Web, read only |
| Coordinator | Opens or joins incidents, ranks staff, lists free sessions, requests approvals | Acts via services |
| Grounding check | Labels each reply: from HELLO records, from the event guide, from the web (unverified), or no reliable source | Read only |

Each reply stores its trace and numbered sources with the message. In the conversation, people see the
sources under the reply and can expand "How HELLO worked this out". Staff get an **Agent mesh** page with the
roster, configuration, event-guide pages and recent runs. When nothing answers a question, HELLO says so
instead of guessing.

Web research is off unless `HELLO_WEB_SEARCH_PROVIDER=tavily` and `HELLO_WEB_SEARCH_API_KEY` are set. Provider
output is schema-checked, stripped of markup and control characters, limited to http(s) links, and never
treated as instructions. A hung or failing provider becomes a FAILED step in the trace, never an error.

## Design

The "Jharokha" design system takes its name from the carved, arched window of a haveli, where you lean out to greet
the street. It sets the materials of Indian craft on a clean lime-washed wall.

- **Colour roles:** neel indigo (blue pottery, indigo dye) for primary actions, peacock blue for links and live state,
  a kesar saffron highlighter for the current page and selected items, rani pink for Moments, mehendi green for
  success, sindoor red only for danger. Every text colour passes WCAG AA on both the wall and cards.
- **Type:** EB Garamond for titles, with its flowing italic for emphasis, Figtree for reading, and the Tiro cuts for
  Devanagari, Kannada, Tamil, Telugu, Bangla and Gurmukhi, so every script has a serif of the same spirit.
  All are self-hosted at build time by `next/font`; the script fonts load only when shown.
- **Motifs:** a woven pixel border opens every page, unseen stories wear a blue-pottery rim, rangoli flowers gather
  at the foot of the landing window, and the event card shows a ghat at dawn. The landing hero is a jharokha that says
  hello in seven of India's scripts; it stops turning for people who prefer reduced motion.
- **Code:** `src/styles/tokens.css`, then `base.css`, `components.css` (primitives), `shell.css`, and one file per area.
  `tests/unit/style-boundaries.test.ts` fails if two area files define the same class.
- **Phones:** below 900 px the sidebar becomes a bottom tab bar with a raised Create button and a Menu sheet.

## Workplace features

Everything on these screens is computed from current state when it is requested, and the live screens refresh
themselves while the tab is visible. Nothing is a stored snapshot.

- **Today**: the event home. Your open requests, next sessions, unread updates and the latest announcement. Staff
  also see what is waiting on the team and what is assigned to them.
- **Acknowledgement timers**: every incident has a target from its urgency (critical 5 min, high 10, medium 30, low 60).
  Timers move from on track, to at risk, to overdue. The reporter sees the same target for their own report.
- **Escalation check**: unclaimed work past its target is escalated through the normal lifecycle rules, recorded in the
  timeline and the audit trail, and notified to operations. A second press changes nothing that is already escalated.
- **Workflow rail**: each incident shows its stages (reported, triaged, assigned, in progress, resolved, confirmed),
  derived from its status so it cannot disagree with the lifecycle.
- **Team**: availability, skills, zone and load for each staff member, ordered so available people come first. Staff
  set their own availability; off-shift people are not recommended for new work.
- **Profile and privacy**: interests and discoverability are the only things people search uses. Turning discoverability
  off removes you from search at once.
- **Announcements**: proposed by a staff member, published only after a different organiser approves, through the same
  approval and execution records as room changes.
- **Notifications**: unread counts in the navigation, and mark-as-read.
- **Audit trail**: organisers see every consequential action, filterable by action. Entries cannot be edited.
- **Conversation search** and incident search and filters.


## Demo walkthrough (judge scenario)

1. Sign in as **Ada (demo attendee)** and send: `The microphone is not working, and there are too many people in Room 3.`
2. The reply shows two concerns: an AV incident and a capacity concern. Both attach to the existing reports for Room 3,
   each with its match confidence. Alternative sessions are listed, and a room change is sent to an organiser.
3. Switch to **Kiri (demo AV technician)**, open *Incidents*, and claim *Microphone crackling in Room 3*.
   Staff ranking shows Kiri first, with reasons.
4. Acknowledge, start work, then mark resolved with a description.
5. Switch back to Ada, and confirm the fix (or reopen it). Confirmation closes the incident.
6. Switch to **Nadia (demo organiser)**, open *Operations and approvals*, and approve the room move. It executes
   against the stored schedule and records the result. (A request for a room that is already booked fails and says why.)
7. Signal intelligence needs three independent reporters inside ten minutes. Have two more demo attendees report an audio
   fault in Room 3, then press *Recompute from stored reports*. The insight appears for organiser review, not as an action.

Every figure in the demo is seeded, illustrative data and is labelled as such.

