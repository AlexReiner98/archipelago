// A field's value as the item page draws it (Rule 11): by the kind its type declares it as, and by its shape where the
// kind does not say, so a field no one foresaw, from a pack not yet written, is still read. Never by its name: what a
// field means beyond its kind is said by the capabilities its type declares, and how it looks by the style.

import { h } from './base.js';
import { ago, gist, idsAsLinks, label } from './words.js';

/** A field that holds an item's id, a day, an address on the web. */
const ID = /^e_[a-z0-9]{8}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEB = /^https?:\/\/\S+$/i;

const none = () => h('span', { class: 'muted' }, '—');
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v) => v === null || typeof v !== 'object';

/** A day as a person reads it; as it is kept is the tooltip. */
const day = (v) => {
  const [, y, m, d] = DAY.exec(v);
  return h('span', { class: 'gist', title: v }, new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(undefined, { dateStyle: 'medium' }));
};
/** An address on the web, by where it goes, opened apart. */
const address = (v) => h('a', { href: v, target: '_blank', rel: 'noopener noreferrer', class: 'gist', title: v }, v.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''));

/** One value with no parts, by its shape: an item's id as its name, a day, an address, a number, yes or no, words. */
function one(v, style) {
  if (v === null || v === undefined || v === '') return none();
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return h('span', { class: 'gist num' }, v.toLocaleString());
  const text = String(v);
  if (ID.test(text)) return idsAsLinks(text);
  if (DAY.test(text)) return day(text);
  if (WEB.test(text)) return address(text);
  return text.length > style.numbers.field_fold_at ? h('details', { class: 'long' }, h('summary', { title: text }, gist(text)), idsAsLinks(text)) : h('span', { class: 'gist', title: text }, idsAsLinks(text));
}

/** Parts on one line, each its own mark, cut where they do not fit; all of them the tooltip. */
const parts = (list, style) => h('span', { class: 'field-parts', title: list.map(String).join(', ') }, list.map((x) => h('span', { class: 'field-part' }, one(x, style))));

/** Something with parts, folded to a line that says what it holds. */
const folded = (what, inside) => h('details', { class: 'long' }, h('summary', { title: what }, what), inside);

/** A value by its shape: a list of plain values as its parts, rows of the same names as a table, a set of names as rows. */
function shaped(v, style) {
  if (scalar(v)) return one(v, style);
  if (Array.isArray(v)) {
    if (!v.length) return none();
    if (v.every(scalar)) return parts(v, style);
    if (v.every((row) => plain(row) && Object.values(row).every((x) => scalar(x) || (Array.isArray(x) && x.every(scalar))))) {
      const names = [...new Set(v.flatMap((row) => Object.keys(row)))];
      const cell = (x) => (Array.isArray(x) ? parts(x, style) : one(x, style));
      const table = h('table', { class: 'text-table field-table' }, h('thead', {}, h('tr', {}, names.map((n) => h('th', {}, label(n))))), h('tbody', {}, v.map((row) => h('tr', {}, names.map((n) => h('td', {}, cell(row[n])))))));
      return folded(`${v.length} ${v.length === 1 ? 'row' : 'rows'}`, table);
    }
  } else if (Object.values(v).every((x) => scalar(x) || (Array.isArray(x) && x.every(scalar)))) {
    const keys = Object.keys(v);
    if (!keys.length) return none();
    // A name that is a day is said as one.
    const name = (k) => (DAY.test(k) ? day(k).textContent : label(k));
    const rows = h('dl', { class: 'page-rows' }, keys.map((k) => [h('dt', { title: k }, name(k)), h('dd', {}, Array.isArray(v[k]) ? parts(v[k], style) : one(v[k], style))]));
    return folded(keys.map(name).join(', '), rows);
  }
  // Deeper than these, it is shown as it is kept.
  return folded(Array.isArray(v) ? `${v.length} entries` : Object.keys(v).map(label).join(', '), h('pre', { class: 'page-json' }, JSON.stringify(v, null, 1)));
}

/** A field's value, by the kind its type declares it as, else by its shape. `field` is its declaration, if it has one. */
export function fieldValue(v, field, style) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return none();
  if (field?.type === 'enum' && typeof v === 'string') return h('span', { class: 'pill field-pill', title: field.description ?? '' }, v.replaceAll('_', ' '));
  if (field?.type === 'datetime' && typeof v === 'string') return ago(v);
  if (field?.type === 'date' && typeof v === 'string' && DAY.test(v)) return day(v);
  if (field?.type === 'url' && typeof v === 'string' && WEB.test(v)) return address(v);
  return shaped(v, style);
}

/**
 * The choices a question settles by, when its type says (capability settles: choices, and chosen, the field that says
 * which was chosen): the list, and the one chosen. Null when it has none to pick from.
 */
export function choicesOf(e, type) {
  const settles = type?.capabilities?.settles;
  const list = settles?.choices ? e.props[settles.choices] : undefined;
  if (!Array.isArray(list) || !list.length || !list.every((x) => typeof x === 'string')) return null;
  return { field: settles.choices, chosen: settles.chosen, why: settles.why, list, picked: settles.chosen ? e.props[settles.chosen] : undefined };
}
