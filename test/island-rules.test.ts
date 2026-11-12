// Rules decided by an island's pack version (packs/loader/kernel/island-rules.ts, decide in packs/rules/kernel/rules.ts; task e_tykp9yfc): each op is
// judged by the rules of the version its island runs, an op on no island or the map's pack by the map's; a change
// across islands is held or refused if any op is, and a held change names the rule and the version that held it.
// Core's own rules are never a version's. Beside the table of every change (test/approvals.ts), which has no islands.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import type { Archipelago, ChangeInput } from '../packs/write/kernel/pelago.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const thing = { id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' };
const plain = { id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try rules with.', requires: ['core'], types: [thing] };

/** A map with islands, two of the plain pack and a version of it that holds an agent's update and refuses its links. */
async function map(applying: 'apply' | 'hold' = 'apply') {
  const l = await freshWith(new Registry(packsWith(plain)));
  await setIslands(l, human, true);
  await l.db.query(`insert into setting (key, value) values ('agent_changes', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(applying)]);
  const made = await make(l, [
    { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'plain' } },
    { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'plain' } },
    { op: 'create', ref: 'v2', type: 'pack', title: 'Plain, careful', props: { version_of: 'plain', version: '1.1.0', manifest: {
      types: [thing],
      rules: [
        { id: 'careful', when: { actor: 'agent', op: 'update', type: 'plain.thing' }, then: 'hold', say: 'On trial: an update waits.' },
        { id: 'no_ties', when: { actor: 'agent', op: 'link' }, then: 'refuse', say: 'On trial: no new ties.' },
      ],
    } } },
  ]);
  const things = await make(l, [
    { op: 'create', ref: 'a', type: 'plain.thing', title: 'On trial', props: { island: made.trial } },
    { op: 'create', ref: 'b', type: 'plain.thing', title: 'At rest', props: { island: made.rest } },
    { op: 'create', ref: 'c', type: 'plain.thing', title: 'Also at rest', props: { island: made.rest } },
  ]);
  await make(l, [{ op: 'update', id: made.trial, props: { pack_version: made.v2 } }]);
  return { l, trial: made.trial, rest: made.rest, v2: made.v2, a: things.a, b: things.b, c: things.c };
}

const send = (l: Archipelago, ops: ChangeInput['ops']) => l.change(agent, { reason: 'test', authority: { of: 'agent', basis: 'a test' }, ops }) as Promise<{ status?: string; proposal?: string; held_by?: { rule: string; pack: string; version?: string } }>;

test('an op is judged by the rules of the version its island runs, and a held change names that version', async () => {
  const { l, trial, v2, a, b } = await map();
  const held = await send(l, [{ op: 'update', id: a, title: 'Renamed on trial' }]);
  assert.equal(held.status, 'proposed', 'the version holds an update on its island');
  assert.deepEqual({ rule: held.held_by?.rule, pack: held.held_by?.pack, version: held.held_by?.version }, { rule: 'careful', pack: 'plain', version: v2 });
  const kept = (await l.db.query<{ held_by: { version?: string } }>(`select held_by from proposal where id = $1`, [held.proposal])).rows[0];
  assert.equal(kept.held_by.version, v2, 'and the proposal keeps which version held it');

  assert.notEqual((await send(l, [{ op: 'update', id: b, title: 'Renamed at rest' }])).status, 'proposed', 'an island on the map’s pack is under the map’s rules');

  // Unpinned, the trial island runs the map's again.
  await make(l, [{ op: 'update', id: trial, props: { pack_version: null } }]);
  assert.notEqual((await send(l, [{ op: 'update', id: a, title: 'Renamed again' }])).status, 'proposed', 'unset, the version’s rules go with it');
});

test('a change across islands is held or refused if any op is', async () => {
  const { l, trial, a, b, c } = await map();
  const across = await send(l, [{ op: 'update', id: b, title: 'At rest, renamed' }, { op: 'update', id: a, title: 'On trial, renamed' }]);
  assert.equal(across.status, 'proposed', 'one op on the trial island holds the whole change');
  assert.equal(across.held_by?.rule, 'careful');

  // A link is judged by its ends' island (no link but a crossing one joins two).
  assert.notEqual((await send(l, [{ op: 'link', type: 'depends_on', from: b, to: c }])).status, 'proposed', 'a link between two islands on the map’s pack is the map’s');
  // A thing made on the trial island in the same change is under its rules too: the link that ties it is refused.
  await assert.rejects(send(l, [{ op: 'create', ref: 'n', type: 'plain.thing', title: 'New', props: { island: trial } }, { op: 'link', type: 'depends_on', from: 'n', to: a }]), /On trial: no new ties/);
  await assert.rejects(send(l, [{ op: 'update', id: b, title: 'Fine alone' }, { op: 'create', ref: 'm', type: 'plain.thing', title: 'Tied', props: { island: trial } }, { op: 'link', type: 'depends_on', from: a, to: 'm' }]), /On trial: no new ties/, 'one refused op refuses the change');
});

test('core’s own rules are the map’s on every island', async () => {
  const { l } = await map('hold');
  const { trial } = Object.fromEntries((await l.db.query<{ id: string; title: string }>(`select id, title from entity where type = 'island'`)).rows.map((r) => [r.title.toLowerCase(), r.id]));
  const made = await send(l, [{ op: 'create', type: 'plain.thing', title: 'Made on trial', props: { island: trial } }]);
  assert.equal(made.status, 'proposed', 'an agent’s change on a trial island still waits where the workspace holds them');
  assert.deepEqual({ pack: made.held_by?.pack, rule: made.held_by?.rule, version: made.held_by?.version }, { pack: 'core', rule: 'agent_changes', version: undefined });
});
