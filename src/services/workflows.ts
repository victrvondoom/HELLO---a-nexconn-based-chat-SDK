import { z } from 'zod';
import { AGENT_ROSTER } from '../agents/types';
import { DomainError } from '../domain/errors';
import { OPEN_STATUSES } from '../domain/incidents/lifecycle';
import { roleHasCapability, type Capability } from '../domain/permissions';
import type { WorkflowRun } from '../domain/product';
import { audit, notify, requireCapability, type ServiceContext } from './context';
import { createPost } from './feed';
import { createGame } from './games';
import { listIncidentsForViewer } from './incidents';
import { getOperationsOverview } from './sessions';
import { refreshSignals } from './signals';
import { sweepOverdueIncidents } from './workplace';

/**
 * Workflows: named, multi-step jobs that run with one click and no set-up.
 *
 * A workflow has no powers of its own. Every step calls the same service a person would reach
 * through the app, as the person who started it, so each step is authorised and audited exactly as
 * if they had done it by hand. Changes that need an organiser's approval are not available as
 * workflows at all: they keep going through the approval queue.
 */

export interface WorkflowDefinition {
  id: string;
  name: string;
  purpose: string;
  capability: Capability;
  steps: readonly string[];
  /** The canvas node this workflow writes to. */
  feeds: string;
}

export const WORKFLOWS: readonly WorkflowDefinition[] = [
  { id: 'my-day', name: 'Plan my day', purpose: 'Sends you the next sessions and where your open requests stand.', capability: 'event.read', steps: ['Read the schedule', 'Check your open requests', 'Send you the summary'], feeds: 'notifications' },
  { id: 'quiz-round', name: 'Start a schedule quiz', purpose: 'Writes a quiz from the live schedule and invites everyone to play.', capability: 'message.send', steps: ['Write questions from the schedule', 'Announce it in the feed'], feeds: 'games' },
  { id: 'sla-sweep', name: 'Escalate overdue requests', purpose: 'Finds unclaimed requests past their target and escalates each one.', capability: 'incident.escalate', steps: ['Check open requests against their targets', 'Record the result'], feeds: 'incidents' },
  { id: 'signal-refresh', name: 'Detect repeating problems', purpose: 'Groups recent reports into patterns for an organiser to review.', capability: 'signal.read', steps: ['Group recent reports', 'Queue patterns for review'], feeds: 'signals' },
  { id: 'ops-briefing', name: 'Post an operations briefing', purpose: 'Counts open work and crowded rooms, and posts the figures to the feed.', capability: 'incident.read.operational', steps: ['Count open work', 'Check room capacity', 'Post the briefing'], feeds: 'feed' },
];

export const RunSchema = z.object({ workflowId: z.string().regex(/^[a-z-]{3,30}$/) });

type Step = () => Promise<string>;

function stepsFor(ctx: ServiceContext, eventId: string, userId: string, workflowId: string, runId: string): Step[] {
  const memo: Record<string, string> = {};
  switch (workflowId) {
    case 'my-day':
      return [
        async () => {
          const next = (await ctx.store.listSessions(eventId)).filter((s) => s.endsAt > ctx.now()).sort((a, b) => a.startsAt - b.startsAt).slice(0, 3);
          memo.sessions = next.length ? `Next: ${next.map((s) => s.title).join('; ')}.` : 'No more sessions today.';
          return `${next.length} upcoming sessions found.`;
        },
        async () => {
          const mine = (await listIncidentsForViewer(ctx, eventId, userId)).filter((r) => r.isMine && OPEN_STATUSES.includes(r.incident.status));
          memo.requests = mine.length ? `${mine.length} of your requests are still open.` : 'You have no open requests.';
          return memo.requests;
        },
        async () => {
          await notify(ctx, { eventId, recipientUserId: userId, kind: 'WORKFLOW_DIGEST', body: `${memo.sessions} ${memo.requests}`, href: `/events/${eventId}/sessions`, dedupeParts: [runId] });
          return 'Summary sent to your notifications.';
        },
      ];
    case 'quiz-round':
      return [
        async () => {
          const game = await createGame(ctx, eventId, userId, 'QUIZ');
          memo.count = String(game.questions.length);
          return `${memo.count} questions written.`;
        },
        async () => {
          await createPost(ctx, eventId, userId, { text: `A new schedule quiz is open: ${memo.count} questions about today. Play it under Games.`, mediaId: null, communityId: null, repostOf: null });
          return 'Posted to the feed.';
        },
      ];
    case 'sla-sweep':
      return [
        async () => {
          const result = await sweepOverdueIncidents(ctx, eventId, userId);
          memo.result = `${result.escalated.length} escalated, ${result.skipped.length} skipped.`;
          return `${result.checked} requests checked.`;
        },
        () => Promise.resolve(memo.result ?? ''),
      ];
    case 'signal-refresh':
      return [
        async () => {
          const patterns = await refreshSignals(ctx, eventId, userId);
          memo.result = `${patterns.filter((p) => p.reviewStatus === 'PENDING_REVIEW').length} patterns waiting for review.`;
          return `${patterns.length} patterns found.`;
        },
        () => Promise.resolve(memo.result ?? ''),
      ];
    case 'ops-briefing':
      return [
        async () => {
          const open = (await listIncidentsForViewer(ctx, eventId, userId)).filter((r) => OPEN_STATUSES.includes(r.incident.status));
          const unclaimed = open.filter((r) => r.incident.assigneeUserId === null).length;
          memo.work = `${open.length} open requests, ${unclaimed} unclaimed`;
          return `${memo.work}.`;
        },
        async () => {
          const rooms = await getOperationsOverview(ctx, eventId, userId);
          const crowded = rooms.filter((r) => r.overCapacity && r.overCapacityIsVerified).map((r) => r.room.name);
          memo.rooms = crowded.length ? `over capacity: ${crowded.join(', ')}` : 'no room over capacity';
          return `${rooms.length} rooms checked; ${memo.rooms}.`;
        },
        async () => {
          await createPost(ctx, eventId, userId, { text: `Operations briefing: ${memo.work}; ${memo.rooms}.`, mediaId: null, communityId: null, repostOf: null });
          return 'Posted to the feed.';
        },
      ];
    default:
      return [];
  }
}

export async function runWorkflow(ctx: ServiceContext, eventId: string, userId: string, workflowId: string, via: WorkflowRun['via']): Promise<WorkflowRun> {
  const definition = WORKFLOWS.find((w) => w.id === workflowId);
  if (!definition) throw new DomainError('NOT_FOUND', 'That workflow does not exist.');
  await requireCapability(ctx, eventId, userId, definition.capability);
  const run: WorkflowRun = { id: ctx.newId('run'), eventId, workflowId, actorId: userId, via, status: 'SUCCEEDED', startedAt: ctx.now(), steps: [] };
  const steps = stepsFor(ctx, eventId, userId, workflowId, run.id);
  for (const [i, step] of steps.entries()) {
    const label = definition.steps[i] ?? `Step ${i + 1}`;
    try {
      run.steps.push({ label, status: 'SUCCEEDED', detail: await step() });
    } catch (error: unknown) {
      // A failed step stops the run. Its reason is shown only when it is one of our own, safe messages.
      run.steps.push({ label, status: 'FAILED', detail: error instanceof DomainError ? error.message : 'This step failed.' });
      run.status = 'FAILED';
      break;
    }
  }
  await ctx.store.docPut('workflowRuns', run);
  await audit(ctx, eventId, userId, 'workflow.run', 'workflow', workflowId, `${definition.name} ${run.status === 'SUCCEEDED' ? 'finished' : 'failed'} (${via === 'MCP' ? 'through an access token' : 'from the canvas'}).`);
  return run;
}

export interface FlowNode {
  id: string;
  kind: 'source' | 'agent' | 'queue' | 'output' | 'workflow';
  title: string;
  metric: string;
  caption: string;
  href: string | null;
  tone: 'plain' | 'accent' | 'attention' | 'good';
  x: number;
  y: number;
  workflow?: { id: string; purpose: string; steps: readonly string[]; lastRun: { status: WorkflowRun['status']; at: number } | null };
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

/** A live picture of the event as a graph. Every figure is read through the viewer's own permissions. */
export async function flowSnapshot(ctx: ServiceContext, eventId: string, userId: string) {
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  const can = (capability: Capability) => roleHasCapability(membership.role, capability);
  const base = `/events/${eventId}`;
  const now = ctx.now();
  const operational = can('incident.read.operational');

  const [messages, incidents, posts, communities, calls, games, notifications, tokens, locations, runs] = await Promise.all([
    ctx.store.listMessages(eventId),
    listIncidentsForViewer(ctx, eventId, userId),
    ctx.store.docList('posts', { eventId }),
    ctx.store.docList('communities', { eventId }),
    ctx.store.docList('calls', { eventId }),
    ctx.store.docList('games', { eventId }),
    ctx.store.listNotifications(userId),
    ctx.store.docList('apiTokens', { userId }),
    ctx.store.docList('locations', { eventId }),
    ctx.store.docList('workflowRuns', { eventId }),
  ]);
  const seen = operational ? messages : messages.filter((m) => m.senderUserId === userId);
  const open = incidents.filter((r) => OPEN_STATUSES.includes(r.incident.status));
  const unclaimed = open.filter((r) => r.incident.assigneeUserId === null).length;
  const unread = notifications.filter((n) => n.eventId === eventId && n.readAt === null).length;
  const approvals = can('approval.request') ? (await ctx.store.listApprovals(eventId)).filter((a) => a.status === 'PENDING').length : 0;
  const patterns = can('signal.read') ? (await ctx.store.listSignalPatterns(eventId)).filter((p) => p.reviewStatus === 'PENDING_REVIEW').length : 0;
  const liveCalls = calls.filter((c) => c.endedAt === null);
  const inCalls = liveCalls.reduce((sum, c) => sum + c.participants.filter((p) => now - p.seenAt < 15_000).length, 0);
  const openGames = games.filter((g) => g.status === 'WAITING' || g.status === 'ACTIVE').length;
  // Only a count of shares open to the whole event, plus your own: never who or where.
  const sharing = locations.filter((l) => l.expiresAt > now && (l.audience === 'EVENT' || l.userId === userId)).length;
  const visibleRuns = (can('audit.read') ? runs : runs.filter((r) => r.actorId === userId)).sort((a, b) => b.startedAt - a.startedAt);
  const needs = (can('approval.decide') ? approvals : 0) + (operational ? unclaimed : 0) + unread;

  const nodes: FlowNode[] = [
    { id: 'conversation', kind: 'source', title: 'Conversation', metric: String(seen.length), caption: operational ? 'messages to HELLO' : 'your messages to HELLO', href: `${base}/conversation`, tone: 'plain', x: 40, y: 60 },
    { id: 'feed', kind: 'source', title: 'Feed', metric: String(posts.length), caption: `posts · ${posts.filter((p) => p.mediaKind === 'VIDEO').length} videos`, href: `${base}/feed`, tone: 'plain', x: 40, y: 220 },
    { id: 'communities', kind: 'source', title: 'Communities', metric: String(communities.length), caption: `${communities.filter((c) => c.memberIds.includes(userId)).length} joined`, href: `${base}/communities`, tone: 'plain', x: 40, y: 380 },
    { id: 'mcp', kind: 'source', title: 'MCP access', metric: String(tokens.length), caption: 'of your access tokens', href: `${base}/settings#tokens`, tone: 'plain', x: 40, y: 540 },
    { id: 'agents', kind: 'agent', title: 'Agent mesh', metric: String(AGENT_ROSTER.length), caption: ctx.intentProvider ? 'agents · model-assisted' : 'agents · rule-based', href: operational ? `${base}/agents` : null, tone: 'accent', x: 370, y: 60 },
    { id: 'calls', kind: 'queue', title: 'Calls', metric: String(liveCalls.length), caption: `open · ${inCalls} people talking`, href: `${base}/calls`, tone: inCalls > 0 ? 'good' : 'plain', x: 370, y: 220 },
    { id: 'games', kind: 'queue', title: 'Games', metric: String(openGames), caption: 'open to play', href: `${base}/games`, tone: 'plain', x: 370, y: 380 },
    { id: 'incidents', kind: 'queue', title: operational ? 'Incidents' : 'My requests', metric: String(open.length), caption: operational ? `open · ${unclaimed} unclaimed` : 'open', href: `${base}/incidents`, tone: unclaimed > 0 && operational ? 'attention' : 'plain', x: 700, y: 60 },
    { id: 'map', kind: 'queue', title: 'Live map', metric: String(sharing), caption: 'sharing a location by choice', href: `${base}/live-map`, tone: 'plain', x: 700, y: 380 },
    { id: 'needs', kind: 'output', title: 'Needs you', metric: String(needs), caption: needs === 0 ? 'nothing waiting' : 'waiting for you', href: can('approval.decide') && approvals > 0 ? `${base}/operations` : `${base}/notifications`, tone: needs > 0 ? 'attention' : 'good', x: 1030, y: 60 },
    { id: 'notifications', kind: 'output', title: 'Notifications', metric: String(unread), caption: 'unread', href: `${base}/notifications`, tone: 'plain', x: 1030, y: 220 },
  ];
  if (can('signal.read')) nodes.push({ id: 'signals', kind: 'queue', title: 'Signals', metric: String(patterns), caption: 'patterns to review', href: `${base}/operations`, tone: patterns > 0 ? 'attention' : 'plain', x: 700, y: 220 });

  const edges: FlowEdge[] = [
    { from: 'conversation', to: 'agents', label: 'each message' },
    { from: 'agents', to: 'incidents', label: 'reports' },
    { from: 'agents', to: 'notifications', label: 'answers' },
    { from: 'incidents', to: 'needs', label: 'unclaimed' },
    { from: 'feed', to: 'notifications', label: 'likes, comments' },
    { from: 'communities', to: 'calls', label: 'group calls' },
    { from: 'calls', to: 'notifications', label: 'invites' },
    { from: 'mcp', to: 'conversation', label: 'tools' },
  ];
  if (can('signal.read')) edges.push({ from: 'incidents', to: 'signals', label: 'repeats' }, { from: 'signals', to: 'needs', label: 'review' });

  WORKFLOWS.filter((w) => can(w.capability)).forEach((w, i) => {
    const last = visibleRuns.find((r) => r.workflowId === w.id);
    nodes.push({ id: `wf:${w.id}`, kind: 'workflow', title: w.name, metric: '', caption: w.purpose, href: null, tone: 'accent', x: 40 + i * 262, y: 720, workflow: { id: w.id, purpose: w.purpose, steps: w.steps, lastRun: last ? { status: last.status, at: last.startedAt } : null } });
    if (nodes.some((n) => n.id === w.feeds)) edges.push({ from: `wf:${w.id}`, to: w.feeds });
  });

  const names = new Map<string, string>();
  for (const r of visibleRuns.slice(0, 12)) if (!names.has(r.actorId)) names.set(r.actorId, (await ctx.store.getUser(r.actorId))?.displayName ?? 'Someone');
  return {
    now,
    nodes,
    edges,
    runs: visibleRuns.slice(0, 12).map((r) => ({ id: r.id, workflow: WORKFLOWS.find((w) => w.id === r.workflowId)?.name ?? r.workflowId, by: names.get(r.actorId) ?? 'Someone', via: r.via, status: r.status, at: r.startedAt, steps: r.steps })),
  };
}

export type FlowSnapshot = Awaited<ReturnType<typeof flowSnapshot>>;
