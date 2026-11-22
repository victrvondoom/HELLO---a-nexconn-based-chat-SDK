// SPDX-License-Identifier: AGPL-3.0-only
// The detector lanes of Offleak (https://github.com/azharizz/offleak, commit 24e6a77, AGPL-3.0: detection/heads.py
// HeadDetector, detection/objects.py Composite + CropZoom), shared by the live, photo and video filters.
import { FaceIds, mergeHeads, poseHeads } from '@/domain/privacy-filter/heads';
import type { Box } from '@/domain/privacy-filter/geometry';
import type { HeadRow } from '@/domain/privacy-filter/redactor';
import { PeopleTracker } from '@/domain/privacy-filter/tracker';
import { fromZoom, zoomRegions } from '@/domain/privacy-filter/zoom';
import { PhoneReader, type TextScan } from './ocr';
import { VisionClient } from './vision-client';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Canvasish = OffscreenCanvas | HTMLCanvasElement;

/**
 * Heads: YuNet faces (with SFace votes for the people kept visible) and, when "people from behind" is on, the pose
 * model in a second worker at the same time; merged per pass, pose people tracked across passes.
 */
export class HeadScanner {
  private readonly faces = new VisionClient();
  private readonly pose: VisionClient | null;
  private readonly tracker = new PeopleTracker();
  private readonly ids = new FaceIds();
  /** People found by pose on the last pass, and faces. */
  last = { people: 0, faces: 0 };

  constructor(readonly withPose: boolean) {
    this.pose = withPose ? new VisionClient() : null;
  }

  /** Loads every model this lane needs. Throws (with every reason) when one is missing: the lane must not run half. */
  async load(gallery: number[][]): Promise<void> {
    const errors: string[] = [];
    const [faces, pose] = await Promise.all([
      this.faces.request({ type: 'init', faces: true, recognizer: gallery.length > 0 }),
      this.pose ? this.pose.request({ type: 'init', faces: false, recognizer: false, pose: true }) : Promise.resolve(null),
    ]);
    errors.push(...faces.result.errors);
    if (pose) errors.push(...pose.result.errors);
    if (!faces.result.faces || (pose && !pose.result.pose)) throw new Error(errors.join(' ') || 'A face or people model is missing.');
    await this.faces.request({ type: 'gallery', features: gallery });
  }

  /** The upright-probe scores of the face worker (orientation). */
  probe(frame: ImageBitmap) {
    return this.faces.request({ type: 'probe', frame });
  }

  /** One heads pass on `frame` (k quarter turns to upright). `tiles` adds a 2 x 2 grid for big still pictures. */
  async scan(frame: ImageBitmap, k: number, tiles: boolean): Promise<HeadRow[]> {
    const w = frame.width;
    const h = frame.height;
    const [faces, people] = await Promise.all([
      this.faces.request({ type: 'faces', frame: await createImageBitmap(frame), k, tiles }),
      this.pose ? this.pose.request({ type: 'pose', frame: await createImageBitmap(frame), k, tiles }) : Promise.resolve(null),
    ]);
    const found = people?.people ?? [];
    const tids = tiles ? found.map(() => -1) : this.tracker.update(found);
    this.last = { people: found.length, faces: faces.faces.length };
    return mergeHeads(poseHeads(found, tids), faces.faces, this.ids, w, h);
  }

  terminate(): void {
    this.faces.terminate();
    this.pose?.terminate();
  }
}

export interface ObjectScan {
  qr: Box[];
  phone: Box[];
  /** QR codes found only by their finder squares. */
  shapes: number;
  textScore: number;
}

/**
 * QR codes (decodable, and undecodable by their finder squares) and phone numbers on an upright picture; with
 * "screens" on, also inside each screen, phone or sheet of paper the screen model finds, enlarged (crop zoom).
 */
export class ObjectScanner {
  private readonly vision: VisionClient | null;
  private readonly reader: PhoneReader | null;
  qrEngine = 'off';

  constructor(readonly opts: { qr: boolean; phone: boolean; screens: boolean }) {
    this.vision = opts.qr || opts.screens ? new VisionClient() : null;
    this.reader = opts.phone ? new PhoneReader() : null;
  }

  get enabled(): boolean {
    return this.opts.qr || this.opts.phone;
  }

  async load(): Promise<void> {
    const errors: string[] = [];
    const jobs: Array<Promise<unknown>> = [];
    if (this.vision) {
      jobs.push(
        this.vision.request({ type: 'init', faces: false, recognizer: false, screens: this.opts.screens }).then(({ result }) => {
          this.qrEngine = this.opts.qr ? result.qr : 'off';
          if (this.opts.screens && !result.screens) throw new Error(result.errors.join(' ') || 'The screen model is missing.');
        }),
      );
    }
    if (this.reader) {
      jobs.push(
        this.reader.load().catch((e: unknown) => {
          throw new Error(`Phone-number reader (Tesseract) could not load: ${message(e)}`);
        }),
      );
    }
    for (const s of await Promise.allSettled(jobs)) if (s.status === 'rejected') errors.push(message(s.reason));
    if (errors.length) throw new Error(errors.join(' '));
  }

  private async read(source: Canvasish, tiles: boolean): Promise<ObjectScan> {
    const none: TextScan = { phone: [], textScore: 0 };
    const [qr, text] = await Promise.all([
      this.vision && this.opts.qr ? this.vision.request({ type: 'qr', frame: await createImageBitmap(source), tiles }) : Promise.resolve({ boxes: [] as Box[], shapes: 0 }),
      this.reader ? this.reader.read(source) : Promise.resolve(none),
    ]);
    return { qr: qr.boxes, phone: text.phone, shapes: qr.shapes, textScore: text.textScore };
  }

  /** The whole picture. */
  scan(source: Canvasish, tiles: boolean): Promise<ObjectScan> {
    return this.read(source, tiles);
  }

  /** A mirrored re-read for the mirror vote (phone numbers only). */
  readFlipped(source: Canvasish): Promise<TextScan | null> {
    if (!this.reader) return Promise.resolve(null);
    const c = new OffscreenCanvas(source.width, source.height);
    const x = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
    x.scale(-1, 1);
    x.drawImage(source, -source.width, 0);
    return this.reader.read(c);
  }

  /** Crop zoom: the readers again inside each screen region (largest first, at most `limit`). */
  async zoom(source: Canvasish, limit = 4): Promise<ObjectScan & { screens: number }> {
    const out = { qr: [] as Box[], phone: [] as Box[], shapes: 0, textScore: 0, screens: 0 };
    if (!this.opts.screens || !this.vision) return out;
    const { boxes } = await this.vision.request({ type: 'screens', frame: await createImageBitmap(source) });
    const regions = zoomRegions(boxes, source.width, source.height)
      .sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))
      .slice(0, limit);
    out.screens = boxes.length;
    for (const r of regions) {
      const cw = Math.max(1, Math.round((r.x2 - r.x1) * r.s));
      const ch = Math.max(1, Math.round((r.y2 - r.y1) * r.s));
      const crop = new OffscreenCanvas(cw, ch);
      const cx = crop.getContext('2d') as OffscreenCanvasRenderingContext2D;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(source, r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1, 0, 0, cw, ch);
      const part = await this.read(crop, false);
      out.qr.push(...part.qr.map((b) => fromZoom(b, r)));
      out.phone.push(...part.phone.map((b) => fromZoom(b, r)));
      out.shapes += part.shapes;
    }
    return out;
  }

  async terminate(): Promise<void> {
    this.vision?.terminate();
    await this.reader?.terminate();
  }
}
