// The month's reading: once a month is over, its rows of the channels table are written down as an item, so the
// strategy's call at 90 days reads three of them side by side rather than a table that has moved on. The rows are
// the table's own sums (./layouts/table/index.js), over the same query its view runs, so the two never disagree.
// Run every few hours: a server that was down on the 1st writes the reading when it is back, and never twice.

import { sums } from './layouts/table/index.js';
import { projectOfPosts } from './count.js';

/** What the channels view reads: posts that went out and sources, with the conversations and hours tied to them. */
export const QUERY = {
  filter: { find: ['type post', 'type channel'], only: [], not: ['status dropped', 'status retired', 'status to_write', 'status ready'] },
  walk: { over: ['came_out_of<', 'part_of<'], steps: 1 },
  limit: 300,
};

/** The strategy's bar (e_xa5796tw): a channel works when it gives so many conversations a month in under so many hours. */
const BAR = { conversations: 3, hours: 10 };

/** The month before the one `now` is in, as its key: "2026-11". */
export function monthBefore(now) {
  const d = new Date(now);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

const monthName = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const hours = (h) => String(Math.round(h * 10) / 10);
const share = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');
const many = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const meets = (r) => r.conversations >= BAR.conversations && r.hours < BAR.hours;

/** The reading of one month from the channels table's answer: its title, note and totals, or null when nothing went out. */
export function readingOf(answer, month) {
  const rows = sums(answer, 'channel').months.find((m) => m.month === month)?.rows ?? [];
  if (!rows.length) return null;
  const total = rows.reduce((t, r) => ({ posts: t.posts + r.posts.length, visits: t.visits + r.visits, begun: t.begun + r.begun, paid: t.paid + r.paid, conversations: t.conversations + r.conversations, hours: t.hours + r.hours }), { posts: 0, visits: 0, begun: 0, paid: 0, conversations: 0, hours: 0 });
  const met = rows.filter(meets).map((r) => r.channel);
  const lead = met.length
    ? `${met.join(' and ')} met the bar of ${BAR.conversations} conversations in under ${BAR.hours} hours.`
    : `No channel met the bar of ${BAR.conversations} conversations in under ${BAR.hours} hours.`;
  const table = [
    '| Channel | Posts | Visits | Begun | Paid | Visits to begun | Talks | Hours | Bar |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.channel} | ${r.posts.length} | ${r.visits} | ${r.begun} | ${r.paid} | ${share(r.begun, r.visits)} | ${r.conversations} | ${hours(r.hours)} | ${meets(r) ? 'met' : 'short'} |`),
  ].join('\n');
  return {
    title: `Channels, ${monthName(month)}`,
    body: `${many(total.posts, 'post')}, ${many(total.visits, 'visit')}, ${many(total.begun, 'trial')} begun, ${total.paid} paid, ${many(total.conversations, 'conversation')}. ${lead}\n\n## By channel\n${table}`,
    props: { month, posts: total.posts, visits: total.visits, begun: total.begun, paid: total.paid, conversations: total.conversations, hours: Math.round(total.hours * 10) / 10, met },
    posts: rows.flatMap((r) => r.posts.map((p) => p.id)),
  };
}

export async function reading(_input, ctx) {
  const month = monthBefore(ctx.now);
  const [had] = await ctx.read({ items: { type: 'channel_month', where: { month } }, fields: ['month'] });
  if (had) return { answer: { month, made: false, reason: 'Written already.' } };
  const r = readingOf(await ctx.read({ view: 'flat', params: QUERY }), month);
  if (!r) return { answer: { month, made: false, reason: 'Nothing went out that month.' } };
  const project = await projectOfPosts(ctx);
  return {
    changes: [
      {
        ops: [
          { op: 'create', ref: 'r', type: 'channel_month', title: r.title, status: 'current', body: r.body, props: r.props },
          ...(project ? [{ op: 'link', type: 'part_of', from: 'r', to: project }] : []),
          ...r.posts.map((id) => ({ op: 'link', type: 'about', from: 'r', to: id })),
        ],
        reason: `${r.title}: the month's channels written down`,
        authority: { of: 'agent', basis: `The channels table's sums for ${month}` },
      },
    ],
    answer: { month, made: true },
  };
}
