# Deployment

## What is ready

- `npm run build` produces a production build. The current build compiles all pages and routes.
- The app is a standard Next.js App Router application, so it is compatible with Vercel builds.
- Configuration is read from environment variables only. See `.env.example`.

## What is not ready

Do not deploy this build as a live event service. In particular:

1. **Persistence.** Set `DATABASE_URL` to use Postgres: durable and safe for several instances. Without it the store
   is in-memory, and each serverless instance has its own empty copy. Rate limits are still per instance.
2. **Authentication.** Demo sign-in must be replaced (see docs/security.md).
3. **Messaging.** Nexconn connects through the chat gateway: set `HELLO_CHAT_SECRET` and `HELLO_CHAT_OUTBOUND_URL` and run the bridge (see docs/nexconn-integration.md).
4. **AI.** No provider is connected. The deterministic interpreter answers, and the UI says so.

## Demo deployment (for review only)

Set these in the hosting dashboard (never commit them):

| Variable | Value |
|---|---|
| `HELLO_DEMO_MODE` | `true` |
| `NEXCONN_APP_KEY` | optional |

Build command: `npm run build`. Start command: `npm start`. Node.js 20.9 or later.

## Checklist before a real event

- [x] Postgres store implemented and tested (`npm run test:postgres`).
- [ ] Real authentication in place; `HELLO_DEMO_MODE` set to `false`.
- [ ] CSRF protection and a shared rate limiter.
- [ ] Nexconn connection implemented behind `ChatTransport`, and verified end to end.
- [ ] AI provider adapter (optional) validated against the schema, with evaluation data.
- [ ] Backups, a retention policy for messages and audit logs, and a documented data-subject process.
- [ ] Load test of the message and incident endpoints at expected attendee concurrency.
