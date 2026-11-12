import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor } from '../packs/write/kernel/pelago.ts';
import { publicView, publicViewAt, publicViews } from '../packs/surface/kernel/public-views.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh, freshWith, make, packsWith } from './map.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';

/** A map of two people: a view of the questions, one of them private to Ann, and a document with a private section. */
async function shelf() {
  const l = await freshWith(new Registry(packsWith('reader')));
  const { ann } = await make(l, [{ op: 'create', ref: 'ann', type: 'person', title: 'Ann', visibility: 'shared' }]);
  await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }]);
  const owner: Actor = { kind: 'human', name: 'ann', person: ann, admin: true };
  const mine = l.as(ann, true);
  const made = ((await mine.change(owner, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'question', title: 'SR&ED', body: `Claimed after the work, unlike {p}.`, visibility: 'shared' },
      { op: 'create', ref: 'b', type: 'question', title: 'IRAP', body: 'Call the advisor.', visibility: 'shared' },
      { op: 'create', ref: 'p', type: 'question', title: 'Ann’s secret plan', body: 'Only Ann.', visibility: 'private' },
      { op: 'create', ref: 'lens', type: 'lens', title: 'Questions', visibility: 'private', props: { filter: { find: ['type question'], not: [] }, walk: { over: [], steps: 0 } } },
      { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
      { op: 'link', type: 'depends_on', from: 'p', to: 'b' },
      { op: 'create', ref: 's', type: 'clipping', title: 'Shown', body: 'Read by anyone.', visibility: 'shared' },
      { op: 'create', ref: 'h', type: 'clipping', title: 'Hidden draft', body: 'Not for readers.', visibility: 'private' },
      { op: 'create', ref: 'd', type: 'writing', title: 'Funding', body: 'Intro, see {h}.\n\n{s}\n\n{h}\n\n{lens}', visibility: 'shared', props: { path: 'funding', menu: 2 } },
      { op: 'link', type: 'part_of', from: 's', to: 'd' },
      { op: 'link', type: 'part_of', from: 'h', to: 'd' },
    ],
  })) as { created: Record<string, string> }).created;
  return { l, mine, owner, made };
}

/** Whether anything of the private items is anywhere in what is kept. */
const leaks = (kept: unknown, made: Record<string, string>) => {
  const text = JSON.stringify(kept);
  return [made.p, made.h, 'secret plan', 'Hidden draft', 'Only Ann', 'Not for readers'].filter((word) => text.includes(word));
};

test('a view shared is frozen without its private items, and the plan says what goes and what is left out', async () => {
  const { l, mine, owner, made } = await shelf();
  const plan = (await callTool(mine, owner, 'share_plan', { id: made.lens })) as { goes: { id: string }[]; private: { id: string }[]; shared: boolean };
  assert.deepEqual(plan.goes.map((i) => i.id).sort(), [made.a, made.b, made.lens].sort(), 'the view and its questions go');
  assert.deepEqual(plan.private.map((i) => i.id), [made.p], 'the private one is said as left out');
  assert.equal(plan.shared, false);

  // Only a person shares: an agent asks.
  await assert.rejects(callTool(mine, { kind: 'agent', name: 'a', person: owner.person }, 'share_create', { id: made.lens }), /humans only/);
  const asked = (await callTool(mine, { kind: 'agent', name: 'a', person: owner.person }, 'share_ask', { id: made.lens, reason: 'For the post.' })) as { asked: boolean };
  assert.equal(asked.asked, true);

  const shared = (await callTool(mine, owner, 'share_create', { id: made.lens })) as { address: string };
  assert.equal(shared.address, `/p/default/${made.lens}`);
  // What the database keeps, and what anyone reads, holds nothing private: not its id, its title, its note or a link to it.
  const row = (await l.db.query(`select given from public_view where entity_id = $1`, [made.lens])).rows[0];
  assert.deepEqual(leaks(row, made), []);
  const read = (await publicView(l, made.lens)) as { title: string; lenses: Record<string, { items: { id: string }[]; links: { from: string; to: string }[] }> };
  assert.equal(read.title, 'Questions');
  assert.deepEqual(read.lenses[made.lens].items.map((i) => i.id).sort(), [made.a, made.b].sort());
  assert.deepEqual(leaks(read, made), []);
  // The private view itself is shared: sharing it is choosing that.
  assert.deepEqual((await publicViews(l)).map((v) => v.id), [made.lens]);

  // A change made after is not in it until it is shared again; archived, it is gone.
  await mine.change(owner, { reason: 'test', ops: [{ op: 'update', id: made.b, title: 'IRAP, renamed' }] });
  assert.ok(JSON.stringify(await publicView(l, made.lens)).includes('"IRAP"'));
  await mine.change(owner, { reason: 'test', ops: [{ op: 'archive', id: made.lens }] });
  assert.equal(await publicView(l, made.lens), null);
});

test('a document shared keeps its path and place, and leaves its private sections out', async () => {
  const { l, mine, owner, made } = await shelf();
  await callTool(mine, owner, 'share_create', { id: made.d });
  const read = (await publicViewAt(l, 'funding')) as { id: string; menu: number; parts: { text?: string; section?: { id: string } }[]; lenses: Record<string, unknown> };
  assert.equal(read.id, made.d);
  assert.equal(read.menu, 2);
  assert.deepEqual(read.parts.flatMap((p) => (p.section ? [p.section.id] : [])), [made.s], 'the shared section, not the private one; a private view is not brought in by a document');
  assert.deepEqual(leaks(read, made), []);
  // Taken down, its address answers nothing; a second at its path is refused while it stands.
  await callTool(mine, owner, 'share_revoke', { id: made.d });
  assert.equal(await publicViewAt(l, 'funding'), null);
  await assert.rejects(callTool(mine, owner, 'share_revoke', { id: made.d }), /has no public view/);
});

test('a forget takes its public view with it', async () => {
  const l = await fresh();
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Ship it', body: 'Soon.', visibility: 'shared' }]);
  const owner: Actor = { kind: 'human', name: 'owner', admin: true };
  await callTool(l, owner, 'share_create', { id: t });
  assert.ok(await publicView(l, t));
  await l.change(owner, { reason: 'test', ops: [{ op: 'forget', id: t }] });
  assert.equal((await l.db.query(`select 1 from public_view where entity_id = $1`, [t])).rows.length, 0);
});

test('step 41 makes each published revision its public view, as published, and nothing published that is not read', async () => {
  const { PUBLISHED_TO_PUBLIC_VIEW } = await import('../packs/database/kernel/public-schema.ts');
  const { l, mine, owner, made } = await shelf();
  const { o } = await make(l, [{ op: 'create', ref: 'o', type: 'writing', title: 'Old page', body: 'Gone private.', visibility: 'shared', props: { path: 'old' } }]);
  for (const id of [made.d, o]) await callTool(mine, owner, 'publish', { id });
  // What was there before public views: the revisions alone, one of them since made private.
  await l.db.query(`delete from public_view`);
  await mine.change(owner, { reason: 'test', ops: [{ op: 'update', id: made.d, title: 'Funding, a new draft' }, { op: 'update', id: o, visibility: 'private' }] });
  await l.db.query(PUBLISHED_TO_PUBLIC_VIEW);
  const { rows } = await l.db.query<{ entity_id: string; given: unknown; path: string; menu: number; shared_at: Date }>(`select entity_id, given, path, menu, shared_at from public_view`);
  const [was] = (await l.db.query<{ given: unknown; published_at: Date }>(`select given, published_at from published where entity_id = $1`, [made.d])).rows;
  assert.deepEqual(rows.map((r) => [r.entity_id, r.path, r.menu]), [[made.d, 'funding', 2]], 'the private one is not made public');
  assert.deepEqual(rows[0].given, was.given, 'its frozen copy, not its draft');
  assert.equal(new Date(rows[0].shared_at).toISOString(), new Date(was.published_at).toISOString());
  assert.equal(((await publicViewAt(l, 'funding')) as { title: string }).title, 'Funding');
  // Run again, it changes nothing.
  await l.db.query(PUBLISHED_TO_PUBLIC_VIEW);
  assert.equal((await l.db.query(`select 1 from public_view`)).rows.length, 1);
});

test('an item a public view shows says so in get, and is behind once it changes after', async () => {
  const { mine, owner, made } = await shelf();
  const agent: Actor = { kind: 'agent', name: 'a', person: owner.person };
  type Got = { public_views?: { id: string; title: string; shared_at: string; address: string; behind?: boolean }[] };
  const views = async (id: string) => ((await callTool(mine, agent, 'get', { id })) as Got).public_views;
  assert.equal(await views(made.a), undefined, 'nothing public shows it yet');

  await callTool(mine, owner, 'share_create', { id: made.lens });
  await callTool(mine, owner, 'share_create', { id: made.d });
  assert.deepEqual(await views(made.a), [{ id: made.lens, title: 'Questions', shared_at: (await views(made.a))![0].shared_at, address: `/p/default/${made.lens}` }], 'a question the view draws');
  assert.deepEqual((await views(made.s))!.map((v) => v.id), [made.d], 'a section of the document');
  assert.deepEqual((await views(made.lens))!.map((v) => v.id), [made.lens], 'the view itself');
  assert.equal(await views(made.p), undefined, 'a private item left out is not shown by it');

  await mine.change(owner, { reason: 'test', ops: [{ op: 'update', id: made.a, title: 'SR&ED, renamed' }] });
  assert.equal((await views(made.a))![0].behind, true, 'changed since it was shared');
  assert.equal((await views(made.b))![0].behind, undefined, 'one unchanged is not');
  await callTool(mine, owner, 'share_create', { id: made.lens });
  assert.equal((await views(made.a))![0].behind, undefined, 'shared again, it is current');
});
