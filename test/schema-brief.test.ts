// The schema tool answers an agent in a few kilobytes; a type, a relation or a pack is had whole on asking.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function map() {
  const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
  registries.push(reg);
  return new Archipelago(await openDb(), reg);
}

type Brief = { types: { id: string; statuses: string; fields?: string }[]; relations: Record<string, string> };

test('an agent is given each type and relation on a line; the whole is a quarter of the size or less', async () => {
  const l = await map();
  const brief = (await callTool(l, agent, 'schema', {})) as Brief;
  const whole = await callTool(l, human, 'schema', {});
  assert.ok(JSON.stringify(brief, null, 2).length * 4 < JSON.stringify(whole, null, 2).length, 'the brief is small');
  const task = brief.types.find((t) => t.id === 'task')!;
  assert.equal(task.statuses, 'todo doing waiting / done dropped');
  assert.match(task.fields!, /priority: low\|normal\|high\|urgent/);
  assert.doesNotMatch(task.fields!, /tokens_used/, 'a field the system keeps is not one to set');
  assert.equal(brief.relations.depends_on, '* -> *');
  assert.ok('screens' in ((await callTool(l, agent, 'schema', { full: true })) as object), 'full gives everything');
});

test('a type, a relation or a pack is given whole on asking, and a name that is none of them is refused', async () => {
  const l = await map();
  const task = (await callTool(l, agent, 'schema', { type: 'task' })) as { types: { fields: Record<string, { description?: string }> }[] };
  assert.equal(task.types.length, 1);
  assert.ok(task.types[0]!.fields.recurrence!.description, 'each field explained');
  const rel = (await callTool(l, agent, 'schema', { type: 'depends_on' })) as { relations: { description: string }[] };
  assert.match(rel.relations[0]!.description, /cannot finish/);
  const pack = (await callTool(l, agent, 'schema', { type: 'software' })) as { types: { pack: string }[] };
  assert.ok(pack.types.length > 1 && pack.types.every((t) => t.pack === 'software'));
  const kind = (await callTool(l, agent, 'schema', { type: 'work' })) as { types: { id: string }[] };
  assert.deepEqual(kind.types.map((t) => t.id), ['work'], 'a kind by its name before a pack of that name');
  await assert.rejects(callTool(l, agent, 'schema', { type: 'no.such' }), /No type, relation or pack/);
});
