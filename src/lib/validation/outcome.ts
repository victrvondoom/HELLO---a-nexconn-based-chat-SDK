import { z } from 'zod';
import { INCIDENT_CATEGORIES, INCIDENT_STATUSES } from '@/domain/types';

/**
 * Validates an assistant outcome read back from storage. Stored JSON is treated as untrusted
 * input: anything that does not match is rendered as plain text, never as a card.
 */
export const StoredOutcomeSchema = z.object({
  reply: z.string().max(4000),
  clarifyingQuestion: z.string().max(300).nullable(),
  incidents: z.array(
    z.object({
      incidentId: z.string().min(1),
      title: z.string().max(200),
      category: z.enum(INCIDENT_CATEGORIES),
      status: z.enum(INCIDENT_STATUSES),
      urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      attached: z.boolean(),
      matchConfidence: z.number().min(0).max(1).nullable(),
    }),
  ).max(10),
  alternatives: z.array(
    z.object({
      sessionId: z.string().min(1),
      title: z.string().max(200),
      roomName: z.string().max(120),
      startsAt: z.number(),
      reasons: z.array(z.string().max(200)).max(4),
    }),
  ).max(5),
  approvalId: z.string().nullable(),
  statusReport: z
    .object({
      incidentId: z.string(),
      title: z.string(),
      status: z.enum(INCIDENT_STATUSES),
      statusLabel: z.string(),
      assigneeName: z.string().nullable(),
      minutesSinceUpdate: z.number(),
    })
    .nullable(),
  people: z.array(z.object({ userId: z.string(), displayName: z.string(), reason: z.string() })).max(10),
});

export type ParsedOutcome = z.infer<typeof StoredOutcomeSchema>;

export function parseStoredOutcome(raw: unknown): ParsedOutcome | null {
  if (raw === null || typeof raw !== 'object' || !('outcome' in raw)) return null;
  const parsed = StoredOutcomeSchema.safeParse(raw.outcome);
  return parsed.success ? parsed.data : null;
}
