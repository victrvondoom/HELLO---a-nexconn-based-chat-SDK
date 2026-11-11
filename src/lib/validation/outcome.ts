import { z } from 'zod';
import { INCIDENT_CATEGORIES, INCIDENT_STATUSES } from '@/domain/types';
import { AGENT_IDS, AGENT_STEP_STATUSES, GROUNDING_LEVELS, REFERENCE_KINDS } from '@/agents/types';

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
  room: z.object({ id: z.string().min(1).max(80), name: z.string().max(120) }).nullable().optional(),
  /** Absent on messages stored before the agent mesh existed. */
  agents: z
    .object({
      steps: z
        .array(
          z.object({
            agent: z.enum(AGENT_IDS),
            status: z.enum(AGENT_STEP_STATUSES),
            summary: z.string().max(300),
            durationMs: z.number().min(0),
            confidence: z.number().min(0).max(1).nullable(),
            referenceIds: z.array(z.string()).max(10),
          }),
        )
        .max(12),
      references: z
        .array(
          z.object({
            id: z.string().min(1).max(120),
            kind: z.enum(REFERENCE_KINDS),
            title: z.string().max(200),
            snippet: z.string().max(400),
            // Only http(s) links are ever rendered; anything else is dropped to null.
            url: z
              .string()
              .max(2000)
              .nullable()
              .transform((u) => (u && /^https?:\/\//i.test(u) ? u : null)),
            score: z.number().min(0).max(1),
          }),
        )
        .max(8),
      grounding: z.enum(GROUNDING_LEVELS),
      totalMs: z.number().min(0),
    })
    .optional(),
});

export type ParsedOutcome = z.infer<typeof StoredOutcomeSchema>;

export function parseStoredOutcome(raw: unknown): ParsedOutcome | null {
  if (raw === null || typeof raw !== 'object' || !('outcome' in raw)) return null;
  const parsed = StoredOutcomeSchema.safeParse(raw.outcome);
  return parsed.success ? parsed.data : null;
}
