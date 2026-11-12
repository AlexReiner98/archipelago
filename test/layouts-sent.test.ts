// What a picture is sent (src/layouts.ts, src/query-steps.ts): the drawing its shape is drawn by, once, the owner's
// version standing in for the pack's module by module; and its steps, checked, naming only what it shows. No browser:
// how drawings draw is test/layouts.test.ts and the files beside it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readSteps, stepsShown } from '../packs/query/kernel/query-steps.ts';
import * as querySavedPack from '../packs/lenses/kernel/query-saved.ts';
import { fresh, make } from './map.ts';
import { serve } from './serve.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

/** A small system on the map, its picture kept as a view drawn as a map, and a style about it saying so. */
async function system(call: (path: string, token?: string, body?: unknown) => Promise<any>) {
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [
    // Core's types alone: a new workspace on this server is an island map, where only the shared set is taken.
    { op: 'create', ref: 'p', type: 'work', title: 'A system' },
    { op: 'create', ref: 'a', type: 'task', title: 'Doors' },
    { op: 'create', ref: 'b', type: 'task', title: 'Store' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
  ] })).result.created as Record<string, string>;
  const kept = await call('/api/change', undefined, { reason: 'test', ops: [
    { op: 'create', ref: 's', type: 'style', title: 'As a map', status: 'current', props: { shape: 'map' } },
    { op: 'link', type: 'about', from: 's', to: made.p },
  ] });
  return { ...made, ...kept.result.created } as Record<string, string>;
}

const shipped = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs', 'canvas', 'pack.json'), 'utf8')).layouts.find((d: { id: string }) => d.id === 'core.map');

test('a picture is sent the drawing its shape is drawn by, once, and the owner’s version stands in module by module', async () => {
  const { call } = await serve('off');
  const { s } = await system(call);
  const first = (await call('/api/view', undefined, { name: 'style', params: { style: s, have: [] } })).result.style.drawing;
  assert.equal(first.id, 'core.map');
  assert.deepEqual(Object.keys(first.modules).sort(), Object.keys(shipped.modules).sort());
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  // A page that has it is sent only its name.
  const again = (await call('/api/view', undefined, { name: 'style', params: { style: s, have: [first.hash] } })).result.style.drawing;
  assert.deepEqual(again, { id: 'core.map', title: 'Map', shape: 'map', hash: first.hash });
  // With nothing kept for it, and with a layout retired on 9 Nov 2026, a picture is drawn as the map.
  const holding = (await call('/api/view', undefined, { name: 'style', params: { have: [] } })).result.style;
  assert.equal(holding.drawing.id, 'core.map');
  const retired = (await call('/api/view', undefined, { name: 'style', params: { shape: 'architecture', have: [first.hash] } })).result.style;
  assert.deepEqual([retired.shape, retired.drawing.id], ['map', 'core.map']);

  // The owner's version changes one module; the rest are the pack's.
  const look = 'export const css = `.lf-step { cursor: help; }`;\n';
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'layout', title: 'Map, mine', props: { preset: 'core.map', modules: { 'look.js': look } } }] });
  const mine = (await call('/api/view', undefined, { name: 'style', params: { style: s, have: [first.hash] } })).result.style.drawing;
  assert.notEqual(mine.hash, first.hash);
  assert.equal(mine.modules['look.js'], look);
  assert.equal(mine.modules['index.js'], first.modules['index.js']);

  // An agent's version waits for the human: it is code that runs in whoever looks.
  const asked = await call('/agent/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'layout', title: 'Map, the agent’s', props: { modules: { 'look.js': look } } }] });
  assert.equal(asked.result.status, 'proposed');
  // Unless the owner lets agents change drawings here: it runs in the sandbox either way.
  assert.equal((await call('/api/workspace_set', undefined, { agent_code: true, agent_changes: 'apply' })).result.agent_code, true);
  const made = await call('/agent/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'layout', title: 'Map, the agent’s again', props: { modules: { 'look.js': look } } }] });
  assert.equal(made.result.status, 'applied');
  // What else is held is held still: a change to what anyone sees is the human's.
  const doc = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'd', type: 'shared_document', title: 'About it' }] })).result.created.d;
  const shown = await call('/agent/change', undefined, { reason: 'test', ops: [{ op: 'update', id: doc, visibility: 'public' }] });
  assert.equal(shown.result.status, 'proposed');
});

test('a picture with steps is sent them, and the finished parts they name, whatever it leaves out', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'A system' },
    { op: 'create', ref: 'a', type: 'place', title: 'Doors', status: 'available' },
    { op: 'create', ref: 'o', type: 'place', title: 'Old backups', status: 'retired' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'o', to: 'p' },
    { op: 'link', type: 'uses', from: 'a', to: 'o' },
  ]);
  const steps = [{ chapter: { name: 'Then', when: '7 Oct', count: 1 }, add: [made.a, made.o], titles: { [made.a]: 'Old doors' }, lines: [{ by: 'Alex', text: 'Back it up.' }] }, { remove: [made.o], lines: [{ by: 'Agent', text: 'It is gone.' }] }];
  Object.assign(made, await make(l, [{ op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', props: { filter: { find: [`part_of ${made.p}`], not: ['done', 'kind system'] }, steps } }]));
  const answer = await querySavedPack.keptPicture(kernelContext(l, 'lenses'), made.l);
  assert.deepEqual(answer.steps, steps);
  assert.ok(answer.items.some((i) => i.id === made.o && !i.open), 'the retired part is sent');
  assert.ok(answer.links.some((k) => k.from === made.a && k.to === made.o), 'and its wire');
  // Steps that cannot be read are not played, and the picture says why beside them.
  await make(l, [{ op: 'update', id: made.l, props: { steps: [{ add: 'all of it' }] } }]);
  const wrong = await querySavedPack.keptPicture(kernelContext(l, 'lenses'), made.l);
  assert.equal(wrong.steps, undefined);
  assert.match(wrong.steps_wrong ?? '', /add and remove are lists of ids/);
});

test('a published picture keeps its steps, naming only what it shows', () => {
  const steps = [{ add: ['e_shown000', 'e_hidden00'], titles: { e_shown000: 'Then', e_hidden00: 'Secret' }, flag: { e_hidden00: 'US' }, lit: [['e_shown000', 'e_hidden00'], ['e_shown000', 'e_shown001']] as [string, string][], lines: [{ by: 'Alex', text: 'Hello.' }] }];
  assert.deepEqual(stepsShown(steps, new Set(['e_shown000', 'e_shown001'])), [{ add: ['e_shown000'], titles: { e_shown000: 'Then' }, flag: {}, lit: [['e_shown000', 'e_shown001']], lines: [{ by: 'Alex', text: 'Hello.' }] }]);
});

test('steps keep a look and a pace, checked, and a reader is sent only what a step is known to say', () => {
  assert.throws(() => readSteps([{ look: 'Islands!' }]), /a look is named/);
  assert.throws(() => readSteps([{ quick: 'yes' }]), /quick is true or false/);
  assert.equal(readSteps([{ look: 'islands', quick: true }, { look: null }]).length, 2);
  assert.deepEqual(stepsShown([{ look: 'islands', quick: true, lines: [{ by: 'Agent', text: 'Hi.', secret: 1 } as any], kept: 'no' } as any], new Set()), [{ look: 'islands', quick: true, lines: [{ by: 'Agent', text: 'Hi.' }] }]);
});

test('a card is what a story ends on: a name of a few words and a line, sent to readers as it is kept', () => {
  assert.throws(() => readSteps([{ card: { text: 'No name' } }]), /a card has a title/);
  assert.throws(() => readSteps([{ card: { title: 'x'.repeat(61) } }]), /a card has a title/);
  const steps = [{ card: { title: 'Archipelago', text: 'Knowledge is power.' } }];
  assert.deepEqual(stepsShown(readSteps(steps), new Set()), steps);
});
