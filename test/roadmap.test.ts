import assert from 'node:assert/strict';
import { dumpVault } from '../src/vault.ts';
import { test } from 'node:test';
import { dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { pictureOf } from '../src/lens.ts';
import { Archipelago, type Op } from '../src/pelago.ts';
import { sessionStart } from '../src/sessions.ts';
import { askView } from '../src/askview.ts';
import { human, agent, fresh, attend, make } from './map.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

test('what needs the person a lens is answered for is lit by attention: what waits on them, and what is due, theirs to confirm or theirs to settle', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 'waits', type: 'work.task', title: 'Waits' },
    { op: 'create', ref: 'due', type: 'work.task', title: 'Due', props: { due: '2020-01-01' } },
    { op: 'create', ref: 'calm', type: 'work.task', title: 'Calm' },
    { op: 'link', type: 'part_of', from: 'waits', to: 'p' },
    { op: 'link', type: 'part_of', from: 'due', to: 'p' },
    { op: 'link', type: 'part_of', from: 'calm', to: 'p' },
    { op: 'link', type: 'waits_on', from: 'waits', to: 'ann' },
  ]);
  await l.db.query(`insert into setting (key, value) values ('me', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(made.ann)]);
  const answer = (await ask(l, 'lens', {})) as any;
  const item = (title: string) => answer.items.find((i: any) => i.title === title);
  assert.equal(answer.viewer, made.ann);
  assert.deepEqual(['Waits', 'Due', 'Calm'].map((t) => item(t).state.needs_you), [true, true, false], 'due work owned by no one is the owner’s, though it waits on nobody');
  assert.deepEqual([item('P').within.needs_you, item('P').within.waits_on[made.ann]], [2, 1], 'counted inside the same way');
});

test('a lens answers with one shape of data: what is inside what, the same counts at every depth, links moved up, and what was left out', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Q' },
    { op: 'create', ref: 'late', type: 'software.feature', title: 'Late', props: { order: 2 } },
    { op: 'create', ref: 'early', type: 'software.feature', title: 'Early', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
    { op: 'create', ref: 'c', type: 'work.task', title: 'C' },
    { op: 'create', ref: 'd', type: 'work.task', title: 'D' },
    { op: 'create', ref: 'e', type: 'work.task', title: 'E', status: 'done' },
    { op: 'create', ref: 'x', type: 'work.task', title: 'X' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'link', type: 'part_of', from: 'early', to: 'p' },
    { op: 'link', type: 'part_of', from: 'late', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'early' },
    { op: 'link', type: 'part_of', from: 'b', to: 'early' },
    { op: 'link', type: 'part_of', from: 'e', to: 'early' },
    { op: 'link', type: 'part_of', from: 'c', to: 'p' },
    { op: 'link', type: 'part_of', from: 'x', to: 'q' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'c' },
    { op: 'link', type: 'depends_on', from: 'x', to: 'a' },
    { op: 'link', type: 'waits_on', from: 'b', to: 'sam' },
  ]);
  const run = async (params: Record<string, unknown> = {}) => (await ask(l, 'lens', params)) as any;
  const titles = (answer: any) => answer.items.map((i: any) => i.title).sort();
  const item = (answer: any, title: string) => answer.items.find((i: any) => i.title === title);
  const name = (answer: any, id: string) => answer.items.find((i: any) => i.id === id)?.title;
  const links = (answer: any) => answer.links.map((k: any) => `${name(answer, k.from)} ${k.kind} ${name(answer, k.to)} x${k.n}`).sort();

  // The whole map, as it opens: what is finished and what the organising link does not touch are counted, not sent.
  const whole = await run();
  assert.deepEqual(titles(whole), ['A', 'B', 'C', 'Early', 'Late', 'P', 'Q', 'X']);
  assert.deepEqual([whole.rest.closed, whole.rest.unlinked], [1, 2], 'E is finished; D and Sam are part of nothing');
  assert.deepEqual([whole.lens.by, whole.lens.over, whole.lens.fold], ['part_of', ['depends_on', 'waits_on'], ['closed', 'system', 'unlinked']], 'the lens as it was read comes back');
  assert.deepEqual(Object.keys(item(whole, 'P')), Object.keys(item(whole, 'A')), 'a thing with parts carries the same keys as one without');
  assert.deepEqual(Object.keys(item(whole, 'P').within), Object.keys(item(whole, 'A').within));
  assert.deepEqual([item(whole, 'P').inside, item(whole, 'Early').inside, item(whole, 'A').inside], [null, made.p, made.early]);
  const inP = item(whole, 'P').within;
  assert.deepEqual([inP.items, inP.blocked, inP.waiting, inP.waits_on, inP.not_sent], [5, 2, 1, { [made.sam]: 1 }, 0], 'what is inside it, counted as each says of itself');
  assert.deepEqual([item(whole, 'A').state.blocked, item(whole, 'B').state.waits_on, item(whole, 'C').state.blocked], [true, [made.sam], false]);
  assert.deepEqual(['Early', 'Late', 'C'].map((t) => item(whole, t).place), [1, 2, 3], 'beside each other by the ordering field, then as written down');
  assert.deepEqual(links(whole), ['A depends_on C x1', 'X depends_on A x1'], 'a link to what was not sent is not sent');

  // One step down: what was cut is still counted, and its links are moved up to what stands for it.
  const near = await run({ far: 1 });
  assert.deepEqual(titles(near), ['C', 'Early', 'Late', 'P', 'Q', 'X']);
  assert.equal(near.rest.far, 2);
  assert.deepEqual([item(near, 'Early').within.items, item(near, 'Early').within.not_sent, item(near, 'Early').within.blocked], [2, 2, 2]);
  assert.deepEqual(links(near), ['Early depends_on C x1', 'X depends_on Early x1']);

  // Around one item: what is inside it, and whatever any kind of link ties to those, filed by the link that ties it to the start.
  const around = await run({ from: made.early, over: 'all', lanes: 'link' });
  assert.deepEqual(titles(around), ['A', 'B', 'C', 'Early', 'P', 'Sam', 'X']);
  assert.deepEqual(['A', 'P', 'C'].map((t) => item(around, t).lane), ['part_of:in', 'part_of', null], 'the kind of link and which way it runs');
  const asItOpens = await run({ from: made.early });
  assert.deepEqual([asItOpens.view, asItOpens.lens.lanes, ['A', 'B'].every((t) => titles(asItOpens).includes(t))], [null, undefined, true], 'held by nothing itself (its parts are), it opens on what is in it');
  await make(l, [{ op: 'create', ref: 'n', type: 'work.note', title: 'About A' }, { op: 'link', type: 'about', from: 'n', to: made.a }, { op: 'create', ref: 'm', type: 'work.note', title: 'About Early' }, { op: 'link', type: 'about', from: 'm', to: made.early }]);
  assert.deepEqual(titles(await run({ from: made.early, over: 'all' })).filter((t: string) => t.startsWith('About')), ['About Early'], 'what is linked to the start is brought in; what is only linked to something inside it is not');
  assert.deepEqual(links(around), ['A depends_on C x1', 'B waits_on Sam x1', 'X depends_on A x1'], 'what is inside what is said by inside, not by a link as well');

  // Lanes by stage, with what is finished unfolded; and kinds.
  const staged = await run({ from: made.p, lanes: 'stage', fold: [] });
  assert.deepEqual(['Early', 'Late', 'E'].map((t) => item(staged, t).lane), ['under_way', 'to_come', 'done']);
  const tasks = await run({ kinds: ['work.task'], fold: ['closed', 'system'] });
  assert.deepEqual([titles(tasks), tasks.rest.kinds], [['A', 'B', 'C', 'D', 'X'], 7], 'the two projects, two features, Sam and the two notes are not tasks');
  const tasksOfP = await run({ from: made.p, kinds: ['work.task'], over: [] });
  assert.deepEqual([titles(tasksOfP), item(tasksOfP, 'A').inside, item(tasksOfP, 'P').within.items], [['A', 'B', 'C', 'P'], made.p, 3], 'of some kinds only, a thing sits in the nearest thing kept above it: the feature between is not drawn, and its tasks are not lost');

  await assert.rejects(run({ by: 'nope' }), /unknown kind of link/);
  await assert.rejects(run({ fold: ['everything'] }), /fold must be of/);
  await assert.rejects(run({ from: 'e_nothing0' }), /No item/);

  // The packs' presets first: with nothing kept on the map, a picture is drawn in the core pack's house style.
  const house = { id: 'core.house', title: 'House style', preset: 'core.house' };
  assert.deepEqual([whole.style.shape, whole.style.lit, whole.style.open, whole.kept], ['list', 'all', 1, { lens: [], style: [house] }]);
  // Kept on the map: the workspace's lens and style (about nothing), then those about what the picture starts from, then what is asked.
  const drawn = await make(l, [
    { op: 'create', ref: 'wl', type: 'lens', title: 'As it opens', props: { far: 1 } },
    { op: 'create', ref: 'pl', type: 'lens', title: 'P in full', props: { far: 2, over: ['depends_on'] } },
    { op: 'create', ref: 'ws', type: 'style', title: 'House style', props: { shape: 'list', open: 1, colors: { sea: '#f0f4f5' } } },
    { op: 'create', ref: 'ps', type: 'style', title: 'P opened', props: { open: 2 } },
    { op: 'create', ref: 'spare', type: 'style', title: 'Spare', status: 'retired', props: { shape: 'flow' } },
    { op: 'link', type: 'about', from: 'pl', to: made.p },
    { op: 'link', type: 'about', from: 'ps', to: made.p },
  ]);
  const opened = await run();
  assert.deepEqual([opened.lens.far, titles(opened), opened.style.shape, opened.style.open, opened.style.colors], [1, ['C', 'Early', 'Late', 'P', 'Q', 'X'], 'list', 1, { sea: '#f0f4f5' }], 'the workspace’s own, and they are not items of the picture');
  // A named set (sizes, colours) is merged name by name: a style that sets one size keeps the house style's others.
  assert.equal(typeof opened.style.sizes.flow_layer_gap, 'number');
  assert.deepEqual(opened.kept, { lens: [{ id: drawn.wl, title: 'As it opens' }], style: [house, { id: drawn.ws, title: 'House style' }] });
  const ofP = await run({ from: made.p });
  assert.deepEqual([ofP.lens.far, ofP.lens.over, ofP.style.open, ofP.style.shape], [2, ['depends_on'], 2, 'list'], 'a field the nearer one names replaces it; one it does not falls through');
  assert.deepEqual(ofP.kept.style.map((k: any) => k.title), ['House style', 'House style', 'P opened']);
  // The owner's version of a preset: its fields over the preset's, in its place; retired, the preset is not used.
  const mine = await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Mine', props: { preset: 'core.house', lit: 'blocked' } }]);
  const versioned = await run();
  assert.deepEqual([versioned.style.lit, versioned.style.shape, versioned.kept.style[0]], ['blocked', 'list', { id: mine.v, title: 'Mine', preset: 'core.house' }]);
  await make(l, [{ op: 'update', id: mine.v, status: 'retired' }]);
  assert.deepEqual((await run()).kept.style.map((k: any) => k.title), ['House style'], 'retired, the preset is not used');
  await make(l, [{ op: 'update', id: mine.v, status: 'current' }, { op: 'update', id: mine.v, props: { lit: null } }]);
  // A style kept on a kind is how every such item's pictures look: over the workspace's, under the item's own.
  const onKind = await make(l, [{ op: 'create', ref: 'k', type: 'style', title: 'Projects', props: { on: ['work.project'], open: 3, radius: 4, sizes: { list_row: 40 } } }]);
  const kinded = await run({ from: made.p });
  assert.deepEqual([kinded.style.sizes.list_row, typeof kinded.style.sizes.flow_layer_gap], [40, 'number'], 'one size changed, the house style keeps the rest');
  assert.deepEqual([kinded.style.open, kinded.style.radius], [2, 4], "the item's own over its kind's, the kind's over the workspace's");
  await make(l, [{ op: 'archive', id: onKind.k }]);
  assert.equal((await run({ from: made.p, far: 0 })).lens.far, 0, 'what is asked for the moment weighs most');
  assert.equal((await run({ style: drawn.spare })).style.shape, 'flow', 'a style named outright is used, retired or not');
  await assert.rejects(run({ style: 'e_nothing0' }), /No style/);
  // Each lens about an item is a view of it, in order; one that starts somewhere else is a shortcut; and the lens is said in words.
  const more = await make(l, [
    { op: 'create', ref: 'road', type: 'lens', title: 'Roadmap', props: { place: 1, kinds: ['software.feature'], far: 1, controls: ['lit', 'far', 'nonsense'] } },
    { op: 'create', ref: 'go', type: 'lens', title: 'Go to Q', props: { place: 9, from: made.q, far: 0 } },
    { op: 'link', type: 'about', from: 'road', to: made.p },
    { op: 'link', type: 'about', from: 'go', to: made.p },
  ]);
  const hubP = await run({ from: made.p });
  assert.deepEqual(hubP.views.map((v: any) => [v.title, v.to?.title]), [['Roadmap', undefined], ['Go to Q', 'Q'], ['P in full', undefined], ['As it opens', undefined]], 'its own by place, then those with none, then the workspace\u2019s: every lens that applies can be chosen');
  assert.equal((await run({ from: made.p, lens: drawn.wl })).lens.far, 1, 'the workspace\u2019s view, chosen for this item');
  assert.deepEqual([hubP.view, hubP.lens.kinds, hubP.controls, titles(hubP)], [more.road, ['software.feature'], ['lit', 'far'], ['Early', 'Late', 'P']], 'it opens on the first');
  assert.equal((await run({ from: made.p, lens: drawn.pl })).lens.far, 2, 'another view is asked for by its id');
  const gone = await run({ from: made.p, lens: more.go });
  assert.deepEqual([gone.lens.from, titles(gone), gone.view], [made.q, ['Q'], more.go], 'a shortcut is a view that starts somewhere else, tightly scoped');
  assert.match(hubP.said, /^"P" and what is part of it; 1 step down; only software\.feature; .*without what is finished/);
  assert.deepEqual([(await run()).views, (await run()).view], [[{ id: drawn.wl, title: 'As it opens' }], drawn.wl], 'the whole map has the workspace\u2019s views');
  // An item with no picture of its own, held by nothing, opens on what is in it: not on a view of the workspace's, and never on a shortcut.
  const plainQ = await run({ from: made.q });
  assert.deepEqual([plainQ.view, plainQ.lens.over, plainQ.lens.lanes, plainQ.views.map((v: any) => v.title)], [null, ['depends_on', 'waits_on'], undefined, ['As it opens']]);
  assert.equal((await run({ from: made.q, lens: 'around' })).view, null, '"around", gone since 18 Oct, is read as no view at all');
  assert.equal((await run({ from: made.q, lens: drawn.wl })).view, drawn.wl, 'the workspace\u2019s view can still be chosen');
  const onlyShortcut = await make(l, [
    { op: 'create', ref: 's', type: 'lens', title: 'To P', props: { from: made.p, far: 0 } },
    { op: 'link', type: 'about', from: 's', to: made.q },
  ]);
  assert.equal((await run({ from: made.q })).view, null, 'a shortcut is never what an item opens on');
  await make(l, [{ op: 'archive', id: onlyShortcut.s }]);

  // A hub is an item that holds enough to need views of its own: how much is enough is its project's to say.
  assert.deepEqual([hubP.hub, ((await ask(l, 'hubs', {})) as any).hubs], [{ is: false }, []], 'six things are not twelve');
  await make(l, [{ op: 'update', id: made.p, props: { hub_at: 2 } }]);
  const found = ((await ask(l, 'hubs', {})) as any).hubs.map((h: any) => [h.title, h.inside, h.at, h.views]);
  assert.deepEqual(found, [['P', 5, 2, 3], ['Early', 2, 2, 0]], 'while a project is shaped, most of what is in it is a hub; Q is another project and keeps the usual size');
  assert.deepEqual((await run({ from: made.early })).hub, { is: true, inside: 2, at: 2 });

  // Code in a style runs in the browser of whoever looks: an agent that writes it proposes it, whatever else agents may do unreviewed.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', merge: 'auto' });
  const plain = await free.change(agent, { reason: 'a colour', ops: [{ op: 'update', id: drawn.ws, props: { radius: 4 } }] });
  const coded = await free.change(agent, { reason: 'a drawing', ops: [{ op: 'update', id: drawn.ws, props: { code: 'export default () => {}' } }] });
  const born = await free.change(agent, { reason: 'a drawing', ops: [{ op: 'create', type: 'style', title: 'Mine', props: { code: 'export default () => {}' } }] });
  const folded = await free.change(agent, { reason: 'fold', ops: [{ op: 'merge', keep: drawn.ws, drop: drawn.spare }] });
  assert.deepEqual([plain.status, coded.status, born.status, folded.status], ['applied', 'proposed', 'proposed', 'proposed']);
  assert.equal((await run()).style.code, undefined, 'and until the human approves it, the picture is drawn without it');
  assert.equal((await free.change(human, { reason: 'mine', ops: [{ op: 'update', id: drawn.ws, props: { code: 'export default () => {}' } }] })).status, 'applied');
  await make(l, [{ op: 'update', id: drawn.ws, props: { code: null, radius: null } }]);
  assert.deepEqual([await pictureOf(l, drawn.ps), await pictureOf(l, drawn.ws), await pictureOf(l, made.a)], [`graph?from=${made.p}`, 'graph?lens', undefined], 'a style is seen at work in the picture it is about');
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
  assert.equal(counts.event, taken.tables.event.length);

  const task = (await copy.get(made.t)) as any;
  assert.deepEqual([task.entity.title, task.entity.props.due, task.outgoing[0].title], ['Task', '2026-11-01', 'Proj']);
  assert.equal((await copy.proposals()).length, 1, 'what was waiting for review still is');
  const before = Math.max(...taken.tables.event.map((e) => e.seq as number));
  await make(copy, [{ op: 'create', type: 'work.note', title: 'After the restore' }]);
  const { rows } = await copy.db.query<{ seq: number }>(`select max(seq)::int as seq from event`);
  assert.ok(rows[0].seq > before, 'new events are numbered after the restored ones');
  await assert.rejects(restore(copy.db, taken), /not empty/);
});

