// A big read planned once (task e_d9ysqwab): a statement marked PLAN_ONCE runs named on a Postgres server, its plan
// generic and kept on the connection, and answers as it does unmarked, under each viewer's row security. On PGlite the
// mark is a comment. The setting that makes the plan generic is the statement's alone: the transaction keeps its own.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anyone, PLAN_ONCE, scoped, type Q } from '../packs/database/kernel/db.ts';
import { fresh, make } from './map.ts';

/** What each viewer may see of some items, read by their ids: a parameter, so the text is the same each time. */
const READ = `select id, title from entity where id = any($1::text[]) order by id`;

test('a read planned once answers as it does unmarked, for each viewer', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'open', type: 'task', title: 'Seen by the members' },
    { op: 'create', ref: 'mine', type: 'task', title: 'Seen by Ann alone' },
    { op: 'create', ref: 'yours', type: 'task', title: 'Seen by Bo alone' },
  ]);
  await l.db.query(`update entity set private_to = 'e_ann' where id = $1`, [made.mine]);
  await l.db.query(`update entity set private_to = 'e_bo' where id = $1`, [made.yours]);
  const ids = [made.open, made.mine, made.yours];
  const titles = async (q: Q, sql: string) => (await q.query<{ title: string }>(sql, [ids])).rows.map((r) => r.title);

  for (const round of [1, 2, 3]) {
    for (const [who, db] of [['Ann', scoped(l.db, 'e_ann')], ['Bo', scoped(l.db, 'e_bo')], ['anyone', anyone(l.db)]] as const) {
      const planned = await titles(db, READ + PLAN_ONCE);
      assert.deepEqual(planned, await titles(db, READ), `${who} reads the same either way (round ${round})`);
      if (who === 'Ann') assert.ok(planned.includes('Seen by Ann alone') && !planned.includes('Seen by Bo alone'));
      if (who === 'Bo') assert.ok(planned.includes('Seen by Bo alone') && !planned.includes('Seen by Ann alone'));
      if (who === 'anyone') assert.deepEqual(planned, [], 'anyone sees nothing that is not public');
    }
  }
  // Outside a transaction, on the whole database: everything.
  assert.equal((await titles(l.db, READ + PLAN_ONCE)).length, 3);

  if (!process.env.PELAGO_TEST_DATABASE_URL) return;
  // On one connection, one viewer after another: the plan made for Ann is generic, kept, and right for Bo.
  await l.db.transaction(async (tx) => {
    const as = async (viewer: string) => {
      await tx.query(`select set_config('pelago.viewer', $1, true)`, [viewer]);
      return titles(tx, READ + PLAN_ONCE);
    };
    await tx.query(`set local role pelago_member`);
    for (let i = 0; i < 3; i++) {
      assert.ok((await as('e_ann')).includes('Seen by Ann alone'));
      const bo = await as('e_bo');
      assert.ok(bo.includes('Seen by Bo alone') && !bo.includes('Seen by Ann alone'), 'the kept plan reads the viewer as it runs');
    }
    const [kept] = (await tx.query<{ generic_plans: number; custom_plans: number }>(`select generic_plans, custom_plans from pg_prepared_statements where statement like '%' || $1`, [PLAN_ONCE.trim()])).rows;
    assert.ok(kept, 'the marked read is a prepared statement on the connection');
    assert.equal(Number(kept.custom_plans), 0, 'never planned for its values');
    assert.ok(Number(kept.generic_plans) >= 6, `its generic plan is used each time (${kept.generic_plans})`);
    const [mode] = (await tx.query<{ plan_cache_mode: string }>(`show plan_cache_mode`)).rows;
    assert.equal(mode.plan_cache_mode, 'auto', 'the transaction keeps its own setting');
  });
});
