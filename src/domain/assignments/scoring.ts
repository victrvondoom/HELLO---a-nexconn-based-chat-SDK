import type { AvailabilityState, IncidentCategory, Membership, Role } from '../types';
import { STAFF_ROLES } from '../types';

/**
 * Explainable assignment scoring.
 *
 * Every candidate receives the same four components in [0, 1]. The total is a
 * weighted sum, and each component is reported so a coordinator can see why one
 * person ranks above another. Eligibility is decided before scoring: an
 * ineligible person is never shown as a recommendation, whatever their score.
 */

export interface AssignmentWeights {
  skill: number;
  workload: number;
  availability: number;
  location: number;
}

export const DEFAULT_ASSIGNMENT_WEIGHTS: AssignmentWeights = {
  skill: 0.4,
  workload: 0.25,
  availability: 0.2,
  location: 0.15,
};

export const MAX_OPEN_ASSIGNMENTS = 3;

export function validateWeights(weights: AssignmentWeights): void {
  const values: number[] = [weights.skill, weights.workload, weights.availability, weights.location];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error('Assignment weights must be finite and non-negative.');
  }
  const total = values.reduce((sum, v) => sum + v, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`Assignment weights must sum to 1 (received ${total.toFixed(4)}).`);
  }
}

/** Which operational skill a category needs. Matching uses `Membership.skills`. */
export const CATEGORY_SKILL: Record<IncidentCategory, string> = {
  AV: 'AV',
  CAPACITY: 'STEWARDING',
  ACCESSIBILITY: 'ACCESSIBILITY',
  FACILITIES: 'FACILITIES',
  SCHEDULE: 'STEWARDING',
  GENERAL: 'GENERAL',
};

export interface AssignmentCandidateInput {
  membership: Membership;
  displayName: string;
  openAssignments: number;
}

export interface AssignmentRequest {
  category: IncidentCategory;
  /** Zone of the incident's room. Null when the incident has no room yet. */
  zone: string | null;
}

export interface AssignmentScore {
  membershipId: string;
  userId: string;
  displayName: string;
  role: Role;
  total: number;
  components: { skill: number; workload: number; availability: number; location: number };
  reasons: string[];
}

export interface AssignmentRanking {
  eligible: AssignmentScore[];
  ineligible: Array<{ userId: string; displayName: string; reason: string }>;
}

const AVAILABILITY_SCORE: Record<AvailabilityState, number> = {
  AVAILABLE: 1,
  BUSY: 0.4,
  OFF_SHIFT: 0,
};

export function skillScore(skills: readonly string[], required: string): number {
  if (skills.includes(required)) {
    return 1;
  }
  // Technical faults (AV) need a recorded technical skill. Generalists may take other work at half weight.
  if (skills.includes('GENERAL') && required !== 'AV') {
    return 0.5;
  }
  return 0;
}

export function locationScore(staffZone: string | null, incidentZone: string | null): number {
  if (incidentZone === null || staffZone === null) {
    return 0.5;
  }
  return staffZone === incidentZone ? 1 : 0.2;
}

export function rankAssignees(
  request: AssignmentRequest,
  candidates: readonly AssignmentCandidateInput[],
  weights: AssignmentWeights = DEFAULT_ASSIGNMENT_WEIGHTS,
  maxOpen: number = MAX_OPEN_ASSIGNMENTS,
): AssignmentRanking {
  validateWeights(weights);
  const required = CATEGORY_SKILL[request.category];
  const eligible: AssignmentScore[] = [];
  const ineligible: AssignmentRanking['ineligible'] = [];

  for (const candidate of candidates) {
    const { membership, displayName, openAssignments } = candidate;

    if (!STAFF_ROLES.includes(membership.role)) {
      ineligible.push({ userId: membership.userId, displayName, reason: 'Not operational staff.' });
      continue;
    }
    if (membership.availability === 'OFF_SHIFT') {
      ineligible.push({ userId: membership.userId, displayName, reason: 'Off shift.' });
      continue;
    }
    if (openAssignments >= maxOpen) {
      ineligible.push({
        userId: membership.userId,
        displayName,
        reason: `Already holds ${openAssignments} open assignments (limit ${maxOpen}).`,
      });
      continue;
    }

    const skill = skillScore(membership.skills, required);
    // Organisers can always take work they are asked to coordinate; others need a matching skill.
    if (skill === 0 && membership.role !== 'ORGANISER') {
      ineligible.push({
        userId: membership.userId,
        displayName,
        reason: `No ${required} skill recorded.`,
      });
      continue;
    }

    const components = {
      skill,
      workload: 1 - openAssignments / maxOpen,
      availability: AVAILABILITY_SCORE[membership.availability],
      location: locationScore(membership.zone, request.zone),
    };
    const total =
      weights.skill * components.skill +
      weights.workload * components.workload +
      weights.availability * components.availability +
      weights.location * components.location;

    const reasons: string[] = [];
    reasons.push(skill === 1 ? `Has ${required} skill.` : skill === 0.5 ? 'Generalist fallback.' : 'Organiser oversight.');
    reasons.push(`${openAssignments} of ${maxOpen} assignment slots in use.`);
    reasons.push(membership.availability === 'AVAILABLE' ? 'Available now.' : 'Busy with other work.');
    if (components.location === 1) {
      reasons.push('Stationed in the incident zone.');
    }

    eligible.push({
      membershipId: membership.id,
      userId: membership.userId,
      displayName,
      role: membership.role,
      total: Math.round(total * 1000) / 1000,
      components,
      reasons,
    });
  }

  eligible.sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId));
  return { eligible, ineligible };
}
