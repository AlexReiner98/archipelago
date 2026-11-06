// The type table: a pack removed under live items leaves them dormant, not frozen. They keep their kind, statuses,
// fields and capabilities; a person may edit and close them; an agent's edit waits; the pack's tools are gone.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dump, restore } from '../src/backup.ts';
import { dumpVault } from '../src/vault.ts';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { syncTypes } from '../src/typetable.ts';
import { askView } from '../src/askview.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

test('a pack removed under live items leaves them dormant: editable by a person, closable, still at risk, its tools gone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-typetable-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  const db = await openDb();
  const all = new Archipelago(db, new Registry(dir));
  assert.deepEqual(await syncTypes(all), { activated: [], dormant: [], changed: {}, moved: {} }, 'the first sync only records');
  const soon = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const made = (await all.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'grant', type: 'program', title: 'Seed grant', status: 'open', props: { deadline: soon } },
      { op: 'create', ref: 'task', type: 'task', title: 'Write the application' },
      { op: 'link', type: 'depends_on', from: 'task', to: 'grant' },
      { op: 'create', ref: 'hours', type: 'time_entry', title: 'Drafting', props: { date: soon, hours: 3 } },
    ],
  })) as { created: Record<string, string> };
  const { grant, task, hours } = made.created;

  // The same map, opened without the funding and time packs.
  const l = new Archipelago(db, new Registry(dir, ['core', 'software']));
  const synced = await syncTypes(l);
  assert.ok(synced.dormant.includes('program') && synced.dormant.includes('time_entry') && synced.dormant.includes('could_fund'));
  const program = l.registry.type('program')!;
  assert.equal(program.dormant, true);
  assert.equal(program.starter, 'place');

  // Still at risk, by its kept bound.
  await callTool(l, { kind: 'human', name: 'test' }, 'init', { name: 'Owner' });
  const due = (await ask(l, 'attention', { person: 'me', reasons: ['due'] })) as { items: { id: string }[] };
  assert.ok(due.items.some((r) => r.id === grant), 'its deadline still counts');
  // A person edits it within its kept definition, and closes it, which frees what waited on it.
  assert.equal((await l.change(human, { reason: 'test', ops: [{ op: 'update', id: grant, title: 'Seed grant 2027', props: { deadline: soon } }] })).status, 'applied');
  assert.equal((await l.change(agent, { reason: 'test', ops: [{ op: 'update', id: hours, props: { hours: 4 } }] })).status, 'proposed', "an agent's edit waits");
  assert.equal((await l.change(human, { reason: 'test', ops: [{ op: 'update', id: grant, status: 'funded' }] })).status, 'applied');
  const blocked = (await ask(l, 'attention', { person: 'me', reasons: ['blocked'] })) as { items: { id: string }[] };
  assert.ok(!blocked.items.some((b) => b.id === task), 'closing it unblocked the task');
  // The pack's tools are gone, not answering wrong.
  await assert.rejects(callTool(l, human, 'time_timesheet', {}), /No tool "time_timesheet"/);

  // The kept definitions travel in a backup, and a fresh map restoring it keeps them dormant.
  const copy = await openDb();
  await restore(copy, { ...(await dump(db, { id: 'default', name: 'Default' })), vault: await dumpVault(db) });
  const there = new Archipelago(copy, new Registry(dir, ['core', 'software']));
  await syncTypes(there);
  assert.equal(there.registry.type('time_entry')?.dormant, true);

  // Added back, the pack's types are active again, and what changed is said.
  const back = new Archipelago(db, new Registry(dir));
  const again = await syncTypes(back);
  assert.ok(again.activated.includes('program'));
  assert.equal(back.registry.type('program')!.dormant, undefined);
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from event where action = 'types.sync'`);
  assert.equal(rows[0].n, 2);
});

test('a type a pack took over takes its items with it, once, when no pack defines the old one', async () => {
  // A map made while its pack named the type money.cost, before a type was named by what it is.
  const before = mkdtempSync(join(tmpdir(), 'pelago-moved-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), before, { recursive: true });
  const file = join(before, 'time', 'pack.json');
  const time = JSON.parse(readFileSync(file, 'utf8').replaceAll('"cost"', '"money.cost"'));
  delete time.types.find((t: { id: string }) => t.id === 'money.cost').moved_from;
  writeFileSync(file, JSON.stringify(time));
  const db = await openDb();
  const old = new Archipelago(db, new Registry(before));
  await syncTypes(old);
  const made = (await old.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'host', type: 'money.cost', title: 'Hosting', props: { amount: 25 } }, { op: 'create', ref: 'gone', type: 'money.cost', title: 'Old host', status: 'ended', props: { amount: 7 } }] })) as { created: Record<string, string> };

  // Opened with the packs as they are now: the items are the time pack's cost, with all they had.
  const dir = mkdtempSync(join(tmpdir(), 'pelago-moved-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  const now = new Archipelago(db, new Registry(dir));
  const synced = await syncTypes(now);
  assert.deepEqual([synced.moved, synced.dormant.includes('money.cost')], [{ 'money.cost': 2 }, true]);
  const host = (await now.entity(made.created.host))!;
  assert.deepEqual([host.type, host.status, host.props.amount], ['cost', 'paying', 25]);
  assert.equal((await now.entity(made.created.gone))!.status, 'ended');
  const { rows } = await db.query<{ detail: { from: string; to: string; items: string[] } }>(`select detail from event where action = 'type.moved'`);
  assert.deepEqual([rows.length, rows[0].detail.from, rows[0].detail.to, rows[0].detail.items.length], [1, 'money.cost', 'cost', 2]);
  const costs = (await callTool(now, human, 'view', { name: 'costs', params: { days: 30 } })) as { recurring: { items: { title: string }[] } };
  assert.deepEqual(costs.recurring.items.map((i) => i.title), ['Hosting'], 'the costs view reads them where they are now');
  assert.deepEqual((await syncTypes(now)).moved, {}, 'once moved, nothing moves again');
});
test('a relation a pack took over takes its links with it, and the work at risk is still found', async () => {
  // A map made while the inquiry pack (science now) named its types and links inquiry.<name>, before a type was named by what it is.
  const before = mkdtempSync(join(tmpdir(), 'pelago-moved-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), before, { recursive: true });
  const file = join(before, 'science', 'pack.json');
  let text = readFileSync(file, 'utf8');
  const shipped = JSON.parse(text) as { types: { id: string }[]; links: { id: string }[] };
  for (const { id } of [...shipped.types, ...shipped.links]) text = text.replaceAll(`"${id}"`, `"inquiry.${id}"`);
  const inquiry = JSON.parse(text);
  for (const t of [...inquiry.types, ...inquiry.links]) delete t.moved_from;
  writeFileSync(file, JSON.stringify(inquiry));
  const db = await openDb();
  const old = new Archipelago(db, new Registry(before));
  await syncTypes(old);
  const made = (await old.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'h', type: 'inquiry.hypothesis', title: 'People read the blog', status: 'refuted' },
      { op: 'create', ref: 't', type: 'task', title: 'Write a post' },
      { op: 'link', type: 'inquiry.assumes', from: 't', to: 'h' },
      { op: 'create', ref: 'lens', type: 'lens', title: 'Open questions', props: { filter: { types: ['decision', 'inquiry.hypothesis'], links: ['inquiry.assumes me'] }, walk: { over: ['inquiry.assumes', 'depends_on'], steps: 1 } } },
      { op: 'create', ref: 'quiet', type: 'lens', title: 'No questions', props: { filter: { types: ['task'], exclude: ['inquiry.hypothesis'] } } },
    ],
  })) as { created: Record<string, string> };

  const dir = mkdtempSync(join(tmpdir(), 'pelago-moved-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  const now = new Archipelago(db, new Registry(dir));
  const synced = await syncTypes(now);
  assert.deepEqual([synced.moved['inquiry.hypothesis'], synced.moved['inquiry.assumes']], [1, 1]);
  assert.equal((await now.entity(made.created.h))!.type, 'hypothesis');
  assert.deepEqual((await now.entity(made.created.lens))!.props, { filter: { find: ['assumes me', 'type decision', 'type hypothesis'], only: [] }, walk: { over: ['assumes', 'depends_on'], steps: 1 } }, 'a view that named them names them still, in its order');
  assert.deepEqual((await now.entity(made.created.quiet))!.props.filter, { find: ['type task'], only: [], not: ['type hypothesis'] });
  const { rows } = await db.query<{ type: string }>(`select type from relation where from_id = $1 and to_id = $2`, [made.created.t, made.created.h]);
  assert.deepEqual(rows.map((r) => r.type), ['assumes']);
  const risk = (await callTool(now, human, 'science_undermined', {})) as { id: string }[];
  assert.deepEqual(risk.map((r) => r.id), [made.created.t], 'the pack finds the work through the moved link');
  const brief = (await callTool(now, human, 'view', { name: 'brief', params: { task: made.created.t } })) as { text: string };
  assert.match(brief.text, /## Assumes\n- People read the blog \(refuted\)/);
  const again = (await now.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'x', type: 'inquiry.hypothesis', title: 'x' }] })) as { created: Record<string, string> };
  assert.equal((await now.entity(again.created.x))!.type, 'hypothesis', 'the old name still reads as the new one');
});

test('a type that takes another over says what its statuses are here, and the items move with them', async () => {
  // A map made while a pack declared part, before component took it over: a part that works is a component that is up.
  const before = mkdtempSync(join(tmpdir(), 'pelago-moved-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), before, { recursive: true });
  const file = join(before, 'code', 'pack.json');
  const code = JSON.parse(readFileSync(file, 'utf8'));
  code.types.find((t: { id: string }) => t.id === 'component').moved_from = [];
  code.types.push({ id: 'part', extends: 'place', title: 'Part', description: 'A part of a mechanism.', statuses: { open: ['sketched', 'works', 'broken'], closed: ['retired'] } });
  writeFileSync(file, JSON.stringify(code));
  const db = await openDb();
  const old = new Archipelago(db, new Registry(before));
  await syncTypes(old);
  const made = (await old.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'part', title: 'Hook', status: 'works' }, { op: 'create', ref: 'b', type: 'part', title: 'Gone', status: 'retired' }] })) as { created: Record<string, string> };

  const now = new Archipelago(db, new Registry(join(import.meta.dirname, '..', 'packs')));
  assert.deepEqual((await syncTypes(now)).moved, { part: 2 });
  const [a, b] = [(await now.entity(made.created.a))!, (await now.entity(made.created.b))!];
  assert.deepEqual([a.type, a.status, a.is_open, b.type, b.status, b.is_open], ['component', 'up', true, 'component', 'retired', false]);
});
