// A field changed where it stands (Rule 11): by the kind its type declares, else by the shape of what it holds, so a
// field from a pack not yet written is changed the day it ships. Never by its name. A pick (a value from a menu, a day,
// yes or no, an item) is a change the moment it is made; words (text, numbers, lists, rows) wait with the note for the
// page's one Save (the owner, 26 Oct 2026: decision "How is a field's change saved?").

import { api, h } from './base.js';
import { fieldValue } from './fields.js';
import { label } from './words.js';

const ID = /^e_[a-z0-9]{8}$/;
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v) => v === null || typeof v !== 'object';
const flat = (v) => scalar(v) || (Array.isArray(v) && v.every(scalar));

/** What was typed, kept the kind it was: a number stays a number, yes or no stays so, nothing is no value. */
function typed(text, was) {
  if (text.trim() === '') return null;
  if (typeof was === 'number' && Number.isFinite(Number(text))) return Number(text);
  if (typeof was === 'boolean' && /^(true|false)$/.test(text.trim())) return text.trim() === 'true';
  return text;
}

/** A time as the browser's own picker takes it, in the reader's zone. */
const local = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** A field whose kind is a pick: a menu of its values, a day, a time, yes or no. Null when its kind is not one. */
function picker(v, field, pick) {
  const tip = field?.description ?? '';
  if (field?.type === 'enum')
    return h('select', { class: 'field-pick', title: tip, onchange: (ev) => pick(ev.target.value || null) }, h('option', { value: '' }, '—'), (field.values ?? []).map((x) => h('option', { value: x, selected: x === v }, x.replaceAll('_', ' '))));
  if (field?.type === 'boolean') return h('input', { type: 'checkbox', class: 'field-switch', title: tip, checked: v === true, onchange: (ev) => pick(ev.target.checked) });
  if (field?.type === 'date') return h('input', { type: 'date', class: 'field-pick', title: tip, value: typeof v === 'string' ? v : '', onchange: (ev) => pick(ev.target.value || null) });
  if (field?.type === 'datetime')
    return h('input', { type: 'datetime-local', class: 'field-pick', title: tip, value: typeof v === 'string' ? local(v) : '', onchange: (ev) => pick(ev.target.value ? new Date(ev.target.value).toISOString() : null) });
  return null;
}

/** A field that names an item: the way to it, and another found by name, as the canvas's search finds one. */
function itemPicker(v, style, pick) {
  const box = h('span', { class: 'field-item' });
  const show = () => box.replaceChildren(h('span', { class: 'gist' }, fieldValue(v, null, style)), h('button', { type: 'button', class: 'quiet-button field-change', title: 'Name another item', onclick: find }, '✎'));
  function find() {
    const hits = h('span', { class: 'field-hits' });
    let turn = 0;
    const look = async () => {
      const mine = ++turn;
      const q = input.value.trim();
      const found = q ? await api('search', { q, limit: 6 }).catch(() => []) : [];
      if (mine !== turn) return;
      hits.replaceChildren(...found.filter((x) => !x.type.startsWith('sys.')).map((x) => h('button', { type: 'button', class: 'field-hit', title: x.title, onclick: () => pick(x.id) }, x.title)));
    };
    const input = h('input', { type: 'search', class: 'field-find', placeholder: 'Find an item', oninput: look, onkeydown: (ev) => ev.key === 'Escape' && show() });
    box.replaceChildren(input, hits);
    input.focus();
  }
  show();
  return box;
}

/** One box for a value with no parts: a line, or a box to write in where it is long or has lines of its own. */
function box(v, field, style, keep, save) {
  const text = v === null || v === undefined ? '' : String(v);
  const long = text.length > style.numbers.field_fold_at || text.includes('\n');
  const was = field?.type === 'number' ? 0 : v;
  if (long) {
    const area = h('textarea', { class: 'field-write', rows: 3, oninput: () => keep(typed(area.value, was)) });
    area.value = text;
    return area;
  }
  const kind = field?.type === 'number' ? 'number' : field?.type === 'url' ? 'url' : 'text';
  return h('input', { type: kind, class: 'field-write', value: text, oninput: (ev) => keep(typed(ev.target.value, was)), onkeydown: (ev) => ev.key === 'Enter' && (ev.preventDefault(), save()) });
}

/** A list of plain values: each written in place, × to take one out, + to add one. */
function listEditor(list, style, keep) {
  const now = [...list];
  const host = h('div', { class: 'field-list' });
  const draw = () => {
    host.replaceChildren(
      ...now.map((x, i) =>
        h(
          'div',
          { class: 'field-line' },
          h('input', { type: 'text', class: 'field-write', value: x ?? '', oninput: (ev) => ((now[i] = typed(ev.target.value, list[i]) ?? ''), keep([...now])) }),
          h('button', { type: 'button', class: 'quiet-button', title: 'Take it out', onclick: () => (now.splice(i, 1), keep([...now]), draw()) }, '×'),
        ),
      ),
      h('button', { type: 'button', class: 'quiet-button field-add', title: 'Add one', onclick: () => (now.push(''), draw(), host.querySelectorAll('input')[now.length - 1]?.focus()) }, '+'),
    );
  };
  draw();
  return host;
}

/** Rows of the same names: a table whose cells are written in place, + for a row, × to take one out. */
function rowsEditor(rows, keep) {
  const now = rows.map((r) => ({ ...r }));
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const host = h('div', { class: 'field-rows' });
  const cell = (r, n) => {
    const was = rows.find((x) => x[n] !== undefined && x[n] !== null)?.[n];
    const value = Array.isArray(r[n]) ? r[n].join(', ') : (r[n] ?? '');
    return h('input', { type: 'text', class: 'field-write', value, oninput: (ev) => ((r[n] = Array.isArray(was) ? ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) : typed(ev.target.value, was)), keep(now.map((x) => ({ ...x })))) });
  };
  const draw = () =>
    host.replaceChildren(
      h(
        'table',
        { class: 'text-table field-table' },
        h('thead', {}, h('tr', {}, names.map((n) => h('th', { title: n }, label(n))), h('th'))),
        h('tbody', {}, now.map((r, i) => h('tr', {}, names.map((n) => h('td', {}, cell(r, n))), h('td', {}, h('button', { type: 'button', class: 'quiet-button', title: 'Take the row out', onclick: () => (now.splice(i, 1), keep(now.map((x) => ({ ...x }))), draw()) }, '×'))))),
      ),
      h('button', { type: 'button', class: 'quiet-button field-add', title: 'Add a row', onclick: () => (now.push(Object.fromEntries(names.map((n) => [n, null]))), draw()) }, '+'),
    );
  draw();
  return host;
}

/** A set of names and plain values: each value written in place, × to take a name out, + for a new name. */
function namesEditor(set, keep) {
  const now = Object.entries(set).map(([k, v]) => [k, v]);
  const host = h('div', { class: 'field-names' });
  const out = () => keep(Object.fromEntries(now.filter(([k]) => k.trim())));
  const draw = () =>
    host.replaceChildren(
      ...now.map((pair, i) =>
        h(
          'div',
          { class: 'field-line' },
          pair[0] in set ? h('span', { class: 'field-name', title: pair[0] }, label(pair[0])) : h('input', { type: 'text', class: 'field-write field-name', placeholder: 'Name', oninput: (ev) => ((pair[0] = ev.target.value.trim()), out()) }),
          h('input', { type: 'text', class: 'field-write', value: Array.isArray(pair[1]) ? pair[1].join(', ') : (pair[1] ?? ''), oninput: (ev) => ((pair[1] = Array.isArray(set[pair[0]]) ? ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) : typed(ev.target.value, set[pair[0]])), out()) }),
          h('button', { type: 'button', class: 'quiet-button', title: 'Take it out', onclick: () => (now.splice(i, 1), out(), draw()) }, '×'),
        ),
      ),
      h('button', { type: 'button', class: 'quiet-button field-add', title: 'Add a name', onclick: () => (now.push(['', '']), draw()) }, '+'),
    );
  draw();
  return host;
}

/** Anything deeper, or a field of any shape that holds nothing yet: what it holds as JSON, checked as it is written. */
function jsonEditor(v, keep) {
  const area = h('textarea', { class: 'field-write field-json', rows: 4, placeholder: 'JSON, like ["one", "two"]' });
  area.value = v === undefined || v === null ? '' : JSON.stringify(v, null, 1);
  area.addEventListener('input', () => {
    if (!area.value.trim()) return area.classList.remove('bad'), keep(null);
    try {
      keep(JSON.parse(area.value));
      area.classList.remove('bad');
    } catch {
      area.classList.add('bad');
      keep(undefined, 'Not valid JSON');
    }
  });
  return area;
}

/** The editor for words by their shape: a list, rows, a set of names, deeper JSON, or one box. */
export function wordsEditor(v, field, style, keep, save, { list = false } = {}) {
  if (list || (Array.isArray(v) && v.every(scalar))) return listEditor(Array.isArray(v) ? v : [], style, keep);
  if (Array.isArray(v) && v.length && v.every((r) => plain(r) && Object.values(r).every(flat))) return rowsEditor(v, keep);
  if (plain(v) && Object.values(v).every(flat)) return namesEditor(v, keep);
  if (field?.type === 'json' || !scalar(v)) return jsonEditor(v, keep);
  return box(v, field, style, keep, save);
}

/**
 * A field as it reads, changed where it stands. `pick(value)` makes a change at once; `keep(value, bad)` holds words
 * for the page's Save, and `save()` asks for it (Enter in a line). Not `editable`: only read. `list`: a list whatever
 * it holds now (the choices a question settles by).
 */
export function fieldEditor(v, field, { style, editable, pick, keep, save, list = false }) {
  if (!editable) return fieldValue(v, field, style);
  const now = picker(v, field, pick);
  if (now) return now;
  if (typeof v === 'string' && ID.test(v)) return itemPicker(v, style, pick);
  // Words read as they are until clicked, so the page is not a form: then they are written in place.
  const read = h('span', { class: 'field-read', title: 'Click to change' }, fieldValue(v, field, style));
  read.addEventListener('click', (ev) => {
    if (ev.target.closest('a, summary')) return;
    const editor = wordsEditor(v, field, style, keep, save, { list });
    read.replaceWith(editor);
    editor.matches('input, textarea') ? editor.focus() : editor.querySelector('input')?.focus();
  });
  return read;
}
