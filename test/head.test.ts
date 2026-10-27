// An item is a small head and its fields (Rule 3): the row keeps id, kind, type, title, body, visibility and its
// times; status, owner, confidence and source are fields the kinds declare; every field is checked on write, and a
// large value is a system item's alone.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LARGE } from '../src/head.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { fresh, human, make } from './map.ts';

function packsWith(extra: PackFile): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-head-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  mkdirSync(join(dir, extra.id));
  writeFileSync(join(dir, extra.id, 'pack.json'), JSON.stringify(extra));
  return dir;
}
const pack = (types: PackFile['types']): PackFile => ({ id: 'x', version: '1', title: 'X', requires: ['core'], types });

test('the kinds declare status, owner, confidence and source; a flavour inherits them', async () => {
  const l = await fresh();
  const has = (type: string) => Object.keys(l.registry.type(type)!.columns).sort();
  for (const kind of l.registry.kinds()) assert.ok(kind.columns.status && kind.columns.source, `${kind.id} declares status and source`);
  assert.deepEqual(has('task'), ['confidence', 'owner', 'source', 'status']);
  assert.deepEqual(has('person'), ['confidence', 'source', 'status']);
  assert.deepEqual(has('lens'), ['source', 'status']);
  const task = l.registry.type('task')!;
  assert.deepEqual(task.columns.status!.values, [...task.statuses.open, ...task.statuses.closed]);
  assert.equal(l.registry.type('task')!.fields.owner, undefined, 'a column field is not a prop');
});

test('a pack cannot declare a head field, a column, or a large field on the work', () => {
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.t', extends: 'work', title: 'T', description: '', fields: { owner: { type: 'string' } } }]))), /field "owner" is one a kind declares/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.t', extends: 'work', title: 'T', description: '', fields: { due: { type: 'date', column: true } } }]))), /cannot be kept in a column/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.t', extends: 'work', title: 'T', description: '', fields: { blob: { type: 'json', large: true } } }]))), /only a type of the system kind/);
});

test('every item has its kind in its row: written with it, or filled by the database when a row comes without one', async () => {
  const l = await fresh();
  const { t, v } = await make(l, [
    { op: 'create', ref: 't', type: 'task', title: 'Pour the slab' },
    { op: 'create', ref: 'v', type: 'lens', title: 'Everything' },
  ]);
  assert.equal((await l.entity(t))!.kind, 'work');
  assert.equal((await l.entity(v))!.kind, 'system');
  // A row the app before this one writes has no kind: the database fills it from the type table.
  await l.db.query(`insert into entity (id, type, title, status, is_open) values ('e_oldapp01', 'decision', 'Which slab?', 'open', true)`);
  assert.equal((await l.entity('e_oldapp01'))!.kind, 'question');
});

test('an undeclared field, a head field its kind lacks, and a large value on the work are refused', async () => {
  const l = await fresh();
  const { t, b, p, s } = await make(l, [
    { op: 'create', ref: 't', type: 'task', title: 'Pour the slab' },
    { op: 'create', ref: 'b', type: 'bug', title: 'The slab cracks' },
    { op: 'create', ref: 'p', type: 'person', title: 'Sam' },
    { op: 'create', ref: 's', type: 'style', title: 'A drawing' },
  ]);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: t, props: { colour: 'red' } }] }), /task has no field "colour"/);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: p, owner: p }] }), /person has no field "owner"/);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'lens', title: 'Sure?', confidence: 0.5 }] }), /lens has no field "confidence"/);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: t, props: { owner: p } }] }), /task has no field "owner"/);
  const big = 'x'.repeat(LARGE + 1);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: b, props: { repro: big } }] }), /bug.repro is too large/);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'bug', title: 'Big', props: { repro: big } }] }), /too large/);
  // A system item's field declared large holds it.
  await make(l, [{ op: 'update', id: s, props: { code: `export default () => [] // ${big}` } }]);
  assert.equal(((await l.entity(s))!.props.code as string).length > LARGE, true);
  // And what the kind declares is set as before.
  await make(l, [{ op: 'update', id: t, owner: p, confidence: 0.8, status: 'doing' }]);
  const after = (await l.entity(t))!;
  assert.deepEqual([after.owner, after.confidence, after.status], [p, 0.8, 'doing']);
});
