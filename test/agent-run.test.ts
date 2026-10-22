// A pack's model run, run by the kernel: one asked for under a once is run once, whichever server asks first, and
// taken again only when it was cut off long enough ago.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../src/agent-run.ts';
import { configureModels } from '../src/model-account.ts';
import { startRuns } from '../src/pack-reach.ts';
import { fresh, make } from './map.ts';

/** Wait until the run taken under this once has ended. */
async function ended(l: Awaited<ReturnType<typeof fresh>>, once: string) {
  for (let i = 0; i < 400; i++) {
    if ((await l.db.query(`select 1 from setting where key = $1 and (value->>'done')::boolean`, [`run_once:demo:${once}`])).rows.length) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`the run of ${once} did not end`);
}

test('a run asked for once is run once: refused while it runs, for good once it ended, and taken again only when cut off long ago', async () => {
  let asked = 0;
  configureModels({ ask: () => async () => (asked++, { content: [{ type: 'text', text: 'Nothing to change.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }) as any });
  const l = await fresh();
  await l.setSecret('anthropic_key', 'sk-ant-' + 'x'.repeat(30));
  const { repo } = await make(l, [{ op: 'create', ref: 'repo', type: 'software.repo', title: 'Tools repo' }]);
  const pack = { id: 'demo', version: '0', title: 'Demo', runs: [] };
  const ask = (once: string) => startRuns(l, { kind: 'agent', name: 'pack:demo' }, pack, 'event', [{ title: `Read ${once}`, system: 'Read it.', task: 'A push.', within: [repo], once }]);
  assert.deepEqual(await ask('acme/tools@b'), [{ started: true, title: 'Read acme/tools@b' }]);
  assert.deepEqual(await ask('acme/tools@b'), [{ started: false, title: 'Read acme/tools@b', reason: 'It is being run, or has been, already.' }], 'while it runs');
  await ended(l, 'acme/tools@b');
  assert.equal((await ask('acme/tools@b'))[0].started, false, 'and once it ended');
  assert.equal(asked, 1);
  // One whose server stopped before it ended is taken again, after a while.
  await l.db.query(`insert into setting (key, value) values ('run_once:demo:acme/tools@c', jsonb_build_object('at', now() - interval '31 minutes', 'done', false))`);
  assert.equal((await ask('acme/tools@c'))[0].started, true);
  await ended(l, 'acme/tools@c');
  await l.db.query(`insert into setting (key, value) values ('run_once:demo:acme/tools@d', jsonb_build_object('at', now() - interval '5 minutes', 'done', false))`);
  assert.equal((await ask('acme/tools@d'))[0].started, false, 'not while it may still be running');
});
