// Where the map stands, as one value that moves whenever anything a read of the map may depend on is written: the
// fact stream and the held changes (the log's own streams), the operational streams that change what a read of the
// work weighs (a session's bookkeeping, a claim), the workspace's settings, and the sets the sessions touched (the
// transient store).
// A read whose answer is kept (packs/loader/kernel/kept.ts) is kept under this value and asked again once it moves.
//
// Each stream's position is given out under the stream's lock, held until its append commits (log.ts, streams.ts), so
// a position is never seen before what it says: read before the answer is, it can only be older than the answer,
// never newer. The settings and the touched sets keep no position: what each holds stands for them (a setting is not
// always set through its stream, a pack's memory and the clock's cursor among them), and of a touched set, how long it
// is kept, which every keep sets anew. Read as the whole database, past row-level security: what moved is not anyone's to see, only that it did.

import type { Q } from '../../database/kernel/db.ts';

/** The log's streams a read of the map reads: the facts, and the changes held for a person (the review queue). */
const LOGGED = ['facts', 'pending'];
/** The operational streams a read of the work weighs: a run's bookkeeping, who holds what. */
const OPERATIONAL = ['sessions', 'claims'];
/** The transient store's keys a read of the work weighs: what each session touched (packs/sessions/kernel/touched.ts). */
const TRANSIENT = 'touched:%';

/** Where the map stands now, as one value: equal to an earlier one only when nothing a read may depend on was written between. */
export async function mapClock(whole: Q): Promise<string> {
  const { rows: [r] } = await whole.query<{ logged: (number | null)[]; ops: (number | null)[]; settings: string; touched: string }>(
    `select array(select (select max(pos) from log_entry where stream = s) from unnest($1::text[]) s)::bigint[] as logged, -- index log_entry_pos
            array(select (select max(pos) from log_op where stream = s) from unnest($2::text[]) s)::bigint[] as ops, -- index log_op_pos
            (select md5(coalesce(string_agg(key || '=' || value::text, ',' order by key), '')) from setting) as settings,
            (select md5(coalesce(string_agg(key || '@' || until::text, ',' order by key), '')) from transient where key like $3) as touched`,
    [LOGGED, OPERATIONAL, TRANSIENT],
  );
  return [...r.logged, ...r.ops].map((n) => n ?? 0).join('.') + '.' + r.settings.slice(0, 12) + '.' + r.touched.slice(0, 12);
}
