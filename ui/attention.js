// Attention as the page draws it: one line for each thing that deserves it, its reasons as marks, and what it sits in
// at the top, muted. The same rows on Home, for you, and on an item's page, for what is that item's.

import { api, h } from './base.js';
import { ago, chip, link } from './words.js';

/** The order Needs you is read in, kept for this browser: the strongest reason first, or the latest change first. */
const ORDER_KEY = 'pelago-needs-order';
const savedOrder = () => {
  try {
    return localStorage.getItem(ORDER_KEY) === 'latest' ? 'latest' : 'pressing';
  } catch {
    return 'pressing';
  }
};

/** Each reason as a mark: its words, how loud, and what its tooltip says. */
const MARKS = {
  waits_on: (r) => [`waits on ${r.who}`, 'warn', r.for ? `For: ${r.for}` : 'Waiting on them to answer or act'],
  to_confirm: (r) => ['to confirm', 'warn', `An agent settled it: ${r.answer ?? ''}${r.basis ? `\n${r.basis}` : ''}`],
  holding_up: (r) => [`holds up ${r.count}`, 'warn', 'Other work cannot move until this does'],
  due: (r) => (r.on ? [r.overdue ? `overdue ${r.on}` : `due ${r.on}`, r.overdue ? 'bad' : 'warn', 'By its due date'] : [`${r.value} of ${r.limit}`, 'warn', 'Under its limit']),
  unsettled: (r) => [r.by === 'evidence' ? 'to test' : 'to decide', '', r.by === 'evidence' ? 'Settled by evidence' : 'Settled by someone’s word'],
  blocked: (r) => ['blocked', 'closed', `Waiting on: ${(r.by ?? []).join(', ')}${r.held_by ? `, held by ${r.held_by.join(', ')}` : ''}`],
  stale: (r) => [`${r.days} d untouched`, 'closed', 'Nobody has changed it, or said it is still true'],
  under_way: (r) => ['under way', 'ok', `${r.sessions} session${r.sessions === 1 ? '' : 's'} on it`],
  ready: () => ['ready', 'ok', 'Nothing is in its way'],
};

export function attentionRow(item, latest = false) {
  return h(
    'li',
    // One line at any width: the title gives way first, then what it sits in; the marks keep their size.
    { class: 'row-top', style: 'flex-wrap: nowrap' },
    item.type && chip(item.type),
    h('span', { class: 'grow gist', title: item.title, style: 'min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis' }, link(item)),
    item.top && h('a', { class: 'gist muted small', href: `#/e/${item.top.id}`, title: item.top.title, style: 'min-width: 0; max-width: 25%; flex-shrink: 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis' }, item.top.title),
    item.reasons.map((r) => {
      const [said, tone, tip] = MARKS[r.why]?.(r) ?? [r.why, '', ''];
      return h('span', { class: `pill ${tone}`.trim(), title: tip, style: 'flex: none' }, said);
    }),
    latest && item.changed && h('span', { class: 'muted small nowrap' }, ago(item.changed)),
  );
}

/** What is past the rows shown, as one line: how many, and in which projects, each a way to it. */
function overflow(rest) {
  const by = new Map();
  for (const item of rest) {
    const key = item.top?.id ?? '';
    by.set(key, { top: item.top, n: (by.get(key)?.n ?? 0) + 1 });
  }
  const groups = [...by.values()].sort((a, b) => b.n - a.n);
  return h(
    'div',
    { class: 'row-top muted small overflow', style: 'padding: 0 14px 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis' },
    `and ${rest.length} more:`,
    groups.map((g) => (g.top ? h('a', { href: `#/e/${g.top.id}`, title: `${g.n} in ${g.top.title}` }, `${g.top.title} ${g.n}`) : h('span', { title: 'In no project' }, `elsewhere ${g.n}`))),
  );
}

/** A card of attention rows. On an item's page it is left out when nothing there needs anyone; on Home it says so. Given a limit, the rest are one line. */
export async function attentionCard(host, params, title, onItem, limit) {
  const order = savedOrder();
  const answer = await api('view', { name: 'attention', params: { ...params, ...(order === 'latest' && { order }) } });
  if (!host.isConnected) return;
  if (!answer.items.length && onItem) return host.remove();
  const pick = (to) => () => {
    try {
      localStorage.setItem(ORDER_KEY, to);
    } catch {
      // Without storage the order holds until the page is drawn again.
    }
    attentionCard(host, params, title, onItem, limit);
  };
  const shown = limit ? answer.items.slice(0, limit) : answer.items;
  const orders = [['pressing', 'Pressing', 'What matters most first'], ['latest', 'Latest', 'What changed most recently first']];
  host.replaceChildren(
    h(
      'section',
      { class: 'card wide needs', style: 'margin-bottom: 14px' },
      h(
        'header',
        {},
        h('h2', {}, title),
        answer.items.length > 0 && h('span', { class: 'n' }, answer.items.length),
        answer.items.length > 1 && h('span', { class: 'switch', style: 'margin-left: auto' }, orders.map(([key, label, tip]) => h('button', { class: order === key ? 'on' : '', title: tip, onclick: pick(key) }, label))),
      ),
      answer.items.length ? h('ul', { class: 'rows' }, shown.map((item) => attentionRow(item, order === 'latest'))) : h('div', { class: 'empty' }, 'Nothing needs you.'),
      shown.length < answer.items.length && overflow(answer.items.slice(shown.length)),
      answer.more && h('div', { class: 'muted small', style: 'padding: 0 14px 12px' }, answer.more),
    ),
  );
}
