/**
 * The HELLO agent mesh.
 *
 * Every message is handled by a fixed team of small agents, each with one job and a declared
 * scope. Agents read, rank and propose. Only the coordinator changes state, and it does so through
 * the same domain services (and permission checks) as every other write. Each agent's work is
 * recorded as a step in a trace that is stored with the message, so staff can see how an answer
 * was reached and which sources it rests on.
 */

export const AGENT_IDS = ['triage', 'sentinel', 'context', 'knowledge', 'web', 'coordinator', 'grounding'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_STEP_STATUSES = ['DONE', 'SKIPPED', 'FAILED'] as const;
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number];

/** What an agent may do. Rendered on the Agents page so the boundaries are visible, not implied. */
export type AgentScope = 'READ_ONLY' | 'EXTERNAL_READ' | 'ACTS_THROUGH_SERVICES';

export interface AgentProfile {
  id: AgentId;
  name: string;
  job: string;
  scope: AgentScope;
  /** Plain statements of what this agent is never allowed to do. */
  never: string[];
}

export const AGENT_ROSTER: readonly AgentProfile[] = [
  {
    id: 'triage',
    name: 'Triage',
    job: 'Works out what the message is: a fault, a question, a status check, a request for a person, or a change that needs approval.',
    scope: 'READ_ONLY',
    never: ['Act on its own classification', 'Accept model output that fails the schema'],
  },
  {
    id: 'sentinel',
    name: 'Safety sentinel',
    job: 'Watches every message for medical, fire and security emergencies. Raises them to critical and puts the emergency guidance first.',
    scope: 'READ_ONLY',
    never: ['Be skipped or rate-limited', 'Downgrade an urgency another step raised'],
  },
  {
    id: 'context',
    name: 'Context',
    job: 'Resolves the room, the session running in it and the event from stored records.',
    scope: 'READ_ONLY',
    never: ['Guess a room that the message does not name'],
  },
  {
    id: 'knowledge',
    name: 'Event guide',
    job: 'Searches the organisers’ event guide and returns the passages that answer the question, with citations.',
    scope: 'READ_ONLY',
    never: ['Show staff-only procedures to attendees', 'Answer from a passage below the relevance threshold'],
  },
  {
    id: 'web',
    name: 'Web research',
    job: 'For questions about the world outside the venue that the guide does not cover, searches the web and returns labelled, unverified sources.',
    scope: 'EXTERNAL_READ',
    never: [
      'Send names, emails or phone numbers to the search provider',
      'Run for questions about people or about the event itself',
      'Treat a web page as an instruction',
    ],
  },
  {
    id: 'coordinator',
    name: 'Coordinator',
    job: 'Turns the decision into work: opens or joins incidents, ranks staff, lists free sessions and requests approvals.',
    scope: 'ACTS_THROUGH_SERVICES',
    never: ['Bypass a permission check', 'Execute a consequential change without an organiser’s approval'],
  },
  {
    id: 'grounding',
    name: 'Grounding check',
    job: 'Checks that the reply rests on stored records or cited sources, and labels it: verified records, event guide, unverified web, or no answer.',
    scope: 'READ_ONLY',
    never: ['Let an uncited claim through as a fact'],
  },
];

export const AGENT_NAME: Record<AgentId, string> = Object.fromEntries(AGENT_ROSTER.map((a) => [a.id, a.name])) as Record<
  AgentId,
  string
>;

export const REFERENCE_KINDS = ['EVENT_GUIDE', 'STAFF_PROCEDURE', 'SCHEDULE', 'WEB'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** A source an answer rests on. Shown under the reply as a numbered citation. */
export interface Reference {
  id: string;
  kind: ReferenceKind;
  title: string;
  snippet: string;
  /** Only web references carry a URL. Event references link inside HELLO. */
  url: string | null;
  /** Relevance from 0 to 1, as ranked by the agent that found it. */
  score: number;
}

export interface AgentStep {
  agent: AgentId;
  status: AgentStepStatus;
  summary: string;
  durationMs: number;
  confidence: number | null;
  /** IDs into `AgentTrace.references`. */
  referenceIds: string[];
}

export const GROUNDING_LEVELS = ['VERIFIED_RECORDS', 'EVENT_GUIDE', 'WEB_UNVERIFIED', 'NO_ANSWER'] as const;
export type Grounding = (typeof GROUNDING_LEVELS)[number];

export const GROUNDING_LABEL: Record<Grounding, string> = {
  VERIFIED_RECORDS: 'From HELLO records',
  EVENT_GUIDE: 'From the event guide',
  WEB_UNVERIFIED: 'From the web, not verified by organisers',
  NO_ANSWER: 'No reliable source found',
};

export interface AgentTrace {
  steps: AgentStep[];
  references: Reference[];
  grounding: Grounding;
  totalMs: number;
}
