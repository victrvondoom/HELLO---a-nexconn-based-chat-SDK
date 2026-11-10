import { z } from 'zod';
import { classifyUtterance } from '../domain/incidents/classify';
import { INCIDENT_CATEGORIES, type IncidentCategory } from '../domain/types';

/**
 * Message understanding.
 *
 * An LLM provider may be plugged in through `IntentProvider`. Its output is
 * never trusted: it must parse against `IntentResultSchema`, and if it does not
 * (or it times out, is rate-limited, or no provider is configured), the
 * deterministic interpreter answers instead. The result only *routes* a message.
 * Creating, changing or approving anything is done by domain services that check
 * permissions and state, never by model output.
 */

export const INTENTS = [
  'REPORT_INCIDENT',
  'REQUEST_ASSISTANCE',
  'STATUS_CHECK',
  'SCHEDULE_CONFLICT',
  'FIND_PERSON',
  'CONSEQUENTIAL_REQUEST',
  'ASK_QUESTION',
] as const;
export type Intent = (typeof INTENTS)[number];

export const IntentResultSchema = z.object({
  intent: z.enum(INTENTS),
  category: z.enum(INCIDENT_CATEGORIES).nullable(),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  entities: z.array(z.string().min(1).max(60)).max(20),
  roomHint: z.string().max(60).nullable(),
  missingInformation: z.array(z.enum(['room', 'session', 'description'])).max(3),
  requiresHumanApproval: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type IntentResult = z.infer<typeof IntentResultSchema>;

export type InterpretationSource = 'AI_PROVIDER' | 'DETERMINISTIC_FALLBACK';

export type FallbackReason =
  | 'NO_PROVIDER_CONFIGURED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'INVALID_STRUCTURED_OUTPUT';

export interface Interpretation {
  result: IntentResult;
  source: InterpretationSource;
  fallbackReason: FallbackReason | null;
}

export interface IntentInput {
  text: string;
  roomNames: readonly string[];
}

/** A provider returns raw, unvalidated JSON. The service validates it. */
export interface IntentProvider {
  readonly name: string;
  classify(input: IntentInput, signal: AbortSignal): Promise<unknown>;
}

export class ProviderRateLimitError extends Error {
  constructor(message = 'Provider rate limit reached.') {
    super(message);
    this.name = 'ProviderRateLimitError';
  }
}

const PROBLEM_WORDS = /\b(not working|stopped|broken|doesn'?t work|can'?t|cannot|too many|overcrowd\w*|inaccessible|blocked|full|no way|dead|crackl\w*|faulty)\b/i;
const ASSIST_WORDS = /\b(need|want|looking for)\b.{0,20}\b(volunteer|help|assistance|someone to help)\b|\bcan (someone|somebody) help\b/i;
const STATUS_WORDS = /\b(reported|told|mentioned|earlier|minutes? ago|hours? ago)\b.*\b(anyone|someone|handling|status|still|update)\b|\bis anyone (handling|working)\b|\bstill (not|broken|no)\b/i;
const SCHEDULE_WORDS = /\b(schedule|agenda|timetable|speaker says|says \d|overlap|clash|conflict)\b/i;
const FIND_PERSON_WORDS = /\b(find|speak|talk|meet|connect)\b.{0,30}\b(someone|person|people|expert)\b|\bwho works on\b|\bsomeone (experienced|who knows|working on)\b/i;
const CONSEQUENTIAL_WORDS = /\b(move|cancel|publish|announce|reassign|swap|replace)\b.{0,40}\b(session|room|announcement|staff|speaker)\b/i;

/**
 * Deterministic interpreter. Covers the scenarios HELLO must handle without a model.
 * It is intentionally conservative: when unsure, it asks a question rather than acting.
 */
export function interpretDeterministically(input: IntentInput): IntentResult {
  const text = input.text.trim();
  const classification = classifyUtterance(text);
  const roomHintMatch = input.roomNames.find((name) => text.toLowerCase().includes(name.toLowerCase())) ?? null;

  let intent: Intent = 'ASK_QUESTION';
  let confidence = 0.6;

  if (STATUS_WORDS.test(text)) {
    intent = 'STATUS_CHECK';
    confidence = 0.85;
  } else if (CONSEQUENTIAL_WORDS.test(text)) {
    intent = 'CONSEQUENTIAL_REQUEST';
    confidence = 0.75;
  } else if (FIND_PERSON_WORDS.test(text)) {
    intent = 'FIND_PERSON';
    confidence = 0.8;
  } else if (SCHEDULE_WORDS.test(text) && classification.category === 'SCHEDULE') {
    intent = 'SCHEDULE_CONFLICT';
    confidence = 0.8;
  } else if (ASSIST_WORDS.test(text)) {
    intent = 'REQUEST_ASSISTANCE';
    confidence = 0.8;
  } else if (classification.category !== 'GENERAL' || PROBLEM_WORDS.test(text)) {
    intent = 'REPORT_INCIDENT';
    confidence = classification.category !== 'GENERAL' ? 0.85 : 0.6;
  }

  const category: IncidentCategory | null = classification.category === 'GENERAL' && intent !== 'REPORT_INCIDENT' ? null : classification.category;

  const missingInformation: IntentResult['missingInformation'] = [];
  const roomScoped = category === 'AV' || category === 'CAPACITY' || category === 'ACCESSIBILITY' || category === 'FACILITIES';
  if (intent === 'REPORT_INCIDENT' && roomScoped && !roomHintMatch && !/\broom\s*\d+\b/i.test(text)) {
    missingInformation.push('room');
  }

  return {
    intent,
    category,
    urgency: classification.urgency,
    entities: classification.equipment,
    roomHint: roomHintMatch,
    missingInformation,
    requiresHumanApproval: intent === 'CONSEQUENTIAL_REQUEST',
    confidence,
  };
}

/** Resolves a `Promise` or rejects after `ms`, cancelling the provider via AbortSignal. */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('TIMEOUT'));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface InterpretOptions {
  provider?: IntentProvider | null;
  timeoutMs?: number;
}

/**
 * Interprets a message. Never throws for provider problems: every failure mode
 * is converted to the deterministic interpreter and reported via `fallbackReason`.
 */
export async function interpretMessage(input: IntentInput, options: InterpretOptions = {}): Promise<Interpretation> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const fallback = (reason: FallbackReason): Interpretation => ({
    result: interpretDeterministically(input),
    source: 'DETERMINISTIC_FALLBACK',
    fallbackReason: reason,
  });

  if (!options.provider) {
    return fallback('NO_PROVIDER_CONFIGURED');
  }

  const provider = options.provider;
  let raw: unknown;
  try {
    raw = await withTimeout((signal) => provider.classify(input, signal), timeoutMs);
  } catch (error: unknown) {
    if (error instanceof ProviderRateLimitError) {
      return fallback('PROVIDER_RATE_LIMITED');
    }
    if (error instanceof Error && error.message === 'TIMEOUT') {
      return fallback('PROVIDER_TIMEOUT');
    }
    return fallback('PROVIDER_ERROR');
  }

  const parsed = IntentResultSchema.safeParse(raw);
  if (!parsed.success) {
    return fallback('INVALID_STRUCTURED_OUTPUT');
  }
  return { result: parsed.data, source: 'AI_PROVIDER', fallbackReason: null };
}
