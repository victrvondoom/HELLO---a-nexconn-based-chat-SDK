'use client';

import { useState } from 'react';

type Filter = 'ALL' | 'LIVE' | 'PARTIAL' | 'PLANNED';

const OPTIONS: Array<{ id: Filter; label: string }> = [
  { id: 'ALL', label: 'Everything' },
  { id: 'LIVE', label: 'Works now' },
  { id: 'PARTIAL', label: 'With a limit' },
  { id: 'PLANNED', label: 'Not built yet' },
];

/**
 * Filters the guide by status. The list is rendered on the server with every item present, so the page reads
 * correctly without JavaScript; this only hides items that do not match.
 */
export function GuideFilter() {
  const [active, setActive] = useState<Filter>('ALL');

  function choose(next: Filter) {
    setActive(next);
    for (const item of document.querySelectorAll<HTMLElement>('.guide-item')) {
      item.hidden = next !== 'ALL' && item.dataset.status !== next;
    }
    for (const area of document.querySelectorAll<HTMLElement>('.guide-area')) {
      area.hidden = area.querySelectorAll('.guide-item:not([hidden])').length === 0;
    }
  }

  return (
    <div className="guide-filter" role="group" aria-label="Show features by status">
      {OPTIONS.map((option) => (
        <button key={option.id} type="button" className="guide-chip" aria-pressed={active === option.id} onClick={() => {
            choose(option.id);
          }}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
