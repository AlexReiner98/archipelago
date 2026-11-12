// A link type may extend nothing (task e_mdvkzjm9): it is then its own root. And an end may name a capability
// (has:owned) rather than a kind, as core's owned_by does: whatever declares owned may be owned by a person or an
// agent. Every link the packs allowed before is allowed still, and nothing more.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { freshWith, human, make, packsWith } from './map.ts';

/** A copy of the shipped packs, core changed by `core` and one more pack beside them when given. */
/** The packs with extra beside them, and core as `core` changes it. */
function packsOf(extra?: PackFile, core?: (p: PackFile) => void): string {
  const dir = packsWith(extra);
  if (core) {
    const file = join(dir, 'core', 'pack.json');
    const p = JSON.parse(readFileSync(file, 'utf8')) as PackFile;
    core(p);
    writeFileSync(file, JSON.stringify(p));
  }
  return dir;
}

const LEDGER: PackFile = {
  id: 'ledger',
  version: '1',
  title: 'Ledger',
  requires: ['core'],
  types: [
    { id: 'account', title: 'Account', description: 'An account in the chart.', capabilities: { owned: true }, statuses: { open: ['open'], closed: ['closed'] } },
    { id: 'entry', title: 'Entry', description: 'One journal entry.', statuses: { open: ['draft'], closed: ['posted'] } },
  ],
  links: [{ id: 'posts_to', title: 'posts to', inverse: 'is posted to by', from: ['entry'], to: ['account'], description: 'A posting.' }],
} as PackFile;

/** What may stand at each end of each link type: every type by name, or all. */
const ends = (reg: Registry) =>
  Object.fromEntries([...reg.relations.values()].map((r) => [r.id, [r.from, r.to].map((side) => (side.includes('*') ? 'all' : [...new Set(side.flatMap((e) => reg.family(e)))].sort()))]));

test('owned_by allows exactly what it allowed when it named the five kinds', () => {
  const now = new Registry(packsOf());
  const was = new Registry(packsOf(undefined, (p) => { p.links!.find((r) => r.id === 'owned_by')!.from = ['aim', 'work', 'question', 'record', 'occurrence']; }));
  assert.deepEqual(now.relations.get('owned_by')!.from, ['has:owned']);
  assert.deepEqual(ends(now), ends(was), 'every end of every link type takes the same types');
  for (const t of now.types.values()) {
    const before = was.checkRelation('owned_by', t.id, 'person') === undefined;
    assert.equal(now.checkRelation('owned_by', t.id, 'person') === undefined, before, `owned_by from ${t.id}`);
    assert.equal(now.isA(t.id, 'has:owned'), t.columns.owner !== undefined, `${t.id} is owned where it has an owner`);
  }
  assert.match(now.checkRelation('owned_by', 'person', 'person')!, /must start from has:owned, not person/);
});

test('a link type that extends nothing is its own root, joining its own types', async () => {
  const l = await freshWith(new Registry(packsOf(LEDGER)));
  const posts = l.registry.relations.get('posts_to')!;
  assert.equal(posts.root, 'posts_to');
  assert.deepEqual(l.registry.relationFamily('posts_to'), ['posts_to']);
  const { e, a, who } = await make(l, [
    { op: 'create', ref: 'who', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'a', type: 'account', title: 'Cash' },
    { op: 'create', ref: 'e', type: 'entry', title: 'Rent' },
    { op: 'link', type: 'posts_to', from: 'e', to: 'a' },
    { op: 'link', type: 'owned_by', from: 'a', to: 'who' },
  ]);
  assert.equal((await l.entity(a))!.owner, who, 'a kindless owned type is owned by a link');
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'link', type: 'posts_to', from: a, to: e }] }), /must start from entry, not account/);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'link', type: 'owned_by', from: e, to: who }] }), /must start from has:owned, not entry/);
});

test('a capability end is checked: known, and kept inside what a flavour extends', () => {
  const with_ = (links: PackFile['links']) => new Registry(packsOf({ ...LEDGER, links: [...LEDGER.links!, ...links!] } as PackFile));
  const rel = { title: 'r', inverse: 'r', description: '', to: ['*'] };
  assert.throws(() => with_([{ id: 'x', ...rel, from: ['has:nothing'] }]), /refers to unknown capability "nothing"/);
  assert.equal(with_([{ id: 'x', ...rel, from: ['has:owned'] }]).relations.get('x')!.root, 'x');
  // A flavour of owned_by may name a capability it has, or a type that has it; not one that does not.
  const of = (from: string[]) => with_([{ id: 'x', ...rel, extends: 'owned_by', to: ['person'], from }]);
  assert.equal(of(['has:owned']).relations.get('x')!.root, 'involves');
  assert.equal(of(['account', 'task']).relations.get('x')!.root, 'involves');
  assert.throws(() => of(['entry']), /goes from entry, which "owned_by" does not/);
  assert.throws(() => of(['has:actionable']), /goes from has:actionable, which "owned_by" does not/);
});

test('a kept type from before owned was a capability is owned by its owner column', () => {
  const reg = new Registry(packsOf());
  const task = reg.type('task')!;
  const { owned: _, ...older } = task.capabilities;
  reg.keep({ types: [{ ...task, id: 'gone.chore', pack: 'gone', capabilities: older }], relations: [] });
  assert.equal(reg.checkRelation('owned_by', 'gone.chore', 'person'), undefined);
});
