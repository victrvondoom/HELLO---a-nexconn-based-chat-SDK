# Integration status

Describes what is actually connected as of 2026-11-19. Not a plan.

| Integration | State | Evidence |
|---|---|---|
| Nexconn | **Gateway built and tested; Nexconn-side bridge not written.** Linking, signed inbound messages, the delivery outbox and Settings work end to end against a stand-in bridge. Writing the bridge needs Nexconn credentials and its server API. | `docs/nexconn-integration.md`, `tests/integration/chat-gateway.test.ts`, `tests/e2e/chat-bridge-flow.mjs` |
| Nexconn token issuance | **Not implemented.** Needs Nexconn account documentation. Only needed to embed the browser SDK. | — |
| Persistence | **Postgres** when `DATABASE_URL` is set (`src/store/postgres.ts`); otherwise in-memory, optionally saved to `HELLO_DATA_DIR`. | `npm run test:postgres`, `tests/integration/store-contract.test.ts` |
| Live updates | Server-Sent Events; across instances with Postgres LISTEN/NOTIFY. Polling is the fallback. | `tests/e2e/live-flow.mjs` (two server processes) |
| Supabase | Separate relational schema with RLS in `supabase/`; not what the app runs on. | `docs/database.md` |
| Payments | Sandbox gateway only. | `src/integrations/payments/gateway.ts` |
| AI provider | **Not configured.** Quest Director and the interpreter are deterministic and say so. | `src/services/quest-director.ts` |
| Web search for agents | Optional, configured by env, not verified live. | `src/agents/web.ts` |
| WebRTC | Verified between two browsers on one machine. Across networks needs `HELLO_ICE_SERVERS` (TURN). | `tests/e2e/call-flow.mjs` |
| Browser push notifications | **Not implemented.** Live updates reach open pages only. | — |
| CI | GitHub Actions: checks, Postgres suite, all browser journeys. | `.github/workflows/ci.yml` |
