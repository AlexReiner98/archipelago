// Sessions started as the answer to a pack's action a person called (src/pack-action-launch.ts): only from a pack
// that asks for reach.launch, ten at most, never for an agent, each run naming the pack. The launcher is stubbed:
// nothing is started.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { LaunchInput, StartedBy } from '../src/launch-brief.ts';
import { setActionLaunch } from '../src/pack-action-launch.ts';
import { PackHost } from '../src/packhost.ts';
import { Registry } from '../src/packs.ts';
import { agent, freshWith, human } from './map.ts';

const dir = mkdtempSync(join(tmpdir(), 'pelago-action-launch-'));
cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
for (const p of ['starter', 'quiet']) cpSync(join(import.meta.dirname, 'action-launch', p), join(dir, p), { recursive: true });
const host = new PackHost((pack) => join(dir, pack));
after(() => host.stop());

const started: { actor: string; input: LaunchInput; by?: StartedBy }[] = [];
setActionLaunch(async (_l, actor, input, by) => {
  started.push({ actor: actor.kind, input, by });
  return { run: `e_run${started.length}`, mode: input.mode ?? 'plan' };
});

test('a person calling an action of a pack that asks for reach.launch starts what it answers, each from its held brief, its run naming the pack', async () => {
  const l = await freshWith(new Registry(dir));
  started.length = 0;
  const done = (await host.act(l, human, 'starter', 'starter.go', { task: 'e_aaaaaaaa', n: 2 })) as { launches: { task: string; run: string }[] };
  assert.deepEqual(done.launches, [{ task: 'e_aaaaaaaa', run: 'e_run1' }, { task: 'e_aaaaaaaa', run: 'e_run2' }]);
  assert.deepEqual(started.map((s) => s.actor), ['human', 'human'], 'on the person’s authority');
  assert.deepEqual(started.map((s) => s.input.brief?.text), ['# Held 0', '# Held 1'], 'each from the brief the pack holds');
  assert.deepEqual(started[1].by, { round: 1, kind: 'pack', pack: 'starter', id: 'e_aaaaaaaa', name: 'Round 1' }, 'its run names the pack, so its session only proposes');
});

test('launches are refused whole: from an agent, from a pack that does not ask for reach.launch, and more than ten', async () => {
  const l = await freshWith(new Registry(dir));
  started.length = 0;
  await assert.rejects(host.act(l, agent, 'starter', 'starter.go', { task: 'e_aaaaaaaa', n: 1 }), /only a person calling its action/);
  await assert.rejects(host.act(l, human, 'quiet', 'quiet.go', { task: 'e_aaaaaaaa', n: 1 }), /does not ask for reach\.launch/);
  await assert.rejects(host.act(l, human, 'starter', 'starter.go', { task: 'e_aaaaaaaa', n: 11 }), /11 sessions in one answer; it may start 10 at most/);
  assert.equal(started.length, 0, 'nothing was started');
});
