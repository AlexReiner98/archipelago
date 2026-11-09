// A finding (task e_ucehdn89): a name, a description, a value of one simple type checked on write, its confidence and
// as of. A reader reads it with a reads link, the one link that may cross between islands (crosses), so a later step
// can tell its readers when it moves. A new value keeps the old one in the log.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { islandProblems, sharedOf } from '../src/islands.ts';
import { readManifest, type Manifest } from '../src/manifest.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, human, make, PACKS } from './map.ts';

const refused = async (l: Awaited<ReturnType<typeof fresh>>, ops: object[], says: RegExp) =>
  assert.rejects(l.change(human, { ops: ops as never, reason: 'test' }), says);

test('a finding holds a value of the type it says, checked on write', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 't', type: 'finding', title: 'Beta ships', body: 'The day the beta ships.', confidence: 0.8, props: { value: '2027-01-15', value_type: 'date', as_of: '2026-11-05' } },
    { op: 'create', ref: 'n', type: 'finding', title: 'Hosting a month', body: 'In US dollars.', props: { value: 400, value_type: 'number', as_of: '2026-11-04' } },
    { op: 'create', ref: 'b', type: 'finding', title: 'Signups open', props: { value: false, value_type: 'boolean' } },
    { op: 'create', ref: 's', type: 'finding', title: 'Host', props: { value: 'Fly', value_type: 'text' } },
  ]);
  const beta = await l.entity(made.t);
  assert.equal(beta?.props.value, '2027-01-15');
  assert.equal(beta?.confidence, 0.8);
  await refused(l, [{ op: 'create', type: 'finding', title: 'Cost', props: { value: 'four hundred', value_type: 'number' } }], /finding\.value is said to be number \(value_type\), and must be a number/);
  await refused(l, [{ op: 'create', type: 'finding', title: 'Day', props: { value: '15 Jan', value_type: 'date' } }], /must be a date/);
  await refused(l, [{ op: 'create', type: 'finding', title: 'Odd', props: { value: 3 } }], /finding\.value needs value_type, one of: text, number, boolean, date/);
  await refused(l, [{ op: 'create', type: 'finding', title: 'Odd', props: { value: 3, value_type: 'money' } }], /value_type must be one of: text, number, boolean, date/);
  // An update is checked with what the finding holds: a new type alone must fit the value it has.
  await refused(l, [{ op: 'update', id: made.n, props: { value_type: 'date' } }], /said to be date/);
  await refused(l, [{ op: 'update', id: made.n, props: { value: 'a lot' } }], /said to be number/);
  await make(l, [{ op: 'update', id: made.n, props: { value: 'four hundred', value_type: 'text' } }]);
});

test('a new value keeps the old one in the log', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'n', type: 'finding', title: 'Hosting a month', props: { value: 400, value_type: 'number', as_of: '2026-11-04' } }]);
  await make(l, [{ op: 'update', id: made.n, props: { value: 450, as_of: '2026-11-05' } }]);
  assert.equal((await l.entity(made.n))?.props.value, 450);
  const said = JSON.stringify(await callTool(l, human, 'events', { target: made.n, full: true }));
  assert.match(said, /400/, 'the old value is in the log');
  assert.match(said, /450/);
});

test('a reader reads a finding; reads points at a finding only, and crosses', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'f', type: 'finding', title: 'Hosting a month', props: { value: 400, value_type: 'number' } },
    { op: 'create', ref: 'budget', type: 'task', title: 'Set the budget' },
    { op: 'create', ref: 'note', type: 'note', title: 'Costs' },
    { op: 'link', type: 'reads', from: 'budget', to: 'f' },
  ]);
  const read = await l.change(agent, { ops: [{ op: 'link', type: 'reads', from: made.note, to: made.f }], reason: 'test' });
  assert.notEqual(read.status, 'refused');
  await refused(l, [{ op: 'link', type: 'reads', from: made.f, to: made.budget }], /"reads" must point to finding/);
  const reads = l.registry.relations.get('reads');
  assert.equal(reads?.crosses, true, 'the islands let it cross');
  assert.ok(!l.registry.relations.get('uses')?.crosses, 'what it extends does not');
});

test('a finding is in the shared set: a pack on an island map may build on it', () => {
  const core = readManifest(readFileSync(join(PACKS, 'core', 'pack.json'), 'utf8'), 'core');
  const shared = sharedOf([core]);
  assert.ok(shared.types.has('finding'));
  assert.ok(shared.links.has('reads'));
  const pack: Manifest = {
    id: 'finance', version: '1', title: 'Finance', requires: ['core'],
    types: [{ id: 'cost_line', title: 'Cost line', description: 'A cost from a date.', extends: 'finding' } as never],
    links: [{ id: 'counts', extends: 'reads', title: 'counts', inverse: 'is counted by', from: ['*'], to: ['finding'], description: 'Counts it in a budget.' }],
  } as Manifest;
  assert.deepEqual(islandProblems(pack, shared), []);
});

test('a field typed by another is json, typed by an enum of its own type', async () => {
  const { checkFieldDecls } = await import('../src/head.ts');
  const type = { system: false } as never;
  assert.deepEqual(checkFieldDecls(type, { id: 'x', title: 'X', description: '', extends: 'record', fields: { v: { type: 'json', typed_by: 't' }, t: { type: 'enum', values: ['text'] } } }), []);
  assert.match(checkFieldDecls(type, { id: 'x', title: 'X', description: '', extends: 'record', fields: { v: { type: 'string', typed_by: 't' }, t: { type: 'enum', values: ['text'] } } }).join(), /typed by "t"/);
  assert.match(checkFieldDecls(type, { id: 'x', title: 'X', description: '', extends: 'record', fields: { v: { type: 'json', typed_by: 'nope' } } }).join(), /typed by "nope"/);
});
