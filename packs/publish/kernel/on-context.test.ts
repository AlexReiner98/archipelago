// The publish pack on its context, run without a database: what it reads, which root service it asks and with what,
// and what it refuses before asking anything. The whole of publishing against a real map is in test/ (agent-publish,
// preview, public-view, server-published, published-frames), through the shims at src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { drawingFile, drawingWorker, shippedDrawing } from './drawing-files.ts';
import { framesFor } from './published-frames.ts';
import { publish, unpublish } from './published.ts';
import { putPicture } from './pictures.ts';
import { servePublic } from './public-route.ts';
import { share, unshare } from './public-view.ts';

type Call = { name: string; input: unknown };
/** A context whose reads answer by their key, whose calls answer by name, and which says each call it was asked. */
function fake(reads: Record<string, unknown>, answers: Record<string, unknown> = {}, calls: Call[] = [], workspace = 'ws') {
  const registry = { packs: [], family: (t: string) => [t], type: () => undefined, relations: new Map(), isA: () => false, relationFamily: (t: string) => [t] };
  return {
    workspace,
    registry,
    reads: async (q: Record<string, unknown>) => reads[Object.keys(q)[0]],
    call: async (name: string, input: unknown) => (calls.push({ name, input }), typeof answers[name] === 'function' ? (answers[name] as (i: unknown) => unknown)(input) : answers[name]),
    said: () => {},
  } as unknown as KernelContext;
}
const person = { kind: 'human' as const, name: 'alex', person: 'p_alex' };
const agent = { kind: 'agent' as const, name: 'claude' };
const HASH = 'b'.repeat(64);

test('a token that may only propose never publishes, and nothing is asked of the rules or the rows', async () => {
  const calls: Call[] = [];
  await assert.rejects(publish(fake({}, {}, calls), { ...agent, may: 'propose' }, 'e_aaaaaaaa'), /may only propose/);
  assert.deepEqual(calls, []);
});

test('publishing asks the rules first, then makes the document public as the one publishing, then writes its rows', async () => {
  const calls: Call[] = [];
  const doc = { id: 'e_aaaaaaaa', type: 'document', title: 'Doc', status: 'open', body: '', visibility: 'shared', props: {}, updated_at: '' };
  const reads = { entities: [doc], publishable: { types: ['document'], finished: [] }, published_others: [], public_document: { parts: [] }, log_head: 7 };
  const out = await publish(fake(reads, { 'page.look': { colors: {} } }, calls), person, doc.id);
  assert.deepEqual(out, { published: doc.id, sections: 0, lenses: 0 });
  assert.deepEqual(calls.map((c) => c.name), ['root.may', 'root.publish', 'page.look', 'root.publish']);
  assert.deepEqual(calls[0].input, { act: 'publish', human: true });
  assert.deepEqual(calls[1].input, { act: 'visibility', id: doc.id, actor: 'human:alex', visibility: 'public', authority: { of: 'human', who: 'human:alex' } });
  const rows = calls[3].input as { act: string; by: string; given: { style_at: number; look: unknown } };
  assert.equal(rows.act, 'publish');
  assert.equal(rows.by, 'p_alex');
  assert.equal(rows.given.style_at, 7);
  assert.deepEqual(rows.given.look, { colors: {} });
});

test('taking a document down asks the rules, then takes its rows, then shares it again', async () => {
  const calls: Call[] = [];
  const doc = { id: 'e_aaaaaaaa', type: 'document', title: 'Doc', visibility: 'public', props: {} };
  await unpublish(fake({ entities: [doc] }, {}, calls), person, doc.id);
  assert.deepEqual(calls.map((c) => [c.name, (c.input as { act: string }).act]), [['root.may', 'unpublish'], ['root.publish', 'unpublish'], ['root.publish', 'visibility']]);
});

test('only a person shares a view; one with no public view says so', async () => {
  const calls: Call[] = [];
  await assert.rejects(share(fake({}, {}, calls), agent, 'e_aaaaaaaa'), /Only a person makes a view public/);
  assert.deepEqual(calls, []);
  await assert.rejects(unshare(fake({}, { 'root.publish': false }), person, 'e_aaaaaaaa'), /has no public view/);
});

test('a picture is checked before it is kept: its item, its type, its size; then kept by the rules root as the one who sent it', async () => {
  const calls: Call[] = [];
  const ctx = fake({ entities: [{ id: 'e_aaaaaaaa', type: 'lens' }] }, {}, calls);
  await assert.rejects(putPicture(fake({ entities: [] }), agent, { result: 'e_aaaaaaaa', data: 'AA==', content_type: 'image/png' }), /there is no item/);
  await assert.rejects(putPicture(ctx, agent, { result: 'e_aaaaaaaa', data: 'AA==', content_type: 'image/gif' }), /must be one of/);
  await assert.rejects(putPicture(ctx, agent, { result: 'e_aaaaaaaa', data: '', content_type: 'image/png' }), /is empty/);
  assert.deepEqual(calls, []);
  const kept = await putPicture(ctx, agent, { result: 'e_aaaaaaaa', data: 'AAEC', content_type: 'image/png' });
  assert.deepEqual(kept, { result: 'e_aaaaaaaa', size: 3, content_type: 'image/png' });
  assert.deepEqual(calls, [{ name: 'root.picture', input: { id: 'e_aaaaaaaa', actor: 'agent:claude', content_type: 'image/png', data: 'AAEC' } }]);
});

test('a drawing is asked of the surface root only by a hash, and a file only by a module name', async () => {
  const calls: Call[] = [];
  const ctx = fake({}, { 'root.drawing': (i: { file?: string; worker?: boolean }) => (i.worker ? 'sw' : i.file ? 'text' : true) }, calls);
  assert.equal(await drawingFile(ctx, 'not-a-hash', 'index.js'), null);
  assert.equal(await drawingFile(ctx, HASH, 'index.ts'), null);
  assert.equal(await drawingWorker(ctx, 'nope'), null);
  assert.equal(await shippedDrawing(ctx, 'nope'), false);
  assert.deepEqual(calls, []);
  assert.equal(await drawingFile(ctx, HASH, 'index.js'), 'text');
  assert.equal(await drawingWorker(ctx, HASH), 'sw');
  assert.equal(await shippedDrawing(ctx, HASH), true);
  assert.deepEqual(calls.map((c) => c.input), [{ hash: HASH, file: 'index.js' }, { hash: HASH, worker: true }, { hash: HASH }]);
});

test('a first frame is asked only of a drawing that names its hash, and kept only when it opens', async () => {
  const calls: Call[] = [];
  const lenses = {
    e_aaaaaaaa: { style: { drawing: { id: 'flow', hash: HASH } }, items: [], links: [] } as Record<string, unknown>,
    e_bbbbbbbb: { style: { drawing: { id: 'flow' } }, items: [], links: [] } as Record<string, unknown>,
    e_cccccccc: { style: {}, items: [], links: [] } as Record<string, unknown>,
  };
  await framesFor(fake({}, { 'root.scene': (i: { hash?: string }) => (i.hash === HASH ? { scene: { svg: 1 }, css_ok: true } : null) }, calls), lenses as never);
  assert.deepEqual(lenses.e_aaaaaaaa.first, { svg: 1 });
  assert.equal(lenses.e_bbbbbbbb.first, undefined);
  assert.deepEqual(calls.map((c) => (c.input as { hash?: string }).hash), [HASH, ''], 'one sent with no hash is asked for none, and none runs');
});

test('a product page of a workspace the server does not hold is a 404, its page still sent, and its data nothing', async () => {
  const written: { status: number; headers: Record<string, string>; body?: unknown }[] = [];
  const res = { writeHead(status: number, headers: Record<string, string>) { written.push({ status, headers }); return res; }, end(body?: unknown) { written[written.length - 1].body = body; } };
  const ctx = fake({}, { 'root.public_product': { guard: { 'x-content-type-options': 'nosniff' }, policy: "default-src 'self'", found: false, html: '<html>' } }, [], '');
  await servePublic(ctx, res, { workspace: 'gone', id: 'e_aaaaaaaa' });
  assert.equal(written[0].status, 404);
  assert.equal(written[0].body, '<html>');
  assert.equal(written[0].headers['content-security-policy'], "default-src 'self'");
  await servePublic(ctx, res, { workspace: 'gone', id: 'e_aaaaaaaa', what: 'data' });
  assert.equal(written[1].status, 404);
  assert.equal(written[1].headers['x-content-type-options'], 'nosniff');
});
