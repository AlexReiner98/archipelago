// Time worked and the invoices made from it. An entry is part of the work it was for; its client is the company
// that work, or what it sits in, involves. A client says who bills it, at what rate, on what terms and whether HST is
// charged. An invoice is a document whose note is the bill as made, fixed from then on, and it bills its entries.

import type { Actor, Archipelago, Entity } from './pelago.ts';

/** Days are counted where the work is done. */
const ZONE = 'America/Toronto';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const today = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(at);
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, currency: string) => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(n);
/** HST in Ontario. */
const HST = 0.13;

/** The client of a piece of work: the company it, or the nearest thing it sits in, involves; a company is its own. */
export async function clientOf(l: Archipelago, id: string): Promise<Entity | undefined> {
  const self = await l.entity(id);
  if (self && l.registry.isA(self.type, 'company')) return self;
  const chain = [id, ...(await l.trail(id)).map((t) => t.id).reverse()];
  for (const at of chain) {
    const { rows } = await l.db.query<{ id: string }>(
      `select e.id from relation r join entity e on e.id = r.to_id
       where r.from_id = $1 and r.type = 'involves' and r.valid_to is null and e.archived_at is null and e.type = any($2::text[]) order by e.title limit 1`,
      [at, l.registry.family('company')],
    );
    if (rows[0]) return l.entity(rows[0].id);
  }
  return undefined;
}

/** Record time spent on a piece of work. */
export async function logTime(l: Archipelago, actor: Actor, input: { work: string; hours: number; what: string; note?: string; date?: string; billable?: boolean; rate?: number }) {
  const work = await l.entity(input.work);
  if (!work || work.archived_at) throw new Error(`No work "${input.work}" to log time against: give the id of a project, task or client.`);
  if (!(input.hours > 0 && input.hours <= 24)) throw new Error('hours must be more than 0 and at most 24');
  const date = input.date ?? today();
  if (!DAY.test(date)) throw new Error('date must look like 2026-10-15');
  const client = await clientOf(l, work.id);
  const props = { date, hours: input.hours, ...(input.billable === false && { billable: false }), ...(input.rate !== undefined && { rate: input.rate }) };
  const result = await l.change(actor, {
    ops: [
      { op: 'create', ref: 'e', type: 'time.entry', title: input.what, status: 'logged', body: input.note ?? '', props },
      { op: 'link', type: 'part_of', from: 'e', to: work.id },
    ],
    reason: `Logged ${input.hours} h on ${work.title} for ${date}`,
  });
  return { ...result, work: work.title, client: client?.title ?? null, date, hours: input.hours, ...(!client && { note: 'No client: this work involves no company, so it cannot be invoiced until it, or what it sits in, involves one.' }) };
}

interface Row {
  id: string;
  title: string;
  status: string;
  date: string;
  hours: number;
  billable: boolean;
  rate: number | null;
  work: string | null;
}

/** Time entries, each with the work it is part of. */
async function entries(l: Archipelago, where: string, params: unknown[]): Promise<Row[]> {
  const { rows } = await l.db.query<Row>(
    `select e.id, e.title, e.status, e.props ->> 'date' as date, (e.props ->> 'hours')::float8 as hours,
            coalesce((e.props ->> 'billable')::boolean, true) as billable, (e.props ->> 'rate')::float8 as rate,
            (select r.to_id from relation r where r.from_id = e.id and r.type = 'part_of' and r.valid_to is null limit 1) as work
     from entity e where e.type = any($1::text[]) and e.archived_at is null and e.status <> 'void' and ${where}
     order by e.props ->> 'date', e.created_at`,
    [l.registry.family('time.entry'), ...params],
  );
  return rows;
}

/** Time logged over a span of days (this week, Monday to Sunday, unless asked), by day and by client, and what is not yet invoiced. */
export async function timesheet(l: Archipelago, input: { from?: string; to?: string }) {
  const now = today();
  const monday = addDays(now, -((new Date(`${now}T12:00:00Z`).getUTCDay() + 6) % 7));
  const from = input.from ?? monday;
  const to = input.to ?? (input.from ? now : addDays(monday, 6));
  if (!DAY.test(from) || !DAY.test(to)) throw new Error('from and to must look like 2026-10-15');
  const rows = await entries(l, `e.props ->> 'date' between $2 and $3`, [from, to]);
  const titles = new Map<string, string>();
  const clients = new Map<string, Entity | undefined>();
  const named = async (id: string | null) => (id ? (titles.get(id) ?? (titles.set(id, (await l.entity(id))?.title ?? id), titles.get(id)!)) : null);
  const clientFor = async (work: string | null) => {
    if (!work) return undefined;
    if (!clients.has(work)) clients.set(work, await clientOf(l, work));
    return clients.get(work);
  };
  const days = new Map<string, { date: string; hours: number; entries: unknown[] }>();
  const byClient = new Map<string, { client: string; hours: number; billable: number }>();
  for (const r of rows) {
    const client = await clientFor(r.work);
    const day = days.get(r.date) ?? { date: r.date, hours: 0, entries: [] };
    day.hours = cents(day.hours + r.hours);
    day.entries.push({ id: r.id, what: r.title, hours: r.hours, work: await named(r.work), client: client?.title ?? null, status: r.status, ...(!r.billable && { billable: false }) });
    days.set(r.date, day);
    const key = client?.title ?? 'No client';
    const sum = byClient.get(key) ?? { client: key, hours: 0, billable: 0 };
    sum.hours = cents(sum.hours + r.hours);
    if (r.billable) sum.billable = cents(sum.billable + r.hours);
    byClient.set(key, sum);
  }
  // What has been logged and not yet billed, whenever it was done.
  const open = await entries(l, `e.status = 'logged' and coalesce((e.props ->> 'billable')::boolean, true)`, []);
  const unbilled = new Map<string, { client: string; id: string | null; hours: number }>();
  for (const r of open) {
    const client = await clientFor(r.work);
    const key = client?.id ?? 'none';
    const sum = unbilled.get(key) ?? { client: client?.title ?? 'No client', id: client?.id ?? null, hours: 0 };
    sum.hours = cents(sum.hours + r.hours);
    unbilled.set(key, sum);
  }
  return { from, to, total: cents(rows.reduce((n, r) => n + r.hours, 0)), days: [...days.values()], by_client: [...byClient.values()], not_invoiced: [...unbilled.values()], invoices: await owed(l) };
}

/** The next number for an invoice from one biller this year: INV-2026-001, then 002. */
async function nextNumber(l: Archipelago, billedBy: string, year: string) {
  const { rows } = await l.db.query<{ number: string }>(
    `select props ->> 'number' as number from entity where type = any($1::text[]) and props ->> 'billed_by' = $2 and props ->> 'number' like $3`,
    [l.registry.family('time.invoice'), billedBy, `INV-${year}-%`],
  );
  const last = Math.max(0, ...rows.map((r) => Number(r.number.split('-').at(-1)) || 0));
  return `INV-${year}-${String(last + 1).padStart(3, '0')}`;
}

/** A draft invoice to a client for its billable time not yet invoiced, up to a day (today unless asked). Its entries are marked invoiced. */
export async function draftInvoice(l: Archipelago, actor: Actor, input: { client: string; from?: string; to?: string }) {
  const client = await l.entity(input.client);
  if (!client || !l.registry.isA(client.type, 'company')) throw new Error(`"${input.client}" is not a company to invoice.`);
  const p = client.props as Record<string, unknown>;
  const billedBy = typeof p.billed_by === 'string' ? await l.entity(p.billed_by) : undefined;
  if (!billedBy) throw new Error(`${client.title} does not say who bills it: set its billed_by to the id of the company or person the invoice is from.`);
  const to = input.to ?? today();
  const from = input.from;
  if (!DAY.test(to) || (from !== undefined && !DAY.test(from))) throw new Error('from and to must look like 2026-10-15');
  const open = await entries(l, `e.status = 'logged' and coalesce((e.props ->> 'billable')::boolean, true) and e.props ->> 'date' <= $2 and ($3::text is null or e.props ->> 'date' >= $3)`, [to, from ?? null]);
  const mine: (Row & { workTitle: string })[] = [];
  for (const r of open) if (r.work && (await clientOf(l, r.work))?.id === client.id) mine.push({ ...r, workTitle: (await l.entity(r.work))?.title ?? '' });
  if (!mine.length) throw new Error(`No billable time for ${client.title} that is not already invoiced${from ? ` from ${from}` : ''} up to ${to}.`);
  const rate = typeof p.rate === 'number' ? p.rate : undefined;
  const unpriced = mine.filter((r) => r.rate == null && rate === undefined);
  if (unpriced.length) throw new Error(`${client.title} has no rate, and ${unpriced.length} entr${unpriced.length === 1 ? 'y has' : 'ies have'} none either: set the client's rate.`);
  const currency = typeof p.currency === 'string' ? p.currency : 'CAD';
  const terms = typeof p.terms_days === 'number' ? p.terms_days : 30;
  const issued = today();
  const due = addDays(issued, terms);
  const lines = mine.map((r) => {
    const each = r.rate ?? rate!;
    return { r, each, amount: cents(r.hours * each) };
  });
  const hours = cents(mine.reduce((n, r) => n + r.hours, 0));
  const subtotal = cents(lines.reduce((n, x) => n + x.amount, 0));
  const tax = p.hst === true ? cents(subtotal * HST) : 0;
  const total = cents(subtotal + tax);
  const number = await nextNumber(l, billedBy.id, issued.slice(0, 4));
  const bp = billedBy.props as Record<string, unknown>;
  const said = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  // A cell holds no pipe of its own.
  const cell = (v: unknown) => String(v ?? '').replaceAll('|', '/').trim();
  const fromLines = [billedBy.title, said(bp.address), said(bp.email), said(bp.hst_number) && `HST ${said(bp.hst_number)}`].filter(Boolean) as string[];
  const toLines = [client.title, said(p.address), said(p.email)].filter(Boolean) as string[];
  const body = [
    '| From | Bill to |',
    '| --- | --- |',
    ...Array.from({ length: Math.max(fromLines.length, toLines.length) }, (_, i) => `| ${i === 0 ? `**${cell(fromLines[i])}**` : cell(fromLines[i])} | ${i === 0 ? `**${cell(toLines[i])}**` : cell(toLines[i])} |`),
    '',
    `For work from ${longDay(mine[0].date)} to ${longDay(mine.at(-1)!.date)}. Due ${terms} days from issue.`,
    '',
    'Work',
    '| Date | Description | Hours | Rate | Amount |',
    '| --- | --- | --: | --: | --: |',
    ...lines.map(({ r, each, amount }) => `| ${shortDay(r.date)} | ${cell(r.title)}${r.workTitle && r.workTitle !== r.title ? ` — ${cell(r.workTitle)}` : ''} | ${r.hours} | ${money(each, currency)} | ${money(amount, currency)} |`),
    '',
    'Totals',
    '| | |',
    '| --: | --: |',
    `| Hours | ${hours} |`,
    `| Subtotal | ${money(subtotal, currency)} |`,
    ...(p.hst === true ? [`| HST 13% | ${money(tax, currency)} |`] : []),
    `| **Total due (${currency})** | **${money(total, currency)}** |`,
    // How to pay, as the biller keeps it: one way per line.
    ...(said(bp.payment) ? ['', 'How to pay', ...said(bp.payment)!.split('\n').map((way) => way.trim().replace(/^[-*]\s*/, '')).filter(Boolean).map((way) => `- ${way}`), `- Please quote ${number} with your payment.`] : []),
  ].join('\n');
  const result = await l.change(actor, {
    ops: [
      {
        op: 'create', ref: 'inv', type: 'time.invoice', title: `Invoice ${number}: ${client.title}`, status: 'draft', body,
        props: { number, client: client.id, billed_by: billedBy.id, issued, due, period_from: mine[0].date, period_to: mine.at(-1)!.date, hours, subtotal, tax, total, currency },
      },
      { op: 'link', type: 'part_of', from: 'inv', to: client.id },
      ...mine.flatMap((r) => [
        { op: 'link' as const, type: 'time.bills', from: 'inv', to: r.id },
        { op: 'update' as const, id: r.id, status: 'invoiced' },
      ]),
    ],
    reason: `Drafted invoice ${number} to ${client.title}: ${hours} h, ${money(total, currency)}`,
  });
  return { ...result, number, hours, subtotal, tax, total, currency, entries: mine.length };
}

/** Record a payment on an invoice: its date (today unless given), amount (what is still owed unless given) and method. Paid in full, it closes. */
export async function payInvoice(l: Archipelago, actor: Actor, input: { id: string; amount?: number; date?: string; method?: string }) {
  const invoice = await l.entity(input.id);
  if (!invoice || !l.registry.isA(invoice.type, 'time.invoice')) throw new Error(`"${input.id}" is not an invoice`);
  if (invoice.status === 'void') throw new Error('It is void: nothing is owed on it.');
  const p = invoice.props as Record<string, unknown>;
  const total = Number(p.total ?? 0);
  const before = Number(p.paid ?? 0);
  const owing = cents(total - before);
  if (owing <= 0) throw new Error(`${String(p.number ?? invoice.title)} is already paid in full.`);
  const amount = cents(input.amount ?? owing);
  if (!(amount > 0)) throw new Error('amount must be more than 0');
  const date = input.date ?? today();
  if (!DAY.test(date)) throw new Error('date must look like 2026-10-15');
  const paid = cents(before + amount);
  const payments = [...(Array.isArray(p.payments) ? p.payments : []), { date, amount, ...(input.method && { method: input.method }) }];
  const currency = typeof p.currency === 'string' ? p.currency : 'CAD';
  // Paid in full it is paid; a payment on a draft says it was sent.
  const status = paid >= total ? 'paid' : invoice.status === 'draft' ? 'sent' : invoice.status;
  const result = await l.change(actor, {
    ops: [{ op: 'update', id: invoice.id, status, props: { paid, paid_on: date, payments } }],
    reason: `${money(amount, currency)} received${input.method ? ` by ${input.method}` : ''} on ${String(p.number ?? invoice.title)}${status === 'paid' ? ': paid in full' : `: ${money(cents(total - paid), currency)} still owed`}`,
  });
  return { ...result, number: p.number, paid, owing: cents(Math.max(total - paid, 0)), status };
}

/** Invoices not yet paid: those sent (and of them, those past due) and the drafts, each with what is still owed. */
async function owed(l: Archipelago) {
  const { rows } = await l.db.query<{ id: string; status: string; props: Record<string, unknown> }>(
    `select id, status, props from entity where type = any($1::text[]) and archived_at is null and status in ('draft', 'sent') order by props ->> 'due', props ->> 'number'`,
    [l.registry.family('time.invoice')],
  );
  const now = today();
  const names = new Map<string, string>();
  const name = async (id: unknown) => (typeof id === 'string' ? (names.get(id) ?? (names.set(id, (await l.entity(id))?.title ?? id), names.get(id)!)) : null);
  const list = [];
  for (const r of rows) {
    const total = Number(r.props.total ?? 0);
    const paid = Number(r.props.paid ?? 0);
    const due = typeof r.props.due === 'string' ? r.props.due : null;
    const late = r.status === 'sent' && due !== null && due < now ? Math.round((Date.parse(now) - Date.parse(due)) / 86_400_000) : 0;
    list.push({ id: r.id, number: r.props.number, client: await name(r.props.client), status: r.status, total, paid, owing: cents(total - paid), currency: r.props.currency ?? 'CAD', due, ...(late > 0 && { overdue_days: late }) });
  }
  const sent = list.filter((i) => i.status === 'sent');
  return { outstanding: sent, overdue: sent.filter((i) => 'overdue_days' in i), drafts: list.filter((i) => i.status === 'draft'), owed_total: cents(sent.reduce((n, i) => n + i.owing, 0)) };
}

/** Void an invoice: its entries go back to being logged, to be billed again. */
export async function voidInvoice(l: Archipelago, actor: Actor, input: { id: string; reason?: string }) {
  const invoice = await l.entity(input.id);
  if (!invoice || !l.registry.isA(invoice.type, 'time.invoice')) throw new Error(`"${input.id}" is not an invoice`);
  if (invoice.status === 'void') throw new Error('It is already void.');
  const { rows } = await l.db.query<{ to_id: string }>(`select to_id from relation where from_id = $1 and type = 'time.bills' and valid_to is null`, [invoice.id]);
  return l.change(actor, {
    ops: [{ op: 'update', id: invoice.id, status: 'void' }, ...rows.map((r) => ({ op: 'update' as const, id: r.to_id, status: 'logged' }))],
    reason: input.reason ?? `Voided ${String(invoice.props.number ?? invoice.title)}; its time can be invoiced again`,
  });
}

