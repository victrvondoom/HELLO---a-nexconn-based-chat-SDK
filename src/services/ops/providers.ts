import type { AgentRecord } from '@/domain/ops/agents';
import type { LabRun } from '@/domain/ops/bench';
import type { HandoffAction } from '@/domain/ops/handoff';
import type { TimelineEvent } from '@/domain/ops/temporal';
import type { IncidentOwnership } from '@/domain/product';
import type { SubmitResult } from './action-ledger';

/**
 * Integration contracts for the Autonomous Event Operations Network. Each has a status saying honestly what the
 * current implementation is. The UI and docs read PROVIDERS, so a status changes in one place.
 *
 *   LIVE_VERIFIED       real implementation, exercised by tests and in the running app
 *   LOCAL_SIMULATION    real HELLO code running in-process (deterministic), not a deployed external service
 *   PREVIEW             labelled sample data; nothing is computed
 *   PLANNED             contract only
 */
export type ProviderStatus = 'LIVE_VERIFIED' | 'LOCAL_SIMULATION' | 'PREVIEW' | 'PLANNED';

/** Produces agent records for an incident. Must return records that pass AgentRecordSchema; never approves. */
export interface OperationalAgentProvider {
  investigate(input: { eventId: string; incidentId: string; actorUserId: string }): Promise<AgentRecord[]>;
}
/** Delivers timeline events with server timestamps and sequence numbers; supports catch-up from a cursor. */
export interface TemporalEventProvider {
  since(input: { eventId: string; cursorSeq: number; serverNow: number }): Promise<{ events: TimelineEvent[]; cursor: number }>;
}
/** The shared conversation of an incident, carried by a Nexconn group channel. */
export interface IncidentConversationProvider {
  channelFor(input: { eventId: string; incidentId: string }): Promise<{ channelId: string }>;
  post(input: { eventId: string; incidentId: string; authorUserId: string; text: string; automated: boolean }): Promise<{ messageId: string; serverAt: number }>;
  history(input: { eventId: string; incidentId: string; beforeServerAt: number | null; limit: number }): Promise<Array<{ messageId: string; authorUserId: string; text: string; serverAt: number }>>;
}
/** Executes an approved action exactly once and records it. */
export interface ActionExecutionProvider {
  execute(input: { eventId: string; idempotencyKey: string; kind: string; targetId: string; expectedVersion: number; actorUserId: string }): Promise<SubmitResult>;
}
export interface BenchmarkRunner {
  run(input: { seed: number }): Promise<LabRun>;
}
export interface ApprovalService {
  handoff(input: { eventId: string; incidentId: string; actorUserId: string; action: HandoffAction; assigneeId?: string | null }): Promise<IncidentOwnership>;
}

export const PROVIDERS: ReadonlyArray<{ name: string; status: ProviderStatus; owns: string; implementation: string; auth: string; remaining: string }> = [
  { name: 'OperationalAgentProvider', status: 'LOCAL_SIMULATION', owns: 'Investigator, Scheduler, Planner, Critic and Verifier records', implementation: '`agentsFromAnalysis` derives all five from a real Steadfast analysis (deterministic, no model).', auth: 'approval.request', remaining: 'Optional model-written Investigator/Planner text (source MODEL), still checked by Steadfast; persist records per incident.' },
  { name: 'TemporalEventProvider', status: 'PREVIEW', owns: 'Server-timestamped timeline, release, catch-up, gaps', implementation: 'Pure engine `src/domain/ops/temporal.ts` (tested); the page shows sample events.', auth: 'event.read', remaining: 'Feed from announcements, schedule changes and Nexconn messages with a per-event sequence; store cursors per person.' },
  { name: 'IncidentConversationProvider', status: 'PLANNED', owns: 'One Nexconn group channel per incident', implementation: 'None. Nexconn tokens and the browser connection are verified; no group channel, send, receive or history code exists yet.', auth: 'incident.read.operational / reporter', remaining: 'Create group channels via the Platform Chat API, join members, send/receive with the Chat SDK, history, reconnect state, webhook into the incident timeline.' },
  { name: 'ActionExecutionProvider', status: 'LIVE_VERIFIED', owns: 'Append-only action ledger', implementation: '`submitAction`: idempotency key reservation, sequence and versions in one locked docMutate, append-only entries, replay and recovery. Records every Steadfast approval and rejection.', auth: 'per caller (Steadfast: approval.decide)', remaining: 'Route seat holds and other consequential actions through it; run `npm run test:postgres` on a database.' },
  { name: 'BenchmarkRunner', status: 'LOCAL_SIMULATION', owns: 'Reliability Lab, 12 categories', implementation: '`runReliabilityLab` runs HELLO code in-process on an isolated scratch store.', auth: 'approval.request (to run from the app)', remaining: 'Run against Postgres and two app instances; accept external baseline submissions with their reproduction commands.' },
  { name: 'ApprovalService (handoff)', status: 'LIVE_VERIFIED', owns: 'Incident ownership: AI triage → staff → takeover → resolve → hand-back', implementation: '`handOff`: server-side permission checks, conditional writes, audit on every transition.', auth: 'incident.read.operational; incident.claim to assign or own', remaining: 'Pause the conversation pipeline\'s automated replies while a human owns the incident; mirror transitions into the incident\'s Nexconn channel.' },
];
