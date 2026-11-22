# HELLO Living Atlas: architecture (as built, 2026-11-22)

This describes what is implemented. Items marked **not built** are not present in any form.

## What is built

Everything below is personal to one person within one event, and private to that person.

| Part | Where |
|---|---|
| Data model: `SavedPlace`, `PlaceCollection`, `PlaceVisit`, `PlaceImport`; source kinds MANUAL, VENUE_MAP, MESSAGE, LINK, IMPORT, PHOTO | `src/domain/product.ts` |
| Rules: vocabulary, limits, coordinates, ratings, tags, filter and order, note sealing context | `src/domain/places/rules.ts` |
| Capture parsers (pure): text mentions, time hints, Google Maps and geo links, RFC 4180 CSV, Takeout CSV and GeoJSON, JPEG EXIF GPS | `src/domain/places/capture.ts` |
| Place service: list, create, update (version-checked), delete, collections, export, erasure | `src/services/places.ts` |
| Capture service: preview (writes nothing), save (only the candidates chosen), photo preview, import history | `src/services/place-capture.ts` |
| Visit service: check-in, end, correct times (validated), delete | `src/services/place-visits.ts` |
| Routes | `src/app/api/events/[eventId]/places/` (list and create, one place, collections, capture, capture/photo, capture/save, visits, one visit) |
| Validation (zod) | `src/lib/validation/places.ts` |
| Page and client components | `src/app/events/[eventId]/places/page.tsx`; `src/components/places/PlacesBoard.tsx`, `PlaceCapture.tsx`, `PlaceVisits.tsx`, `api.ts` |
| Live refresh for the owner only | `src/lib/live/store.ts`, `src/components/live/topics.ts` |
| Export and erasure (places, collections, visits, import history) | `src/services/rights.ts`, `src/services/places.ts` |
| Device-key limit: oldest key retired at the limit | `src/services/private-messages.ts` (`publishKey`), `deleteKeyBundle` in the store contract and both adapters |

## Data model

- `SavedPlace`: name, description, category, `spaceId` (a venue space or null), `latitude`/`longitude` (both or neither),
  address, status, favourite, rating, `privateNoteSealed` (sealed with the server vault), collections, tags, `source`,
  `visibility` (always PRIVATE), timestamps, `updates`, `version`.
- `PlaceVisit`: `spaceId`, optional `placeId`, `arrivedAt`, `departedAt` (null while the person is still there),
  `method` (always CHECK_IN), `correctedAt`, `version`.
- `PlaceImport`: `fileName`, `format`, counts (`total`, `saved`, `skipped`), and the rows that could not be read
  (`line`, `reason`, at most 100 kept).
- All are typed document collections. The Postgres adapter stores every collection in its generic table, so no
  migration is needed. The Postgres suite has not been run against these changes.

## How capture works

1. **Preview** reads the input and returns candidates with their source written out. It saves nothing.
2. **Save** writes only the candidates the person ticked. A candidate already in the list is skipped with the reason.
   A candidate the place rules refuse is reported, and the rest still save.
3. **Text** matches names the system already knows: venue spaces, venue points of interest, and the person's own
   places. Longer names win over shorter ones. It never guesses a place it does not know.
4. **Links** are read from the link itself. Only Google Maps and `geo:` links are read. HELLO never opens a link.
   A link it cannot read is kept only when the person names it.
5. **Imports** accept Google Takeout saved-place CSV and GeoJSON. Rows that cannot be read are listed by line number.
   The import history keeps the file name, the counts and the failures.
6. **Photos** are read in memory for the request. Only the GPS coordinates and the capture date are used. The photo is
   not stored. A photo with no location says so.

## Authorisation

Every service function first requires `event.read` (any member), then loads the record and checks `ownerId` and
`eventId`. Another person's place, visit or import is reported as NOT_FOUND. Edits are compare-and-set on `version`,
so a stale edit is refused with VERSION_CONFLICT. A visit can only be checked in to a space on this event's venue map.

## Live updates

Writes to places, collections, visits and imports publish an owner-only nudge. Nobody else is told anything changed.
The page refreshes through the existing `LiveRefresh` component.

## Not built

- **Automatic visit detection, trips, stop locations, travel mode, ETA and destination.** These need background
  location, which a browser cannot provide reliably. A native iOS client would be needed. Nothing here claims them.
- **Fog-of-exploration map layer, globe and 3D.** Only 2D venue plans exist.
- **Google shared-list URLs.** Only files the person exports and chooses are imported. No protected endpoint is used.
- **Photo library access.** HELLO reads only a photo the person selects.
- **Friends and location sharing (Phase 4).** Places and visits are private. There is no sharing grant.
- **Calendar and plans (Phase 5).**
- **External agents (Phase 6).** See `HELLO_AGENT_ACCESS_MODEL.md`.
- **Native iOS capabilities.** This environment has no iOS target or device, so none are implemented or claimed.
