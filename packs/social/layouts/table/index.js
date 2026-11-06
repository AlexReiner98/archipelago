// The channels table: one row per channel per month, summed from the posts that went out on it that month, and the
// sources (tags no post has) as rows below. A row is its channel, its posts, visits, trials begun and paid, the
// conversations its posts began and the hours spent on them, two short bars with their share (visits to begun, begun
// to paid), and a dot for the bar the strategy sets (style.table.bar: so many conversations a month in under so many
// hours). A post's counts fall in the month it went out (`posted`); a conversation in the month it was had (its `began`,
// else when it was recorded); an hour in the month it was logged. A source's counts are undated, so its row is all of
// them. It reads the flat query's answer: posts and sources, the conversations linked came_out_of them and the time
// entries part_of them. Laid out by the page, not drawn to a size; its look is ./look.js.

import { css } from './look.js';
import { m } from './marks.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
/** A month as its key, from a date or a time: "2026-11". */
const monthOf = (v) => {
  if (!v) return null;
  const [y, mo] = String(v instanceof Date ? v.toISOString() : v).split('-');
  return y && mo ? `${y}-${mo}` : null;
};
const monthName = (key) => {
  const [y, mo] = key.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const hoursOf = (e) => {
  const f = e.fields ?? {};
  if (f.start && f.end) {
    const ms = new Date(f.end) - new Date(f.start);
    if (ms > 0) return ms / 36e5;
  }
  return num(f.hours);
};
const shownHours = (h) => String(Math.round(h * 10) / 10);
const shownShare = (s) => `${Math.round(s * 100)}%`;

/** A fresh sum. */
const zero = () => ({ posts: [], visits: 0, begun: 0, paid: 0, conversations: 0, hours: 0 });

/**
 * The sums, by channel and month, and by source. Pure: rows in, sums out (tested in social.table.test.ts).
 * `sourceType` is the type of a source item.
 */
export function sums(answer, sourceType) {
  const items = answer.items ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const counted = (i) => i.type === 'post' || i.type === sourceType;
  const months = new Map();
  const sources = new Map();
  const cell = (owner, month) => {
    if (owner.type === sourceType) {
      if (!sources.has(owner.id)) sources.set(owner.id, { item: owner, ...zero() });
      return sources.get(owner.id);
    }
    const channel = owner.fields?.channel;
    if (!channel || !month) return null;
    if (!months.has(month)) months.set(month, new Map());
    const row = months.get(month);
    if (!row.has(channel)) row.set(channel, { channel, ...zero() });
    return row.get(channel);
  };
  const posted = (i) => monthOf(i.fields?.posted);
  const linkedConversations = new Map();
  for (const i of items) {
    if (!counted(i)) continue;
    const f = i.fields ?? {};
    const c = cell(i, posted(i));
    if (!c) continue;
    if (i.type === 'post') c.posts.push(i);
    c.visits += num(f.visits);
    c.begun += num(f.begun);
    c.paid += num(f.paid);
  }
  for (const k of answer.links ?? []) {
    const from = byId.get(k.from), to = byId.get(k.to);
    if (!from || !to || !counted(to)) continue;
    if (k.type === 'came_out_of') {
      const c = cell(to, monthOf(from.fields?.began) ?? monthOf(from.fields?.date) ?? monthOf(from.created_at) ?? posted(to));
      if (c) c.conversations += 1;
      linkedConversations.set(to.id, (linkedConversations.get(to.id) ?? 0) + 1);
    } else if (k.type === 'part_of' && from.type === 'time_entry' && from.status !== 'void' && from.status !== 'planned') {
      const f = from.fields ?? {};
      const c = cell(to, monthOf(f.date) ?? monthOf(f.start) ?? posted(to));
      if (c) c.hours += hoursOf(from);
    }
  }
  // A post counted by hand before conversations were links keeps its count until it has a link of its own.
  for (const i of items) {
    if (!counted(i) || linkedConversations.has(i.id)) continue;
    const c = cell(i, i.type === 'post' ? posted(i) : null);
    if (c) c.conversations += num(i.fields?.conversations);
  }
  return {
    months: [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, rows]) => ({ month, rows: [...rows.values()].sort((a, b) => b.conversations - a.conversations || b.visits - a.visits || a.channel.localeCompare(b.channel)) })),
    sources: [...sources.values()].sort((a, b) => b.visits - a.visits || a.item.title.localeCompare(b.item.title)),
  };
}

/** The table. `style.table` says the source type, the channels' names and the bar. */
export function picture({ answer, style = {} }) {
  const said = style.table ?? {};
  const sourceType = typeof said.source_type === 'string' ? said.source_type : 'channel';
  const names = said.channel_names && typeof said.channel_names === 'object' ? said.channel_names : {};
  const bar = said.bar && typeof said.bar === 'object' ? { conversations: num(said.bar.conversations), hours: num(said.bar.hours) } : null;
  const { months, sources } = sums(answer, sourceType);
  if (!months.length && !sources.length) return { scene: { message: 'No posts have gone out yet.' } };

  const ratio = (key, part, whole, what) => {
    const share = whole > 0 ? Math.min(1, part / whole) : null;
    const tip = share === null ? `${what}: nothing yet` : `${what}: ${part} of ${whole}`;
    return m(
      'span',
      { class: 'tb-ratio', title: tip },
      m('svg', { class: 'tb-bar', viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, m('rect', { class: 'tb-track', x: 0, y: 0, width: 1, height: 1 }), share !== null && m('rect', { key, class: 'tb-fill', x: 0, y: 0, width: share, height: 1 })),
      m('span', { class: 'tb-share' }, share === null ? '–' : shownShare(share)),
    );
  };
  const meets = (r) => bar && r.conversations >= bar.conversations && r.hours < bar.hours;
  const mark = (r) =>
    bar
      ? m('span', { class: 'tb-mark', title: `${r.conversations} conversations in ${shownHours(r.hours)} h${meets(r) ? ': meets the bar' : ''}` }, m('svg', { class: `tb-dot ${meets(r) ? 'met' : 'short'}`, viewBox: '0 0 2 2', 'aria-hidden': 'true' }, m('circle', { cx: 1, cy: 1, r: 0.8 })))
      : m('span', { class: 'tb-mark' });
  const n = (v, title) => m('span', { class: 'tb-num', title }, String(v));
  const cells = (r, key) => [
    n(r.visits, 'Visits'),
    n(r.begun, 'Trials begun'),
    ratio(`vb:${key}`, r.begun, r.visits, 'Visits to begun'),
    n(r.paid, 'Paid'),
    ratio(`bp:${key}`, r.paid, r.begun, 'Begun to paid'),
    n(r.conversations, 'Conversations'),
    n(shownHours(r.hours), 'Hours'),
    mark(r),
  ];
  const channelRow = (month, r) => {
    const key = `c:${month}:${r.channel}`;
    const name = names[r.channel] ?? r.channel;
    return m(
      'div',
      { key, class: `tb-row${meets(r) ? ' met' : ''}` },
      m('span', { class: 'tb-name', title: [name, ...r.posts.map((p) => p.title)].join('\n') }, name),
      n(r.posts.length, r.posts.map((p) => p.title).join('\n') || 'Posts'),
      cells(r, key),
    );
  };
  const sourceRow = (s) => {
    const key = `s:${s.item.id}`;
    return m('a', { key, class: 'tb-row source', href: `#/e/${s.item.id}`, item: s.item.id }, m('span', { class: 'tb-name', title: s.item.title }, s.item.title), m('span', { class: 'tb-num' }), cells(s, key));
  };
  const heads = ['', 'Posts', 'Visits', 'Begun', '', 'Paid', '', 'Talks', 'Hours', ''];
  const tips = ['', 'Posts that went out', 'Visits under their tags', 'Trials begun', 'Visits to begun', 'Paid', 'Begun to paid', 'Conversations begun', 'Hours spent', 'The bar'];
  const head = m('div', { class: 'tb-row tb-head' }, heads.map((h, i) => m('span', { class: i ? 'tb-num' : 'tb-name', title: tips[i] || undefined }, h)));
  const stage = m(
    'div',
    { class: 'tb-stage' },
    head,
    months.map(({ month, rows }) => m('div', { key: `m:${month}`, class: 'tb-band' }, m('div', { class: 'tb-month' }, monthName(month)), rows.map((r) => channelRow(month, r)))),
    sources.length > 0 && m('div', { key: 'sources', class: 'tb-band' }, m('div', { class: 'tb-month' }, 'Sources'), sources.map(sourceRow)),
  );
  const key = bar
    ? [
        { glyph: m('svg', { class: 'tb-dot met', viewBox: '0 0 2 2' }, m('circle', { cx: 1, cy: 1, r: 0.8 })), label: `${bar.conversations} conversations a month in under ${bar.hours} hours` },
        { glyph: m('svg', { class: 'tb-dot short', viewBox: '0 0 2 2' }, m('circle', { cx: 1, cy: 1, r: 0.8 })), label: 'Short of it' },
      ]
    : [];
  return { scene: { css: css(said.narrow), svg: stage, key }, on: () => [] };
}
