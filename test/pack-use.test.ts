// What the Packs screen shows of a pack: every declaration its manifest makes, nothing filtered out, and beside each
// what can be counted of its use on the map (src/pack-touches.ts, src/pack-use.ts): items of a type, links of a link
// type, a view's reads, a rule's refusals and holds, counted as they happen (src/uses.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gist, packTouches, whenWords } from '../src/pack-touches.ts';
import { packStates } from '../src/packstate.ts';
import { withUse } from '../src/pack-use.ts';
import { askView } from '../src/askview.ts';
import { flushCounts } from '../src/pack-counts.ts';
import { agent, fresh, human, make } from './map.ts';

const PINNED = [
  'core/links/depends on: 1 (1 link here, 1 made in 30 days)',
  'core/rules/Agent changes: 1 (held 1 change in 30 days)',
  'core/rules/Asked: 1 (held 1 change in 30 days)',
  'core/shared/Question: 1 (1 item here, 1 made in 30 days)',
  'core/shared/Task: 2 (2 items here, 2 made in 30 days)',
  'core/types/Question: 1 (1 item here, 1 made in 30 days)',
  'core/types/Task: 2 (2 items here, 2 made in 30 days)',
  'core/views/Frontier: 3 (read 3 times in 30 days)',
  'findings/rules/Finding value: 1 (refused 1 change in 30 days)',
];

const group = (touches: ReturnType<typeof packTouches>, key: string) => touches.find((g) => g.key === key)!;

test('a pack’s plate lists all it declares: shared words, kernel actions and retention rules too, each with its definition', async () => {
  const l = await fresh();
  const core = l.registry.found.find((p) => p.id === 'core')!;
  const touches = packTouches(core);
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  assert.equal(group(touches, 'types').n, count(core.types));
  assert.equal(group(touches, 'links').n, count(core.links));
  assert.equal(group(touches, 'rules').n, count(core.rules), 'retention rules are rules too');
  assert.equal(group(touches, 'actions').n, count(core.actions), 'the kernel’s own verbs are listed');
  assert.equal(group(touches, 'shared').n, count((core as unknown as { shared?: unknown[] }).shared));
  assert.ok(group(touches, 'actions').items.every((a) => a.def && a.sort), 'each action names its sort');
  assert.ok(touches.every((g) => g.items.every((t) => t.def !== undefined)), 'every declaration carries its whole definition');
  const keeps = group(touches, 'rules').items.find((r) => r.sort === 'keeps')!;
  assert.ok(keeps && !keeps.counts, 'a retention rule is listed, and not counted');
  assert.equal(whenWords({ actor: 'agent', op: ['create', 'update'], type: 'finding' }), 'agent · create/update · finding');
});

test('beside each, its use here: items, links, a view’s reads, a rule’s refusals and holds, and what was never used', async () => {
  const l = await fresh();
  await make(l, [{ op: 'create', ref: 'a', type: 'task', title: 'One' }, { op: 'create', ref: 'b', type: 'task', title: 'Two' }, { op: 'link', type: 'depends_on', from: 'a', to: 'b' }]);
  await askView(l, human, 'frontier', {});
  await assert.rejects(l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'finding', title: 'A finding with no value' }] }));
  const held = await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Held' }], hold: true });
  assert.equal(held.status, 'proposed');

  const states = await withUse(l, packStates(l));
  const core = states.find((p) => p.id === 'core')!;
  const of = (pack: typeof core) => (key: string, pred: (t: { def: unknown }) => boolean) => pack.touches.find((g) => g.key === key)!.items.find(pred)!;
  const item = of(core);
  const id = (want: string) => (t: { def: unknown }) => (t.def as { id?: string }).id === want;
  assert.equal(item('types', id('task')).used, 2);
  assert.equal(item('links', id('depends_on')).used, 1);
  assert.equal(item('views', id('core.frontier')).used, 1);
  const findings = of(states.find((p) => p.id === 'findings')!);
  assert.equal(findings('rules', id('finding_value')).used, 1, 'a rule moved out of core is counted in its own pack');
  assert.match(findings('rules', id('finding_value')).said!, /refused 1 change/);
  assert.equal(item('rules', id('asked')).used, 1);
  assert.match(item('rules', id('asked')).said!, /held 1 change/);
  assert.equal(item('views', id('core.hubs')).used, 0, 'a view never read is unused');
  const types = core.touches.find((g) => g.key === 'types')!;
  assert.equal(types.unused, types.items.filter((t) => t.used === 0).length);
  assert.ok(types.unused > 0);
});

// Pinned before the usage pack's modules took their reads through the context (wave 5, e_knnqyhn7), and kept after:
// on a small map, with some uses written down in the stream and some still held, every thing used and what is said of it.
test('the Packs screen’s use, pinned: written-down and held uses summed, items and links counted', async () => {
  const gone = await fresh();
  await flushCounts(async () => ({ pelago: gone }) as never); // what the tests before counted, out of the way
  const l = await fresh();
  await make(l, [{ op: 'create', ref: 'a', type: 'task', title: 'One' }, { op: 'create', ref: 'b', type: 'task', title: 'Two' }, { op: 'create', ref: 'c', type: 'question', title: 'Why?' }, { op: 'link', type: 'depends_on', from: 'a', to: 'b' }]);
  await askView(l, human, 'frontier', {});
  await askView(l, human, 'frontier', {});
  await assert.rejects(l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'finding', title: 'A finding with no value' }] }));
  await flushCounts(async () => ({ pelago: l }) as never); // these are written down in the uses stream
  await askView(l, human, 'frontier', {}); // and these held in memory still
  await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Held' }], hold: true });
  const states = await withUse(l, packStates(l));
  const used = states.flatMap((p) => p.touches.flatMap((g) => g.items.filter((t) => t.used).map((t) => `${p.id}/${g.key}/${t.name}: ${t.used} (${t.said})`))).sort();
  assert.deepEqual(used, PINNED);
  assert.ok(states.every((p) => p.use_days === 30));
});

test('what a pack touches is read from its manifest alone, each counted thing saying how', () => {
  const groups = packTouches({ id: 'p', version: '1', types: [{ id: 'task', title: 'Task', fields: { due: {} } }], views: [{ id: 'p.v', lens: {} }], rules: [{ id: 'r', then: 'hold', when: { actor: 'agent' } }] } as never);
  const of = (key: string) => groups.find((g) => g.key === key)!;
  assert.deepEqual(of('types').items[0].counts, { by: 'items', type: 'task' });
  assert.deepEqual(of('views').items[0].counts, { by: 'view', id: 'p.v' });
  assert.deepEqual(of('rules').items[0].counts, { by: 'ruling', id: 'p.r' });
  assert.equal(of('rules').items[0].sort, 'holds');
  assert.equal(gist('Holds a change. And more.'), 'Holds a change');
});
