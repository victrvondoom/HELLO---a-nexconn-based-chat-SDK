# Integration status

Describes what is actually connected as of 2026-11-22 (persistence row updated; the rest as of 2026-11-19). Not a plan.

| Integration | State | Evidence |
|---|---|---|
| Nexconn | **Gateway built and tested; Nexconn-side bridge not written.** Linking, signed inbound messages, the delivery outbox and Settings work end to end against a stand-in bridge. Writing the bridge needs Nexconn credentials and its server API. | `docs/nexconn-integration.md`, `tests/integration/chat-gateway.test.ts`, `tests/e2e/chat-bridge-flow.mjs` |
| Nexconn token issuance | **Not implemented.** Needs Nexconn account documentation. Only needed to embed the browser SDK. | — |
| Persistence | **Postgres** when `DATABASE_URL` is set (`src/store/postgres.ts`); otherwise in-memory, optionally saved to `HELLO_DATA_DIR`. With `DATABASE_URL` set there is **no fallback**: if the database cannot be reached the app fails requests (generic error, reason code in the log) and retries on the next request. It never serves in-memory data as if it were persistent. If both `DATABASE_URL` and `HELLO_DATA_DIR` are set, Postgres is used and a `data_dir_ignored` warning is logged. Verified 2026-11-22 against PostgreSQL 18.4 (a throwaway local cluster, not a hosted or production database): the integration suite, including all six Living Atlas / LiveScene collections, passes. **Not verified:** hosted Postgres, pooler (pgbouncer) behaviour, TLS, failover, backups, load. | `npm run test:postgres`, `tests/integration/store-contract.test.ts`, `tests/integration/persistence-collections.test.ts` |
| Live updates | Server-Sent Events; across instances with Postgres LISTEN/NOTIFY. Polling is the fallback. | `tests/e2e/live-flow.mjs` (two server processes) |
| Supabase | Separate relational schema with RLS in `supabase/`; not what the app runs on. | `docs/database.md` |
| Payments | Sandbox gateway only. | `src/integrations/payments/gateway.ts` |
| AI provider | **Not configured.** Quest Director and the interpreter are deterministic and say so. | `src/services/quest-director.ts` |
| Web search for agents | Optional, configured by env, not verified live. | `src/agents/web.ts` |
| WebRTC | Verified between two browsers on one machine. Across networks needs `HELLO_ICE_SERVERS` (TURN). | `tests/e2e/call-flow.mjs` |
| Browser push notifications | **Not implemented.** Live updates reach open pages only. | — |
| CI | GitHub Actions: checks, Postgres suite, all browser journeys. | `.github/workflows/ci.yml` |
| Privacy filter (from Offleak) | **Built and verified in Chromium with the real models** (YuNet, SFace, Tesseract; QR via BarcodeDetector or jsQR), 2026-11-22. Runs on the device; nothing visual reaches the server. **Not built:** pose heads, QRDet, crop zoom, video files. No accuracy benchmark. | `docs/UPSTREAM_INTEGRATION_AUDIT.md`, `tests/e2e/privacy-filter-flow.mjs` |
| Twitch (privacy alerts) | **Built; tested with a fake Twitch only.** Needs a registered Twitch app (client id, redirect `<origin>/twitch/callback`). Token kept in server memory, per instance. | `tests/integration/privacy-filter.test.ts` |
