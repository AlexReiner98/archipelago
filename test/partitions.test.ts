// The log cut by time (src/partitions.ts): a chain that runs through several years verifies and replays into the
// rows the map has, every partition refuses what the log refuses, one made after the schema too, and an entry that
// does not follow the one before is refused by the database, whichever partition it lands in.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Archipelago } from '../src/pelago.ts';
import { openDb, type Q } from '../src/db.ts';
import { entryHash, GENESIS } from '../src/jcs.ts';
import { entries, factAt, stored, verify, type Entry } from '../src/log.ts';
import { makePartitions } from '../src/partitions.ts';
import { rebuild } from '../src/replay.ts';
import { dumpVault, restoreVault } from '../src/vault.ts';
import { record } from '../src/streams.ts';
import { syncTypes } from '../src/typetable.ts';
import { fresh, make, replayed } from './map.ts';

const monthsAgo = (n: number, day = 3) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, day, 9, 30)).toISOString();
};

/** Write a stored entry as append does, at the time and after the hash given: how a log from years back is laid down. */
async function lay(tx: Q, e: Entry, at: string, prev: string): Promise<string> {
  const moved = { ...e, at, prev } as Entry;
  moved.hash = entryHash(moved);
  const { stream, pos, at: _a, facts, prev: _p, hash, ...head } = moved;
  await tx.query(`insert into log_entry (stream, pos, id, at, head, undoes, prev, hash) values ($1, $2, $3, $4, $5::jsonb, $6, decode($7, 'hex'), decode($8, 'hex'))`, [
    stream, pos, e.id, at, JSON.stringify(head), (head.undoes as string | undefined) ?? null, prev, hash,
  ]);
  if (facts.length) await tx.query(
    `insert into log_fact (stream, pos, at, n, op, id, field, value, meta)
     select $1, $2, $3, f.n - 1, f.x->>0, f.x->>1, f.x->>2, case when jsonb_array_length(f.x) > 3 then f.x->3 end, f.x->4 from jsonb_array_elements($4::jsonb) with ordinality f(x, n)`,
    [stream, pos, at, JSON.stringify(facts)],
  );
  return hash;
}

/** A map whose log began two and a half years ago: the change sets of another map, months apart, then today's. */
async function aged() {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Years' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Cut the log', body: 'A year at a time.' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await make(l, [{ op: 'update', id: made.t, status: 'doing' }]);
  await make(l, [{ op: 'update', id: made.t, title: 'Cut the log by time', append: 'With BRIN on the time.' }]);
  const old = await stored(l.db);
  const vault = await dumpVault(l.db);
  const m = new Archipelago(await openDb(), l.registry);
  await m.db.transaction(async (tx) => {
    await restoreVault(tx, vault);
    await makePartitions(tx, monthsAgo(30));
    let prev = GENESIS;
    for (const [i, e] of old.entries()) prev = await lay(tx, e, monthsAgo(Math.max(30 - 10 * i, 1)), prev);
    // Words are opened for whoever may see the item (src/seal.ts): projected once to have the items, then again in clear.
    await rebuild(tx, l.registry, await stored(tx));
    await rebuild(tx, l.registry, await entries(tx));
  });
  await syncTypes(m);
  await make(m, [{ op: 'update', id: made.t, status: 'done' }]);
  return { m, made, old: old.length };
}

const partsOf = async (q: Q, table: string) =>
  (await q.query<{ part: string }>(`select distinct tableoid::regclass::text as part from ${table} order by 1`)).rows.map((r) => r.part);

test('a chain through several years verifies, replays into the rows the map has, and is read as of a position', async () => {
  const { m, made, old } = await aged();
  const parts = await partsOf(m.db, 'log_entry');
  assert.ok(parts.length >= 3, `the entries are in ${parts.join(', ')}`);
  assert.deepEqual(await partsOf(m.db, 'log_fact'), parts.map((p) => p.replace('log_entry', 'log_fact')), 'each fact lives with its entry');
  const checked = await verify(m.db);
  assert.deepEqual(checked.problems, []);
  assert.ok(checked.entries > old, 'today\'s change set follows the years before it');

  const { live, replay } = await replayed(m);
  assert.deepEqual(replay.items, live.items, 'every item, row for row');
  assert.deepEqual(replay.links, live.links, 'every link, row for row');

  const all = await entries(m.db);
  const doing = all.find((e) => e.facts.some((f) => f[1] === made.t && f[2] === 'status' && f[3] === 'doing'))!;
  assert.equal((await factAt(m.db, made.t, 'status', doing.pos))?.value, 'doing', 'as of a position a year or more back');
  assert.equal((await factAt(m.db, made.t, 'status', doing.pos - 1))?.value, 'todo', 'and the one before it, ten months earlier');
  assert.equal((await factAt(m.db, made.t, 'status'))?.value, 'done', 'and now');
  assert.equal((await factAt(m.db, made.t, 'title', doing.pos))?.value, 'Cut the log', 'a title as it was, opened');
});

test('a partition made after the schema refuses update, delete and truncate like the rest of the log', async () => {
  const { m } = await aged();
  const [first] = await partsOf(m.db, 'log_entry');
  const facts = first.replace('log_entry', 'log_fact');
  for (const sql of [
    `delete from ${first}`, `update ${first} set id = 'c_x'`, `truncate ${facts}`, `delete from ${facts}`, `update ${facts} set value = 'null'`,
    `delete from log_entry where at < now() - interval '1 year'`, `truncate log_fact`,
  ]) await assert.rejects(m.db.query(sql), /append-only|truncate a table referenced/, sql);
  const ahead = await m.db.query<{ part: string }>(`select c.relname as part from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'log_op'::regclass order by 1 desc limit 1`);
  await assert.rejects(m.db.query(`truncate ${ahead.rows[0].part}`), /append-only/, 'the newest partition of the compacted streams');
  assert.deepEqual((await verify(m.db)).problems, []);
});

test('an entry that does not follow the one before is refused, and a missing partition is made by the append that needs it', async () => {
  const l = await fresh();
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'work.task', title: 'Follow on' }]);
  const [last] = (await stored(l.db)).slice(-1);
  const head = JSON.stringify({ v: 1, ws: 'default', id: 'c_bad', actor: { id: 'system' }, reason: 'x' });
  const put = (pos: number, prev: string, at = 'now()') =>
    l.db.query(`insert into log_entry (stream, pos, id, at, head, prev, hash) values ('facts', $1, 'c_bad', ${at}, $2::jsonb, decode($3, 'hex'), decode(repeat('0', 64), 'hex'))`, [pos, head, prev]);
  await assert.rejects(put(last.pos, last.hash), /does not follow/, 'a position taken');
  await assert.rejects(put(last.pos + 2, last.hash), /does not follow/, 'a position skipped');
  await assert.rejects(put(last.pos + 1, GENESIS), /does not name the hash/, 'another chain');
  await assert.rejects(put(last.pos + 1, last.hash, `'${new Date(Date.parse(last.at) - 1).toISOString()}'`), /earlier than the entry before/, 'back in time');

  // A server that slept past its partitions: the append makes the one it lands in.
  const now = (await l.db.query<{ part: string }>(`select pelago_log_part('log_op', now()) as part`)).rows[0].part;
  const later = (await l.db.query<{ part: string }>(`select c.relname as part from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'log_op'::regclass and c.relname > $1 order by 1`, [now])).rows;
  for (const { part } of later) await l.db.query(`drop table ${part}`); // those ahead, still empty
  await l.db.query(`drop table ${now}`); // this one of the compacted streams, empty too
  await l.db.transaction((tx) => record(tx, 'default', 'sessions', 'system', [['+', t, 'story', 'beat']]));
  await make(l, [{ op: 'update', id: t, status: 'doing' }]);
  assert.ok((await partsOf(l.db, 'log_op')).includes(now), 'made when it was needed');
  assert.equal(await makePartitions(l.db), 0, 'and those ahead with it');
  assert.deepEqual((await verify(l.db)).problems, []);
});
