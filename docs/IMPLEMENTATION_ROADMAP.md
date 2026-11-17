# Implementation roadmap

Phases follow the brief's dependency order. Status reflects the repository, not intent.

## Phase 1: Foundation: in progress
- [x] Repository audit (`docs/IMPLEMENTATION_AUDIT.md`)
- [x] Restore the broken store so typecheck, lint, unit and integration tests and build pass
- [x] Verify Nexconn SDK type definitions from the published package
- [ ] Install `@nexconn/chat` and create the `ChatTransport` interface and a mock transport. **Next**
- [ ] Real Nexconn connection. **Blocked:** needs `NEXCONN_APP_KEY` and the token-issuance procedure
- [ ] Postgres `HelloStore` against the Supabase schema, with a database integration test
- [ ] Run `npm run test:e2e` against a test server and record results

## Phase 2: Communication engine: not started
Direct and group messaging, event channels, history, real-time subscriptions, delivery states, read receipts.

## Phase 3: Advanced messaging: not started
Rich media, threads, reactions, mentions, search, offline outbox, notifications.

## Phase 4: Intelligence: not started
Summarisation, action extraction, conversation intelligence agents, intelligent assignment.

## Phase 5: Product expansion: not started
Communities, presence, multi-browser video calls, MCP improvements, external SDK.

## Phase 6: Production readiness: not started
Security audit with evidence, database verification, performance, browser testing, deployment and runbook.
