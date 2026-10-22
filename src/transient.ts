// What a request leaves for a later one that may reach another process: a backup link, where a session's prompt hook
// last heard up to, a refused change kept for a retry. Kept in the workspace's database for
// minutes or days, not in this process's memory, so a deploy or a second server answers the next request as well as
// the one that began it. It is operational state, no fact about the map: it is written here, not through change, and
// is in no backup. Only the whole database reaches it; no member's role is granted it.

import type { Q } from './db.ts';

/** The table, made by step 3 of the schema (src/migrate.ts). */
export const TRANSIENT = `
create table if not exists transient (
  key   text primary key,
  value jsonb not null default 'null',
  data  bytea,
  until timestamptz not null
);
create index if not exists transient_until on transient (until);
alter table transient enable row level security;`;

/** Keep a value under a key for `ms`, in place of what was there. Run out ones are cleared as it goes. */
export async function keep(db: Q, key: string, value: unknown, ms: number, data?: Buffer): Promise<void> {
  await db.query(`delete from transient where until < now()`);
  await db.query(
    `insert into transient (key, value, data, until) values ($1, $2::jsonb, $3, now() + make_interval(secs => $4))
     on conflict (key) do update set value = excluded.value, data = excluded.data, until = excluded.until`,
    [key, JSON.stringify(value ?? null), data ?? null, ms / 1000],
  );
}

/** What is kept under a key, if it has not run out. */
export async function kept<T>(db: Q, key: string): Promise<T | undefined> {
  const { rows } = await db.query<{ value: T }>(`select value from transient where key = $1 and until >= now()`, [key]);
  return rows[0]?.value;
}

/** What is kept under a key, given once: taken away as it is read, by whichever request asks first. */
export async function take<T>(db: Q, key: string): Promise<{ value: T; data?: Buffer } | undefined> {
  const { rows } = await db.query<{ value: T; data: Uint8Array | null; live: boolean }>(`delete from transient where key = $1 returning value, data, until >= now() as live`, [key]);
  const row = rows[0];
  if (!row?.live) return undefined;
  return { value: row.value, ...(row.data && { data: Buffer.from(row.data) }) };
}
