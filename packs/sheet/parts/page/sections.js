// The sections of an item's page that are not its fields or its note, as marks: its head, the choices a question
// settles by, where its facts came from, and its history (task e_qfdnex9w; from the host's item-sections.js). Each is
// a band under a short title, never a box in a box (rule e_vgs9vt5j).

import { ago, label } from './words.js';

/** A section: its title, a count where it has one, what it holds. */
export const section = (key, title, n, ...content) =>
  ['box', { key: `section:${key}`, look: 'band', flow: 'column', gap: 2, pad: 2 }, ['box', { flow: 'row', gap: 2 }, ['text', { look: 'muted', size: 2, bold: true }, title.toUpperCase()], ...(n ? [['text', { look: 'muted', size: 2 }, String(n)]] : [])], ...content.filter(Boolean)];

/** A name and its value on one line. */
export const row = (name, value, tip) => ['box', { flow: 'row', gap: 3 }, ['text', { look: 'muted', ...(tip && { tip: String(tip).slice(0, 200) }) }, name], value];

/** Its head: what it is, where it stands, whose it is, who may see it, when it was made and changed. */
export function headMarks(item, type, { writes = false, now } = {}) {
  const statuses = [...(type.open ?? []), ...(type.closed ?? [])];
  const archived = Boolean(item.archived_at);
  const seen = item.private_to ? 'private' : item.visibility;
  const status = writes && !archived && statuses.length ? ['input', { key: 'head:status', kind: 'pick', values: statuses, value: item.status ?? '', tip: 'Status' }] : ['text', { look: 'mark' }, String(item.status ?? '—')];
  const visibility = writes && !archived && ['private', 'shared'].includes(seen) ? ['input', { key: 'head:visibility', kind: 'pick', values: ['private', 'shared'], value: seen, tip: 'Who can see it' }] : ['text', {}, String(seen ?? '—')];
  return section('head', 'Head', 0,
    row('Type', ['text', { tip: item.type }, type.title]),
    row('Status', status),
    item.owner !== undefined && row('Owner', item.owner ? ['text', { item: item.owner, look: 'mark' }, item.owner_title ?? item.owner] : ['text', { look: 'muted' }, '—']),
    row('Visibility', visibility),
    typeof item.confidence === 'number' && row('Confidence', ['text', {}, String(item.confidence)]),
    row('Created', ['text', { tip: item.created_at ?? '' }, ago(item.created_at, now)]),
    row('Updated', ['text', { tip: item.updated_at ?? '' }, ago(item.updated_at, now)]),
    archived && row('Archived', ['text', { tip: item.archived_at }, ago(item.archived_at, now)]));
}

/** What a gesture on the head comes to: a change of its status or of who may see it, or null. */
export function headEvent(event, item) {
  if (event?.name !== 'pick') return null;
  if (event.key === 'head:status' && event.value && event.value !== item.status) return { ops: [{ op: 'update', id: item.id, status: String(event.value) }], reason: `Status set to ${event.value} in the UI` };
  if (event.key === 'head:visibility' && ['private', 'shared'].includes(event.value)) return { ops: [{ op: 'update', id: item.id, visibility: event.value }], reason: `Visibility set to ${event.value} in the UI` };
  return null;
}

/** The choices a question settles by (its type's capability settles), or null when it has none to pick from. */
export function choicesOf(item, type) {
  const settles = type?.capabilities?.settles;
  const list = settles?.choices ? item.props?.[settles.choices] : undefined;
  if (!Array.isArray(list) || !list.length || !list.every((x) => typeof x === 'string')) return null;
  return { field: settles.choices, chosen: settles.chosen, why: settles.why, on: settles.on, list, picked: settles.chosen ? item.props?.[settles.chosen] : undefined };
}

/** The choices, a row each, the one chosen marked; while it is open, a press on one asks to settle it by that. */
export function choicesMarks(item, c, { writes = false, asking } = {}) {
  const chosen = (x) => typeof c.picked === 'string' && (c.picked === x || c.picked.toLowerCase().startsWith(x.toLowerCase()));
  const open = writes && item.is_open !== false && !item.archived_at;
  return section('choices', label(c.field), c.list.length,
    ['list', { look: 'rows' }, ...c.list.map((x, i) =>
      ['box', { flow: 'row', gap: 2 },
        open ? ['button', { key: `choice:${i}`, look: 'quiet', tip: `Settle it: ${x}`.slice(0, 200) }, x] : ['text', { tip: x.slice(0, 200) }, x],
        ...(chosen(x) ? [['text', { look: 'mark', tone: 'ok' }, 'chosen']] : [])])],
    asking !== undefined && ['box', { flow: 'column', gap: 1, look: 'sunk', pad: 2 },
      ['text', {}, `Settle it: ${c.list[asking]}`],
      ...(c.why ? [['input', { key: 'choice-why', kind: 'text', hint: 'Why? (optional)', grow: true, focus: true }]] : []),
      ['box', { flow: 'row', gap: 2 }, ['button', { key: 'choice-settle', look: 'main' }, 'Settle it'], ['button', { key: 'choice-cancel', look: 'quiet' }, 'Cancel']]]);
}

/** Settling by a choice: what was chosen, why if said, the day where its type keeps one, and its first closed status. */
export function settleOps(item, type, c, choice, why, today) {
  const props = { ...(c.chosen && { [c.chosen]: choice }), ...(c.why && why && why.trim() && { [c.why]: why.trim() }), ...(c.on && { [c.on]: today }) };
  return { ops: [{ op: 'update', id: item.id, ...(type.closed?.[0] && { status: type.closed[0] }), props }], reason: `Settled in the UI: ${choice}` };
}

/** Where its facts came from: the source the change that made it named. */
export function sourceMarks(source) {
  if (!source?.uri) return section('source', 'Source', 0, ['text', { look: 'muted' }, 'None given']);
  const web = /^https?:\/\//i.test(source.uri);
  return section('source', 'Source', 0,
    source.title && row('Name', ['text', { ...(source.id && { item: source.id }) }, source.title]),
    row('Address', ['text', { tip: source.uri.slice(0, 200), ...(web && { href: source.uri }) }, source.uri]));
}

/** History: a change set a line, newest first, with who, what and when; each but a forget can be taken back. */
export function historyMarks(events, { writes = false, names = {}, now } = {}) {
  const sets = [];
  for (const ev of events ?? []) {
    const last = sets.at(-1);
    if (ev.changeset && last?.changeset === ev.changeset) last.events.push(ev);
    else sets.push({ changeset: ev.changeset, events: [ev] });
  }
  const who = (a) => names[a] ?? (a?.startsWith('agent:') ? a.slice(6) : a?.startsWith('human:') ? 'You' : (a ?? '?'));
  const line = (g) => {
    const first = g.events[0];
    const said = first.reason ?? first.target_title ?? label(String(first.action ?? '').replace(/^\w+\./, ''));
    const undone = g.events.some((e) => e.detail?.undone_by);
    const forgot = g.events.some((e) => e.detail?.forgot);
    return ['box', { flow: 'row', gap: 2, key: `set:${g.changeset ?? first.seq}` },
      ['text', { look: 'muted' }, who(first.actor)],
      ['text', { tip: String(said).slice(0, 200), ...(undone && { tone: 'closed' }) }, String(said)],
      ['text', { look: 'muted', tip: first.ts ?? '' }, ago(first.ts, now)],
      ...(writes && g.changeset && !undone && !forgot ? [['button', { key: `undo:${g.changeset}`, look: 'quiet', tip: 'Put back what it did, as a new change' }, 'Undo']] : [])];
  };
  return section('history', 'History', sets.length, ['list', { look: 'rows' }, ...sets.map(line)]);
}
