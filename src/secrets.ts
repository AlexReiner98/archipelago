// Secrets this server has to be able to use, and so cannot keep only as a
// hash: a workspace's Anthropic key, the secret GitHub signs with, the GitHub
// App's own key. They are sealed before they are stored (AES-256-GCM), with a
// key that is never in a database or a backup, so a backup file, a copy of it
// off the server, or a database read on its own gives up none of them.
//
// The sealing key is LATTICE_SECRETS_KEY when that is set (32 bytes, base64:
// the stronger arrangement, since the key is then not on the server's disk at
// all), and otherwise a file made on first use beside the workspaces
// (secrets.key, for the server's own eyes). A value sealed with either can be
// opened while that one is still there. Sealed on another server, or with a
// key since lost, a value cannot be opened: it reads as not set, and is set
// again by whoever owns it.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MARK = 'sealed:v1:';
let dir: string | null = null;
let made: Buffer | undefined;

/** Where the key file is kept. Null (tests, a server with no disk of its own) keeps a key for this process only. */
export function configureSecrets(folder: string | null): void {
  dir = folder;
  made = undefined;
}

function fromEnv(): Buffer | undefined {
  const given = process.env.LATTICE_SECRETS_KEY?.trim();
  if (!given) return undefined;
  const key = Buffer.from(given, 'base64');
  if (key.length !== 32) throw new Error('LATTICE_SECRETS_KEY must be 32 bytes in base64 (for example: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))").');
  return key;
}

function fromFile(create: boolean): Buffer | undefined {
  if (made) return made;
  if (!dir) return create ? (made = randomBytes(32)) : undefined;
  const file = join(dir, 'secrets.key');
  if (existsSync(file)) return (made = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
  if (!create) return undefined;
  mkdirSync(dir, { recursive: true });
  made = randomBytes(32);
  writeFileSync(file, made.toString('base64') + '\n', { mode: 0o600 });
  return made;
}

/** The settings that are secrets. A backup never holds one of these unsealed, whenever it was stored. */
export const SECRET_SETTINGS = ['anthropic_key', 'github_secret'];

export const isSealed = (value: unknown): value is string => typeof value === 'string' && value.startsWith(MARK);

/** Seal a secret for storing. */
export function seal(secret: string): string {
  const key = fromEnv() ?? fromFile(true)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${MARK}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${body.toString('base64')}`;
}

/**
 * Open a stored secret. One stored before secrets were sealed is given back
 * as it is (and is sealed the next time it is stored). One that cannot be
 * opened, because the key it was sealed with is not here, is undefined.
 */
export function unseal(stored: string | undefined | null): string | undefined {
  if (!stored) return undefined;
  if (!isSealed(stored)) return stored;
  const [iv, tag, body] = stored.slice(MARK.length).split(':').map((part) => Buffer.from(part, 'base64'));
  for (const key of [fromEnv(), fromFile(false)]) {
    if (!key) continue;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      // Not sealed with this key: the other may open it.
    }
  }
  return undefined;
}
