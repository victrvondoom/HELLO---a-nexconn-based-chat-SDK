// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77), AGPL-3.0:
// app/offleak/backends/phone_rules.py and app/offleak/backends/portable/phones.py.

import { findNumbers, type CountryCode } from 'libphonenumber-js/max';

/**
 * Phone numbers in text read from a camera frame or a picture. Two rules, as upstream:
 *
 * 1. `phoneSpans`: libphonenumber at POSSIBLE leniency, so odd formats fail closed (are masked).
 * 2. `isPhone`: a backend-independent fallback for OCR text the parser rejects (garbled digits): a run of 7 to
 *    15 digits with phone punctuation, after the usual OCR confusions O/o -> 0 and I/l/| -> 1.
 */

const PHONE = /\+?\d[\d .()-]{5,}\d/g;
const OCR_FIX: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1' };

export function isPhone(text: string): boolean {
  const fixed = text.replace(/[OoIl|]/g, (c) => OCR_FIX[c] ?? c);
  for (const match of fixed.matchAll(PHONE)) {
    const digits = (match[0].match(/\d/g) ?? []).length;
    if (digits >= 7 && digits <= 15) return true;
  }
  return false;
}

/** Region for national numbers (no +country). Upstream reads OFFLEAK_PHONE_REGION or the system locale. */
export function regionFromLocale(locale: string | undefined | null): CountryCode {
  const part = (locale ?? '').split(/[-_]/)[1];
  return (part && /^[A-Za-z]{2}$/.test(part) ? part.toUpperCase() : 'US') as CountryCode;
}

/** [start, end) character spans of possible phone numbers in `text`. */
export function phoneSpans(text: string, region: CountryCode = 'US'): Array<[number, number]> {
  try {
    return findNumbers(text, { defaultCountry: region, leniency: 'POSSIBLE', v2: true } as { defaultCountry: CountryCode; v2: true }).map((m) => [m.startsAt, m.endsAt]);
  } catch {
    return [];
  }
}

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Boxes to mask on one OCR line given its words: the union of the words each phone-number span covers (the line is
 * the words joined by single spaces), or the whole line when only the fallback rule fires.
 */
export function phoneBoxesInLine(words: readonly OcrWord[], region: CountryCode = 'US'): Array<[number, number, number, number]> {
  if (!words.length) return [];
  const starts: number[] = [];
  let text = '';
  for (const w of words) {
    if (text) text += ' ';
    starts.push(text.length);
    text += w.text;
  }
  const union = (list: readonly OcrWord[]): [number, number, number, number] => [
    Math.min(...list.map((w) => w.bbox.x0)),
    Math.min(...list.map((w) => w.bbox.y0)),
    Math.max(...list.map((w) => w.bbox.x1)),
    Math.max(...list.map((w) => w.bbox.y1)),
  ];
  const spans = phoneSpans(text, region);
  if (spans.length) {
    return spans.map(([a, b]) => union(words.filter((w, i) => (starts[i] ?? 0) < b && (starts[i] ?? 0) + w.text.length > a)));
  }
  return isPhone(text) ? [union(words)] : [];
}

/**
 * Which parts of one OCR line to mask, as fractions of the line's width: each parsed number's span, or the whole
 * line when nothing parsed but the fallback rule fires. Empty when the line holds no phone number.
 */
export function phoneLineParts(text: string, region: CountryCode = 'US'): Array<[number, number]> {
  const spans = phoneSpans(text, region);
  const length = Math.max(text.length, 1);
  if (spans.length) return spans.map(([a, b]) => [a / length, b / length]);
  return isPhone(text) ? [[0, 1]] : [];
}
