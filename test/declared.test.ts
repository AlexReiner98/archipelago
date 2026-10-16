// Actions and views declared in pack files: offered as tools beside the kernel's, run by the pack's handler, and a
// view callable with a token limited to reading where an action is not.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool, toolsFor } from '../src/tools.ts';

const human: Actor = { kind: 'human', name: 'test' };

function packs(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-declared-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  cpSync(join(import.meta.dirname, 'packs', 'demo'), join(dir, 'demo'), { recursive: true });
  return dir;
}

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function map() {
  const reg = new Registry(packs());
  registries.push(reg);
  return new Archipelago(await openDb(), reg);
}

test('the core pack declares the six verbs', async () => {
  const l = await map();
  assert.deepEqual(l.registry.verbs.map((v) => v.id), ['capture', 'assign', 'report', 'ask', 'settle', 'revise']);
});

test("a pack's action and view are offered as tools and run by its handler", async () => {
  const l = await map();
  const tools = new Map(toolsFor(l.registry));
  assert.match(tools.get('demo_plan_visit')!.description, /capture, from the demo pack/);
  assert.ok(tools.get('demo_visits'), 'the view is a tool');
  assert.ok(tools.get('search'), "the kernel's tools are still there");
  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Survey' }] })) as { created: Record<string, string> };
  const done = (await callTool(l, human, 'demo_plan_visit', { task: made.created.t, site: 'Mill' })) as { status: string };
  assert.equal(done.status, 'applied');
  assert.deepEqual(await callTool(l, human, 'demo_visits', { site: 'Mill' }), ['Visit Mill']);
  await assert.rejects(callTool(l, human, 'demo_plan_visit', { task: made.created.t }), /Invalid input for demo_plan_visit/);
});

test('a token limited to some work may call a pack view but not its action', async () => {
  const l = await map();
  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'r', type: 'software.repo', title: 'Repo' }, { op: 'create', ref: 't', type: 'task', title: 'Survey' }] })) as { created: Record<string, string> };
  const limited: Actor = { kind: 'agent', name: 'limited', repos: [made.created.r] };
  assert.deepEqual(await callTool(l, limited, 'demo_visits', { site: 'Mill' }), []);
  await assert.rejects(callTool(l, limited, 'demo_plan_visit', { task: made.created.t, site: 'Mill' }), /cannot call demo_plan_visit/);
});

test('a declared action with no handler, or of no verb, stops its pack from loading', () => {
  const dir = packs();
  const pack = JSON.parse(JSON.stringify({ id: 'demo', version: '1', title: 'D', requires: ['core'], actions: [{ id: 'demo.x', title: 'X', description: '', verb: 'shout', input: { type: 'object' } }] }));
  writeFileSync(join(dir, 'demo', 'pack.json'), JSON.stringify(pack));
  assert.throws(() => new Registry(dir), /specialises "shout", which is not a verb/);
});
