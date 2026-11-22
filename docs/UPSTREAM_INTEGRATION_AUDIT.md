# Upstream integration audit: Offleak → HELLO privacy filter

> **Superseded in part (2026-11-22, later the same day).** Pose heads (people from behind), undecodable QR codes,
> crop zoom, video-file protection, redaction effects, manual areas, camera choice, the studio output for OBS and the
> upload privacy rule were added afterwards, and the extracted upstream folder was removed. The current status is in
> `docs/OFFLEAK_TO_HELLO_COMPLETION_REPORT.md` and the licence findings in `docs/THIRD_PARTY_LICENSE_AUDIT.md`.

Date: 2026-11-22. Every result below comes from a command that was run. Where something was not verified, the
document says so.

## 1. Upstream identity and licence

| | |
|---|---|
| Project | **Offleak**: a real-time privacy filter for IRL streams (Codex × TwitchCon hackathon) |
| Repository | https://github.com/azharizz/offleak |
| Default branch | `main` |
| Commit | `24e6a776079d08f0214e64bda85bcb5ccae3fe06` (2026-11-01T15:21:39Z) |
| Licence | **AGPL-3.0** (`LICENSE`); upstream also notes that Ultralytics and QRDet weights are AGPL-3.0 |
| Version | `app/VERSION` = 0.1.0 |

### Licence consequence for HELLO (read this)

HELLO had no licence file and is `"private": true`. The files below are **adapted from Offleak's AGPL-3.0 code** and
are marked `SPDX-License-Identifier: AGPL-3.0-only` with a pointer to the upstream file:

`src/domain/privacy-filter/{geometry,phone,identity,timings,flow,redactor,heads,orientation,settings,twitch}.ts`,
`src/integrations/twitch/monitor.ts`, `src/components/privacy-filter/engine/{vision.worker,ocr,render,engine,photo}.ts`,
`tests/unit/privacy-filter-core.test.ts` (ported test cases).

The AGPL text is in `LICENSES/AGPL-3.0.txt`. Under AGPL-3.0 §13, if HELLO is distributed or offered to users over a
network with these files in it, the **corresponding source of the combined work must be offered under the AGPL**.
That is a decision for the project's owner. Not shipping these files removes the obligation; the integration is
isolated in the paths above so that it can be removed or replaced cleanly. The models (YuNet MIT, SFace Apache-2.0,
Tesseract data Apache-2.0) and the npm packages (onnxruntime-web MIT, tesseract.js Apache-2.0, jsQR Apache-2.0,
libphonenumber-js MIT) are not AGPL. No Ultralytics or QRDet weights were used.

## 2. Source and archive

The user extracted the upstream ZIP to `D:\HELLO\offleak-main` (outside HELLO's source tree; it has no `.git`). It was
checked against the commit above by comparing SHA-256 of `README.md`, `app/offleak/redaction/redactor.py` and
`app/offleak/twitch/monitor.py` with `raw.githubusercontent.com/.../24e6a77/...`: all three match. Nothing from the
archive was copied into HELLO as a tree, submodule, iframe or link page. The face picture used by one browser test is
read from that folder at run time and never copied (see §12).

## 3. Upstream feature inventory

Upstream is Python 3.11 (OpenCV, PyTorch/Ultralytics, Apple Vision or RapidOCR), a C OBS plugin, a Flask dock and
installers. The `playground/` folder holds experiments and reports that led to `app/`; it is research, not product.

| # | Feature | Source | What it does |
|---|---|---|---|
| U1 | Face detection | `detection/faces.py` (YuNet), `backends/apple/vision.py` | Finds faces; Apple Vision also at any roll |
| U2 | Pose heads + tracking | `detection/heads.py` (YOLO11n-pose + ByteTrack) | Heads of people seen from behind; stable track ids |
| U3 | People kept visible | `detection/faces.py` FaceGallery, `redaction/identity.py`, `config.py` | SFace embeddings; votes 1/0/-1 at .45/.25; nearest vote within `keep` exempts a track; ties reject |
| U4 | Group photo split | `dock/references.py` | One verified crop per person (exactly one face, cosine ≥ .65) or "needs review" |
| U5 | QR codes | `detection/objects.py` TextScan + QRDetModel | Platform QR reader + QRDet YOLO for undecodable codes |
| U6 | Phone numbers | `backends/*/ocr.py`, `phones.py`, `phone_rules.py` | OCR → libphonenumber/NSDataDetector spans → digit-run fallback |
| U7 | Crop zoom | `detection/objects.py` CropZoom (YOLO screens) | Re-reads upscaled screens, phones, paper |
| U8 | Orientation | `detection/orientation.py`, MirrorProbe | Upright quarter turn; mirrored-text vote |
| U9 | Redactor | `redaction/redactor.py` | Lookahead buffer, hold windows, flow carry, chosen-person clearing, **1-second fail-closed** |
| U10 | Optical flow | `redaction/flow.py` | Grid LK at half resolution; carries boxes between detections |
| U11 | Pixelate blur | `redaction/blur.py` | 1/16 downscale + Gaussian σ1.5 + upscale |
| U12 | Live pipeline | `pipeline/live.py` | Detector lanes on newest frame, drop rule, stats, report |
| U13 | Offline file redaction | `pipeline/offline.py`, `cli/redact.py` | Every detector at a fixed cadence; audio copied |
| U14 | CLIs | `cli/stream.py`, `cli/pick_faces.py` | Live from file/URL; pick faces from a video |
| U15 | OBS direct filter | `native/*.c`, `obs/direct_worker.py`, `pipeline/transport.py` | C filter ↔ worker over Unix socket / token TCP |
| U16 | OBS virtual camera + launcher | `obs/virtual_camera.py`, `launcher/` | Alternative path through a virtual camera |
| U17 | Dock | `dock/server.py`, `settings_store.py`, static page | Token-protected: people, capture, upload, switches, fps 5–60, delay 1–30, status |
| U18 | Twitch | `twitch/monitor.py`, dock `/twitch/*` | Implicit OAuth (`user:read:chat`), EventSub live status, `!privacy` from broadcaster/moderator |
| U19 | Debug UI | `ui/` | Pick a video, choose people, watch live |
| U20 | Instrumentation | `instrumentation.py` | `@timed` EMAs → `heads_ms`, `objects_ms` |
| U21 | Installers, models, OBS collection | `installers/`, `scripts/` | macOS DMG, Windows NSIS; model download |
| U22 | Benchmark | `tools/benchmark/` | Synthetic ground truth on real footage |
| U23 | Website | `site/` | Download page |
| U24 | Tests | `tests/` (30 pytest + C harness) | Core, objects, dock, OBS transport |

## 4. Parity matrix

Status key: **IMPLEMENTED** (new in HELLO), **PARTIAL**, **NOT IMPLEMENTED**, **BLOCKED**, **N/A** (not applicable).
HELLO had none of these capabilities before; its closest features were call screen sharing and LiveShield safety
holds (which hide the public live layer, not camera pixels), so nothing was "already implemented".

| # | Status | HELLO implementation | Missing / why |
|---|---|---|---|
| U1 | **IMPLEMENTED** | YuNet 2023mar (same model) via ONNX Runtime Web in a worker; OpenCV FaceDetectorYN decoding (`yunet.ts`); letterboxing to the model's fixed 640×640 input | No Apple Vision (browser) |
| U2 | **PARTIAL** | Faces get stable IoU ids (`FaceIds`, upstream's own fallback) | No pose model: AGPL Ultralytics `.pt` weights need PyTorch. **People seen only from behind are not found.** |
| U3 | **IMPLEMENTED** | SFace (same model), OpenCV alignCrop as Umeyama similarity (`align.ts`), same thresholds, `exempt`, votes | Embeddings stay on the device (IndexedDB), never on the server |
| U4 | **IMPLEMENTED** | `enroll` in `vision.worker.ts`: per-face crop, exactly one face, cosine ≥ .65, else "Photo needs review" | — |
| U5 | **PARTIAL** | BarcodeDetector where the browser has it, else jsQR (repeated, blanking each code) | No QRDet YOLO (AGPL weights): **codes that cannot be decoded are not found** |
| U6 | **IMPLEMENTED** | Tesseract.js (in place of RapidOCR), libphonenumber-js at POSSIBLE leniency, the same fallback rule; boxes from the words each span covers | Different OCR engine: accuracy not benchmarked against upstream |
| U7 | **NOT IMPLEMENTED** | — | Needs a YOLO screen detector. Photos use a 2×2 tile pass for faces instead |
| U8 | **IMPLEMENTED** | `Orientation`, `UprightProbe` (every 10 face passes), MirrorProbe (every 5th text pass) | No Vision roll input |
| U9 | **IMPLEMENTED** | `Redactor` ported line by line; masks become ordered rectangle plans replayed on a canvas | — |
| U10 | **IMPLEMENTED** | Pyramidal Lucas–Kanade in TypeScript (`flow.ts`), same grid, window and levels | ~12 ms per frame on the test machine |
| U11 | **IMPLEMENTED** | `PixelateRenderer` (canvas): same factor and σ | Canvas blur differs from OpenCV at pixel level |
| U12 | **IMPLEMENTED** | `PrivacyEngine`: camera or screen track in, protected track out; lanes, drop count, stats; microphone delayed by the lookahead | — |
| U13 | **PARTIAL** | **Pictures** in Moments posts and stories are protected on the device before upload (re-encoded JPEG, metadata dropped) | **Video files are not filtered**; the composer says so. GIFs pass unfiltered |
| U14 | **N/A** | Calls, the preview and the composers are HELLO's entry points | HELLO has no CLI surface |
| U15 | **N/A** | — | OBS-native C plugin; HELLO is a web app. Its browser equivalent is the call filter |
| U16 | **N/A** | — | Desktop launcher |
| U17 | **IMPLEMENTED** | `/events/[eventId]/privacy-filter` page and `/api/events/[eventId]/privacy-filter`: people, camera capture, photo upload, switches, fps, lookahead, preview with stats | HELLO session + capability checks replace the dock token |
| U18 | **IMPLEMENTED, not verified live** | Server-side EventSub monitor; OAuth start/finish with a single-use state; `!privacy` becomes a HELLO notification and alert | **No real Twitch account was used** (upstream also says it was not tested with one) |
| U19 | **N/A** | The preview on the privacy page covers it | — |
| U20 | **IMPLEMENTED** | `Timings` (`heads_ms`, `objects_ms`, `tick_ms`) | — |
| U21 | **PARTIAL** | `scripts/privacy-assets.mjs`: pinned model download, self-hosted runtime files | No installers (web app) |
| U22 | **NOT IMPLEMENTED** | — | Needs footage and ground truth; the browser test measures one picture |
| U23 | **N/A** | — | Marketing site |
| U24 | **IMPLEMENTED** | Upstream cases ported to vitest; HELLO-specific integration and browser tests | Native C harness N/A |

HELLO additions with no upstream counterpart:

- **Privacy alerts inside HELLO calls.** A call's host, or event staff with `safety.hold`, can ask one person or
  everyone to check their frame. Only the recipient sees the alert. It is audited, and limited to 10 a minute per
  sender. This is upstream's `!privacy` moderator idea applied to HELLO calls.
- **Screen sharing through the filter.** QR codes and numbers on a shared screen are the classic leak.

## 5. Already present in HELLO

Nothing equivalent. These existing pieces were reused rather than duplicated: the `HelloStore` document collections,
`requireCapability` and the permissions table, `notify` / notifications and the chat gateway's delivery hook, the live
nudge bus, the audit log, export and erasure in `rights.ts`, the call signalling and WebRTC room, the Moments upload
path, the Meadow design tokens, and the navigation model.

## 6. Newly implemented

- Domain (pure, tested): `src/domain/privacy-filter/*`.
- Browser engine: `src/components/privacy-filter/engine/*` (worker, OCR lane, renderer, live engine, photo filter,
  on-device gallery).
- Server: `src/services/privacy-filter.ts`, `src/services/privacy-twitch.ts`, `src/integrations/twitch/monitor.ts`.
- UI: the privacy filter page (`PrivacyDock`), the call lobby switch, protected camera and screen, alert banner and
  controls, filter status in the call, and picture protection in `PostComposer` and `StoryComposer`.
- Twitch callback page `/twitch/callback`.

## 7. Blocked or unsupported

| Item | Reason |
|---|---|
| Pose heads (U2), QRDet (U5), crop zoom (U7) | Ultralytics/QRDet YOLO weights are AGPL `.pt` files that need PyTorch; converting and shipping them was not done |
| Apple Vision backend | Browser |
| OBS plugin, virtual camera, launcher, installers | Desktop/OBS-native; not meaningful in a web app |
| Video-file redaction | Not built yet (would need frame-by-frame decode and re-encode in the browser) |
| Live Twitch verification | Needs a registered Twitch app and account |
| Audio redaction | Upstream does not do it either; audio is delayed, never filtered |

## 8. Important files changed

New files are listed in §1 and §6. These existing files were changed:

| File | Change |
|---|---|
| `src/domain/product.ts` | `PrivacyFilterRecord`, `PrivacyAlert`; collections `privacyFilters`, `privacyAlerts` |
| `src/lib/live/store.ts` | Live nudges for the two collections go to the owner or recipient only |
| `src/services/calls.ts` | `privacy-alert` action; polls return the caller's alerts; `getCall` returns `canAlert` |
| `src/services/rights.ts` | Export and erasure include the privacy filter; erasure disconnects Twitch |
| `src/app/api/events/[eventId]/calls/[callId]/route.ts` | Separate 10/minute limit for alerts |
| `src/components/calls/CallRoom.tsx`, call page | Filter switch, protected tracks, delayed microphone, alerts |
| `src/components/moments/PostComposer.tsx`, `StoryComposer.tsx` | Picture protection before upload |
| `src/components/live/client.ts` | `api()` accepts PUT |
| `src/components/live/topics.ts` | Refresh topics for calls and the privacy page |
| `src/components/layout/nav-model.ts`, `src/app/layout.tsx`, `src/styles/privacy.css` | Nav entry ("Privacy filter"), styles |
| `next.config.mjs` | CSP adds only `'wasm-unsafe-eval'` (WebAssembly compile; not JS eval). `connect-src 'self'` is unchanged |
| `package.json` | 4 dependencies; `privacy:assets`, `predev`, `prebuild`; journey added to `test:e2e` |
| `.gitignore`, `.env.example`, `.github/workflows/ci.yml` | Ignore `public/vendor`, `public/models`; `HELLO_PUBLIC_URL`; CI downloads models |
| `tests/e2e/route-crawl.mjs`, `tests/e2e/product-flow.mjs` | Crawl the new page; honour `CHROMIUM_PATH` like the other journeys |

## 9. Database and migrations

No SQL migration is needed. HELLO stores product records as typed documents in one generic table
(`hello_documents (collection, id)` on Postgres, a map in memory); the two new collection names are registered in
`COLLECTION_NAMES`. No existing data is touched.

- `privacyFilters`: `{ id = userId, userId, enabled, fps, delay, faceEnabled, qrEnabled, phoneEnabled, updatedAt }`.
  Written with `docPutIfAbsent` then `docMutate`, so concurrent changes merge (tested).
- `privacyAlerts`: `{ id, eventId, recipientUserId, senderUserId | null, senderName, source: CALL | TWITCH, callId, createdAt, acknowledgedAt }`.

**Not run:** `npm run test:postgres` (no Postgres was available in this session). The new collections use only the
document operations that suite already covers, but this was not re-run.

## 10. API and UI

| Route | Who | Does |
|---|---|---|
| `GET /api/events/:id/privacy-filter` | member | Own settings, own alerts, own Twitch state, own user id |
| `PUT /api/events/:id/privacy-filter` | member | Partial settings update (5–60 fps, 1–30 s, booleans; unknown keys refused) |
| `POST /api/events/:id/privacy-filter` `{action:'ack'}` | recipient | Acknowledge an alert (another person's alert is reported as not found) |
| `POST /api/events/:id/privacy-filter/twitch` | member | `start` (client id → authorise URL), `disconnect` |
| `POST /api/twitch/finish` | the signed-in person who started | One-time state plus token → monitor |
| `POST /api/events/:id/calls/:callId` `{action:'privacy-alert'}` | call host or `safety.hold` staff in the call | Alert one peer or everyone else |

Pages: `/events/:id/privacy-filter`, `/twitch/callback`. Calls, posts and stories gained the controls in §6.

## 11. Security and privacy

- **No frames, faces or embeddings reach HELLO's server.** Filtering happens in the browser before a track is sent or
  a picture uploaded. People kept visible are stored in IndexedDB per HELLO account and are never in any API. Export
  says where they are, and "Remove everyone" deletes them.
- **Fail closed** (upstream rule, tested): until every switched-on detector has reported within one second of a frame,
  that frame is blurred whole. A model that cannot load means the whole picture stays blurred, and the page shows the
  reason. A photo whose QR or phone check fails is blurred whole.
- **Off by default.** The filter delays and blurs the person's own picture, so it is the person's choice. It is shown
  in every call lobby and composer.
- **Authorisation on the server:** every service calls `requireCapability`. Alerts need the call's host or
  `safety.hold`, and the sender must own the peer id they speak for. Alerts and settings are nudged only to their owner.
- **Twitch:** `user:read:chat` only; no client secret; the token is held in server memory only (never stored, logged
  or returned); the state is 32 random bytes, single use, 5 minutes, compared in constant time and bound to the HELLO
  user who started it. Reconnect URLs must be `wss://eventsub.wss.twitch.tv` with no credentials or other port.
  Erasure disconnects.
- **CSP:** only `'wasm-unsafe-eval'` was added. Runtime files and models are self-hosted, so the browser still
  connects to HELLO's own origin only. All `/api` calls keep the same-origin check in `src/proxy.ts`.
- **Erasure:** deletes the person's settings and received alerts; alerts they sent keep the recipient's record and
  lose the sender's name. **Export:** settings and received alerts.
- **Limits:** settings 60 a minute, Twitch 20 a minute, alerts 10 a minute per person (per instance, like HELLO's
  other limits).

## 12. Tests and results (2026-11-22)

| Command | Result |
|---|---|
| Baseline before any change: `npx tsc --noEmit`, `npx vitest run` | tsc 0 errors; 48 files, 511 passed, 3 skipped |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint src tests` | 0 problems |
| `npx vitest run` (from PowerShell with an upper-case `D:` path, see below) | **50 files, 565 passed, 3 skipped** (+54: 43 unit, 11 integration) |
| `npm run build` | Passes; route table lists `/events/[eventId]/privacy-filter`, `/twitch/callback` and the new API routes |
| `node tests/e2e/privacy-filter-flow.mjs` (production build, demo mode, Chromium 1255 via `CHROMIUM_PATH`, production CSP) | **8/8 passed** |
| `node tests/e2e/call-flow.mjs` | 4/4 |
| `node tests/e2e/route-crawl.mjs` | 400 pages (was 390; now includes the privacy page for every role), 45 correctly denied, 0 problems |
| `product-flow`, `features-flow`, `judge-flow`, `private-messages`, `workflow-audit`, `field-atlas-flow`, `field-live-flow`, `outbox-flow`, `live-flow` | All passed (product-flow after letting it honour `CHROMIUM_PATH`) |
| `chat-bridge-flow`, `npm run test:postgres` | **Not run** (needs a chat secret and bridge; needs Postgres) |

What the browser journey measured with the **real models** (not mocks):

- Live preview on Chromium's fake camera: about 7 face checks/s, 13 code/number checks/s, and 12 fps output averaged
  from the start (target 15). Optical flow costs about 12 ms per frame on the main thread.
- Fail closed: with the YuNet request blocked, the page showed "Blurring everything" and the reason, and counted fully
  blurred frames.
- Picture protection, on a frame of upstream's own demo clip (read from `../offleak-main`, never copied): the server
  received a JPEG; face-area detail fell to **0.18×** the original. After adding that face as a person kept visible
  it was **0.88×** (JPEG re-encoding only); after removing them, blurred again.
- A two-browser call with the filter on connected; the host's alert reached only the recipient, who acknowledged it.

Mocks and fakes, stated plainly: Twitch is tested with a fake HTTP table and scripted sockets, never against Twitch.
The camera is Chromium's synthetic device (no faces), so live face blurring was verified on still pictures, not on a
live face. No accuracy benchmark comparable to upstream's (99.5% QR, 99.7% phone, 98.3% bystanders) was run; **those
upstream numbers do not apply to this port.**

Environment note: on this machine vitest fails every file with "Cannot read properties of undefined (reading
'config')" when started from a lower-case `d:\` working directory (two module instances). Run it from `D:\`.

## 13. Remaining work and limitations

1. Decide the licence question in §1 before distributing HELLO.
2. Pose-based heads (people from behind), undecodable QR codes (QRDet), and screen crop-zoom need ONNX exports of AGPL
   YOLO weights.
3. Video-file protection in Moments.
4. A benchmark on real footage before claiming any accuracy figure.
5. Live verification with a registered Twitch app.
6. Run `npm run test:postgres`.
7. Performance on low-end phones has not been measured. The fps setting exists for that, and the filter drops frames
   rather than letting the delay grow.
8. It is a safety net, not a guarantee: a face, a code or a number under about 12 px can be missed (upstream says the
   same). Audio is delayed, never filtered.
