// A merge runs once: on 23 Oct 2026 one held merge, approved three times while it applied, appended the absorbed note
// to the kept item three times. A merge of what is already gone is refused, on the write path and when approved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Archipelago } from '../src/pelago.ts';
import { agent, fresh, human, make } from './map.ts';

const pair = (l: Archipelago) =>
  make(l, [
    { op: 'create', ref: 'keep', type: 'work.issue', title: 'A page reloads on every change', body: 'The original.' },
    { op: 'create', ref: 'drop', type: 'work.issue', title: 'Every screen redraws', body: 'The copy.' },
  ]);
const events = async (l: Archipelago) => Number((await l.db.query<{ n: number }>(`select count(*)::int as n from event`)).rows[0].n);
const hold = async (l: Archipelago, keep: string, drop: string) => {
  const held = await l.change(agent, { ops: [{ op: 'merge', keep, drop }], reason: 'Merge the copy into its original' });
  assert.equal(held.status, 'proposed');
  return (held as { proposal: string }).proposal;
};

test('a second merge of the same pair is refused, and the note is not appended again', async () => {
  const l = await fresh();
  const { keep, drop } = await pair(l);
  await make(l, [{ op: 'merge', keep, drop }]);
  assert.equal((await l.entity(keep))!.body, 'The original.\n\nThe copy.');
  await assert.rejects(l.change(human, { ops: [{ op: 'merge', keep, drop }], reason: 'again' }), /"Every screen redraws" is already merged into "A page reloads on every change" \(c_/);
  assert.equal((await l.entity(keep))!.body, 'The original.\n\nThe copy.');
});

test('a merge into an archived item, or of the same item twice in one change, is refused', async () => {
  const l = await fresh();
  const { keep, drop } = await pair(l);
  const { other } = await make(l, [{ op: 'create', ref: 'other', type: 'work.issue', title: 'A third copy' }]);
  await assert.rejects(l.change(human, { ops: [{ op: 'merge', keep, drop }, { op: 'merge', keep: other, drop }], reason: 'twice' }), /merged twice in this change/);
  await assert.rejects(l.change(human, { ops: [{ op: 'merge', keep, drop }, { op: 'merge', keep: drop, drop: other }], reason: 'into the gone' }), /merged away earlier in this change/);
  await make(l, [{ op: 'archive', id: other }]);
  await assert.rejects(l.change(human, { ops: [{ op: 'merge', keep: other, drop }], reason: 'into archived' }), /"A third copy" is archived: restore it/);
  assert.equal((await l.entity(drop))!.archived_at, null, 'nothing was merged');
});

test('approving a stale held merge is refused, names itself, and leaves the map unchanged', async () => {
  const l = await fresh();
  const { keep, drop } = await pair(l);
  const first = await hold(l, keep, drop);
  const second = await hold(l, keep, drop);
  await l.decide(human, { proposal: first, approve: true });
  const [body, before] = [(await l.entity(keep))!.body, await events(l)];
  await assert.rejects(l.decide(human, { proposal: second, approve: true }), (err: Error) => {
    assert.match(err.message, new RegExp(`^${second} is out of date`));
    assert.match(err.message, /op 1 \(merge\): "Every screen redraws" is already merged into/);
    return true;
  });
  assert.equal((await l.entity(keep))!.body, body);
  assert.equal(await events(l), before, 'nothing was written, not even the decision');
  assert.deepEqual((await l.proposals()).map((p: { id: string }) => p.id), [second], 'it waits to be declined');
});

test('one held merge approved twice at once is applied once', async () => {
  const l = await fresh();
  const { keep, drop } = await pair(l);
  const id = await hold(l, keep, drop);
  const tries = await Promise.allSettled([l.decide(human, { proposal: id, approve: true }), l.decide(human, { proposal: id, approve: true }), l.decide(human, { proposal: id, approve: true })]);
  assert.equal(tries.filter((t) => t.status === 'fulfilled').length, 1);
  for (const t of tries) if (t.status === 'rejected') assert.match((t.reason as Error).message, /being decided already|already approved/);
  assert.equal((await l.entity(keep))!.body, 'The original.\n\nThe copy.');
  assert.equal(((await l.events({ target: keep })) as any[]).filter((e) => e.action === 'entity.merge').length, 1);
});
