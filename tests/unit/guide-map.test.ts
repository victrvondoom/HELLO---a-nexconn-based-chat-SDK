import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countByStatus, GUIDE } from '@/domain/guide/map';

const EVENT_PAGES = join(process.cwd(), 'src/app/events/[eventId]');

describe('guide map', () => {
  it('points every LIVE or PARTIAL feature with a page at a page that exists', () => {
    for (const area of GUIDE) {
      for (const feature of area.features) {
        if (feature.status === 'PLANNED' || feature.path === '') continue;
        const folder = join(EVENT_PAGES, ...feature.path.split('/').filter(Boolean));
        expect(existsSync(join(folder, 'page.tsx')), `${feature.name} -> ${feature.path}`).toBe(true);
      }
    }
  });

  it('never gives a PLANNED feature a page, and always explains why it is not built', () => {
    for (const area of GUIDE) {
      for (const feature of area.features) {
        if (feature.status === 'LIVE') continue;
        expect(feature.note, feature.name).toBeTruthy();
        if (feature.status === 'PLANNED') expect(feature.path, feature.name).toBe('');
      }
    }
  });

  it('has unique feature names and counts every feature once', () => {
    const names = GUIDE.flatMap((area) => area.features.map((feature) => feature.name));
    expect(new Set(names).size).toBe(names.length);
    const counts = countByStatus();
    expect(counts.LIVE + counts.PARTIAL + counts.PLANNED).toBe(names.length);
  });

  it('keeps every page of the event navigation listed, so no feature is left out', () => {
    const listed = new Set(GUIDE.flatMap((area) => area.features.map((feature) => feature.path)));
    for (const path of ['/feed', '/messages', '/communities', '/people', '/calls', '/games', '/atlas', '/sessions', '/map', '/live', '/places', '/announcements', '/incidents', '/operations', '/team', '/agents', '/audit', '/flow', '/settings', '/notifications', '/conversation']) {
      expect(listed.has(path), path).toBe(true);
    }
  });
});
