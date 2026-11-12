// What the kernel keeps for an item and gives away of it: a picture kept for an item drawn with a figure, what anyone sees
// of what is public, what a member reads of tokens and settings, and a document given as a link. The types a pack would
// declare for these are a small pack of the test's own (SHELF), over core's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dumpVault } from '../packs/seal/kernel/vault.ts';
import { doneEvents } from '../packs/log/kernel/activity.ts';
import { dump, restore } from '../packs/log/kernel/backup.ts';
import { openDb } from '../packs/database/kernel/db.ts';
import { Archipelago, type Actor, type Op } from '../packs/write/kernel/pelago.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { publicPage, publicPicture } from '../packs/surface/kernel/public.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { PAGE_VIEWS } from '../packs/publish/kernel/public-route.ts';
import { human, agent, freshWith, make, packsWith } from './map.ts';

/** What a pack declares for the kernel to keep and show: a picture's type, public work, and writing for a reader. */
const SHELF = {
  id: 'shelf', version: '1', title: 'Shelf', requires: ['core'],
  types: [
    { id: 'shot', title: 'Shot', description: 'What was seen, with its picture.', extends: 'record', public: true, fields: { value: { type: 'string' } } },
    { id: 'launch', title: 'Launch', description: 'Work anyone may follow.', extends: 'task', public: true },
    { id: 'paper', title: 'Paper', description: 'Writing made for a reader.', extends: 'record', deliverable: true, fields: { for: { type: 'string' } } },
  ],
  views: [
    { form: 'screen', id: 'shelf.drawn', title: 'Drawn', on: ['shot'], pieces: [{ piece: 'figure' }] },
    { form: 'screen', id: 'shelf.reading', title: 'Reading', on: ['paper'], pieces: [{ piece: 'document' }] },
  ],
} as PackFile;
const shelf = () => freshWith(new Registry(packsWith(SHELF)));

test('a picture is kept on a type drawn with a figure, one for an item, and travels in a backup', async () => {
  const l = await shelf();
  const made = await make(l, [
    { op: 'create', ref: 's', type: 'shot', title: 'Ridges at three scales' },
    { op: 'create', ref: 't', type: 'task', title: 'Draw the ridges' },
  ]);
  assert.ok(l.registry.drawnWith('figure').includes('shot'));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const put = (data: Buffer, content_type = 'image/png', result = made.s) => callTool(l, human, 'picture_put', { result, data: data.toString('base64'), content_type });
  assert.equal(await callTool(l, human, 'picture', { result: made.s }), null);
  assert.equal(((await put(png)) as { size: number }).size, png.length);
  const back = (await callTool(l, human, 'picture', { result: made.s })) as { content_type: string; size: number; data: string };
  assert.deepEqual([back.content_type, back.size, Buffer.from(back.data, 'base64').equals(png)], ['image/png', png.length, true]);

  // Sent again it replaces what was kept: one picture for one item.
  await put(Buffer.concat([png, png]));
  assert.deepEqual((await l.db.query<{ n: number; size: number }>(`select count(*)::int as n, max(size)::int as size from picture`)).rows[0], { n: 1, size: png.length * 2 });
  await assert.rejects(put(Buffer.alloc(1_000_001)), /the most kept is/);
  await assert.rejects(put(png, 'image/svg+xml'), /drawing alone/);
  await assert.rejects(put(png, 'image/png', made.t), /a pack needs a screen on that type with the figure piece/);

  // A backup carries the picture, byte for byte.
  const copy = new Archipelago(await openDb(), l.registry);
  const counts = await restore(copy.db, { ...JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' }))), vault: await dumpVault(l.db) });
  assert.equal(counts.picture, 1);
  const restored = (await callTool(copy, human, 'picture', { result: made.s })) as { data: string };
  assert.ok(Buffer.from(restored.data, 'base64').equals(Buffer.concat([png, png])));
});

test('public: only a human makes it so, only some kinds can be, and anyone then sees little of it', async () => {
  const l = await shelf();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'launch', title: 'App', body: 'Internal plan: the secret margin' },
    { op: 'create', ref: 'between', type: 'task', title: 'Proof work', body: 'Not for anyone' },
    { op: 'create', ref: 'sun', type: 'shot', title: 'The sun against NOAA', body: 'An internal note', props: { value: '0.004 degrees' } },
    { op: 'create', ref: 'areas', type: 'shot', title: 'The areas of a square', props: { value: '1' } },
    { op: 'create', ref: 'panel', type: 'launch', title: 'Panel' },
    { op: 'create', ref: 'choice', type: 'decision', title: 'What does it cost?' },
    { op: 'link', type: 'part_of', from: 'between', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sun', to: 'between' },
    { op: 'link', type: 'part_of', from: 'areas', to: 'between' },
    { op: 'link', type: 'part_of', from: 'panel', to: 'app' },
    { op: 'link', type: 'part_of', from: 'choice', to: 'app' },
  ]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
  for (const id of [made.sun, made.areas]) await callTool(l, human, 'picture_put', { result: id, data: png.toString('base64'), content_type: 'image/png' });

  // Nothing is public until someone says so.
  assert.equal(await publicPage(l, made.app, PAGE_VIEWS), null);
  assert.equal(await publicPicture(l, made.sun), null);

  // An agent cannot say so, even where its other changes are applied as made: it waits for the human.
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.panel, title: 'The panel' }] })).status, 'applied');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.app, visibility: 'public' }] })).status, 'proposed');
  assert.equal(await publicPage(l, made.app, PAGE_VIEWS), null);
  // And not everything can be: a decision is never anyone's business but the workspace's.
  await assert.rejects(l.change(human, { reason: 'x', ops: [{ op: 'update', id: made.choice, visibility: 'public' }] }), /cannot be public/);

  await make(l, [
    { op: 'update', id: made.app, visibility: 'public' },
    { op: 'update', id: made.sun, visibility: 'public' },
    { op: 'update', id: made.panel, visibility: 'public' },
  ]);
  const page = (await publicPage(l, made.app, PAGE_VIEWS))!;
  assert.equal(page.title, 'App');
  assert.ok(!JSON.stringify(page).includes('secret margin'));
  assert.ok((await publicPicture(l, made.sun))!.bytes.equals(png));
  assert.equal(await publicPicture(l, made.areas), null, 'a picture is as public as its item, and no more');

  // The database itself holds the line, whatever is asked of it.
  const anyoneDb = l.forAnyone().db;
  const seen = (await anyoneDb.query<{ title: string }>(`select title from entity order by title`)).rows.map((r) => r.title);
  assert.deepEqual(seen, ['App', 'The panel', 'The sun against NOAA']);
  await assert.rejects(anyoneDb.query(`select body from entity`), /permission denied/);
  await assert.rejects(anyoneDb.query(`select props from entity`), /permission denied/);
  const fields = async (id: string) => (await anyoneDb.query<{ props: Record<string, unknown> | null }>(`select pelago_public_props($1) as props`, [id])).rows[0].props;
  assert.deepEqual(await fields(made.sun), { value: '0.004 degrees' });
  assert.equal(await fields(made.areas), null, 'and of what is not public, none');
  await assert.rejects(anyoneDb.query(`select * from log_op`), /permission denied/);
  await assert.rejects(anyoneDb.query(`select * from setting`), /permission denied/);
  await assert.rejects(anyoneDb.query(`update entity set title = 'x'`), /permission denied/);
  assert.equal((await anyoneDb.query<{ n: number }>(`select count(*)::int as n from picture`)).rows[0].n, 1);

  // Taken back, it is gone at once.
  await make(l, [{ op: 'update', id: made.sun, visibility: 'private' }]);
  assert.equal(await publicPicture(l, made.sun), null);
});

test('a member sees their own tokens and the few settings every request needs; the rest is an admin’s, by the database', async () => {
  const { createToken, listTokens } = await import('../packs/identity/kernel/auth.ts');
  const l = await shelf();
  const made = await make(l, [
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
  ]);
  await createToken(l.db, 'default', { kind: 'human', name: 'ann', entity: made.ann, admin: true });
  await createToken(l.db, 'default', { kind: 'human', name: 'bo', entity: made.bo });
  const set = (key: string, value: unknown) => l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
  await set('me', made.ann);
  await set('default_visibility', 'shared');
  await set('accepts_from', ['elsewhere']);
  await l.setSecret('github_secret', 'latgh_notforbo');

  const bo = l.as(made.bo);
  const ann = l.as(made.ann, true);
  // Tokens: a member's own, and one they make for an agent of theirs; not another's, to read, revoke or make.
  assert.deepEqual((await listTokens(bo.db)).map((t) => t.name), ['bo']);
  assert.deepEqual((await listTokens(ann.db)).map((t) => t.name).sort(), ['ann', 'bo']);
  await createToken(bo.db, 'default', { kind: 'agent', name: 'bo’s agent', entity: made.bo });
  await assert.rejects(createToken(bo.db, 'default', { kind: 'agent', name: 'as ann', entity: made.ann }), /row-level security/);
  assert.equal((await bo.db.query(`update token set revoked_at = now() where name = 'ann' returning id`)).rows.length, 0);

  // Settings: who the owner is and how the workspace is set, and nothing else. A secret is not there to be read, sealed or not.
  assert.equal(await bo.setting('me'), made.ann);
  assert.equal(await bo.defaultVisibility(), 'shared');
  assert.deepEqual((await bo.db.query<{ key: string }>(`select key from setting order by key`)).rows.map((r) => r.key), ['default_visibility', 'me']);
  assert.equal(await bo.secret('github_secret'), undefined);
  assert.equal(await ann.secret('github_secret'), 'latgh_notforbo');
  assert.deepEqual(await ann.setting('accepts_from'), ['elsewhere']);
  // Nor is a setting a member's to change, but for the place a connection's log has been read up to.
  await assert.rejects(bo.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"')`), /row-level security/);
  assert.equal((await bo.db.query(`update setting set value = '"private"' where key = 'default_visibility' returning key`)).rows.length, 0);
  await bo.db.query(`insert into setting (key, value) values ('audit_cursor:e_conn0001', '"2026-10-13"')`);
  await ann.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  assert.equal(await bo.agentChanges(), 'apply');
});

test('a document brings items in by id, read whole by its author with what she may not see said as missing', async () => {
  const { sectionIds } = await import('../packs/views/kernel/documents.ts');
  const l = await shelf();
  const people = await make(l, [
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
  ]);
  const ann = l.as(people.ann);
  const bo = l.as(people.bo);
  const annActor: Actor = { kind: 'human', name: 'ann', person: people.ann };
  const boActor: Actor = { kind: 'human', name: 'bo', person: people.bo };
  const theirs = async (who: Archipelago, actor: Actor, ops: Op[]) => ((await who.change(actor, { ops, reason: 'test' })) as { created: Record<string, string> }).created;
  const hers = await theirs(ann, annActor, [
    { op: 'create', ref: 'mine', type: 'finding', title: 'IRAP', body: 'Call the advisor first.', visibility: 'private' },
    { op: 'create', ref: 'all', type: 'finding', title: 'SR&ED', body: 'Claimed after the work.', visibility: 'shared' },
  ]);
  const his = await theirs(bo, boActor, [{ op: 'create', ref: 'n', type: 'finding', title: 'Bo’s secret plan', body: 'Not for Ann’s readers.', visibility: 'private' }]);
  const body = `# Funding\n\nTwo programs, and a third (${his.n}) the reader does not see.\n\n${hers.mine}\n\nBetween them, ${hers.mine} comes first.\n${hers.all}\n${his.n}\ne_nothing1\n`;
  const { doc } = await theirs(ann, annActor, [{ op: 'create', ref: 'doc', type: 'paper', title: 'Funding for Northwind', body, visibility: 'private', props: { for: 'Sam' } }]);
  assert.deepEqual(sectionIds(body), [hers.mine, hers.all, his.n, 'e_nothing1']);

  // Its author reads it whole; what she may not see is said as missing, in its place.
  const read = (await callTool(ann, annActor, 'document', { id: doc })) as { for: string; parts: Record<string, any>[] };
  assert.equal(read.for, 'Sam');
  assert.deepEqual(
    read.parts.map((p) => p.section?.title ?? p.missing ?? p.text.split('\n')[0]),
    ['# Funding', 'IRAP', 'Between them, ' + hers.mine + ' comes first.', 'SR&ED', his.n, 'e_nothing1'],
  );
  // An agent may read it, but only a person makes it public (test/public-view.test.ts says what goes out).
  await assert.rejects(callTool(ann, { kind: 'agent', name: 'a', person: people.ann }, 'share_create', { id: doc }), /humans only/);
});

test('what is made for a reader is marked deliverable by its type, and a document names the sections kept outside it', async () => {
  const l = await shelf();
  const marked = (await callTool(l, human, 'schema', {})) as { types: { id: string; deliverable?: boolean }[] };
  const deliverable = (id: string) => Boolean(marked.types.find((t) => t.id === id)?.deliverable);
  assert.deepEqual(['paper', 'shared_document', 'finding', 'task', 'decision'].map(deliverable), [true, true, false, false, false]);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Research' },
    { op: 'create', ref: 'a', type: 'finding', title: 'Inside' },
    { op: 'create', ref: 'b', type: 'finding', title: 'Beside' },
    { op: 'create', ref: 'd', type: 'paper', title: 'Brief', body: '{a}\n{b}' },
    { op: 'link', type: 'part_of', from: 'd', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'd' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
  ]);
  const read = (await callTool(l, human, 'document', { id: made.d })) as { not_inside?: string[] };
  assert.deepEqual(read.not_inside, [made.b]);
  await make(l, [{ op: 'link', type: 'part_of', from: made.b, to: made.d }]);
  assert.equal(((await callTool(l, human, 'document', { id: made.d })) as { not_inside?: string[] }).not_inside, undefined);
});
