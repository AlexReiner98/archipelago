// Hours logged and the invoices made from them. An entry is part of the work it was for; its client is the company
// that work, or what it sits in, involves. A client says who bills it, at what rate, on what terms and whether HST is
// charged. An invoice is a document whose note is the bill as made, fixed from then on, and it bills its entries.
// Each function reads through the Reader and answers with ops for the kernel to write; nothing here writes.

import { DAY, addDays, blockHours, cents, longDay, mondayOf, money, shortDay, today } from './days.js';
import { isA, Reader } from './work.js';

/** HST in Ontario. */
const HST = 0.13;

/** Record time spent on a piece of work: hours on a day, or a block from a start to an end. */
export async function log(input, ctx) {
  const r = new Reader(ctx);
  const work = await r.get(input.work);
  if (!work || work.archived_at) throw new Error(`No work "${input.work}" to log time against: give the id of a project, task or client.`);
  // A block says when; its hours are the time between, and its day is the day it began.
  const timed = input.start !== undefined || input.end !== undefined;
  if (timed && (Number.isNaN(Date.parse(input.start ?? '')) || Number.isNaN(Date.parse(input.end ?? '')))) throw new Error('start and end must both be date-times like 2026-10-15T09:30:00-04:00');
  const start = timed ? new Date(input.start).toISOString() : undefined;
  const end = timed ? new Date(input.end).toISOString() : undefined;
  const hours = timed ? blockHours(start, end) : input.hours;
  if (timed && hours === undefined) throw new Error('end must come after start');
  if (!(hours !== undefined && hours > 0 && hours <= 24)) throw new Error('hours must be more than 0 and at most 24');
  const date = input.date ?? today(ctx.zone, start ?? ctx.now);
  if (!DAY.test(date)) throw new Error('date must look like 2026-10-15');
  const client = await r.clientOf(work.id);
  const props = { date, hours, ...(start && { start, end }), ...(input.billable === false && { billable: false }), ...(input.rate !== undefined && { rate: input.rate }) };
  return {
    ops: [
      { op: 'create', ref: 'e', type: 'time.entry', title: input.what, status: input.planned ? 'planned' : 'logged', body: input.note ?? '', props },
      { op: 'link', type: 'part_of', from: 'e', to: work.id },
    ],
    reason: `${input.planned ? 'Planned' : 'Logged'} ${hours} h on ${work.title} for ${date}`,
    answer: { work: work.title, client: client?.title ?? null, date, hours, ...(start && { start, end }), ...(!client && { note: 'No client: this work involves no company, so it cannot be invoiced until it, or what it sits in, involves one.' }) },
  };
}

/** Invoices not yet paid: those sent (and of them, those past due) and the drafts, each with what is still owed. */
async function owed(r, now) {
  const rows = (await r.read({ items: { type: 'time.invoice', status: ['draft', 'sent'] } })).sort((a, b) => String(a.props.due ?? '').localeCompare(String(b.props.due ?? '')) || String(a.props.number ?? '').localeCompare(String(b.props.number ?? '')));
  const list = [];
  for (const i of rows) {
    const total = Number(i.props.total ?? 0);
    const paid = Number(i.props.paid ?? 0);
    const due = typeof i.props.due === 'string' ? i.props.due : null;
    const late = i.status === 'sent' && due !== null && due < now ? Math.round((Date.parse(now) - Date.parse(due)) / 86_400_000) : 0;
    list.push({ id: i.id, number: i.props.number, client: typeof i.props.client === 'string' ? await r.title(i.props.client) : null, status: i.status, total, paid, owing: cents(total - paid), currency: i.props.currency ?? 'CAD', due, ...(late > 0 && { overdue_days: late }) });
  }
  const sent = list.filter((i) => i.status === 'sent');
  return { outstanding: sent, overdue: sent.filter((i) => 'overdue_days' in i), drafts: list.filter((i) => i.status === 'draft'), owed_total: cents(sent.reduce((n, i) => n + i.owing, 0)) };
}

/** Time logged over a span of days (this week, Monday to Sunday, unless asked), by day and by client, and what is not yet invoiced. */
export async function timesheet(input, ctx) {
  const now = today(ctx.zone, ctx.now);
  const monday = mondayOf(now);
  const from = input.from ?? monday;
  const to = input.to ?? (input.from ? now : addDays(monday, 6));
  if (!DAY.test(from) || !DAY.test(to)) throw new Error('from and to must look like 2026-10-15');
  const r = new Reader(ctx);
  const rows = await r.entries({ from, to });
  const days = new Map();
  const byClient = new Map();
  for (const e of rows) {
    const client = await r.clientOf(e.work);
    const day = days.get(e.date) ?? { date: e.date, hours: 0, entries: [] };
    day.hours = cents(day.hours + e.hours);
    day.entries.push({ id: e.id, what: e.title, hours: e.hours, work: await r.title(e.work), work_id: e.work, client: client?.title ?? null, status: e.status, ...(e.start && { start: e.start, end: e.end }), ...(e.body && { note: e.body }), ...(e.rate != null && { rate: e.rate }), ...(!e.billable && { billable: false }) });
    days.set(e.date, day);
    const key = client?.title ?? 'No client';
    const sum = byClient.get(key) ?? { client: key, hours: 0, billable: 0 };
    sum.hours = cents(sum.hours + e.hours);
    if (e.billable) sum.billable = cents(sum.billable + e.hours);
    byClient.set(key, sum);
  }
  // What has been logged and not yet billed, whenever it was done.
  const unbilled = new Map();
  for (const e of (await r.entries({ status: 'logged' })).filter((x) => x.billable)) {
    const client = await r.clientOf(e.work);
    const key = client?.id ?? 'none';
    const sum = unbilled.get(key) ?? { client: client?.title ?? 'No client', id: client?.id ?? null, hours: 0 };
    sum.hours = cents(sum.hours + e.hours);
    unbilled.set(key, sum);
  }
  const answer = { from, to, total: cents(rows.reduce((n, e) => n + e.hours, 0)), days: [...days.values()], by_client: [...byClient.values()], not_invoiced: [...unbilled.values()], invoices: await owed(r, now) };
  return { answer };
}

/** A draft invoice to a client for its billable time not yet invoiced, up to a day (today unless asked). Its entries are marked invoiced. */
export async function draftInvoice(input, ctx) {
  const r = new Reader(ctx);
  const client = await r.get(input.client);
  if (!client || !isA(client, 'company')) throw new Error(`"${input.client}" is not a company to invoice.`);
  const p = client.props ?? {};
  const billedBy = typeof p.billed_by === 'string' ? await r.get(p.billed_by) : null;
  if (!billedBy) throw new Error(`${client.title} does not say who bills it: set its billed_by to the id of the company or person the invoice is from.`);
  const issued = today(ctx.zone, ctx.now);
  const to = input.to ?? issued;
  const from = input.from;
  if (!DAY.test(to) || (from !== undefined && !DAY.test(from))) throw new Error('from and to must look like 2026-10-15');
  const mine = [];
  for (const e of await r.entries({ status: 'logged', from, to })) if (e.billable && e.work && (await r.clientOf(e.work))?.id === client.id) mine.push({ ...e, workTitle: (await r.title(e.work)) ?? '' });
  if (!mine.length) throw new Error(`No billable time for ${client.title} that is not already invoiced${from ? ` from ${from}` : ''} up to ${to}.`);
  const rate = typeof p.rate === 'number' ? p.rate : undefined;
  const unpriced = mine.filter((e) => e.rate == null && rate === undefined);
  if (unpriced.length) throw new Error(`${client.title} has no rate, and ${unpriced.length} entr${unpriced.length === 1 ? 'y has' : 'ies have'} none either: set the client's rate.`);
  const currency = typeof p.currency === 'string' ? p.currency : 'CAD';
  const terms = typeof p.terms_days === 'number' ? p.terms_days : 30;
  const due = addDays(issued, terms);
  const lines = mine.map((e) => ({ e, each: e.rate ?? rate, amount: cents(e.hours * (e.rate ?? rate)) }));
  const hours = cents(mine.reduce((n, e) => n + e.hours, 0));
  const subtotal = cents(lines.reduce((n, x) => n + x.amount, 0));
  const tax = p.hst === true ? cents(subtotal * HST) : 0;
  const total = cents(subtotal + tax);
  // The next number from this biller this year: INV-2026-001, then 002.
  const year = issued.slice(0, 4);
  const numbers = (await r.read({ items: { type: 'time.invoice', where: { billed_by: billedBy.id } } })).map((i) => String(i.props.number ?? '')).filter((n) => n.startsWith(`INV-${year}-`));
  const number = `INV-${year}-${String(Math.max(0, ...numbers.map((n) => Number(n.split('-').at(-1)) || 0)) + 1).padStart(3, '0')}`;
  const bp = billedBy.props ?? {};
  const said = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  // A cell holds no pipe of its own.
  const cell = (v) => String(v ?? '').replaceAll('|', '/').trim();
  const fromLines = [billedBy.title, said(bp.address), said(bp.email), said(bp.hst_number) && `HST ${said(bp.hst_number)}`].filter(Boolean);
  const toLines = [client.title, said(p.address), said(p.email)].filter(Boolean);
  const body = [
    '| From | Bill to |',
    '| --- | --- |',
    ...Array.from({ length: Math.max(fromLines.length, toLines.length) }, (_, i) => `| ${i === 0 ? `**${cell(fromLines[i])}**` : cell(fromLines[i])} | ${i === 0 ? `**${cell(toLines[i])}**` : cell(toLines[i])} |`),
    '',
    `For work from ${longDay(mine[0].date)} to ${longDay(mine.at(-1).date)}. Due ${terms} days from issue.`,
    '',
    'Work',
    '| Date | Description | Hours | Rate | Amount |',
    '| --- | --- | --: | --: | --: |',
    ...lines.map(({ e, each, amount }) => `| ${shortDay(e.date)} | ${cell(e.title)}${e.workTitle && e.workTitle !== e.title ? ` — ${cell(e.workTitle)}` : ''} | ${e.hours} | ${money(each, currency)} | ${money(amount, currency)} |`),
    '',
    'Totals',
    '| | |',
    '| --: | --: |',
    `| Hours | ${hours} |`,
    `| Subtotal | ${money(subtotal, currency)} |`,
    ...(p.hst === true ? [`| HST 13% | ${money(tax, currency)} |`] : []),
    `| **Total due (${currency})** | **${money(total, currency)}** |`,
    // How to pay, as the biller keeps it: one way per line.
    ...(said(bp.payment) ? ['', 'How to pay', ...said(bp.payment).split('\n').map((way) => way.trim().replace(/^[-*]\s*/, '')).filter(Boolean).map((way) => `- ${way}`), `- Please quote ${number} with your payment.`] : []),
  ].join('\n');
  return {
    ops: [
      { op: 'create', ref: 'inv', type: 'time.invoice', title: `Invoice ${number}: ${client.title}`, status: 'draft', body, props: { number, client: client.id, billed_by: billedBy.id, issued, due, period_from: mine[0].date, period_to: mine.at(-1).date, hours, subtotal, tax, total, currency } },
      { op: 'link', type: 'part_of', from: 'inv', to: client.id },
      ...mine.flatMap((e) => [
        { op: 'link', type: 'time.bills', from: 'inv', to: e.id },
        { op: 'update', id: e.id, status: 'invoiced' },
      ]),
    ],
    reason: `Drafted invoice ${number} to ${client.title}: ${hours} h, ${money(total, currency)}`,
    answer: { number, hours, subtotal, tax, total, currency, entries: mine.length },
  };
}

/** Record a payment on an invoice: its date (today unless given), amount (what is still owed unless given) and method. Paid in full, it closes. */
export async function payInvoice(input, ctx) {
  const invoice = await ctx.read({ get: input.id });
  if (!invoice || !isA(invoice, 'time.invoice')) throw new Error(`"${input.id}" is not an invoice`);
  if (invoice.status === 'void') throw new Error('It is void: nothing is owed on it.');
  const p = invoice.props ?? {};
  const total = Number(p.total ?? 0);
  const before = Number(p.paid ?? 0);
  const owing = cents(total - before);
  if (owing <= 0) throw new Error(`${String(p.number ?? invoice.title)} is already paid in full.`);
  const amount = cents(input.amount ?? owing);
  if (!(amount > 0)) throw new Error('amount must be more than 0');
  const date = input.date ?? today(ctx.zone, ctx.now);
  if (!DAY.test(date)) throw new Error('date must look like 2026-10-15');
  const paid = cents(before + amount);
  const payments = [...(Array.isArray(p.payments) ? p.payments : []), { date, amount, ...(input.method && { method: input.method }) }];
  const currency = typeof p.currency === 'string' ? p.currency : 'CAD';
  // Paid in full it is paid; a payment on a draft says it was sent.
  const status = paid >= total ? 'paid' : invoice.status === 'draft' ? 'sent' : invoice.status;
  return {
    ops: [{ op: 'update', id: invoice.id, status, props: { paid, paid_on: date, payments } }],
    reason: `${money(amount, currency)} received${input.method ? ` by ${input.method}` : ''} on ${String(p.number ?? invoice.title)}${status === 'paid' ? ': paid in full' : `: ${money(cents(total - paid), currency)} still owed`}`,
    answer: { number: p.number, paid, owing: cents(Math.max(total - paid, 0)), status },
  };
}

/** Void an invoice: its entries go back to being logged, to be billed again. */
export async function voidInvoice(input, ctx) {
  const invoice = await ctx.read({ get: input.id });
  if (!invoice || !isA(invoice, 'time.invoice')) throw new Error(`"${input.id}" is not an invoice`);
  if (invoice.status === 'void') throw new Error('It is already void.');
  const billed = await ctx.read({ related: invoice.id, relation: 'time.bills' });
  return {
    ops: [{ op: 'update', id: invoice.id, status: 'void' }, ...billed.map((e) => ({ op: 'update', id: e.id, status: 'logged' }))],
    reason: input.reason ?? `Voided ${String(invoice.props?.number ?? invoice.title)}; its time can be invoiced again`,
  };
}
