// The page as a replica of the log: the projector the page runs (packs/log/kernel/project.ts, as the server serves it, its types
// stripped) makes the same rows from the log as the server's tables hold, row for row; the server reads the facts
// after a position only on what the caller holds and the islands it follows, as the viewer may see them; and the
// page's one store (ui/replica.js), shared by every view, folds an agent's change in once, tells every view holding
// what changed, and tells a view whose query may find something else to ask the server again (ui/membership.js).

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { KEPT_FIELDS } from '../packs/log/kernel/operational.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { factsAfter, headPos } from '../packs/log/kernel/tail.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { uiFile } from '../packs/surface/kernel/ui-files.ts';
import { undo } from '../packs/write/kernel/undo.ts';
import { agent, all, fresh, human, make } from './map.ts';
import { getItem } from '../packs/surface/kernel/map-reads.ts';

/** The page's modules as the server serves them, loaded from a folder of their own as the browser would load them. */
async function pageModules() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-replica-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['project.js', 'ghosts.js', 'membership.js', 'replica.js']) writeFileSync(join(dir, f), (await uiFile(f, null)).body as string);
  return {
    project: await import(pathToFileURL(join(dir, 'project.js')).href),
    replica: await import(pathToFileURL(join(dir, 'replica.js')).href),
    membership: await import(pathToFileURL(join(dir, 'membership.js')).href),
  };
}

/** What the page's projector and views ask of the types, as ui/live.js answers it from the schema. */
const kindsOf = (l: Archipelago) => ({
  ...l.registry,
  isOpen: (t: string, s: string) => l.registry.isOpen(t, s),
  type: (t: string) => l.registry.type(t),
  relationFamily: (...r: string[]) => r,
  shown: (t: string, k: string) => Boolean(l.registry.type(t)?.fields?.[k]?.shown),
  phase: (t: string, st: string) => l.registry.type(t)?.statuses.phases?.[st],
  lineage: (t: string) => l.registry.type(t)?.lineage.slice(1) ?? [],
  flavour: (k: string) => {
    const out: string[] = [];
    for (let r = l.registry.relations.get(k); r?.extends && !out.includes(r.extends); r = l.registry.relations.get(r.extends)) out.push(r.extends);
    return out;
  },
});

type Row = Record<string, any>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
const ITEM = ['id', 'type', 'kind', 'title', 'body', 'status', 'is_open', 'owner', 'visibility', 'confidence', 'source_id', 'private_to', 'created_at', 'updated_at', 'archived_at'];
const LINK = ['id', 'type', 'from_id', 'to_id', 'props', 'confidence', 'source_id', 'valid_from', 'valid_to'];
/** A row as both sides can say it: the columns compared, times as ISO strings, fields without what is kept outside the log. */
const itemOf = (r: Row) => ({
  ...Object.fromEntries(ITEM.map((c) => [c, iso(r[c] ?? null)])),
  props: Object.fromEntries(Object.entries(r.props ?? {}).filter(([k, v]) => v !== null && !KEPT_FIELDS.includes(k))),
});
const linkOf = (r: Row) => Object.fromEntries(LINK.map((c) => [c, iso(r[c] ?? null)]));
const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : 1);

test("the page's projector makes the server's rows from the log, row for row", async () => {
  const l = await fresh();
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Replica' },
    { op: 'create', ref: 'q', type: 'task', title: 'Elsewhere' },
    { op: 'create', ref: 't', type: 'task', title: 'Project in the page', owner: me, body: 'Facts in, rows out.' },
    { op: 'create', ref: 'u', type: 'task', title: 'Tail the log' },
    { op: 'create', ref: 'd', type: 'decision', title: 'Keep the pulse?' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'u', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'u', to: 't', props: { why: 'needs it' } },
    { op: 'link', type: 'depends_on', from: 'u', to: 'd' },
  ]);
  await make(l, [{ op: 'update', id: made.t, status: 'doing', props: { tokens_estimated: 40 } }, { op: 'update', id: made.t, append: 'Op by op.' }]);
  const asked = (await l.change(agent, { reason: 'Answer it', ops: [{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'No', rationale: 'The log holds it' } }] })) as { proposal: string };
  await l.decide(human, { proposal: asked.proposal, approve: true });
  const edit = (await l.change(human, { reason: 'Reshape', ops: [{ op: 'update', id: made.u, title: 'Tail it' }, { op: 'archive', id: made.u }] })) as { changeset: string };
  await undo(l, human, { changeset: edit.changeset });
  await make(l, [{ op: 'update', id: made.t, props: { tokens_estimated: null } }, { op: 'archive', id: made.q }]);
  const gone = await make(l, [{ op: 'create', ref: 'g', type: 'task', title: 'Forgotten', owner: me }, { op: 'link', type: 'link', from: 'g', to: made.t }]);
  const kept = await make(l, [{ op: 'create', ref: 'k', type: 'task', title: 'Kept one' }, { op: 'link', type: 'link', from: 'k', to: made.p }]);
  await make(l, [{ op: 'merge', keep: made.t, drop: kept.k }]);
  await make(l, [{ op: 'forget', id: gone.g }]);
  const link = ((await getItem(l, made.t)).outgoing as { type: string; relation: string }[]).find((o) => o.type === 'part_of')!;
  await make(l, [{ op: 'unlink', relation: link.relation }, { op: 'link', type: 'part_of', from: made.t, to: made.q }]);

  const { project } = (await pageModules()).project;
  const held = { items: new Map<string, Row>(), links: new Map<string, Row>() };
  for (const e of await all(l)) project(held, l.registry, e.at, e.facts, ['type.moved', 'kind.moved'].includes(e.action as string));
  const live = {
    items: (await l.db.query<Row>(`select * from entity order by id`)).rows.map(itemOf),
    links: (await l.db.query<Row>(`select * from relation order by id`)).rows.map(linkOf),
  };
  const page = { items: [...held.items.values()].map(itemOf).sort(byId), links: [...held.links.values()].map(linkOf).sort(byId) };
  assert.ok(live.items.length > 6 && live.links.length > 5);
  assert.ok(!held.items.has(gone.g), 'what is forgotten leaves');
  assert.deepEqual(page.items, live.items, 'every item, row for row');
  assert.deepEqual(page.links, live.links, 'every link, row for row');
});

test('the facts after a position are read only on what is held, as the viewer may see them', async () => {
  const l = await fresh();
  const people = await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }, { op: 'create', ref: 'bo', type: 'person', title: 'Bo' }]);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Held' },
    { op: 'create', ref: 'q', type: 'task', title: 'Not held' },
  ]);
  const mine = l.as(people.me);
  const shared = ((await mine.change(human, { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'task', title: 'Shared, held', visibility: 'shared' }] })) as { created: Record<string, string> }).created.s;
  const start = await headPos(l.db);
  await assert.rejects(factsAfter(l.db, { after: start, ids: [] }), /names the ids it holds/, 'a read that names nothing is refused');
  await assert.rejects(callTool(l, agent, 'tail', { after: start, ids: [made.p] }), /humans only/);

  // A task made under what is held comes with its link; a change to what is not held does not.
  const more = await make(l, [
    { op: 'create', ref: 't', type: 'task', title: 'New under it' },
    { op: 'link', type: 'part_of', from: 't', to: made.p },
    { op: 'update', id: made.q, title: 'Still not held' },
  ]);
  const read = await factsAfter(l.db, { after: start, ids: [made.p] });
  const named = new Set(read.entries.flatMap((e) => e.facts.map((f) => f[1])));
  assert.ok(named.has(more.t), 'the new item, made with a link to what is held');
  assert.ok(!named.has(made.q), 'not what was left alone');
  assert.ok(read.pos > start);
  assert.equal(read.made, 1);
  assert.deepEqual(await factsAfter(l.db, { after: read.pos, ids: [made.p] }), { pos: read.pos, entries: [], gone: [], made: 0 }, 'nothing since');

  // Bo holds the shared task; the owner makes it private to themself: Bo is told it is gone, and reads nothing of it.
  const bo = l.as(people.bo);
  assert.ok(await bo.entity(shared));
  const before = await headPos(l.db);
  await mine.change(human, { reason: 'test', ops: [{ op: 'update', id: shared, visibility: 'private', title: 'Mine now' }] });
  assert.equal(await bo.entity(shared), undefined);
  const theirs = await factsAfter(bo.db, { after: before, ids: [shared] });
  assert.deepEqual([theirs.entries, theirs.gone], [[], [shared]], 'nothing of what they may not see, and what they held of it is gone');
  const owners = await factsAfter(mine.db, { after: before, ids: [shared] });
  assert.ok(owners.entries.some((e) => e.facts.some((f) => f[2] === 'title' && f[3] === 'Mine now')), 'its owner reads it, opened');
});

test('a lens read to follow says where the log stood before it was read; asked plainly, it does not', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'p', type: 'task', title: 'Canvas' }]);
  const params = { filter: { find: [`id ${made.p}`] } };
  const before = await headPos(l.db);
  const followed = (await callTool(l, human, 'view', { name: 'flat', params: { ...params, follow: true } })) as any;
  assert.equal(followed.pos, before, 'the position the page plays the log from');
  assert.equal(((await callTool(l, human, 'view', { name: 'flat', params })) as any).pos, undefined);
  await assert.rejects(callTool(l, human, 'view', { name: 'flat', params: { ...params, follow: 'yes' } }), /follow must be true/);
});

test("an agent's change reaches a view of the store with no lens read; what may move its answer asks again", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Canvas' },
    { op: 'create', ref: 'a', type: 'task', title: 'Flat lens' },
    { op: 'create', ref: 'b', type: 'task', title: 'Tags' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
  ]);
  const { Store, View } = (await pageModules()).replica;
  const lens = { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 } };
  const read = () => callTool(l, human, 'view', { name: 'flat', params: lens }) as Promise<any>;
  const tail = (input: Record<string, unknown>) => callTool(l, human, 'tail', input) as Promise<any>;

  const store = new Store(kindsOf(l));
  const view = store.keep(new View(store));
  view.hold(await read(), (await tail({})).pos);
  const heard: any[] = [];
  view.on((changed: unknown) => heard.push(changed));

  // An agent renames a task, adds one under the hub, and ends a link: approved, as under `npm start`.
  const asked = (await l.change(agent, {
    reason: 'Rework the canvas',
    ops: [
      { op: 'update', id: made.a, title: 'A flat lens', status: 'doing' },
      { op: 'create', ref: 'c', type: 'task', title: 'Replica' },
      { op: 'link', type: 'part_of', from: 'c', to: made.p },
    ],
  })) as { proposal: string };
  await l.decide(human, { proposal: asked.proposal, approve: true });
  // And one applied as it is made, where the workspace lets agents' changes through.
  const loose = new Archipelago(l.db, l.registry, { update: 'auto', archive: 'auto' });
  assert.equal((await loose.change(agent, { reason: 'Archive it', ops: [{ op: 'archive', id: made.b }] })).status, 'applied');

  const changed = store.apply(await tail({ after: store.pos, ids: store.ids() }));
  assert.equal(view.item(made.a).title, 'A flat lens');
  assert.equal(view.item(made.a).status, 'doing');
  assert.equal(view.item(made.b), undefined, 'the archived task leaves the answer');
  assert.deepEqual([changed.items.changed.includes(made.a), changed.items.removed], [true, [made.b]]);
  assert.equal(heard.length, 1, 'listeners are told once');
  assert.equal(heard[0].ask, true, 'a new task linked under the hub may be found by the walk: the view asks again');
  assert.equal(view.answer().items.some((i: any) => i.title === 'Replica'), false, 'the store never judges what the query finds');
  assert.ok(![...store.items.values()].some((r: any) => r.title === 'Replica'), 'what no view holds is not kept');

  // Asked again, the view holds what the server finds: the store's rows, current, and the answer's own new ones.
  const pos = (await tail({})).pos;
  const again = await read();
  view.hold(again, pos);
  // As the page has both: over the wire, times are strings.
  const pick = (a: any) => JSON.parse(JSON.stringify({ items: [...a.items].sort(byId), links: [...a.links].sort(byId) }));
  assert.deepEqual(pick(view.answer()), pick(again));
  assert.deepEqual([view.item(made.p).found, view.item(made.a).step], [['id'], 1], 'what it holds keeps why it was there');
});

test('two views share one store: a fact folds in once and both are told; each asks again only for what its query reads', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Panes' },
    { op: 'create', ref: 'a', type: 'task', title: 'Shared item' },
    { op: 'create', ref: 'b', type: 'task', title: 'Only in the walk' },
    { op: 'create', ref: 'x', type: 'task', title: 'Not in either' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
  ]);
  const { Store, View, follow, unfollow } = (await pageModules()).replica;
  const tail = (input: Record<string, unknown>) => callTool(l, human, 'tail', input) as Promise<any>;
  const flat = (lens: unknown) => callTool(l, human, 'view', { name: 'flat', params: lens }) as Promise<any>;
  const store = new Store(kindsOf(l));
  const open = async (lens: unknown) => {
    const pos = (await tail({})).pos;
    const view = follow(new View(store));
    view.hold(await flat(lens), pos);
    const heard: any[] = [];
    view.on((c: unknown) => heard.push(c));
    return { view, heard };
  };
  const walk = await open({ filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 } });
  const one = await open({ filter: { find: [`id ${made.a}`] } });
  assert.equal(store.items.size, 3, 'the item both hold is held once');
  const beat = async () => store.apply(await tail({ after: store.pos, ids: store.ids() }));

  // The shared item renamed: one fold, both told, both drawing the same row.
  await make(l, [{ op: 'update', id: made.a, title: 'Seen in both' }]);
  const changed = await beat();
  assert.deepEqual(changed.items.changed, [made.a], 'folded in once');
  assert.deepEqual([walk.heard.length, one.heard.length], [1, 1], 'both views are told');
  assert.deepEqual([walk.view.item(made.a).title, one.view.item(made.a).title], ['Seen in both', 'Seen in both']);
  assert.deepEqual([walk.heard[0].ask, one.heard[0].ask], [false, false], 'a title no query here reads asks nothing');

  // What only the walk holds: only it is told.
  await make(l, [{ op: 'update', id: made.b, title: 'Walked' }]);
  await beat();
  assert.deepEqual([walk.heard.length, one.heard.length], [2, 1], 'a view is told only of what it holds');
  assert.equal(one.view.item(made.b), undefined, 'and draws only its own items');

  // A link from the shared item to one outside: the walk follows part_of only, the other walks nothing.
  await make(l, [{ op: 'link', type: 'depends_on', from: made.a, to: made.x }]);
  await beat();
  assert.deepEqual([walk.heard.length, one.heard.length], [2, 1], 'a link neither query reads changes neither answer, nor what either draws');
  await make(l, [{ op: 'link', type: 'part_of', from: made.x, to: made.p }]);
  await beat();
  assert.deepEqual([walk.heard.at(-1)?.ask, one.heard.length], [true, 1], 'a link the walk follows asks it again; the other hears nothing');

  // A view closed lets go of what only it held; the shared item stays for the other.
  unfollow(walk.view);
  assert.deepEqual([...store.items.keys()], [made.a], 'only what an open view holds is kept');
  await make(l, [{ op: 'update', id: made.a, status: 'doing' }]);
  await beat();
  assert.deepEqual([one.view.item(made.a).status, walk.heard.length], ['doing', 3], 'the open view still hears; the closed one does not');
});

test('a view whose query reads a field asks again when it moves; one made anywhere asks a query across the map', async () => {
  const { mayMove, reads } = (await pageModules()).membership;
  const items = new Set(['e_aaaaaaaa']);
  const status = { lens: { filter: { find: ['type task'], only: ['status doing'] } }, items };
  const named = { lens: { filter: { find: ['id e_aaaaaaaa'] } }, items };
  const fact = (field: string, op = '+') => [{ id: 'e_aaaaaaaa', field, op }];
  assert.equal(mayMove(status, fact('status')), true, 'a status its Only names');
  assert.equal(mayMove(status, fact('title')), false, 'not a title it does not read');
  assert.equal(mayMove(named, fact('status')), false, 'an id names no field');
  assert.equal(mayMove(named, fact('archived', '-')), true, 'brought back from the archive, it is asked again');
  assert.equal(mayMove(status, [], 1), true, 'a type term may find what was made anywhere');
  assert.equal(mayMove(named, [], 1), false, 'an id term finds nothing new');
  const isle = { lens: { filter: { find: ['island e_iiiiiiii'] } }, items, islands: ['e_iiiiiiii'] };
  assert.equal(mayMove(isle, [], 1), false, 'one looking at an island hears only what is made there');
  assert.equal(mayMove(isle, [{ id: 'e_bbbbbbbb', field: 'type', op: '+', made: true, island: 'e_iiiiiiii' }]), true);
  assert.equal(mayMove(isle, [{ id: 'e_bbbbbbbb', field: 'type', op: '+', made: true, island: 'e_jjjjjjjj' }]), false);
  const r = reads({ filter: { find: ['id e_aaaaaaaa', 'text replica'], not: ['done'] }, walk: { over: ['depends_on<'], steps: 2 } });
  assert.deepEqual([[...r.anchors], [...r.fields].sort(), [...r.links], r.unanchored], [['e_aaaaaaaa'], ['body', 'status', 'title'], ['depends_on'], true]);
});

test('the tail follows the islands a page names: what lives on them is read, held or not', async () => {
  const l = await fresh();
  await setIslands(l, human, true);
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Followed', props: { pack: 'core' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Elsewhere', props: { pack: 'core' } },
  ]);
  const { held, on, off } = await make(l, [
    { op: 'create', ref: 'held', type: 'task', title: 'Held', props: { island: a } },
    { op: 'create', ref: 'on', type: 'task', title: 'On it, not held', props: { island: a } },
    { op: 'create', ref: 'off', type: 'task', title: 'On another', props: { island: b } },
  ]);
  const start = await headPos(l.db);
  const { n } = await make(l, [
    { op: 'update', id: on, status: 'doing' },
    { op: 'update', id: off, status: 'doing' },
    { op: 'create', ref: 'n', type: 'task', title: 'Made on it', props: { island: a } },
  ]);
  const named = async (islands?: string[]) => new Set((await factsAfter(l.db, { after: start, ids: [held], islands })).entries.flatMap((e) => e.facts.map((f) => f[1])));
  const followed = await named([a]);
  assert.ok(followed.has(on) && followed.has(n), 'what lives on the island followed, changed or made');
  assert.ok(!followed.has(off), 'not what lives on another');
  assert.equal((await named()).size, 0, 'with no island named, as with islands off: only what is held');
});

test("a session's state and line come from the latest answer, whatever its row's position (e_j7hdfq9m)", async () => {
  const { replica } = await pageModules();
  const store = new replica.Store({ lineage: () => [], phase: () => undefined, shown: () => true });
  const run = (line: string) => ({ id: 'e_runaaaaa', type: 'run', title: 'A run', status: 'running', open: true, session: { state: 'working', line, since: '2026-11-10T00:00:00Z' } });
  store.take({ items: [run('first beat')] }, 5);
  // A beat is no fact: the lens read again at the same position says the session's new line.
  store.take({ items: [run('second beat')] }, 5);
  assert.equal(store.items.get('e_runaaaaa').session.line, 'second beat');
  assert.equal(store.items.get('e_runaaaaa').title, 'A run');
});
