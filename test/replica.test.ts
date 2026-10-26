// The page as a replica of the log: the projector the page runs (src/project.ts, as the server serves it, its types
// stripped) makes the same rows from the log as the server's tables hold, row for row; the server reads the facts
// after a position only on what the caller holds, as the viewer may see them; and a store holding a flat lens's
// answer (ui/replica.js) is brought up to date by an agent's change without the lens being read again.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { KEPT_FIELDS } from '../src/operational.ts';
import { Archipelago } from '../src/pelago.ts';
import { factsAfter, headPos } from '../src/tail.ts';
import { callTool } from '../src/tools.ts';
import { uiFile } from '../src/ui-files.ts';
import { undo } from '../src/undo.ts';
import { agent, all, fresh, human, make } from './map.ts';

/** The page's two modules as the server serves them, loaded from a folder of their own as the browser would load them. */
async function pageModules() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-replica-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['project.js', 'ghosts.js', 'replica.js']) writeFileSync(join(dir, f), (await uiFile(f, null)).body as string);
  return {
    project: await import(pathToFileURL(join(dir, 'project.js')).href),
    replica: await import(pathToFileURL(join(dir, 'replica.js')).href),
  };
}

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
    { op: 'create', ref: 'p', type: 'work.project', title: 'Replica' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Elsewhere' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Project in the page', owner: me, body: 'Facts in, rows out.' },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Tail the log' },
    { op: 'create', ref: 'd', type: 'work.decision', title: 'Keep the pulse?' },
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
  const gone = await make(l, [{ op: 'create', ref: 'g', type: 'work.task', title: 'Forgotten', owner: me }, { op: 'link', type: 'relates_to', from: 'g', to: made.t }]);
  const kept = await make(l, [{ op: 'create', ref: 'k', type: 'work.task', title: 'Kept one' }, { op: 'link', type: 'relates_to', from: 'k', to: made.p }]);
  await make(l, [{ op: 'merge', keep: made.t, drop: kept.k }]);
  await make(l, [{ op: 'forget', id: gone.g }]);
  const link = ((await l.get(made.t)).outgoing as { type: string; relation: string }[]).find((o) => o.type === 'part_of')!;
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
    { op: 'create', ref: 'p', type: 'work.project', title: 'Held' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Not held' },
  ]);
  const mine = l.as(people.me);
  const shared = ((await mine.change(human, { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'work.task', title: 'Shared, held', visibility: 'shared' }] })) as { created: Record<string, string> }).created.s;
  const start = await headPos(l.db);
  await assert.rejects(factsAfter(l.db, { after: start, ids: [] }), /names the ids it holds/, 'a read that names nothing is refused');
  await assert.rejects(callTool(l, agent, 'tail', { after: start, ids: [made.p] }), /humans only/);

  // A task made under what is held comes with its link; a change to what is not held does not.
  const more = await make(l, [
    { op: 'create', ref: 't', type: 'work.task', title: 'New under it' },
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

test("an agent's change reaches a store holding a flat lens's answer, with no lens read", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Canvas' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'Flat lens' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'Tags' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
  ]);
  const { Replica } = (await pageModules()).replica;
  const kinds = { ...l.registry, isOpen: (t: string, s: string) => l.registry.isOpen(t, s), type: (t: string) => l.registry.type(t), relationFamily: (...r: string[]) => r, shown: (t: string, k: string) => Boolean(l.registry.type(t)?.fields?.[k]?.shown) };
  const lens = { filter: { ids: [made.p] }, walk: { over: ['part_of'], steps: 1 } };
  const read = () => callTool(l, human, 'view', { name: 'flat', params: lens }) as Promise<any>;
  const tail = (input: Record<string, unknown>) => callTool(l, human, 'tail', input) as Promise<any>;

  const store = new Replica(kinds);
  store.hold(await read(), (await tail({})).pos);
  const heard: any[] = [];
  store.on((changed: unknown) => heard.push(changed));

  // An agent renames a task, adds one under the project, and ends a link: approved, as under `npm start`.
  const asked = (await l.change(agent, {
    reason: 'Rework the canvas',
    ops: [
      { op: 'update', id: made.a, title: 'A flat lens', status: 'doing' },
      { op: 'create', ref: 'c', type: 'work.task', title: 'Replica' },
      { op: 'link', type: 'part_of', from: 'c', to: made.p },
    ],
  })) as { proposal: string };
  await l.decide(human, { proposal: asked.proposal, approve: true });
  // And one applied as it is made, where the workspace lets agents' changes through.
  const loose = new Archipelago(l.db, l.registry, { update: 'auto', archive: 'auto' });
  assert.equal((await loose.change(agent, { reason: 'Archive it', ops: [{ op: 'archive', id: made.b }] })).status, 'applied');

  const changed = store.apply(await tail({ after: store.pos, ids: store.ids() }));
  const c = [...store.items.keys()].find((id: string) => store.items.get(id).title === 'Replica');
  assert.equal(store.item(made.a).title, 'A flat lens');
  assert.equal(store.item(made.a).status, 'doing');
  assert.equal(store.item(c)?.title, 'Replica', 'the new task, brought by its link');
  assert.equal(store.item(made.b), undefined, 'the archived task leaves the answer');
  assert.deepEqual([changed.items.added, changed.items.changed.includes(made.a), changed.items.removed], [[c], true, [made.b]]);
  assert.equal(heard.length, 1, 'listeners are told once');

  // What the store holds is what reading the lens again gives.
  const again = await read();
  // As the page has both: over the wire, times are strings.
  const pick = (a: any) => JSON.parse(JSON.stringify({ items: [...a.items].sort(byId), links: [...a.links].sort(byId) }));
  assert.deepEqual(pick(store.answer()), pick(again));
});
