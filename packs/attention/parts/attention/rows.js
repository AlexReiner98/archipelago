// One line a thing that deserves attention, as marks: its reasons as marks with their tips, what it sits in at the
// top, muted. For you, read as the thing to do: its verb, what is asked, the item beside it. Pure: rows in, marks out.

/** Each reason as a mark: its words, its tone, and its tip. */
const REASONS = {
  waits_on: (r) => [`waits on ${r.who}`, 'warn', r.for ? `For: ${r.for}` : 'Waiting on them to answer or act'],
  to_confirm: (r) => ['to confirm', 'warn', `An agent settled it: ${r.answer ?? ''}${r.basis ? `\n${r.basis}` : ''}`],
  holding_up: (r) => [`holds up ${r.count}`, 'warn', 'Other work cannot move until this does'],
  due: (r) => (r.on ? [r.overdue ? `overdue ${r.on}` : `due ${r.on}`, r.overdue ? 'bad' : 'warn', 'By its due date'] : [`${r.value} of ${r.limit}`, 'warn', 'Under its limit']),
  moved: (r) => [`${r.title} moved`, 'warn', `${(r.moved ?? []).map((m) => `${m.field}: ${JSON.stringify(m.from)} → ${JSON.stringify(m.to)}`).join('\n')}${r.on ? `\n${String(r.on).slice(0, 10)}` : ''}`],
  unsettled: (r) => [r.by === 'evidence' ? 'to test' : 'to decide', undefined, r.by === 'evidence' ? 'Settled by evidence' : 'Settled by someone’s word'],
  blocked: (r) => ['blocked', 'closed', `Waiting on: ${(r.by ?? []).join(', ')}${r.held_by ? `, held by ${r.held_by.join(', ')}` : ''}`],
  stale: (r) => [`${r.days} d untouched`, 'closed', 'Nobody has changed it, or said it is still true'],
  under_way: (r) => ['under way', 'ok', `${r.sessions} session${r.sessions === 1 ? '' : 's'} on it`],
  ready: () => ['ready', 'ok', 'Nothing is in its way'],
};

/** A reason's words, tone and tip: the kernel's by REASONS, a pack's by its own words. */
export const reasonOf = (r) => REASONS[r.why]?.(r) ?? [r.mark ?? r.why, 'warn', r.tip ?? ''];

/** What is asked of you by each reason, strongest first: the verb, and what it is you do, when the map says. */
const ASKS = [
  ['to_confirm', (r) => ['Confirm', r.answer]],
  ['unsettled', (r) => [r.by === 'evidence' ? 'Test' : 'Decide']],
  ['waits_on', (r) => ['Do', r.for]],
  ['due', (r) => [r.overdue ? 'Overdue' : 'Due']],
  ['moved', (r) => ['Recheck', r.title]],
  ['holding_up', () => ['Unblock']],
];
const sentence = (text) => text && String(text).charAt(0).toUpperCase() + String(text).slice(1);
const cut = (s, most = 200) => String(s ?? '').slice(0, most);

/** What an item asks of you: the reason that asks first, its verb, and what you do, when the map says. */
export function askOf(item) {
  const own = item.reasons.find((r) => r.ask && !REASONS[r.why]);
  const [why, ask] = ASKS.find(([w]) => item.reasons.some((r) => r.why === w)) ?? (own ? [own.why, (r) => [r.ask]] : []);
  const [verb, said] = ask ? ask(item.reasons.find((r) => r.why === why)) : ['Look', undefined];
  return { why, verb: cut(verb, 40), said };
}

/** How long ago a time was, in a few letters. */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(at)) / 1000);
  if (!Number.isFinite(s)) return '';
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} m` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`;
}

const top = (item, most) => (item.top ? [['text', { item: item.top.id, look: 'muted', size: 2, tip: cut(item.top.title) }, cut(item.top.title, most)]] : []);
const changed = (item, latest) => (latest && item.changed ? [['text', { look: 'muted', size: 2 }, ago(item.changed)]] : []);

/** A row of what deserves attention: the item, what it sits in, and its reasons as marks. */
export function attentionRow(item, latest = false) {
  return [
    'box', { key: `a:${item.id}`, flow: 'row', gap: 4, align: 'between' },
    ['text', { item: item.id, look: 'body', tip: cut(item.title) }, cut(item.title)],
    ['box', { flow: 'row', gap: 4 },
      ...top(item, 40),
      ...item.reasons.map((r) => {
        const [said, tone, tip] = reasonOf(r);
        return ['text', { look: 'mark', ...(tone && { tone }), ...(tip && { tip: cut(tip) }) }, cut(said, 80)];
      }),
      ...changed(item, latest),
    ],
  ];
}

/** A row of what is yours to do: its verb (left out under its kind's line), what is asked, then the item and where it sits, muted. */
export function moveRow(item, latest = false, under = false) {
  const { why, verb, said } = askOf(item);
  const aside = said ? item.title : sentence(item.reasons.find((r) => r.why === 'waits_on')?.for);
  const tip = item.reasons.map((r) => reasonOf(r)[2]).filter(Boolean).join('\n');
  return [
    'box', { key: `m:${item.id}`, flow: 'row', gap: 4, align: 'between' },
    ['box', { flow: 'row', gap: 4 },
      ...(under ? [] : [['text', { look: 'mark', ...(['due', 'to_confirm'].includes(why) && { tone: 'warn' }), ...(tip && { tip: cut(tip) }) }, verb]]),
      ['text', { item: item.id, look: 'body', tip: cut(said ? `${sentence(said)}\n${item.title}` : item.title) }, cut(sentence(said) || item.title)],
    ],
    ['box', { flow: 'row', gap: 4 },
      ...(aside ? [['text', { look: 'muted', size: 2, tip: cut(aside) }, cut(aside, 50)]] : []),
      ...top(item, 30),
      ...changed(item, latest),
    ],
  ];
}

/** What is past the rows shown, as one line: how many, and the three projects most of it is in. */
export function overflow(rest) {
  const by = new Map();
  for (const item of rest) {
    const key = item.top?.id ?? '';
    by.set(key, { top: item.top, n: (by.get(key)?.n ?? 0) + 1 });
  }
  const groups = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  return ['box', { flow: 'row', gap: 4 },
    ['text', { look: 'muted', size: 2, tip: `and ${rest.length} more, in these and others` }, `+${rest.length}`],
    ...groups.map((g) => (g.top ? ['text', { item: g.top.id, look: 'muted', size: 2, tip: `${g.n} in ${cut(g.top.title)}` }, `${cut(g.top.title, 24)} ${g.n}`] : ['text', { look: 'muted', size: 2, tip: 'In no project' }, `elsewhere ${g.n}`])),
  ];
}

/** What is yours to do, a band for each verb in the order its first row comes. Every kind keeps a row in sight: the limit is shared out a row at a time. */
export function byKind(items, limit, latest) {
  const kinds = new Map();
  for (const item of items) {
    const { verb } = askOf(item);
    kinds.set(verb, [...(kinds.get(verb) ?? []), item]);
  }
  const groups = [...kinds].map(([verb, all]) => ({ verb, all, n: limit ? 1 : all.length }));
  for (let left = (limit ?? 0) - groups.length, grew = true; left > 0 && grew; ) {
    grew = false;
    for (const g of groups) if (left > 0 && g.n < g.all.length) (g.n++, left--, (grew = true));
  }
  return groups.map((g) => [
    'box', { look: 'band', flow: 'column', gap: 2 },
    ['box', { flow: 'row', gap: 3 }, ['text', { bold: true, size: 2 }, g.verb], ['text', { look: 'muted', size: 2 }, String(g.all.length)]],
    ['list', { look: 'rows' }, ...g.all.slice(0, g.n).map((item) => moveRow(item, latest, true))],
    ...(g.n < g.all.length ? [overflow(g.all.slice(g.n))] : []),
  ]);
}
