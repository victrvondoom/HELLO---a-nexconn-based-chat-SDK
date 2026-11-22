// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77), AGPL-3.0:
// SETTING_RULES in app/offleak/dock/server.py and command() in app/offleak/obs/controller.py.

import { z } from 'zod';

/**
 * A person's privacy-filter settings. They hold no image and no face data: the people kept visible live only on
 * the person's own device (see src/components/privacy-filter/engine/gallery.ts).
 *
 * Ranges are upstream's: 5-60 fps and a 1-30 s lookahead. HELLO's defaults are shorter than the OBS dock's (5 s)
 * because a call is a conversation: 2 s of lookahead, with the microphone delayed by the same amount.
 */

export const FPS_MIN = 5;
export const FPS_MAX = 60;
export const DELAY_MIN = 1;
export const DELAY_MAX = 30;

/**
 * How a masked area is hidden. `pixelate` is upstream's PixelateBlur; `blur` is a heavy Gaussian blur; `blackout`
 * paints it solid black (nothing of the original survives, at the cost of looking redacted).
 */
export const REDACTION_EFFECTS = ['pixelate', 'blur', 'blackout'] as const;
export type RedactionEffect = (typeof REDACTION_EFFECTS)[number];

export const PrivacyFilterSettingsSchema = z
  .object({
    enabled: z.boolean(),
    fps: z.number().int().min(FPS_MIN).max(FPS_MAX),
    delay: z.number().min(DELAY_MIN).max(DELAY_MAX),
    faceEnabled: z.boolean(),
    /** People seen from behind or turned away (pose model); part of the face detector's lane. */
    peopleEnabled: z.boolean(),
    qrEnabled: z.boolean(),
    phoneEnabled: z.boolean(),
    /** Zoom into screens, phones and paper to read small codes and numbers (screen model). */
    screensEnabled: z.boolean(),
    effect: z.enum(REDACTION_EFFECTS),
  })
  .strict();

export type PrivacyFilterSettings = z.infer<typeof PrivacyFilterSettingsSchema>;

/** A partial update: any subset of the fields, each checked by the same rule (upstream rejects unknown keys). */
export const PrivacyFilterPatchSchema = PrivacyFilterSettingsSchema.partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one setting.' });

/**
 * Off until the person switches it on: it delays and blurs their picture (including their own face until they add
 * themselves), which changes how calls and posts behave, so it is their choice. Each call lobby and composer shows it.
 */
export const DEFAULT_PRIVACY_FILTER: PrivacyFilterSettings = {
  enabled: false,
  fps: 15,
  delay: 2,
  faceEnabled: true,
  peopleEnabled: true,
  qrEnabled: true,
  phoneEnabled: true,
  screensEnabled: true,
  effect: 'pixelate',
};

/** Memory the lookahead needs at a given size: delay x fps frames of RGBA. */
export function lookaheadBytes(settings: Pick<PrivacyFilterSettings, 'fps' | 'delay'>, w: number, h: number): number {
  return Math.ceil(settings.delay * settings.fps) * w * h * 4;
}

/** True when at least one detector is on; with all off the filter would pass frames through unchanged. */
export function anyDetector(settings: Pick<PrivacyFilterSettings, 'faceEnabled' | 'qrEnabled' | 'phoneEnabled'>): boolean {
  return settings.faceEnabled || settings.qrEnabled || settings.phoneEnabled;
}
