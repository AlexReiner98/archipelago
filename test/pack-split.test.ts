// A pack split into a vocabulary half and a practice half (task e_qhtt4phv, hub e_9hkt86s7): the vocabulary half keeps
// the pack's id with its types and links, and the practice half names it in moved_from and keeps its views', styles'
// and instructions' ids (src/pack-moved.ts, ownsId in src/packorder.ts). A map that had the pack on keeps both on, once;
// an owner's taking the practice half out stands; every id still resolves, and the practice half, requiring the
// vocabulary by type, waits while no pack declares it.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import * as instructionsPack from '../packs/agents/kernel/instructions.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { followPacks, packsOff, setPack, syncPacks } from '../packs/loader/kernel/packstate.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { human, make, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

const types = [{ id: 'plant', title: 'Plant', description: 'Something grown.', extends: 'work', statuses: { open: ['sown', 'growing'], closed: ['picked'] } }];
const links = [{ id: 'shades', title: 'shades', description: 'Keeps the sun off another.', from: ['plant'], to: ['plant'] }];
const views = [
  { form: 'screen', id: 'garden.plant_page', title: 'Beds', on: ['plant'], pieces: [{ piece: 'turns' }] },
  { id: 'garden.beds', shape: 'rows', title: 'Beds', description: 'The plants.', lens: { filter: { find: ['type plant'] } } },
];
const styles = [
  { id: 'garden.tend', type: 'instruction', title: 'Tend the beds', body: 'Water what is growing.', props: { for: ['session_start'], order: 90 } },
  { id: 'garden.look', title: 'A plant’s look', on: ['plant'], props: { page: { notes: 'whole' } } },
];

/** The pack whole, as it was before the split. */
const whole = { id: 'garden', version: '1.0.0', title: 'Garden', description: 'Plants and how they are tended.', types, links, views, styles } as unknown as PackFile;
/** Its vocabulary half: the same id, its types and links alone. */
const vocabulary = { id: 'garden', version: '2.0.0', title: 'Garden', description: 'Plants.', types, links } as unknown as PackFile;
/** Its practice half: what was the pack's views and styles, by their ids, requiring the vocabulary by name. */
const practice = { id: 'garden_ways', version: '1.0.0', title: 'Tending a garden', description: 'How plants are tended.', moved_from: ['garden'], requires: ['type:plant', 'type:shades'], views, styles } as unknown as PackFile;
/** A pack that names garden in moved_from but holds nothing that was garden's: never added for it. */
const stranger = { id: 'stranger', version: '1.0.0', title: 'Stranger', description: 'Holds nothing of garden’s.', moved_from: ['garden'], styles: [{ id: 'garden.other', type: 'instruction', title: 'Other', body: 'Other.', props: { for: ['session_start'] } }] } as unknown as PackFile;

async function mapOn(dir: string, db?: Archipelago['db']) {
  const reg = new Registry(dir);
  registries.push(reg);
  const l = new Archipelago(db ?? (await openDb()), reg);
  return (await syncTypes(l), l);
}

/** A map made before the split with garden on (or taken out), a plant shading another on it. */
async function before(on = true) {
  const old = await mapOn(packsWith(whole));
  await syncPacks(old);
  await setPack(old, human, { pack: 'garden', on: true });
  const made = await make(old, [
    { op: 'create', ref: 'bean', type: 'plant', title: 'Beans', status: 'growing' },
    { op: 'create', ref: 'pea', type: 'plant', title: 'Peas', status: 'sown' },
    { op: 'link', type: 'shades', from: 'bean', to: 'pea' },
  ]);
  if (!on) await setPack(old, human, { pack: 'garden', on: false });
  return { old, bean: made.bean, pea: made.pea };
}

/** The same map opened on the packs after the split. */
async function split(old: Archipelago, ...more: PackFile[]) {
  const now = await mapOn(packsWith(vocabulary, practice, ...more), old.db);
  const facts = await syncPacks(now);
  await followPacks(now);
  return { now, added: facts.filter((f) => f[0] === '+' && /pack:(garden_ways|stranger)$/.test(f[1])).map((f) => f[1]) };
}

test('a map that had the pack keeps both halves on, once, and every id resolves', async () => {
  const { old, bean } = await before();
  const { now, added } = await split(old, stranger);
  assert.deepEqual(added, ['pack:garden_ways'], 'the practice half is added; a pack holding nothing of garden’s is not');
  assert.equal(now.registry.states.get('garden')?.state, 'active');
  assert.equal(now.registry.states.get('garden_ways')?.state, 'active', now.registry.states.get('garden_ways')?.why ?? '');
  assert.ok((await packsOff(now)).includes('stranger'), 'it waits for the owner');
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:garden_ways$/.test(f[1])), [], 'once');

  // The items of the vocabulary's type keep working, and the practice half's ids, garden's still, resolve.
  assert.equal((await now.entity(bean))?.type, 'plant');
  await make(now, [{ op: 'update', id: bean, status: 'picked' }]);
  const said = (await instructionsPack.instructionsFor(kernelContext(now, 'agents'), 'session_start', ({ fill: { run: 'r' } }))).map((s) => s.preset);
  assert.ok(said.includes('garden.tend'), said.join(', '));
  const listed = JSON.stringify(await callTool(now, human, 'query', {}));
  assert.ok(listed.includes('beds'), 'the view garden.beds is offered');
  const ways = now.registry.packs.find((p) => p.id === 'garden_ways');
  assert.deepEqual(ways?.views?.map((v) => v.id), ['garden.plant_page', 'garden.beds'], 'its views load under garden’s ids');
  assert.ok(now.registry.packs.find((p) => p.id === 'garden')?.types?.length, 'and the vocabulary under garden’s own');
});

test('an owner’s taking the practice half out stands', async () => {
  const { old } = await before();
  const { now } = await split(old);
  await setPack(now, human, { pack: 'garden_ways', on: false });
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:garden_ways$/.test(f[1])), []);
  assert.ok((await packsOff(now)).includes('garden_ways'));
});

test('a map that had the pack taken out is not given the practice half', async () => {
  const { old } = await before(false);
  const { now, added } = await split(old);
  assert.deepEqual(added, []);
  assert.ok((await packsOff(now)).includes('garden_ways'));
});

test('the practice half waits while no pack declares the types it requires', async () => {
  const { old } = await before();
  const { now } = await split(old);
  await setPack(now, human, { pack: 'garden', on: false });
  const state = now.registry.states.get('garden_ways');
  assert.equal(state?.state, 'waiting');
  assert.match(state?.why ?? '', /plant|shades/);
  await setPack(now, human, { pack: 'garden', on: true });
  assert.equal(now.registry.states.get('garden_ways')?.state, 'active', 'whichever pack declares them provides them');
});

test('a pack may name only its own ids, the kernel’s, and those of the packs in its moved_from', async () => {
  const dir = packsWith(vocabulary, { ...stranger, id: 'loose', moved_from: undefined } as unknown as PackFile);
  assert.throws(() => registries.push(new Registry(dir)), /garden\.other.*must be named "loose\.<name>"/);
});

test('a bare name is the kernel’s: kept only by a pack whose moved_from names core outright', () => {
  const screen = { form: 'screen', id: 'needs_here', title: 'Needs', on: ['plant'], pieces: [{ piece: 'turns' }] };
  const taken = { ...practice, id: 'took_core', moved_from: ['garden', 'core'], views: [screen] } as unknown as PackFile;
  registries.push(new Registry(packsWith(vocabulary, taken)));
  const loose = { ...practice, id: 'bare', views: [screen] } as unknown as PackFile;
  assert.throws(() => registries.push(new Registry(packsWith(vocabulary, loose))), /needs_here.*must be named "bare\.<name>"/);
});
