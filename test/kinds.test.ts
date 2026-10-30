// The kinds every type extends (the seven of the work, and system for the app's own), the root relations every
// relation extends, naming kinds at their ends. What the kernel computes from a root holds for a pack's relation extending it.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { callTool } from '../src/tools.ts';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { askView } from '../src/askview.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

const KINDS = ['actor', 'aim', 'work', 'question', 'record', 'occurrence', 'place', 'system'];
const ROOTS = ['part_of', 'depends_on', 'defers', 'waits_on', 'needs', 'holds', 'involves', 'serves', 'lives_in', 'about', 'bears_on', 'supersedes', 'link', 'uses', 'produced'];
const SYSTEM = ['lens', 'style', 'instruction', 'screen', 'type', 'link_type', 'source', 'run', 'notification', 'automation'];
const human: Actor = { kind: 'human', name: 'test' };

/** A copy of the shipped packs, with one more pack beside them when given. */
function packsWith(extra?: PackFile): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-kinds-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  if (extra) {
    mkdirSync(join(dir, extra.id));
    writeFileSync(join(dir, extra.id, 'pack.json'), JSON.stringify(extra));
  }
  return dir;
}

test('every shipped type extends one of the kinds, the system tier included', () => {
  const reg = new Registry(packsWith());
  assert.deepEqual(reg.kinds().map((t) => t.id), KINDS);
  for (const type of reg.types.values()) {
    assert.ok(type.kind && KINDS.includes(type.kind), `${type.id} has a kind`);
    if (type.id === 'system' || SYSTEM.includes(type.id)) assert.ok(type.kind === 'system' && type.system, `${type.id} is of the system kind`);
    else assert.ok(type.kind !== 'system' && !type.system, `${type.id} is of the work`);
  }
  assert.equal(reg.type('experiment')!.kind, 'work');
  assert.equal(reg.type('connection')!.kind, 'place');
  assert.equal(reg.type('invoice')!.kind, 'record');
  assert.deepEqual(reg.ancestry('experiment'), { root: 'task', kind: 'work' });
  assert.deepEqual(reg.ancestry('run'), { root: 'run', kind: 'system' });
});

test('every relation extends one of the thirteen roots', () => {
  const reg = new Registry(packsWith());
  assert.deepEqual([...reg.relations.values()].filter((r) => r.root === r.id).map((r) => r.id).sort(), [...ROOTS].sort());
  for (const rel of reg.relations.values()) assert.ok(ROOTS.includes(rel.root), `${rel.id} reads as ${rel.root}`);
  assert.equal(reg.relations.get('lives_in')!.root, 'lives_in');
  assert.equal(reg.relations.get('supports')!.root, 'bears_on');
  assert.ok(reg.relationFamily('lives_in').includes('lives_in'));
});

test('a pack cannot leave a type without a kind, declare a kind, or stretch a root', () => {
  const pack = (types: PackFile['types'], links: PackFile['links'] = []): PackFile => ({ id: 'x', version: '1', title: 'X', requires: ['core'], types, links });
  const statuses = { open: ['open'], closed: ['done'] };
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.thing', title: 'T', description: '', statuses }]))), /must extend one of the kinds: actor, aim/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.kind', title: 'K', description: '', kind: true, statuses }]))), /only the core pack declares kinds/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.tier', title: 'S', description: '', extends: 'system', statuses }]))), /cannot be of the system kind/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.lens', title: 'L', description: '', extends: 'lens' }]))), /kernel's own/);
  const rel = { title: 'r', inverse: 'r', description: '', from: ['*'], to: ['*'] };
  assert.throws(() => new Registry(packsWith(pack([], [{ id: 'x.r', ...rel }]))), /must extend one of the root relations/);
  assert.throws(() => new Registry(packsWith(pack([], [{ id: 'x.r', ...rel, root: true }]))), /only the core pack declares root/);
  // waits_on runs only to actors, so what extends it cannot run to a task.
  assert.throws(() => new Registry(packsWith(pack([], [{ id: 'x.r', ...rel, to: ['task'], extends: 'waits_on' }]))), /goes to task, which "waits_on" does not/);
});

test("a pack's relation extending depends_on blocks as depends_on does", async () => {
  const reg = new Registry(packsWith({
    id: 'x', version: '1', title: 'X', requires: ['core'],
    links: [{ id: 'x.after', extends: 'depends_on', title: 'comes after', inverse: 'comes before', from: ['*'], to: ['*'], description: '' }],
  }));
  const l = new Archipelago(await openDb(), reg);
  const made = await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'task', title: 'Pour the slab' },
      { op: 'create', ref: 'b', type: 'task', title: 'Frame the walls' },
      { op: 'link', type: 'x.after', from: 'b', to: 'a' },
    ],
  });
  const { a, b } = (made as { created: Record<string, string> }).created;
  await callTool(l, { kind: 'human', name: 'test' }, 'init', { name: 'Owner' });
  const answer = (await ask(l, 'attention', { person: 'me', reasons: ['blocked'] })) as { items: { id: string; reasons: { why: string; by: string[] }[] }[] };
  const framed = answer.items.find((x) => x.id === b);
  assert.ok(framed, 'the later task is blocked');
  assert.deepEqual(framed.reasons.map((x) => [x.why, x.by]), [['blocked', [(await l.entity(a))!.title]]]);
});

test('a new type extends a kind or a type of one', async () => {
  const reg = new Registry(packsWith());
  assert.match(reg.checkNewType({ id: 'local.site', title: 'Site', description: '' }).join(), /extends one of the kinds/);
  assert.deepEqual(reg.checkNewType({ id: 'local.site', title: 'Site', description: '', extends: 'place' }), []);
  assert.match(reg.checkNewType({ id: 'local.view', title: 'V', description: '', extends: 'lens' }).join(), /kernel's own/);
  assert.match(reg.checkNewType({ id: 'local.conf', title: 'C', description: '', extends: 'system' }).join(), /kernel's own/);
  assert.doesNotMatch(reg.checkNewType({ id: 'local.site', title: 'Site', description: '' }).join(), /system/, 'a workspace is offered the kinds of the work');
});

test("the roots name kinds at their ends, so a pack's own actor can be waited on and its place needed", async () => {
  const reg = new Registry(packsWith({
    id: 'x', version: '1', title: 'X', requires: ['core'],
    types: [
      { id: 'x.crew', extends: 'actor', title: 'Crew', description: '' },
      { id: 'x.crane', extends: 'place', title: 'Crane', description: '', capabilities: { capacity: { field: 'seats' } }, fields: { seats: { type: 'number', default: 1 } } },
    ],
  }));
  const ends = (id: string) => { const r = reg.relations.get(id)!; return [r.from, r.to]; };
  assert.deepEqual(ends('waits_on'), [['*'], ['actor']]);
  assert.deepEqual(ends('involves'), [['*'], ['actor']]);
  assert.deepEqual(ends('needs'), [['*'], ['place']]);
  assert.deepEqual(ends('holds'), [['*'], ['place']]);
  assert.deepEqual(ends('serves'), [['*'], ['aim']]);
  assert.deepEqual(ends('bears_on'), [['*'], ['question']]);
  assert.deepEqual(ends('defers'), [['occurrence'], ['*']]);
  const core = new Set([...reg.types.keys()].filter((t) => reg.type(t)!.pack === 'core' && reg.type(t)!.kind !== t));
  for (const r of reg.relations.values()) if (r.root === r.id) for (const end of [...r.from, ...r.to]) assert.ok(!core.has(end), `${r.id} names the kind, not core's ${end}`);
  assert.equal(reg.checkRelation('waits_on', 'task', 'x.crew'), undefined);
  assert.equal(reg.checkRelation('needs', 'task', 'x.crane'), undefined);
  assert.match(reg.checkRelation('waits_on', 'task', 'x.crane')!, /must point to actor/);
  const l = new Archipelago(await openDb(), reg);
  const made = await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'crew', type: 'x.crew', title: 'Night crew' },
      { op: 'create', ref: 'crane', type: 'x.crane', title: 'Tower crane' },
      { op: 'create', ref: 't', type: 'task', title: 'Lift the trusses' },
      { op: 'link', type: 'waits_on', from: 't', to: 'crew', props: { for: 'Say when you can start' } },
      { op: 'link', type: 'needs', from: 't', to: 'crane' },
    ],
  });
  const { t, crew } = (made as { created: Record<string, string> }).created;
  const answer = (await ask(l, 'attention', { person: crew, reasons: ['waits_on'] })) as { items: { id: string; reasons: { why: string }[] }[] };
  assert.ok(answer.items.find((x) => x.id === t)?.reasons.some((x) => x.why === 'waits_on'), 'the task waits on the crew');
});

test('views of the work leave the system kind out by default', async () => {
  const l = new Archipelago(await openDb(), new Registry(packsWith()));
  const made = await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'project', title: 'House' },
      { op: 'create', ref: 't', type: 'task', title: 'Pour the slab' },
      { op: 'link', type: 'part_of', from: 't', to: 'p' },
      { op: 'create', ref: 'v', type: 'lens', title: 'Everything' },
    ],
  });
  const { p, t, v } = (made as { created: Record<string, string> }).created;
  // Of the whole map, a lens says the types it finds.
  const types = ['task', 'lens'];
  const answer = (await ask(l, 'flat', { filter: { find: types.map((t: string) => `type ${t}`), not: [] } })) as { items: { id: string }[] };
  assert.ok(answer.items.some((x) => x.id === v), 'asked to, a view shows the system kind');
  const folded = (await ask(l, 'flat', { filter: { types } })) as { items: { id: string }[] };
  assert.ok(folded.items.some((x) => x.id === t) && !folded.items.some((x) => x.id === v));
  const within = (await ask(l, 'flat', { filter: { find: [`id ${p}`] }, walk: { over: 'all', steps: 2 } })) as { items: { id: string }[] };
  assert.ok(within.items.some((x) => x.id === t) && !within.items.some((x) => x.id === v));
});
