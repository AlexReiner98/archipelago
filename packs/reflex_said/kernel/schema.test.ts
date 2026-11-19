import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOf, schemaNodes, withFired } from './schema.ts';

const task = { id: 'task', pack: 'core', title: 'Task', description: 'A piece of work.', statuses: { open: ['todo', 'doing'], closed: ['done'] }, fields: { priority: { type: 'enum', values: ['low', 'high'] }, due: { type: 'date' }, source: { type: 'string', system: true } } };
const bears = { id: 'bears_on', title: 'bears on', from: ['*'], to: ['question'] };

test("each type is a node, its words its description, with the checks it implies; a link's ends are a check", () => {
  const nodes = schemaNodes([task], [bears, { id: 'link', title: 'is linked to', from: ['*'], to: ['*'] }]);
  assert.deepEqual(nodes.filter((n) => !n.id.startsWith('check:change')).map((n) => [n.id, n.kind, n.for[0]]), [
    ['type:task', 'type', 'tool:change:task'],
    ['check:task:fields', 'check', 'tool:change:task'],
    ['check:task:status', 'check', 'tool:change:task:status'],
    ['check:task:priority', 'check', 'tool:change:task:priority'],
    ['check:link:bears_on', 'check', 'tool:change:link:bears_on'],
  ]);
  assert.equal(nodes.find((n) => n.id === 'type:task')!.words, 'A piece of work.');
  assert.ok(nodes.every((n) => n.tier === 'schema'));
});

test("a refusal's words name the check that made it; a rule's own words name none", () => {
  const cases: [string, string | undefined][] = [
    ['Change refused (x): op 1 (update): task has no field "kind" (fields: due)', 'check:task:fields'],
    ['op 2 (update): status "built" is not valid for task. Use one of: todo', 'check:task:status'],
    ['op 1 (create): task.priority must be one of: low, normal', 'check:task:priority'],
    ['ui.screen.checks_left must be a string', 'check:ui.screen:checks_left'],
    ['finding.value needs value_type, one of: text', 'check:finding:value'],
    ['op 1 (link): "bears_on" must point to question, not task', 'check:link:bears_on'],
    ['unknown type "issue". Known types: actor', 'check:change:type'],
    ['op 3 (unlink): no active relation "r_x"', 'check:change:ops'],
    ['"The canvas, by eye" would hold 110 items, past its cap of 100', undefined],
  ];
  for (const [said, id] of cases) assert.equal(checkOf(said), id, said);
});

test("each check carries its refusals' times; one no type implied is drawn where its type's are", () => {
  const nodes = withFired(schemaNodes([task], [bears]), [
    { at: '2026-11-19T10:00:00Z', said: 'status "open" is not valid for task' },
    { at: '2026-11-18T10:00:00Z', said: 'status "built" is not valid for task' },
    { at: '2026-11-18T11:00:00Z', said: 'task.note must be a string' },
  ]);
  assert.deepEqual(nodes.find((n) => n.id === 'check:task:status')!.fired, ['2026-11-18T10:00:00Z', '2026-11-19T10:00:00Z']);
  assert.deepEqual(nodes.find((n) => n.id === 'check:task:note'), { id: 'check:task:note', kind: 'check', pack: 'core', tier: 'schema', for: ['tool:change:task:note'], title: 'Task: note', guards: 'values', fired: ['2026-11-18T11:00:00Z'] });
});
