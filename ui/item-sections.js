// What an item holds, a section for each, as plain text under a heading: its head, its note, each field its type
// declares (empty ones too), where it came from, and its history. Nothing here is drawn from what it is tied to: the
// canvas shows that. A value that names an item is the way to it; every other value is said as it is kept.

import { h } from './base.js';
import { ago, changeRow, eventLine, gist, idsAsLinks, label, link, statusesOf, typeTitle, types } from './words.js';

/** A field that holds an item's id. */
const ID = /^e_[a-z0-9]{8}$/;

/** One section: a heading, a count where it has one, and what it holds. */
export const section = (key, title, n, ...content) => h('section', { class: 'page-section', 'data-section': key }, h('h2', {}, title, n ? h('span', { class: 'n' }, n) : ''), ...content);

/** Rows of a name and its value, each on one line. */
const rows = (list) => h('dl', { class: 'page-rows' }, list.map(([name, value, tip]) => [h('dt', { title: tip ?? '' }, name), h('dd', {}, value)]));
const none = () => h('span', { class: 'muted' }, '—');

/** A value as it is kept: an id as the item's name, a list as its parts, a long text folded to its first clause. */
function value(v, field, style) {
  if (v === null || v === undefined || v === '') return none();
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (field?.type === 'datetime' && typeof v === 'string') return ago(v);
  if (typeof v === 'string' && ID.test(v)) return idsAsLinks(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) return h('span', { class: 'gist', title: v.join(', ') }, v.join(', '));
  if (typeof v === 'object') {
    const text = JSON.stringify(v, null, 1);
    const what = Array.isArray(v) ? `${v.length} entr${v.length === 1 ? 'y' : 'ies'}` : Object.keys(v).join(', ');
    return h('details', { class: 'long' }, h('summary', { title: what }, what), h('pre', { class: 'page-json' }, text));
  }
  const text = String(v);
  return text.length > style.numbers.field_fold_at ? h('details', { class: 'long' }, h('summary', { title: text }, gist(text)), idsAsLinks(text)) : h('span', { class: 'gist', title: text }, idsAsLinks(text));
}

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

/** Each field its type declares, named, empty or not; and any it holds that its type no longer declares. */
export function fieldsSection(e, style) {
  const declared = types.get(e.type)?.fields ?? {};
  const names = [...Object.keys(declared), ...Object.keys(e.props).filter((k) => !(k in declared))];
  if (!names.length) return null;
  return section('fields', 'Fields', 0, rows(names.map((k) => [label(k), value(e.props[k], declared[k], style), declared[k]?.description ?? 'Not declared by its type'])));
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
