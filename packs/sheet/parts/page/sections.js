// The sections of an item's page that are not its fields or its note, as marks: its head, the choices a question
// settles by, where its facts came from, and its history (task e_qfdnex9w; from the host's item-sections.js). Each is
// a band under a short title, never a box in a box (rule e_vgs9vt5j).

import { ago, label } from './words.js';
import { counts, diffMarks } from './diff.js';

/** A section: its title, a count where it has one, what it holds. */
export const section = (key, title, n, ...content) =>
  ['box', { key: `section:${key}`, look: 'band', flow: 'column', gap: 2, pad: 2 }, ['box', { flow: 'row', gap: 2 }, ['text', { look: 'muted', size: 2, bold: true }, title.toUpperCase()], ...(n ? [['text', { look: 'muted', size: 2 }, String(n)]] : [])], ...content.filter(Boolean)];

/** A name and its value on one line. */
export const row = (name, value, tip) => ['box', { flow: 'row', gap: 3 }, ['text', { look: 'muted', ...(tip && { tip: String(tip).slice(0, 200) }) }, name], value];

/**
 * Its head, one line of marks under its title (decision e_x3h4vbe7): what it is, where it stands (a pick), how long
 * since it changed, who may see it (a pick), whose it is, and how sure, said only when not sure. When it was made and
 * changed in full are the age's tip.
 */
export function headMarks(item, type, { writes = false, now } = {}) {
  const statuses = [...(type.open ?? []), ...(type.closed ?? [])];
  const archived = Boolean(item.archived_at);
  const seen = item.private_to ? 'private' : item.visibility;
  const dot = ['text', { look: 'muted' }, '·'];
  const status = writes && !archived && statuses.length ? ['input', { key: 'head:status', kind: 'pick', values: statuses, value: item.status ?? '', tip: 'Status' }] : ['text', { look: 'mark' }, String(item.status ?? '—')];
  const visibility = writes && !archived && ['private', 'shared'].includes(seen) ? ['input', { key: 'head:visibility', kind: 'pick', values: ['private', 'shared'], value: seen, tip: 'Who can see it' }] : ['text', { look: 'muted', tip: 'Who can see it' }, String(seen ?? '—')];
  const when = `Made ${String(item.created_at ?? '').slice(0, 16).replace('T', ' ')}, changed ${String(item.updated_at ?? '').slice(0, 16).replace('T', ' ')}`;
  const parts = [
    ['text', { look: 'muted', tip: item.type }, type.title],
    status,
    ['text', { look: 'muted', tip: when }, archived ? `archived ${ago(item.archived_at, now)}` : ago(item.updated_at, now)],
    visibility,
    item.owner && ['text', { item: item.owner, look: 'mark', tip: 'Whose it is' }, item.owner_title ?? item.owner],
    typeof item.confidence === 'number' && item.confidence !== 1 && ['text', { look: 'muted', tip: 'How sure, 0 to 1' }, `${Math.round(item.confidence * 100)}% sure`],
  ].filter(Boolean);
  return ['box', { key: 'section:head', flow: 'row', gap: 4 }, ...parts.flatMap((m, i) => (i ? [dot, m] : [m]))];
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
  const kept = settles?.choices ? item.props?.[settles.choices] : undefined;
  // A choice is a few words, or { title, says }: its name, and a line on what it means.
  const name = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x.title ?? x.says) === 'string' ? x.title ?? x.says : null);
  if (!Array.isArray(kept) || !kept.length || !kept.every((x) => name(x) !== null)) return null;
  const says = kept.map((x) => (typeof x === 'object' && x.title && typeof x.says === 'string' ? x.says : undefined));
  return { field: settles.choices, chosen: settles.chosen, why: settles.why, on: settles.on, list: kept.map(name), says, picked: settles.chosen ? item.props?.[settles.chosen] : undefined };
}

/** The label a choice goes by, where it has one: "A" of "A: refresh the weights". */
const tag = (s) => /^\s*([A-Za-z0-9]{1,3})\s*[:.)]/.exec(s)?.[1]?.toLowerCase();

/** Whether a choice is the one its question was settled by: the same words, the start of them, or the same label. */
export const isChosen = (picked, choice) => {
  if (typeof picked !== 'string' || !picked.trim()) return false;
  const [p, x] = [picked.trim().toLowerCase(), choice.trim().toLowerCase()];
  return p === x || p.startsWith(x) || x.startsWith(p) || (tag(p) !== undefined && tag(p) === tag(x));
};

/** The choices, a row each, the one chosen marked; while it is open, a press on one asks to settle it by that. */
export function choicesMarks(item, c, { writes = false, asking } = {}) {
  const chosen = (x) => isChosen(c.picked, x);
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

/**
 * History: a change set a line, newest first, with who, what and when; each but a forget can be taken back. A change
 * to code says its counts, and pressed, its line diff under the line (`shown`: the change sets unfolded).
 */
export function historyMarks(events, { writes = false, names = {}, now, shown } = {}) {
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
    const diffs = g.events.flatMap((e) => e.detail?.diffs ?? []);
    const open = diffs.length > 0 && g.changeset && shown?.has(g.changeset);
    const headRow = ['box', { flow: 'row', gap: 2, ...(!diffs.length && { key: `set:${g.changeset ?? first.seq}` }) },
      ['text', { look: 'muted' }, who(first.actor)],
      ['text', { tip: String(said).slice(0, 200), ...(undone && { tone: 'closed' }) }, String(said)],
      ['text', { look: 'muted', tip: first.ts ?? '' }, ago(first.ts, now)],
      ...(diffs.length && g.changeset ? [['button', { key: `diff:${g.changeset}`, look: 'quiet', tip: open ? 'Fold the lines it changed' : 'See the lines it changed' }, `${counts(diffs)} ${open ? '▴' : '▾'}`]] : []),
      ...(writes && g.changeset && !undone && !forgot ? [['button', { key: `undo:${g.changeset}`, look: 'quiet', tip: 'Put back what it did, as a new change' }, 'Undo']] : [])];
    if (!diffs.length) return headRow;
    return ['box', { flow: 'column', gap: 1, key: `set:${g.changeset ?? first.seq}` }, headRow, ...(open ? [diffMarks(diffs)] : [])];
  };
  return section('history', 'History', sets.length, ['list', { look: 'rows' }, ...sets.map(line)]);
}
