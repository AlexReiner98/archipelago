// The snags view: open snags grouped by what they touched, with the runs that wrote them in (task "1. Snags the
// refiner can read"). A snag is an open item of a type that declares the field `touches` (core's finding; a pack's
// issue), so the kernel names no type. Three bounded reads: the snags (inside `within`, by the part_of closure, or
// else those that name what they touched, newest first), the runs the log says wrote them, and those runs. The
// grouping is the core pack's `snagsOf`, pure, tested without a database.

import type { Archipelago } from './pelago.ts';
// @ts-ignore: a pack's plain module, typed by its use here
import { snagsOf } from '../packs/core/snags/snags.js';

/** The most snags one answer reads: past it, the newest. */
const SNAGS = 2000;

type Row = { id: string; title: string; type: string; status: string; props: Record<string, unknown> };

/** The types a snag may be: those that declare `touches`. */
const snagTypes = (l: Archipelago) => [...l.registry.types.values()].filter((t) => t.fields && 'touches' in t.fields).map((t) => t.id);

export async function snags(l: Archipelago, params: { within?: unknown }) {
  const types = snagTypes(l);
  if (!types.length) return snagsOf([], []);
  const within = typeof params.within === 'string' && params.within ? params.within : undefined;
  const { rows } = within
    ? await l.db.query<Row>(
        `select e.id, e.title, e.type, e.status, e.props from part_closure c join entity e on e.id = c.descendant
         where c.ancestor = $1 and e.type = any($2::text[]) and e.is_open and e.archived_at is null
         order by e.updated_at desc limit ${SNAGS}`,
        [within, types],
      )
    : await l.db.query<Row>(
        `select id, title, type, status, props from entity
         where type = any($1::text[]) and is_open and archived_at is null and props ? 'touches'
         order by updated_at desc limit ${SNAGS}`,
        [types],
      );
  const ids = rows.map((r) => r.id);
  // The runs that wrote each snag: the log keeps each change's run in its head.
  const { rows: wrote } = ids.length
    ? await l.db.query<{ snag: string; run: string }>(
        `select distinct f.id as snag, e.head->>'run' as run from log_fact f
         join log_entry e on e.stream = f.stream and e.pos = f.pos and e.at = f.at
         where f.id = any($1::text[]) and f.stream = 'facts' and e.head ? 'run'`,
        [ids],
      )
    : { rows: [] };
  const runIds = [...new Set(wrote.map((w) => w.run))];
  const { rows: runs } = runIds.length
    ? await l.db.query<{ id: string; title: string; packs: unknown }>(`select id, title, props->'packs' as packs from entity where id = any($1::text[])`, [runIds])
    : { rows: [] };
  const run = new Map(runs.map((r) => [r.id, r]));
  const answer = snagsOf(
    rows.map((r) => ({ id: r.id, title: r.title, type: r.type, status: r.status, severity: r.props.severity, touches: r.props.touches })),
    wrote.filter((w) => run.has(w.run)).map((w) => ({ snag: w.snag, id: w.run, title: run.get(w.run)!.title, ...(run.get(w.run)!.packs != null && { packs: run.get(w.run)!.packs }) })),
  );
  return { ...(within && { within }), ...answer, ...(rows.length === SNAGS && { more: `The newest ${SNAGS} snags; ask within a feature for the rest.` }) };
}
