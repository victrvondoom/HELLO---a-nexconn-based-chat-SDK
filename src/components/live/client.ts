'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeStream, topicMatches } from './stream';
import { topicsForApi } from './topics';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export class ApiError extends Error {}

/** Calls the HELLO API and returns the data, or throws an ApiError carrying the server's own message. */
export async function api<T>(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.');
  }
  const envelope = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!envelope) throw new ApiError('The server sent an unexpected reply. Try again.');
  if (!envelope.ok) throw new ApiError(envelope.error.message);
  return envelope.data;
}

export const errorText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

/** While the live stream is connected, polling is only a safety net. */
export const LIVE_SAFETY_POLL_MS = 60_000;

/**
 * Keeps a view in step with the server: loads `url`, then refreshes it when the live stream reports a
 * change to a topic the view shows (src/components/live/topics.ts), within about 150 ms. While the stream
 * is down it polls every `ms`, as before; while it is up it polls only every minute as a safety net.
 * `refresh` reloads at once, for use right after the viewer changes something.
 */
export function useLive<T>(url: string, initial: T, ms = 5000): { data: T; refresh: () => Promise<void>; stale: boolean; live: boolean } {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const [live, setLive] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await api<T>(url);
      // A slow, older reply must not overwrite a newer one.
      if (ticket === latest.current) {
        setData(next);
        setStale(false);
      }
    } catch {
      if (ticket === latest.current) setStale(true);
    }
  }, [url]);

  // Live stream: refresh on a matching change, and catch up after a reconnect.
  useEffect(() => {
    const target = topicsForApi(url);
    if (!target.eventId || target.topics.length === 0) return;
    let pending: number | null = null;
    let wasConnected: boolean | null = null;
    const schedule = () => {
      pending ??= window.setTimeout(() => {
        pending = null;
        void refresh();
      }, 150);
    };
    const unsubscribe = subscribeStream(target.eventId, (message) => {
      if (message.kind === 'state') {
        setLive(message.connected);
        // Changes made while the stream was down were missed: read once when it comes back.
        if (message.connected && wasConnected === false) schedule();
        wasConnected = message.connected;
        return;
      }
      if (message.kind === 'change' && topicMatches(target.topics, message.topic)) schedule();
    });
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      unsubscribe();
    };
  }, [url, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, live ? Math.max(ms, LIVE_SAFETY_POLL_MS) : ms);
    // A tab that was hidden skipped its polls. Refresh as soon as it is shown again instead of showing
    // data up to `ms` old until the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, ms, live]);

  return { data, refresh, stale, live };
}

/** "just now", "5 min ago", "3 h ago", measured against the server's clock. */
export function ago(now: number, then: number): string {
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}
