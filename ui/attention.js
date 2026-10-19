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
    { class: 'row-top' },
    item.type && chip(item.type),
    h('span', { class: 'grow gist', title: item.title }, link(item)),
    item.top && h('a', { class: 'gist muted small', href: `#/e/${item.top.id}`, title: item.top.title }, item.top.title),
    item.reasons.map((r) => {
      const [said, tone, tip] = MARKS[r.why]?.(r) ?? [r.why, '', ''];
      return h('span', { class: `pill ${tone}`.trim(), title: tip }, said);
    }),
    latest && item.changed && h('span', { class: 'muted small nowrap' }, ago(item.changed)),
  );
}

/** A card of attention rows. On an item's page it is left out when nothing there needs anyone; on Home it says so. */
export async function attentionCard(host, params, title, onItem) {
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
    attentionCard(host, params, title, onItem);
  };
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
      answer.items.length ? h('ul', { class: 'rows' }, answer.items.map((item) => attentionRow(item, order === 'latest'))) : h('div', { class: 'empty' }, 'Nothing needs you.'),
      answer.more && h('div', { class: 'muted small', style: 'padding: 0 14px 12px' }, answer.more),
    ),
  );
}
