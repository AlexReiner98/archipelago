// Catch-up (ui/catch-up.js): a page opened after time away works out, from the log alone, what the canvas held when
// its reader last looked (every fact said of it up to then, packs/log/kernel/tail.ts `was`, folded by the projector), what changed
// since, and the steps it plays: chapters by who made them, island by island; played through the store, they end
// where the map stands.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { uiFile } from '../packs/surface/kernel/ui-files.ts';
import { agent, fresh, human, make } from './map.ts';

/** The page's pure modules as the server serves them, loaded from a folder of their own as the browser would. */
async function pageModules() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-catch-up-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['project.js', 'replica.js', 'membership.js', 'changes.js', 'catch-up-steps.js']) writeFileSync(join(dir, f), (await uiFile(f, null)).body as string);
  const load = (f: string) => import(pathToFileURL(join(dir, f)).href);
  return { replica: await load('replica.js'), changes: await load('changes.js'), steps: await load('catch-up-steps.js') };
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

test('a page opened later works out what changed since its reader looked, and plays it to where the map stands', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'aim', title: 'Canvas' },
    { op: 'create', ref: 'a', type: 'task', title: 'Flat lens' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
  ]);
  const { replica, changes, steps: cu } = await pageModules();
  const kinds = { isOpen: (t: string, s: string) => l.registry.isOpen(t, s), starterOf: (t: string) => l.registry.starterOf(t), relationFamily: (...r: string[]) => r, shown: () => true };
  const tail = (input: Record<string, unknown>) => callTool(l, human, 'tail', input) as Promise<any>;
  const lens = { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 } };
  const read = () => callTool(l, human, 'view', { name: 'flat', params: lens }) as Promise<any>;
  // Where the reader last looked; then the page is closed.
  const looked = (await tail({})).pos;

  // While it is closed, an agent renames the task and adds one under the aim; the owner then starts it.
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
  await loose.change(agent, {
    reason: 'Rework the canvas',
    ops: [
      { op: 'update', id: made.a, title: 'A flat lens' },
      { op: 'create', ref: 'c', type: 'task', title: 'Replica' },
      { op: 'link', type: 'part_of', from: 'c', to: made.p },
    ],
  } as any);
  await l.change(human, { reason: 'Started on it', authority: { of: 'human' }, ops: [{ op: 'update', id: made.a, status: 'doing' }] } as any);

  // The page opens on the map as it is now.
  const store = replica.follow(new replica.View(new replica.Store(kinds)));
  store.hold(await read(), (await tail({})).pos);
  const now = JSON.parse(JSON.stringify(store.answer()));
  const c = now.items.find((i: any) => i.title === 'Replica').id;

  // What it catches up from: the facts since, and what each touched was when the reader looked.
  const since = await tail({ after: looked, ids: [...store.ids, ...store.links.keys()] });
  const touched = [...new Set(since.entries.flatMap((e: any) => e.facts.map((f: any) => f[1])))];
  const { was } = await tail({ was: looked, ids: touched });
  assert.ok(was.entries.every((e: any) => e.pos <= looked), 'nothing said after the reader looked');
  const then = cu.before(store, cu.rowsAt(kinds, was.entries), since.entries);
  assert.equal(then.items.get(made.a).title, 'Flat lens', 'the task as it was named then');
  assert.equal(then.items.has(c), false, 'what was made since was not there');

  const set = changes.changeSet(then, kinds, since.entries, { after: looked });
  const did = Object.fromEntries(set.items.map((x: any) => [x.id, x]));
  assert.equal(did[c].did, 'came');
  assert.deepEqual(did[made.a].fields.map((f: any) => f.field).sort(), ['status', 'title']);
  assert.deepEqual(set.links.map((x: any) => [x.did, x.from]), [['linked', c]]);

  // Two chapters, one a maker: the agent's, then the owner's; with the owner's own left out, one.
  const steps = cu.stepsOf(kinds, then, since.entries);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].by.reason, 'Rework the canvas');
  assert.equal(cu.stepsOf(kinds, then, since.entries, since.entries.at(-1).by.actor).length, 1, 'what the reader made is not played to them');

  // Played through the store from where it was, step by step, it ends as the map stands.
  cu.rewind(store, then, looked, steps);
  assert.equal(store.item(made.a).title, 'Flat lens');
  for (const s of steps) cu.replay(store, s);
  const bare = ({ found, step, updated_at, ...i }: any) => i;
  const pick = (a: any) => JSON.parse(JSON.stringify({ items: [...a.items].map(bare).sort(byId), links: [...a.links].sort(byId) }));
  assert.deepEqual(pick(store.answer()), pick(now));
});

test('a catch-up plays chapters by who made them, island by island', async () => {
  const { steps: cu } = await pageModules();
  const kinds = { isOpen: () => true, starterOf: (t: string) => t, relationFamily: (...r: string[]) => r };
  const item = (id: string, island: string) => ({ id, type: 'task', title: id, body: '', status: 'todo', visibility: 'workspace', owner: null, is_open: true, props: { island }, archived_at: null });
  const held = { items: new Map([['e_aaaaaaaa', item('e_aaaaaaaa', 'e_islanda1')], ['e_bbbbbbbb', item('e_bbbbbbbb', 'e_islandb1')]]), links: new Map() };
  const one = { actor: 'e_agent001', run: 'e_run00001', word: 'Coll' };
  const two = { actor: 'e_agent001', run: 'e_run00002', word: 'Herm' };
  const entries = [
    { pos: 2, at: '2026-11-05T10:00:00.000Z', by: one, facts: [['+', 'e_aaaaaaaa', 'status', 'doing'], ['+', 'e_bbbbbbbb', 'status', 'doing']] },
    // The same session again: the same chapter, its own step. A new item says its island; its link lives where its first end does.
    { pos: 3, at: '2026-11-05T10:01:00.000Z', by: one, facts: [['+', 'e_cccccccc', 'type', 'task'], ['+', 'e_cccccccc', 'title', 'New'], ['+', 'e_cccccccc', 'island', 'e_islandb1'], ['+', 'r_cccccccc', 'link', ['depends_on', 'e_cccccccc', 'e_aaaaaaaa']]] },
    { pos: 4, at: '2026-11-05T10:02:00.000Z', by: two, facts: [['+', 'e_aaaaaaaa', 'title', 'Renamed']] },
    // Said again as it was: nothing to play.
    { pos: 5, at: '2026-11-05T10:03:00.000Z', by: two, facts: [['+', 'e_bbbbbbbb', 'status', 'doing']] },
  ];
  const steps = cu.stepsOf(kinds, held, entries);
  assert.deepEqual(steps.map((s: any) => [s.chapter, s.island, s.pos]), [[0, 'e_islanda1', 2], [0, 'e_islandb1', 2], [0, 'e_islandb1', 3], [1, 'e_islanda1', 4]]);
  assert.deepEqual(steps[2].set.items.map((c: any) => [c.id, c.did]), [['e_cccccccc', 'came']]);
  assert.deepEqual(steps[2].set.links.map((c: any) => c.id), ['r_cccccccc'], 'the link plays with the island of its first end');
  assert.equal(steps[3].by.word, 'Herm');
});
