// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/twitch/monitor.py), AGPL-3.0.

import { EVENTSUB_URL, HELIX, VALIDATE_EVERY_MS, VALIDATE_URL, interpret, subscriptions, validationProblem, type TwitchValidation } from '@/domain/privacy-filter/twitch';

/**
 * Twitch live status and `!privacy` alerts over EventSub (WebSocket transport), run on the HELLO server.
 *
 * The access token is held in this object's memory only: it is never stored, logged or returned to a browser.
 * A generation counter retires the previous connection loop whenever the person reconnects or disconnects.
 * Camera frames are unrelated to this: protection never depends on Twitch.
 */

export interface TwitchState {
  connection: string;
  live: boolean | null;
  channel: string;
  alert: { sender: string; at: number } | null;
}

export class TwitchHttpError extends Error {
  constructor(readonly status: number) {
    super(`Twitch API returned ${status}`);
  }
}

/** One open WebSocket, read as a queue of parsed JSON messages. */
export interface EventSocket {
  next(timeoutMs: number): Promise<unknown>;
  close(): void;
}

export interface TwitchDeps {
  fetch: typeof fetch;
  open: (url: string) => Promise<EventSocket>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onAlert: (sender: string) => Promise<void> | void;
}

/** Read timeout: Twitch sends a keepalive at least every 10 s by default; upstream waits 40 s. */
const RECV_TIMEOUT_MS = 40_000;
const RETRY_MS = 5_000;

export class TwitchMonitor {
  state: TwitchState = { connection: 'disconnected', live: null, channel: '', alert: null };
  private generation = 0;

  constructor(private readonly deps: TwitchDeps) {}

  private async api(url: string, token: string, clientId?: string, body?: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (clientId) headers['Client-Id'] = clientId;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.deps.fetch(url, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new TwitchHttpError(response.status);
    return (await response.json()) as Record<string, unknown>;
  }

  disconnect(): void {
    this.generation += 1;
    this.state = { connection: 'disconnected', live: null, channel: '', alert: null };
  }

  /** Validates the token, then starts the connection loop. Throws when the token is not usable. */
  async connect(token: string, clientId: string): Promise<void> {
    const valid = (await this.api(VALIDATE_URL, token)) as TwitchValidation;
    const problem = validationProblem(valid, clientId);
    if (problem) throw new Error(problem);
    this.generation += 1;
    const generation = this.generation;
    this.state = { connection: 'connecting', live: null, channel: typeof valid.login === 'string' ? valid.login : '', alert: null };
    void this.run(token, clientId, valid.user_id as string, generation);
  }

  private current(generation: number): boolean {
    return generation === this.generation;
  }

  private async subscribe(ws: EventSocket, token: string, clientId: string, userId: string): Promise<boolean> {
    const welcome = (await ws.next(RECV_TIMEOUT_MS)) as { payload?: { session?: { id?: unknown } } };
    const session = welcome.payload?.session?.id;
    if (typeof session !== 'string') throw new Error('Twitch did not send a session');
    for (const subscription of subscriptions(userId, session)) await this.api(`${HELIX}/eventsub/subscriptions`, token, clientId, subscription);
    const streams = await this.api(`${HELIX}/streams?user_id=${encodeURIComponent(userId)}`, token, clientId);
    return Array.isArray(streams.data) && streams.data.length > 0;
  }

  private async run(token: string, clientId: string, userId: string, generation: number): Promise<void> {
    while (this.current(generation)) {
      let ws: EventSocket | null = null;
      try {
        ws = await this.deps.open(EVENTSUB_URL);
        const live = await this.subscribe(ws, token, clientId, userId);
        if (!this.current(generation)) break;
        this.state = { ...this.state, connection: 'connected', live };
        let validated = this.deps.now();
        while (this.current(generation)) {
          const message = await ws.next(RECV_TIMEOUT_MS);
          if (!this.current(generation)) break;
          const step = interpret(message, userId);
          if (step.kind === 'revoked') throw new Error('Twitch subscription interrupted');
          if (step.kind === 'reconnect') {
            // Twitch moves the session: open the new socket, wait for its welcome, then drop the old one.
            // Existing subscriptions transfer with the session, so nothing is re-subscribed.
            const replacement = await this.deps.open(step.url);
            try {
              const hello = (await replacement.next(RECV_TIMEOUT_MS)) as { metadata?: { message_type?: unknown } };
              if (hello.metadata?.message_type !== 'session_welcome') throw new Error('invalid Twitch reconnect welcome');
            } catch (error) {
              replacement.close();
              throw error;
            }
            ws.close();
            ws = replacement;
          } else if (step.kind === 'live') {
            this.state = { ...this.state, live: step.live };
          } else if (step.kind === 'alert') {
            this.state = { ...this.state, alert: { sender: step.sender, at: this.deps.now() } };
            await Promise.resolve(this.deps.onAlert(step.sender)).catch(() => undefined);
          }
          if (this.deps.now() - validated > VALIDATE_EVERY_MS) {
            await this.api(VALIDATE_URL, token); // Twitch requires hourly token validation
            validated = this.deps.now();
          }
        }
      } catch (error) {
        if (this.current(generation)) {
          if (error instanceof TwitchHttpError && (error.status === 401 || error.status === 403)) {
            this.state = { ...this.state, connection: 'authorization expired or denied; reconnect Twitch', live: null };
            return;
          }
          this.state = { ...this.state, connection: 'connection interrupted; retrying', live: null };
        }
      } finally {
        ws?.close();
      }
      if (this.current(generation)) await this.deps.sleep(RETRY_MS);
    }
  }
}

/** A WebSocket (Node 22+ global, or the browser's) read as a message queue. */
export async function openWebSocket(url: string): Promise<EventSocket> {
  const ws = new WebSocket(url);
  const queue: unknown[] = [];
  const waiters: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  let failure: Error | null = null;
  const fail = (error: Error) => {
    failure ??= error;
    for (const w of waiters.splice(0)) w.reject(failure);
  };
  ws.addEventListener('message', (event: MessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      fail(new Error('Twitch sent a message that is not JSON'));
      return;
    }
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(parsed);
    else queue.push(parsed);
  });
  ws.addEventListener('close', () => {
    fail(new Error('Twitch closed the connection'));
  });
  ws.addEventListener('error', () => {
    fail(new Error('Twitch connection failed'));
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener(
      'open',
      () => {
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'error',
      () => {
        reject(new Error('Twitch connection failed'));
      },
      { once: true },
    );
  });
  return {
    next(timeoutMs: number) {
      if (queue.length) return Promise.resolve(queue.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const entry = {
          resolve: (v: unknown) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e: Error) => {
            clearTimeout(timer);
            reject(e);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(entry), 1);
          reject(new Error('Twitch went quiet'));
        }, timeoutMs);
        waiters.push(entry);
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}
