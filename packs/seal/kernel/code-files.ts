// Code on the log as files by hash (task e_ubdb4u7c, docs/log.md section 2, "Code fields"): what a pack's code already
// is (packs/loader/kernel/pack-code.ts). A code field's value (a module's text, modules by name, a version's files by
// path, a stylesheet) is stored as the files it is, each named by the SHA-256 of its text, and holds the text of a file
// only when the item's last value of that field did not have it:
//
//   { "$files": { "index.js": "9c1e…" }, "$texts": { "9c1e…": "export default …" }, "$one": true }
//
// so a one-line change to one module logs that module's text alone. `$one` says the field was one text, read back as
// its one file's text. On the way out every value is read back whole, so what reads a field (the projection, the page,
// look, an edit, a pull) reads text as before; a value stored before this (the text itself) reads as it always did.
// The value is sealed with the item's key like any other field (packs/seal/kernel/seal.ts): a text is found again
// only among the facts of the same item and field, never another item's.

import { createHash } from 'node:crypto';
import type { Q } from '../../database/kernel/db.ts';
import type { Fact } from '../../log/kernel/log.ts';

/** A code field's value as the log stores it. */
export type CodeStored = { $files: Record<string, string>; $texts?: Record<string, string>; $one?: true };
/** One value read from the log's rows, as the openers hand it round. */
export type Said = { id: string; field: string; value: unknown };

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const HASH = /^[0-9a-f]{64}$/;

/** Whether a value is a code field's value as the log stores it. */
export const isCodeStored = (v: unknown): v is CodeStored => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>, files = o.$files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return false;
  if (Object.keys(o).some((k) => k !== '$files' && k !== '$texts' && k !== '$one')) return false;
  return Object.values(files).every((h) => typeof h === 'string' && HASH.test(h));
};

/** A code field's value as files by path, with the name a one-text field's file has; undefined where it is not that shape. */
function filesOf(value: unknown, one: string): { files: Record<string, string>; one: boolean } | undefined {
  if (typeof value === 'string') return { files: { [one]: value }, one: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length || entries.some(([p, t]) => typeof t !== 'string' || p.startsWith('$'))) return undefined;
  return { files: value as Record<string, string>, one: false };
}

/** The hashes of a value's files, whichever form it is in: stored by hash, or whole (as read back, or from before). */
export function hashesOf(value: unknown): Set<string> {
  if (isCodeStored(value)) return new Set(Object.values(value.$files));
  const f = filesOf(value, 'index.js');
  return new Set(f ? Object.values(f.files).map(sha) : []);
}

/**
 * Facts as the log stores them: each assertion on a code field (`code`, its field name to the name a one-text value's
 * file has) made files by hash, the text of a file kept only where `known` (the hashes the item's field already has
 * on the log) lacks it. Pure. Anything else, and a value of another shape, is as it was.
 */
export function codeFacts(facts: Fact[], code: ReadonlyMap<string, string>, known: (id: string, field: string) => ReadonlySet<string>): Fact[] {
  const kept = new Map<string, Set<string>>(); // what this entry has kept already, by item and field
  return facts.map((f): Fact => {
    if (f[0] !== '+' || !f[1].startsWith('e_') || !code.has(f[2])) return f;
    const files = filesOf(f[3], code.get(f[2])!);
    if (!files) return f;
    const at = `${f[1]}\0${f[2]}`, here = kept.get(at) ?? new Set<string>(), had = known(f[1], f[2]);
    kept.set(at, here);
    const $files: Record<string, string> = {}, $texts: Record<string, string> = {};
    for (const [path, text] of Object.entries(files.files)) {
      const h = ($files[path] = sha(text));
      if (!had.has(h) && !here.has(h)) { $texts[h] = text; here.add(h); }
    }
    const stored: CodeStored = { $files, ...(Object.keys($texts).length && { $texts }), ...(files.one && { $one: true as const }) };
    return [...f.slice(0, 3), stored, ...f.slice(4)] as Fact;
  });
}

/** The hashes each item's code fields already have on the log: those of the last value asserted on each (`open` reads it whole). */
export async function knownHashes(q: Q, facts: Fact[], code: ReadonlyMap<string, string>, open: (rows: Said[]) => Promise<Said[]>): Promise<(id: string, field: string) => ReadonlySet<string>> {
  const pairs = [...new Set(facts.filter((f) => f[0] === '+' && f[1].startsWith('e_') && code.has(f[2])).map((f) => `${f[1]}\0${f[2]}`))];
  const out = new Map<string, Set<string>>();
  if (pairs.length) {
    const ids = [...new Set(pairs.map((p) => p.split('\0')[0]))], fields = [...new Set(pairs.map((p) => p.split('\0')[1]))];
    const { rows } = await q.query<Said>(
      `select distinct on (id, field) id, field, value from log_fact where stream = 'facts' and op = '+' and id = any($1::text[]) and field = any($2::text[]) order by id, field, at desc, pos desc, n desc -- index log_fact_history`,
      [ids, fields],
    );
    for (const r of await open(rows)) out.set(`${r.id}\0${r.field}`, hashesOf(r.value));
  }
  return (id, field) => out.get(`${id}\0${field}`) ?? new Set();
}

// Texts read back lately, by item and hash: an edit's next read needs the texts the one before it found.
const CACHE_MOST = 32 * 1024 * 1024;
const cache = new Map<string, string>();
let cached = 0;
function remember(key: string, text: string) {
  if (cache.has(key)) return;
  cache.set(key, text);
  cached += text.length;
  for (const [k, t] of cache) { if (cached <= CACHE_MOST) break; cache.delete(k); cached -= t.length; }
}

/** Every text a value holds, by its hash: stored by hash or whole. Each checked against its hash. */
function harvest(id: string, value: unknown, into: Map<string, string>) {
  const add = (text: unknown) => { if (typeof text === 'string') { const h = sha(text); into.set(`${id}\0${h}`, text); } };
  if (isCodeStored(value)) { for (const [h, t] of Object.entries(value.$texts ?? {})) if (typeof t === 'string' && sha(t) === h) into.set(`${id}\0${h}`, t); return; }
  const f = filesOf(value, 'index.js');
  if (f) for (const t of Object.values(f.files)) add(t);
}

/** A value stored by hash read back whole, from texts by item and hash; undefined while a text is lacking. */
function whole(id: string, v: CodeStored, texts: Map<string, string>): unknown {
  const out: Record<string, string> = {};
  for (const [path, h] of Object.entries(v.$files)) {
    const text = v.$texts?.[h] ?? texts.get(`${id}\0${h}`) ?? cache.get(`${id}\0${h}`);
    if (text === undefined) return undefined;
    out[path] = text;
  }
  return v.$one ? Object.values(out)[0] : out;
}

const READ_BACK = 50;

/**
 * Values opened from the log (`open` opens rows of it, with nothing read back) with each code field's value stored by
 * hash read back whole: its texts found in the values beside it, or in the field's earlier facts on the log, newest
 * first. A value whose text the log no longer has (its item forgotten) stays as it is stored.
 */
export async function codeRead<T extends Said>(q: Q, said: T[], open: (rows: Said[]) => Promise<Said[]>): Promise<T[]> {
  if (!said.some((r) => isCodeStored(r.value))) return said;
  const texts = new Map<string, string>();
  for (const r of said) harvest(r.id, r.value, texts);
  const lacking = new Map<string, Set<string>>(); // by item and field, the hashes not yet found
  for (const r of said) {
    if (!isCodeStored(r.value) || whole(r.id, r.value, texts) !== undefined) continue;
    const at = `${r.id}\0${r.field}`, set = lacking.get(at) ?? new Set<string>();
    for (const h of Object.values(r.value.$files)) if (!r.value.$texts?.[h] && !texts.has(`${r.id}\0${h}`) && !cache.has(`${r.id}\0${h}`)) set.add(h);
    lacking.set(at, set);
  }
  for (const [at, set] of lacking) {
    const [id, field] = at.split('\0');
    // Bounded by the item and field, newest first, a few at a time: the texts an edit lacks are mostly in the facts just before it.
    for (let offset = 0; set.size; offset += READ_BACK) {
      const { rows } = await q.query<Said>(
        `select id, field, value from log_fact where op = '+' and id = $1 and field = $2 order by at desc, pos desc, n desc limit ${READ_BACK} offset ${offset} -- index log_fact_history`,
        [id, field],
      );
      if (!rows.length) break;
      const found = new Map<string, string>();
      for (const r of await open(rows)) harvest(r.id, r.value, found);
      for (const [k, t] of found) { texts.set(k, t); if (set.delete(k.split('\0')[1])) remember(k, t); }
    }
  }
  return said.map((r) => {
    if (!isCodeStored(r.value)) return r;
    const value = whole(r.id, r.value, texts);
    if (value === undefined) return r;
    for (const h of Object.values(r.value.$files)) remember(`${r.id}\0${h}`, r.value.$texts?.[h] ?? texts.get(`${r.id}\0${h}`) ?? cache.get(`${r.id}\0${h}`)!);
    return { ...r, value };
  });
}
