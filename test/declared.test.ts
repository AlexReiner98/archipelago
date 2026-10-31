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

test("a token limited to some work may call a pack's action on that work only", async () => {
  const l = await map();
  const made = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'r', type: 'repo', title: 'Repo' },
      { op: 'create', ref: 't', type: 'task', title: 'Survey' },
      { op: 'create', ref: 'in', type: 'task', title: 'Survey here' },
      { op: 'link', type: 'lives_in', from: 'in', to: 'r' },
    ],
  })) as { created: Record<string, string> };
  const limited: Actor = { kind: 'agent', name: 'limited', within: [made.created.r] };
  assert.deepEqual(await callTool(l, limited, 'demo_visits', { site: 'Mill' }), []);
  // What it would write is checked as a change is, before anything is applied.
  await assert.rejects(callTool(l, limited, 'demo_plan_visit', { task: made.created.t, site: 'Mill' }), /"Visit Mill" is made without being tied/);
  assert.deepEqual(await callTool(l, human, 'demo_visits', { site: 'Mill' }), []);
  assert.equal(((await callTool(l, limited, 'demo_plan_visit', { task: made.created.in, site: 'Mill' })) as { status: string }).status, 'proposed', 'its own work passes, and waits as any agent change does');
  await assert.rejects(callTool(l, limited, 'demo_order', { item: 'nails' }), /act outside the map/);
});

test('a declared action with no handler, or of no verb, stops its pack from loading', () => {
  const dir = packs();
  const pack = JSON.parse(JSON.stringify({ id: 'demo', version: '1', title: 'D', requires: ['core'], actions: [{ id: 'demo.x', title: 'X', description: '', verb: 'shout', input: { type: 'object' } }] }));
  writeFileSync(join(dir, 'demo', 'pack.json'), JSON.stringify(pack));
  assert.throws(() => new Registry(dir), /specialises "shout", which is not a verb/);
});

test('screens are declared in pack files, checked when the pack loads, and listed in the schema', async () => {
  const l = await map();
  type Described = { screens: { id: string; pack: string; on: string[]; pieces: { piece: string; tree?: string }[] }[]; pack_tools: { tool: string; on?: string[]; item?: string; input?: unknown }[]; types: { id: string; public?: boolean }[] };
  const schema = l.registry.describe() as unknown as Described;
  const roadmap = schema.screens.find((s) => s.id === 'software.roadmap')!;
  assert.deepEqual([roadmap.pack, roadmap.on, roadmap.pieces], ['software', ['project'], [{ piece: 'tree', tree: 'software.roadmap' }]]);
  // What a page needs to draw a pack action's form: what it is on and its input.
  const plan = schema.pack_tools.find((t) => t.tool === 'demo_plan_visit')!;
  assert.deepEqual(plan.on, ['work']);
  assert.ok(plan.input, 'the form is drawn from its input');
  // What can be made public is said by the types themselves, and a flavour inherits it.
  assert.deepEqual(schema.types.filter((t) => t.public).map((t) => t.id).sort(), ['document', 'feature', 'project', 'proof', 'release', 'shared_document', 'test', 'test_result']);

  const dir = packs();
  const bad = (screens: unknown[]) => {
    writeFileSync(join(dir, 'demo', 'pack.json'), JSON.stringify({ id: 'demo', version: '1', title: 'D', requires: ['core'], views: screens.map((v) => ({ form: 'screen', ...(v as object) })) }));
    return () => new Registry(dir);
  };
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['nothing'], pieces: [{ piece: 'gate' }] }]), /is on unknown type "nothing"/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'chart' }] }]), /"chart" is not a piece/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'tree' }] }]), /a tree piece names its tree/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'view', view: 'demo.none' }] }]), /declares no view "demo.none" of rows/);
  assert.throws(bad([{ id: 's', title: 'S', on: ['task'], pieces: [{ piece: 'gate' }] }]), /must be named "demo.<name>"/);
  // A button says its word, its tooltip and one thing it does, by a pack's action or how it draws the canvas.
  assert.deepEqual(schema.screens.find((s) => s.id === 'core.style_apply')!.on, ['style']);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'button', tip: 'T', draw: { shape: 'list' } }] }]), /a button piece names its label/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'button', label: 'L', draw: { shape: 'list' } }] }]), /a button piece names its tip/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'button', label: 'L', tip: 'T' }] }]), /a button does one thing/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'button', label: 'L', tip: 'T', draw: { lens: 'x' } }] }]), /a button's draw says "style" or "shape"/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'button', label: 'L', tip: 'T', action: 'demo.none' }] }]), /declares no action "demo.none"/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', nav: true, pieces: [{ piece: 'page', page: 'nowhere' }] }]), /draws no page "nowhere"/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', on: ['task'], pieces: [{ piece: 'picture', lens: {}, style: { code: 'x' } }] }]), /a view's style has no code/);
  assert.throws(bad([{ id: 'demo.s', title: 'S', pieces: [{ piece: 'note', text: 'Hi' }] }]), /the kinds or types it is on or a place offered in the nav/);
  assert.doesNotThrow(bad([{ id: 'demo.s', title: 'S', on: ['work'], pieces: [{ piece: 'note', text: 'Hello' }] }]));
});
