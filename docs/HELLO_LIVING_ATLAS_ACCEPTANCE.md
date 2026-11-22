# HELLO Living Atlas: acceptance and evidence (2026-11-22)

## Phase 1: personal place memory (accepted)

Acceptance from the brief: "a user can create, edit, organize, search and display their saved places on a map without
using mock data."

| Criterion | Evidence |
|---|---|
| Create a place with a category, status, rating, tags, optional venue pin and coordinates | `tests/integration/places.test.ts`; browser flow "saving a place" |
| Edit a place; a stale edit is refused | `tests/integration/places.test.ts`; browser flow "an edit is saved and shown" |
| Favourites, collections, status | `tests/integration/places.test.ts`; browser flow |
| Search and filter | `tests/unit/places-rules.test.ts`; browser flow |
| Display on the venue map | browser flow "the place is pinned on the venue plan" |
| Private: another person cannot see or change it | `tests/integration/places.test.ts`; browser flow "another attendee does not see Ada's place" |
| Note is sealed at rest | `tests/integration/places.test.ts` |
| Export and erasure include places | `tests/integration/places.test.ts` |

## Phase 2: capture and import (accepted for the sources listed)

Acceptance from the brief: "a user can import a list of places, review it, save selected records and see the resulting map."

| Criterion | Evidence |
|---|---|
| Text is matched only against known places, and nothing is saved on preview | `tests/integration/place-capture.test.ts` (text); browser capture flow |
| A time mentioned in text is shown for the person to check, and is never saved | `tests/unit/place-capture.test.ts` (time hints); browser capture flow |
| Google Maps links are read from the link, never opened | `tests/unit/place-capture.test.ts` (links); integration test (non-map link kept only when named) |
| Takeout CSV and GeoJSON are read row by row; bad rows are listed with line numbers | `tests/unit/place-capture.test.ts` (CSV, GeoJSON); browser import flow |
| Chosen rows are saved, duplicates are skipped with a reason, and the import is recorded | `tests/integration/place-capture.test.ts` (import); browser import flow |
| A photo's GPS is shown before saving; the photo is not stored; its file name is not used | `tests/unit/place-capture.test.ts` (EXIF); `tests/integration/place-capture.test.ts` (photo, export contains no file name); browser photo flow |
| Provenance is recorded per place (source kind and reference) | Capture integration tests |

## Phase 3: visits (accepted for manual check-in only)

| Criterion | Evidence |
|---|---|
| Check in at a venue place; a new check-in ends the previous visit | `tests/integration/place-capture.test.ts` (visits); browser flow |
| Correct times; an end before a start, or a time in the future, is refused | Same file |
| End a visit; delete a visit after confirmation | Same file; browser flow |
| Another person's visit is not reachable | Same file |

Not accepted: automatic visit detection, trips, stop locations, ETA. These need native background location and are not
claimed.

## Device keys (fixed)

A person can publish at most 8 device keys. The 9th device now retires the oldest key instead of failing with a 422 on
every page. Test: `tests/integration/place-capture.test.ts` (device keys). The earlier failure was reproduced in the
browser crawl before the fix.

## Results, 2026-11-22

- Full suite: 44 files, 470 tests passed, 1 skipped (the skip predates this work).
- Typecheck and ESLint over `src` and `tests`: clean.
- Production build: passes; all new routes and pages are in the route table.
- Real browser, production build:
  - My places flow: 14 of 14.
  - Capture flow (text, link, import with a bad row, photo, check-in, end, delete, isolation): 17 of 17.
  - No uncaught exceptions, console errors or failed API calls in either flow.
- Live smoke test over HTTP (LiveScene and LiveShield): 16 of 16.
- Site crawl, 34 routes as an attendee and as an organiser: no uncaught exceptions and no server errors. The remaining
  404s are staff-only pages hidden from attendees, and placeholder IDs that do not exist.

## Not accepted

- Phases 4 to 6 of the brief: sharing, calendar and plans, external agents.
- Native iOS behaviour. Not testable here.
- The Postgres adapter for the new collections. The Postgres suite was not run.
