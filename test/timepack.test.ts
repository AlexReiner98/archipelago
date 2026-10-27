// The time pack, end to end: its actions and views run by its handler in the pack host's sandbox, on a map in memory.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

/** A fresh in-memory map with its own copy of the packs. */
async function fresh() {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-packs-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  return new Archipelago(await openDb(), new Registry(packs));
}

async function make(l: Archipelago, ops: Op[]) {
  const result = await l.change(human, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

/** An action's tool answers what it found (answer) beside what its change made; read as one. */
const acted = async (...a: Parameters<typeof callTool>): Promise<unknown> => ((r) => ({ ...r, ...r.answer }))((await callTool(...a)) as { answer: Record<string, unknown> });

test('time is logged against work, summed by day and client, and billed on a numbered invoice that can be voided', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'ap', type: 'company', title: 'Apex Design Tools Inc.', props: { address: '1 King St, Toronto', hst_number: '123456789RT0001' } },
    { op: 'create', ref: 'aa', type: 'company', title: 'Northwind', props: { rate: 80, hst: true, terms_days: 30, billed_by: 'PLACEHOLDER' } },
    { op: 'create', ref: 'p', type: 'project', title: 'Northwind research project' },
    { op: 'create', ref: 't', type: 'task', title: 'Funding research' },
    { op: 'create', ref: 'mine', type: 'project', title: 'Archipelago' },
    { op: 'link', type: 'involves', from: 'p', to: 'aa' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await make(l, [{ op: 'update', id: made.aa, props: { billed_by: made.ap } }]);
  const log = (input: Record<string, unknown>) => acted(l, human, 'time_log', input) as Promise<{ client: string | null; note?: string }>;
  assert.equal((await log({ work: made.t, hours: 3, what: 'Funding research', note: 'BDC LIFT and IRAP', date: '2026-10-14' })).client, 'Northwind');
  await log({ work: made.p, hours: 1.5, what: 'Call with Sam', date: '2026-10-15' });
  await log({ work: made.p, hours: 2, what: 'Internal notes', date: '2026-10-15', billable: false });
  assert.match((await log({ work: made.mine, hours: 1, what: 'Own work', date: '2026-10-15' })).note ?? '', /No client/);
  await assert.rejects(log({ work: made.t, hours: 30, what: 'Too long' }), /at most 24/);

  const sheet = (await callTool(l, human, 'time_timesheet', { from: '2026-10-13', to: '2026-10-19' })) as { total: number; days: { date: string; hours: number }[]; by_client: { client: string; hours: number; billable: number }[]; not_invoiced: { client: string; hours: number }[] };
  assert.equal(sheet.total, 7.5);
  assert.deepEqual(sheet.days.map((d) => [d.date, d.hours]), [['2026-10-14', 3], ['2026-10-15', 4.5]]);
  assert.deepEqual(sheet.by_client.find((c) => c.client === 'Northwind'), { client: 'Northwind', hours: 6.5, billable: 4.5 });
  assert.deepEqual(sheet.not_invoiced.find((c) => c.client === 'Northwind')?.hours, 4.5);

  const inv = (await acted(l, human, 'time_invoice_draft', { client: made.aa, to: '2026-10-31' })) as { number: string; created: { inv: string }; subtotal: number; tax: number; total: number; entries: number };
  assert.deepEqual([inv.number.replace(/\d{4}/, 'YYYY'), inv.entries, inv.subtotal, inv.tax, inv.total], ['INV-YYYY-001', 2, 360, 46.8, 406.8]);
  const doc = (await callTool(l, human, 'document', { id: inv.created.inv })) as { parts: { text?: string }[] };
  const text = doc.parts.map((p) => p.text).join('\n');
  assert.match(text, /\| \*\*Apex Design Tools Inc\.\*\* \| \*\*Northwind\*\* \|\n\| 1 King St, Toronto \|  \|\n\| HST 123456789RT0001 \|  \|/);
  assert.match(text, /\| Oct 14 \| Funding research \| 3 \| \$80\.00 \| \$240\.00 \|/);
  const read = (await callTool(l, human, 'document', { id: inv.created.inv })) as { type: string; fields: Record<string, unknown> };
  assert.equal(read.type, 'invoice');
  assert.deepEqual([read.fields.number, read.fields.total], [inv.number, 406.8], 'an invoice says its number and total to the page that lays it out');
  assert.match(text, /\| \*\*Total due \(CAD\)\*\* \| \*\*\$406\.80\*\* \|/);
  await assert.rejects(callTool(l, human, 'time_invoice_draft', { client: made.aa, to: '2026-10-31' }), /No billable time/);
  // A void invoice frees its time to be billed again, on the next number.
  await callTool(l, human, 'time_invoice_void', { id: inv.created.inv });
  const again = (await acted(l, human, 'time_invoice_draft', { client: made.aa, to: '2026-10-31' })) as { number: string; entries: number };
  assert.deepEqual([again.number.endsWith('-002'), again.entries], [true, 2]);
  // An invoice is a document: it can be given as a link, which shows the bill.
  const { sharedDocument } = await import('../src/documents.ts');
  const link = (await callTool(l, human, 'share_create', { id: inv.created.inv })) as { path: string };
  assert.match(JSON.stringify(await sharedDocument(l, link.path.split('/').at(-1)!)), /Total due/);
  // A client with no biller says so.
  const other = await make(l, [{ op: 'create', ref: 'c', type: 'company', title: 'Nobody bills me' }]);
  await assert.rejects(callTool(l, human, 'time_invoice_draft', { client: other.c }), /does not say who bills it/);
});

test('a block of time has hours from its start and end, and a week holds the owner’s blocks beside the agents’ lanes', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'ap', type: 'project', title: 'Apex' },
    { op: 'create', ref: 't', type: 'task', title: 'Sun study loop' },
    { op: 'create', ref: 'ar', type: 'project', title: 'Archipelago' },
    { op: 'create', ref: 'repo', type: 'repo', title: 'Archipelago repo', props: { path: 'c:/code/arch' } },
    { op: 'link', type: 'part_of', from: 't', to: 'ap' },
    { op: 'link', type: 'lives_in', from: 'ar', to: 'repo' },
  ]);
  const log = (input: Record<string, unknown>) => acted(l, human, 'time_log', input) as Promise<{ hours: number; date: string; start?: string }>;
  const block = await log({ work: made.t, what: 'Reviewed the loop', start: '2026-10-14T13:00:00-04:00', end: '2026-10-14T15:30:00-04:00' });
  assert.deepEqual([block.hours, block.date, block.start], [2.5, '2026-10-14', '2026-10-14T17:00:00.000Z'], 'the hours are the time between start and end, on the day it began');
  await log({ work: made.ar, what: 'Notes', hours: 1, date: '2026-10-15' });
  await log({ work: made.ar, what: 'Late night', start: '2026-10-16T23:00:00-04:00', end: '2026-10-17T01:00:00-04:00' });
  await assert.rejects(log({ work: made.t, what: 'Backwards', start: '2026-10-14T15:00:00-04:00', end: '2026-10-14T13:00:00-04:00' }), /end must come after start/);
  const sheet = (await callTool(l, human, 'time_timesheet', { from: '2026-10-12', to: '2026-10-18' })) as { total: number };
  assert.equal(sheet.total, 5.5, 'an entry with only date and hours still counts beside the blocks');

  // Two agents at work at once that afternoon: one on the loop, one in the repository with no task named.
  const one = await sessionStart(l, agent, { task: made.t, session_id: 'w1' });
  const two = await sessionStart(l, agent, { cwd: 'c:/code/arch', session_id: 'w2' });
  const when = async (run: string, from: string, to: string) => {
    await l.db.query(`update entity set created_at = $2::timestamptz, updated_at = $3::text::timestamptz, props = props || jsonb_build_object('last_seen', $3::text, 'active', jsonb_build_array(jsonb_build_array($2::text, $3::text))) where id = $1`, [run, from, to]);
    await l.db.query(`update relation set valid_from = $2 where from_id = $1 and type = 'works_on'`, [run, from]);
  };
  await when(one.run, '2026-10-14T17:00:00Z', '2026-10-14T19:00:00Z');
  await when(two.run, '2026-10-14T17:30:00Z', '2026-10-14T18:00:00Z');

  type B = { id: string; what: string; from_hour: number | null; to_hour: number | null; hours: number; project: string | null; session?: string };
  const wk = (await callTool(l, human, 'time_week', { from: '2026-10-15' })) as { from: string; to: string; projects: { id: string; title: string }[]; days: { date: string; hours: number; owner: B[]; agents: B[][] }[] };
  assert.deepEqual([wk.from, wk.to, wk.days.length], ['2026-10-12', '2026-10-18', 7], 'any day names its week, Monday to Sunday');
  assert.deepEqual(wk.projects.map((p) => p.title).sort(), ['Apex', 'Archipelago']);
  const wed = wk.days[2];
  assert.deepEqual(wed.owner.map((b) => [b.what, b.from_hour, b.to_hour, b.project]), [['Reviewed the loop', 13, 15.5, made.ap]]);
  assert.equal(wed.agents.length, 2, 'one lane for each agent at work at once');
  assert.deepEqual(wed.agents.flat().map((b) => [b.id, b.what, b.from_hour, b.to_hour, b.hours, b.project]).sort(), [
    [one.run, 'Sun study loop', 13, 15, 2, made.ap],
    [two.run, (await l.entity(two.run))!.title, 13.5, 14, 0.5, made.ar],
  ].sort(), 'a session counts to its task’s project, or to the project that lives in its repository');
  const thu = wk.days[3];
  assert.deepEqual(thu.owner.map((b) => [b.what, b.from_hour, b.hours]), [['Notes', null, 1]], 'time logged as hours alone has no place in the day');
  assert.deepEqual([wk.days[4].owner[0].from_hour, wk.days[4].owner[0].to_hour, wk.days[5].owner[0].from_hour, wk.days[5].owner[0].to_hour], [23, 24, 0, 1], 'a block past midnight is drawn on both days');
  assert.equal(wk.days[4].hours, 1);

  // A session that went quiet and was closed for it hours later stopped when it was last heard from.
  const quiet = await sessionStart(l, agent, { task: made.t, session_id: 'w3' });
  await when(quiet.run, '2026-10-15T14:00:00Z', '2026-10-15T15:00:00Z');
  await l.db.query(`update entity set status = 'finished', is_open = false, updated_at = '2026-10-16T03:00:00Z' where id = $1`, [quiet.run]);
  const later = (await callTool(l, human, 'time_week', { from: '2026-10-12' })) as typeof wk;
  assert.deepEqual(later.days[3].agents.flat().map((b) => [b.from_hour, b.to_hour]), [[10, 11]]);

  // A run told of only once it was over has no length: it is counted, not given a lane.
  const told = await callTool(l, agent, 'run_report', { repo: made.repo, title: 'Read the push to main (abc1234)' }) as { run: string };
  await l.db.query(`update entity set created_at = '2026-10-16T13:00:00Z', updated_at = '2026-10-16T13:00:00Z' where id = $1`, [told.run]);
  // Work in no project and no repository counts toward nothing, not toward itself.
  const loose = await make(l, [{ op: 'create', ref: 'q', type: 'decision', title: 'Which house' }]);
  await callTool(l, human, 'time_log', { work: loose.q, what: 'Looked at houses', start: '2026-10-17T10:00:00-04:00', end: '2026-10-17T11:00:00-04:00' });
  const last = (await callTool(l, human, 'time_week', { from: '2026-10-12' })) as typeof wk & { days: { reported: number }[] };
  assert.deepEqual([last.days[4].agents.length, last.days[4].reported], [0, 1]);
  assert.equal(last.days[5].owner.find((b) => b.what === 'Looked at houses')?.project, null);
  assert.ok(!last.projects.some((p) => p.title === 'Which house'));

  // Only the stretches a session was at work count: one left open overnight is drawn where its turns were.
  const night = await sessionStart(l, agent, { task: made.t, session_id: 'w4' });
  await when(night.run, '2026-10-13T00:00:00Z', '2026-10-13T13:00:00Z');
  await l.db.query(`update entity set props = props || '{"active": [["2026-10-13T00:00:00Z", "2026-10-13T01:00:00Z"], ["2026-10-13T12:30:00Z", "2026-10-13T13:00:00Z"]]}'::jsonb where id = $1`, [night.run]);
  // One recorded before stretches were kept is drawn from its signs of work, gathered where they fall close together.
  const old = await sessionStart(l, agent, { task: made.t, session_id: 'w5' });
  await when(old.run, '2026-10-13T14:00:00Z', '2026-10-13T22:00:00Z');
  await l.db.query(`update entity set props = (props - 'active') || '{"story": [{"n": 1, "at": "2026-10-13T14:30:00Z", "said": "x", "about": [], "links": []}]}'::jsonb where id = $1`, [old.run]);
  const runs = (await callTool(l, human, 'time_week', { from: '2026-10-12' })) as typeof wk;
  const spans = (run: string) => runs.days.flatMap((d) => d.agents.flat().filter((b) => b.id === run).map((b) => [d.date, b.from_hour, b.to_hour]));
  assert.deepEqual(spans(night.run), [['2026-10-12', 20, 21], ['2026-10-13', 8.5, 9]]);
  assert.deepEqual(spans(old.run), [['2026-10-13', 10, 10.5], ['2026-10-13', 17.92, 18]]);
  // One already under way when stretches began to be kept is guessed at up to its first stretch, then drawn by them.
  await l.db.query(`update entity set props = props || '{"active": [["2026-10-13T21:00:00Z", "2026-10-13T22:00:00Z"]]}'::jsonb where id = $1`, [old.run]);
  const both = (await callTool(l, human, 'time_week', { from: '2026-10-12' })) as typeof wk;
  assert.deepEqual(both.days.flatMap((d) => d.agents.flat().filter((b) => b.id === old.run).map((b) => [b.from_hour, b.to_hour])), [[10, 10.5], [17, 18]]);
});

test('planned time counts toward nothing and is never invoiced until the owner confirms it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'company', title: 'Alex Reiner Consulting' },
    { op: 'create', ref: 'c', type: 'company', title: 'PARTISANS', props: { rate: 50, billed_by: 'PLACEHOLDER' } },
    { op: 'create', ref: 'p', type: 'project', title: 'PARTISANS work' },
    { op: 'link', type: 'involves', from: 'p', to: 'c' },
  ]);
  await make(l, [{ op: 'update', id: made.c, props: { billed_by: made.me } }]);
  type Made = { created: { e: string } };
  const past = (await callTool(l, human, 'time_log', { work: made.p, what: 'Site visit', planned: true, start: '2026-10-13T09:00:00-04:00', end: '2026-10-13T11:00:00-04:00' })) as Made;
  const ahead = (await callTool(l, human, 'time_log', { work: made.p, what: 'Drawings', planned: true, start: '2030-01-07T09:00:00-05:00', end: '2030-01-07T10:00:00-05:00' })) as Made;
  assert.equal((await l.entity(past.created.e))!.status, 'planned');
  const sheet = (await callTool(l, human, 'time_timesheet', { from: '2026-10-12', to: '2026-10-18' })) as { total: number; not_invoiced: unknown[] };
  assert.deepEqual([sheet.total, sheet.not_invoiced.length], [0, 0], 'planned time is not counted as worked, nor waiting to be billed');
  await assert.rejects(callTool(l, human, 'time_invoice_draft', { client: made.c, to: '2026-10-31' }), /No billable time/);

  type W = { days: { hours: number; planned: number; owner: { id: string; status: string; from_hour: number | null }[] }[]; to_confirm: { id: string; what: string; date: string }[] };
  const wk = (await callTool(l, human, 'time_week', { from: '2026-10-12' })) as W;
  assert.deepEqual([wk.days[1].hours, wk.days[1].planned, wk.days[1].owner[0].status, wk.days[1].owner[0].from_hour], [0, 2, 'planned', 9], 'drawn on its day, counted apart');
  assert.deepEqual(wk.to_confirm.map((b) => [b.id, b.date]), [[past.created.e, '2026-10-13']], 'what has passed waits to be confirmed; what is ahead does not');
  assert.ok(!wk.to_confirm.some((b) => b.id === ahead.created.e));

  // Only a person confirms it: an agent may move planned time, never say it happened, whatever it is allowed.
  await l.change(agent, { ops: [{ op: 'update', id: ahead.created.e, props: { start: '2030-01-07T10:00:00-05:00', end: '2030-01-07T11:00:00-05:00' } }], reason: 'test: moved' });
  await assert.rejects(l.change(agent, { ops: [{ op: 'update', id: past.created.e, status: 'logged' }], reason: 'test' }), /only a person confirms/);
  await assert.rejects(l.change(agent, { ops: [{ op: 'update', id: past.created.e, status: 'logged' }], reason: 'test', hold: true }), /only a person confirms/);
  assert.equal((await l.entity(past.created.e))!.status, 'planned');

  // Confirmed as it happened, as the page sends it: for other work, and for an hour and a half, not two.
  const other = await make(l, [{ op: 'create', ref: 'o', type: 'project', title: 'Other work' }, { op: 'link', type: 'involves', from: 'o', to: made.c }]);
  const row = (wk.to_confirm as unknown as { id: string; link: string }[])[0];
  await make(l, [
    { op: 'update', id: row.id, status: 'logged', title: 'Site visit, cut short', props: { date: '2026-10-13', start: '2026-10-13T13:00:00.000Z', end: '2026-10-13T14:30:00.000Z', hours: 1.5 } },
    { op: 'unlink', relation: row.link },
    { op: 'link', type: 'part_of', from: row.id, to: other.o },
  ]);
  const after = (await callTool(l, human, 'time_week', { from: '2026-10-12' })) as W & { days: { owner: { what: string; work: string }[] }[] };
  assert.deepEqual([after.days[1].hours, after.days[1].planned, after.to_confirm.length], [1.5, 0, 0]);
  assert.deepEqual([after.days[1].owner[0].what, after.days[1].owner[0].work], ['Site visit, cut short', 'Other work']);
  // Confirmed, it is time worked, and it is billed.
  const inv = (await acted(l, human, 'time_invoice_draft', { client: made.c, to: '2026-10-31' })) as { hours: number; subtotal: number };
  assert.deepEqual([inv.hours, inv.subtotal], [1.5, 75]);
});

test('a routine is drawn on the days it falls on; one for work waits to be confirmed day by day, by a person', async () => {
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date()), { occurs: falls } = await import('../src/capabilities.ts'), occurs = (p: Record<string, unknown>, day: string) => falls({ from: 'from_time', to: 'to_time', days: 'days', starts: 'starts', skip: 'skip', moved: 'moved' }, p, day);
  // Wednesday 14 October 2026 is a 3; Saturday the 17th a 6.
  const dinner = { from_time: '17:00', to_time: '19:00' };
  assert.deepEqual(occurs(dinner, '2026-10-14'), [17, 19], 'every day when no days are given');
  assert.equal(occurs({ ...dinner, days: [1, 2, 3, 4, 5] }, '2026-10-17'), undefined, 'not on a day it does not fall on');
  assert.equal(occurs({ ...dinner, starts: '2026-10-15' }, '2026-10-14'), undefined, 'not before it starts');
  assert.equal(occurs({ ...dinner, skip: ['2026-10-14'] }, '2026-10-14'), undefined, 'not on a day skipped');
  assert.deepEqual(occurs({ ...dinner, moved: { '2026-10-14': ['18:00', '20:30'] } }, '2026-10-14'), [18, 20.5], 'at other hours on a day moved');
  assert.equal(occurs({ from_time: 'dinner', to_time: '19:00' }, '2026-10-14'), undefined, 'nothing from hours it cannot read');

  const l = await fresh();
  const now = today();
  const back = (n: number) => new Date(Date.parse(`${now}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Apex' },
    { op: 'create', ref: 'dinner', type: 'routine', title: 'Dinner', status: 'active', props: { ...dinner, starts: back(10) } },
    { op: 'create', ref: 'deep', type: 'routine', title: 'Deep work', status: 'active', props: { from_time: '09:00', to_time: '11:00', starts: back(2) } },
    { op: 'link', type: 'part_of', from: 'deep', to: 'p' },
  ]);
  type B = { id: string; what: string; date: string; from_hour: number; to_hour: number; routine?: boolean; work_id: string | null; start: string; end: string; hours: number };
  type W = { days: { date: string; hours: number; planned: number; owner: B[] }[]; to_confirm: B[] };
  const wk = (await callTool(l, human, 'time_week', { from: now })) as W;
  const on = wk.days.find((d) => d.date === now)!;
  assert.deepEqual(on.owner.filter((b) => b.id === made.dinner).map((b) => [b.from_hour, b.to_hour, b.routine]), [[17, 19, true]]);
  assert.deepEqual([on.hours, on.planned], [0, 2], 'dinner is not work; deep work is time planned for its project');
  // The days of deep work that have passed wait to be confirmed: the two before today, and today's once it is over.
  const due = wk.to_confirm.filter((b) => b.id === made.deep).map((b) => b.date);
  assert.ok(due.includes(back(2)) && due.includes(back(1)) && !due.includes(back(3)));
  assert.ok(!wk.to_confirm.some((b) => b.id === made.dinner), 'a routine for nothing is never confirmed');

  // Only a person confirms a day: an agent may not mark one done.
  await assert.rejects(l.change(agent, { ops: [{ op: 'update', id: made.deep, props: { done: [back(1)] } }], reason: 'test' }), /only a person confirms a day/);
  // Confirmed as the page sends it: an entry for the day, and the day marked done on the routine.
  const day = wk.to_confirm.find((b) => b.id === made.deep && b.date === back(1))!;
  await make(l, [
    { op: 'create', ref: 'e', type: 'time_entry', title: day.what, status: 'logged', props: { date: day.date, hours: 1.5, start: day.start, end: new Date(Date.parse(day.start) + 5_400_000).toISOString() } },
    { op: 'link', type: 'part_of', from: 'e', to: made.p },
    { op: 'update', id: made.deep, props: { done: [day.date] } },
  ]);
  const after = (await callTool(l, human, 'time_week', { from: back(1) })) as W;
  const that = after.days.find((d) => d.date === back(1))!;
  assert.deepEqual([that.hours, that.owner.filter((b) => b.routine && b.id === made.deep).length], [1.5, 0], 'the day counts as worked and is no longer drawn from the routine');
  assert.ok(!after.to_confirm.some((b) => b.id === made.deep && b.date === back(1)));
});

test('an invoice says how to pay, takes payments in parts, and what is owed and overdue is in the timesheet', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Alex', props: { address: '92 King St E', hst_number: '748361565RT0001', payment: 'Interac e-Transfer to pay@example.com (autodeposit)\n- EFT: institution 004, transit 12345, account 1234567' } },
    { op: 'create', ref: 'aa', type: 'company', title: 'Northwind', props: { rate: 50, hst: true } },
    { op: 'create', ref: 'p', type: 'project', title: 'Research' },
    { op: 'link', type: 'involves', from: 'p', to: 'aa' },
  ]);
  await make(l, [{ op: 'update', id: made.aa, props: { billed_by: made.me } }]);
  await callTool(l, human, 'time_log', { work: made.p, hours: 10, what: 'Funding research', date: '2026-10-14' });
  const inv = (await acted(l, human, 'time_invoice_draft', { client: made.aa, to: '2026-10-31' })) as { created: { inv: string }; total: number; number: string };
  assert.equal(inv.total, 565);
  const text = ((await callTool(l, human, 'document', { id: inv.created.inv })) as { parts: { text?: string }[] }).parts.map((p) => p.text).join('\n');
  assert.match(text, /How to pay\n- Interac e-Transfer to pay@example\.com \(autodeposit\)\n- EFT: institution 004, transit 12345, account 1234567\n- Please quote INV-\d{4}-001 with your payment\./);

  const sheet = async () => ((await callTool(l, human, 'time_timesheet', {})) as { invoices: { outstanding: { owing: number; overdue_days?: number }[]; overdue: unknown[]; drafts: unknown[]; owed_total: number } }).invoices;
  assert.deepEqual([(await sheet()).drafts.length, (await sheet()).outstanding.length], [1, 0], 'a draft is not yet owed');
  const part = (await acted(l, human, 'time_invoice_paid', { id: inv.created.inv, amount: 200, method: 'e-Transfer', date: '2026-10-20' })) as { status: string; owing: number };
  assert.deepEqual([part.status, part.owing], ['sent', 365], 'a payment on a draft says it was sent');
  // Past its due day, what is owed is overdue.
  await make(l, [{ op: 'update', id: inv.created.inv, props: { due: '2026-01-01' } }]);
  const late = await sheet();
  assert.deepEqual([late.owed_total, late.overdue.length, (late.outstanding[0].overdue_days ?? 0) > 0], [365, 1, true]);
  const rest = (await acted(l, human, 'time_invoice_paid', { id: inv.created.inv, method: 'EFT' })) as { status: string; owing: number };
  assert.deepEqual([rest.status, rest.owing], ['paid', 0]);
  assert.deepEqual([(await sheet()).outstanding.length, (await sheet()).owed_total], [0, 0]);
  await assert.rejects(callTool(l, human, 'time_invoice_paid', { id: inv.created.inv }), /already paid in full/);
  const kept = ((await callTool(l, human, 'get', { id: inv.created.inv })) as { entity: { props: { payments: { amount: number; method: string }[] } } }).entity.props.payments;
  assert.deepEqual(kept.map((p) => [p.amount, p.method]), [[200, 'e-Transfer'], [365, 'EFT']]);
});
