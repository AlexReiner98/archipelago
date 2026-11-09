// The type table: a pack removed under live items leaves them dormant, not frozen. They keep their kind, statuses,
// fields and capabilities; a person may edit and close them; an agent's edit waits; the pack's tools are gone.
// The packs here are made for the test, beside the repository's (PACKS), so it names no pack but core.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dump, restore } from '../src/backup.ts';
import { dumpVault } from '../src/vault.ts';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { movesAgain, syncTypes } from '../src/typetable.ts';
import { askView } from '../src/askview.ts';
import { human, PACKS } from './map.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

const agent: Actor = { kind: 'agent', name: 'test' };

/** A folder holding one pack (with an empty handler.js when it names handlers), read beside the repository's. */
function packDir(pack: Record<string, unknown> & { id: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-typetable-'));
  mkdirSync(join(dir, pack.id));
  writeFileSync(join(dir, pack.id, 'pack.json'), JSON.stringify({ version: '0.1.0', requires: ['core'], ...pack }));
  if (pack.handlers) writeFileSync(join(dir, pack.id, 'handler.js'), 'export default {};\n');
  return dir;
}

/** A pack of a place bound by a deadline, an occurrence of hours, a link and a view: what a removed pack leaves behind. */
const grants = packDir({
  id: 'grants',
  title: 'Grants',
  description: 'Money that could pay for work, and the hours spent on it.',
  types: [
    { id: 'grant', extends: 'place', title: 'Grant', description: 'One grant that could pay for work.', capabilities: { bound: { field: 'deadline', limit: 'today' } }, statuses: { open: ['open', 'applying'], closed: ['funded', 'not_a_fit'], phases: { open: 'standing' } }, fields: { deadline: { type: 'date' } } },
    { id: 'hours', extends: 'occurrence', title: 'Hours', description: 'Time spent on one day.', capabilities: { when: { at: 'date' } }, statuses: { open: ['logged'], closed: ['void'] }, fields: { date: { type: 'date' }, hours: { type: 'number' } } },
  ],
  links: [{ id: 'might_fund', extends: 'about', title: 'might fund', inverse: 'might be funded by', from: ['grant'], to: ['*'], description: 'This grant might pay for the work.' }],
  views: [{ id: 'grants.timesheet', description: 'The hours of a week.', shape: 'data', input: { type: 'object', properties: {} } }],
  handlers: [],
});

test('a pack removed under live items leaves them dormant: editable by a person, closable, still at risk, its tools gone', async () => {
  const dirs = [PACKS, grants];
  const db = await openDb();
  const all = new Archipelago(db, new Registry(dirs));
  assert.deepEqual(await syncTypes(all), { activated: [], dormant: [], changed: {}, moved: {} }, 'the first sync only records');
  const soon = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const made = (await all.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'grant', type: 'grant', title: 'Seed grant', status: 'open', props: { deadline: soon } },
      { op: 'create', ref: 'task', type: 'task', title: 'Write the application' },
      { op: 'link', type: 'depends_on', from: 'task', to: 'grant' },
      { op: 'link', type: 'might_fund', from: 'grant', to: 'task' },
      { op: 'create', ref: 'hours', type: 'hours', title: 'Drafting', props: { date: soon, hours: 3 } },
    ],
  })) as { created: Record<string, string> };
  const { grant, task, hours } = made.created;

  // The same map, opened with core alone.
  const l = new Archipelago(db, new Registry(dirs, ['core']));
  const synced = await syncTypes(l);
  assert.ok(synced.dormant.includes('grant') && synced.dormant.includes('hours') && synced.dormant.includes('might_fund'));
  const kept = l.registry.type('grant')!;
  assert.equal(kept.dormant, true);
  assert.equal(kept.starter, 'place');

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
  await assert.rejects(callTool(l, human, 'grants_timesheet', {}), /No tool "grants_timesheet"/);

  // The kept definitions travel in a backup, and a fresh map restoring it keeps them dormant.
  const copy = await openDb();
  await restore(copy, { ...(await dump(db, { id: 'default', name: 'Default' })), vault: await dumpVault(db) });
  const there = new Archipelago(copy, new Registry(dirs, ['core']));
  await syncTypes(there);
  assert.equal(there.registry.type('hours')?.dormant, true);

  // Added back, the pack's types are active again, and what changed is said.
  const back = new Archipelago(db, new Registry(dirs));
  const again = await syncTypes(back);
  assert.ok(again.activated.includes('grant'));
  assert.equal(back.registry.type('grant')!.dormant, undefined);
});

test('a type a pack took over takes its items with it, once, when no pack defines the old one', async () => {
  // A map made while its pack named the type spend.outlay, before a type was named by what it is.
  const outlay = { extends: 'occurrence', title: 'Outlay', description: 'Something paid for regularly.', statuses: { open: ['paying'], closed: ['ended'] }, fields: { amount: { type: 'number' } } };
  const before = packDir({ id: 'spend', title: 'Spend', description: 'What is paid.', types: [{ id: 'spend.outlay', ...outlay }] });
  const db = await openDb();
  const old = new Archipelago(db, new Registry([PACKS, before]));
  await syncTypes(old);
  const made = (await old.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'host', type: 'spend.outlay', title: 'Hosting', props: { amount: 25 } }, { op: 'create', ref: 'gone', type: 'spend.outlay', title: 'Old host', status: 'ended', props: { amount: 7 } }] })) as { created: Record<string, string> };

  // Opened with the pack as it is now: the items are its outlay, with all they had.
  const after = packDir({ id: 'spend', title: 'Spend', description: 'What is paid.', types: [{ id: 'outlay', moved_from: ['spend.outlay'], ...outlay }] });
  const now = new Archipelago(db, new Registry([PACKS, after]));
  const synced = await syncTypes(now);
  assert.deepEqual([synced.moved, synced.dormant.includes('spend.outlay')], [{ 'spend.outlay': 2 }, true]);
  const host = (await now.entity(made.created.host))!;
  assert.deepEqual([host.type, host.status, host.props.amount], ['outlay', 'paying', 25]);
  assert.equal((await now.entity(made.created.gone))!.status, 'ended');
  // The move is one system change set on the log, asserting the new type on each item.
  const { rows } = await db.query<{ n: number }>(`select (select count(*)::int from log_fact f where f.stream = 'facts' and f.pos = e.pos and f.at = e.at and f.field = 'type') as n from log_entry e where e.stream = 'facts' and e.head->>'action' = 'type.moved'`);
  assert.deepEqual(rows.map((r) => r.n), [2]);
  const found = (await callTool(now, human, 'search', { type: 'outlay' })) as { title: string }[];
  assert.deepEqual(found.map((i) => i.title).sort(), ['Hosting', 'Old host'], 'a read finds them where they are now');
  assert.deepEqual((await syncTypes(now)).moved, {}, 'once moved, nothing moves again');
});

test('a relation a pack took over takes its links with it, and the brief still reads them', async () => {
  // A map made while a pack named its types and links old.<name>, before a type was named by what it is.
  const guess = { extends: 'question', title: 'Guess', description: 'A belief that could be wrong.', statuses: { open: ['untested'], closed: ['supported', 'refuted'] } };
  const leansOn = { extends: 'bears_on', title: 'leans on', inverse: 'is leaned on by', from: ['*'], description: 'The source only makes sense if the guess holds.' };
  const before = packDir({ id: 'old', title: 'Old', description: 'Guesses.', types: [{ id: 'old.guess', ...guess }], links: [{ id: 'old.leans_on', ...leansOn, to: ['old.guess'] }] });
  const db = await openDb();
  const old = new Archipelago(db, new Registry([PACKS, before]));
  await syncTypes(old);
  const made = (await old.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'h', type: 'old.guess', title: 'People read the blog', status: 'refuted' },
      { op: 'create', ref: 't', type: 'task', title: 'Write a post' },
      { op: 'link', type: 'old.leans_on', from: 't', to: 'h' },
      { op: 'create', ref: 'lens', type: 'lens', title: 'Open questions', props: { filter: { types: ['decision', 'old.guess'], links: ['old.leans_on me'] }, walk: { over: ['old.leans_on', 'depends_on'], steps: 1 } } },
      { op: 'create', ref: 'quiet', type: 'lens', title: 'No questions', props: { filter: { types: ['task'], exclude: ['old.guess'] } } },
    ],
  })) as { created: Record<string, string> };

  // Its views were kept in the filter's old words, so it is a map from before the migrations were done once.
  await movesAgain(old);
  const after = packDir({ id: 'old', title: 'Old', description: 'Guesses.', types: [{ id: 'guess', moved_from: ['old.guess'], ...guess }], links: [{ id: 'leans_on', moved_from: ['old.leans_on'], ...leansOn, to: ['guess'] }] });
  const now = new Archipelago(db, new Registry([PACKS, after]));
  const synced = await syncTypes(now);
  assert.deepEqual([synced.moved['old.guess'], synced.moved['old.leans_on']], [1, 1]);
  assert.equal((await now.entity(made.created.h))!.type, 'guess');
  assert.deepEqual((await now.entity(made.created.lens))!.props, { filter: { find: ['leans_on me', 'type decision', 'type guess'], only: [] }, walk: { over: ['leans_on', 'depends_on'], steps: 1 } }, 'a view that named them names them still, in its order');
  assert.deepEqual((await now.entity(made.created.quiet))!.props.filter, { find: ['type task'], only: [], not: ['type guess'] });
  const { rows } = await db.query<{ type: string }>(`select type from relation where from_id = $1 and to_id = $2`, [made.created.t, made.created.h]);
  assert.deepEqual(rows.map((r) => r.type), ['leans_on']);
  const brief = (await callTool(now, human, 'view', { name: 'brief', params: { task: made.created.t } })) as { text: string };
  assert.match(brief.text, /## Leans on\n- People read the blog \(refuted\)/);
  const again = (await now.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'x', type: 'old.guess', title: 'x' }] })) as { created: Record<string, string> };
  assert.equal((await now.entity(again.created.x))!.type, 'guess', 'the old name still reads as the new one');
});

test('a type that takes another over says what its statuses are here, and the items move with them', async () => {
  // A map made while a pack declared cog, before gear took it over: a cog that works is a gear that is up.
  const before = packDir({ id: 'mech', title: 'Mech', description: 'Parts.', types: [{ id: 'cog', extends: 'place', title: 'Cog', description: 'A part of a mechanism.', statuses: { open: ['sketched', 'works', 'broken'], closed: ['retired'] } }] });
  const db = await openDb();
  const old = new Archipelago(db, new Registry([PACKS, before]));
  await syncTypes(old);
  const made = (await old.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'cog', title: 'Hook', status: 'works' }, { op: 'create', ref: 'b', type: 'cog', title: 'Gone', status: 'retired' }] })) as { created: Record<string, string> };

  const after = packDir({ id: 'mech', title: 'Mech', description: 'Parts.', types: [{ id: 'gear', moved_from: ['cog'], moved_statuses: { cog: { sketched: 'planned', works: 'up', broken: 'down' } }, extends: 'place', title: 'Gear', description: 'A part of a running mechanism.', statuses: { open: ['planned', 'up', 'down'], closed: ['retired'] } }] });
  const now = new Archipelago(db, new Registry([PACKS, after]));
  assert.deepEqual((await syncTypes(now)).moved, { cog: 2 });
  const [a, b] = [(await now.entity(made.created.a))!, (await now.entity(made.created.b))!];
  assert.deepEqual([a.type, a.status, a.is_open, b.type, b.status, b.is_open], ['gear', 'up', true, 'gear', 'retired', false]);
});

test('the migrations a workspace runs when it opens run once, and again after a merge asks for them', async () => {
  const db = await openDb();
  const l = new Archipelago(db, new Registry(join(import.meta.dirname, '..', 'packs')));
  await syncTypes(l);
  const stamp = async () => (await db.query<{ value: { done: string[] } }>(`select value from setting where key = 'moves_done'`)).rows[0]?.value;
  assert.deepEqual((await stamp())!.done.sort(), ['kinds', 'layouts', 'lives', 'owners', 'pins', 'queries', 'styles', 'terms']);
  // A view in the filter's old words, as one from before: a second open leaves it, since the migration is done here.
  const made = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'Old words', props: { filter: { types: ['task'] } } }] })) as { created: Record<string, string> };
  await syncTypes(l);
  assert.deepEqual((await l.entity(made.created.v))!.props.filter, { types: ['task'] }, 'done once, not asked again');
  await movesAgain(l);
  assert.equal(await stamp(), undefined);
  await syncTypes(l);
  assert.deepEqual((await l.entity(made.created.v))!.props.filter, { find: ['type task'], only: [] }, 'asked again, it runs');
  assert.equal((await stamp())!.done.length, 8);
});
