// A server pack launches an agent (packs/surface/kernel/server-launch.ts, task e_ukp2mqys): the pack names the command and reads its
// lines; the kernel holds the run, the token and the spawn. The pack here (test/server-packs/launch/agent) starts a
// stand-in agent, node printing JSON lines, as the claude_code pack will start Claude Code.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { configureLauncher, launch } from '../packs/surface/kernel/launcher.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { ServerPacks } from '../packs/surface/kernel/server-host.ts';
import { configureLaunch, fillArgv, launchPackGone, packLauncher } from '../packs/surface/kernel/server-launch.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const FIXTURES = join(import.meta.dirname, 'server-packs', 'launch');
const dir = mkdtempSync(join(tmpdir(), 'pelago-pack-launch-'));
const packs = new ServerPacks({} as never, [FIXTURES]);
after(() => {
  packs.stop();
  configureLauncher(undefined);
  delete process.env.PELAGO_SECRET_SOMETHING;
  rmSync(dir, { recursive: true, force: true });
});

/** A place found by its folder, as a repository is: where a launch runs. */
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
  throw new Error('the launched run never ended');
}

test('a launcher’s command is filled from the closed list, and an argument left empty goes with its flag', () => {
  assert.deepEqual(fillArgv(['x', '{prompt}', '--model', '{model}', '{other}'], { prompt: 'p' }), ['x', 'p', '{other}']);
  assert.match(String(packLauncher(packs, 'nobody')), /no server pack here/);
  assert.match(String(packLauncher(packs, 'agent:else')), /declares no launcher "else"/);
});

test('a person launches the pack’s agent: its run registered, its tokens and words recorded, the run ended and its token revoked', async () => {
  const l = await freshWith(new Registry(packsWith(YARD)));
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'yard.checkout', title: 'Repo', props: { path: dir } },
    { op: 'create', ref: 'task', type: 'task', title: 'Launch probe' },
    { op: 'link', type: 'lives_in', from: 'task', to: 'repo' },
  ]);
  // A secret of the server's own, which the process must not be given.
  process.env.PELAGO_SECRET_SOMETHING = 'not for the agent';
  configureLaunch({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(dir, 'runs'), auth: true, packs, pack: 'agent' });

  await assert.rejects(launch(l, agent, { task: made.task }), /Only a human/);

  const first = await launch(l, human, { task: made.task });
  const begun = (await l.entity(first.run))!;
  assert.equal(begun.is_open, true, 'registered before it runs');
  const done = await ended(l, first.run);
  assert.equal(done.status, 'finished');
  assert.match(done.body, /All done/);
  assert.equal(done.props.tokens_used, 1234, 'what read answered of its tokens is on the run');
  assert.ok(((done.props.story ?? []) as { said: string }[]).some((b) => b.said === 'Read the brief: true'), 'what it said is a beat, and it was given the brief');

  const lines = readFileSync(first.transcript, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
  const seen = lines.find((m) => m.kind === 'env');
  assert.deepEqual([seen.token, seen.same, seen.others], [true, true, []], 'its environment holds its token, the one its MCP config carries, and no other of the server’s');
  assert.deepEqual(seen.args, ['--tools', 'mcp__pelago__query,mcp__pelago__change,mcp__pelago__report,mcp__pelago__assign,mcp__pelago__revise,mcp__pelago__ask'], 'no model was set, so --model went');
  const { rows } = await l.db.query<{ revoked_at: unknown }>(`select revoked_at from token where name = $1`, [`launched:${first.run}`]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].revoked_at, 'its token is revoked once it ends');
  assert.equal(existsSync(join(dir, 'runs', `${first.run}.mcp.json`)), false, 'and its MCP config is gone');

  const failing = await ended(l, (await launch(l, human, { task: made.task, instructions: 'please FAIL' })).run);
  assert.equal(failing.status, 'failed', 'an outcome read is the run’s');

  // The pack gone, its running process is stopped and its run ended; and it launches nothing more.
  const hung = await launch(l, human, { task: made.task, instructions: 'HANG' });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(launchPackGone('agent'), [hung.run]);
  assert.equal((await ended(l, hung.run)).status, 'failed');

  // Named wrong, the setting turns launching off rather than falling back to the kernel's own.
  configureLaunch({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(dir, 'runs'), packs, pack: 'nobody' });
  await assert.rejects(launch(l, human, { task: made.task }), /Launching is off/);
});

test('on Windows, an npm .cmd shim is run without a shell: the program it starts', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { withoutShell } = await import('../packs/surface/kernel/server-launch.ts');
  const bin = join(dir, 'bin');
  mkdirSync(join(bin, 'node_modules', 'tool'), { recursive: true });
  writeFileSync(join(bin, 'tool.cmd'), String.raw`@ECHO off
CALL :find_dp0
"%dp0%\node_modules\tool\bin\tool.exe"   %*
`);
  writeFileSync(join(bin, 'script.cmd'), String.raw`"%_prog%"  "%dp0%\node_modules\script\cli.js" %*
`);
  assert.deepEqual(withoutShell(['tool', '-p'], 'win32', bin), [join(bin, 'node_modules', 'tool', 'bin', 'tool.exe'), '-p']);
  assert.deepEqual(withoutShell(['script', '-p'], 'win32', bin), [process.execPath, join(bin, 'node_modules', 'script', 'cli.js'), '-p']);
  assert.deepEqual(withoutShell(['tool', '-p'], 'linux', bin), ['tool', '-p'], 'elsewhere as it was');
  assert.deepEqual(withoutShell(['nothing'], 'win32', bin), ['nothing']);
  assert.deepEqual(withoutShell([process.execPath, 'x.js'], 'win32', bin), [process.execPath, 'x.js']);
});
