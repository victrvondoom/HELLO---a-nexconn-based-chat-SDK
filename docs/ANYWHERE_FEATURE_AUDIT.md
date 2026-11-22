# Anywhere feature parity (audit, 2026-11-22)

**Scope note.** The brief names the official Anywhere pages (YC profile, launch, website, App Store listing, privacy
policy, terms). This audit did not fetch them, so the "Anywhere capability" column reflects the brief's own description,
not a checked reading of those pages. Re-verify against the live sources before relying on the table.

Status key: **Implemented** (working and tested), **Partial** (some of it works; the gap is named), **Not implemented**,
**Not applicable here** (needs a platform this environment does not have).

| Anywhere capability (per brief) | HELLO implementation | Status | Verification |
|---|---|---|---|
| Personal place memory: saved places, favourites, lists, ratings, private notes | `SavedPlace`, `PlaceCollection`, My places page | **Implemented** | Integration tests (owner-only, versions, sealing, export, erasure); browser flow 14 of 14 |
| Place source and provenance | Source kinds: MANUAL, VENUE_MAP, MESSAGE, LINK, IMPORT, PHOTO | **Implemented** for these kinds | Capture integration tests; browser capture flow 17 of 17 |
| Capture from conversations | Text is matched against places HELLO already knows (venue, saved places). It does not find places it has never heard of | **Partial** | `tests/unit/place-capture.test.ts`, `tests/integration/place-capture.test.ts` |
| Capture from links | Google Maps place links and `geo:` links are read from the link. Other links need a name typed by the person | **Partial** | Unit and integration tests; browser flow |
| Import Google Maps lists or Takeout | Takeout saved-place CSV and GeoJSON files, row by row, with failures listed and a history | **Implemented** for files | Parser unit tests; browser import flow |
| Google shared-list URLs | Not built. Only files the person exports are read | **Not implemented** | Not applicable: no protected endpoint is used |
| Photos and spatial memories | JPEG GPS read in memory on request; the photo is not kept | **Partial**: no photo library access, no timeline of photos | EXIF parser unit tests against built JPEG bytes; browser photo flow |
| Map-first experience: pins, place cards, search | Pins on the venue plan, card list, search, filters | **Partial**: no globe, no 3D, no clustering, no layers | Browser flow |
| Visit detection, stays, trips | Manual check-in at a venue space; end, correct and delete | **Partial**: no automatic detection, no trips, no stop locations | Visit integration tests; browser flow |
| Estimated destination and arrival time | Not built | **Not implemented** | Requires live position and a route provider |
| Fog-of-exploration | Not built | **Not implemented** | Requires visit history at scale |
| Friends and granular location sharing | Not built | **Not implemented** | Requires grants with server enforcement |
| Calendar-aware plans | Not built | **Not implemented** | Requires calendar access |
| Conversational spatial assistant with place cards | Not built | **Not implemented** | Requires grounded place search |
| AI agent connectivity, scopes, undo, audit | Not built | **Not implemented** | See `HELLO_AGENT_ACCESS_MODEL.md` |
| Native iOS: background location, visits, Motion, geofence, Calendar, photo library, share sheet, push | Not built | **Not applicable here** | Needs an iOS build and a device |

## Deferred, with reasons

- **Background location, trips and arrival estimates.** A browser cannot provide them reliably, and they need a native
  client plus a separate opt-in. They are not claimed.
- **Sharing, calendar and agents.** Each needs its own permission model. Building them without one would break the
  privacy requirement.
- **Globe and 3D.** The brief allows 2D as the baseline. Only 2D venue plans exist.
