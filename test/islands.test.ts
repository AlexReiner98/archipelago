// Packs on an island map (src/islands.ts, decisions e_pp5mu6xd and e_rf6q3q34): with the workspace setting on, a pack
// is taken only if its file holds vocabulary, views and instructions and it builds on the shared set alone. Off is the
// default, and with it off every pack is taken as before.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { islandProblems, packKind, sharedOf } from '../src/islands.ts';
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
  assert.equal(packKind(island('fine'), shared), 'island');
  const said = (m: Manifest) => islandProblems(m, shared).join('; ');
  assert.match(said(island('w', { requires: ['core', 'fine'] })), /requires fine/);
  assert.match(said(island('o', { types: [ADDS] })), /adds fields to person/);
  assert.match(said(island('n', { types: [{ id: 'n_memo', title: 'Memo', extends: 'fine_thing' } as never] })), /names fine_thing, not its own nor in the shared set/);
  assert.match(said(island('l', { links: [{ id: 'l_r', extends: 'fine_answers', title: 'r', inverse: 'r', from: ['*'], to: ['*'], description: '' }] })), /extend another pack's \(l_r extends fine_answers\)/);
  assert.deepEqual(islandProblems(core(), shared), [], 'the kernel’s own pack is not judged');
  assert.equal(packKind(core(), shared), 'kernel');
});

test('a pack is an island pack by what it speaks: a type on an island, a link type, or fields on another’s type', () => {
  const shared = sharedOf([core()]);
  const bare = (id: string, more: Partial<Manifest>): Manifest => ({ id, version: '1', title: id, requires: ['core'], ...more });
  assert.equal(packKind(bare('t', { types: [{ id: 't_memo', title: 'Memo', extends: 'record' } as never] }), shared), 'island');
  assert.equal(packKind(bare('k', { links: [{ id: 'k_r', title: 'r', inverse: 'r', from: ['*'], to: ['*'], description: '' }] }), shared), 'island');
  assert.equal(packKind(bare('f', { types: [ADDS] }), shared), 'island');
  assert.equal(packKind(bare('b', { types: [{ id: 'b_bot', title: 'Bot', extends: 'person' } as never] }), shared), 'map', 'an actor lives on no island');
});

test('a map pack: looks, layouts or code, taken whatever it holds', () => {
  const shared = sharedOf([core()]);
  const map = (id: string, more: Partial<Manifest>): Manifest => ({ id, version: '1', title: id, requires: ['core'], ...more });
  const shapes: Record<string, Partial<Manifest>> = {
    looks: { styles: [{ id: 'looks.colours', title: 'Colours', props: {} }] },
    layout: { layouts: [{ shape: 'meters', title: 'Meters', code: 'export default () => []' } as never] },
    code: { handlers: [HANDLER], actions: [], views: [{ id: 'code.sums', shape: 'data' } as never], uses: ['time'], reach: {} },
    reader: { requires: ['core', 'fine'], styles: [{ id: 'reader.lens', type: 'lens', title: 'Fine things', props: { filter: { find: ['fine_thing'] } } }] },
  };
  for (const [id, more] of Object.entries(shapes)) {
    assert.equal(packKind(map(id, more), shared), 'map', id);
    assert.deepEqual(islandProblems(map(id, more), shared), [], id);
  }
});

test('a pack that is both is refused, told to split, naming both parts', () => {
  const shared = sharedOf([core()]);
  const said = (m: Manifest) => islandProblems(m, shared).join('; ');
  const both = said(island('mixed', { handlers: [HANDLER], styles: [{ id: 'mixed.colours', title: 'Colours', props: {} }] }));
  assert.match(both, /both an island pack \(types mixed_thing; links mixed_answers\) and a map pack \(handlers, looks \(mixed\.colours\)\)/);
  assert.match(both, /split it into an island pack/);
  assert.match(said(island('a', { actions: [], reach: {}, layouts: [] })), /map pack \(actions, reach, layouts\)/);
  assert.match(said(island('u', { uses: ['time'] })), /map pack \(uses\)/);
  assert.match(said(island('v', { views: [{ id: 'v.sums', shape: 'data' } as never] })), /views its code computes \(v\.sums\)/);
  assert.match(said(island('w', { requires: ['core', 'fine'] })), /map pack \(requires fine\)/);
});

test('a pack with a handler is refused on an island map and taken without it', () => {
  const reader: Manifest = { id: 'reader2', version: '1', title: 'Reader', requires: ['core', 'plain'], handlers: [HANDLER], styles: [{ id: 'reader2.colours', title: 'Colours', props: {} }] };
  const dir = packsWith(island('hooked', { handlers: [HANDLER] }), island('plain'), island('onwork', { requires: ['core', 'plain'] }), island('adds', { types: [ADDS] }), reader);
  const reg = new Registry(dir);
  for (const id of ['hooked', 'plain', 'onwork', 'adds']) assert.equal(reg.states.get(id)?.state, 'active', `${id}, setting off`);
  reg.turnOff([], true);
  assert.equal(reg.states.get('plain')?.state, 'active');
  assert.equal(reg.states.get('reader2')?.state, 'active', 'a map pack requiring an island pack is taken');
  const kinds = Object.fromEntries(reg.describe().packs.map((p) => [p.id, p.kind]));
  assert.deepEqual([kinds.core, kinds.plain, kinds.reader2], ['kernel', 'island', 'map'], 'the schema marks each pack’s kind');
  assert.ok(reg.types.has('plain_thing') && reg.relations.has('plain_answers'));
  const why = (id: string) => (assert.equal(reg.states.get(id)?.state, 'off', id), reg.states.get(id)!.why!);
  assert.match(why('hooked'), /map pack \(handlers\): split it/);
  assert.match(why('onwork'), /requires plain/);
  assert.match(why('adds'), /adds fields to person/);
  assert.ok(!reg.types.has('hooked_thing'), 'a refused pack registers nothing');
  reg.turnOff([], false);
  assert.equal(reg.states.get('hooked')?.state, 'active', 'off again, it is taken as before');
});

test('core declares the shared set, so a pack on task and decision is taken beside one that is not', () => {
  const on = { types: [{ id: 'ontask_step', title: 'Step', extends: 'task' } as never, { id: 'ontask_call', title: 'Call', extends: 'decision' } as never] };
  const looks = { styles: [{ id: 'looks.colours', title: 'Colours', props: {} }], types: [{ id: 'looks_memo', title: 'Memo', extends: 'record' } as never] }; // both kinds
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

test('the island rules are the owner’s to set, and a map with work moves onto islands unless a pack would go dormant', async () => {
  const reg = new Registry(packsWith(island('plain'), island('hooked', { handlers: [HANDLER] })));
  const l = new Archipelago(await openDb(), reg);
  await syncTypes(l);
  assert.equal(await islandsOn(l), false, 'off unless set');
  await assert.rejects(setIslands(l, { kind: 'agent', name: 'a' } as never, true), /the owner’s/);
  await setIslands(l, human, true);
  assert.equal(await islandsOn(l), true);
  assert.equal(reg.states.get('hooked')?.state, 'off');
  // One way (the owner, 10 Nov 2026): the owner cannot turn them off again; only the system makes a plain map.
  await assert.rejects(setIslands(l, human, false), /cannot be turned off/);
  assert.equal(await islandsOn(l), true);
  await setIslands(l, 'system', false);
  assert.equal(reg.states.get('hooked')?.state, 'active');

  // Work of a pack the rules would switch off: refused, and nothing changes.
  const hooked = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'h', type: 'hooked_thing', title: 'A hooked thing' }] }) as any).created.h;
  await assert.rejects(setIslands(l, human, true), /switch off the pack hooked/);
  assert.equal(await islandsOn(l), false);
  await l.change(human, { reason: 'test', ops: [{ op: 'archive', id: hooked }] });

  // Work of packs that keep the rules: moved onto an island speaking their pack, in one change.
  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'plain_thing', title: 'A thing' }, { op: 'create', ref: 'b', type: 'task', title: 'A task' }, { op: 'link', type: 'depends_on', from: 'b', to: 'a' }] }) as any).created;
  await setIslands(l, human, true);
  assert.equal(await islandsOn(l), true);
  const [a, b] = [await l.entity(made.a), await l.entity(made.b)];
  assert.ok(a?.props.island && a.props.island === b?.props.island, 'both on one island, the shared task with the pack’s thing');
  assert.equal((await l.entity(String(a!.props.island)))?.props.pack, 'plain');

  // A new item naming none goes on the one it fits; with two, it is asked where.
  const lone = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'task', title: 'Placed' }] }) as any).created.c;
  assert.equal((await l.entity(lone))?.props.island, a!.props.island);
  await l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'island', title: 'Another', props: { pack: 'core' } }] });
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Nowhere' }] }), new RegExp(`name it in props.island, such as ${a!.props.island}`));
});
