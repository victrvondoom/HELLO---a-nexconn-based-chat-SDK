# Security audit: checks 1–18

Audited: this repository at the commit that adds this file. No production data or infrastructure was changed.

**Deployed configuration: UNKNOWN.** No deployment of this repository was found. The connected Render
workspace was listed read-only and holds six services, none built from this repository; `docs/deployment.md`
mentions Vercel, which could not be inspected from here. Every result below is therefore about the code and
its default configuration. Before trusting a live deployment, confirm its environment variables against the
"Verify on the deployment" line of checks 4, 7, 8 and 10.

Each "verify" command assumes a running server (`npm run build && npm start`) and
`BASE_URL=http://localhost:3000`. The automated proof for most rows is `node tests/e2e/product-flow.mjs`
(79 checks) and `npm test` (199 tests).

| # | Check | Result |
|---|---|---|
| 01 | Exposed database credentials | PASS |
| 02 | Public .env files | PASS |
| 03 | Hardcoded API keys or secrets | PASS |
| 04 | Weak or missing authentication | **FAIL → fixed**; one condition remains (demo mode) |
| 05 | Missing server-side authorization | **FAIL → fixed** |
| 06 | Cross-user data access | PASS |
| 07 | Open database permissions | PASS for what exists; UNKNOWN for a future Postgres store |
| 08 | Misconfigured Firebase / Supabase / S3 | NOT APPLICABLE (none connected); UNKNOWN for any live project |
| 09 | Unprotected admin routes | **FAIL → fixed** |
| 10 | Production debug tools exposed | PASS |
| 11 | Build logs leaking secrets | NOT APPLICABLE (no CI in the repository) |
| 12 | Verbose production errors | PASS |
| 13 | Secrets in Git history | PASS (pattern scan) |
| 14 | Secrets shipped in frontend JavaScript | PASS |
| 15 | Client-side-only security checks | PASS |
| 16 | Missing input validation | **FAIL → fixed** (one defect) |
| 17 | SQL injection | NOT APPLICABLE (the app executes no SQL) |
| 18 | NoSQL injection | PASS |

## Findings that failed, and what was done

### 04 — Authentication (was FAIL)

- **Evidence (before):** `src/lib/session.ts` read a cookie `hello_demo_user` whose value was the user id
  itself, and accepted it. There was no other way to sign in.
- **Failure mode:** anyone could set that cookie to `u-org-nadia` and become the organiser.
- **Fix:** real accounts and server-side sessions. `src/services/auth.ts` stores scrypt password hashes
  (per-account salt, constant-time compare, identical work for unknown handles) and issues a random
  256-bit session token of which only the SHA-256 is stored. `src/lib/session.ts` resolves the cookie
  (`HttpOnly`, `SameSite=Lax`, `Secure` in production, 8 hours) against the store on every request.
  Sign-in is rate limited per handle and per address (`src/app/api/auth/login/route.ts`).
- **Verify:** `curl -i -H 'cookie: hello_session=u-org-nadia; hello_demo_user=u-org-nadia' $BASE_URL/api/events/evt-demo-hello-summit/feed` → `401`.
- **Remaining condition:** demo sign-in (`/api/demo/session`) still lets anyone become a seeded,
  fictional account. It is off in production unless `HELLO_DEMO_MODE=true`, and sessions for seeded
  accounts stop being honoured when it is off (`currentUserId`). **Verify on the deployment:**
  `HELLO_DEMO_MODE` is `false` or unset; `curl -X POST $BASE_URL/api/demo/session -d '{"userId":"u-org-nadia"}' -H 'content-type: application/json'` → `404`.
- **Not built:** password reset, email verification and two-factor sign-in. An account whose password is
  forgotten cannot be recovered today.

### 05 and 09 — Authorization / admin routes (was FAIL)

- **Evidence (before):** `src/app/api/demo/reset/route.ts` checked only that demo mode was on.
- **Failure mode:** any visitor, signed in or not, could wipe every account, post and incident with one request.
- **Fix:** the route now requires a session and the `member.manage` capability in the demo event.
- **Verify:** `curl -i -X POST $BASE_URL/api/demo/reset` → `401`; as an attendee → `403`.

### 16 — Input validation (one defect)

- **Evidence:** request bodies over 10 MB were silently cut to 10 MB by the framework before reaching
  the upload route (server log: "Request body exceeded 10MB").
- **Failure mode:** a 11–24 MB video was accepted and stored as a broken file.
- **Fix:** `next.config.mjs` sets `experimental.proxyClientMaxBodySize: '25mb'`, and
  `src/app/api/events/[eventId]/media/route.ts` refuses any body whose length differs from its
  `Content-Length`, on top of its own streaming 24 MB cap.
- **Verify:** upload an 11 MB MP4, then `GET` it: the returned length equals the uploaded length.

## Evidence for the passes

- **01** — No database client or connection string exists in `src/` (`grep -rn "postgres\|supabase" src` finds
  comments only). `.env.example` lists the Supabase names with empty values.
- **02** — `.gitignore` lines 17–20 exclude `.env*` except `.env.example`; `git log --all --name-only` shows no other
  env, key or credential file ever committed. `HELLO_DATA_DIR` files are created `0600` in a `0700` directory
  (`src/lib/persistence.ts`).
- **03** — `process.env` is read in four server files only (`session.ts`, `runtime.ts` via `vaultFromEnv` /
  `webSearchFromEnv` / `persistenceFromEnv`, `calls.ts`, `next.config.mjs`). No literal key appears in `src/`.
- **06** — Every record is read through its event after a membership check, and compared to the event in the URL
  (`eventPost`, `eventCommunity`, `eventCall`, `eventGame`, `readMedia`). Owner-only records return "not found"
  to anyone else (`revokeToken`). Proven by product-flow checks "someone else cannot attach my upload",
  "cannot revoke someone else's token", "cannot poll a call with someone else's peer id",
  "connections-only location hidden from a stranger", and `tests/integration/product.test.ts`.
- **07** — `supabase/migrations/0001_core_schema.sql` lines 382–395 enable row level security on all 14 tables, with
  read policies scoped by membership and only one write policy (`profiles_update_own`); its three
  `SECURITY DEFINER` helpers pin `search_path`. **UNKNOWN:** the new collections (accounts, posts, calls, …) have no
  SQL schema yet, so a Postgres store must add tables *and* policies for them before use.
- **08** — No Firebase, Supabase or S3 client is in `package.json`. Uploaded media is served only by
  `src/app/api/events/[eventId]/media/[mediaId]/route.ts`, after a session and membership check, with a type taken
  from our own record and `nosniff`. **Verify on the deployment:** if a Supabase project exists, run
  `supabase/tests/0001_constraints_and_rls.sql` against it signed out and as a non-member.
- **10** — No debug, test or profiler route exists under `src/app/api`. Source maps are not published
  (`productionBrowserSourceMaps` is unset). The only maintenance route is demo reset (see 05).
- **11** — There is no `.github/` or other CI configuration. `src/lib/logger.ts` logs event names and error classes
  only. If CI is added, mark `HELLO_DATA_KEY`, `HELLO_WEB_SEARCH_API_KEY` and `HELLO_ICE_SERVERS` as secrets.
- **12** — `errorResponse` in `src/lib/http.ts` returns only our own `DomainError` messages; anything else becomes
  "Something went wrong" with the detail kept in the server log. `src/app/error.tsx` shows no technical detail.
- **13** — `git log --all -p` scanned for live-key, AWS-key, JWT, private-key and credentialed-URL patterns: no
  match. This is a pattern scan, not a full secret scanner; GitHub secret scanning is the stronger check.
- **14** — No `NEXT_PUBLIC_*` variable is read anywhere in `src/`. Session cookies are `HttpOnly`. Access tokens are
  shown once and stored as hashes. *By design*, TURN credentials in `HELLO_ICE_SERVERS` are sent to people who
  have joined a call, because browsers need them: use short-lived TURN credentials.
- **15** — Navigation hides links for presentation only; each service calls `requireCapability`. Game rules, quiz
  answers, like counts, location audience and workflow permissions are decided on the server
  (checks "cannot move out of turn", "quiz answers are not sent before you answer",
  "attendee cannot run a staff workflow", "token cannot exceed its owner's permissions").
- **16** — Every route parses its body with a Zod schema (`parseBody` in `src/lib/http.ts`); ids match fixed
  patterns; uploads are limited by size, by an allow-list of six types, and by the file's own first bytes.
- **17** — The application executes no SQL: the store is `src/store/memory.ts`. The migration contains no dynamic SQL.
- **18** — Collection filters (`docList(collection, where)`) are equality matches built only by server code; no
  request value is ever used as a filter object. Check "query operators in a filter are refused" sends
  `author[$ne]=x` and gets `422`.

## Residual risks, in priority order

1. **Demo mode in production** (check 04): one environment variable separates a demo from an open door.
2. **Single process.** Rate limits (`src/lib/rate-limit.ts`) and storage (`HELLO_DATA_DIR`) are per process. Running
   two instances halves the protection of the limits and splits the data. Use one instance with a persistent disk.
3. **Proxy headers are trusted.** `x-forwarded-for` (rate-limit key) and `x-forwarded-host` (cross-site check in
   `src/proxy.ts`) are taken from the request. Deploy only behind a proxy that overwrites both.
4. **`script-src 'unsafe-inline'`** in the Content-Security-Policy (`next.config.mjs`), required by the framework's
   inline bootstrap. Moving to nonces would remove it.
5. **The feed and communities are not end-to-end encrypted** (private messages are). They are readable by whoever
   operates the server, as on any social feed.
