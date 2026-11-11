/**
 * End-to-end encryption for private messages, on the Web Crypto API (browser and Node 20+).
 *
 *   identity      ECDH P-256 key pair, generated on the person's device. The private key is created
 *                 non-extractable: no script, including HELLO's own, can export it.
 *   shared key    ECDH(my private, their public) → HKDF-SHA-256, bound to both people and both key ids
 *                 → AES-256-GCM. Both sides derive the same key; the server never can, because it
 *                 never holds a private key.
 *   message       AES-GCM with a fresh 96-bit IV per message, and sender→recipient as additional
 *                 authenticated data, so a message cannot be replayed as if sent the other way.
 *   safety number SHA-256 over both public-key fingerprints, shown as 60 digits. Two people compare
 *                 them in person to rule out a server that swapped keys.
 *
 * Limits, stated plainly: there is no forward secrecy (no ratchet), and a new device means a new key,
 * so it cannot read messages sealed to the old one.
 */

export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface Identity {
  keyPair: CryptoKeyPair;
  publicKey: PublicJwk;
  keyId: string;
  fingerprint: string;
}

export interface Sealed {
  iv: string;
  ciphertext: string;
}

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto as Crypto | undefined;
  if (!c?.subtle) throw new Error('Web Crypto is not available in this environment.');
  return c.subtle;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ECDH: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' };

export async function fingerprintOf(jwk: PublicJwk): Promise<string> {
  const digest = await subtle().digest('SHA-256', enc.encode(`${jwk.crv}.${jwk.x}.${jwk.y}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const keyIdOf = (fingerprint: string) => `key_${fingerprint.slice(0, 20)}`;

/** Creates a new device identity. The private key cannot be exported. */
export async function createIdentity(): Promise<Identity> {
  const keyPair = (await subtle().generateKey(ECDH, false, ['deriveBits']));
  const raw = (await subtle().exportKey('jwk', keyPair.publicKey));
  if (!raw.x || !raw.y) throw new Error('Could not export the public key.');
  const publicKey: PublicJwk = { kty: 'EC', crv: 'P-256', x: raw.x, y: raw.y };
  const fingerprint = await fingerprintOf(publicKey);
  return { keyPair, publicKey, fingerprint, keyId: keyIdOf(fingerprint) };
}

export interface Party {
  userId: string;
  keyId: string;
}

/** Derives the AES key for one pair of people and one pair of keys. Order of the two parties does not matter. */
export async function deriveConversationKey(myPrivate: CryptoKey, theirPublic: PublicJwk, a: Party, b: Party): Promise<CryptoKey> {
  const peer = await subtle().importKey('jwk', { ...theirPublic, ext: true }, ECDH, false, []);
  const secret = await subtle().deriveBits({ name: 'ECDH', public: peer }, myPrivate, 256);
  const hkdf = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const [first, second] = [a, b].sort((x, y) => (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0));
  const info = enc.encode(`hello-e2ee-v1|${first?.userId}:${first?.keyId}|${second?.userId}:${second?.keyId}`);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('HELLO direct messages'), info },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const aadFor = (senderId: string, recipientId: string) => enc.encode(`${senderId}>${recipientId}`);

export async function seal(key: CryptoKey, plaintext: string, senderId: string, recipientId: string): Promise<Sealed> {
  const iv = new Uint8Array(new ArrayBuffer(12));
  globalThis.crypto.getRandomValues(iv);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(senderId, recipientId) }, key, enc.encode(plaintext));
  return { iv: toB64url(iv), ciphertext: toB64url(ct) };
}

/** Throws if the message was altered, or sealed with a different key or for a different direction. */
export async function open(key: CryptoKey, sealed: Sealed, senderId: string, recipientId: string): Promise<string> {
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromB64url(sealed.iv), additionalData: aadFor(senderId, recipientId) },
    key,
    fromB64url(sealed.ciphertext),
  );
  return dec.decode(pt);
}

/** 60 digits in 12 groups of 5, identical on both devices when neither key was swapped. */
export async function safetyNumber(fingerprintA: string, fingerprintB: string): Promise<string> {
  const [x, y] = [fingerprintA, fingerprintB].sort();
  const digest = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`${x}|${y}`)));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const chunk = ((digest[i * 2] ?? 0) << 16) | ((digest[i * 2 + 1] ?? 0) << 8) | (digest[(i * 2 + 24) % 32] ?? 0);
    groups.push(String(chunk % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}
