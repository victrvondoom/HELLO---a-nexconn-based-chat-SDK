/**
 * Notification idempotency.
 *
 * A notification's dedupe key names the recipient, the kind, the object and the
 * object's state. Writing the same key twice produces one notification. A new
 * state (for example, the incident moving to IN_PROGRESS) produces a new key, so
 * genuine progress is still announced.
 */

export function buildDedupeKey(parts: ReadonlyArray<string | number>): string {
  return parts.map((p) => String(p)).join('|');
}

export interface DedupeStore {
  has(key: string): boolean;
  add(key: string): void;
}

export class InMemoryDedupeStore implements DedupeStore {
  private readonly keys = new Set<string>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    this.keys.add(key);
  }

  get size(): number {
    return this.keys.size;
  }
}

/** Returns true only the first time `key` is seen. Callers must persist the key with the notification. */
export function claimNotificationKey(store: DedupeStore, key: string): boolean {
  if (store.has(key)) {
    return false;
  }
  store.add(key);
  return true;
}
