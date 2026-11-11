// How a picture is styled, what a hub is, what in an item is unsettled, what an agent may settle, a held change overtaken,
// and a backup: the kernel's, on core's types. What a pack would add (a field saying when an item is a hub) is a small
// pack of the test's own (SHAPING).

import assert from 'node:assert/strict';
import { dumpVault } from '../src/vault.ts';
import { test } from 'node:test';
import { dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { pictureOf } from '../src/query-kept.ts';
import { Archipelago, type Op } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { askView } from '../src/askview.ts';
import { lastSeq } from '../src/eventlog.ts';
import { human, agent, fresh, freshWith, attend, make, packsWith } from './map.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

/** Work that says how much an item in it holds before it is a hub, as a pack's type of work may. */
const SHAPING = {
  id: 'shaping', version: '1', title: 'Shaping', requires: ['core'],
  types: [{ id: 'effort', title: 'Effort', description: 'A body of work with an end.', extends: 'task', fields: { hub_at: { type: 'number' } } }],
} as PackFile;
/** A map with core's packs alone and the test's (and sessions and canvas, split out of core): the styles it draws in are theirs, and no other pack's. */
const coreOnly = async () => {
  const l = await freshWith(new Registry(packsWith(SHAPING), ['core', 'sessions', 'canvas', 'shaping']));
  // The canvas preset that lies over the workspace's style is taken back by the owner, so the layers below show.
  await make(l, [{ op: 'create', type: 'style', title: 'Canvas', status: 'retired', props: { preset: 'canvas.house' } }]);
  return l;
};

test('a picture is drawn in the styles kept for it, nearest last; hubs, code and where a kept view is seen', async () => {
  const l = await coreOnly();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'effort', title: 'P' },
    { op: 'create', ref: 'q', type: 'effort', title: 'Q' },
    { op: 'create', ref: 'late', type: 'task', title: 'Late' },
    { op: 'create', ref: 'early', type: 'task', title: 'Early', status: 'doing' },
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'task', title: 'B' },
    { op: 'create', ref: 'c', type: 'task', title: 'C' },
    { op: 'link', type: 'part_of', from: 'early', to: 'p' },
    { op: 'link', type: 'part_of', from: 'late', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'early' },
    { op: 'link', type: 'part_of', from: 'b', to: 'early' },
    { op: 'link', type: 'part_of', from: 'c', to: 'p' },
  ]);
  const run = async (params: Record<string, unknown> = {}) => (await ask(l, 'style', params)) as any;
  // The packs' presets first: with nothing kept on the map, a view is drawn in the house style (canvas's, moved from core with its id), with the
  // marks of a session's state over it.
  const house = { id: 'core.house', title: 'House style', preset: 'core.house' };
  const added = [{ id: 'core.sessions_look', title: "A session's state", preset: 'core.sessions_look' }];
  const whole = await run();
  assert.deepEqual([whole.style.shape, whole.style.lit, whole.style.open, whole.used], ['map', 'all', 1, [house, ...added]]);
  // Kept on the map: the workspace's style (about nothing), then those about what the picture is of, then one named.
  const drawn = await make(l, [
    { op: 'create', ref: 'ws', type: 'style', title: 'House style', props: { shape: 'grid', open: 1, colors: { sea: '#f0f4f5' } } },
    { op: 'create', ref: 'ps', type: 'style', title: 'P opened', props: { open: 2 } },
    { op: 'create', ref: 'spare', type: 'style', title: 'Spare', status: 'retired', props: { shape: 'map' } },
    { op: 'link', type: 'about', from: 'ps', to: made.p },
  ]);
  const opened = await run();
  assert.deepEqual([opened.style.shape, opened.style.open, opened.style.colors], ['grid', 1, { sea: '#f0f4f5' }], 'the workspace’s own, over the presets');
  // A named set (sizes, colours) is merged name by name: a style that sets one size keeps the house style's others.
  assert.equal(typeof opened.style.sizes.flow_layer_gap, 'number');
  assert.deepEqual(opened.used, [house, ...added, { id: drawn.ws, title: 'House style' }]);
  const ofP = await run({ of: made.p });
  assert.deepEqual([ofP.style.open, ofP.style.shape], [2, 'grid'], 'a field the nearer one names replaces it; one it does not falls through');
  assert.deepEqual(ofP.used.map((k: any) => k.title), ['House style', ...added.map((a) => a.title), 'House style', 'P opened']);
  // The owner's version of a preset: its fields over the preset's, in its place; retired, the preset is not used.
  const mine = await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Mine', props: { preset: 'core.house', lit: 'blocked' } }]);
  const versioned = await run();
  assert.deepEqual([versioned.style.lit, versioned.style.shape, versioned.used[0]], ['blocked', 'grid', { id: mine.v, title: 'Mine', preset: 'core.house' }]);
  await make(l, [{ op: 'update', id: mine.v, status: 'retired' }]);
  assert.deepEqual((await run()).used.map((k: any) => k.title), [...added.map((a) => a.title), 'House style'], 'retired, the preset is not used');
  await make(l, [{ op: 'update', id: mine.v, status: 'current' }, { op: 'update', id: mine.v, props: { lit: null } }]);
  // A style kept on a kind is how every such item's pictures look: over the workspace's, under the item's own.
  const onKind = await make(l, [{ op: 'create', ref: 'k', type: 'style', title: 'Efforts', props: { on: ['effort'], open: 3, radius: 4, sizes: { list_row: 40 } } }]);
  const kinded = await run({ of: made.p });
  assert.deepEqual([kinded.style.sizes.list_row, typeof kinded.style.sizes.flow_layer_gap], [40, 'number'], 'one size changed, the house style keeps the rest');
  assert.deepEqual([kinded.style.open, kinded.style.radius], [2, 4], "the item's own over its kind's, the kind's over the workspace's");
  await make(l, [{ op: 'archive', id: onKind.k }]);
  assert.equal((await run({ style: drawn.spare })).style.shape, 'map', 'a style named outright is used, retired or not');
  await assert.rejects(run({ style: 'e_nothing0' }), /No style/);

  // A view kept about an item: what it holds of how it is drawn lies over the rest, and a style about it says nothing.
  const kept = await make(l, [
    { op: 'create', ref: 'road', type: 'lens', title: 'Roadmap', props: { place: 1, filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 }, style: { shape: 'map', open: 4 } } },
    { op: 'link', type: 'about', from: 'road', to: made.p },
    { op: 'create', ref: 'rs', type: 'style', title: 'Road opened', props: { open: 9 } },
    { op: 'link', type: 'about', from: 'rs', to: 'road' },
  ]);
  const { keptPicture } = await import('../src/query-saved.ts');
  const road = await keptPicture(l, kept.road);
  assert.deepEqual([road.items.map((i) => i.title).sort(), road.style.shape, road.style.open], [['C', 'Early', 'Late', 'P'], 'map', 4]);

  // A hub is an item that holds enough to need views of its own: how much is enough is its effort's to say.
  assert.deepEqual(((await ask(l, 'hubs', { within: made.p })) as any).hubs, [], 'five things are not twelve');
  await make(l, [{ op: 'update', id: made.p, props: { hub_at: 2 } }]);
  const found = ((await ask(l, 'hubs', { within: made.p })) as any).hubs.map((h: any) => [h.title, h.inside, h.at, h.views]);
  assert.deepEqual(found, [['P', 5, 2, 1], ['Early', 2, 2, 0]], 'while an effort is shaped, most of what is in it is a hub');
  await assert.rejects(ask(l, 'hubs', {}), /within an item or a place/, 'across the whole map, hubs are not read');

  // Code runs in the browser of whoever looks (a layout's, a style's page CSS): an agent that writes it proposes it, whatever else agents may do unreviewed.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', merge: 'auto' });
  const plain = await free.change(agent, { reason: 'a colour', ops: [{ op: 'update', id: drawn.ws, props: { radius: 4 } }] });
  const coded = await free.change(agent, { reason: 'a page', ops: [{ op: 'update', id: drawn.ws, props: { page_css: 'h2 { color: red }' } }] });
  await assert.rejects(free.change(agent, { reason: 'a drawing', ops: [{ op: 'update', id: drawn.ws, props: { code: 'export default () => {}' } }] }), /style has no field "code"/, 'a style holds no code: a layout does');
  const born = await free.change(agent, { reason: 'a drawing', ops: [{ op: 'create', type: 'layout', title: 'Mine', props: { code: 'export default () => {}' } }] });
  const folded = await free.change(agent, { reason: 'fold', ops: [{ op: 'merge', keep: drawn.ws, drop: drawn.spare }] });
  assert.deepEqual([plain.status, coded.status, born.status, folded.status], ['applied', 'proposed', 'proposed', 'proposed']);
  assert.equal((await run()).style.page_css, undefined, 'and until the human approves it, the page is drawn without it');
  assert.deepEqual([await pictureOf(l, drawn.ps), await pictureOf(l, drawn.ws), await pictureOf(l, kept.road), await pictureOf(l, made.a)], [`graph?from=${made.p}`, 'graph?lens', `v?canvas=${kept.road}`, undefined], 'a style is seen at work in the picture it is about, a kept view as itself');
});

test('an item\'s unsettled questions are what needs settling in it, what holds up the most first', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Proj' },
    { op: 'create', ref: 'other', type: 'task', title: 'Other' },
    { op: 'create', ref: 'f', type: 'task', title: 'Feature' },
    { op: 'create', ref: 't', type: 'task', title: 'Task' },
    { op: 'create', ref: 'big', type: 'decision', title: 'Big', props: { options: ['A', 'B'] } },
    { op: 'create', ref: 'small', type: 'decision', title: 'Small' },
    { op: 'create', ref: 'old', type: 'decision', title: 'Old', status: 'decided', props: { outcome: 'Yes', rationale: 'Because' } },
    { op: 'create', ref: 'else', type: 'decision', title: 'Elsewhere' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 't', to: 'f' },
    { op: 'link', type: 'part_of', from: 'small', to: 'p' },
    { op: 'link', type: 'part_of', from: 'old', to: 'p' },
    { op: 'link', type: 'part_of', from: 'else', to: 'other' },
    // A question is an item's when it is part of it: one its work only depends on is named as what blocks that work.
    { op: 'link', type: 'part_of', from: 'big', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'f', to: 'big' },
    { op: 'link', type: 'depends_on', from: 't', to: 'f' },
  ]);

  const unsettled = async (within: string) => (await attend(l, { within, reasons: ['unsettled', 'holding_up'] })).items.filter((x: any) => x.reasons.some((r: any) => r.why === 'unsettled'));
  const q = await unsettled(made.p);
  assert.deepEqual(q.map((x: any) => x.title), ['Big', 'Small'], 'what holds up the most comes first; another item\'s question is left out, and a settled one');
  assert.deepEqual(q[0].reasons, [{ why: 'holding_up', count: 2 }, { why: 'unsettled', by: 'word' }], 'found through what depends on it, counting what waits behind that');
  assert.deepEqual((await unsettled(made.other)).map((x: any) => x.title), ['Elsewhere']);

  await make(l, [{ op: 'update', id: made.big, status: 'decided', props: { outcome: 'A', decided_on: '2026-10-07' } }]);
  assert.deepEqual((await unsettled(made.p)).map((x: any) => x.title), ['Small']);
});

test('a question in an item inside another is both items\', and sits in the outer one at the top', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Parent' },
    { op: 'create', ref: 'sub', type: 'task', title: 'Area' },
    { op: 'create', ref: 'd', type: 'decision', title: 'Which way?' },
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
    { op: 'create', ref: 'd', type: 'decision', title: 'Where do backups go?' },
    { op: 'create', ref: 't', type: 'task', title: 'Wire the upload' },
  ]);
  // As in dev mode: nothing an agent does is reviewed.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
  const decided = l.registry.type('decision')!.statuses.closed[0];

  assert.equal((await free.change(agent, { reason: 'did it', ops: [{ op: 'update', id: made.t, status: 'done' }] })).status, 'applied', 'its own task');
  assert.equal((await free.change(agent, { reason: 'a note', ops: [{ op: 'update', id: made.d, body: 'Supabase is set up.' }] })).status, 'applied', 'a note on a question');
  const answer = await free.change(agent, { reason: 'Backups have gone to Supabase Storage since the deployment', ops: [{ op: 'update', id: made.d, status: decided, props: { outcome: 'Supabase Storage' } }] });
  assert.equal(answer.status, 'proposed', 'the answer to a decision waits for the human');
  assert.equal((await l.entity(made.d))!.status, 'open');

  await l.decide(human, { proposal: (answer as { proposal: string }).proposal, approve: true });
  const d = (await l.entity(made.d))!;
  assert.deepEqual([d.status, d.props.outcome], [decided, 'Supabase Storage'], 'one yes from the human and it is decided');
});

test('a held change that asks only for what is already so leaves the queue as superseded', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'decision', title: 'Where do backups go?' },
    { op: 'create', ref: 't', type: 'task', title: 'Wire the upload' },
    { op: 'create', ref: 'u', type: 'task', title: 'Prune old copies' },
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
  const { rows: said } = await l.db.query<{ rule: { outcome: string; proposal: string; by: string } }>(`select head->'rule' as rule from log_entry where stream = 'facts' and head->'rule'->>'proposal' = $1 and head->'rule'->>'outcome' = 'superseded'`, [answer]);
  assert.deepEqual(said.map((s) => s.rule.by), [(settled as { changeset: string }).changeset], 'and the log says what overtook it');

  await l.change(human, { reason: 'mine', ops: [{ op: 'update', id: made.u, status: 'done' }] });
  assert.deepEqual(await pending(), [more, other], 'once every part of it is so');
  await assert.rejects(l.decide(human, { proposal: answer, approve: true }), /already superseded/);
});

test('a backup holds every row, and restores into an empty database that then carries on', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'p', type: 'task', title: 'Proj', owner: 'me' },
    { op: 'create', ref: 't', type: 'task', title: 'Task', props: { due: '2026-11-01' } },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await l.change(agent, { reason: 'waiting', ops: [{ op: 'create', type: 'finding', title: 'Proposed', props: { value: 1, value_type: 'number' } }] });

  const taken = await dump(l.db, { id: 'default', name: 'Default' }, { id: 'local', types: [] });
  const copy = new Archipelago(await openDb(), l.registry);
  const counts = await restore(copy.db, { ...JSON.parse(JSON.stringify(taken)), vault: await dumpVault(l.db) });
  assert.deepEqual([counts.entity, counts.relation, counts.proposal], [3, 2, 1]); // part_of, and the project's owner
  // What the change sets did is read from the restored log again, not restored as events.
  const logged = new Set(taken.tables.log_entry.map((e) => e.id));
  assert.equal(counts.event, taken.tables.event.filter((e) => !logged.has(e.changeset)).length);
  assert.equal(counts.log_entry, taken.tables.log_entry.length);

  const task = (await copy.get(made.t)) as any;
  assert.deepEqual([task.entity.title, task.entity.props.due, task.outgoing[0].title], ['Task', '2026-11-01', 'Proj']);
  assert.equal((await copy.proposals()).length, 1, 'what was waiting for review still is');
  const before = Math.max(...taken.tables.event.map((e) => e.seq as number));
  await make(copy, [{ op: 'create', type: 'finding', title: 'After the restore' }]);
  assert.ok((await lastSeq(copy.db)) > before, 'new events are numbered after the restored ones');
  await assert.rejects(restore(copy.db, taken), /not empty/);
});

