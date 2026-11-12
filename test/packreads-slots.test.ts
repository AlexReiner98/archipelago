// The reads of the reads API a service answers (docs/kernel-packs.md, "Slots"): what each answered when packreads
// imported the service itself, pinned here against that service's own functions, as the owner and as someone else.
// The answers may not change when a read becomes a filling of the slot surface opens.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../packs/query/kernel/views.ts';
import { answerRead } from '../packs/surface/kernel/packreads.ts';
import { readEvents } from '../packs/log/kernel/eventlog.ts';
import * as instructionsPack from '../packs/agents/kernel/instructions.ts';
import { livesInFor } from '../packs/runs/kernel/places.ts';
import * as placesPack from '../packs/runs/kernel/places.ts';
import { LENS_LIMIT } from '../packs/query/kernel/query-flat.ts';
import { readAxis } from '../packs/query/kernel/timeaxis.ts';
import * as timeaxisPack from '../packs/query/kernel/timeaxis.ts';
import * as touchedPack from '../packs/sessions/kernel/touched.ts';
import { heldCounts } from '../packs/publish/kernel/pack-counts.ts';
import { VIEWS } from '../packs/query/kernel/views.ts';
import * as viewsPack from '../packs/query/kernel/views.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { agent, fresh, human, make } from './map.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';

const sorted = (xs: string[]) => [...xs].sort();

test('within and type_info answer as the places they read', async () => {
  const l = await fresh();
  const { bo } = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }]);
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'place', title: 'Repo' },
    { op: 'create', ref: 'hub', type: 'task', title: 'Hub' },
    { op: 'create', ref: 'part', type: 'task', title: 'Part' },
    { op: 'create', ref: 'done', type: 'task', title: 'Done', status: 'done' },
    { op: 'create', ref: 'issue', type: 'task', title: 'About' },
    { op: 'link', type: 'lives_in', from: 'hub', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'part', to: 'hub' },
    { op: 'link', type: 'part_of', from: 'done', to: 'hub' },
    { op: 'link', type: 'about', from: 'issue', to: 'part' },
  ]);
  await l.as(bo).change({ kind: 'human', name: 'bo', person: bo }, { reason: 'Mine', ops: [{ op: 'create', ref: 'p', type: 'task', title: 'Bo private', visibility: 'private' }, { op: 'link', type: 'part_of', from: 'p', to: made.hub }] });
  for (const asker of [l, l.as(bo), l.as('e_someone')]) {
    for (const open of [false, true]) {
      const answer = (await answerRead(asker, { within: { id: made.repo, open } })) as string[];
      assert.deepEqual(sorted(answer), sorted([...(await placesPack.scopeOf(kernelContext(asker, 'runs'), made.repo, open, undefined))]));
    }
    const among = [made.part, made.done, 'e_notthere'];
    assert.deepEqual(sorted((await answerRead(asker, { within: { id: made.hub, among } })) as string[]), sorted([...(await placesPack.scopeOf(kernelContext(asker, 'runs'), made.hub, false, among))]));
  }
  assert.ok(((await answerRead(l, { within: { id: made.repo } })) as string[]).includes(made.issue), 'what is about a part is in it');
  await assert.rejects(answerRead(l, { within: { id: made.repo, among: 'x' as never } }), /within\.among is a list of ids/);
  for (const t of ['place', 'task', 'nothing']) {
    const info = (await answerRead(l, { type_info: t })) as { lives_in?: string } | null;
    if (t === 'nothing') assert.equal(info, null);
    else assert.equal(info!.lives_in, livesInFor(l, t));
  }
  // A scope, and what lives in it, as before: the place, what lives in it, and all part of or about that.
  const scope = (await answerRead(l, { scope: made.repo })) as { id: string }[];
  for (const id of [made.repo, made.hub, made.part, made.done, made.issue]) assert.ok(scope.some((e) => e.id === id));
  const theirs = (await answerRead(l.as(bo), { scope: made.repo })) as { id: string; title: string }[];
  assert.ok(theirs.some((e) => e.title === 'Bo private'));
  assert.ok(!((await answerRead(l.as('e_someone'), { scope: made.repo })) as { title: string }[]).some((e) => e.title === 'Bo private'));
});

test('a run read with what it touched answers as the touched store', async () => {
  const l = await fresh();
  const { task } = await make(l, [{ op: 'create', ref: 'task', type: 'task', title: 'Probe' }]);
  const a = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:\\code\\Apex', session_id: 'p1' }));
  await touchedPack.addTouched(kernelContext(l, 'sessions'), a.run, ([task, 'e_notthere']));
  assert.deepEqual(await touchedPack.touchedBy(kernelContext(l, 'sessions'), a.run), [task, 'e_notthere']);
  const runs = (await answerRead(l, { runs: { folder: 'C:\\code\\Apex', touched: true } })) as { rows: { id: string; touched: string[] }[] };
  assert.deepEqual(runs.rows.map((r) => [r.id, r.touched]), [[a.run, [task]]]);
});

test('instructions answer as the agents pack says them, and told counts each', async () => {
  const l = await fresh();
  const { task } = await make(l, [
    { op: 'create', ref: 'task', type: 'task', title: 'Probe' },
    { op: 'create', ref: 'rule', type: 'instruction', title: 'Mind the shims', body: 'Read the shim first.', props: { for: ['file:src/*.ts'] } },
    { op: 'link', type: 'about', from: 'rule', to: 'task' },
  ]);
  for (const [where, about] of [['file:src/packreads.ts', undefined], ['session_start', task], ['session_start', undefined], ['nowhere', undefined]] as const) {
    const answer = await answerRead(l, { instructions: { where, ...(about && { about }) } });
    assert.deepEqual(answer, await instructionsPack.instructionsFor(kernelContext(l, 'agents'), where, (about === undefined ? {} : { about })));
  }
  assert.ok(((await answerRead(l, { instructions: { where: 'session_start' } })) as unknown[]).length > 0, 'the presets said at the start of a session');
  const before = heldCounts(l.workspace, 'uses').find((c) => c.key === 'told:e_counted')?.n ?? 0;
  assert.equal(await answerRead(l, { told: ['e_counted', 'e_counted'] }), true);
  // A use is counted a moment after it is told (packs/usage/kernel/uses.ts counts through root.uses, never awaited).
  const count = () => heldCounts(l.workspace, 'uses').find((c) => c.key === 'told:e_counted')?.n;
  for (let i = 0; i < 100 && count() !== before + 2; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(count(), before + 2);
  await assert.rejects(answerRead(l, { told: 'e_counted' as never }), /told is a list of ids/);
});

test('events, views and what is placed in time answer as the query modules do', async () => {
  const l = await fresh();
  const { bo } = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }]);
  const made = await make(l, [
    { op: 'create', ref: 'task', type: 'task', title: 'Send the forms', props: { due: '2026-10-15' } },
    { op: 'create', ref: 'meet', type: 'event', title: 'Board meeting', props: { at: '2026-10-14T14:00:00Z', ends: '2026-10-14T15:30:00Z' } },
  ]);
  await make(l, [{ op: 'update', id: made.task, status: 'doing' }]);
  await l.as(bo).change({ kind: 'human', name: 'bo', person: bo }, { reason: 'Mine', ops: [{ op: 'create', ref: 'p', type: 'event', title: 'Bo private', visibility: 'private', props: { at: '2026-10-14T10:00:00Z' } }] });
  const since = new Date(0).toISOString();
  for (const asker of [l, l.as(bo), l.as('e_someone')]) {
    // events: as packreads read them, newest first, a few columns.
    for (const q of [{ action: 'update' }, { action: 'create', target: made.task }, { action: 'create', since, limit: 2 }, { action: 'create', limit: 5000 }]) {
      const ref = (await readEvents(asker.db, { ...q, limit: Math.min(q.limit ?? 50, 500) }))
        .filter((r) => !q.since || new Date(r.ts) > new Date(q.since))
        .map(({ seq, ts, actor, action, target_id, reason, detail }) => ({ seq, ts, actor, action, target_id, reason, detail }));
      assert.deepEqual(await answerRead(asker, { events: q }), ref);
    }
    // placed: the rows of those types, placed by timeaxis.
    const placedQ = { types: ['task', 'event'], from: '2026-10-12', to: '2026-10-18' };
    const axis = readAxis(placedQ);
    const { rows } = await asker.db.query<{ id: string; type: string; is_open: boolean; updated_at: Date }>(
      `select * from entity e where e.type = any($1::text[]) and e.archived_at is null and (e.is_open or e.updated_at >= $2::timestamptz) order by e.updated_at desc limit ${LENS_LIMIT}`,
      [placedQ.types.flatMap((t) => l.registry.family(t)), axis.from],
    );
    const spans = await timeaxisPack.placeAll(kernelContext(asker, 'query'), rows as never, axis, await timeaxisPack.zoneOf(kernelContext(asker, 'query')));
    const answer = (await answerRead(asker, { placed: placedQ })) as { id: string; open: boolean; time: unknown }[];
    assert.deepEqual(answer.map((e) => [e.id, e.open, e.time]), rows.filter((e) => spans.get(e.id)?.length).map((e) => [e.id, e.is_open, spans.get(e.id)]));
    // view: a kernel view, as it runs; a pack's view, as the pack asker answers it.
    const kernel = Object.keys(VIEWS).includes('changed_since') ? 'changed_since' : Object.keys(VIEWS)[0];
    const params = { since };
    assert.deepEqual(await answerRead(asker, { view: kernel, params }), await VIEWS[kernel].run(kernelContext(asker, 'query'), params));
    assert.deepEqual(await answerRead(asker, { view: 'attention', params: { person: bo } }), await viewsPack.askPackView(kernelContext(asker, 'query'), 'attention', ({ person: bo })));
  }
  await assert.rejects(answerRead(l, { placed: { types: ['task'], from: '2026-10-18', to: '2026-10-12' } }), /comes after/);
  await assert.rejects(answerRead(l, { view: 'no_such_view' }), /No view "no_such_view"|no_such_view/);
  const core = l.registry.packs.find((p) => p.id === 'core')!;
  await answerRead(l, { view: 'changed_since', params: { since }, pin: { pack: 'core', version: core.version } });
  await assert.rejects(answerRead(l, { view: 'changed_since', params: { since }, pin: { pack: 'core', version: '0.0.0-old' } }), /pinned to core 0\.0\.0-old; here it is answered by core/);
  const attentionBy = l.registry.packs.find((p) => p.views?.some((v) => v.id.endsWith('.attention')))?.id ?? 'attention';
  await assert.rejects(answerRead(l, { view: 'attention', pin: { pack: 'nobody', version: '1' } }), new RegExp(`pinned to nobody 1; here it is answered by ${attentionBy}`));
});
