import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { OPEN_STATUSES } from '../domain/incidents/lifecycle';
import { roleHasCapability } from '../domain/permissions';
import type { ApiToken } from '../domain/product';
import type { ServiceContext } from './context';
import { consumeAction } from '../lib/action-limits';
import { createPost, listFeed, POST_MAX } from './feed';
import { listIncidentsForViewer } from './incidents';
import { handleMessage, MAX_MESSAGE_LENGTH } from './pipeline';
import { runWorkflow, WORKFLOWS } from './workflows';
import { notificationFeed } from './workplace';

/**
 * A Model Context Protocol server for HELLO (JSON-RPC over HTTP, one request per call, no stream).
 *
 * An assistant connected here can do what the token's owner can do and nothing else: each tool
 * calls the same service the app calls, as that person, in the token's event. Tool arguments are
 * validated with the schema that is advertised to the client. Read-only tokens are refused by
 * every tool that changes something.
 */

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Tool {
  name: string;
  description: string;
  writes: boolean;
  input: z.ZodObject;
  run: (ctx: ServiceContext, token: ApiToken, args: never) => Promise<unknown>;
}

function tool<S extends z.ZodObject>(name: string, description: string, writes: boolean, input: S, run: (ctx: ServiceContext, token: ApiToken, args: z.infer<S>) => Promise<unknown>): Tool {
  return { name, description, writes, input, run };
}

const none = z.object({}).strict();

const TOOLS: Tool[] = [
  tool('hello_whoami', 'Who this token acts as, in which event, and what it may do.', false, none, async (ctx, t) => {
    const [user, event, membership] = await Promise.all([ctx.store.getUser(t.userId), ctx.store.getEvent(t.eventId), ctx.store.findMembership(t.eventId, t.userId)]);
    return { name: user?.displayName, event: event?.name, role: membership?.role, tokenScope: t.scope };
  }),
  tool('hello_schedule', 'Sessions at the event, in time order, with their rooms.', false, none, async (ctx, t) => {
    const [sessions, rooms] = await Promise.all([ctx.store.listSessions(t.eventId), ctx.store.listRooms(t.eventId)]);
    const room = new Map(rooms.map((r) => [r.id, r.name]));
    return sessions.sort((a, b) => a.startsAt - b.startsAt).map((s) => ({ title: s.title, room: room.get(s.roomId) ?? null, startsAt: new Date(s.startsAt).toISOString(), endsAt: new Date(s.endsAt).toISOString(), topics: s.topics }));
  }),
  tool('hello_requests', 'Requests and incidents this person may see, with their current status.', false, z.object({ openOnly: z.boolean().default(true) }).strict(), async (ctx, t, args) => {
    const rows = await listIncidentsForViewer(ctx, t.eventId, t.userId);
    return rows.filter((r) => !args.openOnly || OPEN_STATUSES.includes(r.incident.status)).map((r) => ({ id: r.incident.id, title: r.incident.title, status: r.incident.status, urgency: r.incident.urgency, mine: r.isMine }));
  }),
  tool('hello_notifications', 'This person’s latest notifications.', false, none, async (ctx, t) => {
    const feed = await notificationFeed(ctx, t.eventId, t.userId);
    return { unread: feed.unread, items: feed.items.slice(0, 20).map((n) => ({ body: n.body, at: new Date(n.createdAt).toISOString(), read: n.readAt !== null })) };
  }),
  tool('hello_feed', 'The latest posts in the event feed.', false, none, async (ctx, t) => {
    const posts = await listFeed(ctx, t.eventId, t.userId, { scope: 'all', communityId: null, authorId: null });
    return posts.slice(0, 20).map((p) => ({ id: p.id, author: p.author.name, text: p.text, likes: p.likeCount, comments: p.commentCount, at: new Date(p.createdAt).toISOString() }));
  }),
  tool('hello_workflows', 'Workflows this person may run.', false, none, async (ctx, t) => {
    const membership = await ctx.store.findMembership(t.eventId, t.userId);
    return WORKFLOWS.filter((w) => membership && roleHasCapability(membership.role, w.capability)).map((w) => ({ id: w.id, name: w.name, purpose: w.purpose }));
  }),
  tool('hello_send_message', 'Send a message to HELLO as this person: report a problem, ask a question, or check a request.', true, z.object({ text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }).strict(), async (ctx, t, args) => {
    consumeAction('message.send', t.userId, t.eventId, ctx.now());
    const result = await handleMessage(ctx, { eventId: t.eventId, userId: t.userId, text: args.text });
    return { reply: result.reply, incidents: result.incidents.map((i) => ({ id: i.incidentId, status: i.status })) };
  }),
  tool('hello_post', 'Publish a text post to the event feed as this person.', true, z.object({ text: z.string().trim().min(1).max(POST_MAX) }).strict(), async (ctx, t, args) => {
    consumeAction('post.create', t.userId, t.eventId, ctx.now());
    const post = await createPost(ctx, t.eventId, t.userId, { text: args.text, mediaId: null, communityId: null, repostOf: null });
    return { id: post.id };
  }),
  tool('hello_run_workflow', 'Run one of the workflows listed by hello_workflows.', true, z.object({ workflowId: z.string().regex(/^[a-z-]{3,30}$/) }).strict(), async (ctx, t, args) => {
    consumeAction('workflow.run', t.userId, t.eventId, ctx.now());
    const run = await runWorkflow(ctx, t.eventId, t.userId, args.workflowId, 'MCP');
    return { status: run.status, steps: run.steps };
  }),
];

const Request = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string().max(200), z.number()]).optional(), method: z.string().max(100), params: z.record(z.string(), z.unknown()).optional() });
const CallParams = z.object({ name: z.string().max(100), arguments: z.record(z.string(), z.unknown()).default({}) });

type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

/** Handles one JSON-RPC message. Returns null for notifications, which get no reply. */
export async function handleMcp(ctx: ServiceContext, token: ApiToken, body: unknown): Promise<Reply | null> {
  const parsed = Request.safeParse(body);
  if (!parsed.success) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } };
  const { id, method, params } = parsed.data;
  if (id === undefined) return null;
  const ok = (result: unknown): Reply => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string): Reply => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (method === 'initialize') {
    const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
    return ok({
      protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'hello', version: '1.0.0' },
      instructions: 'HELLO event coordination. Every tool acts as the token’s owner and is limited to what they may do.',
    });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') {
    return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input), annotations: { readOnlyHint: !t.writes } })) });
  }
  if (method === 'tools/call') {
    const call = CallParams.safeParse(params);
    const found = call.success ? TOOLS.find((t) => t.name === call.data.name) : undefined;
    if (!call.success || !found) return fail(-32602, 'Unknown tool.');
    const text = (value: unknown, isError = false) => ok({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError });
    if (found.writes && token.scope !== 'WRITE') return text('This token is read-only. Create a read and write token to use this tool.', true);
    const args = found.input.safeParse(call.data.arguments);
    if (!args.success) return text('The arguments do not match this tool’s input schema.', true);
    try {
      return text(await found.run(ctx, token, args.data as never));
    } catch (error: unknown) {
      if (error instanceof DomainError) return text(error.message, true);
      throw error;
    }
  }
  return fail(-32601, 'Method not found.');
}
