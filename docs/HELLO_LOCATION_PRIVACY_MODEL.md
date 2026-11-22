# HELLO location privacy model (as built, 2026-11-22)

This describes what the code does today. It is not a promise about features that do not exist yet.

## Where location comes from

- **Typed by the person.** Coordinates on a place are numbers the owner types in.
- **From a link the person pasted.** The coordinates are read from a Google Maps or `geo:` link. HELLO does not open it.
- **From a file the person chose.** Takeout coordinates are read from the file's rows.
- **From a photo the person chose.** The GPS tags are read in memory for that one request. The photo is not stored, and
  its other metadata is not read. The person sees the coordinates before anything is saved.
- **From a check-in the person made.** A visit is recorded only when the person checks in at a venue space. There is no
  background detection and no device position.

HELLO does not read the device's location in any of these flows. The existing opt-in live location (`locations`,
LiveScene) is unchanged by this work.

## What is stored, and what is not

| Kept | Why |
|---|---|
| Place name, category, status, rating, tags, address, typed coordinates, venue space | The place itself |
| Private note, sealed at rest with the server vault | Only the owner can read it |
| Source kind, and for a link the host name only (never the path or query) | Provenance without leaking a link's tokens |
| Import file name, counts, and the rows that could not be read | So the person can see what happened |
| Visit: venue space, arrival, departure, optional linked place, whether corrected | The person's own history |

| Not kept | Why |
|---|---|
| The photo's bytes | Only its location is needed |
| The photo's other metadata, including the camera model and any name in the file name | Not needed, and may be personal |
| The contents of an import file | Only the rows the person chose are saved |
| The full URL of a link | Paths and query strings can carry tokens |

## Visibility

- Places, collections, visits and imports are private. The only reader is the owner, through services that check
  `ownerId` on every call. Another person's record is reported as not found.
- Notes are sealed with a context that binds them to the owner and the place, so a note cannot be moved onto another record.
- Live refresh tells only the owner that their records changed. Nobody else is told.

## Erasure and export

- Export includes places, notes, collections, visits and import history for the person.
- Erasure removes all of them, in every event. Tested in `tests/integration/places.test.ts` and
  `tests/integration/place-capture.test.ts`.

## Device keys

Each browser is a device with its own encryption key. A person may have at most 8 published device keys. When a ninth
device publishes, the oldest key is removed so the new device can work. Messages already sealed to the removed key stay
readable on that device, because its private key never left it. Messages sent after that go to the newest device.

## Not built, and what each would need

- **Background location and visit detection.** Needs a native client, its own opt-in with a plain explanation, local
  processing of raw readings, and synchronisation of summaries only.
- **Friend sharing.** Needs explicit per-person grants with precision, expiry and revocation enforced on the server.
- **Home, work and school labels.** Must stay private unless explicitly shared.
- **Agent access to any of this.** Needs a separate grant per sensitive category.
