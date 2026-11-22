'use client';

import { useEffect } from 'react';

/**
 * Registers the offline service worker (public/sw.js) and warms the care page once per browser session, so
 * "I need a break" opens without a connection afterwards. The worker caches only that page and immutable
 * static files. The warm-up reads the whole body: an unread response stays open, which kept every event page
 * permanently "busy" (and broke network-idle waits) in the first version.
 */
export function OfflineCare({ eventId }: { eventId: string }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    const key = `hello.care-warm.${eventId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
    } catch {
      /* storage blocked: warm anyway */
    }
    // The first visit is only controlled once the worker claims the page; wait for that (or give up after 5 s).
    const controlled = () =>
      navigator.serviceWorker.controller
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => { resolve(true); }, { once: true });
            window.setTimeout(() => { resolve(navigator.serviceWorker.controller !== null); }, 5000);
          });
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(controlled)
      .then(async (ok) => {
        if (!ok) return;
        await (await fetch(`/events/${eventId}/care`, { credentials: 'same-origin' })).text();
        try {
          window.sessionStorage.setItem(key, '1');
        } catch {
          /* nothing to remember */
        }
      })
      .catch(() => undefined);
  }, [eventId]);
  return null;
}
