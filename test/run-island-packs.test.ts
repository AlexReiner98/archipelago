// A run records the packs its task's island runs (task e_khy6yvs9): on an island that tries a version of its pack, the
// version's manifest; elsewhere, the map's. What comes due on such an island is recorded under the same.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doneEvents } from '../packs/log/kernel/activity.ts';
import * as duePack from '../packs/clocks/kernel/due.ts';
import type { PackVersion } from '../packs/loader/kernel/pack-versions.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';

/** An island pack with a type of work and a type that happens at a time. */
const plain = {
  id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try versions with.', requires: ['core'],
  types: [
    { id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' },
    { id: 'plain.happening', title: 'Happening', description: 'A thing at a time.', extends: 'occurrence', capabilities: { when: { start: 'at' } }, fields: { at: { type: 'datetime' as const, description: 'When it happens.' } } },
  ],
};

test('a run on a pinned island records the version; one elsewhere, the map’s', async () => {
  const l = await freshWith(new Registry(packsWith(plain)));
  await setIslands(l, human, true);
  const made = await make(l, [
    { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'plain' } },
    { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'plain' } },
    { op: 'create', ref: 'v2', type: 'pack', title: 'Plain, saying why', props: { version_of: 'plain', version: '1.1.0', manifest: {
      types: [
        { id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work', fields: { why: { type: 'string', description: 'Why it is so.' } } },
        { id: 'plain.happening', title: 'Happening', description: 'A thing at a time.', extends: 'occurrence', capabilities: { when: { start: 'at' } }, fields: { at: { type: 'datetime' as const, description: 'When it happens.' } } },
      ],
    } } },
  ]);
  await make(l, [{ op: 'update', id: made.trial, props: { pack_version: made.v2 } }]);
  const tasks = await make(l, [
    { op: 'create', ref: 'here', type: 'plain.thing', title: 'On the trial', props: { island: made.trial } },
    { op: 'create', ref: 'there', type: 'plain.thing', title: 'On the rest', props: { island: made.rest } },
  ]);

  const runPacks = async (session_id: string, task?: string) => {
    const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: '/tmp/islands', session_id, ...(task && { task }) }));
    return (await l.entity(run))!.props.packs as PackVersion[];
  };
  const trial = await runPacks('trial', tasks.here), rest = await runPacks('rest', tasks.there), none = await runPacks('none');

  const of = (packs: PackVersion[], id: string) => packs.find((p) => p.id === id)!;
  const map = l.registry.hashes.get('plain');
  assert.equal(of(rest, 'plain').manifest, map, 'a run elsewhere records the map’s plain');
  assert.deepEqual(none, rest, 'and so does a run on no task');
  assert.notEqual(of(trial, 'plain').manifest, map, 'a run on the trial island records the version’s manifest');
  assert.match(of(trial, 'plain').manifest!, /^[0-9a-f]{64}$/);
  assert.equal(of(trial, 'plain').version, '1.1.0', 'by the version’s own number');
  const without = (packs: PackVersion[]) => packs.map((p) => (p.id === 'plain' ? { id: p.id } : p));
  assert.deepEqual(without(trial), without(rest), 'the two differ only in that pack');

  // What comes due on the trial island is recorded under the version too.
  const at = Date.parse('2030-01-07T14:00:00Z');
  const due = await make(l, [
    { op: 'create', ref: 'here', type: 'plain.happening', title: 'Due on the trial', props: { island: made.trial, at: new Date(at).toISOString() } },
    { op: 'create', ref: 'there', type: 'plain.happening', title: 'Due on the rest', props: { island: made.rest, at: new Date(at).toISOString() } },
  ]);
  await duePack.duePass(kernelContext(l, 'clocks'), (at - 60_000));
  await duePack.duePass(kernelContext(l, 'clocks'), (at + 60_000));
  const packsDue = async (target: string) => ((await doneEvents(l.db, { action: 'item.due', target }, 10))[0] as unknown as { detail: { packs: PackVersion[] } }).detail.packs;
  assert.deepEqual(await packsDue(due.here), trial, 'an item due on the trial island, under the version');
  assert.deepEqual(await packsDue(due.there), rest, 'one elsewhere, under the map’s');
});
