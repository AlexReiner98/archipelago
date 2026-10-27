// Types and link types kept as items on the map ("Where do types live?", decided 27 Oct 2026): a pack's type is a
// preset, the owner's version laid over it; one with a name and no preset is the workspace's own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownPack, withVersions, type TypeItem } from '../src/type-overlay.ts';
import type { PackFile } from '../src/packs.ts';
import { agent, fresh, human, make } from './map.ts';

const item = (props: Record<string, unknown>, more: Partial<TypeItem> = {}): TypeItem => ({ id: 'e_1', type: 'type', title: '', body: '', is_open: true, props, ...more });
const pack: PackFile = { id: 'work', version: '1', title: 'Work', description: '', types: [{ id: 'work.task', title: 'Task', description: 'Work.', extends: 'work', fields: { due: { type: 'date' } } }], links: [{ id: 'work.addresses', extends: 'about', title: 'Addresses', inverse: 'Addressed by', from: ['*'], to: ['*'], description: '' }] };

test('an owner\'s version lays its title, note and fields over the pack\'s, and a retired one is marked', () => {
  const [over] = withVersions([pack], [item({ preset: 'work.task', fields: { rate: { type: 'number' } } }, { title: 'Job', is_open: false }), item({ preset: 'work.addresses' }, { type: 'link_type', body: 'What it fixes.' })]);
  const t = over.types![0] as { title: string; description: string; fields: Record<string, unknown>; retired?: boolean };
  assert.deepEqual([t.title, t.description, Object.keys(t.fields), t.retired], ['Job', 'Work.', ['due', 'rate'], true]);
  assert.equal(over.links![0].description, 'What it fixes.');
  assert.equal(withVersions([pack], [])[0], pack, 'nothing kept, the pack as it is');
});

test('a type with a name and no preset is the workspace\'s own', () => {
  const own = ownPack(undefined, [item({ name: 'local.recipe', extends: 'record' }, { title: 'Recipe' }), item({ name: 'local.feeds', from: ['local.recipe'] }, { type: 'link_type', title: 'Feeds' })], 'local')!;
  assert.deepEqual([own.id, own.types!.map((t) => ('id' in t ? t.id : '')), own.links!.map((r) => [r.id, r.from, r.to, r.inverse])], ['local', ['local.recipe'], [['local.feeds', ['local.recipe'], ['*'], 'Feeds']]]);
  assert.equal(ownPack(undefined, [], 'local'), undefined);
});

test('a type made on the map can gain a field, be used in the change that makes it, and be retired', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 't', type: 'type', title: 'Site visit', body: 'A visit to a site.', props: { name: 'local.site_visit', extends: 'event', fields: { address: { type: 'string' } } } },
    { op: 'create', ref: 'v', type: 'local.site_visit', title: 'Snowdon', props: { address: '1 High St', at: '2026-11-01T10:00:00Z' } },
  ]);
  assert.deepEqual(l.registry.type('local.site_visit')!.lineage, ['local.site_visit', 'event', 'occurrence']);
  assert.equal((await l.entity(made.v))!.kind, 'occurrence');

  await make(l, [{ op: 'update', id: made.t, props: { fields: { address: { type: 'string' }, host: { type: 'string' } } } }]);
  await make(l, [{ op: 'update', id: made.v, props: { host: 'Ann' } }]);

  await make(l, [{ op: 'update', id: made.t, status: 'retired' }]);
  await assert.rejects(make(l, [{ op: 'create', type: 'local.site_visit', title: 'Again' }]), /retired here/);
  await make(l, [{ op: 'update', id: made.v, title: 'Snowdon, again' }]); // what is there stays
});

test('the owner\'s version of a pack\'s type adds a field and renames it; a bad one is refused', async () => {
  const l = await fresh();
  await assert.rejects(make(l, [{ op: 'create', type: 'work.task', title: 'Paint', props: { rate: 40 } }]), /no field "rate"/);
  const made = await make(l, [{ op: 'create', ref: 'v', type: 'type', title: 'Job', props: { preset: 'work.task', fields: { rate: { type: 'number' } } } }]);
  await make(l, [{ op: 'create', type: 'work.task', title: 'Paint', props: { rate: 40 } }]);
  assert.equal(l.registry.type('work.task')!.title, 'Job');

  await assert.rejects(make(l, [{ op: 'create', type: 'type', title: 'Bad', props: { name: 'thing', extends: 'work' } }]), /must be named "local.<name>"/);
  await assert.rejects(make(l, [{ op: 'create', type: 'type', title: 'Bad', props: { name: 'local.bad', extends: 'nothing' } }]), /types it makes or changes/);

  await make(l, [{ op: 'archive', id: made.v }]);
  assert.equal(l.registry.type('work.task')!.title, 'Task', 'archived, the preset is the pack\'s again');
});

test('a retired link type makes no new link; one of the workspace\'s own can be drawn', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
    { op: 'create', type: 'link_type', title: 'Is linked to', status: 'retired', props: { preset: 'link' } },
    { op: 'create', type: 'link_type', title: 'Feeds', props: { name: 'local.feeds', extends: 'depends_on' } },
  ]);
  await assert.rejects(make(l, [{ op: 'link', type: 'link', from: made.a, to: made.b }]), /retired here/);
  await make(l, [{ op: 'link', type: 'local.feeds', from: made.a, to: made.b }]);
  assert.deepEqual(l.registry.relationFamily('depends_on').includes('local.feeds'), true);
});

test('an agent\'s type waits for the owner as any of its changes does', async () => {
  const l = await fresh();
  const proposed = await l.change(agent, { reason: 'Site visits keep coming up', ops: [{ op: 'create', type: 'type', title: 'Site visit', props: { name: 'local.site_visit', extends: 'event' } }] });
  assert.equal(proposed.status, 'proposed');
  assert.equal(l.registry.type('local.site_visit'), undefined);
  await l.decide(human, { proposal: (proposed as { proposal: string }).proposal, approve: true });
  assert.ok(l.registry.type('local.site_visit'));
});

test('nothing is a flavour of the plain link, and uses blocks nothing', async () => {
  const l = await fresh();
  await assert.rejects(make(l, [{ op: 'create', type: 'link_type', title: 'Touches', props: { name: 'local.touches', extends: 'link' } }]), /cannot be a flavour of link/);
  assert.ok(!l.registry.relationFamily('depends_on', 'waits_on', 'needs').includes('software.calls'), 'a call is no block');
  assert.deepEqual(l.registry.relationFamily('uses'), ['uses', 'software.calls']);
});
