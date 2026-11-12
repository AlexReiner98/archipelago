// A session's start on a trial island (task e_6pcqrf9v): the hook knows no task, so it reads the island from where the
// session works, its repository's island, and tells it the session_start instructions of the version that island
// runs (src/island-pin.ts); a session anywhere else is told the map's. Once it says a task, the task's island leads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import * as sessionHookPack from '../packs/sessions/kernel/session-hook.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';
import { ownContext } from '../packs/loader/kernel/kernel-context.ts';

const OLD = 'Keep things true.', NEW = 'Keep things true, and say why.';

const checkout = { id: 'plain.checkout', title: 'Checkout', description: 'A checkout.', extends: 'place', fields: { remote: { type: 'url' }, path: { type: 'string' } }, capabilities: { where: { address: 'remote', folder: 'path' } } };
const thing = { id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' };
const plain = {
  id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try versions with.', requires: ['core'],
  types: [thing, checkout],
  styles: [{ id: 'plain.tending', type: 'instruction', title: 'Tending', body: OLD, props: { for: ['session_start'] } }],
};

test('a session started in a repository on a pinned island is told the version; one elsewhere, the map’s', async () => {
  const l = await freshWith(new Registry(packsWith(plain)));
  await setIslands(l, human, true);
  const { trial, rest } = await make(l, [
    { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'plain' } },
    { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'plain' } },
  ]);
  const { v2 } = await make(l, [
    { op: 'create', ref: 'v2', type: 'pack', title: 'Plain, saying why', props: { version_of: 'plain', version: '1.1.0', manifest: {
      types: [thing, checkout],
      styles: [{ id: 'plain.tending', type: 'instruction', title: 'Tending', body: NEW, props: { for: ['session_start'] } }],
    } } },
  ]);
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: trial, props: { pack_version: v2 } }] });
  const { here, there, onTrial } = await make(l, [
    { op: 'create', ref: 'here', type: 'plain.checkout', title: 'Trial repo', props: { island: trial, remote: 'https://github.com/o/trial', path: '/code/trial' } },
    { op: 'create', ref: 'there', type: 'plain.checkout', title: 'Rest repo', props: { island: rest, remote: 'https://github.com/o/rest', path: '/code/rest' } },
    { op: 'create', ref: 'onTrial', type: 'plain.thing', title: 'Work on the trial', props: { island: trial } },
  ]);
  const says = (text: string) => ({ NEW: text.includes(NEW), OLD: text.includes(OLD) });

  // By its remote, and by its folder alone.
  assert.deepEqual(says(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 's-trial', cwd: '/elsewhere', remote: 'https://github.com/o/trial' }))), { NEW: true, OLD: false }, 'a repository on the trial island hears the version');
  assert.deepEqual(says(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 's-trial-dir', cwd: '/code/trial/src' }))), { NEW: true, OLD: false }, 'found by its folder too');
  assert.deepEqual(says(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 's-rest', cwd: '/code/rest' }))), { NEW: false, OLD: true }, 'a repository on an island with no pin hears the map’s');
  assert.deepEqual(says(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 's-none', cwd: '/code/unknown' }))), { NEW: false, OLD: true }, 'a folder with no repository hears the map’s');
  assert.equal(await sessionHookPack.sessionIsland(ownContext(l, 'sessions'), ((await sessionsPack.resolveRun(ownContext(l, 'sessions'), 's-rest', false))?.id)), rest);

  // A session in the rest's repository that takes on work on the trial island runs under the task's island, and a resume says so.
  await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: '/code/rest', task: onTrial }));
  assert.equal(await sessionHookPack.sessionIsland(ownContext(l, 'sessions'), ((await sessionsPack.resolveRun(ownContext(l, 'sessions'), 's-rest', false))?.id)), trial, 'its task leads its repository');
  assert.deepEqual(says(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 's-rest', cwd: '/code/rest', source: 'resume' }))), { NEW: true, OLD: false }, 'resumed on the task, it hears the version');
  void here, there;
});
