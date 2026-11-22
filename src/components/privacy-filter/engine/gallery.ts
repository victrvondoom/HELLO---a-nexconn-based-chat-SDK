/**
 * People kept visible, stored only on this device (IndexedDB), per HELLO account.
 *
 * Upstream Offleak keeps reference photos in a user-only folder on the streamer's machine and never uploads them.
 * HELLO keeps the same promise: a face picture and its SFace embedding are biometric data, so they never reach the
 * HELLO server, are not in any API, and are removed with "Remove everyone" or by clearing the browser's site data.
 */

export interface KeptPerson {
  id: string;
  userId: string;
  /** SFace embedding (128 numbers). */
  feature: number[];
  /** Small JPEG of the face (data URL), shown on the person's card. */
  thumb: string;
  /** A group photo that could not be split safely: kept as one reference, shown for review. */
  needsReview: boolean;
  createdAt: number;
}

export const MAX_PEOPLE = 30;
const DB = 'hello-privacy-filter';
const STORE = 'people';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('userId', 'userId');
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('This browser does not allow storing people on the device.'));
    };
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      let value: T | undefined;
      if (req) {
        req.onsuccess = () => {
          value = req.result;
        };
      }
      tx.oncomplete = () => {
        resolve(value);
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('Could not update the people kept visible.'));
      };
    });
  } finally {
    db.close();
  }
}

export async function listPeople(userId: string): Promise<KeptPerson[]> {
  const all = (await run<KeptPerson[]>('readonly', (s) => s.index('userId').getAll(userId) as IDBRequest<KeptPerson[]>)) ?? [];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addPeople(userId: string, people: Array<Omit<KeptPerson, 'id' | 'userId' | 'createdAt'>>): Promise<KeptPerson[]> {
  const existing = await listPeople(userId);
  if (existing.length + people.length > MAX_PEOPLE) throw new Error(`You can keep at most ${MAX_PEOPLE} people visible.`);
  const now = Date.now();
  const added = people.map((p, i) => ({ ...p, id: crypto.randomUUID(), userId, createdAt: now + i }));
  for (const person of added) await run('readwrite', (s) => s.put(person));
  return added;
}

export async function removePerson(userId: string, id: string): Promise<void> {
  const person = await run<KeptPerson | undefined>('readonly', (s) => s.get(id) as IDBRequest<KeptPerson | undefined>);
  if (person?.userId !== userId) return;
  await run('readwrite', (s) => s.delete(id));
}

export async function removeEveryone(userId: string): Promise<number> {
  const people = await listPeople(userId);
  for (const p of people) await run('readwrite', (s) => s.delete(p.id));
  return people.length;
}

export const featuresOf = (people: KeptPerson[]): number[][] => people.map((p) => p.feature);
