import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for personal data the server must still be able to read to do its job
 * (for example, showing your bio to the people you allowed). AES-256-GCM with a random 96-bit IV
 * per record and the record's identity as additional authenticated data, so a sealed value
 * cannot be copied onto another person's record and still open.
 *
 * This is NOT end-to-end encryption: whoever holds HELLO_DATA_KEY can open these values. Direct
 * messages use end-to-end encryption in the browser instead (src/lib/e2ee), and the server never
 * holds those keys.
 */

export interface Vault {
  /** True when no HELLO_DATA_KEY was configured and a per-process key was generated. Data is lost on restart. */
  readonly ephemeral: boolean;
  /** A short, non-secret identifier for the key, so rotated keys can be told apart. */
  readonly keyId: string;
  seal(plaintext: string, context: string): string;
  open(envelope: string, context: string): string;
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export function createVault(key: Buffer, ephemeral = false): Vault {
  if (key.length !== 32) throw new VaultError('The data key must be 32 bytes.');
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 10);
  return {
    ephemeral,
    keyId,
    seal(plaintext, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return ['v1', keyId, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join('.');
    },
    open(envelope, context) {
      const [version, kid, iv, tag, ct] = envelope.split('.');
      if (version !== 'v1' || !iv || !tag || ct === undefined) throw new VaultError('Unrecognised sealed value.');
      if (kid !== keyId) throw new VaultError('Sealed with a different key.');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, unb64(iv));
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(unb64(tag));
        return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]).toString('utf8');
      } catch {
        throw new VaultError('The sealed value was altered or belongs to another record.');
      }
    },
  };
}

/** Reads HELLO_DATA_KEY (32 bytes, base64). Without it, a random per-process key is used and reported as ephemeral. */
export function vaultFromEnv(env: Record<string, string | undefined>): Vault {
  const raw = (env.HELLO_DATA_KEY ?? '').trim();
  if (raw.length > 0) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new VaultError('HELLO_DATA_KEY must be 32 bytes, base64-encoded.');
    return createVault(key, false);
  }
  return createVault(randomBytes(32), true);
}
