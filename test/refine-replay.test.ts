// A fixed replay set through the refine pack's actions (packs/refine/replay.js, the replays pack's types; task
// e_bagaw58f): finished tasks' briefs held, then each run again through the launcher as the pack's answer. The agent
// launched is the stand-in of test/server-launch.test.ts (node printing JSON lines): it says "Read the brief: true"
// when its prompt holds the heading "# Launch probe", so a run proves which brief it was given. Nothing real starts.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { islandsOff } from '../src/islands.ts';
import { configureLauncher } from '../src/launcher.ts';
import { PackHost } from '../src/packhost.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { ServerPacks } from '../src/server-host.ts';
import { configureLaunch } from '../src/server-launch.ts';
import { agent, freshWith, human, make, PACKS, packsWith } from './map.ts';

const dir = mkdtempSync(join(tmpdir(), 'pelago-refine-replay-'));
const agents = new ServerPacks({} as never, [join(import.meta.dirname, 'server-packs', 'launch')]);
const host = new PackHost((pack) => join(PACKS, pack));
after(() => {
  host.stop();
  agents.stop();
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

test('on an island map, replays is words only and refine a map pack: neither is turned off', () => {
  const manifests = ['core', 'refine', 'replays'].map((p) => JSON.parse(readFileSync(join(PACKS, p, 'pack.json'), 'utf8')));
  const off = islandsOff(manifests, 'local');
  assert.equal(off.get('refine'), undefined);
  assert.equal(off.get('replays'), undefined);
});

test('the refine pack holds finished tasks’ briefs on a replay set, and replays each held brief under the version named, its run naming the set', async () => {
  const l = await freshWith(new Registry(packsWith(YARD)));
  const ops: Parameters<typeof make>[1] = [{ op: 'create', ref: 'repo', type: 'yard.checkout', title: 'Repo', props: { path: dir } }];
  for (let i = 0; i < 6; i++) ops.push({ op: 'create', ref: `t${i}`, type: 'task', title: 'Launch probe', status: i < 5 ? 'done' : 'todo' }, { op: 'link', type: 'lives_in', from: `t${i}`, to: 'repo' });
  const made = await make(l, ops);
  const done = [0, 1, 2, 3, 4].map((i) => made[`t${i}`]);

  await assert.rejects(host.act(l, human, 'refine', 'refine.replay_freeze', { title: 'Unfinished', tasks: [...done.slice(0, 4), made.t5] }), /is not finished/);
  const frozen = (await host.act(l, human, 'refine', 'refine.replay_freeze', { title: 'Spring set', tasks: done })) as { answer: { set: string; held: number } };
  assert.equal(frozen.answer.held, 5);
  const set = frozen.answer.set;
  assert.equal((await l.entity(set))!.type, 'replays.set');

  // The task changes after its brief was held: a replay runs the brief as it was.
  await l.change(human, { ops: [{ op: 'update', id: done[0], title: 'Renamed since' }], reason: 'test' });

  configureLaunch({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(dir, 'runs'), auth: true, packs: agents, pack: 'agent' });
  const core = l.registry.packs.find((p) => p.id === 'core')!.version;
  await assert.rejects(host.act(l, agent, 'refine', 'refine.replay', { set, version: `core@${core}` }), /only a person calling its action/);
  await assert.rejects(host.act(l, human, 'refine', 'refine.replay', { set, version: 'core@9.9.9' }), /runs core@.*, not 9\.9\.9/);

  const replayed = (await host.act(l, human, 'refine', 'refine.replay', { set, version: `core@${core}` })) as { launches: { task: string; run?: string; problem?: string }[] };
  assert.deepEqual(replayed.launches.map((r) => r.task), done);
  assert.deepEqual(replayed.launches.map((r) => r.problem), [undefined, undefined, undefined, undefined, undefined]);
  for (const r of replayed.launches) {
    const run = await ended(l, r.run!);
    assert.equal(run.status, 'finished');
    const by = run.props.started_by as Record<string, unknown>;
    assert.deepEqual([by.kind, by.pack, by.id, by.version, by.task], ['pack', 'refine', set, `core@${core}`, r.task]);
    assert.ok(((run.props.story ?? []) as { said: string }[]).some((b) => b.said === 'Read the brief: true'), 'it ran the held brief');
    assert.ok(Array.isArray(run.props.packs), 'its run says which packs it ran under (step 0)');
  }
  const { rows } = await l.db.query(`select 1 from relation where type = 'works_on' and to_id = any($1::text[])`, [done]);
  assert.equal(rows.length, 0, 'a replay is run again, not worked on: no finished task is taken up');
  const tokens = await l.db.query<{ may: string | null }>(`select may from token where name like 'launched:%'`);
  assert.ok(tokens.rows.length === 5 && tokens.rows.every((t) => t.may === 'propose'), 'each session only proposes');
});
