// What the owner's page shows reaches an agent: the page says its address with its beat, the prompt hook says it in a
// line, and query seeing reads it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerHook } from '../src/hook-answers.ts';
import { NOW_MS, seen, seenNow } from '../src/seeing.ts';
import { keep } from '../src/transient.ts';
import { whose } from '../src/presence.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, human, make } from './map.ts';

test('the view and the open item the page says reach the prompt hook and query seeing', async () => {
  const l = await fresh();
  const { t, v } = await make(l, [
    { op: 'create', ref: 't', type: 'task', title: 'Draw the ridges' },
    { op: 'create', ref: 'v', type: 'lens', title: 'What blocks the launch' },
  ]);
  assert.equal(await callTool(l, agent, 'query', { name: 'seeing' }), null, 'no page has said anything');

  await callTool(l, human, 'tail', { page: { page: 'p1', on: false, where: `e/${t}?canvas=${v}` } });
  const read = (await callTool(l, agent, 'query', { name: 'seeing' })) as any;
  assert.equal(read.view, 'What blocks the launch');
  assert.equal(read.lens, v);
  assert.deepEqual(read.item, { id: t, title: 'Draw the ridges', type: 'task' });

  const prompt = (await answerHook('prompt', { whole: l.db, pelago: l, within: [], body: { session_id: 's1' }, running: { started: new Date(0).toISOString() }, origin: 'http://127.0.0.1' })) as any;
  const said = prompt.hookSpecificOutput.additionalContext as string;
  assert.match(said, /The owner's page shows the view What blocks the launch/);
  assert.match(said, new RegExp(`task "Draw the ridges" \\(${t}\\) open`));

  // A query of its own is said as its terms, with the items it names by title.
  await callTool(l, human, 'tail', { page: { page: 'p2', on: false, where: `v?find=id%20${t}&over=depends_on&steps=2` } });
  assert.equal(((await callTool(l, agent, 'query', { name: 'seeing' })) as any).view, 'id "Draw the ridges", walk depends_on 2', 'the newest page wins');

  // A page that has not looked for a while is not what the owner is looking at now.
  await keep(l.db, `seeing:${whose(l)}`, { ...(await seenNow(l.db, l))!, said: Date.now() - NOW_MS - 1000 }, 60_000);
  assert.equal(await callTool(l, agent, 'query', { name: 'seeing' }), null);
  await seen(l.db, l, 'p3', 'home');
  assert.equal(((await callTool(l, agent, 'query', { name: 'seeing' })) as any).screen, 'home');
});

test("an agent is told whether the tab in sight is its own chat's, another chat's, or the owner's following it", async () => {
  const l = await fresh();
  const mine = await callTool(l, agent, 'session_start', { session_id: 'mine', title: 'My chat' }) as any;
  const theirs = await callTool(l, agent, 'session_start', { session_id: 'theirs', title: 'Their chat' }) as any;
  const line = async () => ((await answerHook('prompt', { whole: l.db, pelago: l, within: [], body: { session_id: 'mine' }, running: { started: new Date(0).toISOString() }, origin: 'http://127.0.0.1' })) as any).hookSpecificOutput.additionalContext as string;
  await callTool(l, human, 'tail', { page: { page: 'p1', on: true, where: `e/${mine.run}`, tab: { chat: mine.run, own: true } } });
  assert.match(await line(), /^On your tab, the owner's page shows/m);
  assert.deepEqual(((await callTool(l, agent, 'query', { name: 'seeing', params: { run: mine.run } })) as any).tab, { chat: mine.run, title: 'My chat', own: true, yours: true });
  await callTool(l, human, 'tail', { page: { page: 'p1', on: true, where: `e/${theirs.run}`, tab: { chat: theirs.run, own: true } } });
  assert.match(await line(), /The owner's page shows another chat's tab \("Their chat"\), not yours\./);
  await callTool(l, human, 'tail', { page: { page: 'p1', on: true, where: `e/${mine.run}`, tab: { chat: mine.run, own: false } } });
  assert.match(await line(), /^On a tab of theirs following you, the owner's page shows/m);
});
