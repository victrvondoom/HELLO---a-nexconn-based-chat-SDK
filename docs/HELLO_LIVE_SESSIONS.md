# Live sessions (2026-11-22)

Routes: `/events/:id/now` (rooms running now and next), `/events/:id/now/:sessionId` (the live room),
`/events/:id/now/:sessionId/full` (room-full display, staff). API under `/api/events/:id/now/**`.
Service: `src/services/live-room.ts`. Rules: `src/domain/companion/`.

## Built and verified

- **Room QR**: each live room shows a QR code that opens that room. It grants no membership; people still sign
  in. Personal contact QR codes do not exist yet and will be a different code.
- **Can't hear / can't see** (`signalAv`): one document per person, session and kind, so repeated taps never
  count twice. When **3 distinct people** report the same kind in the same session within **60 seconds**
  (`AV_THRESHOLD`, `AV_WINDOW_MS`), the uncounted signals are claimed with a conditional write and **one** AV
  report is filed through `ingestReport`, whose duplicate gates attach later crossings to the same open
  incident. Staff see distinct counts on Operations → Venue and AV. Reporters see "the AV team is on it",
  then "Better now?" once the incident is no longer open; "Still bad" is a fresh signal.
- **Questions**: grouped by keyword similarity (Jaccard ≥ 0.5 with four-letter stem matching), votes, at most
  five open questions per person per session. Other attendees never see who asked.
- **Timeline** and add-to-plan.

Tests: `tests/integration/live-room.test.ts` (Test C, AV window, not-running refusal, grouping and privacy).

## Externally blocked

Captions, listen-in audio and slides need a media provider: a group-call/broadcast transport for audio (the
Nexconn Call SDK is installed but a broadcast mode for hundreds of listeners is not verified) and a streaming
transcription service with speaker and venue consent. Ordinary chat messages are not an audio transport. Until
one is configured the room states "not available" rather than showing anything invented.

## Planned

Personal jargon coach and one-minute knowledge probe, post-talk report (transcript, slides, per-minute signal
timeline, grouped and unanswered questions), translation. These depend on captions.
