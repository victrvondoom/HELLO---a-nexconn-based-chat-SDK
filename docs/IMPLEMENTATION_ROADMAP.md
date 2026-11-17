# Implementation roadmap

Phases follow the brief's dependency order. Status reflects the repository, not intent.

## Phase 1: Foundation: partly done
- [x] Repository audit (`docs/IMPLEMENTATION_AUDIT.md`)
- [x] Restore the broken store so typecheck, lint, unit and integration tests and build pass
- [x] Verify Nexconn SDK type definitions from the published package
- [ ] Install `@nexconn/chat` and create the `ChatTransport` interface and a mock transport
- [ ] Real Nexconn connection. **Blocked:** needs `NEXCONN_APP_KEY` and the token-issuance procedure
- [ ] Postgres `HelloStore` against the Supabase schema, with a database integration test

## HELLO Field Atlas: done (see AGENTS.md and docs/TEST_EVIDENCE.md)
- [x] Mission, progression, XP ledger, levels, monthly seasons, badges
- [x] Verification: workflow run, staff check-in code, organiser review
- [x] Organiser management with capability checks and audit entries
- [x] Quest Director: grounded field guide, routed recommendations, validated monthly drafts
- [x] Export and erasure
- [x] Browser journey (`tests/e2e/field-atlas-flow.mjs`)

## Field Atlas: remaining
- [ ] Opt-in leaderboard
- [ ] A live language model for summaries and integrity review (currently deterministic)
- [ ] Real-time push instead of 15-second polling
- [ ] Seasons in the event's own timezone
- [ ] Nexconn chat notifications for badges (needs Phase 1 Nexconn work)

## Phase 2: Communication engine: not started
## Phase 3: Advanced messaging: not started
## Phase 4: Intelligence: not started
## Phase 5: Product expansion: not started
## Phase 6: Production readiness: not started
