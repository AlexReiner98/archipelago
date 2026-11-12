// The write path's hook points (docs/kernel-packs.md, "Write-path hooks"): a service pack fills each, and the write
// path keeps it to its bounds. Proved on a probe (test/packs/write_probe) and on the mentions pack (packs/mentions).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { rewriteProblem } from '../packs/write/kernel/write-hooks.ts';
import { openKernel } from '../packs/loader/kernel/kernel-context.ts';
import { entries } from '../packs/log/kernel/log.ts';
import { rebuild } from '../packs/log/kernel/replay.ts';
import type { Archipelago, Op } from '../packs/write/kernel/pelago.ts';
import { agent, freshWith, human, packsWith } from './map.ts';

const dir = packsWith('write_probe');
const AUTO = { create: 'auto', update: 'auto', link: 'auto' } as const;
const probed = async () => {
  const l = await freshWith(new Registry(dir), AUTO);
  openKernel(l); // as a workspace is opened: the internal packs fill the write path's points
  await l.db.query(`create table probe_row (item text primary key, title text)`); // the database pack makes a declared table, in a later step
  return l;
};
const task = (title: string, more: Partial<Op> = {}): Op => ({ op: 'create', ref: 't', type: 'task', title, ...more }) as Op;
const change = (l: Archipelago, ops: Op[], who = agent) => l.change(who, { ops, reason: 'test' });

test('a rewrite keeps the same ops, sets only what it fills, and never widens what was stated', () => {
  const ops: Op[] = [task('A', { visibility: 'shared' }), { op: 'update', id: 'e_aaaaaaaa', title: 'B' }];
  assert.equal(rewriteProblem(ops, [{ ...ops[0], props: { island: 'e_i' } }, ops[1]], ['island']), undefined);
  assert.equal(rewriteProblem(ops, [{ ...ops[0], visibility: 'private' }, ops[1]], []), undefined, 'narrowed');
  assert.match(rewriteProblem(ops, [ops[0]], [])!, /1 ops for 2/);
  assert.match(rewriteProblem(ops, [{ ...ops[0], type: 'note' }, ops[1]], [])!, /op 1: changed its type/);
  assert.match(rewriteProblem(ops, [ops[0], { ...ops[1], title: 'C' }], [])!, /op 2: changed its title/);
  assert.match(rewriteProblem(ops, [{ ...ops[0], props: { tag: 1 } }, ops[1]], ['island'])!, /set tag, a field it does not fill/);
  assert.match(rewriteProblem(ops, [{ ...ops[0], visibility: 'public' }, ops[1]], [])!, /widened its visibility from shared to public/);
});

test("a pack's rewrite that breaks its bounds refuses the change, naming the pack", async () => {
  const l = await probed();
  await assert.rejects(change(l, [task('Widen', { visibility: 'shared' })]), /the write_probe pack's rewrite op 1: widened its visibility/);
  await assert.rejects(change(l, [task('Tag')]), /the write_probe pack's rewrite op 1: set tag, a field it does not fill/);
  const made = (await change(l, [task('Narrow', { visibility: 'shared' })])) as { created: Record<string, string> };
  assert.equal((await l.entity(made.created.t))!.visibility, 'private', 'a narrowing it may make');
});

test("a pack's validator refuses and warns, before the rules judge it", async () => {
  const l = await probed();
  await assert.rejects(change(l, [task('Forbidden')]), /"Forbidden" is not a title here/);
  await assert.rejects(change(l, [task('Forbidden')], human), /even for a person/, 'told who the change is from');
  const done = await change(l, [task('Careful')]);
  assert.ok(done.warnings.includes('careful with that'));
});

test('what a pack follows a change with is judged with it, applied with it, and said in its entry', async () => {
  const l = await probed();
  const done = (await change(l, [task('Follow')])) as { status: string; changeset: string };
  assert.equal(done.status, 'applied');
  assert.equal((await l.db.query(`select 1 from entity where title = 'Followed'`)).rows.length, 1);
  const [entry] = (await entries(l.db, 'facts', 1)).filter((e) => e.id === done.changeset);
  assert.deepEqual(entry.follows, [{ pack: 'write_probe', ops: 1 }]);
  // Held where agents' changes wait: what followed waits with it, as one change.
  const held = await freshWith(new Registry(dir));
  openKernel(held);
  const proposed = (await change(held, [task('Follow')])) as { status: string; proposal: string };
  assert.equal(proposed.status, 'proposed');
  const { rows } = await held.db.query<{ ops: Op[] }>(`select ops from proposal where id = $1`, [proposed.proposal]);
  assert.deepEqual(rows[0].ops.map((o) => (o as { title: string }).title), ['Follow', 'Followed']);
});

test('a follow that answers otherwise once judged refuses the change: the map moved', async () => {
  const l = await probed();
  await assert.rejects(change(l, [task('Moving')]), /the map moved while this change was judged/);
  assert.equal((await l.db.query(`select 1 from entity where title like 'Moved%' or title = 'Moving'`)).rows.length, 0);
});

test("a pack's projector writes its own table in the change's transaction, clears it on a forget, and is run in a rebuild", async () => {
  const l = await probed();
  const made = (await change(l, [task('Projected')], human)) as { created: Record<string, string> };
  const id = made.created.t;
  assert.deepEqual((await l.db.query(`select item, title from probe_row`)).rows, [{ item: id, title: 'Projected' }]);
  await l.db.transaction(async (tx) => rebuild(tx, l.registry, await entries(tx, 'facts', 1)));
  assert.deepEqual((await l.db.query(`select item, title from probe_row`)).rows, [{ item: id, title: 'Projected' }], 'emptied and made again from the log');
  await l.change(human, { ops: [{ op: 'forget', id, reasons: [] }], reason: 'test' });
  assert.deepEqual((await l.db.query(`select item from probe_row`)).rows, [], 'a forgotten item leaves every declared table');
});

test("a pack's after that fails is a warning, and the change stays applied", async () => {
  const l = await probed();
  const done = (await change(l, [task('Fails after')])) as { status: string; warnings: string[] };
  assert.equal(done.status, 'applied');
  assert.ok(done.warnings.some((w) => /what follows it failed: the probe failed after/.test(w)));
});

test('a pack hears a retype, and what it answers is made as the pack, through change', async () => {
  const l = await probed();
  await l.retype('ghost', 'task');
  assert.equal((await l.db.query(`select 1 from entity where title = 'Retyped ghost to task'`)).rows.length, 1);
});

test("a map no loader opened hears the internal packs' fillings too, from a loose host", async () => {
  const l = await freshWith(new Registry(dir), AUTO);
  await assert.rejects(change(l, [task('Forbidden')]), /"Forbidden" is not a title here/, "the probe's validator is heard");
});

test('mentions are the mentions pack: what names an item is projected by its log.project', async () => {
  const l = await freshWith(new Registry(packsWith()), AUTO);
  assert.ok(l.registry.internal.has('mentions'), 'an internal pack, always on');
  const a = ((await change(l, [task('Named')], human)) as { created: Record<string, string> }).created.t;
  const b = ((await change(l, [task('Names', { body: `Rests on ${a}` })], human)) as { created: Record<string, string> }).created.t;
  assert.deepEqual((await l.db.query(`select from_id, to_id from mention`)).rows, [{ from_id: b, to_id: a }]);
  await l.change(human, { ops: [{ op: 'update', id: b, body: 'Rests on nothing' }], reason: 'test' });
  assert.deepEqual((await l.db.query(`select 1 from mention`)).rows, [], 'read again when its note is written');
});
