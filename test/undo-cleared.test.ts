// Undo of an update that cleared a field (bump e_4cgnnw2t): the field holds its old value again, read from the log, or
// for an item from before the log from the snapshot before the change; never written as nothing when that is unknown.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh, human, make } from './map.ts';
import type { Archipelago } from '../src/pelago.ts';
import { snapshotNow } from '../src/rebuild.ts';
import { undo } from '../src/undo.ts';

test('undo of an update that cleared a field brings its value back', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'A', props: { priority: 'high' } }]);
  const cleared = (await l.change(human, { reason: 'Clear', ops: [{ op: 'update', id: made.t, props: { priority: null } }] })) as { changeset: string };
  assert.equal((await l.entity(made.t))!.props.priority, undefined);
  const back = (await undo(l, human, { changeset: cleared.changeset })) as { reversed: number };
  assert.equal(back.reversed, 1);
  assert.equal((await l.entity(made.t))!.props.priority, 'high');
});

test('undo of clearing a style\'s shape brings the shape back', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 's', type: 'style', title: 'House', props: { shape: 'list', gap: 10 } }]);
  await l.change(human, { reason: 'Gap', ops: [{ op: 'update', id: made.s, props: { gap: 12 } }] });
  const cleared = (await l.change(human, { reason: 'No shape', ops: [{ op: 'update', id: made.s, props: { shape: null } }] })) as { changeset: string };
  assert.equal((await l.entity(made.s))!.props.shape, undefined);
  await undo(l, human, { changeset: cleared.changeset });
  assert.deepEqual((await l.entity(made.s))!.props, { shape: 'list', gap: 12 });
});

/** A style as every item on the live map made before 24 Oct 2026 is: a row the log never said. */
async function beforeTheLog(l: Archipelago) {
  const kind = l.registry.type('style')?.starter ?? null;
  await l.db.query(`insert into entity (id, type, kind, title, status, is_open, visibility, props) values ('e_beforelog', 'style', $1, 'House style', 'current', true, 'shared', $2)`, [kind, { shape: 'list', gap: 10 }]);
  return 'e_beforelog';
}

test('an item from before the log: undo reads what a field held from the snapshot before the change', async () => {
  const l = await fresh();
  const id = await beforeTheLog(l);
  await snapshotNow(l.db, l.registry, l.workspace);
  const cleared = (await l.change(human, { reason: 'No shape', ops: [{ op: 'update', id, props: { shape: null } }] })) as { changeset: string };
  const set = (await l.change(human, { reason: 'Wider', ops: [{ op: 'update', id, props: { gap: 14 } }] })) as { changeset: string };
  assert.deepEqual((await undo(l, human, { changeset: cleared.changeset })).skipped, []);
  assert.deepEqual((await l.entity(id))!.props, { shape: 'list', gap: 14 });
  await undo(l, human, { changeset: set.changeset });
  assert.deepEqual((await l.entity(id))!.props, { shape: 'list', gap: 10 }, 'a value set over one from before the log goes back to it, not to nothing');
});

test('an item from before the log, and no snapshot: undo says it cannot tell, and writes nothing', async () => {
  const l = await fresh();
  const id = await beforeTheLog(l);
  const cleared = (await l.change(human, { reason: 'No shape', ops: [{ op: 'update', id, props: { shape: null, gap: 12 } }] })) as { changeset: string };
  await assert.rejects(undo(l, human, { changeset: cleared.changeset }), /Nothing to undo.*"House style": what (gap|shape) held is from before the log/s);
  assert.deepEqual((await l.entity(id))!.props, { gap: 12 });
});
