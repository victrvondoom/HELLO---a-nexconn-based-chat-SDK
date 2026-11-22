# Offleak → HELLO: completion report

Written for: HELLO's owner and the developers who maintain the privacy filter.
Date: 2026-11-22. Every number below was measured in this session on this machine (Windows 11, Chromium 1255,
CPU only, WebAssembly single-threaded). Nothing is copied from upstream's benchmarks. Where something was not run,
this says so.

**In one paragraph.** Offleak no longer exists as a separate program anywhere in the workspace. Its features run
inside HELLO: in the browser (all detection and redaction, so raw camera frames, screens, pictures and faces never
reach the server) and in HELLO's existing Next.js server (settings, alerts, Twitch, upload rules). There is one
`package.json`, one lockfile, one `.env.example`, one `.gitignore`, one dev command, one build, one start command,
one server process and one port. The extracted upstream folder was deleted after verification. What could not be
matched exactly: QRDet (replaced by a finder-pattern locator), YOLO11n-pose (YOLOv8n-pose used instead), the native
OBS plugin and installers (desktop-only; replaced by browser equivalents), and accuracy parity is unmeasured.
**The licence question (AGPL-3.0) is open and is the owner's to decide** (`docs/THIRD_PARTY_LICENSE_AUDIT.md`).

## 1. Upstream feature inventory

Upstream: https://github.com/azharizz/offleak, commit `24e6a77`, AGPL-3.0. Python 3.11 + OpenCV + PyTorch/Ultralytics
+ Apple Vision or RapidOCR, a C OBS plugin, a Flask dock, installers. The whole source was inspected (`app/`, and
`playground/`, which holds experiments and reports rather than product code).

| # | Feature | Upstream source |
|---|---|---|
| U1 | Face detection (YuNet; Apple Vision on macOS) | `detection/faces.py`, `backends/apple/vision.py` |
| U2 | People from behind: YOLO pose heads + ByteTrack ids | `detection/heads.py` |
| U3 | People kept visible: SFace votes, keep window, ties reject | `detection/faces.py`, `redaction/identity.py` |
| U4 | Group photo split into verified single-person crops | `dock/references.py` |
| U5 | QR codes: platform decoder + QRDet for undecodable codes | `detection/objects.py` |
| U6 | Phone numbers: OCR + phone-number rules | `backends/*/ocr.py`, `phones.py`, `phone_rules.py` |
| U7 | Crop zoom: YOLO11n screens/phones/paper, upscaled re-read | `detection/objects.py` CropZoom |
| U8 | Orientation: upright probe, mirrored-text vote | `detection/orientation.py`, MirrorProbe |
| U9 | Redactor: lookahead, holds, flow carry, one-second fail-closed | `redaction/redactor.py` |
| U10 | Optical flow (grid Lucas–Kanade) | `redaction/flow.py` |
| U11 | Pixelate effect | `redaction/blur.py` |
| U12 | Live pipeline: lanes, drop rule, stats | `pipeline/live.py` |
| U13 | Offline file (video) redaction, audio copied | `pipeline/offline.py`, `cli/redact.py` |
| U14 | CLIs (stream, pick faces, redact) | `cli/` |
| U15 | OBS direct filter (C) + Python worker over sockets | `native/*.c`, `obs/direct_worker.py`, `pipeline/transport.py` |
| U16 | OBS virtual camera + desktop launcher | `obs/virtual_camera.py`, `launcher/` |
| U17 | Dock: people, capture, upload, switches, fps, delay, status | `dock/server.py`, static page |
| U18 | Twitch: OAuth, EventSub live status, `!privacy` | `twitch/monitor.py` |
| U19 | Debug UI | `ui/` |
| U20 | Instrumentation (stage timings) | `instrumentation.py` |
| U21 | Installers, model download, OBS scene collection | `installers/`, `scripts/` |
| U22 | Benchmark on footage with ground truth | `tools/benchmark/` |
| U23 | Marketing website | `site/` |
| U24 | Tests (pytest, C harness) | `tests/` |
| U25 | Audio: microphone delayed with the picture (never filtered) | `pipeline/live.py`, OBS sync offset |

## 2. Parity matrix

Status: **WORKING** (in HELLO, verified), **EQUIVALENT** (same purpose, different mechanism, verified),
**PARTIAL**, **BLOCKED** (dependency or platform), **N/A** (no meaning in HELLO, with the reason).

| # | Upstream | HELLO before this pass | Work done in this pass | Final |
|---|---|---|---|---|
| U1 | YuNet, Apple Vision | YuNet in the browser | — | **WORKING** (no Apple Vision: browser) |
| U2 | yolo11n-pose + ByteTrack | missing (faces only) | YOLOv8n-pose ONNX lane in its own worker; `headBox` and the pose/face merge ported; ByteTrack-style tracker | **WORKING** with YOLOv8n-pose (11n-pose has no ONNX export) |
| U3 | SFace votes | working | votes now attach to pose heads | **WORKING** |
| U4 | Group split | working | — | **WORKING** |
| U5 | QR decode + QRDet | decodable codes only | finder-pattern locator for undecodable codes | **EQUIVALENT** (QRDet BLOCKED: PyTorch-only weights) |
| U6 | Phone numbers | working | also read inside zoomed screens | **WORKING** (Tesseract instead of RapidOCR) |
| U7 | Crop zoom | missing | YOLO11n ONNX screen lane; crops re-read by QR and OCR; own live lane, every 6th frame in video | **WORKING** |
| U8 | Orientation | working | — | **WORKING** |
| U9 | Redactor | working | crop-zoom boxes that never satisfy the fail-safe; manual areas | **WORKING** |
| U10 | Optical flow | working | also drives video tracking | **WORKING** |
| U11 | Pixelate | working | blur and blackout effects; a setting | **WORKING** (3 effects) |
| U12 | Live pipeline | working | pose and zoom lanes; 5 s stalled-lane watchdog; 30 s load timeout | **WORKING** |
| U13 | File redaction | pictures only; video not filtered | video: every decoded frame detected, tracked, redacted, encoded to WebM (VP9/VP8 + Opus); progress; cancel | **WORKING** |
| U14 | CLIs | — | — | **N/A**: HELLO has no CLI; the media tool covers redact and pick-faces |
| U15 | OBS direct filter | — | studio output page for OBS Window Capture; the camera picker accepts OBS Virtual Camera as input | **EQUIVALENT** (native plugin BLOCKED, §4) |
| U16 | Virtual camera, launcher | — | OBS Virtual Camera usable as an input via the camera picker | **EQUIVALENT** (launcher N/A) |
| U17 | Dock | page existed | effect, people and screen switches, camera picker, screen preview, model status, media tool | **WORKING** |
| U18 | Twitch | implemented, fakes only | — | **WORKING, not verified with a real Twitch account** |
| U19 | Debug UI | preview | — | **N/A** (the privacy page's preview and stats replace it) |
| U20 | Timings | working | zoom timing, per-pass counts | **WORKING** |
| U21 | Installers, models | model script | two more pinned models | models **WORKING**; installers **N/A** (web app) |
| U22 | Benchmark | missing | region-level measurements on real pictures (§12) | **PARTIAL**: no ground-truth accuracy benchmark |
| U23 | Website | — | — | **N/A** (marketing) |
| U24 | Tests | ported unit tests | 20 unit, 2 integration and 17 browser checks added | **WORKING** |
| U25 | Audio sync | working in calls | video export carries the sound over | **WORKING** (audio never filtered, as upstream) |

HELLO additions with no upstream counterpart: privacy alerts in calls; server refusal of unfiltered uploads (§8);
place photos send only their EXIF block; per-detection review and hand-drawn hide areas; blur and blackout effects.

## 3. Features integrated in this pass

1. **People seen from behind** (`yolo.ts`, `heads.ts` `headBox`/`mergeHeads`, `tracker.ts`, worker `people()`).
2. **Undecodable QR codes** (`finder.ts`, worker `qr()`).
3. **Crop zoom** on screens, phones, paper (`zoom.ts`, `scan.ts` `ObjectScanner.zoom`, worker `screenBoxes()`).
4. **Video protection** (`engine/video.ts`) in Moments posts, stories and the media tool.
5. **Effects**: pixelate, blur, blackout (`render.ts` `MaskRenderer`, `effect` setting).
6. **Review and manual redaction** for pictures (leave a false alarm visible, draw hide areas) and manual areas for
   video (`MediaTool.tsx`, `photo.ts` `detectPhoto`/`renderPhoto`, `Redactor.withManual`).
7. **Camera choice**, including OBS Virtual Camera, used by the preview, calls and the studio (`devices.tsx`).
8. **Screen-share preview** on the privacy page.
9. **Studio output** (`/events/:id/privacy-filter/studio`) for OBS Window Capture.
10. **Model status** table on the privacy page.
11. **Fail-closed hardening**: a lane runs only when all its models loaded (otherwise frames stay hidden); 30 s load
    timeout; 5 s stalled-lane watchdog; GIFs refused while protecting.
12. **Upload rule** on the server, and **place photos without pixels** (§8).

## 4. Blocked, and why

| Item | Why | What HELLO does instead |
|---|---|---|
| QRDet | Published only as PyTorch `.pt` weights; no ONNX export exists. A browser cannot run PyTorch, and a Python service is excluded by the single-runtime rule. | Finder-pattern locator: finds codes whose three corner squares are visible; misses codes whose corners are hidden; gives false positives on grid-like surfaces (measured in §12). |
| YOLO11n-pose | No published ONNX export; exporting needs Ultralytics + PyTorch | YOLOv8n-pose (Xenova's ONNX export), same keypoint format |
| Pose at 960 px input | The ONNX exports are fixed at 640 | 640 px; still pictures add a 2 × 2 tile pass |
| Apple Vision | macOS framework | YuNet everywhere |
| Native OBS filter (C plugin + Python worker over sockets) | Needs the OBS SDK compiled per platform and a native worker process (a second runtime) | Studio output window (OBS Window Capture), and OBS Virtual Camera as an input |
| Installers, launcher | Desktop packaging | HELLO opens in a browser; models via `npm run privacy:assets` |
| Real OS screen capture in automated tests | On this machine Chromium returns `NotReadableError` for tab, window and whole-screen capture, headless and headed | The test replaces only the capture source with a canvas "screen"; everything after it is HELLO's real code, including a real two-person call (§12) |
| Live Twitch check | Needs a registered Twitch app and account | Tested with fakes, as before |
| Accuracy benchmark comparable to upstream's | Needs labelled footage | Region-level measurements on real pictures only |
| Animated GIFs | Not decoded frame by frame | Refused while protection is on |

## 5. Frontend integration

Everything is inside HELLO's existing app, navigation ("Privacy filter" in the event), design tokens and components:

- `/events/:id/privacy-filter`: preview (camera or shared screen), camera picker, switches (faces, people from
  behind, QR codes, phone numbers, screen zoom), effect, fps and lookahead, people kept visible, **Protect a picture
  or video** (review, manual areas, progress, preview, download, post to Moments), models table, OBS section,
  Twitch, alerts, how it works.
- `/events/:id/privacy-filter/studio`: full-window protected camera; H hides the controls.
- Calls: lobby switch, protected camera and screen share, delayed microphone, in-call stats and alerts (existing),
  now using the chosen camera.
- Moments posts and stories: pictures **and videos** protected before upload; the per-file opt-out is shown; GIFs
  refused while protecting.
- Places: a photo's location is read from its EXIF block only.
- Mobile and accessibility: the page collapses to one column under 900 px; drawing uses pointer events (touch
  works); controls are labelled; messages use `role=status`/`alert`; progress bars are labelled; hand-drawn areas
  are listed with Remove buttons. Drawing an area needs a pointer: keyboard users can review and exclude detections
  but cannot draw areas.

## 6. Backend integration

No new server, process or port. HELLO's existing API routes and services:

- `GET/PUT/POST /api/events/:id/privacy-filter`: settings now include `peopleEnabled`, `screensEnabled`, `effect`;
  older records read with defaults (records are documents; no migration).
- `POST /api/events/:id/media`: refuses uploads without `x-hello-privacy: protected|declined` when the uploader's
  filter is on (`assertUploadPrivacy`).
- Twitch routes and alerts: unchanged.
- The server processes and stores no frames, faces or embeddings.

## 7. Models and assets

| Model | Runs | Size | Licence | Hash-verified |
|---|---|---|---|---|
| YuNet 2023mar | browser worker (ONNX Runtime Web, WASM, CPU) | 0.2 MB | MIT | yes |
| SFace 2021dec | browser worker | 38.7 MB | Apache-2.0 | yes |
| YOLOv8n-pose | browser worker (own lane) | 13.5 MB | AGPL-3.0 | yes |
| YOLO11n | browser worker (zoom lane) | 10.7 MB | AGPL-3.0 | yes |
| Tesseract eng best_int | browser worker (tesseract.js) | 3.0 MB | Apache-2.0 | yes |

They're downloaded once by `npm run privacy:assets` from commit-pinned URLs, checked against their SHA-256, stored in
`public/models/privacy` (git-ignored) and served from HELLO's own origin (CSP `connect-src 'self'` unchanged).
`predev`/`prebuild` verify them offline. Everything runs on the CPU in WebAssembly, one thread per worker; WebGPU was
not enabled. The I/O shapes were checked in Node (`images [1,3,640,640]` → pose `[1,56,8400]`, detection
`[1,84,8400]`), and real inference was verified on real pictures in the browser (§12).

## 8. Privacy and security findings

- Raw camera and screen frames: the protected track replaces the raw one before `RTCRtpSender.replaceTrack`. The
  output is black until the lookahead fills, then fully hidden until every switched-on lane reports. Measured: no
  face visible in any of 109 output samples taken from the moment a live preview started (§12).
- Pictures and videos are redacted before upload. The server refuses undeclared uploads from people with the filter
  on (tested: a raw API upload is refused; someone with the filter off is unaffected). This blocks accidental bypass
  within HELLO. It cannot stop a person deliberately sending their own file, and the per-file opt-out (`declined`)
  is explicit and visible.
- Place photos: the browser now sends only the EXIF block, never the pixels.
- Face data: embeddings stay in IndexedDB on the device and are in no API. Export says where they are; "Remove
  everyone" deletes them. The only new persistent server data is three settings fields, already covered by export
  and erasure.
- Failures never pass frames through: a missing model, a corrupt model, a download that never finishes (30 s) and a
  stalled lane (5 s) all keep frames hidden and say why (tested).
- No telemetry and no new network destinations: the models come from HELLO's own origin.

## 9. Removal of the separate Offleak project

- `D:\HELLO\offleak-main` (a 75 MB extracted ZIP outside the git repository, with no `.git`) was **deleted** after
  all tests passed. Before deletion, no file in `src`, `tests`, `scripts` or config referenced it; the one browser
  test that read a picture from it now uses committed public-domain fixtures.
- After deletion, `npx vitest run`, `npx tsc --noEmit`, `npx eslint src tests` and `npm run build` were re-run and
  passed (§13).
- Licence notices and provenance remain in HELLO (`LICENSES/AGPL-3.0.txt`, SPDX headers, the licence audit).
- Left alone: `D:\HELLO\*.log` and `pw-probe.out` beside the repository (not Offleak's; left by earlier runs).

## 10. Root-level configuration

The repository has exactly one of each: `package.json`, `package-lock.json`, `.env.example`, `.gitignore`,
`next.config.mjs` (plus your own git-ignored `.env.local`). It has no `requirements*.txt`, `pyproject.toml`,
Dockerfile, second manifest, `.py`, `.c`, `.command` or installer file.

## 11. Processes and ports

One process: `next start` (HELLO), on HELLO's port (3000 by default). Model inference runs in Web Workers inside the
user's browser tab, not as processes on the server. During this session's tests the build ran on port 3100 because
a `next dev` not started by this work was already using 3000; it was left running.

## 12. Browser verification (real Chromium, real models, real faces)

`tests/e2e/privacy-parity-flow.mjs`: **17/17 passed** in the full run (the sound check added afterwards also passed
on its own). `tests/e2e/privacy-filter-flow.mjs`: **8/8 passed**. "Detail" means the fine detail left in a region,
relative to the original: 1.0 is untouched; under 0.5 counts as hidden.

| Check | Measured |
|---|---|
| People from behind (`control.jpg`) | heads found: faces only **0**, with the pose model **7**; 3 screens zoomed into |
| Notice-board picture | 1 face, 5 QR boxes (2 real + 3 false positives), 1 phone number. Detail after: face 0.07, readable QR 0.01, unreadable QR 0.02, hand-drawn area 0.05, excluded phone number 1.17 (left visible as chosen) |
| Server copy of a reviewed picture | `image/jpeg`, header `protected`, QR detail under 0.5 |
| Raw upload with the filter on | refused by the server |
| Video (4 s, 640×360, moving face, QR code, tone) | 56 frames checked at **1.7 frames/s**; face detail **0.08** and QR **0.02–0.03** at 0.5, 1.5, 2.5 and 3.3 s; exported sound 3.91 s long, peak 1.03 |
| Moments video post | the server stores a new `video/webm`, not the original |
| Live camera, crew photo (6 faces) | 109 samples over 25 s from the start: max face detail **0.06**. Output **14.1 fps**, delay **1989 ms**, face+people checks **1.6/s**, QR/number checks **5.8/s**, zoom **2/s**, 6 faces and 6 people seen, 16.8 ms main-thread work per frame |
| Person kept visible (live) | kept person 1.17; the stranger beside them 0.03 |
| 8× CPU throttling (slow device) | stranger max 0.03; 110 frames dropped, none exposed |
| Screen-share preview | face 0.16, QR 0.02, phone 0.14; 12.5 fps, delay 2092 ms |
| Screen share as received by the other person in a call | face 0.35, QR 0.02, phone 0.16 (after WebRTC compression) |
| Model unavailable / corrupt model | "Blurring everything" with both reasons; faces never shown |
| Model download that never finishes | reported after 30 s; faces never shown |
| Camera / screen permission refused | explained; nothing captured (the screen refusal is simulated: headless Chromium never answers its picker) |
| Unsupported video file | explained; nothing uploaded |
| Network cut during upload | one attempt, aborted, error shown |
| Refresh during video processing | page comes back idle; nothing uploaded; settings kept |
| GIF with protection on | refused; nothing sent |

From the earlier journey (`privacy-filter-flow`): Moments picture face detail **0.07**; person kept visible **0.91**.

**Caveats.** The live camera is Chromium's fake device playing a still photograph, so motion tracking was verified on
the generated video, not on a live moving person. Real OS screen capture could not run on this machine (§4). The
finder-pattern locator's false positives appeared on control-room consoles and on the notice board.

## 13. Tests

| Command | Before | After |
|---|---|---|
| `npx vitest run` (from `D:\`) | 50 files, 565 passed, 3 skipped | **51 files, 587 passed, 3 skipped** (+20 unit, +2 integration); re-run after deleting the upstream folder |
| `npx tsc --noEmit` | 0 errors | **0 errors** |
| `npx eslint src tests` | 0 problems | **0 problems** |
| `npm run build` | passes | **passes** (after a one-line fix to another session's file, below) |
| Browser journeys | — | privacy-filter 8/8, **privacy-parity 17/17**, call 4/4, judge 13/13, features 10/10, workflow-audit 22/22, private-messages 6/6, product-flow all, field-atlas 19/19, field-live 8/8, live 9/9, outbox 3/3, route crawl 400 pages / 45 correctly denied / 0 problems |
| `npm run test:postgres` | not run | **not run**: no Postgres available (Docker daemon not running) |
| `chat-bridge-flow` | not run | **not run**: needs a chat secret and bridge |

No regressions: every existing test and journey passes.

Build note: `src/app/events/[eventId]/feed/memoreels/page.tsx` was created during this work by another session in
this repository and is not part of this task. It re-exported `dynamic` from another page, which Next.js rejects, so
no production build could succeed. It now declares `dynamic` and `metadata` itself and re-exports only the page
component; behaviour is the same. A copy of the original is in this session's scratch folder.

## 14. Remaining limitations

1. **Licence decision** (AGPL-3.0) before offering HELLO to anyone outside the team.
2. Accuracy is unbenchmarked: there is no labelled footage, and upstream's percentages do not apply.
3. Speed: the people model costs the most. Face+people checks run about 1.5 times a second on this CPU (about 7 before
   the pose lane); the one-second fail-safe and optical flow cover the gaps. Video protection runs at about 1.7 frames
   per second, so a one-minute 30 fps clip takes about 18 minutes. WebGPU and multi-threading are not used yet
   (threads need cross-origin isolation headers).
4. QR: finder-pattern detection over-blurs grid-like surfaces and misses codes whose corners are hidden.
5. GIFs are refused rather than filtered. Audio is never filtered (as upstream).
6. Drawing manual areas needs a pointer.
7. Live Twitch and PostgreSQL remain unverified.

## Final structure (privacy filter, inside HELLO)

```
nexconn-chat-sdk/                      one app: Next.js frontend + API, one package.json, one lockfile
├─ LICENSES/AGPL-3.0.txt
├─ scripts/privacy-assets.mjs          pinned, hash-checked model download (npm run privacy:assets)
├─ public/models/privacy/              downloaded models (git-ignored)
├─ src/domain/privacy-filter/          pure rules: redactor, flow, heads, tracker, yolo, finder, zoom, settings, upload…
├─ src/components/privacy-filter/      UI: PrivacyDock, MediaTool, PhotoGuard, StudioOutput, devices, FilterStats
│  └─ engine/                          browser engine: vision.worker, scan, engine (live), photo, video, render, ocr
├─ src/services/privacy-filter.ts      settings, alerts, upload rule
├─ src/services/privacy-twitch.ts, src/integrations/twitch/monitor.ts
├─ src/app/events/[eventId]/privacy-filter/ (page.tsx, studio/page.tsx)
├─ src/app/api/events/[eventId]/privacy-filter/ (route.ts, twitch/route.ts)
└─ tests/  unit, integration, e2e (privacy-filter-flow, privacy-parity-flow), fixtures/privacy
```

## Commands

```powershell
cd D:\HELLO\nexconn-chat-sdk
npm install
npm run privacy:assets      # once: downloads and verifies the models
npm run dev                 # development, http://localhost:3000
npm run build               # production build
npm start                   # production server, http://localhost:3000
npx vitest run; npx tsc --noEmit; npx eslint src tests
# browser journeys, against a running demo server:
$env:HELLO_DEMO_MODE='true'; npm start      # in one terminal
node tests/e2e/privacy-parity-flow.mjs      # in another (BASE_URL and CHROMIUM_PATH are optional)
```
