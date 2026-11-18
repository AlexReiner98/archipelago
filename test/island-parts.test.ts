// Parts of a pack turned off on one island (packs/loader/kernel/island-parts.ts, feature e_4r82mvf3; decisions
// e_8cfbg5qm, e_vqf2abmw): an island names the parts it has off in parts_off; its registry runs without them, and
// without what needs them, which waits saying what it lacks. A type off makes no new item there and its items stay;
// a rule off judges nothing there. Every other island keeps the whole pack, and the kernel's own parts are never off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../packs/identity/kernel/workspaces.ts'; // as on a server: a change to a pack item makes the packs on follow
import { islandRegistry } from '../packs/loader/kernel/island-pin.ts';
import { withoutParts } from '../packs/loader/kernel/island-parts.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { setIslands, setPack } from '../packs/loader/kernel/packstate.ts';
import type { Archipelago, Op } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

/** A pack kept as an item, like Build: lanes and overlaps, a rule on each. */
const LANES = {
  types: [
    { id: 'lanes.lane', title: 'Lane', description: 'A lane of work.', extends: 'work' },
    { id: 'lanes.overlap', title: 'Overlap', description: 'Two lanes touching one file.', extends: 'work' },
  ],
  rules: [
    { id: 'lanes.careful', when: { actor: 'agent', op: 'update', type: 'lanes.lane' }, then: 'hold', say: 'A lane changed by an agent waits.' },
    { id: 'lanes.watched', when: { actor: 'agent', op: 'update', type: 'lanes.overlap' }, then: 'hold', say: 'An overlap changed by an agent waits.' },
  ],
};

async function map(applying: 'apply' | 'hold' = 'apply') {
  const l = await freshWith(new Registry(packsWith()));
  await setIslands(l, human, true);
  await l.db.query(`insert into setting (key, value) values ('agent_changes', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(applying)]);
  await make(l, [{ op: 'create', type: 'pack', title: 'Lanes', body: 'Work in lanes.', props: { name: 'lanes', manifest: LANES } }]);
  await setPack(l, human, { pack: 'lanes', on: true });
  const isl = await make(l, [
    { op: 'create', ref: 'here', type: 'island', title: 'Here', props: { pack: 'lanes' } },
    { op: 'create', ref: 'there', type: 'island', title: 'There', props: { pack: 'lanes' } },
  ]);
  const items = await make(l, [
    { op: 'create', ref: 'lane', type: 'lanes.lane', title: 'A lane here', props: { island: isl.here } },
    { op: 'create', ref: 'over', type: 'lanes.overlap', title: 'An overlap here', props: { island: isl.here } },
    { op: 'create', ref: 'lane2', type: 'lanes.lane', title: 'A lane there', props: { island: isl.there } },
  ]);
  return { l, ...isl, ...items } as { l: Archipelago } & Record<string, string>;
}

const refused = (l: Archipelago, ops: Op[], said: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), said);
const send = (l: Archipelago, ops: Op[]) => l.change(agent, { reason: 'test', authority: { of: 'agent', basis: 'a test' }, ops }) as Promise<{ status?: string; held_by?: { rule: string } }>;

test('what a part off takes with it: what needs it waits, saying what it lacks; the kernel keeps all its own', () => {
  const lanes = { id: 'lanes', ...LANES } as unknown as PackFile;
  const core = { id: 'core', types: [{ id: 'task', extends: 'work' }] } as unknown as PackFile;
  const { found, states } = withoutParts(new Map([['lanes', lanes], ['core', core]]), ['lanes.overlap', 'task']);
  assert.deepEqual(states.get('lanes.overlap'), { pack: 'lanes', kind: 'type', state: 'off', lacks: [] });
  assert.deepEqual(states.get('lanes.watched'), { pack: 'lanes', kind: 'rule', state: 'waiting', lacks: ['type:lanes.overlap'] });
  assert.equal(states.has('task'), false, 'the kernel’s own is never off');
  assert.deepEqual(found.get('lanes')!.types!.map((t) => (t as { id: string }).id), ['lanes.lane']);
  assert.deepEqual(found.get('lanes')!.rules!.map((r) => r.id), ['lanes.careful']);
  assert.equal(found.get('core'), core);
});

test('a type off on one island makes no new item there, its items stay, and a rule on it waits; another island keeps it', async () => {
  const { l, here, there, over } = await map();
  await make(l, [{ op: 'update', id: here, props: { parts_off: ['lanes.overlap'] } }]);
  const run = await islandRegistry(l, here);
  assert.deepEqual(run.partStates.get('lanes.overlap'), { pack: 'lanes', kind: 'type', state: 'off', lacks: [] });
  assert.deepEqual(run.partStates.get('lanes.watched'), { pack: 'lanes', kind: 'rule', state: 'waiting', lacks: ['type:lanes.overlap'] });
  assert.equal(run.type('lanes.overlap')?.dormant, true, 'kept dormant there');
  assert.ok(!run.rules.some((r) => r.id === 'lanes.watched'), 'the rule that needs it is not loaded there');
  assert.equal(run.states.get('lanes')?.state, 'active', 'the pack itself stays on');
  assert.equal(l.registry.type('lanes.overlap')?.dormant, undefined, 'the map keeps it');
  assert.equal((await islandRegistry(l, there)).partStates.size, 0, 'and so does every other island');

  await make(l, [{ op: 'update', id: over, title: 'An overlap here, edited' }]);
  assert.equal((await l.entity(over))!.title, 'An overlap here, edited', 'an item of a type off is still edited');
  await refused(l, [{ op: 'create', type: 'lanes.overlap', title: 'New here', props: { island: here } }], /lanes\.overlap waits on this island/);
  await make(l, [{ op: 'create', type: 'lanes.overlap', title: 'New there', props: { island: there } }]);
  await make(l, [{ op: 'create', type: 'lanes.lane', title: 'A lane is still made here', props: { island: here } }]);

  await make(l, [{ op: 'update', id: here, props: { parts_off: [] } }]);
  assert.equal(await islandRegistry(l, here), l.registry, 'with nothing off, the island runs the map’s registry');
  await make(l, [{ op: 'create', type: 'lanes.overlap', title: 'New here again', props: { island: here } }]);
});

// Waits on packs/loader/kernel/island-rules.ts, which is no lane's: it judges an op by its island's registry only for a
// pinned version (opRuns returns early with no versions). Raised as an overlap for the integration; packs_off has the same gap.
test('a rule off on one island judges nothing there, and still does on another', { todo: 'island-rules.ts reads only pinned versions: overlap raised for the integration' }, async () => {
  const { l, here, lane, lane2 } = await map();
  assert.equal((await send(l, [{ op: 'update', id: lane, title: 'Renamed' }])).status, 'proposed', 'on, it holds');
  await make(l, [{ op: 'update', id: here, props: { parts_off: ['lanes.careful'] } }]);
  assert.equal((await islandRegistry(l, here)).partStates.get('lanes.careful')?.state, 'off');
  assert.notEqual((await send(l, [{ op: 'update', id: lane, title: 'Renamed here' }])).status, 'proposed', 'off, it judges nothing here');
  const there = await send(l, [{ op: 'update', id: lane2, title: 'Renamed there' }]);
  assert.equal(there.status, 'proposed');
  assert.equal(there.held_by?.rule, 'lanes.careful', 'the other island is still under it');
});

test('parts_off names parts a pack here declares, never the kernel’s own, and only on an island', async () => {
  const { l, here, lane } = await map();
  await refused(l, [{ op: 'update', id: here, props: { parts_off: ['task'] } }], /"task" is the kernel's own \(core\): it is never turned off/);
  await refused(l, [{ op: 'update', id: here, props: { parts_off: ['lanes.nope'] } }], /no pack here declares a part "lanes\.nope"/);
  await refused(l, [{ op: 'update', id: here, props: { parts_off: 'lanes.overlap' } }], /parts_off is a list of part ids/);
  await refused(l, [{ op: 'update', id: lane, props: { parts_off: ['lanes.overlap'] } }], /parts_off/);
});

test('an agent’s turn of a part on an island is judged as a pack’s is', async () => {
  const { l, here } = await map('hold');
  const held = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: here, props: { parts_off: ['lanes.overlap'] } }] })) as { status: string; held_by?: { rule: string } };
  assert.equal(held.status, 'proposed', 'an agent’s turn waits for the owner');
  assert.ok(['agent_island_pack', 'agent_changes'].includes(held.held_by?.rule ?? ''), JSON.stringify(held.held_by));
  assert.equal(await islandRegistry(l, here), l.registry, 'nothing is off until the owner lets it through');
});
