// What a pack reads of a type it does not own, checked by shape (task e_f9x7ddeh, decision e_f9ybsuce): a field, a
// status or a phase, named in requires as field:<f>@<type>, status:<s>@<type>, phase:<p>@<type>. The type as its
// provider declares it may have more, never less: a pack whose need the map's provider lacks waits, and an island may
// not run a version that drops what an active pack needs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readManifest } from '../src/manifest.ts';
import { orderPacks, providersOf } from '../src/packorder.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { setIslands } from '../src/packstate.ts';
import { freshWith, human, make, packsWith, PACKS } from './map.ts';

const THING = { id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' };
/** An island pack whose type has a due date. */
const plain = {
  id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try needs with.', requires: ['core'],
  types: [{ ...THING, fields: { due: { type: 'date', description: 'When it is due.' } } }],
};
/** A map pack (it owns no type) that reads plain's due date and its finished things. */
const reader: PackFile = { id: 'duereader', version: '0.1.0', title: 'Reader', requires: ['type:plain.thing', 'field:due@plain.thing', 'phase:finished@plain.thing', 'status:done@plain.thing'] };

test('a field, status or phase is provided by the type that has it, more being fine', () => {
  const reg = new Registry(packsWith(plain as PackFile));
  const all = [...reg.found];
  assert.deepEqual(providersOf('field:due@plain.thing', all), ['plain']);
  assert.deepEqual(providersOf('field:status@plain.thing', all), ['plain'], 'the head every type has');
  assert.deepEqual(providersOf('phase:finished@plain.thing', all), ['plain'], 'a status inherited from work');
  assert.deepEqual(providersOf('field:size@plain.thing', all), []);
  assert.deepEqual(providersOf('status:nowhere@plain.thing', all), []);
  const adder: PackFile = { id: 'adder', version: '0.1.0', title: 'Adder', requires: ['type:plain.thing'], types: [{ of: 'plain.thing', fields: { size: { type: 'number', description: 'How big.' } } }] };
  assert.deepEqual(providersOf('field:size@plain.thing', [...all, adder]), ['adder'], 'a field another pack adds is that pack’s');
});

test('a pack reading a field its provider lacks waits, saying what the type lacks', () => {
  const reg = new Registry(packsWith(plain as PackFile, reader));
  assert.equal(reg.states.get('duereader')!.state, 'active', 'every need met');
  const found = new Map(reg.found.map((p) => [p.id, p]));
  found.set('wants', { id: 'wants', version: '0.1.0', title: 'Wants', requires: ['field:size@plain.thing'] });
  const { states } = orderPacks(found, new Map(), 'local');
  assert.deepEqual(states.get('wants'), { state: 'waiting', why: 'needs field:size@plain.thing: plain.thing as plain declares it has no field size' });
  found.set('nobody', { id: 'nobody', version: '0.1.0', title: 'Nobody', requires: ['status:done@nowhere'] });
  assert.deepEqual(orderPacks(found, new Map(), 'local').states.get('nobody'), { state: 'waiting', why: 'needs status:done@nowhere: no pack here declares nowhere' });
});

test('a need names its type: <what>@<type> for field, status and phase alone', () => {
  const read = (requires: unknown) => readManifest(JSON.stringify({ id: 'p', version: '0.1.0', title: 'P', requires }), 'test');
  assert.doesNotThrow(() => read(['field:due@task', 'status:done@task', 'phase:finished@plain.thing']));
  assert.throws(() => read(['field:due']), /field:<field>@<type>/);
  assert.throws(() => read(['type:task@core']), /a name is/);
});

test('a version may add fields, and pinning one that drops what a pack needs is refused, naming it', async () => {
  const l = await freshWith(new Registry(packsWith(plain as PackFile, reader)));
  await setIslands(l, human, true);
  assert.equal(l.registry.states.get('duereader')!.state, 'active');
  const version = (ref: string, fields: Record<string, unknown>) => ({ op: 'create' as const, ref, type: 'pack', title: `Plain ${ref}`, props: { version_of: 'plain', version: '1.1.0', manifest: { types: [{ ...THING, fields }] } } });
  const { trial, wider, narrower } = await make(l, [
    { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'plain' } },
    version('wider', { due: { type: 'date', description: 'When it is due.' }, why: { type: 'string', description: 'Why it is so.' } }),
    version('narrower', { why: { type: 'string', description: 'Why it is so.' } }),
  ]);

  await make(l, [{ op: 'update', id: trial, props: { pack_version: wider } }]);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: trial, props: { pack_version: narrower } }] }),
    /drops what a pack here needs: duereader needs field:due@plain\.thing: plain\.thing as plain declares it has no field due/);
  assert.equal((await l.entity(trial))?.props.pack_version, wider, 'the island keeps the version it ran');
  assert.ok(new Registry(PACKS).found.length, 'the shipped packs still load');
});
