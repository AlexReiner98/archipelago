// The reads a kernel view needs of src/packreads.ts (task e_exet8395): what a run wrote and who last said each field,
// the runs of a repository or a folder and what each touched, the held changes and the questions to confirm, a cursor
// past one page, and a view pinned to the version of the pack that answers it. Each answers as the asker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerRead } from '../src/packreads.ts';
import { sessionStart } from '../src/sessions.ts';
import { addTouched } from '../src/touched.ts';
import { VIEWS } from '../src/views.ts';
import { agent, fresh, human, make } from './map.ts';

type Said = { id: string; field: string; value?: unknown; changeset: string; actor: string; authority: { of?: string } | null; run?: string };
type Paged<T> = { rows: T[]; next?: string };

test('a run is read by what it wrote, and an item by who last said each field', async () => {
  const l = await fresh();
  const { bo } = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }]);
  const { run } = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex', session_id: 'w1' });
  const first = (await l.change(human, { run, reason: 'Made in the run', authority: { of: 'human', basis: 'the owner asked' }, ops: [{ op: 'create', ref: 't', type: 'task', title: 'Probe' }] })) as { created: Record<string, string>; changeset: string };
  const task = first.created.t;
  await l.change(human, { reason: 'Moved on, outside the run', ops: [{ op: 'update', id: task, status: 'doing' }] });
  await l.as(bo).change({ kind: 'human', name: 'bo', person: bo }, { run, reason: 'Mine', ops: [{ op: 'create', ref: 'p', type: 'task', title: 'Bo private', visibility: 'private' }] });

  const wrote = (await answerRead(l, { facts: { run } })) as Paged<Said>;
  const ofTask = wrote.rows.filter((f) => f.id === task);
  assert.ok(ofTask.some((f) => f.field === 'title' && f.value === 'Probe'), 'the title, opened');
  assert.ok(ofTask.every((f) => f.run === run && f.authority?.of === 'human'));
  assert.ok(!ofTask.some((f) => f.field === 'status' && f.value === 'doing'), 'nothing from a change outside the run');
  // Someone else's private item is not theirs to read, nor its facts.
  const other = (await answerRead(l.as('e_someone'), { facts: { run } })) as Paged<Said>;
  assert.ok(!other.rows.some((f) => f.value === 'Bo private'));
  assert.ok(((await answerRead(l.as(bo), { facts: { run } })) as Paged<Said>).rows.some((f) => f.value === 'Bo private'));

  // A page at a time, the pages together are the whole.
  const pages: Said[] = [];
  let next: string | undefined;
  do {
    const page = (await answerRead(l, { facts: { run, values: false }, page: { size: 2, ...(next && { after: next }) } })) as Paged<Said>;
    assert.ok(page.rows.length <= 2 && page.rows.every((f) => !('value' in f)));
    pages.push(...page.rows);
    next = page.next;
  } while (next);
  assert.deepEqual(pages.map((f) => `${f.changeset} ${f.id} ${f.field}`), wrote.rows.map((f) => `${f.changeset} ${f.id} ${f.field}`));

  const said = (await answerRead(l, { said: { ids: [task], fields: ['title', 'status'], values: true } })) as Said[];
  const by = Object.fromEntries(said.map((s) => [s.field, s]));
  assert.equal(by.title.changeset, first.changeset);
  assert.equal(by.title.run, run);
  assert.equal(by.status.value, 'doing');
  assert.notEqual(by.status.changeset, first.changeset, 'the newest fact of each field');
  assert.equal(by.status.run, undefined);
  assert.ok(!('value' in ((await answerRead(l, { said: { ids: [task] } })) as Said[])[0]), 'values only when asked');
});

test('runs are read by repository or folder, with what each touched that the asker may read', async () => {
  const l = await fresh();
  const { repo, task } = await make(l, [
    { op: 'create', ref: 'repo', type: 'place', title: 'Apex repo' },
    { op: 'create', ref: 'task', type: 'task', title: 'Probe' },
  ]);
  const a = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex\\.claude\\worktrees\\one', session_id: 'r1' });
  const b = await sessionStart(l, agent, { cwd: 'C:\\code\\Other', session_id: 'r2' });
  await make(l, [{ op: 'link', type: 'lives_in', from: b.run, to: repo }]);
  await addTouched(l, a.run, [task, 'e_notthere']);

  const inFolder = (await answerRead(l, { runs: { folder: 'C:\\code\\Apex\\', touched: true } })) as Paged<{ id: string; touched: string[] }>;
  assert.deepEqual(inFolder.rows.map((r) => r.id), [a.run], 'a folder holds the runs started in it and under it');
  assert.deepEqual(inFolder.rows[0].touched, [task], 'only what is there to read');
  const inRepo = (await answerRead(l, { runs: { repo } })) as Paged<{ id: string }>;
  assert.deepEqual(inRepo.rows.map((r) => r.id), [b.run]);
  await assert.rejects(answerRead(l, { runs: {} }), /repo.*folder/);
});

test('items, links and a scope page past one page by a cursor', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'hub', type: 'task', title: 'Hub' },
    ...Array.from({ length: 7 }, (_, i) => ({ op: 'create' as const, ref: `t${i}`, type: 'task', title: `Step ${i}` })),
    ...Array.from({ length: 7 }, (_, i) => ({ op: 'link' as const, type: 'part_of', from: `t${i}`, to: 'hub' })),
  ]);
  const walk = async (q: Record<string, unknown>) => {
    const ids: string[] = [];
    let next: string | undefined;
    do {
      const page = (await answerRead(l, { ...q, page: { size: 3, ...(next && { after: next }) } })) as Paged<{ id: string }>;
      assert.ok(page.rows.length <= 3);
      ids.push(...page.rows.map((r) => r.id));
      next = page.next;
    } while (next);
    return ids;
  };
  const items = (await answerRead(l, { items: { type: 'task' } })) as { id: string }[];
  assert.deepEqual(await walk({ items: { type: 'task' } }), items.map((r) => r.id));
  const parts = await walk({ related: made.hub, relation: 'part_of', direction: 'in' });
  assert.equal(new Set(parts).size, 7);
  const scope = (await answerRead(l, { scope: made.hub, parts: true })) as { id: string }[];
  assert.deepEqual(await walk({ scope: made.hub, parts: true }), scope.map((r) => r.id));
  await assert.rejects(answerRead(l, { items: { type: 'task' }, page: { after: 'nonsense' } }), /page\.after/);
  await assert.rejects(answerRead(l, { items: { type: 'task' }, page: { size: 501 } }), /page\.size/);
});

test('held changes and the questions to confirm are read as the asker', async () => {
  const l = await fresh();
  const held = (await l.change(agent, { reason: 'Wait for the owner', hold: true, ops: [{ op: 'create', ref: 'x', type: 'task', title: 'Held' }] })) as { status: string; proposal?: string; id?: string };
  assert.equal(held.status, 'proposed');
  const answer = (await answerRead(l, { held: true })) as Paged<{ id: string; reason: string; ops: unknown[] }>;
  assert.equal(answer.rows.length, 1);
  assert.equal(answer.rows[0].reason, 'Wait for the owner');
  assert.equal(answer.rows[0].ops.length, 1);
  const confirm = (await answerRead(l, { confirm: {} })) as { count: number; questions: unknown[] };
  assert.equal(confirm.count, 0);
  assert.deepEqual(confirm.questions, []);
});

test('a view pinned to the pack that answers it is refused when another version answers', async () => {
  const l = await fresh();
  const core = l.registry.packs.find((p) => p.id === 'core')!;
  const name = Object.keys(VIEWS).find((v) => v === 'changed_since') ?? Object.keys(VIEWS)[0];
  const params = { since: new Date(0).toISOString() };
  await answerRead(l, { view: name, params, pin: { pack: 'core', version: core.version } });
  await answerRead(l, { view: name, params, pin: { pack: 'core', manifest: l.registry.hashes.get('core')! } });
  await assert.rejects(answerRead(l, { view: name, params, pin: { pack: 'core', version: '0.0.0-old' } }), /pinned to core 0\.0\.0-old; here it is answered by core/);
  await assert.rejects(answerRead(l, { view: name, params, pin: { pack: 'other', version: core.version } }), /pinned to other/);
  await assert.rejects(answerRead(l, { view: name, params, pin: { pack: 'core' } }), /version, a manifest hash/);
});
