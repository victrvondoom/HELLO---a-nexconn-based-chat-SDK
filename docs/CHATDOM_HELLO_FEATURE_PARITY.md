# Chatdom → HELLO feature parity

Upstream: <https://github.com/Tobi4s1337/chatdomgg>, `main` @ `7d5da516a552fd7aa5b65b22cbd45c6896d23c6e`.
Upstream scale: about 440,000 lines of TypeScript in 9 apps and 12 packages (SolidJS, three.js, pixi, Colyseus, pnpm).

## How this was built

HELLO's version is **new code written for HELLO's own stack** (Next.js, React, `HelloStore` document collections,
SSE live nudges). Nothing was copied from Chatdom: the upstream repository has **no license** (GitHub reports none, and
no LICENSE file or grant exists in the tree), and its own `AGENTS.md` says to write your own code when a license does not
allow adapting. The *ideas* (a persistent kingdom, a monarch, citizens with homes, a forge that needs approval, outside
events becoming world acts) are reimplemented. If you obtain written permission or a license from the author, more of
the upstream can be ported directly.

Status words: **BUILT** works in HELLO and is tested. **PARTIAL** a smaller version is built. **BLOCKED** not built, with the
reason. **N/A** does not belong in HELLO.

## Matrix

| # | Chatdom capability | Upstream | HELLO | Status |
|---|---|---|---|---|
| 1 | Persistent kingdom per channel | `apps/realm`, `packages/world` | One kingdom per event: `src/services/kingdoms.ts`, collection `kingdoms`; terrain derived from a seed (`src/domain/kingdom/world.ts`) | BUILT |
| 2 | Creation and ownership | `apps/codex` Genesis | `foundKingdom` (atomic, `docPutIfAbsent`; second founder gets `DUPLICATE`); founder is monarch | BUILT (no AI "Genesis" ritual) |
| 3 | Monarch authority | `chatdom/Monarch.md` | `governs()` = monarch or `content.moderate`; decree, gates, banish/pardon, approve forge; each audited | BUILT |
| 4 | Citizenship and homes | `packages/world` lots | `kingdomCitizens`; lot claimed through one atomic `docMutate`; home derived from lot, never moves; freed on leave | BUILT |
| 5 | Citizen identity and presence | citizen cards | name, title (screened), position; **no** avatar customisation or presence beyond position | PARTIAL |
| 6 | Shared world state and walking | Colyseus rooms | `move` action: validated tile, max 3 per step, paced; shared through HELLO's SSE nudges (`kingdom*` topics) with a 5 s poll fallback | PARTIAL (tile steps, not continuous real-time movement) |
| 7 | Lane / play | `apps/realm` lanes | nothing equivalent | BLOCKED (depends on a realtime game server) |
| 8 | Generation and rendering | `packages/render`, `voxel` | Seeded island, street plan, isometric canvas renderer (`KingdomWorld.tsx`), terrain cached offscreen | PARTIAL (2D isometric, not a 3D WebGL engine) |
| 9 | Art and visual systems | `chatdom/Artstyle-Soul-Feel.md`, assets | simple palette and emoji kits; no art or audio assets imported | PARTIAL |
| 10 | Realm authority and permissions | `apps/realm` | server re-checks on every action; hiding a button is never the boundary | BUILT |
| 11 | Twitch integration and events | `packages/twitch`, `apps/herald` | **Methodology only**: `ingest` action maps follow/subscribe/cheer/raid to world acts, deduplicated by outside event id. No OAuth, EventSub or webhook exists | PARTIAL (adapter boundary, unverified against Twitch) |
| 12 | Stream overlays | `apps/dock`, stream routes | HELLO already has LiveScene and the privacy filter for streams; no kingdom overlay | BLOCKED |
| 13 | Panel / Twitch Extension | `apps/panel` | not applicable inside HELLO | N/A |
| 14 | Atlas and map | `apps/surveyor`, `/map` | HELLO already has Field Atlas and venue maps; kingdoms are not on them | NEEDS INTEGRATION (later) |
| 15 | Content generation and review | `packages/content`, `/-/content` | The Forge: closed list of 10 kits, matched in EN/DE/ES/FR; monarch must approve | PARTIAL |
| 16 | AI / Codex agent workflows | `apps/codex` | **None.** The forge is deterministic and calls no model; nothing mutates the world without the monarch | BLOCKED |
| 17 | Multilingual names and kits | `packages/emotes` | kit and colour words in four languages | PARTIAL |
| 18 | Raid / caravan | Raid Gate moment | `RAID` becomes a chronicle "caravan" entry (capped at 50 travellers). No animated caravan | PARTIAL |
| 19 | Public entry and gateway | `deploy/`, public build | HELLO's own sign-in and event routing | N/A |
| 20 | Shared contracts | `packages/shared` | zod schemas and typed `KingdomView` | BUILT |
| 21 | Safety and moderation | `chatdom/Safety.md` | screened text (links, handles, hidden direction marks, word list), banish/pardon, approval gate, per-person rate limits | BUILT (word list is small; not a classifier) |
| 22 | Admin and creator workflows | `apps/studio` | throne panel in the page | PARTIAL |
| 23 | Data rights | n/a upstream | erasure and export of kingdom data wired into `rights.ts` | BUILT |

## What HELLO reused

Auth and sessions, `requireCapability`, `audit`, rate limiting, `HelloStore` document collections (Memory and Postgres), the
SSE live layer, the nav model, the erasure and export flow. No second server, port, `.env` or package manifest was added.
