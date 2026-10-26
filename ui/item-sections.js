// What an item holds, a section for each, as plain text under a heading: its head, its note, each field its type
// declares (empty ones too), where it came from, and its history. Nothing here is drawn from what it is tied to: the
// canvas shows that. A value that names an item is the way to it; every other value is said as it is kept.

import { h } from './base.js';
import { choicesOf, fieldValue } from './fields.js';
import { ago, changeRow, eventLine, label, link, statusesOf, typeTitle, types } from './words.js';

/** One section: a heading, a count where it has one, and what it holds. */
export const section = (key, title, n, ...content) => h('section', { class: 'page-section', 'data-section': key }, h('h2', {}, title, n ? h('span', { class: 'n' }, n) : ''), ...content);

/** Rows of a name and its value, each on one line. */
const rows = (list) => h('dl', { class: 'page-rows' }, list.map(([name, value, tip]) => [h('dt', { title: tip ?? '' }, name), h('dd', {}, value)]));
const none = () => h('span', { class: 'muted' }, '—');

/** Its head: what it is, where it stands, whose it is, who may see it, and when it was made and changed. */
export function headSection(e, owner, setStatus) {
  const type = types.get(e.type);
  const seen = e.private_to ? 'private' : e.visibility;
  return section(
    'head',
    'Head',
    0,
    rows([
      ['Type', typeTitle(e.type), e.type],
      ['Status', h('select', { class: 'mark-status', title: 'Status', disabled: Boolean(e.archived_at), onchange: (ev) => setStatus(ev.target.value) }, statusesOf(e.type).map((st) => h('option', { value: st, selected: st === e.status }, st)))],
      type?.columns?.owner && ['Owner', owner ? link(owner) : none()],
      ['Visibility', seen],
      type?.columns?.confidence && ['Confidence', String(e.confidence)],
      ['Created', ago(e.created_at)],
      ['Updated', ago(e.updated_at)],
      e.archived_at && ['Archived', ago(e.archived_at)],
    ].filter(Boolean)),
  );
}

/** Each field its type declares, named, empty or not, drawn by its kind (ui/fields.js); and any it holds that its type no longer declares. The choices it settles by have their own section. */
export function fieldsSection(e, style) {
  const declared = types.get(e.type)?.fields ?? {};
  const choices = choicesOf(e, types.get(e.type))?.field;
  const names = [...Object.keys(declared), ...Object.keys(e.props).filter((k) => !(k in declared))].filter((k) => k !== choices);
  if (!names.length) return null;
  return section('fields', 'Fields', 0, rows(names.map((k) => [label(k), fieldValue(e.props[k], declared[k], style), declared[k]?.description ?? 'Not declared by its type'])));
}

/**
 * The choices a question settles by, a row each: the one chosen marked. While it is open, picking one settles it
 * (`pick(choice)`): a change like any other, which the rules apply or hold.
 */
export function choicesSection(e, pick) {
  const c = choicesOf(e, types.get(e.type));
  if (!c) return null;
  const chosen = (x) => typeof c.picked === 'string' && (c.picked === x || c.picked.toLowerCase().startsWith(x.toLowerCase()));
  const open = e.is_open && !e.archived_at;
  return section(
    'choices',
    label(c.field),
    c.list.length,
    h(
      'ol',
      { class: 'choices' },
      c.list.map((x) =>
        h(
          'li',
          { class: chosen(x) ? 'choice chosen' : 'choice' },
          open
            ? h('button', { type: 'button', class: 'choice-pick', title: `Settle it: ${x}`, onclick: () => pick(x) }, h('span', { class: 'gist' }, x))
            : h('span', { class: 'gist', title: x }, x),
          chosen(x) && h('span', { class: 'pill ok' }, 'chosen'),
        ),
      ),
    ),
  );
}

/** Where its facts came from: the source the change that made it named. */
export function sourceSection(source) {
  const web = /^https?:[/][/]/i.test(source?.uri ?? '');
  return section(
    'source',
    'Source',
    0,
    source
      ? rows([
          ['Name', link(source)],
          ['Address', web ? h('a', { href: source.uri, target: '_blank', rel: 'noopener noreferrer', class: 'gist', title: source.uri }, source.uri) : h('span', { class: 'gist', title: source.uri }, source.uri)],
        ])
      : h('div', { class: 'muted' }, 'None given'),
  );
}

/** What happened to it, a change set a line, newest first. */
export function historySection(id, past) {
  const sets = [];
  for (const ev of past) {
    const last = sets.at(-1);
    if (ev.changeset && last?.changeset === ev.changeset) last.events.push(ev);
    else sets.push({ changeset: ev.changeset, events: [ev] });
  }
  const lines = sets.flatMap((g) => (g.changeset ? changeRow(g, { here: id }) : g.events.map(eventLine)));
  return section('history', 'History', lines.length, h('div', { class: 'page-lines' }, lines));
}
