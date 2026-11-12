// The root service root.transient (docs/kernel-packs.md, "Root services"): the transient store (./transient.ts) for
// the service packs packs/roots.json lets keep in it (presence's screens, a look's picture, an address that bounced).
// Only the whole database reaches the store, so it is read and kept as the whole workspace of the map that calls,
// whoever is asking: as the kernel's own callers handed those packs the whole database before they moved.

import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { bypassingRls } from '../../walls/kernel/outbox.ts';
import { keep, kept, keptWith } from './transient.ts';

/** What a pack asks of the store: keep a value (and bytes) under a key, read one key (with its bytes), or read keys and prefixes at once. */
export type TransientAsk =
  | { keep: { key: string; value: unknown; ms: number; data?: Buffer } }
  | { kept: string; data?: boolean }
  | { scan: { keys?: string[]; prefixes?: string[]; except?: string[] } };

const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 400;
const texts = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 100 && v.every(text));

/** Answer one ask of the store, as the whole workspace of the map that calls. */
export async function transientOf(call: RootCall, ask: TransientAsk): Promise<unknown> {
  if (!call.map) throw new Error('root.transient keeps a workspace\'s: call it from its map');
  const { db } = await bypassingRls(call.map);
  if ('keep' in ask) {
    const { key, value, ms, data } = ask.keep;
    if (!text(key) || !(typeof ms === 'number' && ms > 0) || (data !== undefined && !Buffer.isBuffer(data))) throw new Error('root.transient keeps a key, for some ms, with bytes as a Buffer');
    return keep(db, key, value, ms, data);
  }
  if ('kept' in ask) {
    if (!text(ask.kept)) throw new Error('root.transient reads a key');
    return ask.data ? keptWith(db, ask.kept) : kept(db, ask.kept);
  }
  if ('scan' in ask) {
    const { keys = [], prefixes = [], except = [] } = ask.scan;
    if (![keys, prefixes, except].every(texts) || !(keys.length + prefixes.length)) throw new Error('root.transient scans some keys or prefixes, at most a hundred of each');
    const { rows } = await db.query<{ key: string; value: unknown }>(
      `select key, value from transient where until >= now() and (key = any($1::text[]) or exists (select 1 from unnest($2::text[]) p where starts_with(key, p))) and not (key = any($3::text[]))`,
      [keys, prefixes, except],
    );
    return rows;
  }
  throw new Error('root.transient keeps, reads or scans');
}
