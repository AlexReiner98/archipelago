// How the page reads the server (task e_bmh2braj): the same read is never sent twice at once, reads asked together go
// as one request (packs/kit/page/reads.js) and are answered there each as alone (packs/surface/kernel/reads.ts), what
// moves only with the map is kept with where the map stood and asked again with it (task e_mvuvfba7), and the page's get leaves out what no page draws.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { reader } from '../packs/kit/page/reads.js';
import { serve } from './serve.ts';

type Call = { tool: string; input: Record<string, unknown> };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A reader over a fake server that counts what it was sent. */
function counted() {
  const sent: (Call | Call[])[] = [];
  const one = async (tool: string, input: Record<string, unknown>) => (sent.push({ tool, input }), { tool, input });
  const many = async (calls: Call[]) => (sent.push(calls), calls.map((c) => (c.tool === 'events' ? { error: 'no' } : { result: { tool: c.tool, input: c.input } })));
  return { sent, ...(reader(one, many, (tool: string) => tool === 'pack_rows') as { api: (tool: string, input?: unknown) => Promise<{ tool: string; input: Record<string, unknown> }> }) };
}

test('reads asked together go as one request, the same read once, and each asker has its own answer', async () => {
  const { sent, api } = counted();
  const [a, b, c, rows] = await Promise.all([api('get', { id: 'e_aaaaaaaa' }), api('get', { id: 'e_aaaaaaaa' }), api('proposals'), api('pack_rows', { about: 'e_aaaaaaaa' })]);
  assert.equal(sent.length, 1, 'one request');
  assert.deepEqual((sent[0] as Call[]).map((x) => x.tool), ['get', 'proposals', 'pack_rows'], 'the same read sent once; a pack view goes with them');
  assert.deepEqual(a.input, { id: 'e_aaaaaaaa', bare: true }, "the page's get is bare");
  assert.notEqual(a, b, 'each asker is handed its own copy');
  assert.equal(c.tool, 'proposals');
  assert.equal(rows.tool, 'pack_rows');
  await assert.rejects(Promise.all([api('events', { target: 'e_aaaaaaaa' }), api('search', { q: 'x' })]), /no/, 'one read refused is said to its asker');
});

test('a lone read goes under its own name; what moves with the map is kept with where it stood and asked again with it', async () => {
  const sent: unknown[] = [];
  let stands = 'a', reads = 0;
  const one = async (tool: string, input: Record<string, unknown>) => (sent.push({ tool, input }), { tool, input });
  // A fake server: a kept read answered with where the map stands, unchanged when asked with it.
  const many = async (calls: (Call & { since?: string })[]) => (
    sent.push(calls),
    calls.map((c) => (c.since === stands ? { unchanged: true } : c.tool === 'view' || c.tool === 'proposals' ? { result: { n: ++reads }, at: stands } : { result: { tool: c.tool } }))
  );
  const { api } = reader(one, many) as { api: (tool: string, input?: unknown) => Promise<Record<string, unknown>> };
  await api('get', { id: 'e_aaaaaaaa' });
  assert.deepEqual(sent.pop(), { tool: 'get', input: { id: 'e_aaaaaaaa', bare: true } }, 'a lone read that is not kept goes under its own name');
  const first = await api('view', { name: 'saved_views', params: {} });
  assert.deepEqual(sent.pop(), [{ tool: 'view', input: { name: 'saved_views', params: {} } }], 'a kept read goes among reads, alone or not');
  const again = await api('view', { name: 'saved_views', params: {} });
  assert.deepEqual(sent.pop(), [{ tool: 'view', input: { name: 'saved_views', params: {} }, since: 'a' }], 'asked again with where the map stood');
  assert.deepEqual(again, first, 'unchanged: the kept answer is handed out');
  assert.notEqual(again, first, 'as a copy');
  await api('change', { ops: [] });
  stands = 'b';
  const moved = await api('view', { name: 'saved_views', params: {} });
  assert.equal(moved.n, 2, 'the map moved: the new answer, with no letting go');
  await Promise.all([api('proposals'), api('search', { q: 'x' })]);
  assert.deepEqual((sent.pop() as Call[]).map((c) => c.tool), ['proposals', 'search']);
  await api('proposals');
  assert.equal((sent.pop() as { since?: string }[])[0].since, 'b');
});

test('the server answers a kept read unchanged while the map stands, and anew once anything it shows moves', async () => {
  const { call } = await serve('off');
  const views = { tool: 'view', input: { name: 'saved_views', params: {} } };
  const ask = async (...calls: object[]) => (await call('/api/reads', undefined, { calls })) as { result: { result?: unknown; at?: string; unchanged?: true; error?: string }[]; headers?: Headers };
  const [first, held] = (await ask(views, { tool: 'proposals', input: {} })).result;
  assert.ok(typeof first.at === 'string' && first.at === held.at, 'each kept read says where the map stood');
  const [same, plain] = (await ask({ ...views, since: first.at }, { tool: 'search', input: { q: 'x' } })).result;
  assert.deepEqual(same, { unchanged: true }, 'nothing moved: unchanged, not read');
  assert.equal(plain.at, undefined, 'a read not kept carries no position');
  assert.ok(Array.isArray(plain.result));
  // A view saved anywhere moves where the map stands: the next ask has it.
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'lens', title: 'Saved just now', props: { filter: { find: ['type task'] }, walk: { over: [], steps: 0 } } }] });
  const [after] = (await ask({ ...views, since: first.at })).result;
  assert.notEqual(after.at, first.at);
  assert.ok((after.result as { pictures: { title: string }[] }).pictures.some((p) => p.title === 'Saved just now'), 'the view saved is in the new answer');
  const [stale] = (await ask({ ...views, since: 'somewhere else' })).result;
  assert.ok(stale.result && stale.at === after.at, 'a position not where the map stands is answered whole');
});

test('more reads than one request carries go in turn', async () => {
  const { sent, api } = counted();
  await Promise.all(Array.from({ length: 45 }, (_, i) => api('get', { id: `e_${String(i).padStart(8, '0')}` })));
  assert.deepEqual(sent.map((s) => (Array.isArray(s) ? s.length : 1)), [40, 5]);
  await tick();
});

test('the server answers reads together as each alone, refuses a write among them, and its get can be bare', async () => {
  const { call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'task', title: 'One' }] })).result.created as Record<string, string>;
  const answer = await call('/api/reads', undefined, { calls: [{ tool: 'get', input: { id: made.a, bare: true } }, { tool: 'get', input: { id: made.a } }, { tool: 'change', input: { reason: 'x', ops: [] } }, { tool: 'get', input: { id: 'e_zzzzzzzz' } }] });
  const [bare, whole, write, missing] = answer.result as { result?: Record<string, unknown>; error?: string }[];
  assert.equal((bare.result!.entity as { title: string }).title, 'One');
  assert.ok((bare.result!.shown_in as unknown[]).length === 0 && (bare.result!.trail as unknown[]).length === 0, 'bare: no views it is drawn in, no trail');
  assert.ok(Array.isArray(whole.result!.shown_in) && Array.isArray(whole.result!.recent_events), 'a get not bare is as it was');
  assert.match(write.error!, /Only reads go together/);
  assert.match(missing.error!, /No item/);
  assert.equal((await call('/api/reads', undefined, { calls: [] })).status, 400);
});
