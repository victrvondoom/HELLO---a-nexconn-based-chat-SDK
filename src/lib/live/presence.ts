/**
 * Who has HELLO open right now, per event. Pure bookkeeping: no clock of its own, no storage.
 *
 * A person is online in an event while at least one of their live streams to it is open on any instance.
 * Local streams are counted exactly. Other instances (with Postgres fan-out) send a snapshot of their own
 * online people every few seconds; a snapshot older than REMOTE_TTL_MS is ignored, so an instance that
 * stops reporting (crashed, scaled down) stops showing people as online.
 *
 * Who may see whom is not decided here. The presence API shows a person only to their mutual connections,
 * and shows everyone else as a count that is hidden below the privacy minimum.
 */
export const REMOTE_TTL_MS = 45_000;

export class PresenceRegistry {
  private readonly local = new Map<string, Map<string, number>>();
  /** Keyed by `${instanceId}|${eventId}`. A report can arrive in several chunks with the same `at`. */
  private readonly remote = new Map<string, { instanceId: string; eventId: string; at: number; users: Set<string> }>();

  /** Registers one open stream. Returns `changed` when the person just came online, and a leave function. */
  join(eventId: string, userId: string): { changed: boolean; leave: () => boolean } {
    const people = this.local.get(eventId) ?? new Map<string, number>();
    this.local.set(eventId, people);
    const before = people.get(userId) ?? 0;
    people.set(userId, before + 1);
    let left = false;
    return {
      changed: before === 0,
      // Returns true when this was the person's last stream on this instance.
      leave: () => {
        if (left) return false;
        left = true;
        const count = (people.get(userId) ?? 1) - 1;
        if (count <= 0) {
          people.delete(userId);
          if (people.size === 0) this.local.delete(eventId);
          return true;
        }
        people.set(userId, count);
        return false;
      },
    };
  }

  /** This instance's online people, per event: what it reports to other instances. */
  localSnapshot(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [eventId, people] of this.local) out.set(eventId, [...people.keys()]);
    return out;
  }

  /**
   * A report from another instance: its online people in one event at time `at`. A newer report replaces an
   * older one; chunks of the same report (same `at`) are merged. Returns true when the set changed.
   */
  applyRemote(instanceId: string, eventId: string, at: number, users: string[]): boolean {
    const key = `${instanceId}|${eventId}`;
    const entry = this.remote.get(key);
    if (entry && at < entry.at) return false;
    if (!entry || at > entry.at) {
      const before = entry ? [...entry.users].sort().join(',') : '';
      this.remote.set(key, { instanceId, eventId, at, users: new Set(users) });
      return before !== [...users].sort().join(',');
    }
    const size = entry.users.size;
    for (const u of users) entry.users.add(u);
    return entry.users.size !== size;
  }

  /** Everyone online in an event, across instances. */
  online(eventId: string, now: number): Set<string> {
    const out = new Set(this.local.get(eventId)?.keys() ?? []);
    for (const [key, report] of this.remote) {
      if (now - report.at > REMOTE_TTL_MS) {
        this.remote.delete(key);
        continue;
      }
      if (report.eventId === eventId) for (const userId of report.users) out.add(userId);
    }
    return out;
  }
}

type GlobalWithPresence = typeof globalThis & { __helloPresence?: PresenceRegistry };

export function presenceRegistry(): PresenceRegistry {
  const g = globalThis as GlobalWithPresence;
  g.__helloPresence ??= new PresenceRegistry();
  return g.__helloPresence;
}
