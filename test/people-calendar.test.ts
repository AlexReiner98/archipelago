// Core's company, works_at and event moved to two vocabulary packs, people and calendar (task e_wrdg6udh, hub
// e_9hkt86s7), keeping their ids. A map that had core gets both, once, by the types it had (takenOver in
// src/packstate.ts), and its companies, events and works_at links keep their types.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { followPacks, syncPacks } from '../packs/loader/kernel/packstate.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { make, packsWith } from './map.ts';

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

/** A map on these packs, opened as a workspace is (src/workspaces.ts): the packs synced on the log, then its types. */
async function mapOn(dir: string, db?: Archipelago['db']) {
  const reg = new Registry(dir);
  registries.push(reg);
  const l = new Archipelago(db ?? (await openDb()), reg);
  const facts = await syncPacks(l);
  await followPacks(l);
  await syncTypes(l);
  return { l, facts };
}

/** The packs as they were before the move: core declaring all three, and no people or calendar pack. */
function packsBefore() {
  const dir = packsWith();
  const read = (p: string) => JSON.parse(readFileSync(join(dir, p, 'pack.json'), 'utf8')) as { types?: object[]; links?: object[] };
  const core = read('core'), people = read('people'), calendar = read('calendar');
  // only event was core's: meeting and routine came to calendar from the hosted time pack
  core.types = [...(core.types ?? []), ...(people.types ?? []), ...((calendar.types ?? []) as { id?: string }[]).filter((t) => t.id === 'event')];
  core.links = [...(core.links ?? []), ...(people.links ?? []).map((l) => ({ ...l, kernel: true }))];
  writeFileSync(join(dir, 'core', 'pack.json'), JSON.stringify(core));
  for (const p of ['people', 'calendar']) rmSync(join(dir, p), { recursive: true, force: true });
  return dir;
}

test('a map that had core gets people and calendar, once, and its items keep their types', async () => {
  const { l: old } = await mapOn(packsBefore());
  const made = await make(old, [
    { op: 'create', ref: 'co', type: 'company', title: 'Northwind' },
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'link', type: 'works_at', from: 'ann', to: 'co' },
    { op: 'create', ref: 'launch', type: 'event', title: 'Launch', props: { at: '2030-01-07T13:00:00Z' } },
  ]);

  const { l: now, facts } = await mapOn(packsWith(), old.db);
  const added = facts.filter((f) => f[0] === '+' && /pack:(people|calendar)$/.test(f[1])).map((f) => f[1]).sort();
  assert.deepEqual(added, ['pack:calendar', 'pack:people']);
  for (const p of ['people', 'calendar']) assert.equal(now.registry.states.get(p)?.state, 'active', now.registry.states.get(p)?.why ?? '');
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:(people|calendar)$/.test(f[1])), [], 'once');

  assert.equal(now.registry.type('company')?.pack, 'people');
  assert.equal(now.registry.type('event')?.pack, 'calendar');
  assert.equal(now.registry.type('event')?.capabilities.when?.start, 'at');
  assert.equal((await now.entity(made.co))?.type, 'company');
  assert.equal((await now.entity(made.launch))?.type, 'event');
  const { rows } = await now.db.query<{ type: string }>(`select type from relation where from_id = $1`, [made.ann]);
  assert.ok(rows.some((r) => r.type === 'works_at'));

  const more = await make(now, [
    { op: 'create', ref: 'c2', type: 'company', title: 'Acme' },
    { op: 'link', type: 'works_at', from: made.ann, to: 'c2' },
  ]);
  assert.ok(more.c2);
});
