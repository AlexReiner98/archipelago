// The time pack's handler, tested without a database: a map of fixtures stands where the kernel answers its reads,
// and what comes out is the ops it asks for and the answer it gives.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';
import { lanes } from './week.js';

type Item = { id: string; type: string; title: string; status?: string; props?: Record<string, unknown>; body?: string; created_at?: string };
type Link = { id: string; type: string; from: string; to: string };

/** What each type is, as the kernel says it with every item read. */
const LINEAGE: Record<string, string[]> = {
  project: ['project', 'aim'],
  task: ['task', 'work'],
  company: ['company', 'actor'],
  person: ['person', 'actor'],
  'software.repo': ['software.repo', 'place'],
  'time.entry': ['time.entry', 'occurrence'],
  'time.invoice': ['time.invoice', 'document', 'record'],
};

/** A context over fixtures: the reads the kernel answers (get, items, related, trail, view), at a fixed moment in Toronto. */
function ctxOver(items: Item[], links: Link[], lens: unknown = { items: [] }, now = '2026-10-16T16:00:00Z') {
  const typed = (e: Item | undefined) => (e ? { status: 'active', props: {}, body: '', created_at: '2026-10-01T00:00:00Z', ...e, is: LINEAGE[e.type] ?? [e.type] } : null);
  const byId = new Map(items.map((e) => [e.id, e]));
  // A kind of link reads its flavours too: lives_in is software.lives_in as well.
  const fits = (type: string, asked: string) => type === asked || type.endsWith(`.${asked}`);
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    ctx: {
      now,
      zone: 'America/Toronto',
      actor: { name: 'test', kind: 'human' },
      read: async (q: Record<string, any>) => {
        asked.push(q);
        if (q.get !== undefined) return typed(byId.get(q.get));
        if (q.items) {
          const { type, status, where = {}, between } = q.items;
          return items
            .map(typed)
            .filter((e) => e!.is.includes(type))
            .filter((e) => status === undefined || [status].flat().includes(e!.status))
            .filter((e) => Object.entries(where).every(([k, v]) => e!.props[k] === v))
            .filter((e) => !between || ((between.from === undefined || String(e!.props[between.field]) >= between.from) && (between.to === undefined || String(e!.props[between.field]) <= between.to)));
        }
        if (q.related !== undefined) {
          const out = q.direction === 'in';
          return links.filter((r) => fits(r.type, q.relation) && (out ? r.to : r.from) === q.related).map((r) => ({ ...typed(byId.get(out ? r.from : r.to)), link: r.id }));
        }
        if (q.trail !== undefined) {
          const up: Item[] = [];
          for (let at = q.trail; ; ) {
            const next = links.find((r) => r.type === 'part_of' && r.from === at);
            if (!next || up.some((u) => u.id === next.to)) break;
            up.unshift(byId.get(next.to)!);
            at = next.to;
          }
          return up.map(typed);
        }
        if (q.view === 'lens') return lens;
        throw new Error(`no read ${JSON.stringify(q)}`);
      },
    },
  };
}

const MAP: Item[] = [
  { id: 'me', type: 'company', title: 'Aperture Design Tools Inc.', props: { address: '1 King St' } },
  { id: 'nw', type: 'company', title: 'Northwind', props: { rate: 80, hst: true, terms_days: 30, billed_by: 'me' } },
  { id: 'p', type: 'project', title: 'Northwind research' },
  { id: 't', type: 'task', title: 'Funding research' },
  { id: 'e1', type: 'time.entry', title: 'Read the program', status: 'logged', props: { date: '2026-10-14', hours: 3 } },
  { id: 'e2', type: 'time.entry', title: 'Call with Sam', status: 'logged', props: { date: '2026-10-15', start: '2026-10-15T13:00:00Z', end: '2026-10-15T14:30:00Z', hours: 9 } },
  { id: 'e3', type: 'time.entry', title: 'Internal', status: 'logged', props: { date: '2026-10-15', hours: 2, billable: false } },
  { id: 'old', type: 'time.invoice', title: 'Invoice INV-2026-001: Northwind', status: 'paid', props: { number: 'INV-2026-001', billed_by: 'me' } },
];
const LINKS: Link[] = [
  { id: 'r1', type: 'involves', from: 'p', to: 'nw' },
  { id: 'r2', type: 'part_of', from: 't', to: 'p' },
  { id: 'r3', type: 'part_of', from: 'e1', to: 't' },
  { id: 'r4', type: 'part_of', from: 'e2', to: 'p' },
  { id: 'r5', type: 'part_of', from: 'e3', to: 'p' },
];

test('time is logged as a block or as hours, on the day it began where the work is done, with its client', async () => {
  const { ctx } = ctxOver(MAP, LINKS);
  const block = await handler['time.log']({ work: 't', what: 'Late call', start: '2026-10-15T23:00:00-04:00', end: '2026-10-16T00:30:00-04:00' }, ctx);
  assert.deepEqual(block.ops, [
    { op: 'create', ref: 'e', type: 'time.entry', title: 'Late call', status: 'logged', body: '', props: { date: '2026-10-15', hours: 1.5, start: '2026-10-16T03:00:00.000Z', end: '2026-10-16T04:30:00.000Z' } },
    { op: 'link', type: 'part_of', from: 'e', to: 't' },
  ]);
  assert.equal(block.answer.client, 'Northwind', 'the company the work sits in involves');
  const hours = await handler['time.log']({ work: 'me', hours: 2, what: 'Books', planned: true, billable: false }, ctx);
  assert.deepEqual([hours.ops[0].status, hours.ops[0].props, hours.answer.client], ['planned', { date: '2026-10-16', hours: 2, billable: false }, 'Aperture Design Tools Inc.'], 'today in Toronto; a company is its own client');
  await assert.rejects(handler['time.log']({ work: 't', hours: 30, what: 'Too long' }, ctx), /at most 24/);
  await assert.rejects(handler['time.log']({ work: 'nowhere', hours: 1, what: 'x' }, ctx), /No work "nowhere"/);
});

test('a timesheet sums by day and client, block hours from start to end, and says what is not yet invoiced', async () => {
  const { ctx } = ctxOver(MAP, LINKS);
  const { answer } = await handler['time.timesheet']({ from: '2026-10-12', to: '2026-10-18' }, ctx);
  assert.equal(answer.total, 6.5, 'a block counts the time between its start and end, not its hours field');
  assert.deepEqual(answer.days.map((d: { date: string; hours: number }) => [d.date, d.hours]), [['2026-10-14', 3], ['2026-10-15', 3.5]]);
  assert.deepEqual(answer.by_client, [{ client: 'Northwind', hours: 6.5, billable: 4.5 }]);
  assert.deepEqual(answer.not_invoiced, [{ client: 'Northwind', id: 'nw', hours: 4.5 }]);
  assert.deepEqual(answer.invoices.outstanding, []);
});

test('an invoice takes the next number from its biller, bills its entries and marks them invoiced', async () => {
  const { ctx } = ctxOver(MAP, LINKS);
  const done = await handler['time.invoice_draft']({ client: 'nw' }, ctx);
  assert.deepEqual([done.answer.number, done.answer.entries, done.answer.subtotal, done.answer.tax, done.answer.total], ['INV-2026-002', 2, 360, 46.8, 406.8]);
  const [create, part, ...rest] = done.ops;
  assert.deepEqual([create.type, create.status, create.props.due, part], ['time.invoice', 'draft', '2026-11-15', { op: 'link', type: 'part_of', from: 'inv', to: 'nw' }]);
  assert.deepEqual(rest, [
    { op: 'link', type: 'time.bills', from: 'inv', to: 'e1' },
    { op: 'update', id: 'e1', status: 'invoiced' },
    { op: 'link', type: 'time.bills', from: 'inv', to: 'e2' },
    { op: 'update', id: 'e2', status: 'invoiced' },
  ]);
  assert.match(create.body, /\| Oct 14 \| Read the program — Funding research \| 3 \| \$80\.00 \| \$240\.00 \|/);
  await assert.rejects(handler['time.invoice_draft']({ client: 'p' }, ctx), /not a company/);
  await assert.rejects(handler['time.invoice_draft']({ client: 'me' }, ctx), /does not say who bills it/);
});

test('a payment in part says the invoice was sent; voiding frees its entries', async () => {
  const sent: Item = { id: 'inv', type: 'time.invoice', title: 'Invoice INV-2026-002', status: 'draft', props: { number: 'INV-2026-002', total: 565, currency: 'CAD' } };
  const { ctx } = ctxOver([...MAP, sent], [...LINKS, { id: 'b1', type: 'time.bills', from: 'inv', to: 'e1' }]);
  const part = await handler['time.invoice_paid']({ id: 'inv', amount: 200, method: 'EFT', date: '2026-10-20' }, ctx);
  assert.deepEqual(part.ops, [{ op: 'update', id: 'inv', status: 'sent', props: { paid: 200, paid_on: '2026-10-20', payments: [{ date: '2026-10-20', amount: 200, method: 'EFT' }] } }]);
  assert.deepEqual([part.answer.owing, part.answer.status], [365, 'sent']);
  const voided = await handler['time.invoice_void']({ id: 'inv' }, ctx);
  assert.deepEqual(voided.ops, [{ op: 'update', id: 'inv', status: 'void' }, { op: 'update', id: 'e1', status: 'logged' }]);
  await assert.rejects(handler['time.invoice_paid']({ id: 'e1' }, ctx), /is not an invoice/);
});

test('the week draws the owner’s blocks, routine days and the agents’ stretches from the kernel’s time axis', async () => {
  const items: Item[] = [
    ...MAP,
    { id: 'ar', type: 'project', title: 'Archipelago' },
    { id: 'repo', type: 'software.repo', title: 'Archipelago repo' },
    { id: 'late', type: 'time.entry', title: 'Late night', status: 'logged', props: { date: '2026-10-16', start: '2026-10-17T03:00:00Z', end: '2026-10-17T05:00:00Z' } },
    { id: 'plan', type: 'time.entry', title: 'Site visit', status: 'planned', props: { date: '2026-10-13', start: '2026-10-13T13:00:00Z', end: '2026-10-13T15:00:00Z' } },
  ];
  const links: Link[] = [...LINKS, { id: 'l1', type: 'software.lives_in', from: 'ar', to: 'repo' }, { id: 'l2', type: 'part_of', from: 'deep', to: 'p' }, { id: 'l3', type: 'part_of', from: 'plan', to: 'p' }, { id: 'l4', type: 'part_of', from: 'late', to: 'ar' }];
  // What the kernel's lens answers on the time axis: a routine's days, and sessions' stretches with what each was on.
  const lens = {
    items: [
      { id: 'deep', type: 'time.routine', title: 'Deep work', open: true, time: [{ start: '2026-10-14T13:00:00Z', end: '2026-10-14T15:00:00Z', by: 'repeat' }] },
      { id: 'run1', type: 'sys.run', title: 'Session one', status: 'running', open: true, time: [{ start: '2026-10-14T17:00:00Z', end: '2026-10-14T19:00:00Z', by: 'when', on: 't' }] },
      { id: 'run2', type: 'sys.run', title: 'Session two', status: 'finished', open: false, time: [{ start: '2026-10-14T17:30:00Z', end: '2026-10-14T18:00:00Z', by: 'when', on: 'repo' }] },
      { id: 'push', type: 'sys.run', title: 'Read the push', status: 'finished', open: false, time: [{ start: '2026-10-15T13:00:00Z', end: '2026-10-15T13:00:00Z', by: 'when', on: 'repo' }] },
    ],
  };
  const { ctx, asked } = ctxOver(items, links, lens);
  const { answer: wk } = await handler['time.week']({ from: '2026-10-15' }, ctx);
  assert.deepEqual([wk.from, wk.to, wk.zone], ['2026-10-12', '2026-10-18', 'America/Toronto']);
  const axis = asked.find((q) => q.view === 'lens') as { params: { kinds: string[]; time: { from: string; to: string } } };
  assert.deepEqual([axis.params.kinds, axis.params.time.from, axis.params.time.to], [['time.routine', 'sys.run'], '2026-10-03', '2026-10-18'], 'the week and the two weeks before today');
  const wed = wk.days[2];
  assert.deepEqual(wed.owner.map((b: { what: string; from_hour: number; routine?: boolean }) => [b.what, b.from_hour, b.routine ?? false]), [['Read the program', null, false], ['Deep work', 9, true]], 'hours alone have no place in the day');
  assert.equal(wed.planned, 2, 'a routine for work is planned time');
  assert.deepEqual(
    wed.agents.map((lane: { what: string; from_hour: number; to_hour: number; project: string }[]) => lane.map((b) => [b.what, b.from_hour, b.to_hour, b.project])),
    [[['Funding research', 13, 15, 'p']], [['Session two', 13.5, 14, 'ar']]],
    'one lane per agent at once; a session on nothing in particular is named for itself and counts to the project living where it ran',
  );
  assert.deepEqual([wk.days[3].reported, wk.days[3].agents.length], [1, 0], 'a run told of once it was over is counted, not drawn');
  assert.deepEqual([wk.days[4].owner[0].to_hour, wk.days[5].owner[0].from_hour, wk.days[5].owner[0].to_hour], [24, 0, 1], 'a block past midnight is on both days');
  assert.deepEqual(wk.to_confirm.map((b: { id: string; date: string }) => [b.id, b.date]), [['plan', '2026-10-13'], ['deep', '2026-10-14']], 'what has passed waits for the owner');
  assert.deepEqual(wk.projects.map((p: { title: string }) => p.title).sort(), ['Archipelago', 'Northwind research']);
});

test('sessions at work at once take as few lanes as hold them', () => {
  const b = (id: string, from_hour: number, to_hour: number) => ({ id, from_hour, to_hour });
  assert.deepEqual(lanes([b('a', 9, 10), b('b', 9.5, 11), b('c', 10, 12), b('a', 13, 14)]).map((lane) => lane.map((x) => x.id)), [['a', 'a'], ['b'], ['c']], 'a session keeps to one lane all day');
});
