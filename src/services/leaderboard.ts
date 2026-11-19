import { requireCapability, audit, type ServiceContext } from './context';
import { levelFor } from '../domain/field/rules';
import { loadLevels } from './field-atlas';

/**
 * The Field Atlas leaderboard. Opt-in only: a person appears by name only after they switch it on, and can
 * switch it off at any time, which removes them at once. People who have not opted in are never listed and
 * never counted against anyone's rank. XP is read from the ledger, the only place XP lives.
 */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  xp: number;
  level: string;
  isSelf: boolean;
}

export interface LeaderboardView {
  optedIn: boolean;
  entries: LeaderboardEntry[];
  /** The viewer's own row when they opted in but are outside the top entries. */
  self: LeaderboardEntry | null;
  participants: number;
}

const TOP = 20;

export async function setLeaderboardOptIn(ctx: ServiceContext, eventId: string, userId: string, optIn: boolean): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const existing = await ctx.store.docGet('prefs', userId);
  await ctx.store.docPut('prefs', { ...(existing ?? { id: userId, country: null }), id: userId, leaderboard: optIn });
  await audit(ctx, eventId, userId, optIn ? 'atlas.leaderboard.join' : 'atlas.leaderboard.leave', 'user', userId, optIn ? 'Joined the Field Atlas leaderboard.' : 'Left the Field Atlas leaderboard.');
}

export async function leaderboard(ctx: ServiceContext, eventId: string, userId: string): Promise<LeaderboardView> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const [memberships, ledger, badges, levels] = await Promise.all([
    ctx.store.listMemberships(eventId),
    ctx.store.docList('fieldLedger', { eventId }),
    ctx.store.docList('fieldBadges', { eventId }),
    loadLevels(ctx, eventId),
  ]);
  const opted: string[] = [];
  for (const m of memberships) if ((await ctx.store.docGet('prefs', m.userId))?.leaderboard === true) opted.push(m.userId);
  const xp = new Map<string, number>();
  for (const e of ledger) xp.set(e.userId, (xp.get(e.userId) ?? 0) + e.amount);
  const held = new Map<string, Set<string>>();
  for (const b of badges) held.set(b.userId, (held.get(b.userId) ?? new Set()).add(b.badgeId));

  const rows = await Promise.all(
    opted.map(async (id) => ({ userId: id, name: (await ctx.store.getUser(id))?.displayName ?? 'Someone', xp: xp.get(id) ?? 0 })),
  );
  rows.sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));
  // Equal XP shares a rank (1, 2, 2, 4).
  const ranked: LeaderboardEntry[] = rows.map((r, i) => {
    const firstEqual = rows.findIndex((x) => x.xp === r.xp);
    return { ...r, rank: (firstEqual === -1 ? i : firstEqual) + 1, level: levelFor(levels, r.xp, held.get(r.userId) ?? new Set()).name, isSelf: r.userId === userId };
  });
  const entries = ranked.slice(0, TOP);
  const mine = ranked.find((r) => r.isSelf) ?? null;
  return { optedIn: opted.includes(userId), entries, self: mine && !entries.includes(mine) ? mine : null, participants: ranked.length };
}
