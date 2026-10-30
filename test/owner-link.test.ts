// An item's owner is a link (the owner, 30 Oct 2026): saying owner makes it, a link says it, and the row's column
// follows, whichever way it was said.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Archipelago } from '../src/pelago.ts';
import { linkOwners } from '../src/owner-link.ts';
import { newId } from '../src/db.ts';
import { undo } from '../src/undo.ts';
import { fresh, human, make } from './map.ts';

const people = (l: Archipelago) =>
  make(l, [
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 'ben', type: 'person', title: 'Ben' },
  ]);
const owners = async (l: Archipelago, id: string) => {
  const { rows } = await l.db.query<{ id: string; to_id: string }>(`select id, to_id from relation where from_id = $1 and type = 'owned_by' and valid_to is null`, [id]);
  return { column: (await l.entity(id))!.owner, links: rows.map((r) => r.to_id), ids: rows.map((r) => r.id) };
};

test('saying an owner makes the link, and changing or clearing it moves the link', async () => {
  const l = await fresh();
  const { ann, ben } = await people(l);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'A task', owner: ann }]);
  assert.deepEqual(await owners(l, t).then(({ column, links }) => ({ column, links })), { column: ann, links: [ann] });
  await make(l, [{ op: 'update', id: t, owner: ben }]);
  assert.deepEqual(await owners(l, t).then(({ column, links }) => ({ column, links })), { column: ben, links: [ben] });
  await make(l, [{ op: 'update', id: t, owner: null }]);
  assert.deepEqual(await owners(l, t).then(({ column, links }) => ({ column, links })), { column: null, links: [] });
});

test('a link says the owner too: it takes the place of the one before, and unlinking clears it', async () => {
  const l = await fresh();
  const { ann, ben } = await people(l);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'A task', owner: ann }]);
  await make(l, [{ op: 'link', type: 'owned_by', from: t, to: ben }]);
  const after = await owners(l, t);
  assert.deepEqual([after.column, after.links], [ben, [ben]], 'an item has one owner');
  await make(l, [{ op: 'unlink', relation: after.ids[0] }]);
  const gone = await owners(l, t);
  assert.deepEqual([gone.column, gone.links], [null, []]);
});

test('undo puts the owner back, link and column alike', async () => {
  const l = await fresh();
  const { ann, ben } = await people(l);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'A task', owner: ann }]);
  const moved = await l.change(human, { ops: [{ op: 'update', id: t, owner: ben }], reason: 'Hand it over' });
  await undo(l, human, { changeset: (moved as { changeset: string }).changeset });
  const back = await owners(l, t);
  assert.deepEqual([back.column, back.links], [ann, [ann]]);
});

test('merging two items leaves one owner', async () => {
  const l = await fresh();
  const { ann, ben } = await people(l);
  const { keep, drop } = await make(l, [
    { op: 'create', ref: 'keep', type: 'task', title: 'The first', owner: ann },
    { op: 'create', ref: 'drop', type: 'task', title: 'The second', owner: ben },
  ]);
  await make(l, [{ op: 'merge', keep, drop }]);
  const kept = await owners(l, keep);
  assert.deepEqual([kept.column, kept.links], [ann, [ann]]);
});

test('merging a person moves what they own, link and column alike', async () => {
  const l = await fresh();
  const { ann, ben } = await people(l);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'A task', owner: ben }]);
  await make(l, [{ op: 'merge', keep: ann, drop: ben }]);
  const after = await owners(l, t);
  assert.deepEqual([after.column, after.links], [ann, [ann]]);
});

test('owners said before the link are linked once, and the item keeps its time', async () => {
  const l = await fresh();
  const { ann } = await people(l);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'A task', owner: ann }]);
  const { ids } = await owners(l, t);
  await l.db.query(`delete from relation where id = $1`, [ids[0]]);
  const before = (await l.entity(t))!.updated_at;
  assert.equal(await linkOwners(l, () => newId('r')), 1);
  assert.equal(await linkOwners(l, () => newId('r')), 0, 'it runs once');
  assert.deepEqual((await owners(l, t)).links, [ann]);
  assert.deepEqual((await l.entity(t))!.updated_at, before);
});

test('an owner is a person or an agent', async () => {
  const l = await fresh();
  const { t, u } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'A task' }, { op: 'create', ref: 'u', type: 'task', title: 'Another' }]);
  await assert.rejects(l.change(human, { ops: [{ op: 'link', type: 'owned_by', from: t, to: u }], reason: 'no' }));
});
