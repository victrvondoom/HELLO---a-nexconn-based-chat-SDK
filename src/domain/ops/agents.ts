import { z } from 'zod';
import type { Analysis } from '../resilience/repair';
import { DISRUPTION_LABEL } from '../resilience/world';

/**
 * Evidence-producing operational agents (pattern: specialised agent teams with structured, checkable output).
 * Each agent writes one record. No agent can approve or execute: `execution` can only reach EXECUTED_BY_HUMAN with a
 * named human approver, and the deterministic Steadfast simulator stays authoritative over any agent's claim.
 */
export const AGENT_ROLES = ['INVESTIGATOR', 'PLANNER', 'SCHEDULER', 'CRITIC', 'VERIFIER'] as const;
export const AGENT_STATES = ['QUEUED', 'INVESTIGATING', 'PROPOSING', 'CHECKING', 'FAILED', 'VERIFIED', 'AWAITING_HUMAN_APPROVAL'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export type AgentState = (typeof AGENT_STATES)[number];

/** `kind:id`, e.g. `incident:inc-1`, `simulation:w-ab12/sch-cd34/mask:17`, `certificate:cert-…`. */
export const EvidenceRefSchema = z.string().regex(/^(incident|report|message|session|room|simulation|certificate|proposal|witness|fixture):[A-Za-z0-9:_./+-]{1,160}$/);

export const AgentRecordSchema = z
  .object({
    id: z.string().min(1).max(120),
    role: z.enum(AGENT_ROLES),
    state: z.enum(AGENT_STATES),
    /** DETERMINISTIC: computed by HELLO's own code. MODEL: written by a language model (none configured). PREVIEW: fixture. */
    source: z.enum(['DETERMINISTIC', 'MODEL', 'PREVIEW']),
    evidence: z.array(EvidenceRefSchema).min(1),
    conclusion: z.string().min(1).max(600),
    confidence: z.number().min(0).max(1),
    assumptions: z.array(z.string().max(300)),
    rejectedAlternatives: z.array(z.object({ summary: z.string().max(300), reason: z.string().max(300) })),
    verificationRequirements: z.array(z.string().max(300)).min(1),
    execution: z.enum(['NOT_EXECUTABLE', 'AWAITING_HUMAN_APPROVAL', 'EXECUTED_BY_HUMAN']),
    approvedByUserId: z.string().nullable(),
  })
  .refine((r) => r.execution !== 'EXECUTED_BY_HUMAN' || r.approvedByUserId !== null, { message: 'Only a named human can have executed an action.' })
  .refine((r) => r.source !== 'MODEL' || r.state !== 'VERIFIED', { message: 'A model cannot mark its own output verified; only the deterministic verifier can.' });

export type AgentRecord = z.infer<typeof AgentRecordSchema>;

/**
 * Builds the five records from a real Steadfast analysis. Everything here is derived from simulator output, so
 * every record is DETERMINISTIC and cites the simulation, witness or certificate it came from.
 */
export function agentsFromAnalysis(a: Analysis, incidentRef: string): AgentRecord[] {
  const sim = (mask: string) => `simulation:${a.worldVersion}/${a.baselineVersion}/${mask}`;
  const incident = a.incident.map((d) => DISRUPTION_LABEL[d]).join(' + ') || 'no disruption';
  const rec = a.recommended;
  const base = { source: 'DETERMINISTIC' as const, approvedByUserId: null };
  return [
    {
      ...base,
      id: `investigator:${a.baselineVersion}`,
      role: 'INVESTIGATOR',
      state: 'VERIFIED',
      evidence: [incidentRef, sim(`incident`)],
      conclusion: a.baseline.pass ? `The current schedule copes with ${incident} alone.` : `${incident} breaks ${a.baseline.affectedSessions.length} session(s): ${a.baseline.violations.slice(0, 3).map((v) => v.detail).join(' ')}`,
      confidence: 1,
      assumptions: ['The incident maps to the listed disruption.', 'Room and session records are current.'],
      rejectedAlternatives: [],
      verificationRequirements: ['Simulator reproduces the violation on the stored baseline version.'],
      execution: 'NOT_EXECUTABLE',
    },
    {
      ...base,
      id: `scheduler:${a.baselineVersion}`,
      role: 'SCHEDULER',
      state: 'VERIFIED',
      evidence: [sim('lattice'), ...a.discovery.minimalFailingSets.slice(0, 4).map((s) => `witness:${s.join('+') || 'none'}`)],
      conclusion: `${a.discovery.minimalFailingSets.length} minimal failing disruption set(s) on the current schedule (${a.discovery.queries} simulator queries${a.monotonicity.monotone ? ', monotone pruning' : ''}).`,
      confidence: a.discovery.exhausted ? 0.5 : 1,
      assumptions: a.monotonicity.monotone ? ['World certified monotone for this schedule version.'] : ['World not monotone: pruning disabled.'],
      rejectedAlternatives: [],
      verificationRequirements: ['Every proper subset of a reported set passes.'],
      execution: 'NOT_EXECUTABLE',
    },
    {
      ...base,
      id: `planner:${a.baselineVersion}`,
      role: 'PLANNER',
      state: rec ? 'AWAITING_HUMAN_APPROVAL' : 'FAILED',
      evidence: rec ? [`proposal:${rec.schedule.version}`] : [sim('repair')],
      conclusion: rec ? `Move ${rec.changes.length} session(s), cost ${rec.cost.total}.` : 'No certified recovery was found within the repair budget.',
      confidence: rec ? 1 : 0,
      assumptions: ['Cost model: docs/HELLO_STEADFAST.md §4.'],
      rejectedAlternatives: a.rejected.slice(0, 5).map((r) => ({ summary: `${r.changes.length} move(s), cost ${r.cost.total}`, reason: `fails under ${r.failsUnder?.disruptions.join(' + ') ?? '?'} (${r.rejectedBy ?? ''})` })),
      verificationRequirements: ['Exact verification of all 256 subsets on the proposed version.', 'Organiser approval.'],
      execution: rec ? 'AWAITING_HUMAN_APPROVAL' : 'NOT_EXECUTABLE',
    },
    {
      ...base,
      id: `critic:${a.baselineVersion}`,
      role: 'CRITIC',
      state: 'VERIFIED',
      evidence: a.rounds.flatMap((r) => (r.critic.witness ? [`witness:${r.critic.witness.disruptions.join('+') || 'none'}`] : [sim(`critic-round-${r.round}`)])).slice(0, 6).concat(a.rounds.length ? [] : [sim('critic')]),
      conclusion: a.strongestAttack,
      confidence: 1,
      assumptions: ['A claim counts only with a simulator witness.'],
      rejectedAlternatives: [],
      verificationRequirements: ['Each witness fails when re-simulated.'],
      execution: 'NOT_EXECUTABLE',
    },
    {
      ...base,
      id: `verifier:${a.baselineVersion}`,
      role: 'VERIFIER',
      state: rec?.certificate.allPass ? 'VERIFIED' : 'FAILED',
      evidence: rec ? [`certificate:${rec.certificate.digest}`] : [sim('verify')],
      conclusion: rec ? `${rec.certificate.subsetsChecked} of 256 disruption subsets pass on ${rec.schedule.version}.` : 'Nothing to verify.',
      confidence: 1,
      assumptions: ['Bounded world of 8 disruptions.'],
      rejectedAlternatives: [],
      verificationRequirements: ['Certificate digest matches on approval; otherwise the proposal is stale.'],
      execution: 'NOT_EXECUTABLE',
    },
  ];
}

/** Activity timeline: the states each agent passed through, in order, for display. */
export function agentTimeline(records: AgentRecord[]): Array<{ step: number; role: AgentRole; state: AgentState }> {
  const path: Record<AgentRole, AgentState[]> = {
    INVESTIGATOR: ['QUEUED', 'INVESTIGATING'],
    SCHEDULER: ['QUEUED', 'CHECKING'],
    PLANNER: ['QUEUED', 'PROPOSING'],
    CRITIC: ['QUEUED', 'CHECKING'],
    VERIFIER: ['QUEUED', 'CHECKING'],
  };
  let step = 0;
  return records.flatMap((r) => [...path[r.role], r.state].map((state) => ({ step: ++step, role: r.role, state })));
}
