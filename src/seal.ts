// Sealing the log's content (docs/log.md, section 5). On the way into the log every value that is someone's words is
// sealed with the key of what it belongs to: an item's title, note and declared fields with the item's key, a link's
// fields with the link's own, a change set's reason and basis with the change set's; a held change's ops, warnings and
// source with a key of their own (`<id>/ops`), so that forgetting an item they touch leaves its reason. What is
// structure (ids, types, statuses, flags, a link's ends) stays clear. On the way out each is opened for whoever may see
// it; one whose key is gone, or that they may not see, reads as its digest.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Q } from './db.ts';
import type { Entry, Fact } from './log.ts';
import { keysFor, keysIn, keysOf, type Key, type VaultDump } from './vault.ts';

export type Sealed = { $k: number; $n: string; $c: string };
export type Digest = { $h: string };

/** Fields that are structure, never sealed: what routes, orders, verifies and enforces visibility without a key. */
export const CLEAR = ['type', 'kind', 'status', 'visibility', 'private_to', 'owner', 'confidence', 'source', 'archived', 'merged_into', 'forgotten', 'checked', 'link', 'type_def'];
const clear = new Set(CLEAR);

/** Whether a fact's value is sealed: a value of an item or a link that is not structure. */
export const sealable = (id: string, field: string) => (id.startsWith('e_') || id.startsWith('r_')) && !clear.has(field);

/** The parts of a header that are free text, by stream, each with the key it is sealed under. */
const HEAD: Record<string, [field: string, key: (id: string) => string][]> = {
  facts: [['reason', (id) => id]],
  pending: [['reason', (id) => id], ['ops', (id) => `${id}/ops`], ['warnings', (id) => `${id}/ops`], ['source', (id) => `${id}/ops`]],
};
const BASIS = (id: string) => id;

export const isSealed = (v: unknown): v is Sealed =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && '$k' in v && '$n' in v && '$c' in v && Object.keys(v).length === 3;

/** The digest a sealed value is hashed by, and becomes when its key is destroyed. */
export const digestOf = (v: Sealed): Digest => ({ $h: createHash('sha256').update(Buffer.concat([Buffer.from(v.$n, 'base64url'), Buffer.from(v.$c, 'base64url')])).digest('hex') });

const aad = (ws: string, id: string, field: string) => Buffer.from(`${ws}\0${id}\0${field}`, 'utf8');

export function seal(key: Key, field: string, value: unknown): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.key, iv);
  cipher.setAAD(aad(key.ws, key.id, field));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { $k: key.version, $n: iv.toString('base64url'), $c: body.toString('base64url') };
}

/** The value, or undefined when no key given opens it. */
export function open(keys: Key[] | undefined, field: string, v: Sealed): unknown {
  const key = keys?.find((k) => k.version === v.$k);
  if (!key) return undefined;
  try {
    const bytes = Buffer.from(v.$c, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key.key, Buffer.from(v.$n, 'base64url'));
    decipher.setAAD(aad(key.ws, key.id, field));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, bytes.length - 16)), decipher.final()]).toString('utf8'));
  } catch {
    return undefined;
  }
}

type Head = { id: string; [field: string]: unknown };

/** An entry's header and facts as the log stores them, and the keys they use, sorted. */
export async function sealEntry(q: Q, ws: string, stream: string, head: Head, facts: Fact[]) {
  const parts = (HEAD[stream] ?? []).filter(([field]) => head[field] !== undefined && head[field] !== null);
  const basis = (head.authority as { basis?: unknown } | null | undefined)?.basis;
  const ids = new Set<string>(facts.filter((f) => f[0] === '+' && sealable(f[1], f[2])).map((f) => f[1]));
  for (const [, key] of parts) ids.add(key(head.id));
  if (basis !== undefined) ids.add(BASIS(head.id));
  const ring = await keysFor(q, ws, [...ids]);
  const sealed: Head = { ...head };
  for (const [field, key] of parts) sealed[field] = seal(ring.get(key(head.id))!, field, head[field]);
  if (basis !== undefined) sealed.authority = { ...(head.authority as object), basis: seal(ring.get(BASIS(head.id))!, 'basis', basis) };
  const out = facts.map((f): Fact => (f[0] === '+' && sealable(f[1], f[2]) ? ([...f.slice(0, 3), seal(ring.get(f[1])!, f[2], f[3]), ...f.slice(4)] as Fact) : f));
  return { head: { ...sealed, keys: [...ids].sort() }, facts: out };
}

/** Of these ids, the ones the reader may see: the items, links and held changes its database shows it. */
async function seen(q: Q, ids: string[]): Promise<Set<string>> {
  const { rows } = await q.query<{ id: string }>(
    `select id from entity where id = any($1::text[]) union all select id from relation where id = any($1::text[]) union all select id from proposal where id = any($1::text[])`,
    [ids],
  );
  return new Set(rows.map((r) => r.id));
}

/** Entries as their reader may read them: each sealed value opened, or left as its digest. */
export async function openEntries(q: Q, entries: Entry[]): Promise<Entry[]> {
  const ids = new Set<string>();
  for (const e of entries) {
    for (const f of e.facts) if (f[0] === '+' && isSealed(f[3])) ids.add(f[1]);
    for (const k of (e.keys as string[] | undefined) ?? []) ids.add(k);
  }
  if (!ids.size) return entries;
  const [ring, visible] = await Promise.all([keysOf(q, [...ids]), seen(q, [...ids, ...entries.filter((e) => e.stream === 'pending').map((e) => e.id)])]);
  const read = (id: string, field: string, v: unknown, may: boolean) => (isSealed(v) ? opened(may ? open(ring.get(id), field, v) : undefined, v) : v);
  return entries.map((e) => {
    // A held change's reader also reads what it would make, which no one can see yet.
    const making = new Set(e.stream === 'pending' && visible.has(e.id) ? Object.values((e.ids as Record<string, string> | undefined) ?? {}) : []);
    const mayRead = (id: string) => visible.has(id) || making.has(id);
    const facts = e.facts.map((f): Fact => (f[0] === '+' && isSealed(f[3]) ? ([...f.slice(0, 3), read(f[1], f[2], f[3], mayRead(f[1])), ...f.slice(4)] as Fact) : f));
    // A header is read with its entry: by whoever may see one of its items, or by anyone when it names none.
    // What an entry forgets is no one's to see, and does not hide why it was forgotten.
    const named = e.facts.filter((f) => (f[1].startsWith('e_') || f[1].startsWith('r_')) && f[2] !== 'forgotten');
    const may = e.stream === 'pending' ? visible.has(e.id) : !named.length || named.some((f) => mayRead(f[1]));
    const out: Entry = { ...e, facts };
    for (const [field, key] of HEAD[e.stream] ?? []) if (field in e) out[field] = read(key(e.id), field, e[field], may);
    const authority = e.authority as { basis?: unknown } | null | undefined;
    if (authority?.basis !== undefined) out.authority = { ...authority, basis: read(BASIS(e.id), 'basis', authority.basis, may) };
    return out;
  });
}

/** One stored value of one field of an item or link, opened for this reader. */
export async function openValue(q: Q, id: string, field: string, value: unknown): Promise<unknown> {
  if (!isSealed(value)) return value;
  const [ring, visible] = await Promise.all([keysOf(q, [id]), seen(q, [id])]);
  return opened(visible.has(id) ? open(ring.get(id), field, value) : undefined, value);
}

/**
 * Values read straight from the log's rows, each opened with the key of what it belongs to (`id`, under `field`), or
 * left as its digest. Whether the reader may see them is the caller's to check.
 */
export async function openSaid<T extends { id: string; field: string; value: unknown }>(q: Q, said: T[]): Promise<T[]> {
  const ids = [...new Set(said.filter((r) => isSealed(r.value)).map((r) => r.id))];
  if (!ids.length) return said;
  const ring = await keysOf(q, ids);
  return said.map((r) => (isSealed(r.value) ? { ...r, value: opened(open(ring.get(r.id), r.field, r.value), r.value) } : r));
}

/**
 * Entries opened with every key the vault still holds, for no reader: what a rebuild projects from. The server's own
 * read, never a page's; a value whose key is gone stays its digest.
 */
export async function openAll(q: Q, entries: Entry[], vault?: VaultDump): Promise<Entry[]> {
  const ids = new Set<string>();
  for (const e of entries) {
    for (const f of e.facts) if (f[0] === '+' && isSealed(f[3])) ids.add(f[1]);
    for (const k of (e.keys as string[] | undefined) ?? []) ids.add(k);
  }
  if (!ids.size) return entries;
  const ring = new Map([...(vault ? keysIn(vault, ids) : []), ...(await keysOf(q, [...ids]))]);
  const read = (id: string, field: string, v: unknown) => (isSealed(v) ? opened(open(ring.get(id), field, v), v) : v);
  return entries.map((e) => {
    const out: Entry = { ...e, facts: e.facts.map((f): Fact => (f[0] === '+' && isSealed(f[3]) ? ([...f.slice(0, 3), read(f[1], f[2], f[3]), ...f.slice(4)] as Fact) : f)) };
    for (const [field, key] of HEAD[e.stream] ?? []) if (field in e) out[field] = read(key(e.id), field, e[field]);
    const authority = e.authority as { basis?: unknown } | null | undefined;
    if (authority?.basis !== undefined) out.authority = { ...authority, basis: read(BASIS(e.id), 'basis', authority.basis) };
    return out;
  });
}

const opened = (plain: unknown, v: Sealed) => (plain === undefined ? digestOf(v) : plain);

/** A stored header with every sealed value in it standing as its digest: what a forget leaves of it. */
export function digested(value: unknown): unknown {
  if (isSealed(value)) return digestOf(value);
  if (Array.isArray(value)) return value.map(digested);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, digested(v)]));
  return value;
}
