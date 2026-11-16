// Where the map stands for one reader: the position a read's answer depends on (task e_mvuvfba7). An answer given at a
// position is the answer still, as long as the map stands there: the page keeps it and asks again with it (`since`),
// and is told "unchanged" without the read being done (packs/surface/kernel/reads.ts). One definition, for every
// reader that keeps an answer by the log's position.
//
// What a kept answer can move with, each read in one statement:
// - the fact stream's head and the pending stream's head (log_entry): every item, link, held change and its decision;
// - the settings stream's head (log_op): every setting set by a person or the server, as it is appended there
//   (packs/log/kernel/operational.ts, setting); a pack's own bookkeeping in the table (the clock's cursor) is not;
// - what is shared, which is kept beside the map and never logged (share, public_view): its row count and the sum of
//   the writing transaction of each row, which an insert, an update and a delete each change;
// - the server itself: one started again runs other code, and other packs;
// - the day, for an answer that ages (a working view retires after days untouched);
// - for a read of the work (`work`: the frontier, attention, what a server keeps by packs/loader/kernel/kept.ts), the
//   operational streams it weighs (a session's bookkeeping, a claim), the whole settings table (a pack's own memory and
//   the clock's cursor among it, set without its stream) and what each session touched (the transient store), which
//   keep no position: what each holds stands for it.
// Who reads is the asker's own: the stamp is read through the reader's database, so what is shared counts as they see
// it, and it names them, so one reader's stamp never answers another's.
//
// Each head is read as it stands when asked, before the read it stamps: a change committed after is a later position,
// so an answer is never stamped later than what it saw. Positions within a stream are taken under its lock and only
// grow, in the order they are committed.

import { randomUUID } from 'node:crypto';
import type { Q } from '../../database/kernel/db.ts';

/** This server's start: an answer given before it ran other code. */
const STARTED = randomUUID().slice(0, 8);

/** The heads, each the last entry of its stream: by the order the stream is kept in, so only its newest part is read. */
const HEADS = `select
  (select pos::text from log_entry where stream = 'facts' order by at desc, pos desc limit 1
  ) as f,
  (select pos::text from log_entry where stream = 'pending' order by at desc, pos desc limit 1
  ) as p,
  (select pos::text from pelago_log_op_last('settings')) as s`;
/** And what is shared, for a read of it. */
const SHARED = `,
  (select count(*)::text || '.' || coalesce(sum(xmin::text::bigint), 0)::text from share) as sh,
  (select count(*)::text || '.' || coalesce(sum(xmin::text::bigint), 0)::text from public_view) as pv`;

/** And what a read of the work weighs, counted past the row policies by the function of step 50 (./work-stands.ts). */
const WORK = `,
  pelago_work_stands() as w`;

/** Where the map stands: `map` for a read of the map, `shared` (when asked) for a read of what is shared too. */
export interface Stands {
  map: string;
  shared?: string;
}

/**
 * Where the map stands for `reader`, each as a word to compare whole: the same word, the same answer. `reader` is who
 * asks (their kind, person, and token), read through `db` as they see the map; `shared` reads what is shared too.
 */
export async function standsAt(db: Q, reader: string, shared = false, work = false): Promise<Stands> {
  type Row = { f: string | null; p: string | null; s: string | null; sh?: string; pv?: string; w?: string };
  const { rows } = await db.query<Row>(HEADS + (shared ? SHARED : '') + (work ? WORK : ''));
  const r = rows[0];
  const worked = work ? [r.w] : [];
  const map = [STARTED, new Date().toISOString().slice(0, 10), r.f ?? 0, r.p ?? 0, r.s ?? 0, ...worked, reader].join(':');
  return { map, ...(shared && { shared: [map, r.sh, r.pv].join(':') }) };
}

/**
 * Where the map stands for a read of the work, as one value: what a server keeps an answer under (packs/loader/kernel/kept.ts).
 * Read through the reader's own database: what the reader may not see is only counted, by step 50's function.
 */
export async function mapClock(db: Q): Promise<string> {
  return (await standsAt(db, '', false, true)).map;
}
