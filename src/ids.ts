// A new id: a prefix and eight letters and digits that read unambiguously. Apart from src/db.ts, which gives it to
// every caller, so what the schema steps run (src/migrate.ts) can make ids without importing the database's opener.

import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(prefix: string): string {
  let out = '';
  for (const byte of randomBytes(8)) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}
