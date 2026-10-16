// The type table: a pack removed under live items leaves them dormant, not frozen. They keep their kind, statuses,
// fields and capabilities; a person may edit and close them; an agent's edit waits; the pack's tools are gone.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { syncTypes } from '../src/typetable.ts';
import { VIEWS } from '../src/views.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

test('a pack removed under live items leaves them dormant: editable by a person, closable, still at risk, its tools gone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-typetable-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  const db = await openDb();
  const all = new Archipelago(db, new Registry(dir));
  assert.deepEqual(await syncTypes(all), { activated: [], dormant: [], changed: {} }, 'the first sync only records');
  const soon = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const made = (await all.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'grant', type: 'funding.program', title: 'Seed grant', status: 'open', props: { deadline: soon } },
      { op: 'create', ref: 'task', type: 'task', title: 'Write the application' },
      { op: 'link', type: 'depends_on', from: 'task', to: 'grant' },
      { op: 'create', ref: 'hours', type: 'time.entry', title: 'Drafting', props: { date: soon, hours: 3 } },
    ],
  })) as { created: Record<string, string> };
  const { grant, task, hours } = made.created;

  // The same map, opened without the funding and time packs.
  const l = new Archipelago(db, new Registry(dir, ['core', 'sys', 'software']));
  const synced = await syncTypes(l);
  assert.ok(synced.dormant.includes('funding.program') && synced.dormant.includes('time.entry') && synced.dormant.includes('funding.could_fund'));
  const program = l.registry.type('funding.program')!;
  assert.equal(program.dormant, true);
  assert.equal(program.kind, 'place');

  // Still at risk, by its kept bound.
  const risk = (await VIEWS.at_risk.run(l, {})) as { due_soon_or_overdue: { id: string }[] };
  assert.ok(risk.due_soon_or_overdue.some((r) => r.id === grant), 'its deadline still counts');
  // A person edits it within its kept definition, and closes it, which frees what waited on it.
  assert.equal((await l.change(human, { reason: 'test', ops: [{ op: 'update', id: grant, title: 'Seed grant 2027', props: { deadline: soon } }] })).status, 'applied');
  assert.equal((await l.change(agent, { reason: 'test', ops: [{ op: 'update', id: hours, props: { hours: 4 } }] })).status, 'proposed', "an agent's edit waits");
  assert.equal((await l.change(human, { reason: 'test', ops: [{ op: 'update', id: grant, status: 'funded' }] })).status, 'applied');
  const blocked = (await VIEWS.blockers.run(l, {})) as { entity: { id: string } }[];
  assert.ok(!blocked.some((b) => b.entity.id === task), 'closing it unblocked the task');
  // The pack's tools are gone, not answering wrong.
  await assert.rejects(callTool(l, human, 'time_timesheet', {}), /No tool "time_timesheet"/);

  // The kept definitions travel in a backup, and a fresh map restoring it keeps them dormant.
  const copy = await openDb();
  await restore(copy, await dump(db, { id: 'default', name: 'Default' }));
  const there = new Archipelago(copy, new Registry(dir, ['core', 'sys', 'software']));
  await syncTypes(there);
  assert.equal(there.registry.type('time.entry')?.dormant, true);

  // Added back, the pack's types are active again, and what changed is said.
  const back = new Archipelago(db, new Registry(dir));
  const again = await syncTypes(back);
  assert.ok(again.activated.includes('funding.program'));
  assert.equal(back.registry.type('funding.program')!.dormant, undefined);
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from event where action = 'types.sync'`);
  assert.equal(rows[0].n, 2);
});
