// Search through its indexes answers as reading every row did: the same items, in the same order, for whoever asks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Q } from '../packs/database/kernel/db.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { fresh, make } from './map.ts';
import { searchMap } from '../packs/surface/kernel/search.ts';

/** Search as it was before the index (to 23 Oct 2026): every row's words read on each call. */
async function before(db: Q, input: { q: string; type?: string[]; limit?: number }) {
  const run = async (how: 'all' | 'near' | 'any') => {
    const near = how === 'near';
    // Near, each way of the words with two letters side by side swapped is tried too (since 29 Oct 2026).
    const chars = [...input.q.slice(0, 64)];
    const slips = [input.q, ...chars.slice(1).map((_, i) => input.q.slice(0, i) + input.q[i + 1] + input.q[i] + input.q.slice(i + 2))];
    const params: unknown[] = near ? [input.q, slips] : [input.q];
    const TEXT = `to_tsvector('english', title || ' ' || body)`;
    // Any word, the most words first, when neither finds anything (since 3 Nov 2026).
    const ANY = `(select count(*) from unnest(tsvector_to_array(to_tsvector('english', $1))) w where ${TEXT} @@ quote_literal(w)::tsquery)`;
    const where = [how === 'any' ? `${ANY} > 0` : near ? `exists (select 1 from unnest($2::text[]) v where word_similarity(v, title) > 0.5)` : `(title ilike '%' || $1 || '%' or ${TEXT} @@ websearch_to_tsquery('english', $1))`, 'archived_at is null'];
    if (input.type) where.push(`type = any($${params.push(input.type)}::text[])`);
    // Ranked by the title alone since 25 Oct 2026 (packs/surface/kernel/search.ts rankSql): a note is matched, not ranked.
    const rank = `${how === 'any' ? `${ANY} desc, ` : ''}(case when title ilike '%' || $1 || '%' then 1 else 0 end) + similarity($1, title) + ts_rank(to_tsvector('english', title), websearch_to_tsquery('english', $1), 1) desc, `;
    const { rows } = await db.query<{ id: string }>(
      `select id from entity where ${where.join(' and ')} order by ${rank}updated_at desc limit $${params.push(Math.min(input.limit ?? 25, 200))}`,
      params,
    );
    return rows.map((r) => r.id);
  };
  for (const how of ['all', 'near'] as const) {
    const rows = await run(how);
    if (rows.length) return rows;
  }
  return run('any');
}

const WORDS = ['roof', 'wall', 'sun', 'model', 'export', 'render', 'review', 'site', 'sheet', 'grid', 'running', 'runs', 'the', 'of', 'Apex'];

test('search through the indexes answers as reading every row did, for each viewer', async () => {
  const l = await fresh();
  const { bo } = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo' }]);
  const word = (n: number) => WORDS[n % WORDS.length];
  await make(
    l,
    Array.from({ length: 180 }, (_, n) => ({
      op: 'create' as const,
      type: n % 3 ? 'task' : 'record',
      title: `${word(n)} ${word(n * 7 + 1)}${n % 11 === 0 ? ' the' : ''}`,
      body: n % 4 ? `About the ${word(n * 3)} of ${word(n * 5)}. ${'More words follow here. '.repeat(n % 6)}` : '',
      visibility: 'shared' as const,
    })),
  );
  // Across the title and the note, with a word the index leaves out between: a phrase reads the positions.
  const { gone } = await make(l, [
    { op: 'create', type: 'task', title: 'Fix the roof the', body: 'sheet music for the band', visibility: 'shared' },
    { op: 'create', ref: 'gone', type: 'task', title: 'Archived roof review', visibility: 'shared' },
  ]);
  await make(l, [{ op: 'archive', id: gone }]);
  await l.as(bo).change({ kind: 'human', name: 'bo', person: bo }, { ops: [{ op: 'create', type: 'task', title: 'Bo private roof review', body: 'model export notes', visibility: 'private' }], reason: 'test' });
  // A distinct time for each item, so that equal ranks fall in one order however the rows are read.
  await l.db.query(`update entity set updated_at = now() - (('x' || substr(md5(id), 1, 6))::bit(24)::int || ' seconds')::interval`);

  const queries = ['model export', 'review', 'roof', 'rendr', 'revew', 'reveiw', 'mdoel export', 'running', 'runs', '"roof the sheet"', '"the roof"', '-roof wall', 'roof or sun', 'the', 'of', 'Ap', 'ex', '%', 'apex model', 'nothing like this', 'privat', 'roof nothing', 'zzz sheet render grid', 'model export zzz'];
  const viewers: [string, Archipelago][] = [['the owner', l], ['Bo', l.as(bo)], ['someone else', l.as('e_someone')]];
  let found = 0;
  for (const [who, view] of viewers)
    for (const q of queries)
      for (const input of [{ q }, { q, limit: 5 }, { q, type: 'task' }]) {
        const ids = (await searchMap(view, input)).map((e) => e.id);
        found += ids.length;
        assert.deepEqual(ids, await before(view.db, { ...input, type: input.type ? l.registry.family(input.type) : undefined }), `${who}: ${JSON.stringify(input)}`);
      }
  assert.ok(found > 1000, 'the queries find things');
  assert.ok(!(await searchMap(l.as('e_someone'), { q: 'Bo private' })).some((e) => e.title === 'Bo private roof review'), "Bo's own item is his alone");
  assert.equal((await searchMap(l.as(bo), { q: 'Bo private' })).length, 1);
});

test('a search whose words are not all in one item finds those with any of them, the most words first', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', type: 'finding', title: 'The map goes stale outside its sessions', visibility: 'shared' },
    { op: 'create', type: 'finding', title: 'Work left unpushed', body: 'Seen when commits are stale.', visibility: 'shared' },
    { op: 'create', type: 'task', title: 'Draw the map', visibility: 'shared' },
  ]);
  const titles = (await searchMap(l, { q: 'stale map unpushed commits' })).map((e) => e.title);
  assert.deepEqual(titles, ['Work left unpushed', 'The map goes stale outside its sessions', 'Draw the map']);
  assert.deepEqual((await searchMap(l, { q: 'stale map unpushed commits', type: 'task' })).map((e) => e.title), ['Draw the map']);
  assert.equal((await searchMap(l, { q: 'zzz qqq' })).length, 0, 'no word found, nothing found');
});
