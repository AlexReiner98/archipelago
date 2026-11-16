// How the page reads the server (task e_bmh2braj): the same read is never sent twice at once, reads asked together go
// as one request (packs/kit/page/reads.js) and are answered there each as alone (packs/surface/kernel/reads.ts), what
// does not change between clicks is kept until the map moves, and the page's get leaves out what no page draws.

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
  return { sent, ...(reader(one, many, (tool: string) => tool === 'pack_rows') as { api: (tool: string, input?: unknown) => Promise<{ tool: string; input: Record<string, unknown> }>; forget: () => void }) };
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

test('a lone read goes under its own name, and what is kept is asked again once the map moves or the page writes', async () => {
  const { sent, api, forget } = counted();
  await api('view', { name: 'shared', params: {} });
  assert.deepEqual(sent, [{ tool: 'view', input: { name: 'shared', params: {} } }]);
  await api('view', { name: 'shared', params: {} });
  await api('get', { id: 'e_aaaaaaaa' });
  await api('get', { id: 'e_aaaaaaaa' });
  assert.equal(sent.length, 3, 'what is shared kept; an item asked again once its first answer is in');
  await api('tail', {});
  await api('view', { name: 'shared', params: {} });
  assert.equal(sent.length, 4, 'following the log lets go of nothing');
  forget();
  await api('view', { name: 'shared', params: {} });
  assert.equal(sent.length, 5, 'the map moved: asked again');
  await api('change', { ops: [] });
  await api('view', { name: 'shared', params: {} });
  assert.equal(sent.length, 7, 'a write lets go of what was kept');
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
