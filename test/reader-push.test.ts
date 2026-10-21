// The push read's narrow tools without a server: what they send to the map, with the map's tools as a script.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leanTools } from '../src/reader-push.ts';

const repo = { installation: '1', name: 'Acme/Tools', entity: { id: 'e_repo0001', title: 'Tools repo', type: 'software.repo' } };
const push = { branch: 'main', default_branch: 'main', before: 'a'.repeat(40), after: 'b'.repeat(40) };

test('update sends only what changes, and refuses an update that changes nothing', async () => {
  const sent: any[] = [];
  const call = async (_l: unknown, _a: unknown, name: string, input: any) => {
    if (name === 'get') return { entity: { id: input.id, status: 'todo', title: 'Oil the whetstone' } };
    sent.push(input);
    return { status: 'applied' };
  };
  const { run } = leanTools(call as any, {} as any, repo, push);
  const l = {} as any;
  const me = { kind: 'agent', name: 'reader' } as any;
  await assert.rejects(run(l, me, 'update', { id: 'e_task0001', title: 'Oil the whetstone', status: 'todo', why: 'x' }), /Nothing to change: e_task0001 is already "Oil the whetstone" \[todo\]/);
  await assert.rejects(run(l, me, 'update', { id: 'e_task0001', why: 'x' }), /Say what to change/);
  assert.equal(sent.length, 0);
  await run(l, me, 'update', { id: 'e_task0001', title: 'Oil the whetstone', status: 'done', why: 'The commit oils it' });
  assert.deepEqual(sent[0].ops, [{ op: 'update', id: 'e_task0001', status: 'done' }], 'the title it already has is left out');
  assert.equal(sent[0].source.uri, `https://github.com/Acme/Tools/commit/${'b'.repeat(40)}`);
  assert.deepEqual(sent[0].authority, { of: 'agent', basis: 'The commit oils it' });
  await run(l, me, 'update', { id: 'e_task0001', append: 'Oiled in bbbbbbb.', why: 'x' });
  assert.deepEqual(sent[1].ops, [{ op: 'update', id: 'e_task0001', append: 'Oiled in bbbbbbb.' }], 'a line added is always a change');
});
