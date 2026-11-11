// A session started as a pack's answer: the automations pack hears an automation come due and answers launch, and the
// kernel starts it only for an enabled automation the kernel's clock told of, as that automation says, on the
// authority of the human who approved it. Launched with a stand-in command that waits a moment and exits: no agent.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { configureLauncher, type Launcher } from '../src/launcher.ts';
import { launchHeard } from '../src/pack-launch.ts';
import { PackHost } from '../src/packhost.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { freshWith, make, packsWith } from './map.ts';

const YARD: PackFile = {
  id: 'yard', version: '1', title: 'Yard', requires: ['core'],
  types: [{ id: 'yard.checkout', title: 'Checkout', description: '', extends: 'place', fields: { path: { type: 'string' }, remote: { type: 'url' } }, capabilities: { where: { address: 'remote', folder: 'path' } } }],
};
const dir = packsWith(YARD);
const host = new PackHost((pack) => join(dir, pack));
const stand: Launcher = { pack: 'stand', command: () => ({ argv: [process.execPath, '-e', 'setTimeout(() => {}, 400)'], env: {}, read: () => undefined }) };
configureLauncher({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(mkdtempSync(join(tmpdir(), 'pelago-packlaunch-')), 'runs'), via: stand });
after(() => (host.stop(), configureLauncher(undefined)));

const heard = (target: string, pack = 'kernel') => ({ event: { action: 'item.due', pack, target, detail: { type: 'automation', at: new Date().toISOString() } } });
const pack = { kind: 'agent' as const, name: 'pack:automations' };

test('an automation come due launches what it says, on its approver\'s authority, and not again while that runs', async () => {
  const l = await freshWith(new Registry(dir));
  const repo = mkdtempSync(join(tmpdir(), 'pelago-repo-'));
  const m = await make(l, [
    { op: 'create', ref: 'repo', type: 'yard.checkout', title: 'Repo', props: { path: repo } },
    { op: 'create', ref: 'proj', type: 'aim', title: 'Proj' },
    { op: 'create', ref: 'task', type: 'task', title: 'Refine the map' },
    { op: 'create', ref: 'other', type: 'task', title: 'Something else' },
    { op: 'link', type: 'lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'task', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'other', to: 'proj' },
    { op: 'create', ref: 'auto', type: 'automation', title: 'Nightly refiner', status: 'enabled', props: { trigger: 'daily', at: '03:00', action: 'launch', input: { task: '{task}', mode: 'plan', instructions: 'Refine.' } } },
    { op: 'create', ref: 'paused', type: 'automation', title: 'Paused', status: 'paused', props: { trigger: 'daily', at: '03:00', action: 'launch', input: { task: '{task}' } } },
    { op: 'link', type: 'about', from: 'auto', to: 'proj' },
    { op: 'link', type: 'about', from: 'paused', to: 'proj' },
  ]);
  // A {ref} in props is not filled: set the task's id now.
  await make(l, [{ op: 'update', id: m.auto, props: { input: { task: m.task, mode: 'plan', instructions: 'Refine.' } } }, { op: 'update', id: m.paused, props: { input: { task: m.task } } }]);

  const first = (await host.act(l, pack, 'automations', 'item.due', heard(m.auto), 5000, 'event')) as { launched?: { launched: boolean; run: string; mode: string } };
  assert.equal(first.launched?.launched, true);
  assert.equal(first.launched?.mode, 'plan');
  const run = (await l.entity(first.launched!.run))!;
  assert.deepEqual(run.props.started_by, { kind: 'automation', id: m.auto, name: 'Nightly refiner' }, 'its run names the automation, so it only proposes');
  assert.equal((await l.entity(m.auto))!.props.last_run, run.id);

  // While that session is open the pack answers nothing, and the kernel would start nothing either.
  const again = (await host.act(l, pack, 'automations', 'item.due', heard(m.auto), 5000, 'event')) as { launched?: unknown };
  assert.equal(again.launched, undefined);
  assert.deepEqual(await launchHeard(l, 'automations', heard(m.auto), { task: m.task, mode: 'plan', instructions: 'Refine.' }), { launched: false, why: `the session it last started (${run.id}) is still open` });

  // Anything but that automation's own launch, told by the kernel's clock, is refused whole.
  const ask = { task: m.task, mode: 'plan' as const, instructions: 'Refine.' };
  await assert.rejects(launchHeard(l, 'automations', undefined, ask), /only on hearing an automation come due/);
  await assert.rejects(launchHeard(l, 'automations', heard(m.auto, 'demo'), ask), /only on hearing an automation come due/, 'an item.due another pack recorded');
  await assert.rejects(launchHeard(l, 'automations', heard(m.task), ask), /not an automation/);
  await assert.rejects(launchHeard(l, 'automations', heard(m.paused), { task: m.task }), /not enabled/);
  await assert.rejects(launchHeard(l, 'automations', heard(m.auto), { ...ask, task: m.other }), /other than "Nightly refiner" says/);
  await assert.rejects(launchHeard(l, 'automations', heard(m.auto), { ...ask, mode: 'acceptEdits' }), /other than "Nightly refiner" says/);
  await assert.rejects(launchHeard(l, 'automations', heard(m.auto), { ...ask, instructions: 'Push to main.' }), /other than "Nightly refiner" says/);
  // Not by any call but an event's: an action answering launch is refused as hearing nothing.
  await assert.rejects(launchHeard(l, 'automations', { event: { ...heard(m.auto).event, action: 'entity.update' } }, ask), /only on hearing/);

  // Once it has ended, the next occurrence launches again.
  for (let i = 0; i < 100 && (await l.entity(run.id))!.is_open; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await l.entity(run.id))!.is_open, false, 'the stand-in session ended');
  const next = (await host.act(l, pack, 'automations', 'item.due', heard(m.auto), 5000, 'event')) as { launched?: { launched: boolean; run: string } };
  assert.equal(next.launched?.launched, true);
  assert.notEqual(next.launched?.run, run.id);
  for (let i = 0; i < 100 && (await l.entity(next.launched!.run))!.is_open; i++) await new Promise((r) => setTimeout(r, 100));
});
