import { z } from 'zod';
import { MAX_MESSAGE_LENGTH } from '@/services/pipeline';
import { INCIDENT_STATUSES } from '@/domain/types';

/** Request bodies accepted by the API. Anything else is rejected before reaching a service. */

export const SendMessageBody = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export const IncidentActionBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('claim'),
    expectedVersion: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('transition'),
    to: z.enum(INCIDENT_STATUSES),
    expectedVersion: z.number().int().nonnegative(),
    resolutionNote: z.string().trim().max(1000).optional(),
  }),
]);

export const ApprovalDecisionBody = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(500),
  expectedVersion: z.number().int().nonnegative(),
});

export const SignalReviewBody = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
});

export const DemoSessionBody = z.object({
  userId: z.string().regex(/^u-[a-z0-9-]{1,40}$/),
});
