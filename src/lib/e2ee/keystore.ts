import { createIdentity, type Identity } from './crypto';

/**
 * Keeps each person's device identity in this browser's IndexedDB. The private key is stored as a
 * non-extractable CryptoKey: the browser can use it, but nothing can read its bytes out.
 * One identity per account, so demo accounts that share a browser stay separate.
 */

const DB = 'hello-e2ee';
const STORE = 'identities';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB unavailable'));
    };
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => {
          resolve(req.result as T);
        };
        req.onerror = () => {
          reject(req.error ?? new Error('IndexedDB request failed'));
        };
      }),
  );
}

const pending = new Map<string, Promise<Identity>>();

/** Returns this device's identity for `userId`, creating and publishing one the first time. */
export function deviceIdentity(userId: string): Promise<Identity> {
  const existing = pending.get(userId);
  if (existing) return existing;
  const p = (async () => {
    let identity = await run<Identity | undefined>('readonly', (s) => s.get(userId)).catch(() => undefined);
    if (!identity) {
      identity = await createIdentity();
      await run('readwrite', (s) => s.put(identity, userId));
    }
    // Publishing is idempotent, so it is safe on every load and repairs a server that lost the key.
    const response = await fetch('/api/me/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: identity.publicKey }),
    });
    if (!response.ok) throw new Error('Could not publish this device key.');
    return identity;
  })();
  pending.set(userId, p);
  p.catch(() => pending.delete(userId));
  return p;
}

export async function forgetDeviceIdentity(userId: string): Promise<void> {
  pending.delete(userId);
  await run('readwrite', (s) => s.delete(userId)).catch(() => undefined);
}

/**
 * Web Crypto's `subtle` exists only in secure contexts (HTTPS or localhost), and keys need IndexedDB.
 * On plain HTTP, private messages are switched off rather than weakened.
 */
export function e2eeSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof indexedDB !== 'undefined';
}
