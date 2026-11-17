# Integration status

Describes what is actually connected as of 2026-11-17. Not a plan.

| Integration | State | Evidence |
|---|---|---|
| Nexconn `@nexconn/chat` | **Not installed, not connected.** Version verified as `26.2.1` from npm type definitions. | `docs/IMPLEMENTATION_AUDIT.md` §2 |
| Nexconn token issuance | **Not implemented.** The API is not in the package and needs Nexconn account documentation and credentials. | — |
| Nexconn credentials | **Blocked externally.** `NEXCONN_APP_KEY` is not provided. | — |
| Persistence | In-memory `MemoryHelloStore`, optional JSON file under `HELLO_DATA_DIR`. | `src/store/memory.ts`, `src/lib/persistence.ts` |
| Postgres / Supabase | **Schema exists, not used by the app.** No client code. | `supabase/migrations/0001_core_schema.sql` |
| Payments | Sandbox gateway only. | `src/integrations/payments/gateway.ts` |
| AI provider | Optional, configured by env, not verified against a live provider. | `src/ai/intent.ts` |
| Web search for agents | Optional, configured by env, not verified. | `src/agents/web.ts` |
| WebRTC ICE | Configurable through `HELLO_ICE_SERVERS`. Not verified with two peers. | `src/components/calls/CallRoom.tsx` |
| Browser push | **Not implemented.** | — |
