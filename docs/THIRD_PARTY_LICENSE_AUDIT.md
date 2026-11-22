# Third-party licence audit: the privacy filter (Offleak in HELLO)

Written for: HELLO's owner, and anyone deciding whether and how HELLO may be distributed or offered to users.
Date: 2026-11-22. This records facts and the decisions taken in code. It is not legal advice; where the answer
depends on a legal judgement, this document says so and leaves the decision to the owner.

## 1. Summary

- HELLO has **no licence of its own** (`package.json` is `"private": true`; there is no `LICENSE` file at the root).
- Parts of the privacy filter are **adapted from Offleak, which is AGPL-3.0**. Those files carry
  `SPDX-License-Identifier: AGPL-3.0-only` and a pointer to the upstream file; the AGPL text is in
  `LICENSES/AGPL-3.0.txt`. Nothing was relabelled, and no notice was removed.
- Two of the models are **Ultralytics YOLO weights, which Ultralytics publishes under AGPL-3.0**.
- Everything else added (npm packages, other models, test pictures) is MIT, Apache-2.0 or public domain.
- **Decision taken: none about HELLO's own licence.** It was not changed. If HELLO is run for other people over a
  network, or distributed, with the AGPL-derived files in it, AGPL-3.0 §13 requires offering those users the
  Corresponding Source of the combined program under the AGPL. That is the owner's decision (section 6 lists the
  options). Until it is made, HELLO should not be offered to the public with the privacy filter included.

## 2. Upstream

| | |
|---|---|
| Project | Offleak, https://github.com/azharizz/offleak |
| Commit | `24e6a776079d08f0214e64bda85bcb5ccae3fe06` (verified by SHA-256 of three files against raw.githubusercontent.com, see `docs/UPSTREAM_INTEGRATION_AUDIT.md` §2) |
| Licence | AGPL-3.0 (`LICENSE`: the full GNU text without a separate copyright line; README: "Offleak is licensed under AGPL-3.0") |
| Conflict noted | `app/models/README.md` says "This project's code is MIT licensed". It contradicts `LICENSE` and the README. The more restrictive licence (AGPL-3.0) is assumed. |
| Copyright holders | The Offleak authors (the repository owner and contributors); the licence file names none |

The extracted upstream folder (`D:\HELLO\offleak-main`) was outside HELLO's git repository. It was removed after
the integration was verified (see `docs/OFFLEAK_TO_HELLO_COMPLETION_REPORT.md` §9). The provenance needed to meet
the licence (upstream URL, commit, file-by-file mapping, licence text) is kept inside HELLO in this document, in
each file's header, and in `LICENSES/AGPL-3.0.txt`. Upstream's source stays available at the URL and commit above.

## 3. HELLO files derived from Offleak (AGPL-3.0-only)

Each file's header names the upstream file(s) it adapts.

| HELLO file | Adapted from (upstream `app/offleak/...`) |
|---|---|
| `src/domain/privacy-filter/geometry.ts` | `geometry.py` |
| `src/domain/privacy-filter/flow.ts` | `redaction/flow.py` |
| `src/domain/privacy-filter/identity.ts` | `redaction/identity.py`, `config.py`, `detection/faces.py` |
| `src/domain/privacy-filter/redactor.ts` | `redaction/redactor.py` (the `addExtra` / `withManual` additions are HELLO's) |
| `src/domain/privacy-filter/heads.ts` | `detection/faces.py` FaceIds; `detection/heads.py` head_box, `_pose_heads`, `detect`, `_vote` |
| `src/domain/privacy-filter/zoom.ts` | `detection/objects.py` CropZoom, SCREENS |
| `src/domain/privacy-filter/orientation.ts` | `detection/orientation.py` |
| `src/domain/privacy-filter/phone.ts` | `backends/phone_rules.py`, `backends/portable/phones.py` |
| `src/domain/privacy-filter/settings.ts` | `dock/server.py` SETTING_RULES, `obs/controller.py` |
| `src/domain/privacy-filter/timings.ts` | `instrumentation.py` |
| `src/domain/privacy-filter/twitch.ts`, `src/integrations/twitch/monitor.ts` | `twitch/monitor.py` |
| `src/components/privacy-filter/engine/vision.worker.ts` | `detection/faces.py`, `heads.py`, `objects.py`, `orientation.py`, `dock/references.py` |
| `src/components/privacy-filter/engine/scan.ts` | `detection/heads.py` HeadDetector, `detection/objects.py` Composite, CropZoom |
| `src/components/privacy-filter/engine/engine.ts` | `pipeline/live.py`, `detection/objects.py` Oriented, MirrorProbe |
| `src/components/privacy-filter/engine/ocr.ts` | `backends/portable/ocr.py` |
| `src/components/privacy-filter/engine/render.ts` | `redaction/blur.py` (the blur and blackout effects are HELLO's) |
| `src/components/privacy-filter/engine/photo.ts` | `pipeline/offline.py`, `cli/redact.py` |
| `src/components/privacy-filter/engine/video.ts` | `pipeline/offline.py` run_sync / redact_video, `cli/redact.py` defaults |
| `tests/unit/privacy-filter-core.test.ts` | cases from `tests/test_core.py` |

## 4. Privacy-filter files written for HELLO (no Offleak code)

These implement HELLO-specific parts, or replace upstream parts that could not be used. They contain no upstream
code. They work together with the AGPL files in one program, so section 6 applies to the program as a whole.

| File | What it is |
|---|---|
| `src/domain/privacy-filter/yolo.ts` | Decoding of Ultralytics ONNX output layouts (letterbox, boxes, keypoints, NMS) |
| `src/domain/privacy-filter/tracker.ts` | ByteTrack-style people tracker (upstream calls Ultralytics' tracker; this is a separate implementation) |
| `src/domain/privacy-filter/finder.ts` | QR finder-pattern locator for undecodable codes, in place of QRDet (which cannot run in a browser); not derived from QRDet |
| `src/domain/privacy-filter/upload.ts` | The upload privacy declaration HELLO's server checks |
| `src/domain/privacy-filter/yunet.ts`, `align.ts` | YuNet decoding and SFace alignment following OpenCV's documented behaviour (OpenCV is Apache-2.0; no OpenCV source copied) |
| `src/components/privacy-filter/*.tsx`, `engine/gallery.ts`, `protocol.ts`, `vision-client.ts` | HELLO's user interface and plumbing |
| `src/services/privacy-filter.ts`, `src/services/privacy-twitch.ts` | HELLO server services |
| `tests/unit/privacy-filter-parity.test.ts`, `tests/e2e/privacy-*.mjs` | HELLO tests |

## 5. Models, packages and test media

### Models (downloaded by `npm run privacy:assets`, SHA-256 pinned, served from HELLO's own origin, not in git)

| Model | Use | Source (pinned) | Licence | SHA-256 | Size |
|---|---|---|---|---|---|
| YuNet 2023mar | faces | huggingface.co/opencv/face_detection_yunet | MIT | `8f2383e4…52fa4` | 0.2 MB |
| SFace 2021dec | people kept visible | huggingface.co/opencv/face_recognition_sface | Apache-2.0 | `0ba9fbfa…34e79` | 38.7 MB |
| YOLOv8n-pose (ONNX export by Xenova) | people, including from behind | huggingface.co/Xenova/yolov8n-pose @ `da42240…` | **AGPL-3.0** (Ultralytics) | `04f6d241…47586` | 13.5 MB |
| YOLO11n (ONNX export by WebNN) | screens, phones, paper | huggingface.co/webnn/yolo11n @ `9c5acfd…` | **AGPL-3.0** (Ultralytics) | `7d8fd171…cc5c1` | 10.7 MB |
| Tesseract eng 4.0.0_best_int | phone numbers (OCR) | cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0 | Apache-2.0 | `45b4cb34…cff91` | 3.0 MB |

Full hashes and pinned URLs are in `scripts/privacy-assets.mjs`; a file with the wrong hash is deleted, never served.

Provenance of the YOLO ONNX files: neither is Ultralytics' own file. The WebNN repository also publishes the
`yolo11n.pt` it exported from; its SHA-256 (`0ebbc80d…44ee1`) is identical to Ultralytics' official
`v8.4.0/yolo11n.pt` (checked on 2026-11-22), so that ONNX file comes from the official weights. For the pose model,
upstream uses `yolo11n-pose.pt` (official SHA-256 `869e83fc…19dc0`), which has **no published ONNX export**; HELLO
uses Xenova's export of `yolov8n-pose` instead (the previous Ultralytics generation, same 17-keypoint COCO format).
Its source `.pt` is not published alongside it, so that export cannot be traced to a hash of official weights.
**Converting a model can change its accuracy; no accuracy comparison with upstream was run.**

QRDet (`qrdet-n.pt`, Eric Cañas; code MIT, weights trained with Ultralytics and described by Offleak as AGPL-3.0)
is published only as PyTorch weights. Running it would need PyTorch (not available in a browser) or a separate
Python service (which this integration must not add). It is **not used**; `finder.ts` replaces it.

Whether AGPL obligations attach to model weights is itself a legal question (Ultralytics states that its models are
AGPL-3.0). Serving the two YOLO files to browsers is distribution of those files; their licence and source are public
at the URLs above.

### npm packages added for the privacy filter

| Package | Version | Licence | Use |
|---|---|---|---|
| onnxruntime-web | 1.23.2 | MIT | model inference in the browser (WebAssembly) |
| tesseract.js / tesseract.js-core | 6.0.1 / 6.1.2 | Apache-2.0 | OCR |
| jsqr | 1.4.0 | Apache-2.0 | QR decoding |
| libphonenumber-js | 1.12.25 | MIT | phone-number spans |
| webm-muxer | 5.1.4 | MIT | writing the protected video file |
| qrcode-generator (dev only) | 2.0.4 | MIT | test fixtures |

None is AGPL or GPL.

### Test pictures

`tests/fixtures/privacy/*.jpg` are NASA photographs in the public domain (`tests/fixtures/privacy/PROVENANCE.md`).

## 6. What HELLO's owner has to decide

The AGPL-derived files are bundled into HELLO's client code and called from HELLO's pages; HELLO and the privacy
filter form one program. Under AGPL-3.0 §13, anyone who interacts with a modified AGPL program over a network must
be offered its Corresponding Source. The options, from least to most work:

1. **License HELLO under AGPL-3.0** (or keep HELLO's own code under an AGPL-compatible licence such as MIT and ship
   the combination under AGPL-3.0), and add a visible "Source code" link in the app pointing at the exact source
   of the running version. The notices this needs are already in place.
2. **Ship HELLO without the privacy filter** to anyone outside the team until the decision is made. The feature is
   isolated in the files of sections 3 and 4 plus small call sites (calls, composers, navigation, the media route).
3. **Replace the AGPL parts with independent implementations** of the same behaviour, written from upstream's
   documented behaviour and this repository's tests rather than its code, by someone who has not modelled them on
   the AGPL files, and **replace the two Ultralytics models** with permissively licensed ones (for example YOLOX,
   Apache-2.0, for screens; RTMPose or RTMO, Apache-2.0, for people). The modules affected are exactly those in
   section 3. This is substantial work; rewording the existing files would still produce a derivative work.

This integration does not choose among them. HELLO's licence was not changed and nothing was distributed.

## 7. Notices in the product

- The privacy page's "How it works" names Offleak, links the upstream repository, states AGPL-3.0 and names every
  model and its role. The models table on the same page shows each model's licence and whether it is installed.
- `LICENSES/AGPL-3.0.txt` holds the licence text.
- Every AGPL-derived file keeps its SPDX header and upstream pointer.
