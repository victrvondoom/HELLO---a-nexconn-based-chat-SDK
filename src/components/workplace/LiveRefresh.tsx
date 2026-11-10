'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Keeps a server-rendered page current. It re-requests the page at an interval while the tab is visible,
 * so timers, queues and counts reflect the latest state without a manual reload.
 */
export function LiveRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setUpdatedAt(new Date());
    };
    const id = window.setInterval(tick, seconds * 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [router, seconds]);

  return (
    <span className="live" role="status" aria-live="off">
      <span className="live__dot" aria-hidden="true" />
      Live
      <span className="faint">
        {updatedAt ? ` · updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ` · every ${seconds}s`}
      </span>
    </span>
  );
}
