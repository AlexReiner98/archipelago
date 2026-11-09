// Packs on an island map (src/islands.ts, decisions e_pp5mu6xd and e_rf6q3q34): with the workspace setting on, a pack
// is taken only if its file holds vocabulary, views and instructions and it builds on the shared set alone. Off is the
// default, and with it off every pack is taken as before.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { islandProblems, sharedOf } from '../src/islands.ts';
import { readManifest, type Manifest } from '../src/manifest.ts';
import { Registry } from '../src/packs.ts';
import { islandsOn, setIslands } from '../src/packstate.ts';
import { Archipelago } from '../src/pelago.ts';
import { syncTypes } from '../src/typetable.ts';
import { human, packsWith } from './map.ts';

const ROOT = join(import.meta.dirname, '..');
const HANDLER = { schedule: 'tick', every_minutes: 60 };
const ADDS = { of: 'person', fields: { rate: { type: 'number' } } } as never;

/** A pack of the island shape: a type of its own on a starter, a link from it to the shared set, a view and an instruction. */
const island = (id: string, more: Partial<Manifest> = {}): Manifest => ({
  id, version: '1', title: id, requires: ['core'],
  types: [{ id: `${id}_thing`, title: 'Thing', extends: 'work' } as never, ...(more.types ?? [])],
  links: [{ id: `${id}_answers`, extends: 'bears_on', title: 'answers', inverse: 'is answered by', from: [`${id}_thing`], to: ['question'], description: 'It helps answer the question.' }, ...(more.links ?? [])],
  styles: [
    { id: `${id}.tending`, type: 'instruction', title: 'Tending', body: 'Keep things true.', props: {} },
    { id: `${id}.things`, type: 'lens', title: 'Things', props: { filter: { find: [`${id}_thing`] } } },
    ...(more.styles ?? []),
  ],
  ...Object.fromEntries(Object.entries(more).filter(([k]) => !['types', 'links', 'styles'].includes(k))),
});

/** The packs, with more beside them. */
const core = () => readManifest(readFileSync(join(ROOT, 'packs', 'core', 'pack.json'), 'utf8'), 'core');

test('the shared set is core’s list: the eight starter types, task, decision and finding', () => {
  const shared = sharedOf([core()]);
  assert.deepEqual([...shared.types].sort(), ['actor', 'aim', 'decision', 'finding', 'occurrence', 'place', 'question', 'record', 'system', 'task', 'work']);
  assert.ok(!shared.types.has('person'), 'a flavour core does not list is not shared');
  assert.ok(shared.links.has('bears_on') && shared.links.has('depends_on'), 'the kernel’s link types are what a link extends');
  assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', shared: ['task'] }), 'x'), /only the kernel's pack declares it/);
});

test('an island pack: vocabulary, views and instructions on the shared set', () => {
  const shared = sharedOf([core()]);
  assert.deepEqual(islandProblems(island('fine'), shared), []);
  const said = (m: Manifest) => islandProblems(m, shared).join('; ');
  assert.match(said(island('h', { handlers: [HANDLER] })), /holds handlers/);
  assert.match(said(island('a', { actions: [], reach: {}, layouts: [] })), /holds actions, reach, layouts/);
  assert.match(said(island('s', { styles: [{ id: 's.colours', title: 'Colours', props: {} }] })), /styles holds looks \(s\.colours\)/);
  assert.match(said(island('u', { uses: ['time'] })), /holds uses/);
  assert.match(said(island('v', { views: [{ id: 'v.sums', shape: 'data' } as never] })), /views holds reads its code computes \(v\.sums\)/);
  assert.match(said(island('w', { requires: ['core', 'fine'] })), /requires fine: a pack builds on the shared set alone/);
  assert.match(said(island('o', { types: [ADDS] })), /adds fields to person/);
  assert.match(said(island('n', { types: [{ id: 'n_memo', title: 'Memo', extends: 'fine_thing' } as never] })), /names fine_thing, not its own nor in the shared set/);
  assert.match(said(island('l', { links: [{ id: 'l_r', extends: 'fine_answers', title: 'r', inverse: 'r', from: ['*'], to: ['*'], description: '' }] })), /extend another pack's \(l_r extends fine_answers\)/);
  assert.deepEqual(islandProblems(core(), shared), [], 'the kernel’s own pack is not judged');
});

test('a pack with a handler is refused on an island map and taken without it', () => {
  const dir = packsWith(island('hooked', { handlers: [HANDLER] }), island('plain'), island('onwork', { requires: ['core', 'plain'] }), island('adds', { types: [ADDS] }));
  const reg = new Registry(dir);
  for (const id of ['hooked', 'plain', 'onwork', 'adds']) assert.equal(reg.states.get(id)?.state, 'active', `${id}, setting off`);
  reg.turnOff([], true);
  assert.equal(reg.states.get('plain')?.state, 'active');
  assert.ok(reg.types.has('plain_thing') && reg.relations.has('plain_answers'));
  const why = (id: string) => (assert.equal(reg.states.get(id)?.state, 'off', id), reg.states.get(id)!.why!);
  assert.match(why('hooked'), /holds handlers/);
  assert.match(why('onwork'), /requires plain/);
  assert.match(why('adds'), /adds fields to person/);
  assert.ok(!reg.types.has('hooked_thing'), 'a refused pack registers nothing');
  reg.turnOff([], false);
  assert.equal(reg.states.get('hooked')?.state, 'active', 'off again, it is taken as before');
});

test('core declares the shared set, so a pack on task and decision is taken beside one that is not', () => {
  const on = { types: [{ id: 'ontask_step', title: 'Step', extends: 'task' } as never, { id: 'ontask_call', title: 'Call', extends: 'decision' } as never] };
  const looks = { styles: [{ id: 'looks.colours', title: 'Colours', props: {} }], types: [{ id: 'looks_memo', title: 'Memo', extends: 'record' } as never] };
  const reg = new Registry(packsWith(island('ontask', on), island('looks', looks)));
  for (const id of ['task', 'decision', 'question']) assert.equal(reg.type(id)!.pack, 'core', `${id} is core’s`);
  reg.turnOff([], true);
  assert.equal(reg.states.get('looks')?.state, 'off', 'a pack that carries looks is not taken');
  assert.equal(reg.states.get('ontask')?.state, 'active');
  assert.ok(reg.types.has('task') && reg.types.has('decision') && reg.types.has('ontask_step'), 'task and decision stay with it off');
  assert.ok(!reg.types.has('looks_memo'), 'its own types go with it');
  const without = { ...core(), types: core().types!.filter((t) => (t as { id?: string }).id !== 'decision') };
  assert.throws(() => readManifest(JSON.stringify(without), 'core'), /shared names decision: the shared set is of the types this pack declares/);
});

test('the island rules are set on a new workspace only, by the owner', async () => {
  const reg = new Registry(packsWith(island('plain'), island('hooked', { handlers: [HANDLER] })));
  const l = new Archipelago(await openDb(), reg);
  await syncTypes(l);
  assert.equal(await islandsOn(l), false, 'off unless set');
  await assert.rejects(setIslands(l, { kind: 'agent', name: 'a' } as never, true), /the owner’s/);
  await setIslands(l, human, true);
  assert.equal(await islandsOn(l), true);
  assert.equal(reg.states.get('hooked')?.state, 'off');
  await setIslands(l, human, false);
  assert.equal(reg.states.get('hooked')?.state, 'active');
  await l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'plain_thing', title: 'A thing' }] });
  await assert.rejects(setIslands(l, human, true), /already has items/);
  assert.equal(await islandsOn(l), false);
});
