// SPDX-License-Identifier: AGPL-3.0-only
// Offleak's offline mode (https://github.com/azharizz/offleak, commit 24e6a77, AGPL-3.0: pipeline/offline.py and
// cli/redact.py: every detector on every frame) applied to one still picture, before it is uploaded.
import { gridPoints } from '@/domain/privacy-filter/flow';
import type { Box } from '@/domain/privacy-filter/geometry';
import { Redactor, type HeadRow } from '@/domain/privacy-filter/redactor';
import type { PrivacyFilterSettings, RedactionEffect } from '@/domain/privacy-filter/settings';
import { MaskRenderer } from './render';
import { HeadScanner, ObjectScanner } from './scan';

export interface PhotoReport {
  faces: number;
  facesKept: number;
  /** Heads found by the pose model (includes people seen from behind). */
  people: number;
  qr: number;
  /** Of `qr`, codes found only by their finder squares (not decodable). */
  qrShapes: number;
  phone: number;
  /** Screens, phones or paper zoomed into. */
  screens: number;
  /** Areas the person marked by hand. */
  manual: number;
  /** Detections the person chose to leave visible. */
  excluded: number;
  /** A switched-on detector could not run: the whole picture was hidden. */
  failedClosed: boolean;
  errors: string[];
}

export interface ProtectedPhoto {
  file: File;
  report: PhotoReport;
}

export type DetectionKind = 'face' | 'kept' | 'qr' | 'phone';

/** One thing the filter found, so a review screen can list it and the person can leave a false alarm visible. */
export interface PhotoDetection {
  id: string;
  kind: DetectionKind;
  box: Box;
}

export type PhotoSettings = Pick<PrivacyFilterSettings, 'faceEnabled' | 'qrEnabled' | 'phoneEnabled'> &
  Partial<Pick<PrivacyFilterSettings, 'peopleEnabled' | 'screensEnabled' | 'effect'>>;

export interface DetectedPhoto {
  base: OffscreenCanvas;
  width: number;
  height: number;
  heads: HeadRow[];
  qr: Box[];
  phone: Box[];
  detections: PhotoDetection[];
  settings: PhotoSettings;
  report: PhotoReport;
}

/** Longest side kept for an uploaded picture; also bounds memory and OCR time. */
const MAX_SIDE = 2048;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Every detector on the picture, once (faces and people with tiles; QR, numbers, then inside screens). */
export async function detectPhoto(file: Blob, settings: PhotoSettings, gallery: number[][]): Promise<DetectedPhoto> {
  const decoded = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height));
  const w = Math.max(1, Math.round(decoded.width * scale));
  const h = Math.max(1, Math.round(decoded.height * scale));
  const base = new OffscreenCanvas(w, h);
  (base.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(decoded, 0, 0, w, h);
  decoded.close();

  const errors: string[] = [];
  const report: PhotoReport = { faces: 0, facesKept: 0, people: 0, qr: 0, qrShapes: 0, phone: 0, screens: 0, manual: 0, excluded: 0, failedClosed: false, errors };
  const heads: HeadRow[] = [];
  const qr: Box[] = [];
  const phone: Box[] = [];
  let ok = true;
  const headScanner = settings.faceEnabled ? new HeadScanner(settings.peopleEnabled ?? true) : null;
  const objects = settings.qrEnabled || settings.phoneEnabled ? new ObjectScanner({ qr: settings.qrEnabled, phone: settings.phoneEnabled, screens: settings.screensEnabled ?? true }) : null;
  try {
    if (headScanner) {
      try {
        await headScanner.load(gallery);
        const bitmap = await createImageBitmap(base);
        heads.push(...(await headScanner.scan(bitmap, 0, true)));
        bitmap.close();
        report.faces = headScanner.last.faces;
        report.people = headScanner.last.people;
        report.facesKept = heads.filter((row) => row[5] === 1).length;
      } catch (e) {
        ok = false;
        errors.push(`Faces and people could not be checked: ${message(e)}`);
      }
    }
    if (objects) {
      try {
        await objects.load();
        const whole = await objects.scan(base, true);
        const zoom = await objects.zoom(base, 6);
        qr.push(...whole.qr, ...zoom.qr);
        phone.push(...whole.phone, ...zoom.phone);
        report.qrShapes = whole.shapes + zoom.shapes;
        report.screens = zoom.screens;
      } catch (e) {
        ok = false;
        errors.push(`QR codes and phone numbers could not be checked: ${message(e)}`);
      }
    }
  } finally {
    headScanner?.terminate();
    await objects?.terminate();
  }
  report.qr = qr.length;
  report.phone = phone.length;
  report.failedClosed = !ok;
  const detections: PhotoDetection[] = [
    ...heads.map((r, n): PhotoDetection => ({ id: `h${String(n)}`, kind: r[5] === 1 ? 'kept' : 'face', box: [r[1], r[2], r[3], r[4]] })),
    ...qr.map((box, n): PhotoDetection => ({ id: `q${String(n)}`, kind: 'qr', box })),
    ...phone.map((box, n): PhotoDetection => ({ id: `p${String(n)}`, kind: 'phone', box })),
  ];
  return { base, width: w, height: h, heads, qr, phone, detections, settings, report };
}

export interface RenderChoices {
  /** Detection ids to leave visible (false alarms). People kept visible are already left visible. */
  exclude?: ReadonlySet<string>;
  /** Areas to hide whatever the detectors say. */
  manual?: readonly Box[];
  effect?: RedactionEffect;
  name?: string;
}

/** The picture with the plan applied, as a new JPEG (which also drops the original's metadata). */
export async function renderPhoto(d: DetectedPhoto, choices: RenderChoices = {}): Promise<ProtectedPhoto> {
  const exclude = choices.exclude ?? new Set<string>();
  const manual = choices.manual ?? [];
  const { width: w, height: h, settings } = d;
  const objectsEnabled = settings.qrEnabled || settings.phoneEnabled;
  const pts = gridPoints(w, h);
  const redactor = new Redactor<null>(1, w, h, pts, { delay: 0, faceEnabled: settings.faceEnabled, objectsEnabled });
  const i = redactor.add(null, new Float32Array(pts.length));
  // A lane that failed reports nothing, so the Redactor hides the whole picture (fail closed); exclusions cannot undo that.
  if (!d.report.failedClosed) {
    if (settings.faceEnabled) redactor.putHeads(i, d.heads.filter((_, n) => !exclude.has(`h${String(n)}`)));
    if (objectsEnabled) redactor.putObjects(i, d.qr.filter((_, n) => !exclude.has(`q${String(n)}`)), d.phone.filter((_, n) => !exclude.has(`p${String(n)}`)));
  }
  const { plan } = redactor.emit();
  const out = new OffscreenCanvas(w, h);
  new MaskRenderer(w, h, choices.effect ?? settings.effect ?? 'pixelate').draw(out.getContext('2d') as OffscreenCanvasRenderingContext2D, d.base, Redactor.withManual(plan, manual));
  const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const name = (choices.name ?? 'picture').replace(/\.[^.]+$/, '') || 'picture';
  const excluded = d.detections.filter((x) => exclude.has(x.id)).length;
  return {
    file: new File([blob], `${name}-protected.jpg`, { type: 'image/jpeg' }),
    report: { ...d.report, manual: manual.length, excluded: plan.full ? 0 : excluded, failedClosed: plan.full },
  };
}

/**
 * Hides strangers' faces and heads, QR codes and phone numbers in a picture on this device and returns a new JPEG.
 * The original never leaves the browser. Re-encoding also drops the picture's metadata (location, camera), as
 * upstream's dock does for uploaded photos.
 */
export async function protectPhoto(file: File, settings: PhotoSettings, gallery: number[][]): Promise<ProtectedPhoto> {
  return renderPhoto(await detectPhoto(file, settings, gallery), { name: file.name });
}
