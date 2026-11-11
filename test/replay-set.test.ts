// A fixed replay set (src/replay-set.ts, task e_a2scax9j): finished tasks with their briefs frozen, run again through
// the launcher under a named pack version. The agent launched is the stand-in of test/server-launch.test.ts (node
// printing JSON lines, test/server-packs/launch/agent): it says "Read the brief: true" when its prompt holds the
// heading "# Launch probe", so a run proves which brief it was given.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { configureLauncher } from '../src/launcher.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { ServerPacks } from '../src/server-host.ts';
import { configureLaunch } from '../src/server-launch.ts';
import { callTool } from '../src/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const FIXTURES = join(import.meta.dirname, 'server-packs', 'launch');
const dir = mkdtempSync(join(tmpdir(), 'pelago-replay-set-'));
const packs = new ServerPacks({} as never, [FIXTURES]);
after(() => {
  packs.stop();
  configureLauncher(undefined);
  rmSync(dir, { recursive: true, force: true });
});

const YARD: PackFile = {
  id: 'yard', version: '1', title: 'Yard', requires: ['core'],
  types: [{ id: 'yard.checkout', title: 'Checkout', description: '', extends: 'place', fields: { path: { type: 'string' } }, capabilities: { where: { folder: 'path' } } }],
};

async function ended(l: Awaited<ReturnType<typeof freshWith>>, run: string) {
  for (let i = 0; i < 150; i++) {
    const e = (await l.entity(run))!;
    if (!e.is_open) return e;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the replayed run never ended');
}

test('a replay set freezes finished tasks’ briefs, and a replay runs each frozen brief under the version named, started by the set', async () => {
  const l = await freshWith(new Registry(packsWith(YARD)));
  const ops: Parameters<typeof make>[1] = [{ op: 'create', ref: 'repo', type: 'yard.checkout', title: 'Repo', props: { path: dir } }];
  for (let i = 0; i < 6; i++) ops.push({ op: 'create', ref: `t${i}`, type: 'task', title: 'Launch probe', status: i < 5 ? 'done' : 'todo' }, { op: 'link', type: 'lives_in', from: `t${i}`, to: 'repo' });
  const made = await make(l, ops);
  const done = [0, 1, 2, 3, 4].map((i) => made[`t${i}`]);

  await assert.rejects(callTool(l, human, 'replay_freeze', { title: 'Too few', tasks: done.slice(0, 4) }), /5 to 10 tasks; this one would hold 4/);
  await assert.rejects(callTool(l, human, 'replay_freeze', { title: 'Unfinished', tasks: [...done.slice(0, 4), made.t5] }), /is not finished/);
  const frozen = (await callTool(l, human, 'replay_freeze', { title: 'Spring set', tasks: done })) as { set: string; tasks: unknown[] };
  assert.equal(frozen.tasks.length, 5);

  // The task changes after it was frozen: the replay runs the brief as it was.
  await l.change(human, { ops: [{ op: 'update', id: done[0], title: 'Renamed since' }], reason: 'test' });
  const again = (await callTool(l, human, 'replay_freeze', { set: frozen.set, tasks: [done[0]] })) as { tasks: { title: string }[] };
  assert.equal(again.tasks[0].title, 'Launch probe', 'a task the set holds keeps the brief it was frozen with');

  configureLaunch({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(dir, 'runs'), auth: true, packs, pack: 'agent' });
  await assert.rejects(callTool(l, agent, 'replay', { set: frozen.set, version: 'core@0.1.0' }), /human/);
  await assert.rejects(callTool(l, human, 'replay', { set: frozen.set, version: 'core@9.9.9' }), /runs core@0\.1\.0, not 9\.9\.9/);

  const core = l.registry.packs.find((p) => p.id === 'core')!.version;
  const replayed = (await callTool(l, human, 'replay', { set: frozen.set, version: `core@${core}` })) as { runs: { task: string; run?: string; problem?: string }[] };
  assert.deepEqual(replayed.runs.map((r) => r.problem), [undefined, undefined, undefined, undefined, undefined]);
  for (const r of replayed.runs) {
    const run = await ended(l, r.run!);
    assert.equal(run.status, 'finished');
    assert.deepEqual(run.props.started_by, { kind: 'replay', id: frozen.set, name: `Spring set (core@${core})`, version: `core@${core}`, task: r.task });
    assert.ok(((run.props.story ?? []) as { said: string }[]).some((b) => b.said === 'Read the brief: true'), 'it ran the frozen brief');
  }
  // A replay is run again, not worked on: the finished task is not taken up by its run.
  const { rows } = await l.db.query(`select 1 from relation where type = 'works_on' and to_id = any($1::text[])`, [done]);
  assert.equal(rows.length, 0);
  assert.equal((await l.entity(done[0]))!.status, 'done');
});
