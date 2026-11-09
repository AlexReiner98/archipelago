// The software pack's results, releases and public page, on a map in memory: a picture kept for a test's result, the
// gate a release waits at, the changelog, and what a public product gives away.

import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { agent, call, human, make, mapWith, type Archipelago } from '#pelago/test';

/** A fresh in-memory map with the packs beside this one. */
const fresh = () => mapWith(dirname(import.meta.dirname));
const callTool = (l: Archipelago, as: typeof human, tool: string, input: Record<string, unknown>) => call(l, as, tool, input);
/** A view asked by its name, as the view tool asks it. */
const ask = (l: Archipelago, name: string, params: Record<string, unknown> = {}) => call(l, human, 'view', { name, params });

test('a commit, an issue and a bug keep their picture, and their page has the figure for it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'c', type: 'commit', title: 'Draw the ridges', props: { sha: 'a'.repeat(40) } },
    { op: 'create', ref: 'i', type: 'issue', title: 'Two documents disagree' },
    { op: 'create', ref: 'b', type: 'bug', title: 'The ridge is drawn twice' },
  ]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString('base64');
  for (const id of [made.c, made.i, made.b]) {
    assert.equal(((await callTool(l, human, 'picture_put', { result: id, data: png, content_type: 'image/png' })) as { size: number }).size, 10);
    assert.equal(((await callTool(l, human, 'picture', { result: id })) as { data: string }).data, png);
  }
  assert.deepEqual(['commit', 'issue', 'bug'].filter((t) => l.registry.drawnWith('figure').includes(t)), ['commit', 'issue', 'bug']);
});

test('a picture is kept for a result only when sent, and goes when the test is run again', async () => {
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
  assert.equal(((await callTool(l, human, 'picture', { result: first.id })) as { size: number }).size, png.length * 2);
  await assert.rejects(put(Buffer.alloc(1_000_001)), /the most kept is/);
  await assert.rejects(callTool(l, human, 'picture_put', { result: first.id, data: png.toString('base64'), content_type: 'image/svg+xml' }), /drawing alone/);
  await assert.rejects(put(png, 'image/png', made.noaa), /a pack needs a screen on that type with the figure piece/);

  // Run again, on this build or a later one, the test loses the picture kept for it: it no longer shows what the test found.
  const again = (await callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: made.noaa, passed: true }] })) as { pictures_removed: number };
  assert.equal(again.pictures_removed, 1);
  assert.equal(await callTool(l, human, 'picture', { result: first.id }), null);
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

  // Nothing is public until someone says so: anyone sees nothing of it.
  const anyoneDb = l.forAnyone().db;
  assert.deepEqual((await anyoneDb.query(`select title from entity`)).rows, []);

  // An agent cannot say so: it waits for the human.
  assert.equal((await l.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.app, visibility: 'public' }] })).status, 'proposed');
  // And not everything can be: a decision is never anyone's business but the workspace's.
  await assert.rejects(l.change(human, { reason: 'x', ops: [{ op: 'update', id: made.choice, visibility: 'public' }] }), /cannot be public/);

  await make(l, [
    { op: 'update', id: made.app, visibility: 'public' },
    { op: 'update', id: made.sun, visibility: 'public' },
    { op: 'update', id: made.panel, visibility: 'public', title: 'The panel' },
  ]);
  // The database itself holds the line, whatever is asked of it: a public question brings its tests and results, though
  // the feature it sits in is not public; the other question stays out.
  const seen = (await anyoneDb.query<{ title: string }>(`select title from entity order by title`)).rows.map((r) => r.title);
  assert.deepEqual(seen, ['1.0.0: Sun position against NOAA', 'App', 'How do we know the sun is correct?', 'Sun position against NOAA', 'The panel']);
  await assert.rejects(anyoneDb.query(`select body from entity`), /permission denied/);
  // Of an item's fields, only what the page shows: not where a result's picture lies in its repository.
  await assert.rejects(anyoneDb.query(`select props from entity`), /permission denied/);
  const fields = async (id: string) => (await anyoneDb.query<{ props: Record<string, unknown> | null }>(`select pelago_public_props($1) as props`, [id])).rows[0].props;
  assert.deepEqual(await fields(results[made.sun]), { build: '1.0.0', passed: true, value: '0.004 degrees' });
  assert.equal(await fields(results[made.areas]), null, 'and of what is not public, none');
  await assert.rejects(anyoneDb.query(`select * from log_op`), /permission denied/);
  await assert.rejects(anyoneDb.query(`select * from setting`), /permission denied/);
  await assert.rejects(anyoneDb.query(`update entity set title = 'x'`), /permission denied/);
  assert.equal((await anyoneDb.query<{ n: number }>(`select count(*)::int as n from picture`)).rows[0].n, 1);

  // Once a question is public, a run says which pictures to send, and the view lists what is still owed.
  const next = (await callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: 'Sun.MatchesNoaa', passed: true, picture: '.proof/1.0.1/Sun.MatchesNoaa.png' }] })) as { answer: { send_pictures: { result: string; picture: string }[] }; pictures_removed: number };
  assert.deepEqual([next.pictures_removed, next.answer.send_pictures.map((p) => p.picture)], [1, ['.proof/1.0.1/Sun.MatchesNoaa.png']]);
  assert.deepEqual((await view()).to_send.map((p) => p.picture), ['.proof/1.0.1/Sun.MatchesNoaa.png']);

  // Taken back, it is gone at once.
  await make(l, [{ op: 'update', id: made.sun, visibility: 'private' }]);
  assert.ok(!(await anyoneDb.query<{ title: string }>(`select title from entity`)).rows.some((r) => r.title === 'How do we know the sun is correct?'));
});

