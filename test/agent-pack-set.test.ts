// An agent turns packs on and off (the owner, 17 Nov 2026, task e_r4gjaxde): pack_set is no longer a person's alone.
// The rules judge it as any act: core's agent_pack_set holds it unless agents' changes apply here, and agent_pack_code
// holds a pack that runs code on the server unless agents' code may run. What let it through says its stakes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PackFile } from '../packs/loader/kernel/packs.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setPack } from '../packs/loader/kernel/packstate.ts';
import { agent, freshWith, human, packsWith } from './map.ts';

/** A pack of words alone: it runs nothing. */
const TALLY = {
  id: 'tally', version: '1', title: 'Tally', description: 'Counts kept by hand.', requires: ['core'],
  types: [{ id: 'tally.count', title: 'Count', description: 'A number kept by hand.', extends: 'record' }],
} as unknown as PackFile;

async function map(settings: Record<string, string>) {
  const l = await freshWith(new Registry(packsWith(TALLY)));
  for (const [key, value] of Object.entries(settings)) await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
  return l;
}

const state = (l: Awaited<ReturnType<typeof map>>, pack: string) => l.registry.states.get(pack)?.state;

test("an agent's turn of a pack waits for the owner where agents' changes wait", async () => {
  const l = await map({ agent_changes: 'hold' });
  await assert.rejects(setPack(l, agent, { pack: 'tally', on: false }), /Turning a pack on or off is the owner’s here/);
  assert.equal(state(l, 'tally'), 'active', 'nothing turned');
  await setPack(l, human, { pack: 'tally', on: false });
  assert.equal(state(l, 'tally'), 'off', 'the owner still turns it');
});

test("where agents' changes apply, an agent turns a pack of words off and on, told its stakes", async () => {
  const l = await map({ agent_changes: 'apply' });
  const off = await setPack(l, agent, { pack: 'tally', on: false });
  assert.equal(state(l, 'tally'), 'off');
  assert.match(off.stakes?.join(' ') ?? '', /A pack turned on or off here/);
  await setPack(l, agent, { pack: 'tally', on: true });
  assert.equal(state(l, 'tally'), 'active');
});

test('a pack that runs code stays the owner’s to turn, unless agents’ code may run', async () => {
  const l = await map({ agent_changes: 'apply' });
  await assert.rejects(setPack(l, agent, { pack: 'sessions', on: false }), /A pack that runs code is the owner’s to turn on or off/);
  await l.db.query(`insert into setting (key, value) values ('agent_code', 'true'::jsonb) on conflict (key) do update set value = excluded.value`);
  const off = await setPack(l, agent, { pack: 'sessions', on: false });
  assert.equal(state(l, 'sessions'), 'off');
  assert.match(off.stakes?.join(' ') ?? '', /runs code on the server/);
});
