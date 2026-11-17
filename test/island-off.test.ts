// A pack turned off on one island (packs/loader/kernel/island-off.ts, task e_hr4qvr9u), its items waiting there
// (task e_punbd5dg, decision e_57bjxy2x), and what the island answer declares (packs/loader/kernel/island-decl.ts,
// task e_ter3cwup): an island names the packs it has off in packs_off; its registry runs without them, so what relies
// on them waits there, their items stay and are edited, and no new one is made there. The rest of the map keeps them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glyphOf } from '../packs/loader/kernel/island-decl.ts';
import { offFacts } from '../packs/loader/kernel/island-off.ts';
import { islandRegistry } from '../packs/loader/kernel/island-pin.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import type { Archipelago, Op } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import * as queryFlatPack from '../packs/query/kernel/query-flat.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

/** An island pack, and one that requires it by a capability its type has. */
const plain = {
  id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to turn off.', requires: ['core'],
  types: [{ id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work', fields: { addr: { type: 'url' as const, description: 'Where it answers.' } }, capabilities: { watch: { field: 'addr', up: 'doing', down: 'todo' } } }],
};
const extra = {
  id: 'extra', version: '1.0.0', title: 'Extra', description: 'Relies on plain.', requires: ['core', 'has:watch'],
  types: [{ id: 'extra.note', title: 'Note', description: 'A note.', extends: 'work' }],
};

async function map() {
  const l = await freshWith(new Registry(packsWith(plain, extra)));
  await setIslands(l, human, true);
  const made = await make(l, [
    { op: 'create', ref: 'here', type: 'island', title: 'Here', props: { pack: 'plain' } },
    { op: 'create', ref: 'there', type: 'island', title: 'There', props: { pack: 'plain' } },
    { op: 'create', ref: 'notes', type: 'island', title: 'Notes', props: { pack: 'extra' } },
  ]);
  const items = await make(l, [
    { op: 'create', ref: 'a', type: 'plain.thing', title: 'A thing here', props: { island: made.here } },
    { op: 'create', ref: 'b', type: 'plain.thing', title: 'A thing there', props: { island: made.there } },
    { op: 'create', ref: 't', type: 'task', title: 'A shared task here', props: { island: made.here } },
    { op: 'create', ref: 'n', type: 'extra.note', title: 'A note', props: { island: made.notes } },
  ]);
  return { l, ...made, ...items } as { l: Archipelago } & Record<string, string>;
}

const refused = (l: Archipelago, ops: Op[], said: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), said);
const flat = (l: Archipelago, island: string) => queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${island}`] } }) as Promise<any>;

test('a pack turned off on one island: its items there wait and stay editable, no new one is made there, the rest keep it', async () => {
  const { l, here, there, a, b } = await map();
  await make(l, [{ op: 'update', id: here, props: { packs_off: ['plain'] } }]);
  const run = await islandRegistry(l, here);
  assert.equal(run.states.get('plain')?.state, 'off');
  assert.equal(run.states.get('plain')?.why, 'turned off on this island');
  assert.equal(run.type('plain.thing')?.dormant, true, 'its types are kept dormant there');
  assert.equal(l.registry.states.get('plain')?.state, 'active', 'the map keeps it');
  assert.equal((await islandRegistry(l, there)).states.get('plain')?.state, 'active', 'and so does every other island');

  await make(l, [{ op: 'update', id: a, title: 'A thing here, edited', status: 'done' }]);
  assert.equal((await l.entity(a))!.title, 'A thing here, edited', 'an item that waits is still edited');
  await refused(l, [{ op: 'create', type: 'plain.thing', title: 'New here', props: { island: here } }], /plain\.thing waits on this island: its pack plain is off here \(turned off on this island\)/);
  await make(l, [{ op: 'create', type: 'plain.thing', title: 'New there', props: { island: there } }]);
  await make(l, [{ op: 'create', type: 'task', title: 'A shared type is made here', props: { island: here } }]);
  assert.ok(b);

  // Turned back on, the island runs the map's pack again.
  await make(l, [{ op: 'update', id: here, props: { packs_off: [] } }]);
  assert.equal(await islandRegistry(l, here), l.registry, 'with nothing off, the island runs the map’s registry');
  await make(l, [{ op: 'create', type: 'plain.thing', title: 'New here again', props: { island: here } }]);
});

test('what relies on a pack turned off on an island waits there', async () => {
  const { l, notes } = await map();
  await make(l, [{ op: 'update', id: notes, props: { packs_off: ['plain'] } }]);
  const run = await islandRegistry(l, notes);
  assert.equal(run.states.get('extra')?.state, 'waiting', 'extra requires plain');
  await refused(l, [{ op: 'create', type: 'extra.note', title: 'Another', props: { island: notes } }], /extra\.note waits on this island: its pack extra is waiting here/);
});

test('the kernel’s own pack is never turned off on an island, nor a pack that is not here, nor on an item that is no island', async () => {
  const { l, here, a } = await map();
  await refused(l, [{ op: 'update', id: here, props: { packs_off: ['core'] } }], /the core pack is the kernel's own: it is never turned off/);
  await refused(l, [{ op: 'update', id: here, props: { packs_off: ['nope'] } }], /no pack "nope" here/);
  await refused(l, [{ op: 'update', id: here, props: { packs_off: 'plain' } }], /packs_off is a list of pack ids/);
  await refused(l, [{ op: 'update', id: a, props: { packs_off: ['plain'] } }], /has no field "packs_off"/);
});

test('an agent’s turn of a pack on an island is the rules’ to judge, as pack_set is', async () => {
  const { l, here } = await map();
  const held = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: here, props: { packs_off: ['plain'] } }] })) as { status: string; held_by?: { rule: string } };
  assert.equal(held.status, 'proposed', 'an agent’s turn waits for the owner');
  assert.ok(['agent_island_pack', 'agent_changes'].includes(held.held_by?.rule ?? ''), JSON.stringify(held.held_by));
  assert.equal((await islandRegistry(l, here)), l.registry, 'nothing is off until the owner lets it through');
  // Turning a pack that runs code is a fact the rules read (agent_island_code).
  const reg = { isA: (t: string, of: string) => t === of, found: [{ id: 'coded', handlers: [{}] }, { id: 'plain' }] } as unknown as Registry;
  assert.deepEqual(offFacts(reg, { op: 'update', props: { packs_off: ['coded'] } }, { type: 'island', props: {} }), { island_code: true });
  assert.deepEqual(offFacts(reg, { op: 'update', props: { packs_off: ['plain'] } }, { type: 'island', props: {} }), {});
  assert.deepEqual(offFacts(reg, { op: 'update', props: { packs_off: [] } }, { type: 'island', props: { packs_off: ['coded'] } }), { island_code: true }, 'turning it back on too');
  assert.deepEqual(offFacts(reg, { op: 'update', props: { title: 'x' } }, { type: 'island', props: {} }), {});
});

test('the island answer declares its pack, what it requires, each one’s state there, and which items wait', async () => {
  const { l, here, notes, a, t, n } = await map();
  let answer = await flat(l, here);
  let pack = answer.islands.find((i: { id: string }) => i.id === here).pack;
  assert.equal(pack.id, 'plain');
  assert.equal(pack.title, 'Plain');
  assert.equal(pack.glyph, undefined, 'a pack with no glyph says none: the page shows its initial');
  assert.equal(pack.state, 'active');
  assert.equal(pack.kernel, undefined, 'a pack that may be turned off says nothing of the kernel');
  assert.deepEqual(pack.requires, [], 'core is the kernel’s own, on every island: not named');
  assert.equal(pack.off_would_wait, 1, 'its one thing here would wait; the shared task would not');
  assert.ok(pack.types.some((x: { id: string }) => x.id === 'plain.thing'), 'and its legend, as before');
  assert.ok(answer.items.every((i: { waiting?: unknown }) => i.waiting === undefined), 'nothing waits while it is on');

  await make(l, [{ op: 'update', id: here, props: { packs_off: ['plain'] } }]);
  answer = await flat(l, here);
  pack = answer.islands.find((i: { id: string }) => i.id === here).pack;
  assert.deepEqual([pack.state, pack.why, pack.off_would_wait], ['off', 'turned off on this island', 0]);
  assert.deepEqual(answer.items.find((i: { id: string }) => i.id === a).waiting, { pack: 'plain', why: 'turned off on this island' });
  assert.equal(answer.items.find((i: { id: string }) => i.id === t).waiting, undefined, 'a shared type does not wait');

  const notesAnswer = await flat(l, notes);
  const extraPack = notesAnswer.islands.find((i: { id: string }) => i.id === notes).pack;
  assert.deepEqual(extraPack.requires.map((r: { id: string; state: string; glyph?: string }) => [r.id, r.state, r.glyph]), [['plain', 'active', undefined]], 'on its own island, plain is on');
  assert.equal(extraPack.off_would_wait, 1);
  await make(l, [{ op: 'update', id: notes, props: { packs_off: ['plain'] } }]);
  const after = await flat(l, notes);
  const waitingPack = after.islands.find((i: { id: string }) => i.id === notes).pack;
  assert.equal(waitingPack.state, 'waiting');
  assert.deepEqual(waitingPack.requires.map((r: { id: string; state: string }) => [r.id, r.state]), [['plain', 'off']]);
  assert.equal(after.items.find((i: { id: string }) => i.id === n).waiting.pack, 'extra');
});

test('a pack’s glyph is its style preset’s (decision e_e3ss8nqm)', () => {
  assert.equal(glyphOf({ id: 'm', styles: [{ id: 'm.how', type: 'instruction', title: 'How', props: { glyph: 'x' } }, { id: 'm.look', title: 'Look', props: { glyph: '◆' } }] } as never), '◆', 'a style preset, not an instruction');
  assert.equal(glyphOf({ id: 'm', styles: [{ id: 'm.look', title: 'Look', props: {} }] } as never), undefined);
  assert.equal(glyphOf(undefined), undefined);
});

test('a focus turns its own pack off and back on: it waits meanwhile, and is still edited', async () => {
  const feat = { id: 'feat', version: '1.0.0', title: 'Feat', description: 'A pack whose feature may be a focus.', requires: ['core'], types: [{ id: 'feat.feature', title: 'Feature', description: 'A feature.', extends: 'work', capabilities: { focus: true } }, { id: 'feat.step', title: 'Step', description: 'A step.', extends: 'work' }] };
  const l = await freshWith(new Registry(packsWith(feat)));
  await setIslands(l, human, true);
  const { f } = await make(l, [{ op: 'create', ref: 'f', type: 'feat.feature', title: 'Billing', props: { focus: true } }]);
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'feat.step', title: 'A step', props: { island: f } }]);
  await make(l, [{ op: 'update', id: f, props: { packs_off: ['feat'] } }]);
  const answer = await flat(l, f);
  assert.deepEqual([answer.islands[0].pack.state, answer.islands[0].focus], ['off', true]);
  assert.equal(answer.items.find((i: { id: string }) => i.id === f).waiting.pack, 'feat', 'the focus waits too');
  assert.deepEqual(answer.items.find((i: { id: string }) => i.id === f).fields.packs_off, ['feat'], 'the page reads what is off from the focus’s fields');
  assert.equal(answer.items.find((i: { id: string }) => i.id === s).waiting.why, 'turned off on this island');
  await refused(l, [{ op: 'create', type: 'feat.step', title: 'Another', props: { island: f } }], /feat\.step waits on this island/);
  await make(l, [{ op: 'update', id: f, props: { packs_off: [] } }]);
  const woken = await flat(l, f);
  assert.equal(woken.islands[0].pack.state, 'active');
  assert.ok(woken.items.every((i: { waiting?: unknown }) => i.waiting === undefined), 'it wakes by itself');
});

test('an island that speaks the kernel’s own pack says so: it is never turned off', async () => {
  const { l } = await map();
  const { k } = await make(l, [{ op: 'create', ref: 'k', type: 'island', title: 'Plans', props: { pack: 'core' } }]);
  await make(l, [{ op: 'create', type: 'task', title: 'A plan', props: { island: k } }]);
  const pack = (await flat(l, k)).islands.find((i: { id: string }) => i.id === k).pack;
  assert.deepEqual([pack.id, pack.state, pack.kernel], ['core', 'active', true]);
});
