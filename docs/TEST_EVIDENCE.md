# Test evidence

Recorded on 2026-11-17 on branch `claude/eager-ritchie-argdtp`, after restoring three missing store fields
(`payments`, `blobs`, `docs`) in `src/store/memory.ts`.

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` | 21 files, 206 tests, all pass |
| `npm run build` | pass |

**Not yet run in this session:** `npm run test:e2e` (Playwright, needs a running server and the `reset.mjs` setup),
`npm run test:routes`, and the Supabase SQL tests in `supabase/tests/`. Their status is unknown until they are run.

**Not present:** any test of the Nexconn transport, multi-browser messaging, reconnection, duplicate prevention,
read receipts, search, presence, or the offline outbox. These features do not exist yet.
