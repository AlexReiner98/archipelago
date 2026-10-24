// Snapshots and background rebuilds (docs/log.md, section 7): the projections made again from a snapshot are the ones
// made from the log's start, a snapshot from other projector code or off the chain is passed over, a past position is
// read from the nearest snapshot and the log, and a backup is a snapshot and the log, restored whole.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agent, fresh, human, make, replayed } from './map.ts';
import { dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { headOf, verify } from '../src/log.ts';
import { Archipelago } from '../src/pelago.ts';
import { asOf, rebuildProjections, snapshotNow } from '../src/rebuild.ts';
import { newestValid, snapshots } from '../src/snapshot.ts';
import { undo } from '../src/undo.ts';
import { dumpVault } from '../src/vault.ts';

/** A map with a little of everything the projector reads: items, links, held changes and their fates, an undo, a merge. */
async function busy(l: Archipelago) {
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'p', type: 'work.project', title: 'Snapshots' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Take one', owner: 'me' },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Rebuild from it' },
    { op: 'create', ref: 'q', type: 'work.decision', title: 'How often?' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'u', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'u', to: 't' },
  ]);
  const held = (await l.change(agent, { reason: 'Started', ops: [{ op: 'update', id: made.t, status: 'doing' }] })) as { proposal: string };
  await l.decide(human, { proposal: held.proposal, approve: true, note: 'Go' });
  const no = (await l.change(agent, { reason: 'Rename', ops: [{ op: 'update', id: made.p, title: 'Elsewhere' }] })) as { proposal: string };
  await l.decide(human, { proposal: no.proposal, approve: false, note: 'Keep it' });
  const edit = (await l.change(human, { reason: 'Reshape', ops: [{ op: 'update', id: made.u, title: 'Rebuilt', body: 'From the start.' }, { op: 'archive', id: made.q }] })) as { changeset: string };
  await undo(l, human, { changeset: edit.changeset });
  const twice = await make(l, [{ op: 'create', ref: 's', type: 'work.task', title: 'Said twice' }, { op: 'link', type: 'part_of', from: 's', to: made.p }]);
  await make(l, [{ op: 'merge', keep: made.t, drop: twice.s }]);
  return made;
}

const rows = async (l: Archipelago) => (await replayed(l)).live;

test('a rebuild from a snapshot is the rebuild from the start, made beside the live tables and swapped in', async () => {
  const l = await fresh();
  const made = await busy(l);
  const first = await snapshotNow(l.db, l.registry, l.workspace);
  assert.deepEqual([first.from, first.snapshots.length, first.swapped], ['start', 1, undefined], 'a snapshot made from the start, the live tables untouched');

  // More after it: a change, a held one still waiting, and one written while the rebuild is under way.
  await make(l, [{ op: 'update', id: made.u, status: 'doing' }, { op: 'create', ref: 'n', type: 'work.note', title: 'After the snapshot' }]);
  await l.change(agent, { reason: 'Later', ops: [{ op: 'update', id: made.p, props: { hub_at: 4 } }] });
  for (let i = 0; i < 6; i++) await make(l, [{ op: 'update', id: made.t, append: `Step ${i}.` }]);
  let during: Promise<unknown> | undefined;
  const fromSnapshot = await rebuildProjections(l.db, l.registry, l.workspace, {
    chunk: 2,
    progress: () => void (during ??= make(l, [{ op: 'create', type: 'work.task', title: 'Written during the rebuild' }])),
  });
  await during;
  assert.equal(fromSnapshot.from, first.snapshots[0], 'it starts at the snapshot');
  assert.ok(fromSnapshot.chunks > 2 && fromSnapshot.entries < 20, 'and projects only what came after, a chunk at a time');
  assert.deepEqual(fromSnapshot.swapped, { entity: 0, relation: 0, proposal: 0 }, 'the live tables were right: nothing to write');
  const viaSnapshot = await rows(l);
  assert.ok(viaSnapshot.items.some((i: any) => i.title === 'Written during the rebuild'), 'what was written while it ran is in');

  // Damage the live tables, then rebuild from the start: the same rows, the damage swapped away.
  await l.db.query(`update entity set title = 'Wrong', props = props || '{"tokens_used": 7}' where id = $1`, [made.t]);
  await l.db.query(`delete from relation where type = 'depends_on'`);
  const fromStart = await rebuildProjections(l.db, l.registry, l.workspace, { fromStart: true, chunk: 5 });
  assert.equal(fromStart.from, 'start');
  assert.deepEqual(fromStart.swapped, { entity: 1, relation: 1, proposal: 0 });
  assert.deepEqual(await rows(l), viaSnapshot, 'from the snapshot and from the start: row for row');
  assert.equal((await l.entity(made.t))!.props.tokens_used, 7, 'what is kept on an item that is not a fact stays');
  const { live, replay } = await replayed(l);
  assert.deepEqual(replay, live, 'and both are the log projected into an empty map');
  assert.equal((await snapshots(l.db, l.workspace)).length, 2, 'a snapshot at the head each time, one for each position');
});

test('a snapshot from other projector code, or off the chain, is not built on', async () => {
  const l = await fresh();
  await busy(l);
  const refused = async (set: string, why: RegExp) => {
    await l.db.query(`delete from log_snapshot`);
    const taken = (await snapshotNow(l.db, l.registry, l.workspace)).snapshots[0];
    assert.ok(await newestValid(l.db, l.workspace));
    await l.db.query(`update log_snapshot set ${set} where id = $1`, [taken]);
    const [s] = await snapshots(l.db, l.workspace);
    assert.ok(s.problems.some((p) => why.test(p)), `${why}: ${s.problems.join('; ')}`);
    assert.equal(await newestValid(l.db, l.workspace), undefined);
    assert.equal((await rebuildProjections(l.db, l.registry, l.workspace)).from, 'start', 'the rebuild starts from the log instead');
  };
  await refused(`projection_version = 0`, /projection version 0/);
  await refused(`code = '0000000000000000'`, /other projector code/);
  await refused(`fact_hash = decode(repeat('ab', 32), 'hex')`, /not the one it was taken at/);
  await refused(`hash = decode(repeat('cd', 32), 'hex')`, /hash is not that of what it holds/);
  await refused(`rows = substring(rows from 1 for 20)`, /cannot be read/);
  assert.equal((await snapshots(l.db, l.workspace)).filter((s) => !s.problems.length).length, 1, 'what is refused is dropped, and a good one taken in its place');
});

test('a past position reads as the map stood then: the nearest snapshot and the log after it', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'p', type: 'work.project', title: 'History' }, { op: 'create', ref: 't', type: 'work.task', title: 'First name' }]);
  const seen: { pos: number; title: string; status: string; links: number }[] = [];
  const mark = async () => {
    const t = (await l.entity(made.t))!;
    seen.push({ pos: (await headOf(l.db)).pos, title: t.title, status: t.status, links: (await l.get(made.t)).outgoing.length });
  };
  await mark();
  await make(l, [{ op: 'link', type: 'part_of', from: made.t, to: made.p }]);
  await mark();
  await snapshotNow(l.db, l.registry, l.workspace);
  await make(l, [{ op: 'update', id: made.t, title: 'Second name', status: 'doing' }]);
  await mark();
  await make(l, [{ op: 'unlink', relation: ((await l.get(made.t)) as any).outgoing[0].relation }, { op: 'update', id: made.t, status: 'done' }]);
  await mark();
  await l.change(agent, { reason: 'Rename it', ops: [{ op: 'update', id: made.t, title: 'Third name' }] });
  await make(l, [{ op: 'archive', id: made.p }]);
  await mark();
  for (const then of seen) {
    const past = await asOf(l.db, l.registry, l.workspace, then.pos);
    const t = past.rows.entity.find((e) => e.id === made.t)!;
    const links = past.rows.relation.filter((r) => r.from_id === made.t && r.valid_to === null).length;
    assert.deepEqual({ pos: then.pos, title: t.title, status: t.status, links }, then, `as it stood at ${then.pos}`);
  }
  assert.equal((await asOf(l.db, l.registry, l.workspace, seen.at(-1)!.pos)).rows.proposal.length, 1, 'the held change made by then is in the queue');
  assert.equal((await asOf(l.db, l.registry, l.workspace, seen[0].pos)).rows.proposal.length, 0);

  // What a reader may not see now, they may not see then either.
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const hid = (await l.as(me).change(human, { reason: 'Mine', ops: [{ op: 'create', ref: 'h', type: 'work.task', title: 'Private', visibility: 'private' }] })) as { created: Record<string, string> };
  const head = (await headOf(l.db)).pos;
  assert.ok((await asOf(l.db, l.registry, l.workspace, head, l.as(me).db)).rows.entity.some((e) => e.id === hid.created.h));
  assert.ok(!(await asOf(l.db, l.registry, l.workspace, head, l.as('e_someone').db)).rows.entity.some((e) => e.id === hid.created.h));
  await assert.rejects(asOf(l.db, l.registry, l.workspace, head + 5), /no entry/);
});

test('a backup is a snapshot and the log: restored into an empty map, it verifies and replays', async () => {
  const l = await fresh();
  const made = await busy(l);
  await l.change(agent, { reason: 'Waiting', ops: [{ op: 'update', id: made.p, props: { hub_at: 4 } }] });
  const taken = { ...JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' }))), vault: await dumpVault(l.db) };
  assert.equal(taken.format, 3);
  assert.deepEqual([taken.tables.entity, taken.tables.relation, taken.tables.proposal], [undefined, undefined, undefined], 'the projections are not carried as rows');
  assert.deepEqual(taken.snapshot.positions, { facts: (await headOf(l.db)).pos, pending: (await headOf(l.db, 'pending')).pos }, 'its snapshot is at the head of the log');
  assert.ok(!JSON.stringify(taken).includes('Rebuild from it'), 'and sealed');

  const into = async (file: typeof taken) => {
    const there = new Archipelago(await openDb(), l.registry);
    await restore(there.db, file);
    assert.deepEqual([(await verify(there.db)).problems, (await verify(there.db, 'pending')).problems], [[], []], 'the chain verifies');
    assert.deepEqual(await rows(there), await rows(l), 'the map as it was');
    const { live, replay } = await replayed(there);
    assert.deepEqual(replay, live, 'and its log replays to it');
    assert.deepEqual((await rebuildProjections(there.db, there.registry, there.workspace, { fromStart: true })).swapped, { entity: 0, relation: 0, proposal: 0 });
    return there;
  };
  await into(taken);
  // A snapshot this code cannot build on: the map is made from the log alone, and is the same.
  await into({ ...taken, snapshot: { ...taken.snapshot, code: '0000000000000000' } });
  await into({ ...taken, snapshot: null });
});
