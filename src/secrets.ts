// Secrets this server has to be able to use, and so cannot keep only as a
// hash: a workspace's model account, the secret a pack's webhook is signed with,
// the keys a server pack's hosts are called with. They are sealed before they are stored (AES-256-GCM), with a
// key that is never in a database or a backup, so a backup file, a copy of it
// off the server, or a database read on its own gives up none of them.
//
// The sealing key is PELAGO_SECRETS_KEY when that is set (32 bytes, base64:
// the stronger arrangement, since the key is then not on the server's disk at
// all), and otherwise a file made on first use beside the workspaces
// (secrets.key, for the server's own eyes). A value sealed with either can be
// opened while that one is still there. Sealed on another server, or with a
// key since lost, a value cannot be opened: it reads as not set, and is set
// again by whoever owns it.
//
// Servers that share a Postgres server must seal with the same key, and keep
// nothing on a disk of their own: there the key comes only from
// PELAGO_SECRETS_KEY. A key file found beside the workspaces still opens what
// was sealed with it, but none is made.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env.ts';

const MARK = 'sealed:v1:';
let dir: string | null = null;
let made: Buffer | undefined;
let mayMake = true;

/**
 * Where the key file is kept. Null (tests) keeps a key for this process only. `make` false (a server on Postgres)
 * makes no key: without PELAGO_SECRETS_KEY nothing can be sealed.
 */
export function configureSecrets(folder: string | null, make = true): void {
  dir = folder;
  made = undefined;
  mayMake = make;
}

function fromEnv(): Buffer | undefined {
  const given = env('SECRETS_KEY')?.trim();
  if (!given) return undefined;
  const key = Buffer.from(given, 'base64');
  if (key.length !== 32) throw new Error('PELAGO_SECRETS_KEY must be 32 bytes in base64 (for example: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))").');
  return key;
}

function fromFile(create: boolean): Buffer | undefined {
  if (made) return made;
  if (!dir) return create ? (made = randomBytes(32)) : undefined;
  const file = join(dir, 'secrets.key');
  if (existsSync(file)) return (made = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
  if (!create) return undefined;
  if (!mayMake) throw new Error('Set PELAGO_SECRETS_KEY to keep a secret: servers sharing a database seal with the one key, and none is kept on a disk.');
  mkdirSync(dir, { recursive: true });
  made = randomBytes(32);
  writeFileSync(file, made.toString('base64') + '\n', { mode: 0o600 });
  return made;
}

/** The key secrets and the key vault (src/vault.ts) are sealed with. `make` false: none is made where there is none. */
export function sealingKey(make = true): Buffer {
  const key = fromEnv() ?? fromFile(make);
  if (!key) throw new Error('This server has no sealing key: what was sealed elsewhere cannot be opened here.');
  return key;
}

/** The settings that are secrets. A backup never holds one of these unsealed, whenever it was stored. */
export const SECRET_SETTINGS = ['model_account', 'anthropic_key', 'github_secret'];

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
  // A whole tag or none: a shorter one would be taken as good, and is far easier to make up.
  if (tag?.length !== 16) return undefined;
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
