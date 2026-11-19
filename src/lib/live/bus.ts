/**
 * The live event bus: how a change made by one request reaches the open pages of everyone it concerns.
 *
 * What travels on it is a nudge, never content: "something in `topic` changed for this event". A page that
 * receives a nudge re-reads its data through the normal API, so every read is authorised exactly as before,
 * and the stream cannot leak a field the API would not return. The one exception is `typing`, which carries
 * who is typing, and only to the one person they are typing to.
 *
 * Audience rules (`visibleTo`):
 * - `EVENT`: every member of the event (or of every event, when `eventId` is null, for global records).
 * - `PEOPLE`: only the listed people, plus operations staff when `staff` is true. Personal records (your
 *   notifications, payments, private messages, mission attempts) and staff records (incidents, approvals,
 *   audit) use this, so an attendee is never told that someone else's private record changed.
 *
 * In one process the bus is local. With Postgres, events are also fanned out to other app instances
 * through LISTEN/NOTIFY (src/lib/live/fanout.ts), so a change made on one instance reaches pages on another.
 */

export type LiveAudience = { kind: 'EVENT' } | { kind: 'PEOPLE'; userIds: string[]; staff: boolean };

export interface LiveEvent {
  /** The event the change belongs to. Null for global records (follows, profiles, private messages). */
  eventId: string | null;
  /** Store-level topic: a collection name, or incidents, notifications, dm, payments, presence, typing… */
  topic: string;
  audience: LiveAudience;
  at: number;
  /** Ephemeral signals only (typing). Never stored content. */
  data?: Record<string, string>;
  /** The instance that published it, so an instance ignores its own events coming back from Postgres. */
  origin?: string;
}

export interface LiveViewer {
  eventId: string;
  userId: string;
  /** Operations staff and organisers: they receive staff-audience events. */
  staff: boolean;
}

export function visibleTo(event: LiveEvent, viewer: LiveViewer): boolean {
  if (event.eventId !== null && event.eventId !== viewer.eventId) return false;
  if (event.audience.kind === 'EVENT') return true;
  return event.audience.userIds.includes(viewer.userId) || (event.audience.staff && viewer.staff);
}

/** Recipients helper: drops nulls and duplicates. */
export function people(userIds: ReadonlyArray<string | null | undefined>, staff: boolean): LiveAudience {
  return { kind: 'PEOPLE', userIds: [...new Set(userIds.filter((u): u is string => typeof u === 'string' && u.length > 0))], staff };
}

export const EVERYONE: LiveAudience = { kind: 'EVENT' };

type Listener = (event: LiveEvent) => void;

export interface RemoteLink {
  send(event: LiveEvent): void;
}

export class LiveBus {
  private readonly listeners = new Set<Listener>();
  private remote: RemoteLink | null = null;
  readonly instanceId = `i_${Math.random().toString(36).slice(2, 10)}`;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  /** Publishes to this instance's subscribers, and to other instances when a remote link is attached. */
  publish(event: LiveEvent): void {
    const stamped: LiveEvent = { ...event, origin: event.origin ?? this.instanceId };
    this.dispatch(stamped);
    if (stamped.origin === this.instanceId) this.remote?.send(stamped);
  }

  /** An event from another instance. Our own events coming back are ignored: they were already delivered. */
  receiveRemote(event: LiveEvent): void {
    if (event.origin === this.instanceId) return;
    this.dispatch(event);
  }

  attachRemote(link: RemoteLink | null): void {
    this.remote = link;
  }

  private dispatch(event: LiveEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One broken subscriber (a closed stream) must not stop delivery to the others.
      }
    }
  }
}

type GlobalWithBus = typeof globalThis & { __helloLiveBus?: LiveBus };

/** The process-wide bus, shared by every route bundle. */
export function liveBus(): LiveBus {
  const g = globalThis as GlobalWithBus;
  g.__helloLiveBus ??= new LiveBus();
  return g.__helloLiveBus;
}
