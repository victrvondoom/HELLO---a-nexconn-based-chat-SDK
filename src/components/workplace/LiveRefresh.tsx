'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { subscribeStream, topicMatches } from '@/components/live/stream';
import { topicsForPage } from '@/components/live/topics';
import { LIVE_SAFETY_POLL_MS } from '@/components/live/client';

/**
 * Keeps a server-rendered page current. It re-renders the page when the live stream reports a change to
 * one of the page's topics (src/components/live/topics.ts). While the stream is down, it falls back to
 * re-requesting the page every `seconds` while the tab is visible.
 */
export function LiveRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const target = topicsForPage(pathname);
    if (!target.eventId || target.topics.length === 0) return;
    let pending: number | null = null;
    let wasConnected: boolean | null = null;
    const schedule = () => {
      pending ??= window.setTimeout(() => {
        pending = null;
        router.refresh();
        setUpdatedAt(new Date());
      }, 300);
    };
    const unsubscribe = subscribeStream(target.eventId, (message) => {
      if (message.kind === 'state') {
        setLive(message.connected);
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
  }, [pathname, router]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setUpdatedAt(new Date());
    };
    const id = window.setInterval(tick, live ? Math.max(seconds * 1000, LIVE_SAFETY_POLL_MS) : seconds * 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [router, seconds, live]);

  return (
    <span className="live" role="status" aria-live="off" data-live={live ? 'stream' : 'polling'}>
      <span className="live__dot" aria-hidden="true" />
      Live
      <span className="faint">
        {updatedAt
          ? ` · updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : live
            ? ' · instant'
            : ` · every ${seconds}s`}
      </span>
    </span>
  );
}
