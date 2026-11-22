import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { uploadMedia } from '@/services/feed';
import { createCustomMap, deleteCustomMap, listCustomMaps, updateCustomMap } from '@/services/custom-maps';
import { eraseMe, exportMyData } from '@/services/rights';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'OK',
    (e: unknown) => (e instanceof DomainError ? e.code : 'THREW'),
  );
}

describe('Custom maps', () => {
  it('keeps a map private to its owner until it is shared, and lets only the owner change it', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const ben = h.users.attendeeBen;
    const media = await uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG);
    const map = await createCustomMap(h.ctx, h.eventId, ada, { name: 'Family meeting points', mediaId: media.id, source: 'SKETCH' });
    expect(map.shared).toBe(false);

    expect((await listCustomMaps(h.ctx, h.eventId, ben)).shared).toEqual([]);
    expect(await codeOf(updateCustomMap(h.ctx, h.eventId, ben, map.id, { name: 'Taken over' }))).toBe('NOT_FOUND');
    expect(await codeOf(deleteCustomMap(h.ctx, h.eventId, ben, map.id))).toBe('NOT_FOUND');

    const pinned = await updateCustomMap(h.ctx, h.eventId, ada, map.id, { shared: true, pins: [{ id: 'p-1', x: 0.25, y: 0.5, label: 'Meet at the gate', kind: 'MEET' }] });
    expect(pinned.pins).toHaveLength(1);
    const seen = await listCustomMaps(h.ctx, h.eventId, ben);
    expect(seen.shared.map((m) => m.id)).toEqual([map.id]);
    expect(seen.mine).toEqual([]);
  });

  it('only accepts a picture the person uploaded to this event', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const ben = h.users.attendeeBen;
    const bens = await uploadMedia(h.ctx, h.eventId, ben, 'image/png', PNG);
    expect(await codeOf(createCustomMap(h.ctx, h.eventId, ada, { name: 'Not mine', mediaId: bens.id, source: 'IMAGE' }))).toBe('VALIDATION_FAILED');
    expect(await codeOf(createCustomMap(h.ctx, h.eventId, ada, { name: 'Missing', mediaId: 'med-nope', source: 'IMAGE' }))).toBe('VALIDATION_FAILED');
  });

  it('is included in the data export and removed by erasure', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const media = await uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG);
    await createCustomMap(h.ctx, h.eventId, ada, { name: 'Stall layout', mediaId: media.id, source: 'IMAGE' });
    const exported = (await exportMyData(h.ctx, ada)) as unknown as { customMaps: Array<{ name: string }> };
    expect(exported.customMaps.map((m) => m.name)).toEqual(['Stall layout']);
    const report = await eraseMe(h.ctx, ada);
    expect(report.customMapRecords).toBe(1);
    expect(await h.store.docList('customMaps', { ownerId: ada })).toEqual([]);
  });
});
