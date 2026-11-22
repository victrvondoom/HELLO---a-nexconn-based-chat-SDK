import { z } from 'zod';

/** Request bodies for the LiveScene and LiveShield routes. Business rules live in src/services/live.ts. */

export const LIVE_CATEGORY_VALUES = ['SAFETY', 'TECHNICAL', 'CROWD', 'SOCIAL', 'COMMUNITY', 'ACCESSIBILITY'] as const;
const PROMOTABLE_VALUES = ['SAFETY', 'TECHNICAL', 'CROWD', 'ACCESSIBILITY'] as const;

export const SubmitLiveReportBody = z.object({
  spaceId: z.string().min(1).max(80),
  category: z.enum(LIVE_CATEGORY_VALUES),
  text: z.string().min(1).max(600),
});

export const LiveReportActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('promote'), category: z.enum(PROMOTABLE_VALUES) }),
  z.object({ action: z.literal('dismiss'), reason: z.string().min(1).max(300) }),
]);

export const PlaceHoldBody = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('EVENT') }),
    z.object({ kind: z.literal('ZONE'), zone: z.string().min(1).max(80) }),
    z.object({ kind: z.literal('REPORT'), reportId: z.string().min(1).max(120) }),
  ]),
  reason: z.string().min(1).max(500),
  durationMinutes: z.number().int().min(1).max(240),
});

export const ReleaseHoldBody = z.object({
  reason: z.string().min(1).max(500),
});
