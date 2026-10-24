// The canonical form of a log entry and its hash (docs/log.md, section 1): RFC 8785 (JCS) over the entry without its
// hash, each sealed value standing as the digest of its bytes, after a prefix no other JSON document starts with.

import { createHash } from 'node:crypto';

/** RFC 8785: keys sorted by UTF-16 code units, no whitespace, numbers and strings as ECMAScript writes them. */
export function jcs(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`A log entry cannot hold ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => jcs(v === undefined ? null : v)).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // The default sort compares UTF-16 code units, which is what the scheme asks.
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`;
  }
  throw new Error(`A log entry cannot hold a ${typeof value}`);
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** A value sealed with its item's key (section 5): { $k, $n, $c }. Nothing is sealed yet; the per-item keys task seals. */
const isSealed = (v: unknown): v is { $k: number; $n: string; $c: string } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && '$k' in v && '$n' in v && '$c' in v && Object.keys(v).length === 3;

/** Each sealed value replaced by the digest of its nonce and ciphertext, so the chain verifies without any key. */
function digested(value: unknown): unknown {
  if (isSealed(value)) return { $h: sha256(Buffer.concat([Buffer.from(value.$n, 'base64url'), Buffer.from(value.$c, 'base64url')])) };
  if (Array.isArray(value)) return value.map(digested);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, digested(v)]));
  return value;
}

/** The bytes an entry's hash covers. */
export const canonical = (entry: Record<string, unknown>) => {
  const { hash: _, ...rest } = entry;
  return `pelago-log\n${jcs(digested(rest))}`;
};

/** Hex SHA-256 of an entry's canonical form. */
export const entryHash = (entry: Record<string, unknown>) => sha256(canonical(entry));

/** The previous hash of the first entry in a stream. */
export const GENESIS = '0'.repeat(64);
