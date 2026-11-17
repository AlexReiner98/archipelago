// A rule that carries (typed islands e_f56ds3ww, task e_manv7kxw): a planned import on one island reads two packs on
// another, in the roles from and to, takes each one's promised order into a field of its own, and a compare rule beside
// it refuses an import against the order. The carry pack fills what the change writes and follows a link with an update;
// touching the import after a pack's order moved judges it again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PackFile } from '../packs/loader/kernel/packs.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { freshWith, human, make, packsWith } from './map.ts';

/** Where the packs stand: each layer promises its order. */
const LAYERS = {
  id: 'layers', version: '1', title: 'Layers', description: 'The order packs stand in.', requires: ['core'],
  types: [{ id: 'layers.layer', title: 'Layer', description: 'A pack in the order.', extends: 'place', capabilities: { promised: { fields: ['order'] } }, fields: { order: { type: 'number' } } }],
} as unknown as PackFile;

/** A plan: an import it means to add, judged by the order of what it reads. */
const PLAN = {
  id: 'plan', version: '1', title: 'Plan', description: 'What a build means to add.', requires: ['core'],
  types: [{ id: 'plan.import', title: 'Import', description: 'An import a step will add.', extends: 'record', fields: { from_order: { type: 'number' }, to_order: { type: 'number' } } }],
  rules: [
    { id: 'from', when: { type: 'plan.import' }, then: { carry: { field: 'from_order', as: 'from', read: 'order' } } },
    { id: 'to', when: { type: 'plan.import' }, then: { carry: { field: 'to_order', as: 'to', read: 'order' } } },
    { id: 'one_way', when: { type: 'plan.import', compare: 'to_order > from_order' }, then: 'refuse', say: 'A pack imports only the packs before it.' },
  ],
} as unknown as PackFile;

async function map() {
  const l = await freshWith(new Registry(packsWith(LAYERS, PLAN)));
  await setIslands(l, human, true);
  const { code, plans } = await make(l, [
    { op: 'create', ref: 'code', type: 'island', title: 'Code', props: { pack: 'layers' } },
    { op: 'create', ref: 'plans', type: 'island', title: 'Plans', props: { pack: 'plan' } },
  ]);
  const { core, shell } = await make(l, [
    { op: 'create', ref: 'core', type: 'layers.layer', title: 'Core', props: { order: 0, island: code } },
    { op: 'create', ref: 'shell', type: 'layers.layer', title: 'Shell', props: { order: 14, island: code } },
  ]);
  return { l, plans: plans!, core: core!, shell: shell! };
}

test('an import made with its readings takes their order, and one against the order is refused', async () => {
  const { l, plans, core, shell } = await map();
  const { ok } = await make(l, [
    { op: 'create', ref: 'ok', type: 'plan.import', title: 'Shell imports core', props: { island: plans } },
    { op: 'link', type: 'reads', from: 'ok', to: shell, props: { as: 'from', expects: 'layers.layer' } },
    { op: 'link', type: 'reads', from: 'ok', to: core, props: { as: 'to', expects: 'layers.layer' } },
  ]);
  const made = (await l.entity(ok!))!;
  assert.equal(made.props.from_order, 14);
  assert.equal(made.props.to_order, 0);
  await assert.rejects(make(l, [
    { op: 'create', ref: 'bad', type: 'plan.import', title: 'Core imports shell', props: { island: plans } },
    { op: 'link', type: 'reads', from: 'bad', to: core, props: { as: 'from' } },
    { op: 'link', type: 'reads', from: 'bad', to: shell, props: { as: 'to' } },
  ]), /A pack imports only the packs before it/);
});

test('a reading added later is followed by the carried field, and judged', async () => {
  const { l, plans, core, shell } = await map();
  const { i } = await make(l, [
    { op: 'create', ref: 'i', type: 'plan.import', title: 'Core imports shell', props: { island: plans } },
    { op: 'link', type: 'reads', from: 'i', to: core, props: { as: 'from' } },
  ]);
  assert.equal((await l.entity(i!))!.props.from_order, 0);
  await assert.rejects(make(l, [{ op: 'link', type: 'reads', from: i!, to: shell, props: { as: 'to' } }]), /A pack imports only the packs before it/);
});

test('when what it reads moves, touching the reader judges it again', async () => {
  const { l, plans, core, shell } = await map();
  const { i } = await make(l, [
    { op: 'create', ref: 'i', type: 'plan.import', title: 'Shell imports core', props: { island: plans } },
    { op: 'link', type: 'reads', from: 'i', to: shell, props: { as: 'from' } },
    { op: 'link', type: 'reads', from: 'i', to: core, props: { as: 'to' } },
  ]);
  await make(l, [{ op: 'update', id: core, props: { order: 20 } }]);
  await assert.rejects(make(l, [{ op: 'update', id: i! }]), /A pack imports only the packs before it/);
});

test('a carry is checked as its pack loads', async () => {
  const bad = { ...PLAN, id: 'plan_bad', rules: [{ id: 'x', when: { type: 'plan.import' }, then: { carry: { field: 'nowhere', as: 'from', read: 'order' } } }] } as unknown as PackFile;
  assert.throws(() => new Registry(packsWith(LAYERS, bad)), /plan\.import has no field "nowhere" to carry into/);
});
