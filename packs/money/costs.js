// What the work costs, worked out from what the map holds: what agents spent, which the kernel measures from their
// runs (the view spent), and what is paid regularly (hosting, a subscription), each a cost someone wrote down.
// Nothing is guessed: a payment with no amount is named as not priced.

/** Days in a month, on average: what a monthly payment is spread over. */
const MONTH = 30.4375;
const DAY = 86_400_000;
const cents = (n) => Math.round(n * 100) / 100;

export async function costs(input, ctx) {
  const agents = await ctx.read({ view: 'spent', params: { days: input.days ?? 30 } });
  const { days } = agents;
  const now = Date.parse(ctx.now);
  const since = now - days * DAY;
  const paid = (await ctx.read({ items: { type: 'money.cost' } })).sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  const day = (value, fallback) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : fallback);
  const items = paid.map((e) => {
    const p = e.props ?? {};
    const amount = typeof p.amount === 'number' ? p.amount : null;
    const currency = String(p.currency ?? 'USD').toUpperCase();
    const every = p.every === 'year' ? 'year' : 'month';
    const perMonth = amount === null ? null : every === 'year' ? amount / 12 : amount;
    // Paid from when it says (or from when it was written down) until it says, or until it was ended, or still.
    const from = day(p.since, Date.parse(e.created_at));
    const to = day(p.until, e.is_open ? now : Date.parse(e.updated_at));
    const overlap = Math.max(0, Math.min(to, now) - Math.max(from, since)) / DAY;
    return {
      id: e.id,
      type: e.type,
      title: e.title,
      status: e.status,
      open: e.is_open,
      vendor: p.vendor ?? null,
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
    cost_usd: cents(inDollars.reduce((n, i) => n + i.share, 0)),
    per_month: cents(inDollars.filter((i) => i.open).reduce((n, i) => n + i.per_month, 0)),
    items: items.filter((i) => i.open || (i.share ?? 0) > 0),
    /** Written down with no amount: not in the sums until someone says what is paid. */
    unpriced: items.filter((i) => i.open && i.amount === null).map((i) => ({ id: i.id, title: i.title })),
    /** Paid in another currency: listed, not added to the dollars. */
    other_currencies: items.filter((i) => i.currency !== 'USD' && i.amount !== null).map((i) => ({ id: i.id, title: i.title, currency: i.currency })),
  };
  return {
    days,
    since: agents.since,
    total_usd: cents(agents.cost_usd + recurring.cost_usd),
    /** What a month costs at this rate: the regular payments still being paid, and what agents spent scaled to a month. */
    per_month: cents(recurring.per_month + (agents.cost_usd * MONTH) / days),
    agents: { cost_usd: agents.cost_usd, tokens: agents.tokens, unpriced_tokens: agents.unpriced_tokens, by: agents.by },
    recurring,
    /** The type a new regular payment is made as. */
    adds: 'money.cost',
    how: 'A regular payment is a cost item: its amount, how often (every: month or year), since when. What agents spend is read from their runs: a run that reports cost_usd is in the dollars; one that reports only tokens is counted in tokens.',
  };
}
