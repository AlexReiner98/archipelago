// The pack host: a pack's handler in its own sandboxed process, reading as the actor and answering ops that the
// kernel applies as one change set naming the action.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { PackHost, resolved, Sandbox, type Answerer } from '../src/packhost.ts';
import { Registry } from '../src/packs.ts';
import { readEvents } from '../src/eventlog.ts';
import { freshWith, human } from './map.ts';

const dir = mkdtempSync(join(tmpdir(), 'pelago-host-'));
cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
cpSync(join(import.meta.dirname, 'packs', 'demo'), join(dir, 'demo'), { recursive: true });
const host = new PackHost((pack) => join(dir, pack));
after(() => host.stop());

test("an action reads the map and its ops are applied as one change set with the action's name", async () => {
  const l = await freshWith(new Registry(dir));
  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Survey the barn' }] })) as { created: Record<string, string> };
  const result = (await host.act(l, human, 'demo', 'demo.plan_visit', { task: made.created.t, site: 'Barn' })) as { answer: { earlier: number; by: string }; changeset: string; created: Record<string, string> };
  assert.deepEqual(result.answer, { earlier: 0, by: 'test', visit: result.created.v }, 'a {ref} in its answer is the id of what it made');
  const visit = await l.entity(result.created.v);
  assert.equal(visit!.type, 'demo.visit');
  const rows = (await readEvents(l.db, {})).filter((e) => e.changeset === result.changeset);
  assert.equal(rows.length, 2, 'a create, its link and nothing else');
  assert.ok(rows.every((r) => r.detail.action === 'demo.plan_visit' && r.reason === 'Plan a visit to Barn for "Survey the barn"'));
  const again = (await host.act(l, human, 'demo', 'demo.plan_visit', { task: made.created.t, site: 'Barn' })) as { answer: { earlier: number } };
  assert.equal(again.answer.earlier, 1, 'a second call reads the first one');
});

test('a handler that overruns is stopped, and the next call starts it again', async () => {
  const l = await freshWith(new Registry(dir));
  await assert.rejects(host.call(l, human, 'demo', 'action', 'demo.spin', {}, 500), /took longer than 500 ms and was stopped/);
  process.env.PELAGO_TEST_SECRET = 'not for packs';
  const env = ((await host.call(l, human, 'demo', 'action', 'demo.env', {})) as { answer: string[] }).answer;
  // It runs again, given nothing of the server's environment (Windows adds its own system variables, none secret).
  assert.ok(!env.some((k) => /PELAGO|TOKEN|KEY|SECRET/i.test(k)), env.join(', '));
});

test("a limit is the handler's own time: its process starting and the kernel answering its reads are not counted", async () => {
  const box = new Sandbox(join(dir, 'demo'));
  after(() => box.stop());
  // A busy machine: the process starts cold, and each read is answered well after the limit.
  const slow: Answerer = () => new Promise((done) => setTimeout(() => done([{ title: 'Visit Barn' }]), 400));
  const message = { call: 'action', actor: { name: 'test', kind: 'human' } };
  assert.deepEqual((await box.call(slow, { ...message, name: 'demo.visits', input: { site: 'Barn' } }, 200)).answer, ['Visit Barn']);
  await assert.rejects(box.call(slow, { ...message, name: 'demo.spin', input: {} }, 200), /took longer than 200 ms and was stopped/);
});

test('a handler is walled off the network and the process: each way out is refused, and its reads still answer', async () => {
  const box = new Sandbox(join(import.meta.dirname, 'packs', 'hostile'));
  after(() => box.stop());
  const read: Answerer = async (query) => ({ asked: query.get });
  const message = { call: 'action', actor: { name: 'test', kind: 'human' } };
  for (const name of ['net', 'http', 'bare_http', 'dns', 'child_process', 'module', 'data_url', 'fetch', 'websocket', 'binding', 'builtin']) {
    await assert.rejects(box.call(read, { ...message, name, input: {} }, 5000), /may import only its own modules|is not a function|is not a constructor|Cannot read properties of undefined/, name);
  }
  const plain = (await box.call(read, { ...message, name: 'plain', input: { id: 'e_1' } }, 5000)).answer;
  assert.deepEqual(plain, { hash: '11f6ad', seen: { asked: 'e_1' } }, 'an ordinary handler still answers, reading through the host');
});

test("a handler reads as the actor: another person's private item is not there for it", async () => {
  const l = await freshWith(new Registry(dir));
  const people = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'ann', type: 'person', title: 'Ann', visibility: 'shared' }, { op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }] })) as { created: Record<string, string> };
  const ann = l.as(people.created.ann);
  const mine = (await ann.change(human, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: "Ann's own", visibility: 'private' }] })) as { created: Record<string, string> };
  await assert.rejects(host.act(l.as(people.created.bo), human, 'demo', 'demo.plan_visit', { task: mine.created.t, site: 'Barn' }), /No task/);
  assert.equal(((await host.act(ann, human, 'demo', 'demo.plan_visit', { task: mine.created.t, site: 'Barn' })) as { status: string }).status, 'applied');
});

test('a handler cannot read outside its own folder', async () => {
  const l = await freshWith(new Registry(dir));
  await assert.rejects(host.call(l, human, 'demo', 'action', 'demo.peek', {}), /ERR_ACCESS_DENIED|Access to this API has been restricted/);
  await assert.rejects(host.call(l, human, 'demo', 'action', 'demo.nothing', {}), /The handler has no "demo.nothing"/);
});

test('a logged event names what was made by its ref, or records otherwise when it could not be made', () => {
  const e = { action: 'x.done', target: 'e_a', reason: 'done', detail: { ok: true, made: ['{n}', 'e_kept'] }, otherwise: { reason: 'failed', detail: { ok: false, why: 'not made: {error}' } } };
  assert.deepEqual(resolved(e, { n: 'e_note0001' }, {}), { action: 'x.done', target: 'e_a', reason: 'done', detail: { ok: true, made: ['e_note0001', 'e_kept'] } });
  assert.deepEqual(resolved(e, {}, { n: 'No item "e_gone"' }), { action: 'x.done', target: 'e_a', reason: 'failed', detail: { ok: false, made: ['e_kept'], why: 'not made: No item "e_gone"' } });
  assert.deepEqual(resolved({ action: 'x.done', detail: { made: ['{n}'] } }, {}, { n: 'gone' }), { action: 'x.done', detail: { made: [] } }, 'with no otherwise: the same entry, naming nothing it did not make');
});
