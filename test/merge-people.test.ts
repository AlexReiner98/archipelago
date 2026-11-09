// Two people made one: on 9 Nov 2026 Alex's second person (a new sign-in address) was merged with the first, and
// everything private to the dropped one, and its tokens, were left with a person that was gone: the kept one's page
// and a new agent token could read none of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken, verifyToken } from '../src/auth.ts';
import { agent, fresh, human, make, replayed } from './map.ts';

test('a merge of two people moves what is private to the dropped one, and its tokens act as the kept one', async () => {
  const l = await fresh();
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'person', title: 'Alex' },
    { op: 'create', ref: 'b', type: 'person', title: 'Alex again' },
  ]);
  const before = l.as(b);
  await before.change({ ...human, person: b }, { ops: [{ op: 'create', type: 'task', title: 'Mine alone', visibility: 'private' }], reason: 'test' });
  const mine = (await l.db.query<{ id: string }>(`select id from entity where title = 'Mine alone'`)).rows[0].id;
  const token = (await createToken(l.db, 'default', { kind: 'agent', name: 'bot', entity: b })).token;
  assert.equal((await l.as(a).entity(mine)), undefined, 'not yet theirs');

  // Merged by the kept person, as the live server runs it: under their row-level security, which hides the rows to move.
  const merged = await l.as(a).change({ ...human, person: a }, { ops: [{ op: 'merge', keep: a, drop: b }], reason: 'test' });
  assert.equal(merged.status, 'applied');
  assert.equal((await l.as(a).entity(mine))?.title, 'Mine alone', 'the kept person reads it');
  assert.equal((await l.entity(mine))?.private_to, a);
  assert.equal((await verifyToken(l.db, token))?.actor.person, a, 'the token acts as the kept person');
  const { live, replay } = await replayed(l);
  assert.deepEqual(replay.items, live.items, 'the log says who it is private to');
});

test('restored and merged again, a pair adds the note only once', async () => {
  const l = await fresh();
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'person', title: 'Alex', body: 'Owner.' },
    { op: 'create', ref: 'b', type: 'person', title: 'Alex again', body: 'Signs in by mail.' },
  ]);
  await make(l, [{ op: 'merge', keep: a, drop: b }]);
  await make(l, [{ op: 'restore', id: b }]);
  await make(l, [{ op: 'merge', keep: a, drop: b }]);
  assert.equal((await l.entity(a))?.body, 'Owner.\n\nSigns in by mail.');
});

test("an agent's merge of two people waits for the owner, whatever agents may do unreviewed", async () => {
  const l = await fresh();
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'person', title: 'Alex' },
    { op: 'create', ref: 'b', type: 'person', title: 'Alex again' },
  ]);
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const held = await l.change(agent, { ops: [{ op: 'merge', keep: a, drop: b }], reason: 'test' });
  assert.equal(held.status, 'proposed');
  assert.equal((held as { held_by?: { rule: string } }).held_by?.rule, 'people_merge');
});
