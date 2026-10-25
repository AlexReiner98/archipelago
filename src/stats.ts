// The planner's table statistics. Without them it guesses, and on a large map it guesses badly: the recursive scope
// query in src/places.ts made the handoff take 23 s on 20,000 items before ANALYZE and 0.7 s after. A Postgres server's
// autovacuum keeps them; PGlite has no autovacuum, so here they are collected when a database opens, after a backup
// is restored into it (a pull is one), and after enough writes since the last time.
//
// "Enough" is autovacuum's own rule with its defaults: 50 rows plus a tenth of the table changed since it was last
// analysed. A plan rarely turns until a table has grown by about that much, the check is one catalog read, and
// PGlite and a server then go stale at the same point. ANALYZE samples at most 30,000 rows a table, so it costs
// about the same on any map past that size: on 20,000 items 65 ms for entity, 71 for relation, 150 for event, and
// 0.4 to 0.55 s for every table at once, which a database never analysed pays once as it opens.

import type { Database, Q } from './db.ts';

/** autovacuum_analyze_threshold and autovacuum_analyze_scale_factor, as a server has them by default. */
export const ANALYZE_ROWS = 50;
export const ANALYZE_SHARE = 0.1;
/** How often an open PGlite database is looked at for tables changed enough. */
const CHECK_MS = 60_000;

// A table is due if it was never analysed, if enough rows changed since, or if it has grown by more than the share
// in pages: the counts are held in memory and lost if the process stops without closing the database.
// A partition of the log (src/partitions.ts) is analysed through its table, which the planner reads the statistics of
// as well as each month's.
const DUE = `select distinct coalesce(p.relname, s.relname) as name from pg_stat_user_tables s join pg_class c on c.oid = s.relid
  left join pg_inherits i on i.inhrelid = c.oid left join pg_class p on p.oid = i.inhparent
  where s.schemaname = 'public' and (c.reltuples < 0
    or s.n_mod_since_analyze > ${ANALYZE_ROWS} + ${ANALYZE_SHARE} * c.reltuples
    or pg_relation_size(c.oid) / current_setting('block_size')::int > ${ANALYZE_ROWS} + (1 + ${ANALYZE_SHARE}) * c.relpages)
  order by 1`;

/** Analyse the tables whose statistics are missing or stale. Returns their names. */
export async function analyzeDue(db: Q): Promise<string[]> {
  // The write counts reach the shared statistics at the end of a transaction; this one makes sure the last ones have.
  await db.query(`select pg_stat_force_next_flush()`).catch(() => {}); // Postgres 15 and later
  const { rows } = await db.query<{ name: string }>(DUE);
  for (const { name } of rows) await db.query(`analyze "${name}"`);
  return rows.map((r) => r.name);
}

/** Analyse every table of the map: after a restore, when nearly every row is new. */
export const analyzeAll = (db: Q) => db.query(`analyze`);

/**
 * Keep a database's statistics current from now until it is closed: what is due at once, then a look every minute
 * where nothing else looks (PGlite, or a server with autovacuum off). A failed look is told and tried again.
 */
export async function keepStatistics<D extends Database>(db: D, server: boolean): Promise<D> {
  await analyzeDue(db);
  if (server && (await db.query<{ on: boolean }>(`select current_setting('autovacuum') = 'on' and current_setting('track_counts') = 'on' as on`)).rows[0].on) return db;
  let looking: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    looking = analyzeDue(db).catch((err) => console.error(`collecting table statistics failed: ${(err as Error).message}`));
  }, CHECK_MS).unref();
  const close = db.close.bind(db);
  db.close = async () => {
    clearInterval(timer);
    await looking;
    // PGlite keeps no write counts across a close: what is due is collected now, or not until the table has grown.
    await analyzeDue(db).catch(() => {});
    await close();
  };
  return db;
}
