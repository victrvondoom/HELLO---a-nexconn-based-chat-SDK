import { describe, expect, it } from 'vitest';
import { agentsFromAnalysis, agentTimeline, AgentRecordSchema } from '@/domain/ops/agents';
import { applyAction, replay, type LedgerEntry } from '@/domain/ops/actions';
import { automationAllowed, startOwnership, transition, type Ownership } from '@/domain/ops/handoff';
import { catchUp, gaps, insertEvent, scheduleRelease, serverNow, visibleAt, type TimelineEvent } from '@/domain/ops/temporal';
import { percentile } from '@/domain/ops/bench';
import { resolve } from '@/domain/resilience/repair';
import { benchmarkWorldV1, maskOf } from '@/domain/resilience/world';

const ev = (seq: number, intendedAt: number, releaseAt = 0): TimelineEvent => ({ id: `e${seq}`, seq, serverAt: 0, intendedAt, releaseAt, kind: 'MESSAGE', text: '' });

describe('agent records', () => {
  const { world, baseline } = benchmarkWorldV1();
  const records = agentsFromAnalysis(resolve(world, baseline, maskOf(['av_failure'])), 'incident:inc-1');
  it('derives five valid, evidence-citing records from a real Steadfast analysis; none executes', () => {
    expect(records.map((r) => r.role)).toEqual(['INVESTIGATOR', 'SCHEDULER', 'PLANNER', 'CRITIC', 'VERIFIER']);
    for (const r of records) {
      expect(AgentRecordSchema.safeParse(r).success, r.id).toBe(true);
      expect(r.execution).not.toBe('EXECUTED_BY_HUMAN');
    }
    expect(records.find((r) => r.role === 'VERIFIER')?.evidence[0]).toMatch(/^certificate:cert-/);
    expect(agentTimeline(records).at(-1)?.role).toBe('VERIFIER');
  });
  it('rejects records without evidence, self-execution, and a model marking itself verified', () => {
    const r = records[0] as (typeof records)[number];
    expect(AgentRecordSchema.safeParse({ ...r, evidence: [] }).success).toBe(false);
    expect(AgentRecordSchema.safeParse({ ...r, evidence: ['see above'] }).success).toBe(false);
    expect(AgentRecordSchema.safeParse({ ...r, execution: 'EXECUTED_BY_HUMAN', approvedByUserId: null }).success).toBe(false);
    expect(AgentRecordSchema.safeParse({ ...r, source: 'MODEL', state: 'VERIFIED' }).success).toBe(false);
  });
});

describe('temporal engine', () => {
  it('orders by intended time then sequence, whatever the arrival order, and ignores duplicates', () => {
    let tl: TimelineEvent[] = [];
    for (const e of [ev(3, 10), ev(1, 30), ev(2, 10), ev(3, 10)]) tl = insertEvent(tl, e).timeline;
    expect(tl.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
    expect(insertEvent(tl, ev(1, 30)).duplicate).toBe(true);
  });
  it('releases exactly at release time, catches up after a cursor, and finds gaps', () => {
    const tl = [ev(1, 0, 100), ev(2, 0, 200), ev(3, 0, 300)];
    expect(visibleAt(tl, 199).map((e) => e.id)).toEqual(['e1']);
    expect(visibleAt(tl, 200).map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(catchUp(tl, 1, 1000)).toMatchObject({ cursor: 3 });
    expect(gaps([1, 2, 5, 7], 0)).toEqual([3, 4, 6]);
    expect(scheduleRelease(500, 100, 50)).toBe(500);
    expect(serverNow(1000, -250)).toBe(750);
  });
});

describe('action model', () => {
  it('applies with the expected version, refuses stale ones, and replays to the same head', () => {
    let head = { seq: 0, versions: {} as Record<string, number> };
    const entries: LedgerEntry[] = [];
    for (const [key, v] of [['key-0001', 0], ['key-0002', 0], ['key-0003', 1]] as const) {
      const r = applyAction(head, { idempotencyKey: key, kind: 'K', targetId: 'room:1', expectedVersion: v, actorId: 'a', payload: {} }, 0);
      head = r.head;
      entries.push(r.entry);
    }
    expect(entries.map((e) => e.outcome)).toEqual(['APPLIED', 'STALE', 'APPLIED']);
    expect(replay(entries)).toEqual(head);
    expect(() => replay(entries.filter((e) => e.seq !== 2))).toThrow(/gap/);
  });
});

describe('handoff', () => {
  const staff = { userId: 's1', staff: true };
  const other = { userId: 's2', staff: true };
  const attendee = { userId: 'a1', staff: false };
  const ok = (o: Ownership | { refused: string }) => {
    if ('refused' in o) throw new Error(o.refused);
    return o;
  };
  it('runs AI triage → staff → takeover → resolve → hand-back on one conversation, pausing automation', () => {
    let o = startOwnership('inc-9');
    expect(automationAllowed(o)).toBe(true);
    o = ok(transition(o, 'REQUEST_STAFF', attendee, 1));
    expect('refused' in transition(o, 'ASSIGN', attendee, 2, 's1')).toBe(true);
    o = ok(transition(o, 'ASSIGN', other, 2, 's1'));
    expect('refused' in transition(o, 'TAKE_OVER', other, 3)).toBe(true);
    o = ok(transition(o, 'TAKE_OVER', staff, 3));
    expect(automationAllowed(o)).toBe(false);
    expect('refused' in transition(o, 'HAND_BACK', other, 4)).toBe(true);
    o = ok(transition(o, 'RESOLVE', staff, 4));
    expect(automationAllowed(o)).toBe(false);
    o = ok(transition(o, 'HAND_BACK', staff, 5));
    expect(automationAllowed(o)).toBe(true);
    expect(o.conversationId).toBe('inc-9');
    expect(o.transitions.map((t) => t.action)).toEqual(['REQUEST_STAFF', 'ASSIGN', 'TAKE_OVER', 'RESOLVE', 'HAND_BACK']);
  });
});

describe('percentiles', () => {
  it('uses nearest rank', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect([percentile(xs, 50), percentile(xs, 95), percentile(xs, 99)]).toEqual([50, 95, 99]);
    expect(percentile([], 50)).toBe(0);
  });
});
