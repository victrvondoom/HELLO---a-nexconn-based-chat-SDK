# HELLO agent access model (status, 2026-11-22)

**Status: not built.** No agent can connect to HELLO's places, visits, trips or calendar. The existing personal
API tokens (`apiTokens`, MCP tools in `src/services/mcp.ts`) predate Living Atlas and are unchanged by it. They do not
cover place memory: the place service is not exposed to them, so an agent with an existing token cannot read or change
a place.

## What the brief asks for, and where each piece stands

| Requirement | Status |
|---|---|
| Granular scopes (`places:read`, `places:write`, `places:notes:read`, …) | Not built |
| Connected-agent registry, last-used, revoke, rotate | Not built |
| Read history and write history per agent | Not built |
| Reversible mutations and undo | Not built |
| Preview-and-approve for proposed changes | Not built (the approval mechanism exists for incidents, not places) |
| Quotas and rate limits specific to agents | Not built (the per-person limiter exists and is not wired to places) |
| Audit that never stores token values | Not built |

## Rules any future implementation must keep

1. A read permission does not imply a write permission.
2. An agent that can read saved places must not read private notes, visit history or live location without a separate grant.
3. Tokens are stored only as hashes and shown once. The audit log never contains a token.
4. Revocation takes effect on the next request on the server.
5. Nothing an agent proposes is applied without the owner's approval.

These rules describe the target. They are not evidence that anything works today.
