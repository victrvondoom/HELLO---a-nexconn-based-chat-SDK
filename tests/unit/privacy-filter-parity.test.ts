import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { binarize, findCenters, findQrShapes, finderRatio } from '@/domain/privacy-filter/finder';
import { iou, type Box } from '@/domain/privacy-filter/geometry';
import { FaceIds, headBox, mergeHeads, poseHeads, type ScoredFace } from '@/domain/privacy-filter/heads';
import { gridPoints } from '@/domain/privacy-filter/flow';
import { Redactor } from '@/domain/privacy-filter/redactor';
import { DEFAULT_PRIVACY_FILTER, PrivacyFilterPatchSchema, PrivacyFilterSettingsSchema } from '@/domain/privacy-filter/settings';
import { PeopleTracker } from '@/domain/privacy-filter/tracker';
import { decodeDetections, decodePose, rgbTensor01, yoloFit } from '@/domain/privacy-filter/yolo';
import { fromZoom, zoomRegions } from '@/domain/privacy-filter/zoom';

/** A YOLO output tensor [1, channels, anchors] with the given anchors filled in. */
function tensor(channels: number, anchors: number, fill: Record<number, number[]>): Float32Array {
  const data = new Float32Array(channels * anchors);
  for (const [a, values] of Object.entries(fill)) values.forEach((v, c) => { data[c * anchors + Number(a)] = v; });
  return data;
}

/** A grey picture with a QR code drawn at (ox, oy), `cell` pixels per module, on a light background. */
function qrPicture(text: string, cell: number, ox: number, oy: number, w: number, h: number) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const gray = new Uint8ClampedArray(w * h).fill(235);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) gray[(oy + r * cell + y) * w + ox + c * cell + x] = 20;
    }
  }
  return { gray, n, box: [ox, oy, ox + n * cell, oy + n * cell] as Box };
}

const rgba = (gray: Uint8ClampedArray) => {
  const out = new Uint8ClampedArray(gray.length * 4);
  gray.forEach((v, i) => { out.set([v, v, v, 255], 4 * i); });
  return out;
};

describe('YOLO decoding (Ultralytics ONNX layouts)', () => {
  it('letterboxes centred and maps boxes back to source pixels', () => {
    const fit = yoloFit(1280, 720);
    expect(fit).toMatchObject({ scale: 0.5, padX: 0, padY: 140, width: 640, height: 360 });
    // one tv (class 62) at input centre (320, 320), 100 x 50
    const values = new Array<number>(84).fill(0);
    values.splice(0, 4, 320, 320, 100, 50);
    values[4 + 62] = 0.9;
    const dets = decodeDetections(tensor(84, 3, { 1: values }), [1, 84, 3], fit, 0.25, [62, 63, 67, 73]);
    expect(dets).toHaveLength(1);
    expect(dets[0]?.cls).toBe(62);
    expect(dets[0]?.box).toEqual([540, 310, 740, 410]);
  });

  it('keeps only the wanted classes above the confidence and suppresses duplicates', () => {
    const fit = yoloFit(640, 640);
    const row = (cx: number, cy: number, s: number, cls: number, score: number) => {
      const v = [cx, cy, s, s, ...new Array<number>(80).fill(0)];
      v[4 + cls] = score;
      return v;
    };
    const fill = { 0: row(100, 100, 40, 0, 0.95), 1: row(300, 300, 60, 63, 0.6), 2: row(302, 301, 60, 63, 0.5), 3: row(500, 500, 20, 67, 0.2) };
    const dets = decodeDetections(tensor(84, 4, fill), [1, 84, 4], fit, 0.25, [62, 63, 67, 73]);
    expect(dets.map((x) => [x.cls, Math.round(x.score * 100) / 100])).toEqual([[63, 0.6]]);
  });

  it('decodes pose people with 17 keypoints and drops low confidence', () => {
    const fit = yoloFit(640, 640);
    const person = [200, 300, 100, 300, 0.8];
    for (let k = 0; k < 17; k += 1) person.push(200 + k, 160 + k, k < 5 ? 0.9 : 0.1);
    const weak = [400, 300, 100, 300, 0.1, ...new Array<number>(51).fill(0)];
    const people = decodePose(tensor(56, 2, { 0: person, 1: weak }), [1, 56, 2], fit, 0.2);
    expect(people).toHaveLength(1);
    expect(people[0]?.box).toEqual([150, 150, 250, 450]);
    expect(people[0]?.kp.slice(0, 2)).toEqual([200, 160]);
    expect(people[0]?.kp).toHaveLength(51);
  });

  it('builds a CHW RGB tensor in [0, 1]', () => {
    const px = new Uint8ClampedArray([255, 0, 51, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...rgbTensor01(px, 2)].map((v) => Math.round(v * 100) / 100)).toEqual([1, 0, 0, 1, 0, 1, 0, 1, 0.2, 0, 0, 1]);
  });
});

describe('heads from pose (upstream head_box and HeadDetector.detect)', () => {
  const kp = (points: Array<[number, number, number]>) => {
    const out = new Array<number>(51).fill(0);
    points.forEach(([x, y, c], k) => { out.splice(3 * k, 3, x, y, c); });
    return out;
  };

  it('uses facial keypoints when two or more are visible', () => {
    // nose, eyes and ears around (100, 99): ptp x = 40, ptp y = 10 -> s = max(64, 25, 16) = 64
    const k = kp([[100, 100, 0.9], [90, 95, 0.9], [110, 95, 0.9], [80, 100, 0.9], [120, 105, 0.9]]);
    expect(headBox(k, [0, 0, 400, 800]).map((v) => Math.round(v * 10) / 10)).toEqual([64.8, 57.4, 135.2, 134.2]);
  });

  it('falls back to the top of the body box for people seen from behind', () => {
    const k = kp([[0, 0, 0.1], [0, 0, 0.1]]);
    // s = max(16, min(100 * .6, 300 * .35)) = 60, centred on the box, at its top
    expect(headBox(k, [100, 50, 200, 350])).toEqual([120, 50, 180, 110]);
  });

  it('a face inside a pose head gives it its vote; a person from behind stays a head; other faces become heads', () => {
    const face = (x: number, y: number, s: number, score: number | null): ScoredFace => ({
      // frontal landmarks, so the face may vote
      row: [x, y, s, s, x + 0.3 * s, y + 0.4 * s, x + 0.7 * s, y + 0.4 * s, x + 0.5 * s, y + 0.6 * s, x + 0.35 * s, y + 0.8 * s, x + 0.65 * s, y + 0.8 * s, 0.9],
      score,
    });
    const pose = poseHeads([{ head: [100, 100, 180, 190] }, { head: [400, 100, 460, 160] }, { head: [101, 101, 181, 191] }], [7, 8, 9]);
    expect(pose.map((p) => p.tid)).toEqual([7, 8]); // the duplicate close-up box is dropped
    const rows = mergeHeads(pose, [face(110, 110, 60, 0.8), face(700, 100, 50, 0.1)], new FaceIds(), 1000, 1000);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([7, 100, 100, 180, 190, 1]); // the chosen person owns pose head 7
    expect(rows[1]).toEqual([8, 400, 100, 460, 160, 0]); // seen from behind: no face, unsure, so blurred
    expect(rows[2]?.[0]).toBeGreaterThanOrEqual(200000); // a face with no pose head gets a face id
    expect(rows[2]?.[5]).toBe(-1);
  });

  it('a small face inside a big close-up head belongs to someone behind, not to the head', () => {
    const small: ScoredFace = { row: [150, 150, 20, 20, 156, 158, 164, 158, 160, 162, 157, 166, 163, 166, 0.9], score: 0.9 };
    const rows = mergeHeads([{ tid: 3, head: [0, 0, 400, 400] }], [small], new FaceIds(), 1000, 1000);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[5]).toBe(0);
  });
});

describe('PeopleTracker (ByteTrack-style association)', () => {
  it('keeps ids while a person moves, gives a new person a new id, and lets weak detections continue but not start tracks', () => {
    const t = new PeopleTracker();
    const [a] = t.update([{ box: [0, 0, 100, 200], score: 0.9 }]);
    const [a2, b] = t.update([{ box: [10, 0, 110, 200], score: 0.9 }, { box: [500, 0, 600, 200], score: 0.8 }]);
    expect(a2).toBe(a);
    expect(b).not.toBe(a);
    const [a3, weakNew] = t.update([{ box: [20, 0, 120, 200], score: 0.15 }, { box: [900, 0, 950, 100], score: 0.15 }]);
    expect(a3).toBe(a);
    expect(weakNew).toBe(-1);
  });

  it('remembers a lost person for 30 passes', () => {
    const t = new PeopleTracker();
    const [a] = t.update([{ box: [0, 0, 100, 200], score: 0.9 }]);
    for (let n = 0; n < 10; n += 1) t.update([]);
    expect(t.update([{ box: [0, 0, 100, 200], score: 0.9 }])[0]).toBe(a);
    for (let n = 0; n < 31; n += 1) t.update([]);
    expect(t.update([{ box: [0, 0, 100, 200], score: 0.9 }])[0]).not.toBe(a);
  });
});

describe('QR codes by their finder squares (undecodable codes)', () => {
  it('checks the 1:1:3:1:1 ratio', () => {
    expect(finderRatio([4, 4, 12, 4, 4])).toBe(true);
    expect(finderRatio([4, 4, 4, 4, 4])).toBe(false);
  });

  it('finds a clean code that jsQR also reads', () => {
    const w = 400;
    const h = 300;
    const { gray, box } = qrPicture('https://example.test/ticket/12345', 6, 120, 60, w, h);
    expect(jsQR(rgba(gray), w, h)).not.toBeNull();
    const found = findQrShapes(gray, w, h);
    expect(found).toHaveLength(1);
    expect(iou(found[0] as Box, box)).toBeGreaterThan(0.7);
  });

  it('finds a code whose data is destroyed, which jsQR cannot decode', () => {
    const w = 400;
    const h = 300;
    const cell = 6;
    const { gray, n, box } = qrPicture('https://example.test/ticket/12345', cell, 120, 60, w, h);
    // scribble over the data area (everything outside the three finder squares)
    let seed = 7;
    for (let y = 60 + 9 * cell; y < 60 + n * cell; y += 1) {
      for (let x = 120 + 9 * cell; x < 120 + n * cell; x += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        gray[y * w + x] = seed % 2 ? 20 : 235;
      }
    }
    expect(jsQR(rgba(gray), w, h)).toBeNull();
    const found = findQrShapes(gray, w, h);
    expect(found).toHaveLength(1);
    expect(iou(found[0] as Box, box)).toBeGreaterThan(0.6);
  });

  it('finds nothing in a flat picture or in stripes', () => {
    const w = 200;
    const h = 200;
    expect(findQrShapes(new Uint8ClampedArray(w * h).fill(128), w, h)).toEqual([]);
    const stripes = new Uint8ClampedArray(w * h).map((_, i) => ((i % w) % 8 < 4 ? 20 : 235));
    expect(findCenters(binarize(stripes, w, h), w, h)).toEqual([]);
  });
});

describe('crop zoom (upstream CropZoom)', () => {
  it('pads screens by 10%, enlarges up to 3x within 960 px, and maps boxes back', () => {
    const [r] = zoomRegions([[100, 100, 300, 200]], 1280, 720);
    expect(r).toEqual({ x1: 80, y1: 90, x2: 320, y2: 210, s: 3 });
    expect(fromZoom([30, 60, 90, 120], r as NonNullable<typeof r>)).toEqual([90, 110, 111, 131]);
  });

  it('skips tiny crops and does not enlarge big ones', () => {
    expect(zoomRegions([[0, 0, 20, 20]], 640, 480)).toEqual([]);
    expect(zoomRegions([[0, 0, 900, 600]], 1280, 720)[0]?.s).toBe(1);
  });
});

describe('Redactor additions', () => {
  const pts = gridPoints(200, 200);
  const zero = () => new Float32Array(pts.length);

  it('crop-zoom boxes are hidden but never count as the objects lane reporting (fail closed)', () => {
    const r = new Redactor<number>(10, 200, 200, pts, { delay: 0, faceEnabled: false, objectsEnabled: true });
    r.addExtra(r.add(0, zero()), [[10, 10, 50, 50]]);
    expect(r.emit().plan.full).toBe(true);
    const r2 = new Redactor<number>(10, 200, 200, pts, { delay: 0, faceEnabled: false, objectsEnabled: true });
    const j = r2.add(0, zero());
    r2.putObjects(j, [], []);
    r2.addExtra(j, [[10, 10, 50, 50]]);
    const plan = r2.emit().plan;
    expect(plan.full).toBe(false);
    expect(plan.ops).toHaveLength(1);
  });

  it('manual regions come last, so clearing a chosen person cannot uncover them; a full plan stays full', () => {
    const plan = Redactor.withManual({ full: false, ops: [{ add: false, box: [0, 0, 100, 100] }] }, [[10, 10, 20, 20]]);
    expect(plan.ops.at(-1)).toEqual({ add: true, box: [10, 10, 20, 20] });
    expect(Redactor.withManual({ full: true, ops: [] }, [[1, 1, 2, 2]])).toEqual({ full: true, ops: [] });
  });
});

describe('settings', () => {
  it('defaults the new switches on and the effect to upstream pixelate', () => {
    expect(PrivacyFilterSettingsSchema.parse(DEFAULT_PRIVACY_FILTER)).toMatchObject({ peopleEnabled: true, screensEnabled: true, effect: 'pixelate' });
  });

  it('accepts the three working effects and nothing else', () => {
    for (const effect of ['pixelate', 'blur', 'blackout']) expect(PrivacyFilterPatchSchema.safeParse({ effect }).success).toBe(true);
    expect(PrivacyFilterPatchSchema.safeParse({ effect: 'emoji' }).success).toBe(false);
    expect(PrivacyFilterPatchSchema.safeParse({ peopleEnabled: 'yes' }).success).toBe(false);
  });
});
