// A change to code read as its line diff (task e_vc5tpunk): a held change to a layout's code says what it would do as
// hunks for a person and as text for an agent, and the item's history says each change to it the same way, in place of
// its whole from and to.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh, make } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const agent: Actor = { kind: 'agent', name: 'test' };
const CODE = Array.from({ length: 60 }, (_, i) => `const line${i} = ${i};`).join('\n') + '\n';

test('a held change to code is read as its diff, by a person and by an agent', async () => {
  const l = await fresh();
  const { s, t } = await make(l, [
    { op: 'create', ref: 's', type: 'layout', title: 'Field', props: { code: CODE } },
    { op: 'create', ref: 't', type: 'task', title: 'A task' },
  ]);
  const held = (await callTool(l, agent, 'change', { reason: 'test', hold: true, ops: [{ op: 'update', id: t, title: 'Still a task' }, { op: 'update', id: s, props: { code: CODE.replace('line30 = 30', 'line30 = 300') } }] })) as { status: string; proposal: string };
  assert.notEqual(held.status, 'applied');
  type P = { id: string; ops: unknown[]; diffs?: { op: number; field: string; diff: unknown }[] };
  const mine = (await callTool(l, owner, 'proposals', {})) as P[];
  const p = mine.find((x) => x.id === held.proposal)!;
  assert.deepEqual(p.diffs!.map((d) => [d.op, d.field]), [[1, 'code']], 'only the op that changes code has a diff');
  const d = p.diffs![0].diff as { add: number; del: number; files: { hunks: { a: number; lines: string[] }[] }[] };
  assert.equal(d.add, 1);
  assert.equal(d.del, 1);
  assert.deepEqual(d.files[0].hunks[0].lines, [' const line27 = 27;', ' const line28 = 28;', ' const line29 = 29;', '-const line30 = 30;', '+const line30 = 300;', ' const line31 = 31;', ' const line32 = 32;', ' const line33 = 33;']);
  const theirs = (await callTool(l, agent, 'proposals', {})) as P[];
  assert.equal(theirs.find((x) => x.id === held.proposal)!.diffs![0].diff, '@@ -28 +28 @@\n const line27 = 27;\n const line28 = 28;\n const line29 = 29;\n-const line30 = 30;\n+const line30 = 300;\n const line31 = 31;\n const line32 = 32;\n const line33 = 33;');
});

test("an item's history says a change to its code as a diff, and full: true has it whole", async () => {
  const l = await fresh();
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'layout', title: 'Field', props: { code: CODE } }]);
  await callTool(l, owner, 'change', { reason: 'test', ops: [{ op: 'update', id: s, props: { code: CODE.replace('line5 = 5', 'line5 = 50') } }] });
  type E = { action: string; detail: { changes?: Record<string, { from?: unknown; to?: unknown; diff?: unknown; size?: number[] }> } };
  const change = (events: E[]) => events.find((e) => e.action === 'entity.update')!.detail.changes!['props.code'];
  const agents = change((await callTool(l, agent, 'events', { target: s })) as E[]);
  assert.match(String(agents.diff), /^@@ -3 \+3 @@\n const line2 = 2;[^]*\n-const line5 = 5;\n\+const line5 = 50;/);
  assert.equal(agents.from, undefined, 'not the whole from and to');
  assert.deepEqual(agents.size, [CODE.length, CODE.length + 1]);
  const persons = change((await callTool(l, owner, 'events', { target: s })) as E[]);
  assert.equal((persons.diff as { add: number }).add, 1, 'a person is given the hunks to draw');
  const whole = change((await callTool(l, agent, 'events', { target: s, full: true })) as E[]);
  assert.equal(whole.from, CODE);
  const got = (await callTool(l, agent, 'get', { id: s, history: true })) as { recent_events: E[] };
  assert.match(String(change(got.recent_events).diff), /\+const line5 = 50;/);
});
