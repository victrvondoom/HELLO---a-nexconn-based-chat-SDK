import type { Incident, IncidentReport } from '../types';
import { tokenise } from './classify';
import { isOpen } from './lifecycle';

/**
 * Duplicate detection.
 *
 * Text similarity alone never merges two incidents. Auto-attachment requires the
 * same event, the same room, the same category, an open incident, and a report
 * inside the time window. Equipment and wording only raise or lower confidence.
 * Anything that fails a hard gate becomes its own incident, even if the wording
 * is nearly identical, so separate faults in the same room stay separate.
 */

export const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
export const AUTO_ATTACH_CONFIDENCE = 0.75;

export const DUPLICATE_WEIGHTS = {
  room: 0.3,
  category: 0.25,
  time: 0.15,
  equipment: 0.1,
  similarity: 0.2,
} as const;

export interface IncomingReport {
  eventId: string;
  roomId: string | null;
  category: string;
  equipment: string[];
  text: string;
  at: number;
}

export interface DuplicateAssessment {
  incidentId: string;
  /** Weighted confidence in [0, 1]. Meaningful only when `eligibleForAttach` is true. */
  confidence: number;
  eligibleForAttach: boolean;
  /** Human-readable reasons, suitable for the UI and the audit trail. */
  signals: string[];
  blockedBy: string[];
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (setA.size + setB.size - intersection);
}

export function textSimilarity(a: string, b: string): number {
  return jaccard(tokenise(a), tokenise(b));
}

export interface CandidateContext {
  incident: Incident;
  /** All reports already attached to the candidate. Similarity uses the closest one. */
  reports: readonly IncidentReport[];
}

export function assessDuplicate(
  incoming: IncomingReport,
  candidate: CandidateContext,
  now: number,
): DuplicateAssessment {
  const { incident, reports } = candidate;
  const signals: string[] = [];
  const blockedBy: string[] = [];

  if (incident.eventId !== incoming.eventId) {
    blockedBy.push('different-event');
  }
  if (!isOpen(incident.status)) {
    blockedBy.push('incident-not-open');
  }

  const sameRoom = incoming.roomId !== null && incident.roomId === incoming.roomId;
  if (sameRoom) {
    signals.push('same-room');
  } else {
    blockedBy.push('room-differs-or-unknown');
  }

  const sameCategory = incident.category === incoming.category;
  if (sameCategory) {
    signals.push('same-category');
  } else {
    blockedBy.push('category-differs');
  }

  const withinWindow = Math.abs(now - incident.updatedAt) <= DUPLICATE_WINDOW_MS;
  if (withinWindow) {
    signals.push('within-30-minutes');
  } else {
    blockedBy.push('outside-time-window');
  }

  // Equipment: overlap is supportive; two disjoint, specific equipment sets indicate separate faults.
  let equipmentScore = 0.5;
  if (incoming.equipment.length > 0 && incident.equipment.length > 0) {
    const overlap = jaccard(incoming.equipment, incident.equipment);
    equipmentScore = overlap;
    if (overlap > 0) {
      signals.push('shared-equipment');
    } else {
      blockedBy.push('different-equipment');
    }
  }

  const incomingTokens = incoming.text;
  const similarities = reports.map((r) => textSimilarity(incomingTokens, r.text));
  const bestSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
  if (bestSimilarity >= 0.5) {
    signals.push('similar-description');
  }

  const roomScore = sameRoom ? 1 : 0;
  const categoryScore = sameCategory ? 1 : 0;
  const timeScore = withinWindow ? 1 : 0;

  const confidence =
    DUPLICATE_WEIGHTS.room * roomScore +
    DUPLICATE_WEIGHTS.category * categoryScore +
    DUPLICATE_WEIGHTS.time * timeScore +
    DUPLICATE_WEIGHTS.equipment * equipmentScore +
    DUPLICATE_WEIGHTS.similarity * bestSimilarity;

  const eligibleForAttach =
    blockedBy.length === 0 && confidence >= AUTO_ATTACH_CONFIDENCE;

  return {
    incidentId: incident.id,
    confidence: Math.round(confidence * 1000) / 1000,
    eligibleForAttach,
    signals,
    blockedBy,
  };
}

/**
 * Chooses the best candidate to attach to, or null if none passes every gate.
 * Ties are broken by the earliest-created incident so results are deterministic.
 */
export function findDuplicate(
  incoming: IncomingReport,
  candidates: readonly CandidateContext[],
  now: number,
): DuplicateAssessment | null {
  const assessments = candidates
    .map((c) => assessDuplicate(incoming, c, now))
    .filter((a) => a.eligibleForAttach)
    .sort((a, b) => b.confidence - a.confidence || a.incidentId.localeCompare(b.incidentId));
  return assessments[0] ?? null;
}
