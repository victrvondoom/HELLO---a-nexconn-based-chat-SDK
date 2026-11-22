# Chatdom × HELLO integration report

## 1–2. Upstream and license

`Tobi4s1337/chatdomgg`, default branch `main`, commit `7d5da516a552fd7aa5b65b22cbd45c6896d23c6e`.
**License: none.** GitHub reports `license: null` and the repository has no LICENSE file or grant. All rights are reserved by
default, so HELLO contains no Chatdom code, assets, shaders, prose or fixtures; the feature set was reimplemented. See
`docs/CHATDOM_HELLO_FEATURE_PARITY.md` for the per-capability matrix (items 3–5 of the brief).

## Honest scope

The brief asked to absorb a roughly 440,000-line, nine-app product. That was not done and could not be done in one pass. What
was delivered is a **working vertical slice of the Chatdom idea inside HELLO**: Kingdoms. The voxel 3D engine, the Colyseus
realtime server, the Codex agents, the Twitch Extension and the Atlas are **not** ported (see the matrix for each reason).

## 6–7. Integrated

- **Kingdom page** `/events/[eventId]/kingdom`, linked in the nav under People.
- Founding (one per event), citizenship with a fixed home per person, walking on a seeded island, titles.
- Monarch tools: decrees, open/close gates, banish/pardon, approve or refuse forged things, record outside events.
- Forge: closed list of ten kits, EN/DE/ES/FR words, monarch approval; no model is called.
- Outside events (follow, subscribe, cheer, raid) mapped to world acts, deduplicated by their own id.
- Live updates through HELLO's SSE nudges (`kingdom*`); 5 s poll fallback.
- Data export and erasure; audit entries for every governing action.

## 8–10. Changes

New: `src/domain/kingdom/{world,rules,forge}.ts`, `src/services/kingdoms.ts`,
`src/app/api/events/[eventId]/kingdom/route.ts`, `src/app/events/[eventId]/kingdom/page.tsx`,
`src/components/kingdom/{Kingdom,KingdomWorld}.tsx`, `tests/unit/kingdom.test.ts`, `tests/integration/kingdoms.test.ts`, this
report and the parity matrix.
Edited: `src/domain/product.ts` (four collections: `kingdoms`, `kingdomCitizens`, `kingdomChronicle`, `kingdomForges`),
`src/components/layout/nav-model.ts`, `src/components/live/topics.ts`, `src/lib/live/store.ts`, `src/services/rights.ts`.
**Database:** documents use the existing typed collection tables, so there is **no schema migration**.

## 11. External integrations

None are live. No Twitch OAuth, token refresh, EventSub, webhook verification or Codex call exists. The `ingest` action is the
boundary a verified Twitch adapter would call; today the monarch enters events by hand. Nothing here claims Twitch works.

## 12. Security and privacy

Every action re-checks membership and capability on the server. Only the monarch or `content.moderate` staff may govern. Text is
screened (links, handles, hidden direction marks, word list). Walks are validated (bounds, terrain, step length, pace). Writes are
rate limited per person. Governing actions are audited. A banished citizen cannot walk, forge, leave-and-rejoin or be seen by
others. Lots are claimed atomically. Erasure removes citizenship and wishes, unlinks chronicle entries, and removes a founder's
whole kingdom. **Limits:** the word list is short and is not a classifier; the audit text names no personal data.

## 13. Test results

Run from `D:\HELLO\nexconn-chat-sdk` (upper-case drive letter, see the Vitest note):

- `npx tsc --noEmit`: clean.
- `npx eslint src tests`: clean.
- `npx vitest run`: 53 files, 618 passed, 3 skipped (31 are new Kingdom tests: 11 in `tests/unit`, 20 in `tests/integration`).
- `npm run build`: succeeds.
- **Not run:** `npm run test:postgres` (needs `HELLO_TEST_DATABASE_URL`), the Playwright e2e flows, and any in-browser check of
  the page. The canvas renderer has had no visual verification.

## 14–15. Standalone infrastructure and ports

`D:\HELLO\chatdomgg-main` is a sibling folder outside the HELLO repository and was left in place, because the matrix lists
capabilities still unported and the folder holds the only copy of that reference. It is not part of the HELLO repo, build or
runtime, and can be deleted whenever you choose. HELLO still has one app, one `package.json`, one `.env`, one `.gitignore`
and the existing dev and start ports. Nothing was added.

## 16. Remaining work

3D voxel renderer (WebGL) and art; continuous realtime movement (needs a realtime transport beyond SSE nudges); Twitch OAuth and
EventSub adapter with real credentials and tests; AI Forge with approval gates; Atlas/map integration; stream overlay; lanes;
animated caravans; stronger moderation; Postgres suite run; browser verification.
