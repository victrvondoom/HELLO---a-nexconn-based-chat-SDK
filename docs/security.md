# Security

## Implemented

- **Server-side authorisation on every write.** Each API route and service loads the viewer's membership
  for the event and checks a capability (`src/domain/permissions.ts`). A membership from one event never
  authorises action in another (`WRONG_EVENT`). Covered by unit and integration tests.
- **Cross-event isolation.** Incidents, approvals and sessions are loaded only if they belong to the requested event.
  Otherwise the response is `NOT_FOUND`, so existence is not revealed.
- **Attendee privacy.** Attendees see the messages they sent, and the incidents they reported. Staff-only data
  (assignment rankings, the staff queue, signal patterns) is withheld from them on the server, not just hidden.
- **People discovery.** Only profiles with `discoverable = true` appear. The result contains display name, role
  and the declared interests that matched. No contact fields exist in the response (tested).
- **Input validation.** Every request body is parsed with Zod (`src/lib/validation/api.ts`). Message length
  is limited to 2000 characters. IDs in the URL are checked by the services.
- **No trusted client role.** The role is read from the membership, never from the request body.
- **Four-eyes approvals.** A requester cannot approve their own request. This is enforced in the domain
  and in the database (`approvals_four_eyes`).
- **Append-only audit trail.** `audit_logs` rejects updates and deletes at the database level.
- **Rate limiting.** Messages are limited to 20 per minute per viewer and event (`src/lib/rate-limit.ts`).
- **Security headers.** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` and a
  `Permissions-Policy` that disables camera, microphone and geolocation (`next.config.mjs`).
- **Error hygiene.** Domain errors return a stable `code` and a safe message. Unexpected errors return a generic
  message and are logged with the route name only, never with message text.
- **Secrets.** No secret is in the repository. `.env*` (except `.env.example`) is git-ignored. The app key is
  checked for presence only and is never returned.
- **Row Level Security** is enabled on all 14 tables, with policies that were tested for strangers, attendees and
  organisers (`supabase/tests/0001_constraints_and_rls.sql`).

## Known limitations (must be resolved before a real event)

1. **Demo sign-in is not authentication.** `DEMO_SESSION_COOKIE` holds a user id, and any browser can set it.
   It is enabled outside production, or when `HELLO_DEMO_MODE=true`. Replace it with real sign-in (for example
   Supabase Auth with signed, HTTP-only, rotated sessions) before any deployment that holds real data.
2. **In-memory store.** Data is lost on restart and is not shared between instances. Serverless deployments
   each have their own store. The Postgres implementation is not written yet.
3. **Rate limiter is per process.** It does not coordinate across instances.
4. **Session cookie** is set `secure` only in production builds. Behind a plain-HTTP staging host it will not be sent over TLS.
5. **No CSRF token.** API routes accept JSON POSTs and rely on the `SameSite=Lax` cookie. Add a CSRF token
   or an origin check before real sign-in is introduced.
6. **No content moderation** on messages.
7. **No attachment upload.** The file-upload safety work (type checks, size limits, malware scanning) has not been done because attachments are not implemented.
8. **Dependency audit.** `npm audit --omit=dev` reported 0 production vulnerabilities after upgrading Next.js to 16.4.6 and Zod to 4.6.7.
9. **The Supabase service role key** must only ever be used in server code. The database access layer that uses it is not written yet.
