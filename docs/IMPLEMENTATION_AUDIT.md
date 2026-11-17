# HELLO implementation audit

Date: 2026-11-17. Branch: `claude/eager-ritchie-argdtp`. Method: read the repository, run the project's
checks, and download the published Nexconn package to read its real type definitions. Nothing here is taken
from the README alone.

## 1. Baseline before this audit's changes

| Check | Result before | Result after |
|---|---|---|
| `npm run typecheck` | 12 errors in `src/store/memory.ts` | passes |
| `npm run lint` | 47 errors (all caused by the same missing fields) | passes |
| `npx vitest run` | 17 of 206 failing | 206 of 206 pass |
| `npm run build` | not run | passes |

Root cause: `src/store/memory.ts` was missing three field declarations: `payments`, `blobs` and `docs`. Each is
used by methods and by the snapshot code, so the store was broken for every product feature that uses them
(accounts, sessions, feed, communities, location, games, workflows, MCP, payments). The declarations were
present in the commits that introduced those features (`4951e9c`, `2ccb2b6`) and were lost later. They are
restored with the original types. No test was changed or removed.

## 2. Nexconn SDK, verified

Source: npm registry metadata and the published `@nexconn/chat@26.2.1` tarball (`index.d.ts`, 5,032 lines).
`latest` is `26.2.1`; an `alpha` tag `26.5.0-alpha.9` also exists and is not used.

Confirmed in the type definitions:

- `NCEngine` (abstract class, all members static): `initialize(params: InitParams)`, `connect(params: ConnectParams)`
  returning `RCResult<ConnectResult>`, `disconnect(disablePush?)`, `getCurrentUserId()`, `getConnectionStatus()`,
  `addConnectionStatusHandler`, `addMessageHandler`, `addChannelHandler`, `addGroupChannelHandler`,
  `addOpenChannelHandler`, `addUserHandler`, `registerCustomMessages(CustomMessageRegistration[])`, plus matching
  `remove*` methods.
- Message params: `SendTextMessageParams`, `SendImageMessageParams`, `SendFileMessageParams`, `SendLocationMessageParams`,
  `SendReferenceMessageParams` (quote/reply), `SendCombineMessageParams`, `SendShortVideoMessageParams`,
  `SendHDVoiceMessageParams` (voice).
- Channels: `DirectChannel`, `GroupChannel`, `OpenChannel`, `SystemChannel`, `CommunityChannel`, `CommunitySubChannel`,
  all extending `BaseChannel`. Channel identifiers: `DirectChannelIdentifier`, `GroupChannelIdentifier`,
  `OpenChannelIdentifier`, `CommunityChannelIdentifier`.
- History and unread: `createMessagesQuery`, `getUnreadChannels`, `getTotalUnreadCount`, `createChannelsQuery`.
- Read receipts: `createMessagesReadReceiptUsersQuery`, `getMessageReadReceiptInfoByIdentifiers`.
- Files: `FileUploader` / `UploadTask` (uploads go through the SDK's own uploader).
- Tags: `Tag.createTag`, `getTags`, `createTaggedChannelsQuery`.
- Groups: `GroupChannel.createGroup`, `getGroupsInfo`, membership and application queries.

**Not verified, so not used:**

- The exact token-issuance API. The package only exposes `connect({ token })`. How the token is created, whether an
  app secret is needed, and whether a server-side endpoint is required are not in the package. They must come from
  Nexconn's account documentation. This is a credential and provider-access question.
- Server webhooks, delivery receipts for every message type, and event-channel membership rules beyond the group APIs.
- `NCEngine.initialize` needs a browser environment. It must be called only from client code.

## 3. Feature-by-feature audit

Status key: **Real** = implemented end to end and tested. **Partial** = implemented but with a known gap.
**Simulated** = a UI or flow that does not reach a real external service. **Missing** = not present.

| Area | Execution path | Backend | Frontend | Persistence | Security notes | Tests | Status |
|---|---|---|---|---|---|---|---|
| Nexconn transport | `src/integrations/nexconn/status.ts` only reports whether `NEXCONN_APP_KEY` is set | none | conversation page labels transport "Local demo transport" | n/a | key is never returned | `status` not directly tested | **Missing**. SDK not installed; no `NCEngine` call anywhere |
| Direct messages (E2E) | `services/private-messages.ts` → `api/events/[eventId]/dm/[peerId]` → store `sealed` | real | `messages/[peerId]` | in memory + optional JSON file | ciphertext only on the server; AES-256-GCM with browser ECDH P-256 keys | `crypto.test.ts`, `private-messages.mjs` (E2E) | **Partial**. Local encrypted messaging. Not Nexconn. One key per device, no forward secrecy |
| Event messages / conversation | `services/pipeline.ts`, `api/events/[eventId]/messages` | real | `conversation` | in memory + JSON | rate limited (`lib/rate-limit.ts`, fixed window, per process) | `conversation-record.test.ts` | **Partial**. Local demo transport, not delivered by Nexconn |
| Incidents | `services/incidents.ts`, `domain/incidents/*` (classify, duplicates, SLA, workflow) | real, version-checked updates | `incidents`, `IncidentActions` | in memory + JSON | `VERSION_CONFLICT` prevents double claim | unit + `workflows.test.ts` | **Real** for the domain. Not driven by Nexconn messages |
| Approvals | `services/approvals.ts`, `domain/approvals/rules.ts` | real, version-checked | `operations/ApprovalQueue` | in memory + JSON | rules enforced server side | `permissions-approvals.test.ts` | **Real** |
| AI intent and agents | `ai/intent.ts`, `agents/*` (seven agents: web, sentinel, knowledge, trace, types) | real, deterministic classifier. Optional provider via `AI_PROVIDER` | `agents`, `AgentTrace` | none | outputs are domain-classified, not free LLM mutations | `intent.test.ts`, `agents.test.ts` | **Partial**. Provider path is configured by env, not verified against a live provider |
| Notifications | `services/pipeline.ts`, `domain/notifications/dedupe.ts` | real, dedupe key per event | `notifications`, `LiveRefresh` | in memory + JSON | — | `signals-notifications.test.ts` | **Partial**. In-app only. No browser push, no mentions/replies, no preferences |
| Profiles, follows, connections | `services/social.ts`, `people.ts` | real | `people`, `FollowButton`, `ProfileForm` | global store | — | `social.test.ts` | **Partial**. No block/report, no mutual connections, no privacy levels beyond `discoverable` |
| Private payments (sandbox) | `services/payments.ts`, `integrations/payments/gateway.ts` | real state machine. Gateway is a sandbox | `PayPanel` | in memory + JSON | version-checked; double-tap safe | `payments.test.ts`, `payments-voice.test.ts` | **Simulated** gateway. Labelled as sandbox |
| Feed, communities | `services/feed.ts`, `communities.ts` | real | `feed`, `communities` | generic doc collections | community membership checked server side | `product.test.ts` | **Partial**. No moderation roles, pinning or media upload from the brief |
| Location | `services/location.ts` | real, sealed at rest, expires | `live-map` | sealed | connections-only visibility | `product.test.ts` | **Real** for the implemented scope |
| Calls (WebRTC) | `services/calls.ts`, `components/calls/CallRoom.tsx`, `HELLO_ICE_SERVERS` | signalling is server-side records | `calls` | in memory | ICE servers come from env | **none** (no multi-browser test) | **Partial**. Browser-to-browser code exists; not verified with two peers |
| Games | `services/games.ts`, `domain/games/four.ts` | real, version-checked moves | `games` | generic docs | simultaneous-move conflict tested | `product.test.ts` | **Real** |
| Workflows and MCP | `services/workflows.ts`, `services/mcp.ts`, `api/mcp` | real. Tokens stored as hashes, scoped, revocable | `settings/TokenManager` | in memory + JSON | MCP token cannot exceed owner | `product.test.ts` | **Real** |
| Sessions and auth | `services/auth.ts`, `lib/session.ts`, `proxy.ts` | real. Session tokens hashed, expiring | `signin` | in memory + JSON | — | `product.test.ts` | **Real** for the implemented scope |
| Data export, erasure | `services/rights.ts`, `api/me/export`, `api/me/erase` | real | `DataRights` | — | erasure redacts operational text, keeps accountable record | `product.test.ts` | **Real** |
| Attachments / media | `api/events/[eventId]/media` (size-capped streaming read), `services/feed.ts` (MIME allow-list and magic-byte signature check), store `blobPut` | real bytes in memory + files under `HELLO_DATA_DIR/blobs` | `feed` | files | MIME and signature checked in code; no dedicated test found for the signature check | none specific | **Partial** |
| Search | none | none | none | none | — | none | **Missing** |
| Presence, typing, real-time push | `LiveRefresh` polls | poll only | `LiveRefresh` | — | — | none | **Missing** as push. Polling only |
| Offline outbox, IndexedDB | none | none | none | none | — | none | **Missing** |
| Supabase / Postgres | `supabase/migrations/0001_core_schema.sql` and `supabase/tests/0001_constraints_and_rls.sql` exist | **no code connects to Supabase**. `runtime.ts` always uses `MemoryHelloStore` | — | — | the SQL is not applied by the app | the SQL test file is not run by any npm script | **Missing** in the application |
| E2E suites | `tests/e2e/*.mjs` (Playwright, need a running server) | — | — | — | — | not run in this audit | **Unverified** in this session |

## 4. What is still in memory or local-file

- Every domain record: `src/store/memory.ts`. Durable only when `HELLO_DATA_DIR` is set, through `src/lib/persistence.ts`,
  which writes one `state.json` and a `blobs/` directory. This is single-process only.
- Rate limiting: per process, in memory.
- Sealed messages and key bundles: same store. The server holds ciphertext and public keys only.

## 5. What is simulated

- The payments gateway (`src/integrations/payments/gateway.ts`) is a sandbox.
- The conversation transport is labelled "Local demo transport · not Nexconn".
- The AI layer runs deterministic classification by default. A live provider is optional and unverified here.

## 6. Security findings

1. Build-breaking defect in the store (fixed, see section 1). It meant several security-relevant paths (session expiry,
   MCP token scoping, erasure) had not been running in the test suite before this change.
2. No Nexconn token endpoint exists, so there is no path where a Nexconn identity could be mapped to a HELLO account.
   Nothing is exposed, because nothing is connected.
3. `NEXT_PUBLIC_SUPABASE_*` variables are declared in `.env.example`, but the application code never reads them.
   The `SUPABASE_SERVICE_ROLE_KEY` must not be exposed to the client. Nothing in `src` reads it now.
4. The E2EE design (ECDH P-256 per device, AES-256-GCM) has no forward secrecy and no multi-device key rotation.
   It is documented as such in `docs/security-audit.md`.
5. Media upload enforces a size cap while streaming, a MIME allow-list, and magic-byte signature checks in
   `services/feed.ts`. No dedicated test for the signature check was found, so it is not yet proven.

## 7. Architectural decisions to keep

- `HelloStore` is the persistence contract. Services depend only on it. A Postgres implementation should satisfy it
  rather than introduce a second persistence path.
- Incident, approval, payment and game updates use version checks (`VERSION_CONFLICT`). Keep that pattern.
- AI actions go through domain services and approval rules. No direct model writes.
- Authorization lives in services and API handlers, not in React components.
- The seven-agent architecture in `src/agents/` and the domain modules in `src/domain/` are preserved.

## 8. Recommended next steps, in dependency order

1. Obtain Nexconn credentials and the token-issuance procedure from Nexconn's documentation. Without them the
   integration can only be built behind an interface and tested with a mock transport. It cannot be verified live.
2. Define a `ChatTransport` interface and a mock implementation that drives the existing conversation UI through it,
   so the rest of HELLO does not depend on Nexconn types.
3. Add a Postgres `HelloStore` implementation against the existing Supabase schema, with an integration test that
   runs against a real database. Apply and run `supabase/tests`.
4. Add a real-time channel for application events (SSE or WebSocket) only after step 2 defines the event model.
5. Add search, presence, the offline outbox and browser push as separate, tested features.

The full 23-part brief is a multi-phase programme. This audit covers Phase 1 investigation only. The Nexconn
transport, Postgres store, real-time delivery and the advanced messaging features are not implemented yet.

## 9. HELLO Field Atlas (added 2026-11-17)

| Area | Execution path | Backend | Frontend | Persistence | Security | Tests | Status |
|---|---|---|---|---|---|---|---|
| Missions and map | `GET /api/events/[eventId]/atlas` → `listMissionsForViewer` → `src/domain/field/rules.ts` | real, per-person availability | `FieldAtlas` + `AtlasMap` (venue geometry, keyboard markers, floor switch) | `fieldMissions` in the store | drafts hidden from attendees; event membership checked | unit + integration + E2E | **Real** |
| Verification | `POST …/missions/[id]/submit` → `submitMission` → `decideVerification` | real: workflow run, staff check-in code, organiser review | mission panel | `fieldAttempts`, `fieldStations` (code hash only) | rate limited; expired codes flagged; no AI in the path | integration + E2E | **Real** for the three methods. No self-attestation |
| XP and levels | `awardMission` → `docPutIfAbsent` ledger → `levelFor` | real; idempotent; concurrency tested | header, cabinet, history | `fieldLedger`, `fieldLevels` | audited adjustments only; no edit of entries | integration | **Real** |
| Monthly season and badges | `saveSeason`, `draftMonthlyChallenge`, `awardMission` season branch | real; UTC months | season block, cabinet history | `fieldSeasons`, `fieldBadges` | badges never revoked | unit + integration + E2E | **Real** (UTC only) |
| Quest Director | `fieldGuide`, `recommendFor`, `draftMonthlyChallenge` | deterministic; grounded; schema validated | guide answers with citations, suggestions | `questRuns` | cannot award or verify | integration | **Partial**: no language model. Output is labelled deterministic |
| Integrity flags | `flag()` from submit paths | real, four kinds | organiser flag list, dismiss | `fieldFlags` | never removes an award | integration | **Partial**: no AI review; deterministic flags only |
| Organiser management | `/atlas/manage`, `POST …/atlas/manage` | real, capability checked per action | `AtlasManage` | all field collections | `field.manage` / `field.review`; attendee refused (403) | integration + E2E | **Real** |
| Notifications | `notify()` for mission, level and badge | in-app only | notifications page (existing) | `notifications` | dedupe keys | integration | **Partial**: no Nexconn chat message, no push |
| Export and erasure | `exportMyData`, `eraseMe` | real | Data rights (existing) | — | erasure removes attempts, XP, badges | integration | **Real** |
| Leaderboards | none | — | — | — | — | — | **Missing** |
