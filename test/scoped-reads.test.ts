// No request reads the whole map: a lens reads what its filter includes (and refuses a filter of nothing), a
// graph with no focus the newest links, attention what is a person's or inside an item, and an agent is told what
// changed as counts and the newest few. The structure test keeps the queries bounded; this keeps the answers.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken, revokeToken } from '../src/auth.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, human, make } from './map.ts';

const view = (l: Awaited<ReturnType<typeof fresh>>, who: typeof human, name: string, params: Record<string, unknown> = {}) => callTool(l, who, 'view', { name, params }) as Promise<any>;

test('a lens reads only what its filter includes: one that includes nothing is refused', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'House' },
    { op: 'create', ref: 'f', type: 'feature', title: 'Roof' },
    { op: 'create', ref: 't', type: 'task', title: 'Tiles' },
    { op: 'create', ref: 'q', type: 'project', title: 'Garden' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 't', to: 'f' },
    { op: 'link', type: 'part_of', from: 'q', to: 't' },
  ]);
  await assert.rejects(view(l, human, 'flat'), /includes something/, 'never the whole map');
  const top = await view(l, human, 'flat', { filter: { types: ['project'] } });
  assert.deepEqual(top.items.map((i: any) => i.title).sort(), ['Garden', 'House'], 'the types it names');
  const tasks = await view(l, human, 'flat', { filter: { types: ['task'] } });
  assert.deepEqual(tasks.items.map((i: any) => i.title), ['Tiles']);
});

test('a graph with no focus is drawn from the newest links of each kind', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'task', title: 'B' },
    { op: 'create', ref: 'c', type: 'task', title: 'C' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
  ]);
  const graph = await view(l, human, 'graph');
  assert.deepEqual(graph.nodes.map((n: any) => n.title).sort(), ['A', 'B'], 'what no link of the kind joins is not read');
  assert.deepEqual([graph.nodes.find((n: any) => n.title === 'A').blocked, graph.edges.length], [true, 1]);
});

test('an agent is told what changed as counts and the newest few, not the list', async () => {
  const l = await fresh();
  const since = new Date(Date.now() - 1000).toISOString();
  await make(l, Array.from({ length: 8 }, (_, i) => ({ op: 'create' as const, type: 'task', title: `Task ${i}` })));
  const forHuman = await view(l, human, 'changed_since', { since });
  const forAgent = await view(l, agent, 'changed_since', { since });
  assert.equal(forHuman.events.length, 8);
  assert.deepEqual([forAgent.events.length, forAgent.counts['entity.create'], /newest 5 of 8/.test(forAgent.more)], [5, 8, true]);
  assert.equal((await view(l, agent, 'changed_since', { since, limit: 8 })).events.length, 8, 'more when it asks');

  const { latest } = (await callTool(l, agent, 'watch', {})) as { latest: number };
  await make(l, Array.from({ length: 7 }, (_, i) => ({ op: 'create' as const, type: 'task', title: `More ${i}` })));
  const heard = (await callTool(l, agent, 'watch', { after: latest })) as { changes: unknown[]; counts: Record<string, number>; more: number; latest: number };
  assert.deepEqual([heard.changes.length, heard.counts['entity.create'], heard.more, heard.latest > latest], [5, 7, 2, true]);
});

test('a token revoked while it waits on watch is told nothing more', async () => {
  const l = await fresh();
  const made = await createToken(l.db, l.workspace, { kind: 'agent', name: 'listener' });
  const robot = { ...agent, token: made.id };
  const { latest } = (await callTool(l, robot, 'watch', {})) as { latest: number };
  const waiting = callTool(l, robot, 'watch', { after: latest, wait_seconds: 10 });
  await new Promise((r) => setTimeout(r, 1500)); // it is waiting, its token good
  await revokeToken(l.db, made.id);
  await make(l, [{ op: 'create', type: 'task', title: 'Said after the revoke' }]);
  await assert.rejects(waiting, /revoked while it waited/);
});

test('a link to an item someone may not see is no event of theirs: its far end is not named', async () => {
  const l = await fresh();
  const people = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo' }]);
  const shared = await make(l, [{ op: 'create', ref: 's', type: 'task', title: 'Shared work', visibility: 'shared' }]);
  const bo = l.as(people.bo);
  const mine = (await bo.change({ kind: 'human', name: 'bo', person: people.bo }, { ops: [{ op: 'create', ref: 'p', type: 'note', title: 'Mine', visibility: 'private' }, { op: 'link', type: 'link', from: shared.s, to: 'p' }], reason: 'test' })) as { created: Record<string, string> };
  const seen = async (who: typeof l) => JSON.stringify(await callTool(who, human, 'events', { limit: 50 }));
  assert.ok((await seen(bo)).includes(mine.created.p), 'Bo sees his own link');
  assert.ok(!(await seen(l.as('someone else'))).includes(mine.created.p), 'nobody else is told the id of what it reaches');
});
