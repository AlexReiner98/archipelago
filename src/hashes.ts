// The server's few ways with secrets, kept in one place: a secret's hash, a comparison that takes the same time
// whatever it finds, a webhook's signature, and the random strings tokens and secrets are made of. Each was once
// written beside its use; a check that differs from the others is how one of them goes wrong.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** The sha256 of a value, in hex: how a secret is kept, and what a value is known by. */
export const sha256Hex = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Random bytes in hex: so many bytes, twice as many characters. */
export const randomHex = (bytes: number) => randomBytes(bytes).toString('hex');

/** A secret named by its use: `<prefix>_<48 hex>`. */
export const newSecret = (prefix: string) => `${prefix}_${randomHex(24)}`;

/** A secret of one workspace, which says whose it is: `<prefix>_<workspace>_<40 hex>` (a token, an invitation, a code). */
export const workspaceSecret = (prefix: string, workspace: string) => `${prefix}_${workspace}_${randomHex(20)}`;

/** Whether two values are the same bytes, in a time that does not tell how much of them matched. */
export function sameBytes(a: string | Buffer, b: string | Buffer): boolean {
  const x = typeof a === 'string' ? Buffer.from(a) : a;
  const y = typeof b === 'string' ? Buffer.from(b) : b;
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Whether a secret given is the one whose hash is kept. */
export const sameSecret = (given: string, keptHash: string) => sameBytes(sha256Hex(given), keptHash);

/**
 * Whether a body was signed with the secret: its HMAC-SHA256 in hex, as `sha256=<hex>` (prefixed, as GitHub sends)
 * or the bare hex. Space around the signature is not part of it.
 */
export function signedWith(secret: string, body: string | Buffer, signature: string | undefined, format: 'prefixed' | 'hex' = 'prefixed'): boolean {
  if (!secret || signature === undefined) return false;
  const hex = createHmac('sha256', secret).update(body).digest('hex');
  return sameBytes(signature.trim(), format === 'hex' ? hex : `sha256=${hex}`);
}
