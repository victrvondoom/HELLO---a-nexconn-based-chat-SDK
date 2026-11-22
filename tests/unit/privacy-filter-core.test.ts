// SPDX-License-Identifier: AGPL-3.0-only
// Cases ported from Offleak's app/tests/test_core.py and test_dock.py (commit 24e6a77), plus HELLO-specific cases.
import { describe, expect, it } from 'vitest';
import { frontal, padBox, rotatedSize, unflip, unrotBox, unrotFace, type Box } from '@/domain/privacy-filter/geometry';
import { isPhone, phoneLineParts, phoneSpans, regionFromLocale } from '@/domain/privacy-filter/phone';
import { cosine, exempt, galleryScore, vote, type VoteEvents } from '@/domain/privacy-filter/identity';
import { GridFlow, grayFromRgba, gridPoints, move } from '@/domain/privacy-filter/flow';
import { Redactor, type HeadRow } from '@/domain/privacy-filter/redactor';
import { FaceIds, headsFromFaces } from '@/domain/privacy-filter/heads';
import { Orientation, UprightProbe, mirrorEvidence } from '@/domain/privacy-filter/orientation';
import { Timings } from '@/domain/privacy-filter/timings';
import { decode, detectFaces, letterbox, nms, toFrame, YUNET_STRIDES } from '@/domain/privacy-filter/yunet';
import { TEMPLATE, alignTransform, apply, similarity } from '@/domain/privacy-filter/align';
import { DEFAULT_PRIVACY_FILTER, PrivacyFilterPatchSchema, PrivacyFilterSettingsSchema, anyDetector, lookaheadBytes } from '@/domain/privacy-filter/settings';
import { acceptedPrivacyCommand, authorizeUrl, interpret, subscriptions, validClientId, validReconnectUrl, validationProblem } from '@/domain/privacy-filter/twitch';

describe('phone rules (upstream test_phone_text)', () => {
  it('accepts phone-shaped text and rejects times, words and years', () => {
    expect(isPhone('+1 929-333-3622') && isPhone('(929) 333 3622') && isPhone('O812-3456-789')).toBe(true);
    expect(isPhone('12:45') || isPhone('Settings') || isPhone('2026')).toBe(false);
  });
  it('finds number spans with libphonenumber at POSSIBLE leniency', () => {
    expect(phoneSpans('Call +1 929-333-3622 now')).toEqual([[5, 20]]);
    expect(phoneSpans('12:45 Settings 2026')).toEqual([]);
  });
  it('fails closed on ID-like digit runs (portable backend; upstream asserts the opposite only for Apple NSDataDetector)', () => {
    // POSSIBLE leniency over-masks "37473/37500": an extra blurred ID is the intended cost of never missing a number.
    expect(phoneSpans('ID 37473/37500')).toEqual([[3, 14]]);
  });
  it('masks the number part of a line, or the whole line on the fallback rule', () => {
    const parts = phoneLineParts('Call +1 929-333-3622 now');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.[0]).toBeCloseTo(5 / 24);
    expect(phoneLineParts('0812 3456 7890', 'US')).toEqual([[0, 1]]);
    expect(phoneLineParts('Welcome to Room 3')).toEqual([]);
  });
  it('reads the region from a locale', () => {
    expect(regionFromLocale('id-ID')).toBe('ID');
    expect(regionFromLocale('en')).toBe('US');
    expect(regionFromLocale(null)).toBe('US');
  });
});

describe('identity (upstream test_exempt_follows_nearest_vote_and_ties_reject)', () => {
  it('follows the nearest vote within keep, ties reject', () => {
    const events: VoteEvents = new Map([[7, [[1, 1], [5, -1]]]]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((j) => exempt(events, 7, j, 0, 2))).toEqual([true, true, true, false, false, false, false, false]);
    expect(exempt(events, -1, 0, 1, 2)).toBe(true);
    expect(exempt(events, -1, 0, 0, 2)).toBe(false);
  });
  it('votes with the benchmark thresholds; small faces are never called strangers', () => {
    expect(vote(0.5, 30)).toBe(1);
    expect(vote(0.1, 40)).toBe(-1);
    expect(vote(0.1, 39)).toBe(0);
    expect(vote(0.3, 80)).toBe(0);
  });
  it('scores against the gallery by cosine; nobody chosen means everyone is a stranger', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(galleryScore([], [1, 2])).toBe(-1);
    expect(galleryScore([[0, 1], [1, 0]], [1, 0.1])).toBeGreaterThan(0.99);
  });
});

describe('geometry', () => {
  it('frontal gate (upstream test_frontal_gate)', () => {
    expect(frontal([0, 0, 100, 100, 30, 40, 70, 40, 50, 60])).toBe(true);
    expect(frontal([0, 0, 100, 100, 40, 40, 54, 40, 70, 60])).toBe(false);
  });
  it('rotation round trips (upstream test_flip_and_rotation_round_trips)', () => {
    // a block from (20, 5) to (39, 11) in a 50 x 30 frame, rotated k quarter turns clockwise
    const rotate = (x: number, y: number, k: number, w: number, h: number): [number, number] => {
      let [px, py, ch] = [x, y, h];
      let cw = w;
      for (let i = 0; i < k; i += 1) {
        [px, py] = [ch - 1 - py, px];
        [cw, ch] = [ch, cw];
      }
      return [px, py];
    };
    for (let k = 0; k < 4; k += 1) {
      const a = rotate(20, 5, k, 50, 30);
      const b = rotate(39, 11, k, 50, 30);
      const box: Box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      expect(unrotBox(box, k, 50, 30).map(Math.round)).toEqual([20, 5, 39, 11]);
    }
    expect(rotatedSize(1, 50, 30)).toEqual([30, 50]);
  });
  it('unflips boxes', () => {
    expect(unflip([1, 0, 3, 2], true, false, 4, 3)).toEqual([1, 0, 3, 2]);
    expect(unflip([0, 0, 1, 1], true, true, 4, 3)).toEqual([3, 2, 4, 3]);
  });
  it('keeps landmark identity when unrotating a face', () => {
    const face = [10, 10, 20, 20, 12, 12, 18, 12, 15, 15, 12, 18, 18, 18, 0.9];
    const back = unrotFace(face, 2, 100, 50);
    expect(back[14]).toBe(0.9);
    expect(back.slice(4, 6)).toEqual([100 - 1 - 12, 50 - 1 - 12]);
  });
  it('pads boxes like the Redactor fill', () => {
    expect(padBox([10, 10, 30, 20], 0.1, 4, 64, 48)).toEqual([6, 6, 34, 24]);
    expect(padBox([0, 0, 63, 47], 0.5, 4, 64, 48)).toEqual([0, 0, 63, 47]);
  });
});

/** Deterministic texture: 40 x 40 random blocks upscaled to 200 x 200 (upstream test fixture). */
function texturedFrames(count: number, shift: number): Array<{ w: number; h: number; rgba: Uint8ClampedArray }> {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const tex = Array.from({ length: 40 * 40 }, () => Math.floor(rand() * 255));
  const w = 640;
  const h = 360;
  return Array.from({ length: count }, (_, k) => {
    const rgba = new Uint8ClampedArray(w * h * 4).fill(90);
    for (let y = 80; y < 280; y += 1) {
      for (let x = 0; x < 200; x += 1) {
        const v = tex[Math.floor((y - 80) / 5) * 40 + Math.floor(x / 5)] ?? 0;
        const p = (y * w + 100 + shift * k + x) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
      }
    }
    for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;
    return { w, h, rgba };
  });
}

function halfGray(frame: { w: number; h: number; rgba: Uint8ClampedArray }) {
  const hw = frame.w / 2;
  const hh = frame.h / 2;
  const half = new Uint8ClampedArray(hw * hh * 4);
  for (let y = 0; y < hh; y += 1) {
    for (let x = 0; x < hw; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const s = (dy: number, dx: number) => frame.rgba[((2 * y + dy) * frame.w + 2 * x + dx) * 4 + c] ?? 0;
        half[(y * hw + x) * 4 + c] = (s(0, 0) + s(0, 1) + s(1, 0) + s(1, 1)) / 4;
      }
    }
  }
  return grayFromRgba(half, hw, hh);
}

describe('optical flow', () => {
  it('places grid points like upstream (step/2, then every step)', () => {
    expect([...gridPoints(100, 60, 40)]).toEqual([20, 20, 60, 20]);
  });
  it('moves a box by the median displacement of the points inside it', () => {
    const pts = new Float32Array([5, 5, 6, 6, 7, 7, 50, 50]);
    const disp = new Float32Array([2, 1, 2, 1, 4, 3, -9, -9]);
    expect(move([0, 0, 10, 10], disp, pts, 1)).toEqual([2, 1, 12, 11]);
    expect(move([0, 0, 10, 10], disp, pts, -1)).toEqual([-2, -1, 8, 9]);
  });
  it('carries boxes both ways (upstream test_flow_carries_boxes_both_ways)', () => {
    const frames = texturedFrames(6, 6);
    const flow = new GridFlow(640, 360);
    const r = new Redactor<number>(30, 640, 360, flow.pts, { delay: 0 });
    for (const [k, f] of frames.entries()) r.add(k, flow.step(halfGray(f)));
    expect(Math.abs(r.carry([100, 80, 300, 280], 0, 5)[0] - 130)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.carry([130, 80, 330, 280], 5, 0)[0] - 100)).toBeLessThanOrEqual(3);
  });
});

const zero = (pts: Float32Array) => new Float32Array(pts.length);

describe('Redactor fail-closed rules', () => {
  it.each([15, 30, 60])('blurs everything after one second without detections at %i fps', (fps) => {
    const pts = gridPoints(64, 48);
    const r = new Redactor<number>(fps, 64, 48, pts, { delay: 0 });
    for (let k = 0; k < 4 * fps; k += 1) r.add(k, zero(pts));
    r.putHeads(0, []);
    r.putObjects(0, [], []);
    expect(r.mask(fps)).toEqual({ full: false, ops: [] });
    expect(r.mask(fps + 1).full).toBe(true);
    expect(r.failsafe).toBe(1);
  });
  it('fails closed only for switched-on detectors (upstream test_failsafe_only_for_enabled_detectors)', () => {
    const pts = gridPoints(40, 40);
    let r = new Redactor<number>(10, 40, 40, pts, { delay: 0, faceEnabled: false, objectsEnabled: false });
    expect(r.mask(r.add(0, zero(pts))).full).toBe(false);
    r = new Redactor<number>(10, 40, 40, pts, { delay: 0, faceEnabled: true, objectsEnabled: false });
    let i = r.add(0, zero(pts));
    expect(r.mask(i).full).toBe(true);
    r.putHeads(i, []);
    expect(r.mask(i).full).toBe(false);
    r = new Redactor<number>(10, 40, 40, pts, { delay: 0, faceEnabled: false, objectsEnabled: true });
    i = r.add(0, zero(pts));
    expect(r.mask(i).full).toBe(true);
    r.putObjects(i, [], []);
    expect(r.mask(i).full).toBe(false);
  });
  it('drops expired vote tracks (upstream test_expired_vote_tracks_are_dropped)', () => {
    const pts = gridPoints(40, 40);
    const r = new Redactor<number>(10, 40, 40, pts, { delay: 0 });
    for (let k = 0; k <= 1000; k += 1) r.add(k, zero(pts));
    r.putHeads(0, [[5, 0, 0, 4, 4, 1]]);
    r.putHeads(1000, [[6, 0, 0, 4, 4, 1]]);
    while (r.out <= 600) r.emit();
    expect(r.trackedIds).toEqual([6]);
  });
  it('waits for the lookahead before emitting, then flushes', () => {
    const pts = gridPoints(40, 40);
    const r = new Redactor<number>(10, 40, 40, pts, { delay: 1, faceEnabled: false, objectsEnabled: false });
    for (let k = 0; k < 10; k += 1) r.add(k, zero(pts));
    expect(r.ready()).toBe(false);
    r.add(10, zero(pts));
    expect(r.ready()).toBe(true);
    expect(r.emit().frame).toBe(0);
    expect(r.ready()).toBe(false);
    expect(r.ready(true)).toBe(true);
  });
});

describe('Redactor masks', () => {
  const pts = gridPoints(320, 180);
  function redactor() {
    const r = new Redactor<number>(10, 320, 180, pts, { delay: 0 });
    for (let k = 0; k < 20; k += 1) r.add(k, zero(pts));
    for (let k = 0; k < 20; k += 1) r.putObjects(k, [], []);
    return r;
  }
  it('blurs strangers and keeps a chosen person clear', () => {
    const r = redactor();
    const heads: HeadRow[] = [
      [200001, 10, 10, 50, 50, 1],
      [200002, 100, 10, 140, 50, -1],
    ];
    r.putHeads(5, heads);
    const plan = r.mask(5);
    expect(plan.full).toBe(false);
    expect(plan.ops).toContainEqual({ add: false, box: [10, 10, 50, 50] });
    expect(plan.ops.filter((o) => o.add).map((o) => o.box)).toContainEqual([96, 6, 144, 54]);
    expect(plan.ops.filter((o) => o.add).map((o) => o.box)).not.toContainEqual([6, 6, 54, 54]);
    expect(r.lastKeep).toEqual([[10, 10, 50, 50]]);
  });
  it('an unsure face is blurred', () => {
    const r = redactor();
    r.putHeads(5, [[200003, 10, 10, 50, 50, 0]]);
    const ops = r.mask(5).ops;
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.add && o.box.join() === '6,6,54,54')).toBe(true);
  });
  it('holds QR and phone boxes for the hold window, padded 15%', () => {
    const r = redactor();
    r.putHeads(5, []);
    r.putObjects(5, [[100, 100, 140, 140]], [[10, 150, 90, 160]]);
    expect(r.mask(10).ops).toEqual([
      { add: true, box: [94, 94, 146, 146] },
      { add: true, box: [0, 138, 102, 172] },
    ]);
    expect(r.mask(14).ops).toEqual([]);
  });
});

describe('heads from faces', () => {
  const face = (x: number, y: number, s: number) => [x, y, s, s, x + 0.3 * s, y + 0.4 * s, x + 0.7 * s, y + 0.4 * s, x + 0.5 * s, y + 0.6 * s, x + 0.35 * s, y + 0.8 * s, x + 0.65 * s, y + 0.8 * s, 0.9];
  it('votes, keeps stable ids by IoU and drops overlapping duplicates', () => {
    const ids = new FaceIds();
    const first = headsFromFaces([{ row: face(10, 10, 60), score: 0.7 }, { row: face(12, 12, 50), score: 0.1 }, { row: face(200, 10, 60), score: 0.1 }], ids, 320, 180);
    expect(first.map((h) => h[5])).toEqual([1, -1]);
    expect(first.map((h) => h[0])).toEqual([200000, 200001]);
    const second = headsFromFaces([{ row: face(14, 10, 60), score: null }], ids, 320, 180);
    expect(second).toEqual([[200000, 14, 10, 74, 70, 0]]);
  });
  it('small faces never vote', () => {
    const ids = new FaceIds();
    expect(headsFromFaces([{ row: face(0, 0, 20), score: 0.9 }], ids, 320, 180)[0]?.[5]).toBe(0);
  });
});

describe('orientation', () => {
  it('switches the upright turn after two agreeing roll passes', () => {
    const o = new Orientation();
    o.observeRolls([88, 92]);
    expect(o.rot).toBe(0);
    o.observeRolls([91]);
    expect(o.rot).toBe(1);
  });
  it('flips mirror only on sustained evidence', () => {
    const o = new Orientation();
    o.observeMirror(30);
    expect(o.mirror).toBe(false);
    o.observeMirror(30);
    expect(o.mirror).toBe(true);
    expect(mirrorEvidence({ phones: 1, textScore: 5 }, { phones: 0, textScore: 10 })).toBe(95);
  });
  it('the upright probe needs evidence above .04 to turn', () => {
    const o = new Orientation();
    const p = new UprightProbe(2);
    expect(p.due()).toBe(false);
    expect(p.due()).toBe(true);
    p.observe([0.5, 0.52, 0.4, 0.4], o);
    expect(o.rot).toBe(0);
    p.observe([0.2, 0.9, 0.1, 0.1], o);
    expect(o.rot).toBe(1);
  });
});

describe('timings (upstream test_timed_decorator_records_even_on_error)', () => {
  it('records a failing stage', async () => {
    const t = new Timings();
    let now = 0;
    await expect(
      t.time(
        'stage',
        () => {
          now = 12;
          return Promise.reject(new Error('boom'));
        },
        () => now,
      ),
    ).rejects.toThrow('boom');
    expect(t.snapshot()).toEqual({ stage_ms: 12 });
  });
});

describe('YuNet decoding', () => {
  function outputs(hit: { stride: number; r: number; c: number }) {
    const out: Record<string, { data: Float32Array }> = {};
    for (const s of YUNET_STRIDES) {
      const n = (640 / s) ** 2;
      out[`cls_${s}`] = { data: new Float32Array(n) };
      out[`obj_${s}`] = { data: new Float32Array(n) };
      out[`bbox_${s}`] = { data: new Float32Array(n * 4) };
      out[`kps_${s}`] = { data: new Float32Array(n * 10) };
    }
    const idx = hit.r * (640 / hit.stride) + hit.c;
    const get = (k: string) => out[k + '_' + String(hit.stride)]?.data ?? new Float32Array(0);
    get('cls')[idx] = 0.9;
    get('obj')[idx] = 0.9;
    get('bbox').set([0.5, 0.5, Math.log(4), Math.log(4)], idx * 4);
    get('kps').set([0.2, 0.3, 0.8, 0.3, 0.5, 0.5, 0.3, 0.8, 0.7, 0.8], idx * 10);
    return out;
  }
  it('decodes score, box and landmarks as OpenCV FaceDetectorYN', () => {
    const f = decode(outputs({ stride: 16, r: 3, c: 5 }))[0] ?? [];
    expect(f[14]).toBeCloseTo(0.9);
    // centre (5.5, 3.5) * 16, size 4 * 16
    expect(f.slice(0, 4).map((v) => Math.round(v))).toEqual([56, 24, 64, 64]);
    expect(f[4]).toBeCloseTo((0.2 + 5) * 16);
  });
  it('maps letterboxed faces back to the frame and drops ones in the padding', () => {
    const fit = letterbox(1280, 720);
    expect(fit).toEqual({ scale: 0.5, width: 640, height: 360 });
    const inFrame = toFrame([[100, 100, 20, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8]], fit);
    expect(inFrame[0]?.slice(0, 4)).toEqual([200, 200, 40, 40]);
    expect(toFrame([[100, 500, 20, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8]], fit)).toEqual([]);
    expect(detectFaces(outputs({ stride: 8, r: 10, c: 10 }), fit)).toHaveLength(1);
  });
  it('suppresses overlapping detections, keeping the best', () => {
    const a = [0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7];
    const b = [1, 1, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9];
    const c = [50, 50, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8];
    expect(nms([a, b, c]).map((f) => f[14])).toEqual([0.9, 0.8]);
  });
});

describe('SFace alignment', () => {
  it('recovers a known similarity transform', () => {
    const angle = 0.3;
    const scale = 1.7;
    const src = TEMPLATE.map(([x, y]) => [(x - 10) / scale, (y + 4) / scale] as [number, number]).map(([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)] as [number, number]);
    const m = similarity(src, TEMPLATE);
    src.forEach(([x, y], i) => {
      const [u, v] = apply(m, x, y);
      expect(u).toBeCloseTo(TEMPLATE[i]?.[0] ?? NaN, 3);
      expect(v).toBeCloseTo(TEMPLATE[i]?.[1] ?? NaN, 3);
    });
  });
  it('maps a face already on the template to the identity', () => {
    const m = alignTransform([0, 0, 112, 112, ...TEMPLATE.flat(), 0.9]);
    expect(m[0]).toBeCloseTo(1);
    expect(m[4]).toBeCloseTo(0);
  });
});

describe('settings (upstream SETTING_RULES)', () => {
  it('accepts the defaults and the upstream ranges', () => {
    expect(PrivacyFilterSettingsSchema.parse(DEFAULT_PRIVACY_FILTER)).toEqual(DEFAULT_PRIVACY_FILTER);
    expect(PrivacyFilterPatchSchema.safeParse({ fps: 60, delay: 30 }).success).toBe(true);
  });
  it('rejects out-of-range, non-integer, boolean-as-number and unknown fields', () => {
    for (const bad of [{ fps: 4 }, { fps: 61 }, { fps: 15.5 }, { fps: true }, { delay: 0.5 }, { delay: 31 }, { faceEnabled: 'yes' }, { reference: '/etc/passwd' }, {}]) {
      expect(PrivacyFilterPatchSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('sizes the lookahead and knows when nothing is switched on', () => {
    expect(lookaheadBytes({ fps: 60, delay: 5 }, 1280, 720)).toBe(300 * 1280 * 720 * 4);
    expect(anyDetector({ faceEnabled: false, qrEnabled: false, phoneEnabled: false })).toBe(false);
  });
});

describe('Twitch rules (upstream test_twitch_command_authorization)', () => {
  const event = { broadcaster_user_id: '1', chatter_user_id: '2', message: { text: '!privacy' }, badges: [{ set_id: 'moderator' }] };
  it('only the broadcaster or a moderator, exactly !privacy, in their own channel', () => {
    expect(acceptedPrivacyCommand(event, '1')).toBe(true);
    expect(acceptedPrivacyCommand({ ...event, badges: [] }, '1')).toBe(false);
    expect(acceptedPrivacyCommand({ ...event, broadcaster_user_id: '3' }, '1')).toBe(false);
    expect(acceptedPrivacyCommand({ ...event, message: { text: '!privacy 123' } }, '1')).toBe(false);
    expect(acceptedPrivacyCommand({ ...event, chatter_user_id: '1', badges: [] }, '1')).toBe(true);
    expect(acceptedPrivacyCommand({ ...event, message: { text: '  !PRIVACY ' } }, '1')).toBe(true);
  });
  it('checks client ids, authorisation URLs and validations', () => {
    expect(validClientId('abc123')).toBe(true);
    expect(validClientId('a/b')).toBe(false);
    expect(validClientId('x'.repeat(101))).toBe(false);
    const url = new URL(authorizeUrl('abc', 'http://localhost:3000/twitch/callback', 'nonce'));
    expect(url.searchParams.get('scope')).toBe('user:read:chat');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(validationProblem({ client_id: 'abc', scopes: ['user:read:chat'], user_id: '9' }, 'abc')).toBeNull();
    expect(validationProblem({ client_id: 'abc', scopes: [], user_id: '9' }, 'abc')).not.toBeNull();
    expect(validationProblem({ client_id: 'other', scopes: ['user:read:chat'], user_id: '9' }, 'abc')).not.toBeNull();
  });
  it('accepts only Twitch reconnect hosts', () => {
    expect(validReconnectUrl('wss://eventsub.wss.twitch.tv/ws?session=123')).toBe(true);
    for (const bad of ['ws://eventsub.wss.twitch.tv/ws', 'wss://evil.example/ws', 'wss://u:p@eventsub.wss.twitch.tv/ws', 'wss://eventsub.wss.twitch.tv:8443/ws', 42]) {
      expect(validReconnectUrl(bad)).toBe(false);
    }
  });
  it('interprets EventSub messages', () => {
    expect(interpret({ metadata: { message_type: 'notification' }, payload: { subscription: { type: 'stream.online' }, event: {} } }, '1')).toEqual({ kind: 'live', live: true });
    expect(interpret({ metadata: { message_type: 'notification' }, payload: { subscription: { type: 'channel.chat.message' }, event: { ...event, chatter_user_name: 'Mod' } } }, '1')).toEqual({ kind: 'alert', sender: 'Mod' });
    expect(interpret({ metadata: { message_type: 'notification' }, payload: { subscription: { type: 'channel.chat.message' }, event: { ...event, badges: [] } } }, '1')).toEqual({ kind: 'ignore' });
    expect(interpret({ metadata: { message_type: 'revocation' } }, '1')).toEqual({ kind: 'revoked' });
    expect(interpret({ metadata: { message_type: 'session_keepalive' } }, '1')).toEqual({ kind: 'ignore' });
    expect(() => interpret({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://evil.example' } } }, '1')).toThrow();
    expect(subscriptions('9', 's').map((s) => s.type)).toEqual(['stream.online', 'stream.offline', 'channel.chat.message']);
  });
});
