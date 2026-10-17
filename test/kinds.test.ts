// The seven kinds every type extends, the root relations every relation extends, and the system tier
// outside both. What the kernel computes from a root holds for a pack's relation extending it.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { VIEWS } from '../src/views.ts';

const KINDS = ['actor', 'aim', 'work', 'question', 'record', 'occurrence', 'place'];
const ROOTS = ['part_of', 'depends_on', 'defers', 'waits_on', 'needs', 'holds', 'involves', 'serves', 'lives_in', 'about', 'bears_on', 'supersedes', 'relates_to'];
const SYSTEM = ['lens', 'style', 'screen', 'sys.source', 'sys.run', 'sys.notification', 'sys.automation'];
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

test('every shipped type extends one of the seven kinds, or is of the system tier', () => {
  const reg = new Registry(packsWith());
  assert.deepEqual(reg.kinds().map((t) => t.id), KINDS);
  for (const type of reg.types.values()) {
    if (SYSTEM.includes(type.id)) {
      assert.equal(type.kind, undefined, `${type.id} is outside the kinds`);
      assert.ok(type.system);
    } else assert.ok(type.kind && KINDS.includes(type.kind), `${type.id} has a kind`);
  }
  assert.equal(reg.type('inquiry.experiment')!.kind, 'work');
  assert.equal(reg.type('sys.connection')!.kind, 'place');
  assert.equal(reg.type('time.invoice')!.kind, 'record');
  assert.deepEqual(reg.ancestry('inquiry.experiment'), { root: 'work.task', kind: 'work' });
  assert.deepEqual(reg.ancestry('sys.run'), { root: 'sys.run', kind: null });
});

test('every relation extends one of the thirteen roots', () => {
  const reg = new Registry(packsWith());
  assert.deepEqual([...reg.relations.values()].filter((r) => r.root === r.id).map((r) => r.id).sort(), [...ROOTS].sort());
  for (const rel of reg.relations.values()) assert.ok(ROOTS.includes(rel.root), `${rel.id} reads as ${rel.root}`);
  assert.equal(reg.relations.get('software.lives_in')!.root, 'lives_in');
  assert.equal(reg.relations.get('inquiry.supports')!.root, 'bears_on');
  assert.ok(reg.relationFamily('lives_in').includes('software.lives_in'));
});

test('a pack cannot leave a type without a kind, declare a kind, or stretch a root', () => {
  const pack = (types: PackFile['types'], relations: PackFile['relations'] = []): PackFile => ({ id: 'x', version: '1', title: 'X', requires: ['core'], types, relations });
  const statuses = { open: ['open'], closed: ['done'] };
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.thing', title: 'T', description: '', statuses }]))), /must extend one of the kinds: actor, aim/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.kind', title: 'K', description: '', kind: true, statuses }]))), /only the core pack declares kinds/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.tier', title: 'S', description: '', tier: 'system', statuses }]))), /system tier/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'x.lens', title: 'L', description: '', extends: 'lens' }]))), /kernel's own/);
  const rel = { title: 'r', inverse: 'r', description: '', from: ['*'], to: ['*'] };
  assert.throws(() => new Registry(packsWith(pack([], [{ id: 'x.r', ...rel }]))), /must extend one of the root relations/);
  assert.throws(() => new Registry(packsWith(pack([], [{ id: 'x.r', ...rel, root: true }]))), /only the core pack declares root/);
  // waits_on runs only to actors, so what extends it cannot run to a task.
  assert.throws(() => new Registry(packsWith(pack([], [{ id: 'x.r', ...rel, to: ['work.task'], extends: 'waits_on' }]))), /goes to work.task, which "waits_on" does not/);
});

test("a pack's relation extending depends_on blocks as depends_on does", async () => {
  const reg = new Registry(packsWith({
    id: 'x', version: '1', title: 'X', requires: ['core'],
    relations: [{ id: 'x.after', extends: 'depends_on', title: 'comes after', inverse: 'comes before', from: ['*'], to: ['*'], description: '' }],
  }));
  const l = new Archipelago(await openDb(), reg);
  const made = await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work.task', title: 'Pour the slab' },
      { op: 'create', ref: 'b', type: 'work.task', title: 'Frame the walls' },
      { op: 'link', type: 'x.after', from: 'b', to: 'a' },
    ],
  });
  const { a, b } = (made as { created: Record<string, string> }).created;
  const answer = (await VIEWS.attention.run(l, { reasons: ['blocked'] })) as { items: { id: string; reasons: { why: string; by: string[] }[] }[] };
  const framed = answer.items.find((x) => x.id === b);
  assert.ok(framed, 'the later task is blocked');
  assert.deepEqual(framed.reasons.map((x) => [x.why, x.by]), [['blocked', [(await l.entity(a))!.title]]]);
});

test('a new type extends a kind or a type of one', async () => {
  const reg = new Registry(packsWith());
  assert.match(reg.checkNewType({ id: 'local.site', title: 'Site', description: '' }).join(), /extends one of the kinds/);
  assert.deepEqual(reg.checkNewType({ id: 'local.site', title: 'Site', description: '', extends: 'place' }), []);
  assert.match(reg.checkNewType({ id: 'local.view', title: 'V', description: '', extends: 'lens' }).join(), /kernel's own/);
});
