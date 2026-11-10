# Architecture

HELLO is a modular monolith: one Next.js (App Router) application with clear layers.
There are no microservices, queues, caches or vector stores. Each layer has one job.

```
UI (app/, components/)          Server components render; client components only call the API.
  │
API routes (app/api/**)          Parse and validate input (Zod), resolve the viewer, call one service, map errors.
  │
Services (services/**)           Use cases. Check permissions, load state, call domain rules, write through the store.
  │                 │
Domain (domain/**)  AI (ai/**)    Pure rules: lifecycle, classification, duplicate gates, scoring, approvals, signals.
  │                              AI only proposes a route. It never mutates state.
Store (store/**)                  Persistence contract (HelloStore). Memory implementation for demo/tests.
Integrations (integrations/**)    Nexconn configuration status. No live connection in this build.
```

## Rules that hold across the layers

- **Permissions are checked in services, not in components.** `requireCapability` loads the
  membership for the event and checks the role's capability. A membership from another event never grants access.
  Non-members get `NOT_FOUND` on event-scoped pages, so the existence of an event is not revealed.
- **Hidden controls are presentation only.** The navigation and buttons use the same capability table, but
  every API route and service repeats the check.
- **State changes are versioned.** Incidents and approvals carry a `version`. A write with a stale version is rejected
  (`VERSION_CONFLICT`). Two simultaneous claims therefore cannot both succeed.
- **The model never decides outcomes.** `interpretMessage` returns a validated structure that chooses which
  service to call. Claims, transitions, approvals and executions are decided by domain rules.
- **Approval and execution are separate facts.** An approval moves to `APPROVED`. Execution then runs its own
  validation and records `SUCCEEDED` or `FAILED` in its own field. An approved move can still fail, and the UI shows that.
- **Notifications follow state changes.** A notification is written after the status change is recorded, and each one
  carries a dedupe key built from the recipient, kind, object and state, so the same update is never repeated.

## Request pipeline (`src/services/pipeline.ts`)

1. Authorise `message.send` for the viewer in the event.
2. Interpret the text (AI provider if configured and valid, otherwise deterministic rules). Failures fall back and are reported.
3. Classify the text (categories, urgency, equipment) and resolve the room by whole-word name match.
4. Route by intent:
   - **Report / assistance / schedule**: create or attach incidents (duplicate gates), keep each reporter's record,
     triage, notify operations, rank staff (operational viewers only), offer alternatives for capacity concerns,
     and raise an organiser approval only when over-capacity is recorded and two or more independent people report it.
   - **Status check**: answer from the stored incident, never from memory.
   - **Find a person**: match only declared interests of people who opted in.
   - **Consequential request**: attendees are routed to organisers; staff with `approval.request` create an approval.
   - **Question**: answer from stored schedule data, or say that nothing verified is available.
5. Store the message with its structured interpretation and links to the objects it created.
