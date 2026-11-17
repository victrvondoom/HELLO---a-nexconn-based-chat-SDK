import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryHelloStore } from '@/store/memory';
import { logError } from './logger';

/**
 * Durable storage for a single-node deployment. When HELLO_DATA_DIR is set, the whole store is
 * written to `state.json` shortly after every change, and media bytes to `blobs/`. On start the
 * files are read back, so accounts, posts, communities and games survive a restart.
 *
 * It is one process writing one directory: correct for one instance with a persistent disk, not for
 * several instances. Files are owner-readable only. Without HELLO_DATA_DIR nothing touches the disk.
 */
export interface Persistence {
  /** Restores the store. Returns the clock value saved with it, or null when there was nothing to restore. */
  restore(store: MemoryHelloStore): number | null;
  /** Wraps the store so every write is followed by a save. */
  attach(store: MemoryHelloStore, now: () => number): MemoryHelloStore;
  wipe(): void;
}

const BLOB_ID = /^[a-z0-9_-]{1,80}$/;
const READS = /^(get|list|find|count|docGet|docList|blobGet|snapshot|blobIds)/;

export function persistenceFromEnv(env: Record<string, string | undefined>): Persistence | null {
  const dir = (env.HELLO_DATA_DIR ?? '').trim();
  if (!dir) return null;
  const stateFile = join(dir, 'state.json');
  const blobDir = join(dir, 'blobs');
  mkdirSync(blobDir, { recursive: true, mode: 0o700 });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = (store: MemoryHelloStore, now: () => number) => {
    timer = null;
    try {
      const tmp = `${stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, now: now(), state: store.snapshot() }), { mode: 0o600 });
      renameSync(tmp, stateFile);
    } catch (error: unknown) {
      logError('persistence_save_failed', { detail: error instanceof Error ? error.message : 'unknown' });
    }
  };

  return {
    restore(store) {
      if (!existsSync(stateFile)) return null;
      const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as { v: number; now: number; state: string };
      store.hydrate(saved.state);
      for (const name of readdirSync(blobDir)) {
        if (BLOB_ID.test(name)) void store.blobPut(name, new Uint8Array(readFileSync(join(blobDir, name))));
      }
      return saved.now;
    },
    attach(store, now) {
      return new Proxy(store, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          const name = String(prop);
          const method = value as (...args: unknown[]) => unknown;
          if (READS.test(name)) return method.bind(target);
          return async (...args: unknown[]) => {
            const result = await method.apply(target, args);
            const id = typeof args[0] === 'string' && BLOB_ID.test(args[0]) ? args[0] : null;
            if (name === 'blobPut' && id) writeFileSync(join(blobDir, id), args[1] as Uint8Array, { mode: 0o600 });
            else if (name === 'blobDelete' && id) rmSync(join(blobDir, id), { force: true });
            else
              timer ??= setTimeout(() => {
                save(target, now);
              }, 400);
            return result;
          };
        },
      });
    },
    wipe() {
      if (timer) clearTimeout(timer);
      timer = null;
      rmSync(stateFile, { force: true });
      rmSync(blobDir, { recursive: true, force: true });
      mkdirSync(blobDir, { recursive: true, mode: 0o700 });
    },
  };
}
