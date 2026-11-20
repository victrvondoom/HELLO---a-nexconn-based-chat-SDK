'use client';

/**
 * The browser side of the live stream (GET /api/events/[eventId]/stream). One EventSource per event is
 * shared by every component on the page; it closes when the last one unsubscribes. The browser reconnects
 * by itself after a drop, and subscribers are told when the connection is up or down, so they can fall
 * back to polling while it is down and catch up when it returns.
 */
export type StreamMessage =
  | { kind: 'change'; topic: string }
  | { kind: 'typing'; from: string }
  | { kind: 'state'; connected: boolean };

type Handler = (message: StreamMessage) => void;

interface Connection {
  source: EventSource;
  handlers: Set<Handler>;
  connected: boolean;
}

const connections = new Map<string, Connection>();

function open(eventId: string): Connection | null {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return null;
  const source = new EventSource(`/api/events/${encodeURIComponent(eventId)}/stream`);
  const connection: Connection = { source, handlers: new Set(), connected: false };
  const dispatch = (message: StreamMessage) => {
    for (const handler of connection.handlers) handler(message);
  };
  source.addEventListener('ready', () => {
    connection.connected = true;
    dispatch({ kind: 'state', connected: true });
  });
  source.addEventListener('change', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { topic?: unknown };
      if (typeof data.topic === 'string') dispatch({ kind: 'change', topic: data.topic });
    } catch {
      // A malformed frame is ignored; the next poll catches up.
    }
  });
  source.addEventListener('typing', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { from?: unknown };
      if (typeof data.from === 'string') dispatch({ kind: 'typing', from: data.from });
    } catch {
      // ignored
    }
  });
  source.addEventListener('error', () => {
    if (!connection.connected) return;
    connection.connected = false;
    dispatch({ kind: 'state', connected: false });
  });
  connections.set(eventId, connection);
  return connection;
}

/** Subscribes to the event's live stream. Returns the unsubscribe function. */
export function subscribeStream(eventId: string, handler: Handler): () => void {
  const connection = connections.get(eventId) ?? open(eventId);
  if (!connection) return () => undefined;
  connection.handlers.add(handler);
  handler({ kind: 'state', connected: connection.connected });
  return () => {
    connection.handlers.delete(handler);
    if (connection.handlers.size === 0) {
      connection.source.close();
      connections.delete(eventId);
    }
  };
}

/** `*` matches every topic, `field*` every topic that starts with `field`. */
export function topicMatches(patterns: readonly string[], topic: string): boolean {
  return patterns.some((p) => p === '*' || p === topic || (p.endsWith('*') && topic.startsWith(p.slice(0, -1))));
}
