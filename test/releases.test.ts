import assert from 'node:assert/strict';
import { dumpVault } from '../src/vault.ts';
import { test } from 'node:test';
import { dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { publicPage, publicPicture } from '../src/public.ts';
import { callTool } from '../src/tools.ts';
import { askView } from '../src/askview.ts';
import { human, agent, fresh, make } from './map.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

test('a picture is kept for a result only when sent, travels in a backup, and goes when the test is run again', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
    { op: 'create', ref: 'sun', type: 'proof', title: 'How do we know the sun is correct?' },
    { op: 'create', ref: 'noaa', type: 'test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa' } },
    { op: 'link', type: 'part_of', from: 'sun', to: 'app' },
    { op: 'link', type: 'answers', from: 'noaa', to: 'sun' },
  ]);
  type Found = { id: string; picture: string | null; stored: boolean };
  const found = async () => ((await callTool(l, human, 'view', { name: 'proof', params: { of: made.app } })) as { proofs: { tests: { result: Found | null }[] }[] }).proofs[0].tests[0].result!;

  // A report says where the picture is in the repository; the file stays there.
  await callTool(l, human, 'test_report', { build: '1.0.0', results: [{ test: 'Sun.MatchesNoaa', passed: true, picture: '.proof/1.0.0/Sun.MatchesNoaa.png' }] });
  const first = await found();
  assert.deepEqual([first.picture, first.stored], ['.proof/1.0.0/Sun.MatchesNoaa.png', false]);
  assert.equal(await callTool(l, human, 'picture', { result: first.id }), null);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const put = (data: Buffer, content_type = 'image/png', result = first.id) => callTool(l, human, 'picture_put', { result, data: data.toString('base64'), content_type });
  await put(png);
  assert.equal((await found()).stored, true);
  const back = (await callTool(l, human, 'picture', { result: first.id })) as { content_type: string; size: number; data: string };
  assert.deepEqual([back.content_type, back.size, Buffer.from(back.data, 'base64').equals(png)], ['image/png', png.length, true]);

  // Sent again it replaces what was kept: one picture for one result.
  await put(Buffer.concat([png, png]));
  assert.equal((await l.db.query<{ n: number; size: number }>(`select count(*)::int as n, max(size)::int as size from picture`)).rows[0].size, png.length * 2);
  await assert.rejects(put(Buffer.alloc(10_000_001)), /the most kept is/);
  await assert.rejects(callTool(l, human, 'picture_put', { result: first.id, data: png.toString('base64'), content_type: 'image/svg+xml' }), /drawing alone/);
  await assert.rejects(put(png, 'image/png', made.noaa), /not a test result/);

  // A backup carries the picture, byte for byte.
  const copy = new Archipelago(await openDb(), l.registry);
  const counts = await restore(copy.db, { ...JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' }))), vault: await dumpVault(l.db) });
  assert.equal(counts.picture, 1);
  const restored = (await callTool(copy, human, 'picture', { result: first.id })) as { data: string };
  assert.ok(Buffer.from(restored.data, 'base64').equals(Buffer.concat([png, png])));

  // Run again, on this build or a later one, the test loses the picture kept for it: it no longer shows what the test found.
  const again = (await callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: made.noaa, passed: true }] })) as { pictures_removed: number };
  assert.equal(again.pictures_removed, 1);
  assert.equal((await l.db.query<{ n: number }>(`select count(*)::int as n from picture`)).rows[0].n, 0);
});

test('a release is not clear until what it ships is proven on its own build, and a changelog is only what is built', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
    { op: 'create', ref: 'addin', type: 'feature', title: 'Add-in', status: 'built' },
    { op: 'create', ref: 'panel', type: 'feature', title: 'Panel', status: 'built' },
    { op: 'create', ref: 'old', type: 'feature', title: 'Presets', status: 'shipped' },
    { op: 'create', ref: 'later', type: 'feature', title: 'Sheets', status: 'planned' },
    { op: 'create', ref: 'proofs', type: 'feature', title: 'Public proof', status: 'built' },
    { op: 'create', ref: 'sun', type: 'proof', title: 'How do we know the sun is correct?' },
    { op: 'create', ref: 'noaa', type: 'test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa' } },
    { op: 'create', ref: 'release', type: 'release', title: 'Version 1.0', props: { version: '1.0.0' } },
    { op: 'link', type: 'part_of', from: 'addin', to: 'app' },
    { op: 'link', type: 'part_of', from: 'panel', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'old', to: 'app' },
    { op: 'link', type: 'part_of', from: 'later', to: 'app' },
    { op: 'link', type: 'part_of', from: 'proofs', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sun', to: 'proofs' },
    { op: 'link', type: 'answers', from: 'noaa', to: 'sun' },
    { op: 'link', type: 'ships', from: 'release', to: 'addin' },
    // The questions are asked of a feature the release does not ship: it is held by it, and so they are the release's too.
    { op: 'link', type: 'depends_on', from: 'release', to: 'proofs' },
  ]);
  type Gate = { clear: boolean; proof: { build: string | null; named: boolean; counts: { questions: number; answered: number }; questions: { id: string; answered: boolean }[] } | null };
  const gate = async () => (await ask(l, 'gate', { event: made.release })) as Gate;

  // Passing on an earlier build does not answer for the build that is released.
  await callTool(l, human, 'test_report', { build: '0.9.0', results: [{ test: made.noaa, passed: true }] });
  const before = await gate();
  assert.deepEqual([before.proof!.build, before.proof!.named, before.proof!.counts.answered, before.clear], ['1.0.0', true, 0, false]);
  await callTool(l, human, 'test_report', { build: '1.0.0', results: [{ test: made.noaa, passed: true }] });
  const after = await gate();
  assert.deepEqual([after.proof!.counts.answered, after.proof!.questions[0].answered, after.clear], [1, true, true]);

  // A changelog is what is built or shipped, with the release each went out in; what is only planned is not in it.
  const log = (await callTool(l, human, 'view', { name: 'changelog', params: { of: made.app } })) as { counts: Record<string, number>; features: { id: string; status: string; release: { version: string | null } | null }[] };
  assert.deepEqual(log.counts, { built: 3, shipped: 1 });
  assert.deepEqual(log.features.map((f) => f.id).sort(), [made.addin, made.old, made.panel, made.proofs].sort());
  assert.equal(log.features.at(-1)!.id, made.old, 'what is built and not yet released comes first');
  assert.equal(log.features.find((f) => f.id === made.panel)!.release!.version, '1.0.0', 'a part goes out with what it is part of');
  assert.equal(log.features.find((f) => f.id === made.old)!.release, null);
});

test('costs: dollars where a run says, tokens where it does not, and each regular payment by its share', async () => {
  const l = await fresh();
  const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'repo', title: 'Repo' },
    { op: 'create', ref: 'host', type: 'cost', title: 'Hosting', props: { amount: 25, since: longAgo, vendor: 'Render' } },
    { op: 'create', ref: 'domain', type: 'cost', title: 'Domain', props: { amount: 120, every: 'year', since: longAgo } },
    { op: 'create', ref: 'unknown', type: 'cost', title: 'Subscription' },
    { op: 'create', ref: 'euro', type: 'cost', title: 'Licence', props: { amount: 10, currency: 'EUR', since: longAgo } },
    { op: 'create', ref: 'ended', type: 'cost', title: 'Old host', status: 'ended', props: { amount: 50, since: longAgo, until: longAgo } },
  ]);
  await callTool(l, human, 'run_report', { repo: made.repo, title: 'Read a push', tokens: 40_000, cost_usd: 0.31, surface: 'server', link: 'https://example.com/1' });
  await callTool(l, human, 'run_report', { repo: made.repo, title: 'Read another', tokens: 10_000, cost_usd: 0.09, surface: 'server', link: 'https://example.com/2' });
  await callTool(l, human, 'run_report', { repo: made.repo, title: 'A session', tokens: 900_000, surface: 'claude-code', link: 'https://example.com/3' });

  type Costs = {
    total_usd: number;
    per_month: number;
    agents: { cost_usd: number; tokens: number; unpriced_tokens: number; by: { surface: string; runs: number; cost_usd: number }[] };
    recurring: { cost_usd: number; per_month: number; items: { id: string; per_month: number | null; share: number | null }[]; unpriced: { id: string }[]; other_currencies: { id: string }[] };
  };
  const c = (await callTool(l, human, 'view', { name: 'costs', params: { days: 30 } })) as Costs;
  assert.deepEqual([c.agents.cost_usd, c.agents.tokens, c.agents.unpriced_tokens], [0.4, 950_000, 900_000]);
  assert.deepEqual(c.agents.by.map((s) => [s.surface, s.runs, s.cost_usd]), [['server', 2, 0.4], ['claude-code', 1, 0]]);
  // A month's payment, and a twelfth of a year's, over thirty days of a month of 30.44.
  const share = (monthly: number) => Math.round(((monthly * 30) / 30.4375) * 100) / 100;
  assert.equal(c.recurring.items.find((i) => i.id === made.host)!.share, share(25));
  assert.deepEqual([c.recurring.items.find((i) => i.id === made.domain)!.per_month, c.recurring.per_month], [10, 35]);
  assert.equal(c.recurring.cost_usd, Math.round((share(25) + share(10)) * 100) / 100);
  assert.deepEqual(c.recurring.unpriced.map((i) => i.id), [made.unknown], 'a payment nobody has priced is named, not guessed');
  assert.deepEqual(c.recurring.other_currencies.map((i) => i.id), [made.euro], 'another currency is listed, not added to the dollars');
  assert.ok(!c.recurring.items.some((i) => i.id === made.ended), 'what ended before the period is not in it');
  assert.equal(c.total_usd, Math.round((0.4 + c.recurring.cost_usd) * 100) / 100);
  assert.equal(c.per_month, Math.round((35 + (0.4 * 30.4375) / 30) * 100) / 100);
});

test('public: only a human makes it so, only some kinds can be, and anyone then sees little of it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'project', title: 'App', body: 'Internal plan: the secret margin' },
    { op: 'create', ref: 'between', type: 'feature', title: 'Proof work', body: 'Not for anyone' },
    { op: 'create', ref: 'sun', type: 'proof', title: 'How do we know the sun is correct?', body: 'An internal note' },
    { op: 'create', ref: 'areas', type: 'proof', title: 'How do we know the areas are correct?' },
    { op: 'create', ref: 'noaa', type: 'test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa', tolerance: 'within 0.01 degrees' } },
    { op: 'create', ref: 'square', type: 'test', title: 'Area of a square', status: 'current', props: { entrypoint: 'Area.Square' } },
    { op: 'create', ref: 'panel', type: 'feature', title: 'Panel', status: 'built' },
    { op: 'create', ref: 'hidden', type: 'feature', title: 'Unannounced', status: 'built' },
    { op: 'create', ref: 'choice', type: 'decision', title: 'What does it cost?' },
    { op: 'link', type: 'part_of', from: 'between', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sun', to: 'between' },
    { op: 'link', type: 'part_of', from: 'areas', to: 'between' },
    { op: 'link', type: 'part_of', from: 'panel', to: 'app' },
    { op: 'link', type: 'part_of', from: 'hidden', to: 'app' },
    { op: 'link', type: 'part_of', from: 'choice', to: 'app' },
    { op: 'link', type: 'answers', from: 'noaa', to: 'sun' },
    { op: 'link', type: 'answers', from: 'square', to: 'areas' },
  ]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
  const report = (await callTool(l, human, 'test_report', { build: '1.0.0', results: [
    { test: 'Sun.MatchesNoaa', passed: true, value: '0.004 degrees', picture: '.proof/1.0.0/Sun.MatchesNoaa.png' },
    { test: 'Area.Square', passed: true, picture: '.proof/1.0.0/Area.Square.png' },
  ] })) as { answer: { send_pictures: unknown[] } };
  assert.deepEqual(report.answer.send_pictures, [], 'nothing is public yet, so no picture is asked for');
  type View = { proofs: { id: string; public: boolean; tests: { result: { id: string } }[] }[]; to_send: { result: string; picture: string }[] };
  const view = async () => (await callTool(l, human, 'view', { name: 'proof', params: { of: made.app } })) as View;
  const results = Object.fromEntries((await view()).proofs.map((p) => [p.id, p.tests[0].result.id]));
  for (const id of Object.values(results)) await callTool(l, human, 'picture_put', { result: id, data: png.toString('base64'), content_type: 'image/png' });

  // Nothing is public until someone says so.
  assert.equal(await publicPage(l, made.app), null);
  assert.equal(await publicPicture(l, results[made.sun]), null);

  // An agent cannot say so, even where its other changes are applied as made: it waits for the human.
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.panel, title: 'The panel' }] })).status, 'applied');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.app, visibility: 'public' }] })).status, 'proposed');
  assert.equal(await publicPage(l, made.app), null);
  // And not everything can be: a decision is never anyone's business but the workspace's.
  await assert.rejects(l.change(human, { reason: 'x', ops: [{ op: 'update', id: made.choice, visibility: 'public' }] }), /cannot be public/);

  await make(l, [
    { op: 'update', id: made.app, visibility: 'public' },
    { op: 'update', id: made.sun, visibility: 'public' },
    { op: 'update', id: made.panel, visibility: 'public' },
  ]);
  const page = (await publicPage(l, made.app))!;
  assert.equal(page.title, 'App');
  // A public question brings its tests and results, though the feature it sits in is not public; the other question stays out.
  assert.deepEqual(page.questions.map((q) => q.id), [made.sun]);
  assert.deepEqual([page.questions[0].answered, page.questions[0].tests[0].title, page.questions[0].tests[0].result!.value, page.questions[0].tests[0].result!.picture], [true, 'Sun position against NOAA', '0.004 degrees', results[made.sun]]);
  assert.deepEqual(page.changelog.map((f) => f.title), ['The panel']);
  const said = JSON.stringify(page);
  for (const hiddenText of ['secret margin', 'internal note', 'Not for anyone', 'Unannounced', 'areas are correct', 'What does it cost', 'Area of a square']) assert.ok(!said.includes(hiddenText), `"${hiddenText}" is not given away`);
  assert.ok((await publicPicture(l, results[made.sun]))!.bytes.equals(png));
  assert.equal(await publicPicture(l, results[made.areas]), null, 'a picture is as public as its result, and no more');

  // The database itself holds the line, whatever is asked of it.
  const anyoneDb = l.forAnyone().db;
  const seen = (await anyoneDb.query<{ title: string }>(`select title from entity order by title`)).rows.map((r) => r.title);
  assert.deepEqual(seen, ['1.0.0: Sun position against NOAA', 'App', 'How do we know the sun is correct?', 'Sun position against NOAA', 'The panel']);
  await assert.rejects(anyoneDb.query(`select body from entity`), /permission denied/);
  // Of an item's fields, only what the page shows: not where a result's picture lies in its repository.
  await assert.rejects(anyoneDb.query(`select props from entity`), /permission denied/);
  const fields = async (id: string) => (await anyoneDb.query<{ props: Record<string, unknown> | null }>(`select pelago_public_props($1) as props`, [id])).rows[0].props;
  assert.deepEqual(await fields(results[made.sun]), { build: '1.0.0', passed: true, value: '0.004 degrees' });
  assert.equal(await fields(results[made.areas]), null, 'and of what is not public, none');
  await assert.rejects(anyoneDb.query(`select * from event`), /permission denied/);
  await assert.rejects(anyoneDb.query(`select * from setting`), /permission denied/);
  await assert.rejects(anyoneDb.query(`update entity set title = 'x'`), /permission denied/);
  assert.equal((await anyoneDb.query<{ n: number }>(`select count(*)::int as n from picture`)).rows[0].n, 1);

  // Once a question is public, a run says which pictures to send, and the view lists what is still owed.
  const next = (await callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: 'Sun.MatchesNoaa', passed: true, picture: '.proof/1.0.1/Sun.MatchesNoaa.png' }] })) as { answer: { send_pictures: { result: string; picture: string }[] }; pictures_removed: number };
  assert.deepEqual([next.pictures_removed, next.answer.send_pictures.map((p) => p.picture)], [1, ['.proof/1.0.1/Sun.MatchesNoaa.png']]);
  assert.deepEqual((await view()).to_send.map((p) => p.picture), ['.proof/1.0.1/Sun.MatchesNoaa.png']);

  // Taken back, it is gone from the page at once.
  await make(l, [{ op: 'update', id: made.sun, visibility: 'private' }]);
  assert.deepEqual((await publicPage(l, made.app))!.questions, []);
});

test('a member sees their own tokens and the few settings every request needs; the rest is an admin’s, by the database', async () => {
  const { createToken, listTokens } = await import('../src/auth.ts');
  const l = await fresh();
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

test('a document brings items in by id, and a link shows it and them to anyone holding it, and nothing more', async () => {
  const { sharedDocument, sectionIds } = await import('../src/documents.ts');
  const l = await fresh();
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
    { op: 'create', ref: 'mine', type: 'note', title: 'IRAP', body: 'Call the advisor first.', visibility: 'private' },
    { op: 'create', ref: 'all', type: 'note', title: 'SR&ED', body: 'Claimed after the work.', visibility: 'shared' },
  ]);
  const his = await theirs(bo, boActor, [{ op: 'create', ref: 'n', type: 'note', title: 'Bo’s secret plan', body: 'Not for Ann’s readers.', visibility: 'private' }]);
  const body = `# Funding\n\nTwo programs, and a third (${his.n}) the reader does not see.\n\n${hers.mine}\n\nBetween them, ${hers.mine} comes first.\n${hers.all}\n${his.n}\ne_nothing1\n`;
  const { doc } = await theirs(ann, annActor, [{ op: 'create', ref: 'doc', type: 'document', title: 'Funding for Northwind', body, visibility: 'private', props: { for: 'Sam' } }]);
  assert.deepEqual(sectionIds(body), [hers.mine, hers.all, his.n, 'e_nothing1']);

  // Its author reads it whole; what she may not see is said as missing, in its place.
  const read = (await callTool(ann, annActor, 'document', { id: doc })) as { for: string; parts: Record<string, any>[] };
  assert.equal(read.for, 'Sam');
  assert.deepEqual(
    read.parts.map((p) => p.section?.title ?? p.missing ?? p.text.split('\n')[0]),
    ['# Funding', 'IRAP', 'Between them, ' + hers.mine + ' comes first.', 'SR&ED', his.n, 'e_nothing1'],
  );
  // An agent may read it, but only a person makes a link, and only to what they can see.
  await assert.rejects(callTool(ann, { kind: 'agent', name: 'a', person: people.ann }, 'share_create', { id: doc }), /humans only/);
  await assert.rejects(callTool(bo, boActor, 'share_create', { id: doc }), /not a document/);
  await assert.rejects(callTool(ann, annActor, 'share_create', { id: hers.all }), /not a document/);

  const made = (await callTool(ann, annActor, 'share_create', { id: doc })) as { share: string; path: string };
  const secret = made.path.split('/').at(-1)!;
  assert.match(made.path, /^\/s\/default\/[a-f0-9]{48}$/);
  const shown = (await sharedDocument(l, secret))!;
  assert.equal(shown.title, 'Funding for Northwind');
  assert.deepEqual(
    shown.parts.map((p: Record<string, any>) => p.section?.title ?? p.text),
    ['# Funding\n\nTwo programs, and a third the reader does not see.', 'IRAP', `Between them, ${hers.mine} comes first.`, 'SR&ED'],
    'Bo’s private note is left out, and so is its id in the text; an id that is nothing is not said',
  );
  assert.equal(JSON.stringify(shown).includes('secret plan'), false);
  assert.equal(await sharedDocument(l, 'f'.repeat(48)), null, 'a link never made opens nothing');
  assert.equal(await sharedDocument(l, '../x'), null);

  // Bo cannot see her links; she can, and revoking one closes it at once. An archived document is not shown either.
  assert.deepEqual(await callTool(bo, boActor, 'share_list', { id: doc }), []);
  assert.equal(((await callTool(ann, annActor, 'share_list', { id: doc })) as unknown[]).length, 1);
  await assert.rejects(callTool(bo, boActor, 'share_revoke', { id: made.share }), /No standing link/);
  await callTool(ann, annActor, 'share_revoke', { id: made.share });
  assert.equal(await sharedDocument(l, secret), null);
  const again = (await callTool(ann, annActor, 'share_create', { id: doc })) as { path: string };
  await theirs(ann, annActor, [{ op: 'archive', id: doc }]);
  assert.equal(await sharedDocument(l, again.path.split('/').at(-1)!), null);
  // What was done is in the history.
  const actions = (await l.db.query<{ action: string }>(`select action from event where target_id = $1 and action like 'share.%' order by seq`, [doc])).rows.map((r) => r.action);
  assert.deepEqual(actions, ['share.create', 'share.revoke', 'share.create']);
});

test('what is made for a reader is marked deliverable by its type, and a document names the sections kept outside it', async () => {
  const l = await fresh();
  const marked = (await callTool(l, human, 'schema', {})) as { types: { id: string; deliverable?: boolean }[] };
  const deliverable = (id: string) => Boolean(marked.types.find((t) => t.id === id)?.deliverable);
  assert.deepEqual(['document', 'file', 'release', 'spec', 'note', 'task'].map(deliverable), [true, true, true, false, false, false]);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research' },
    { op: 'create', ref: 'a', type: 'note', title: 'Inside' },
    { op: 'create', ref: 'b', type: 'note', title: 'Beside' },
    { op: 'create', ref: 'd', type: 'document', title: 'Brief', body: '{a}\n{b}' },
    { op: 'link', type: 'part_of', from: 'd', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'd' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
  ]);
  const read = (await callTool(l, human, 'document', { id: made.d })) as { not_inside?: string[] };
  assert.deepEqual(read.not_inside, [made.b]);
  await make(l, [{ op: 'link', type: 'part_of', from: made.b, to: made.d }]);
  assert.equal(((await callTool(l, human, 'document', { id: made.d })) as { not_inside?: string[] }).not_inside, undefined);
});

