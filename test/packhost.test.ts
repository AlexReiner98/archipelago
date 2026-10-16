// The pack host: a pack's handler in its own sandboxed process, reading as the actor and answering ops that the
// kernel applies as one change set naming the action.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { PackHost } from '../src/packhost.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';

const human: Actor = { kind: 'human', name: 'test' };
const dir = mkdtempSync(join(tmpdir(), 'pelago-host-'));
cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
cpSync(join(import.meta.dirname, 'packs', 'demo'), join(dir, 'demo'), { recursive: true });
const host = new PackHost((pack) => join(dir, pack));
after(() => host.stop());

test("an action reads the map and its ops are applied as one change set with the action's name", async () => {
  const l = new Archipelago(await openDb(), new Registry(dir));
  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Survey the barn' }] })) as { created: Record<string, string> };
  const result = (await host.act(l, human, 'demo', 'demo.plan_visit', { task: made.created.t, site: 'Barn' })) as { answer: { earlier: number; by: string }; changeset: string; created: Record<string, string> };
  assert.deepEqual(result.answer, { earlier: 0, by: 'test' });
  const visit = await l.entity(result.created.v);
  assert.equal(visit!.type, 'demo.visit');
  const { rows } = await l.db.query<{ action: string; reason: string; detail: { action?: string } }>(`select action, reason, detail from event where changeset = $1`, [result.changeset]);
  assert.equal(rows.length, 2, 'a create, its link and nothing else');
  assert.ok(rows.every((r) => r.detail.action === 'demo.plan_visit' && r.reason === 'Plan a visit to Barn for "Survey the barn"'));
  const again = (await host.act(l, human, 'demo', 'demo.plan_visit', { task: made.created.t, site: 'Barn' })) as { answer: { earlier: number } };
  assert.equal(again.answer.earlier, 1, 'a second call reads the first one');
});

test('a handler that overruns is stopped, and the next call starts it again', async () => {
  const l = new Archipelago(await openDb(), new Registry(dir));
  await assert.rejects(host.call(l, human, 'demo', 'action', 'demo.spin', {}, 500), /took longer than 500 ms and was stopped/);
  process.env.PELAGO_TEST_SECRET = 'not for packs';
  const env = ((await host.call(l, human, 'demo', 'action', 'demo.env', {})) as { answer: string[] }).answer;
  // It runs again, given nothing of the server's environment (Windows adds its own system variables, none secret).
  assert.ok(!env.some((k) => /PELAGO|TOKEN|KEY|SECRET/i.test(k)), env.join(', '));
});

test("a handler reads as the actor: another person's private item is not there for it", async () => {
  const l = new Archipelago(await openDb(), new Registry(dir));
  const people = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'ann', type: 'person', title: 'Ann', visibility: 'shared' }, { op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }] })) as { created: Record<string, string> };
  const ann = l.as(people.created.ann);
  const mine = (await ann.change(human, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: "Ann's own", visibility: 'private' }] })) as { created: Record<string, string> };
  await assert.rejects(host.act(l.as(people.created.bo), human, 'demo', 'demo.plan_visit', { task: mine.created.t, site: 'Barn' }), /No task/);
  assert.equal(((await host.act(ann, human, 'demo', 'demo.plan_visit', { task: mine.created.t, site: 'Barn' })) as { status: string }).status, 'applied');
});

test('a handler cannot read outside its own folder', async () => {
  const l = new Archipelago(await openDb(), new Registry(dir));
  await assert.rejects(host.call(l, human, 'demo', 'action', 'demo.peek', {}), /ERR_ACCESS_DENIED|Access to this API has been restricted/);
  await assert.rejects(host.call(l, human, 'demo', 'action', 'demo.nothing', {}), /The handler has no "demo.nothing"/);
});
