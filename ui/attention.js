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
      const [said, tone, tip] = mark(r);
      return h('span', { class: `pill ${tone}`.trim(), title: tip, style: 'flex: none' }, said);
    }),
    latest && item.changed && h('span', { class: 'muted small nowrap' }, ago(item.changed)),
  );
}

/** A reason's mark: the kernel's by MARKS, a pack's by its own words. */
const mark = (r) => MARKS[r.why]?.(r) ?? [r.mark ?? r.why, 'warn', r.tip ?? ''];

/** What is asked of you by each reason, strongest first: the verb, and what it is you do, when the map says. */
const ASKS = [
  ['to_confirm', (r) => ['Confirm', r.answer]],
  // An open question is itself the ask: its title says what to decide.
  ['unsettled', (r) => [r.by === 'evidence' ? 'Test' : 'Decide']],
  ['waits_on', (r) => ['Do', r.for]],
  ['due', (r) => [r.overdue ? 'Overdue' : 'Due']],
  ['holding_up', () => ['Unblock']],
];
const sentence = (text) => text && text.charAt(0).toUpperCase() + text.slice(1);

/** A row of what is yours to do, read as the thing to do: its verb, what is asked (or the item, when nothing more is said), then the item and where it sits, muted. */
export function moveRow(item, latest = false) {
  // A pack's reason says its own verb (ask) when no reason of the kernel's asks first.
  const own = item.reasons.find((r) => r.ask && !MARKS[r.why]);
  const [why, ask] = ASKS.find(([w]) => item.reasons.some((r) => r.why === w)) ?? (own ? [own.why, (r) => [r.ask]] : []);
  const [verb, said] = ask ? ask(item.reasons.find((r) => r.why === why)) : ['Look', undefined];
  const cut = 'min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis';
  // Beside it, muted: the item, when the ask is not its title; else what it waits on you for.
  const aside = said ? item.title : sentence(item.reasons.find((r) => r.why === 'waits_on')?.for);
  return h(
    'li',
    { class: 'row-top', style: 'flex-wrap: nowrap' },
    h('span', { class: `pill ${why === 'due' || why === 'to_confirm' ? 'warn' : ''}`.trim(), style: 'flex: none', title: item.reasons.map((r) => mark(r)[2]).filter(Boolean).join('\n') }, verb),
    h('a', { class: 'grow', href: `#/e/${item.id}`, title: said ? `${sentence(said)}\n${item.title}` : item.title, style: cut }, sentence(said) || item.title),
    aside && h('span', { class: 'muted small', title: aside, style: `${cut}; max-width: 35%; flex-shrink: 2` }, aside),
    item.top && h('a', { class: 'muted small', href: `#/e/${item.top.id}`, title: item.top.title, style: `${cut}; max-width: 20%; flex-shrink: 3` }, item.top.title),
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
    { class: 'row-top muted small overflow', style: 'padding: 0 var(--space-8) var(--space-7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis' },
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
      { class: 'card wide needs', style: 'margin-bottom: var(--space-8)' },
      h(
        'header',
        {},
        h('h2', {}, title),
        answer.items.length > 0 && h('span', { class: 'n' }, answer.items.length),
        answer.items.length > 1 && h('span', { class: 'switch', style: 'margin-left: auto' }, orders.map(([key, label, tip]) => h('button', { class: order === key ? 'on' : '', title: tip, onclick: pick(key) }, label))),
      ),
      answer.items.length ? h('ul', { class: 'rows' }, shown.map((item) => (params.person === 'me' ? moveRow : attentionRow)(item, order === 'latest'))) : h('div', { class: 'empty' }, 'Nothing needs you.'),
      shown.length < answer.items.length && overflow(answer.items.slice(shown.length)),
      answer.more && h('div', { class: 'muted small', style: 'padding: 0 var(--space-8) var(--space-7)' }, answer.more),
    ),
  );
}
