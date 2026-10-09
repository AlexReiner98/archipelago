// Costs: what the work costs, worked out from what the map holds. What agents
// spend is measured from their runs; what is paid regularly (hosting, a
// subscription) is an item someone wrote down. Nothing is guessed: a run that
// does not say what it cost is counted in tokens, and a payment with no amount
// is named as not priced.

import type { Entity, Lattice } from './lattice.ts';

/** Days in a month, on average: what a monthly payment is spread over. */
const MONTH = 30.4375;
const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * What was spent over the last days: by agents (dollars where a run says what
 * it cost, tokens where it does not, by where they ran) and on regular
 * payments (each one's share of the period), with the rate per month.
 */
export async function costs(l: Lattice, input: { days?: number }) {
  const days = Math.min(Math.max(Math.round(input.days ?? 30), 1), 366);
  const now = Date.now();
  const since = now - days * DAY;

  const { rows: runs } = await l.db.query<Entity>(`select id, title, props, created_at from entity where type = any($1::text[]) and archived_at is null and created_at >= $2::timestamptz`, [
    l.registry.family('sys.run'),
    new Date(since).toISOString(),
  ]);
  const by = new Map<string, { surface: string; runs: number; tokens: number; cost_usd: number; unpriced_tokens: number }>();
  for (const run of runs) {
    const tokens = Number(run.props.tokens_used ?? 0);
    const cost = typeof run.props.cost_usd === 'number' ? run.props.cost_usd : undefined;
    if (!tokens && cost === undefined) continue;
    const surface = (run.props.surface as string | undefined) ?? 'unknown';
    const sum = by.get(surface) ?? { surface, runs: 0, tokens: 0, cost_usd: 0, unpriced_tokens: 0 };
    sum.runs++;
    sum.tokens += tokens;
    if (cost === undefined) sum.unpriced_tokens += tokens;
    else sum.cost_usd += cost;
    by.set(surface, sum);
  }
  const surfaces = [...by.values()].map((s) => ({ ...s, cost_usd: cents(s.cost_usd) })).sort((a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens);
  const agents = {
    cost_usd: cents(surfaces.reduce((n, s) => n + s.cost_usd, 0)),
    tokens: surfaces.reduce((n, s) => n + s.tokens, 0),
    /** Tokens used by runs that do not say what they cost (a session on a subscription): not in the dollars. */
    unpriced_tokens: surfaces.reduce((n, s) => n + s.unpriced_tokens, 0),
    by: surfaces,
  };

  const { rows: paid } = await l.db.query<Entity>(`select id, type, title, status, is_open, props, created_at, updated_at from entity where type = any($1::text[]) and archived_at is null order by title`, [l.registry.family('cost')]);
  const day = (value: unknown, fallback: number) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : fallback);
  const items = paid.map((e) => {
    const amount = typeof e.props.amount === 'number' ? e.props.amount : null;
    const currency = String(e.props.currency ?? 'USD').toUpperCase();
    const every = e.props.every === 'year' ? 'year' : 'month';
    const perMonth = amount === null ? null : every === 'year' ? amount / 12 : amount;
    // Paid from when it says (or from when it was written down) until it says, or until it was ended, or still.
    const from = day(e.props.since, new Date(e.created_at).getTime());
    const to = day(e.props.until, e.is_open ? now : new Date(e.updated_at).getTime());
    const overlap = Math.max(0, Math.min(to, now) - Math.max(from, since)) / DAY;
    return {
      id: e.id,
      type: e.type,
      title: e.title,
      status: e.status,
      open: e.is_open,
      vendor: (e.props.vendor as string | undefined) ?? null,
      amount,
      currency,
      every,
      per_month: perMonth === null ? null : cents(perMonth),
      /** Its share of the period. */
      share: perMonth === null ? null : cents((perMonth * overlap) / MONTH),
    };
  });
  const inDollars = items.filter((i) => i.currency === 'USD' && i.share !== null);
  const recurring = {
    cost_usd: cents(inDollars.reduce((n, i) => n + i.share!, 0)),
    per_month: cents(inDollars.filter((i) => i.open).reduce((n, i) => n + i.per_month!, 0)),
    items: items.filter((i) => i.open || (i.share ?? 0) > 0),
    /** Written down with no amount: not in the sums until someone says what is paid. */
    unpriced: items.filter((i) => i.open && i.amount === null).map((i) => ({ id: i.id, title: i.title })),
    /** Paid in another currency: listed, not added to the dollars. */
    other_currencies: items.filter((i) => i.currency !== 'USD' && i.amount !== null).map((i) => ({ id: i.id, title: i.title, currency: i.currency })),
  };
  return {
    days,
    since: new Date(since).toISOString(),
    total_usd: cents(agents.cost_usd + recurring.cost_usd),
    /** What a month costs at this rate: the regular payments still being paid, and what agents spent scaled to a month. */
    per_month: cents(recurring.per_month + (agents.cost_usd * MONTH) / days),
    agents,
    recurring,
    how: 'A regular payment is a cost item: its amount, how often (every: month or year), since when. What agents spend is read from their runs: a run that reports cost_usd is in the dollars; one that reports only tokens is counted in tokens.',
  };
}
