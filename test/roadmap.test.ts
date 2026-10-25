import assert from 'node:assert/strict';
import { dumpVault } from '../src/vault.ts';
import { test } from 'node:test';
import { dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { pictureOf } from '../src/lens-kept.ts';
import { Archipelago, type Op } from '../src/pelago.ts';
import { sessionStart } from '../src/sessions.ts';
import { askView } from '../src/askview.ts';
import { lastSeq } from '../src/eventlog.ts';
import { human, agent, fresh, attend, make } from './map.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

test('a picture is drawn in the styles kept for it, nearest last; hubs, code and where a kept view is seen', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Q' },
    { op: 'create', ref: 'late', type: 'software.feature', title: 'Late' },
    { op: 'create', ref: 'early', type: 'software.feature', title: 'Early', status: 'building' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
    { op: 'create', ref: 'c', type: 'work.task', title: 'C' },
    { op: 'link', type: 'part_of', from: 'early', to: 'p' },
    { op: 'link', type: 'part_of', from: 'late', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'early' },
    { op: 'link', type: 'part_of', from: 'b', to: 'early' },
    { op: 'link', type: 'part_of', from: 'c', to: 'p' },
  ]);
  const run = async (params: Record<string, unknown> = {}) => (await ask(l, 'style', params)) as any;
  // The packs' presets first: with nothing kept on the map, a view is drawn in the core pack's house style, with the
  // canvas pack's preset over it (packs/canvas), which draws it as a flow.
  const house = { id: 'core.house', title: 'House style', preset: 'core.house' };
  const canvas = { id: 'canvas.house', title: 'Canvas', preset: 'canvas.house' };
  const whole = await run();
  assert.deepEqual([whole.style.shape, whole.style.lit, whole.style.open, whole.used], ['flow', 'all', 1, [house, canvas]]);
  // Kept on the map: the workspace's style (about nothing), then those about what the picture is of, then one named.
  const drawn = await make(l, [
    { op: 'create', ref: 'ws', type: 'style', title: 'House style', props: { shape: 'list', open: 1, colors: { sea: '#f0f4f5' } } },
    { op: 'create', ref: 'ps', type: 'style', title: 'P opened', props: { open: 2 } },
    { op: 'create', ref: 'spare', type: 'style', title: 'Spare', status: 'retired', props: { shape: 'flow' } },
    { op: 'link', type: 'about', from: 'ps', to: made.p },
  ]);
  const opened = await run();
  assert.deepEqual([opened.style.shape, opened.style.open, opened.style.colors], ['list', 1, { sea: '#f0f4f5' }], 'the workspace’s own');
  // A named set (sizes, colours) is merged name by name: a style that sets one size keeps the house style's others.
  assert.equal(typeof opened.style.sizes.flow_layer_gap, 'number');
  assert.deepEqual(opened.used, [house, canvas, { id: drawn.ws, title: 'House style' }]);
  const ofP = await run({ of: made.p });
  assert.deepEqual([ofP.style.open, ofP.style.shape], [2, 'list'], 'a field the nearer one names replaces it; one it does not falls through');
  assert.deepEqual(ofP.used.map((k: any) => k.title), ['House style', 'Canvas', 'House style', 'P opened']);
  // The owner's version of a preset: its fields over the preset's, in its place; retired, the preset is not used.
  const mine = await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Mine', props: { preset: 'core.house', lit: 'blocked' } }]);
  const versioned = await run();
  assert.deepEqual([versioned.style.lit, versioned.style.shape, versioned.used[0]], ['blocked', 'list', { id: mine.v, title: 'Mine', preset: 'core.house' }]);
  await make(l, [{ op: 'update', id: mine.v, status: 'retired' }]);
  assert.deepEqual((await run()).used.map((k: any) => k.title), ['Canvas', 'House style'], 'retired, the preset is not used');
  await make(l, [{ op: 'update', id: mine.v, status: 'current' }, { op: 'update', id: mine.v, props: { lit: null } }]);
  // A style kept on a kind is how every such item's pictures look: over the workspace's, under the item's own.
  const onKind = await make(l, [{ op: 'create', ref: 'k', type: 'style', title: 'Projects', props: { on: ['work.project'], open: 3, radius: 4, sizes: { list_row: 40 } } }]);
  const kinded = await run({ of: made.p });
  assert.deepEqual([kinded.style.sizes.list_row, typeof kinded.style.sizes.flow_layer_gap], [40, 'number'], 'one size changed, the house style keeps the rest');
  assert.deepEqual([kinded.style.open, kinded.style.radius], [2, 4], "the item's own over its kind's, the kind's over the workspace's");
  await make(l, [{ op: 'archive', id: onKind.k }]);
  assert.equal((await run({ style: drawn.spare })).style.shape, 'flow', 'a style named outright is used, retired or not');
  await assert.rejects(run({ style: 'e_nothing0' }), /No style/);

  // A view kept about an item: its own shape, and a style kept about the view, over the rest.
  const kept = await make(l, [
    { op: 'create', ref: 'road', type: 'lens', title: 'Roadmap', props: { place: 1, filter: { ids: [made.p] }, walk: { over: ['part_of'], steps: 1 }, style: { shape: 'grid' } } },
    { op: 'link', type: 'about', from: 'road', to: made.p },
    { op: 'create', ref: 'rs', type: 'style', title: 'Road opened', props: { open: 4 } },
    { op: 'link', type: 'about', from: 'rs', to: 'road' },
  ]);
  const { keptPicture } = await import('../src/lens-saved.ts');
  const road = await keptPicture(l, kept.road);
  assert.deepEqual([road.items.map((i) => i.title).sort(), road.style.shape, road.style.open], [['C', 'Early', 'Late', 'P'], 'grid', 4]);

  // A hub is an item that holds enough to need views of its own: how much is enough is its project's to say.
  assert.deepEqual(((await ask(l, 'hubs', { within: made.p })) as any).hubs, [], 'five things are not twelve');
  await make(l, [{ op: 'update', id: made.p, props: { hub_at: 2 } }]);
  const found = ((await ask(l, 'hubs', { within: made.p })) as any).hubs.map((h: any) => [h.title, h.inside, h.at, h.views]);
  assert.deepEqual(found, [['P', 5, 2, 1], ['Early', 2, 2, 0]], 'while a project is shaped, most of what is in it is a hub');
  await assert.rejects(ask(l, 'hubs', {}), /within an item or a place/, 'across the whole map, hubs are not read');

  // Code in a style runs in the browser of whoever looks: an agent that writes it proposes it, whatever else agents may do unreviewed.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', merge: 'auto' });
  const plain = await free.change(agent, { reason: 'a colour', ops: [{ op: 'update', id: drawn.ws, props: { radius: 4 } }] });
  const coded = await free.change(agent, { reason: 'a drawing', ops: [{ op: 'update', id: drawn.ws, props: { code: 'export default () => {}' } }] });
  const born = await free.change(agent, { reason: 'a drawing', ops: [{ op: 'create', type: 'style', title: 'Mine', props: { code: 'export default () => {}' } }] });
  const folded = await free.change(agent, { reason: 'fold', ops: [{ op: 'merge', keep: drawn.ws, drop: drawn.spare }] });
  assert.deepEqual([plain.status, coded.status, born.status, folded.status], ['applied', 'proposed', 'proposed', 'proposed']);
  assert.equal((await run()).style.code, undefined, 'and until the human approves it, the picture is drawn without it');
  assert.deepEqual([await pictureOf(l, drawn.ps), await pictureOf(l, drawn.ws), await pictureOf(l, kept.road), await pictureOf(l, made.a)], [`graph?from=${made.p}`, 'graph?lens', `v?canvas=${kept.road}`, undefined], 'a style is seen at work in the picture it is about, a kept view as itself');
});

test('the roadmap tree orders a project\'s features, rolls up progress, and shows where work is happening', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Proj' },
    { op: 'create', ref: 'other', type: 'work.project', title: 'Other' },
    { op: 'create', ref: 'late', type: 'software.feature', title: 'Late', props: { order: 2 } },
    { op: 'create', ref: 'early', type: 'software.feature', title: 'Early', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'unplaced', type: 'software.feature', title: 'No place yet' },
    { op: 'create', ref: 'sub', type: 'software.feature', title: 'Sub' },
    { op: 'create', ref: 't1', type: 'work.task', title: 'T1', status: 'done' },
    { op: 'create', ref: 't2', type: 'work.task', title: 'T2', status: 'doing' },
    { op: 'create', ref: 't3', type: 'software.bug', title: 'T3' },
    { op: 'create', ref: 'loose', type: 'work.task', title: 'Loose' },
    { op: 'create', ref: 'note', type: 'work.note', title: 'Not work' },
    ...['late', 'early', 'unplaced', 'loose'].map((from): Op => ({ op: 'link', type: 'part_of', from, to: 'p' })),
    { op: 'link', type: 'part_of', from: 'sub', to: 'early' },
    { op: 'link', type: 'part_of', from: 't1', to: 'early' },
    { op: 'link', type: 'part_of', from: 'note', to: 'early' },
    { op: 'link', type: 'part_of', from: 't2', to: 'sub' },
    { op: 'link', type: 'part_of', from: 't3', to: 'late' },
  ]);

  const roots = (await ask(l, 'tree', {})) as any;
  assert.deepEqual(roots.roots.map((r: any) => [r.title, r.branches]), [['Proj', 3], ['Other', 0]], 'without a root, the projects to choose from');

  const tree = (await ask(l, 'tree', { root: made.p })) as any;
  assert.deepEqual(tree.branches.map((b: any) => b.title), ['Early', 'Late', 'No place yet'], 'placed features in order, the rest after');
  const early = tree.branches[0];
  assert.deepEqual(early.progress, { done: 1, total: 2 }, 'a feature counts the work under its sub-features; a note is not work');
  assert.deepEqual([early.status, early.active, early.branches[0].title], ['building', true, 'Sub']);
  assert.deepEqual(tree.progress, { done: 1, total: 4 }, 'the project counts all of it, placed or not');
  assert.deepEqual(tree.unplaced.map((w: any) => w.title), ['Loose']);
  assert.deepEqual(tree.depends, [], 'no dependencies yet');
  assert.deepEqual(tree.by_status, { building: 1, planned: 3 });
  assert.deepEqual(tree.now.map((n: any) => [n.title, n.path.join(' > ')]), [['Early', ''], ['T2', 'Early > Sub']], 'what is being built, and under what');

  const session = await sessionStart(l, agent, { task: made.t3, title: 'Fixing T3' });
  await make(l, [
    { op: 'link', type: 'depends_on', from: made.late, to: made.early },
    { op: 'link', type: 'depends_on', from: made.t1, to: made.other },
  ]);
  const withSession = (await ask(l, 'tree', { root: made.p })) as any;
  assert.deepEqual(withSession.depends, [{ from: made.late, to: made.early }], 'only dependencies between things in the tree');
  const late = withSession.branches[1];
  assert.deepEqual([late.active, late.work[0].sessions[0].id], [true, session.run], 'an open session marks its task and the feature above it');

  await make(l, [{ op: 'link', type: 'part_of', from: made.loose, to: made.late }]);
  const placed = (await ask(l, 'tree', { root: made.p })) as any;
  assert.deepEqual([placed.unplaced.length, placed.branches[1].work.map((w: any) => w.title).sort()], [0, ['Loose', 'T3']], 'work given a feature sits under it, though still part of the project');
});

test('a project\'s unsettled questions are what needs settling in it, what holds up the most first', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Proj' },
    { op: 'create', ref: 'other', type: 'work.project', title: 'Other' },
    { op: 'create', ref: 'f', type: 'software.feature', title: 'Feature' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Task' },
    { op: 'create', ref: 'big', type: 'work.decision', title: 'Big', props: { options: ['A', 'B'] } },
    { op: 'create', ref: 'small', type: 'work.decision', title: 'Small' },
    { op: 'create', ref: 'old', type: 'work.decision', title: 'Old', status: 'decided', props: { outcome: 'Yes', rationale: 'Because' } },
    { op: 'create', ref: 'hyp', type: 'inquiry.hypothesis', title: 'Hyp' },
    { op: 'create', ref: 'exp', type: 'inquiry.experiment', title: 'Try it' },
    { op: 'create', ref: 'else', type: 'work.decision', title: 'Elsewhere' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 't', to: 'f' },
    { op: 'link', type: 'part_of', from: 'small', to: 'p' },
    { op: 'link', type: 'part_of', from: 'old', to: 'p' },
    { op: 'link', type: 'part_of', from: 'else', to: 'other' },
    // A question is a project's when it is part of it: one its work only depends on is named as what blocks that work.
    { op: 'link', type: 'part_of', from: 'big', to: 'p' },
    { op: 'link', type: 'part_of', from: 'hyp', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'f', to: 'big' },
    { op: 'link', type: 'depends_on', from: 't', to: 'f' },
    { op: 'link', type: 'inquiry.assumes', from: 't', to: 'hyp' },
    { op: 'link', type: 'inquiry.tests', from: 'exp', to: 'hyp' },
  ]);

  const unsettled = async (within: string) => (await attend(l, { within, reasons: ['unsettled', 'holding_up'] })).items.filter((x: any) => x.reasons.some((r: any) => r.why === 'unsettled'));
  const q = await unsettled(made.p);
  assert.deepEqual([q[0].title, ...q.slice(1).map((x: any) => x.title).sort()], ['Big', 'Hyp', 'Small'], 'what holds up the most comes first; another project\'s question is left out, and a settled one');
  assert.deepEqual(q[0].reasons, [{ why: 'holding_up', count: 2 }, { why: 'unsettled', by: 'word' }], 'found through what depends on it, counting what waits behind that');
  assert.deepEqual(q.find((x: any) => x.title === 'Hyp').reasons, [{ why: 'unsettled', by: 'evidence' }]);
  assert.deepEqual((await unsettled(made.other)).map((x: any) => x.title), ['Elsewhere']);

  await make(l, [{ op: 'update', id: made.big, status: 'decided', props: { outcome: 'A', decided_on: '2026-10-07' } }]);
  assert.deepEqual((await unsettled(made.p)).map((x: any) => x.title).sort(), ['Hyp', 'Small']);
});

test('a question in a project inside another is both projects\', and sits in the outer one at the top', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Parent' },
    { op: 'create', ref: 'sub', type: 'work.project', title: 'Area' },
    { op: 'create', ref: 'd', type: 'work.decision', title: 'Which way?' },
    { op: 'link', type: 'part_of', from: 'sub', to: 'p' },
    { op: 'link', type: 'part_of', from: 'd', to: 'sub' },
  ]);
  const within = async (id: string) => (await attend(l, { within: id, reasons: ['unsettled'] })).items.map((x: any) => [x.title, x.top.title]);
  assert.deepEqual(await within(made.p), [['Which way?', 'Parent']]);
  assert.deepEqual(await within(made.sub), [['Which way?', 'Parent']], 'its own page still answers');
});

test('an agent may settle its own work unreviewed, but only proposes the answer to a question', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'work.decision', title: 'Where do backups go?' },
    { op: 'create', ref: 'h', type: 'inquiry.hypothesis', title: 'Hooks run in the desktop app' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Wire the upload' },
  ]);
  // As in dev mode: nothing an agent does is reviewed.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
  const decided = l.registry.type('work.decision')!.statuses.closed[0];
  const settled = l.registry.type('inquiry.hypothesis')!.statuses.closed[0];

  assert.equal((await free.change(agent, { reason: 'did it', ops: [{ op: 'update', id: made.t, status: 'done' }] })).status, 'applied', 'its own task');
  assert.equal((await free.change(agent, { reason: 'a note', ops: [{ op: 'update', id: made.d, body: 'Supabase is set up.' }] })).status, 'applied', 'a note on a question');
  const answer = await free.change(agent, { reason: 'Backups have gone to Supabase Storage since the deployment', ops: [{ op: 'update', id: made.d, status: decided, props: { outcome: 'Supabase Storage' } }] });
  assert.equal(answer.status, 'proposed', 'the answer to a decision waits for the human');
  assert.equal((await free.change(agent, { reason: 'seen twice', ops: [{ op: 'update', id: made.h, status: settled }] })).status, 'proposed', 'and so does a hypothesis');
  assert.equal((await l.entity(made.d))!.status, 'open');

  await l.decide(human, { proposal: (answer as { proposal: string }).proposal, approve: true });
  const d = (await l.entity(made.d))!;
  assert.deepEqual([d.status, d.props.outcome], [decided, 'Supabase Storage'], 'one yes from the human and it is decided');
  assert.equal((await free.change(human, { reason: 'mine to settle', ops: [{ op: 'update', id: made.h, status: settled }] })).status, 'applied');
});

test('a held change that asks only for what is already so leaves the queue as superseded', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'work.decision', title: 'Where do backups go?' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Wire the upload' },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Prune old copies' },
  ]);
  const hold = async (ops: any[]) => ((await l.change(agent, { reason: 'held', ops })) as { proposal: string }).proposal;
  const answer = await hold([{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Supabase' } }]);
  const both = await hold([{ op: 'update', id: made.t, status: 'done' }, { op: 'update', id: made.u, status: 'done' }]);
  const more = await hold([{ op: 'update', id: made.t, status: 'done', body: 'With a note that is not there yet.' }]);
  const other = await hold([{ op: 'update', id: made.d, status: 'reversed' }]);

  // The human settles the decision and one of the two tasks themselves.
  const settled = await l.change(human, { reason: 'mine', ops: [{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Supabase Storage' } }, { op: 'update', id: made.t, status: 'done' }] });
  const pending = async () => (await l.proposals()).map((p) => p.id);
  assert.deepEqual(await pending(), [both, more, other], 'the answer already given is gone; what asks for more, or for something else, stays');
  const [gone] = await l.proposals({ status: 'superseded' });
  assert.deepEqual([gone.id, gone.note, gone.decided_by], [answer, `Already so since ${(settled as { changeset: string }).changeset}`, 'agent:pelago']);
  const said = (await l.events({ limit: 20 })).find((e: any) => e.action === 'proposal.supersede') as any;
  assert.deepEqual([said.detail.proposal, said.detail.by], [answer, (settled as { changeset: string }).changeset], 'and the log says what overtook it');

  await l.change(human, { reason: 'mine', ops: [{ op: 'update', id: made.u, status: 'done' }] });
  assert.deepEqual(await pending(), [more, other], 'once every part of it is so');
  await assert.rejects(l.decide(human, { proposal: answer, approve: true }), /already superseded/);
});

test('a backup holds every row, and restores into an empty database that then carries on', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'p', type: 'work.project', title: 'Proj', owner: 'me' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Task', props: { due: '2026-11-01' } },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await l.change(agent, { reason: 'waiting', ops: [{ op: 'create', type: 'work.note', title: 'Proposed' }] });

  const taken = await dump(l.db, { id: 'default', name: 'Default' }, { id: 'local', types: [] });
  const copy = new Archipelago(await openDb(), l.registry);
  const counts = await restore(copy.db, { ...JSON.parse(JSON.stringify(taken)), vault: await dumpVault(l.db) });
  assert.deepEqual([counts.entity, counts.relation, counts.proposal], [3, 1, 1]);
  // What the change sets did is read from the restored log again, not restored as events.
  const logged = new Set(taken.tables.log_entry.map((e) => e.id));
  assert.equal(counts.event, taken.tables.event.filter((e) => !logged.has(e.changeset)).length);
  assert.equal(counts.log_entry, taken.tables.log_entry.length);

  const task = (await copy.get(made.t)) as any;
  assert.deepEqual([task.entity.title, task.entity.props.due, task.outgoing[0].title], ['Task', '2026-11-01', 'Proj']);
  assert.equal((await copy.proposals()).length, 1, 'what was waiting for review still is');
  const before = Math.max(...taken.tables.event.map((e) => e.seq as number));
  await make(copy, [{ op: 'create', type: 'work.note', title: 'After the restore' }]);
  assert.ok((await lastSeq(copy.db)) > before, 'new events are numbered after the restored ones');
  await assert.rejects(restore(copy.db, taken), /not empty/);
});

