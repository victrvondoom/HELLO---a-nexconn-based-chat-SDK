/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests assert the shape first and then read through it */
import { describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { DomainError } from '@/domain/errors';
import { gatePosition, isWalkable, MAX_STEP, tileAt, WORLD_SIZE } from '@/domain/kingdom/world';
import { eraseKingdoms, foundKingdom, kingdomAction, kingdomView, type KingdomAction } from '@/services/kingdoms';
import { eraseMe, exportMyData } from '@/services/rights';

/** The error code a promise rejects with, or OK. */
async function code(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'OK';
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return e.code;
  }
}

const act = (h: Harness, userId: string, input: KingdomAction) => kingdomAction(h.ctx, h.eventId, userId, input);
const view = (h: Harness, userId: string) => kingdomView(h.ctx, h.eventId, userId);

/** A dry tile within one step of where a citizen stands. */
async function neighbour(h: Harness, userId: string) {
  const v = await view(h, userId);
  const me = v.you.citizen!;
  const seed = v.kingdom!.seed;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    if (isWalkable(seed, me.x + dx!, me.z + dz!)) return { x: me.x + dx!, z: me.z + dz! };
  }
  throw new Error('no neighbour');
}

async function founded() {
  const h = await createHarness();
  await foundKingdom(h.ctx, h.eventId, h.users.organiserNadia, { name: 'Sunny Realm', motto: 'Together' });
  return h;
}

describe('Kingdoms: founding and citizenship', () => {
  it('shows an event with no kingdom, and lets only people who can post found one', async () => {
    const h = await createHarness();
    expect(await view(h, h.users.attendeeAda)).toMatchObject({ kingdom: null, you: { canFound: true } });
    // A platform admin can read the event but cannot post, so cannot found.
    expect(await code(foundKingdom(h.ctx, h.eventId, h.users.adminRami, { name: 'Nope', motto: '' }))).toBe('FORBIDDEN');
    expect(await code(foundKingdom(h.ctx, h.eventId, 'u-nobody', { name: 'Nope', motto: '' }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.attendeeAda, { action: 'join' }))).toBe('NOT_FOUND');
  });

  it('founds one kingdom per event: the founder is monarch and citizen with the first home, a second founder is refused', async () => {
    const h = await createHarness();
    await foundKingdom(h.ctx, h.eventId, h.users.attendeeAda, { name: 'Ada Land', motto: '' });
    expect(await code(foundKingdom(h.ctx, h.eventId, h.users.attendeeBen, { name: 'Ben Land', motto: '' }))).toBe('DUPLICATE');
    const v = await view(h, h.users.attendeeAda);
    expect(v.kingdom).toMatchObject({ name: 'Ada Land', citizenCount: 1 });
    expect(v.you).toMatchObject({ isMonarch: true, canGovern: true });
    expect(v.you.citizen).toMatchObject({ title: 'Monarch', home: { lot: 0 } });
    expect(v.chronicle.map((c) => c.kind)).toEqual(expect.arrayContaining(['FOUNDED', 'CITIZEN_JOINED']));
  });

  it('screens the name and motto', async () => {
    const h = await createHarness();
    expect(await code(foundKingdom(h.ctx, h.eventId, h.users.attendeeAda, { name: 'visit https://x.example', motto: '' }))).toBe('VALIDATION_FAILED');
    expect(await code(foundKingdom(h.ctx, h.eventId, h.users.attendeeAda, { name: '   ', motto: '' }))).toBe('VALIDATION_FAILED');
    expect(await code(foundKingdom(h.ctx, h.eventId, h.users.attendeeAda, { name: 'Fine', motto: 'follow @someone' }))).toBe('VALIDATION_FAILED');
    expect((await view(h, h.users.attendeeAda)).kingdom).toBeNull();
  });

  it('gives simultaneous joiners different homes, and joining twice changes nothing', async () => {
    const h = await founded();
    const people = [h.users.attendeeAda, h.users.attendeeBen, h.users.attendeeChloe, h.users.attendeeDev, h.users.attendeeEli];
    await Promise.all(people.map((u) => act(h, u, { action: 'join' })));
    await act(h, h.users.attendeeAda, { action: 'join' });
    const v = await view(h, h.users.attendeeAda);
    const lots = v.citizens.map((c) => c.home!.lot);
    expect(v.citizens).toHaveLength(6);
    expect(new Set(lots).size).toBe(6);
  });

  it('frees a home when a citizen leaves and gives it to the next person; the monarch cannot leave', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    const ada = (await view(h, h.users.attendeeAda)).you.citizen!;
    await act(h, h.users.attendeeAda, { action: 'leave' });
    expect((await view(h, h.users.attendeeAda)).you.citizen).toBeNull();
    await act(h, h.users.attendeeBen, { action: 'join' });
    expect((await view(h, h.users.attendeeBen)).you.citizen!.home!.lot).toBe(ada.home!.lot);
    expect(await code(act(h, h.users.organiserNadia, { action: 'leave' }))).toBe('INELIGIBLE');
    expect(await code(act(h, h.users.attendeeEli, { action: 'leave' }))).toBe('FORBIDDEN');
  });

  it('keeps the gates closable: nobody new joins while closed, existing citizens stay', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    expect(await code(act(h, h.users.attendeeAda, { action: 'gates', open: false }))).toBe('FORBIDDEN');
    await act(h, h.users.organiserNadia, { action: 'gates', open: false });
    expect(await code(act(h, h.users.attendeeBen, { action: 'join' }))).toBe('INELIGIBLE');
    expect((await view(h, h.users.attendeeBen)).you.canJoin).toBe(false);
    expect((await view(h, h.users.attendeeAda)).you.citizen).not.toBeNull();
    await act(h, h.users.organiserNadia, { action: 'gates', open: true });
    expect(await code(act(h, h.users.attendeeBen, { action: 'join' }))).toBe('OK');
  });

  it('sets a screened title, but not for the monarch', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    await act(h, h.users.attendeeAda, { action: 'title', title: 'Baker' });
    expect((await view(h, h.users.attendeeBen)).citizens.find((c) => c.userId === h.users.attendeeAda)?.title).toBe('Baker');
    expect(await code(act(h, h.users.attendeeAda, { action: 'title', title: 'see https://x.example' }))).toBe('VALIDATION_FAILED');
    expect(await code(act(h, h.users.organiserNadia, { action: 'title', title: 'King' }))).toBe('INELIGIBLE');
  });
});

describe('Kingdoms: your own home', () => {
  it('lets a citizen name their home and pick a roof, screened, and nobody else', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    await act(h, h.users.attendeeAda, { action: 'home', name: 'Ada Tower', roof: '#1d4ed8' });
    expect((await view(h, h.users.attendeeBen)).citizens.find((c) => c.userId === h.users.attendeeAda)!.home).toMatchObject({ name: 'Ada Tower', roof: '#1d4ed8' });
    expect(await code(act(h, h.users.attendeeAda, { action: 'home', name: 'see https://x.example', roof: '#1d4ed8' }))).toBe('VALIDATION_FAILED');
    expect(await code(act(h, h.users.attendeeBen, { action: 'home', name: 'Mine', roof: '#1d4ed8' }))).toBe('FORBIDDEN');
  });

  it('grows the home with followers: house at 5, manor at 20', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    // Use someone nobody follows in the demo data, so the counts below are exact.
    await act(h, h.users.attendeeHana, { action: 'join' });
    const hana = h.users.attendeeHana;
    const home = async () => (await view(h, hana)).you.citizen!.home;
    expect(await home()).toMatchObject({ tier: 'Cottage', storeys: 1, followers: 0 });
    for (let i = 0; i < 5; i += 1) await h.store.addFollow({ followerId: `u-fan-${i}`, followeeId: hana, createdAt: h.now() });
    expect(await home()).toMatchObject({ tier: 'House', storeys: 2, followers: 5 });
    for (let i = 5; i < 20; i += 1) await h.store.addFollow({ followerId: `u-fan-${i}`, followeeId: hana, createdAt: h.now() });
    expect(await home()).toMatchObject({ tier: 'Manor', storeys: 3, followers: 20 });
  });
});

describe('Kingdoms: walking the shared world', () => {
  it('moves a citizen and every viewer sees the new position', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    const to = await neighbour(h, h.users.attendeeAda);
    await act(h, h.users.attendeeAda, { action: 'move', ...to });
    const seen = (await view(h, h.users.attendeeBen)).citizens.find((c) => c.userId === h.users.attendeeAda)!;
    expect({ x: seen.x, z: seen.z }).toEqual(to);
  });

  it('refuses impossible walks and does not move the citizen', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    const gate = gatePosition();
    const seed = (await view(h, h.users.attendeeAda)).kingdom!.seed;
    const water = Array.from({ length: WORLD_SIZE }, (_, x) => ({ x, z: 0 })).find((p) => tileAt(seed, p.x, p.z).terrain === 'WATER')!;
    for (const to of [{ x: gate.x + MAX_STEP + 1, z: gate.z }, { x: -1, z: 0 }, { x: WORLD_SIZE, z: WORLD_SIZE }, water]) {
      expect(await code(act(h, h.users.attendeeAda, { action: 'move', ...to }))).toBe('VALIDATION_FAILED');
    }
    const me = (await view(h, h.users.attendeeAda)).you.citizen!;
    expect({ x: me.x, z: me.z }).toEqual(gate);
    expect(await code(act(h, h.users.attendeeBen, { action: 'move', x: gate.x, z: gate.z }))).toBe('FORBIDDEN');
  });

  it('paces walking, then allows it again after the interval', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    const first = await neighbour(h, h.users.attendeeAda);
    await act(h, h.users.attendeeAda, { action: 'move', ...first });
    const second = await neighbour(h, h.users.attendeeAda);
    expect(await code(act(h, h.users.attendeeAda, { action: 'move', ...second }))).toBe('RATE_LIMITED');
    h.setNow(h.now() + 1000);
    expect(await code(act(h, h.users.attendeeAda, { action: 'move', ...second }))).toBe('OK');
  });
});

describe('Kingdoms: the monarch and safety', () => {
  it('lets only the monarch or a moderator decree, and screens decrees', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    expect(await code(act(h, h.users.attendeeAda, { action: 'decree', text: 'All hail Ada' }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.organiserNadia, { action: 'decree', text: 'visit https://x.example' }))).toBe('VALIDATION_FAILED');
    await act(h, h.users.organiserNadia, { action: 'decree', text: 'Feasts on Friday' });
    expect((await view(h, h.users.attendeeAda)).chronicle[0]).toMatchObject({ kind: 'DECREE', text: 'Feasts on Friday' });
    // Another organiser holds content.moderate, so can govern a kingdom they did not found.
    expect((await view(h, h.users.organiserOwen)).you).toMatchObject({ isMonarch: false, canGovern: true });
    expect(await code(act(h, h.users.organiserOwen, { action: 'decree', text: 'Owen was here' }))).toBe('OK');
  });

  it('banishes: the person cannot walk, forge or rejoin, others stop seeing them, and a pardon restores them', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    await act(h, h.users.attendeeBen, { action: 'join' });
    expect(await code(act(h, h.users.attendeeBen, { action: 'banish', userId: h.users.attendeeAda, reason: '' }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.organiserNadia, { action: 'banish', userId: h.users.organiserNadia, reason: '' }))).toBe('INELIGIBLE');
    expect(await code(act(h, h.users.organiserNadia, { action: 'banish', userId: 'u-nobody', reason: '' }))).toBe('NOT_FOUND');
    await act(h, h.users.organiserNadia, { action: 'banish', userId: h.users.attendeeAda, reason: 'Spam' });

    const to = await neighbour(h, h.users.attendeeAda);
    expect(await code(act(h, h.users.attendeeAda, { action: 'move', ...to }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a tree' }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.attendeeAda, { action: 'leave' }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.attendeeAda, { action: 'join' }))).toBe('FORBIDDEN');
    expect((await view(h, h.users.attendeeBen)).citizens.some((c) => c.userId === h.users.attendeeAda)).toBe(false);
    expect((await view(h, h.users.organiserNadia)).citizens.find((c) => c.userId === h.users.attendeeAda)?.banned).toBe(true);

    await act(h, h.users.organiserNadia, { action: 'pardon', userId: h.users.attendeeAda });
    expect(await code(act(h, h.users.attendeeAda, { action: 'move', ...to }))).toBe('OK');
    const audited = (await h.store.listAudit(h.eventId)).map((a) => a.action);
    expect(audited).toEqual(expect.arrayContaining(['kingdom.found', 'kingdom.banish', 'kingdom.pardon']));
  });
});

describe('Kingdoms: the forge needs the monarch', () => {
  it("keeps a citizen's wish pending and invisible to others until approved, then puts it in the world", async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    await act(h, h.users.attendeeBen, { action: 'join' });
    const at = await neighbour(h, h.users.attendeeAda);
    const { forgeId } = await act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a red lantern', ...at });
    expect(forgeId).toBeTruthy();

    expect((await view(h, h.users.attendeeAda)).forges).toMatchObject([{ status: 'PENDING', kit: 'LANTERN', mine: true }]);
    expect((await view(h, h.users.attendeeBen)).forges).toEqual([]);
    expect((await view(h, h.users.organiserNadia)).forges).toHaveLength(1);
    expect(await code(act(h, h.users.attendeeBen, { action: 'decide', forgeId: forgeId!, approve: true, note: '' }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.attendeeAda, { action: 'decide', forgeId: forgeId!, approve: true, note: '' }))).toBe('FORBIDDEN');

    await act(h, h.users.organiserNadia, { action: 'decide', forgeId: forgeId!, approve: true, note: '' });
    expect((await view(h, h.users.attendeeBen)).forges).toMatchObject([{ status: 'APPROVED', kit: 'LANTERN', x: at.x, z: at.z }]);
    expect((await view(h, h.users.attendeeBen)).chronicle[0]).toMatchObject({ kind: 'FORGED' });
    // A decision is made once.
    expect(await code(act(h, h.users.organiserNadia, { action: 'decide', forgeId: forgeId!, approve: false, note: '' }))).toBe('ALREADY_HANDLED');
  });

  it("never publishes a refused wish, and approves the monarch's own at once", async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    const { forgeId } = await act(h, h.users.attendeeAda, { action: 'forge', prompt: 'ein Baum' });
    await act(h, h.users.organiserNadia, { action: 'decide', forgeId: forgeId!, approve: false, note: 'Too crowded' });
    expect((await view(h, h.users.attendeeBen)).forges).toEqual([]);
    expect((await view(h, h.users.attendeeAda)).forges[0]).toMatchObject({ status: 'REJECTED', decisionNote: 'Too crowded' });
    await act(h, h.users.organiserNadia, { action: 'forge', prompt: 'a gold statue' });
    expect((await view(h, h.users.attendeeBen)).forges).toMatchObject([{ status: 'APPROVED', kit: 'STATUE', colour: '#ca8a04' }]);
  });

  it('refuses wishes the forge cannot make, unsafe text, wet ground, and more than three waiting', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    expect(await code(act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a dragon' }))).toBe('VALIDATION_FAILED');
    expect(await code(act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a tree www.evil.example' }))).toBe('VALIDATION_FAILED');
    expect(await code(act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a tree', x: 0, z: 0 }))).toBe('VALIDATION_FAILED');
    for (let i = 0; i < 3; i += 1) expect(await code(act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a bench' }))).toBe('OK');
    expect(await code(act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a bench' }))).toBe('RATE_LIMITED');
    expect(await code(act(h, h.users.attendeeBen, { action: 'forge', prompt: 'a bench' }))).toBe('FORBIDDEN');
  });
});

describe('Kingdoms: events from outside', () => {
  it('turns a raid into a caravan and records it once per outside event id', async () => {
    const h = await founded();
    const first = await act(h, h.users.organiserNadia, { action: 'ingest', kind: 'RAID', who: 'Mira', amount: 5000, externalId: 'evt_1' });
    expect(first.duplicate).toBeUndefined();
    const again = await act(h, h.users.organiserNadia, { action: 'ingest', kind: 'RAID', who: 'Mira', amount: 5000, externalId: 'evt_1' });
    expect(again.duplicate).toBe(true);
    const caravans = (await view(h, h.users.attendeeAda)).chronicle.filter((c) => c.kind === 'CARAVAN');
    expect(caravans).toHaveLength(1);
    expect(caravans[0]!.text).toContain('50 (of 5000)');
    // Without an id each call is its own event.
    await act(h, h.users.organiserNadia, { action: 'ingest', kind: 'CHEER', who: 'Sol', amount: 3 });
    await act(h, h.users.organiserNadia, { action: 'ingest', kind: 'CHEER', who: 'Sol', amount: 3 });
    expect((await view(h, h.users.attendeeAda)).chronicle.filter((c) => c.kind === 'CHEER')).toHaveLength(2);
  });

  it('is for the monarch alone, and validates the source name and id', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    expect(await code(act(h, h.users.attendeeAda, { action: 'ingest', kind: 'RAID', who: 'Mira', amount: 5 }))).toBe('FORBIDDEN');
    expect(await code(act(h, h.users.organiserNadia, { action: 'ingest', kind: 'RAID', who: 'https://x.example', amount: 5 }))).toBe('VALIDATION_FAILED');
    expect(await code(act(h, h.users.organiserNadia, { action: 'ingest', kind: 'RAID', who: 'Mira', amount: 5, externalId: 'bad id!' }))).toBe('VALIDATION_FAILED');
  });
});

describe('Kingdoms: erasure and export', () => {
  it("exports a person's own kingdom data", async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    await act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a fountain' });
    const data = await exportMyData(h.ctx, h.users.attendeeAda);
    const mine = data.events.find((e: { eventId: string }) => e.eventId === h.eventId) as unknown as { kingdom: { citizen: { lot: number }; forges: Array<{ wish: string }> } };
    expect(mine.kingdom.citizen.lot).toBeGreaterThanOrEqual(0);
    expect(mine.kingdom.forges.map((f) => f.wish)).toEqual(['a fountain']);
  });

  it('erases a citizen: home freed, wishes removed, chronicle entries kept but unlinked', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    await act(h, h.users.attendeeAda, { action: 'forge', prompt: 'a fountain' });
    await eraseMe(h.ctx, h.users.attendeeAda);
    const v = await view(h, h.users.organiserNadia);
    expect(v.citizens.map((c) => c.userId)).toEqual([h.users.organiserNadia]);
    expect(v.forges).toEqual([]);
    expect(await h.store.docList('kingdomChronicle', { actorId: h.users.attendeeAda })).toEqual([]);
    await act(h, h.users.attendeeBen, { action: 'join' });
    expect((await view(h, h.users.attendeeBen)).you.citizen!.home!.lot).toBe(1);
  });

  it('erases a kingdom with everything in it when its monarch is erased', async () => {
    const h = await founded();
    await act(h, h.users.attendeeAda, { action: 'join' });
    const removed = await eraseKingdoms(h.ctx, h.users.organiserNadia, [h.eventId]);
    expect(removed).toBeGreaterThan(2);
    expect((await view(h, h.users.attendeeAda)).kingdom).toBeNull();
    expect(await h.store.docList('kingdomCitizens', { eventId: h.eventId })).toEqual([]);
    expect(await h.store.docList('kingdomChronicle', { eventId: h.eventId })).toEqual([]);
  });
});
