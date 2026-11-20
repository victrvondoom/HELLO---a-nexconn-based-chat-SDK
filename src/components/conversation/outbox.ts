'use client';

/**
 * The conversation's offline outbox. A message is saved here before it is sent and removed only when the
 * server has answered (or refused it). If the connection drops, it stays, and is sent again, in order, when
 * the browser is back online or the page is opened again. Each message carries a client id, so a resend of
 * one the server already handled is not handled twice (src/services/chat-gateway.ts, handleMessageOnce).
 *
 * Kept per event in localStorage. Every access is guarded: private windows and blocked storage just mean
 * no outbox, never a broken composer.
 */
export interface QueuedMessage {
  clientId: string;
  text: string;
  queuedAt: number;
}

const key = (eventId: string) => `hello-outbox:${eventId}`;

export function readOutbox(eventId: string): QueuedMessage[] {
  try {
    const raw = window.localStorage.getItem(key(eventId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedMessage[]).filter((m) => typeof m.clientId === 'string' && typeof m.text === 'string') : [];
  } catch {
    return [];
  }
}

function writeOutbox(eventId: string, items: QueuedMessage[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(key(eventId));
    else window.localStorage.setItem(key(eventId), JSON.stringify(items));
  } catch {
    // Storage unavailable: the message is still sent while online.
  }
}

export function enqueue(eventId: string, text: string): QueuedMessage {
  const item = { clientId: crypto.randomUUID().replace(/-/g, ''), text, queuedAt: Date.now() };
  writeOutbox(eventId, [...readOutbox(eventId), item]);
  return item;
}

export function remove(eventId: string, clientId: string): void {
  writeOutbox(eventId, readOutbox(eventId).filter((m) => m.clientId !== clientId));
}

export type SendOutcome = { kind: 'sent' } | { kind: 'refused'; message: string } | { kind: 'offline' };

export async function sendQueued(eventId: string, item: QueuedMessage): Promise<SendOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/events/${eventId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: item.text, clientId: item.clientId }),
    });
  } catch {
    return { kind: 'offline' };
  }
  const body = (await response.json().catch(() => null)) as { ok: true } | { ok: false; error: { message: string } } | null;
  if (!body) return { kind: 'offline' };
  if (!body.ok) {
    // Rate limits are temporary: keep the message and try again later.
    if (response.status === 429) return { kind: 'offline' };
    remove(eventId, item.clientId);
    return { kind: 'refused', message: body.error.message };
  }
  remove(eventId, item.clientId);
  return { kind: 'sent' };
}

/** Sends everything waiting, oldest first. Stops at the first message that cannot be sent yet. */
export async function flush(eventId: string): Promise<{ sent: number; refused: string[]; waiting: number }> {
  let sent = 0;
  const refused: string[] = [];
  for (const item of readOutbox(eventId)) {
    const outcome = await sendQueued(eventId, item);
    if (outcome.kind === 'offline') break;
    if (outcome.kind === 'sent') sent += 1;
    else refused.push(outcome.message);
  }
  return { sent, refused, waiting: readOutbox(eventId).length };
}
