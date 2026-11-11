import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createIdentity, deriveConversationKey, fromB64url, open, safetyNumber, seal, toB64url } from '@/lib/e2ee/crypto';
import { createVault, vaultFromEnv } from '@/lib/vault';

describe('end-to-end encryption', () => {
  it('lets both people derive the same key and read each other, and nobody else', async () => {
    const ada = await createIdentity();
    const ines = await createIdentity();
    const eve = await createIdentity();
    const A = { userId: 'u-ada', keyId: ada.keyId };
    const I = { userId: 'u-ines', keyId: ines.keyId };
    const kAda = await deriveConversationKey(ada.keyPair.privateKey, ines.publicKey, A, I);
    const kInes = await deriveConversationKey(ines.keyPair.privateKey, ada.publicKey, I, A);
    const sealed = await seal(kAda, 'Meet at the coffee counter at 12:40?', 'u-ada', 'u-ines');
    expect(sealed.ciphertext).not.toContain('coffee');
    expect(await open(kInes, sealed, 'u-ada', 'u-ines')).toBe('Meet at the coffee counter at 12:40?');
    // The sender can re-read their own message from the same shared secret.
    expect(await open(kAda, sealed, 'u-ada', 'u-ines')).toBe('Meet at the coffee counter at 12:40?');
    // A third key pair cannot.
    const kEve = await deriveConversationKey(eve.keyPair.privateKey, ada.publicKey, { userId: 'u-eve', keyId: eve.keyId }, A);
    await expect(open(kEve, sealed, 'u-ada', 'u-ines')).rejects.toThrow();
  });

  it('rejects tampering and messages replayed in the other direction', async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const k = await deriveConversationKey(a.keyPair.privateKey, b.publicKey, { userId: 'a', keyId: a.keyId }, { userId: 'b', keyId: b.keyId });
    const sealed = await seal(k, 'hello', 'a', 'b');
    const bytes = fromB64url(sealed.ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    await expect(open(k, { ...sealed, ciphertext: toB64url(bytes) }, 'a', 'b')).rejects.toThrow();
    await expect(open(k, sealed, 'b', 'a')).rejects.toThrow();
  });

  it('never lets the private key be exported', async () => {
    const id = await createIdentity();
    expect(id.keyPair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', id.keyPair.privateKey)).rejects.toThrow();
  });

  it('gives both people the same 60-digit safety number', async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const n1 = await safetyNumber(a.fingerprint, b.fingerprint);
    expect(n1).toBe(await safetyNumber(b.fingerprint, a.fingerprint));
    expect(n1).toMatch(/^(\d{5} ){11}\d{5}$/);
  });
});

describe('vault (encryption at rest)', () => {
  const vault = createVault(randomBytes(32));

  it('round-trips and hides the plaintext', () => {
    const sealed = vault.seal('{"bio":"Here for robotics"}', 'profile:u-ada');
    expect(sealed).not.toContain('robotics');
    expect(vault.open(sealed, 'profile:u-ada')).toBe('{"bio":"Here for robotics"}');
  });

  it('refuses a sealed value moved onto another person’s record', () => {
    const sealed = vault.seal('secret', 'profile:u-ada');
    expect(() => vault.open(sealed, 'profile:u-ben')).toThrow(/altered or belongs to another record/);
  });

  it('refuses values from another key, and validates configured keys', () => {
    const other = createVault(randomBytes(32));
    expect(() => other.open(vault.seal('x', 'c'), 'c')).toThrow(/different key/);
    expect(() => vaultFromEnv({ HELLO_DATA_KEY: 'short' })).toThrow(/32 bytes/);
    expect(vaultFromEnv({}).ephemeral).toBe(true);
    expect(vaultFromEnv({ HELLO_DATA_KEY: randomBytes(32).toString('base64') }).ephemeral).toBe(false);
  });
});
