'use client';

import { useEffect } from 'react';

/** Keeps the newest message in view when the thread loads. */
export function ScrollToEnd() {
  useEffect(() => {
    document.getElementById('thread-end')?.scrollIntoView({ block: 'end' });
  }, []);
  return <div id="thread-end" aria-hidden="true" />;
}
