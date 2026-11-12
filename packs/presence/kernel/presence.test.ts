// Presence and seeing on a fake context: the transient store (root.transient) and the reads are a few rows in memory.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { listening, point, presence, tellStamp, took, watching, looked } from './presence.ts';
import { inSight, seeing, seeingLine, seen, seenNow } from './seeing.ts';
import { pointAct, screenAct, sightAnswer, tookAct } from './acts.ts';

type Ask = { keep?: { key: string; value: unknown }; kept?: string; scan?: { keys: string[]; prefixes: string[]; except: string[] } };

function fake(items: Record<string, { id: string; title: string; type: string; props?: Record<string, unknown> }> = {}, within: Record<string, string[]> = {}) {
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  const ctx = {
    workspace: 'w1',
    call: async (name: string, ask: Ask) => {
      calls.push(name);
      assert.equal(name, 'root.transient');
      if (ask.keep) return void store.set(ask.keep.key, ask.keep.value);
      if (ask.kept) return store.get(ask.kept);
      const { keys, prefixes, except } = ask.scan!;
      return [...store].filter(([k]) => (keys.includes(k) || prefixes.some((p) => k.startsWith(p))) && !except.includes(k)).map(([key, value]) => ({ key, value }));
    },
    reads: async (read: { ids?: string[]; run_within?: string }) => (read.ids ? read.ids.flatMap((id) => (items[id] ? [items[id]] : [])) : within[read.run_within!] ?? []),
  } as unknown as KernelContext;
  return { ctx, store, calls };
}

test('a step names its session, what it works within, and is kept for the screen', async () => {
  const { ctx, store } = fake({ e_run00001: { id: 'e_run00001', title: 'Draw the ridges', type: 'run', props: { name: 'otter' } } }, { e_run00001: ['e_task0001', 'e_plan0001'] });
  const w = { workspace: 'w1', viewer: 'e_owner001' };
  await point(ctx, w, { at: 1, hash: 'e/e_x', actor: 'robot' });
  await took(ctx, w, { kind: 'show', actor: 'robot', hash: 'e/e_x', run: 'e_run00001' }, true);
  const seenBy = await presence(ctx, w);
  assert.equal(seenBy.focus?.hash, 'e/e_x');
  assert.deepEqual(seenBy.steps.map((s) => [s.kind, s.name, s.title, s.within]), [['show', 'otter', 'Draw the ridges', ['e_task0001', 'e_plan0001']]]);
  assert.ok([...store.keys()].some((k) => k.startsWith('steps:w1:e_owner001:')), 'kept under the screen');
  await tellStamp(ctx);
  assert.ok((await presence(ctx, w)).told > 0);
  await listening(ctx, 1);
  assert.equal((await presence(ctx, w)).listening, 1, 'its own process counts what waits here');
  await listening(ctx, -1);
  await looked(ctx, w, { page: 'p1', on: true });
  assert.deepEqual(await watching(ctx, w), { open: 1, following: 1 });
});

test('what the owner looks at is read as the agent sees the map', async () => {
  const { ctx } = fake({ e_task0001: { id: 'e_task0001', title: 'Draw the ridges', type: 'task' }, e_lens0001: { id: 'e_lens0001', title: 'What blocks', type: 'lens' } });
  const w = { workspace: 'w1' };
  assert.equal(await seenNow(ctx, w), undefined);
  await seen(ctx, w, 'p1', 'e/e_task0001?canvas=e_lens0001', { chat: 'e_run00001', own: false }, ['e_run00001']);
  const s = (await seenNow(ctx, w))!;
  assert.deepEqual(await seeing(ctx, s), { view: 'What blocks', lens: 'e_lens0001', item: { id: 'e_task0001', title: 'Draw the ridges', type: 'task' }, ago: 0, tab: { chat: 'e_run00001', own: false, yours: false } });
  assert.match((await seeingLine(ctx, w))!, /the view What blocks \(e_lens0001\), with task "Draw the ridges" \(e_task0001\) open/);
  assert.deepEqual(await inSight(ctx, w, 'e_run00001', 1), { looking: true, where: 'In the tab they are looking at.' });
  assert.equal((await inSight(ctx, w, 'e_run00001', 0)).looking, false, 'no page open');
});

test('what the tool surface asks by name: a show pointed, a told beat, a page polling, whether a show lands in sight', async () => {
  const { ctx } = fake({ e_run00002: { id: 'e_run00002', title: 'Show it', type: 'run' } });
  const whose = { workspace: 'w1', viewer: 'e_owner002' };
  const focus = { at: 5, hash: 'e/e_y', actor: 'robot' };
  assert.deepEqual(await pointAct(ctx, { whose, focus, step: { kind: 'show', actor: 'robot', hash: 'e/e_y', run: 'e_run00002' } }), focus);
  await tookAct(ctx, { whose, told: true, step: { kind: 'story', actor: 'robot', did: 'found it', hash: 'e/e_run00002', run: 'e_run00002' } });
  const given = await screenAct(ctx, { whose, page: { page: 'p2', on: true, where: 'e/e_y', lands: ['e_run00002'] } });
  assert.equal(given.focus?.hash, 'e/e_y');
  assert.deepEqual(given.steps.map((s) => s.kind), ['show', 'story']);
  assert.ok(given.told > 0, 'a told beat moves the stamp');
  assert.deepEqual(await sightAnswer(ctx, { whose, actor: 'robot', focus: true }), { pages: { open: 1, following: 1 }, sight: { looking: true, where: 'In the tab they are looking at.' } });
});
