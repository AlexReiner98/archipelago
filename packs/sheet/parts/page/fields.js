// An item's fields on its page, as marks (task e_kmma4t5n; from the host's fields.js and field-edit.js). A field is
// drawn by the kind its type declares, else by the shape of what it holds, never by its name, so a field from a pack
// not yet written is read and changed the day it ships. A pick (one of its values, a day, yes or no, an item) is a
// change at once; words wait with the note for the page's one Save (the owner, 26 Oct 2026).
//
// Keys: `field:<name>` its input, `field-open:<name>` a press that opens words to write, `field:<name>:<i>` one entry
// of a list, `field-out:<name>:<i>` and `field-add:<name>` take one out and add one, `field-fold:<name>` opens what
// has parts, `fields-empty` the fold of the fields that hold nothing.

import { ago, label } from './words.js';
import { langOf, modulesOf } from './code.js';

const ID = /^e_[a-z0-9]{8}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const WEB = /^https?:\/\/\S+$/i;
/** A field's name, as a key may carry it. */
const NAME = /^[A-Za-z0-9_.-]{1,60}$/;

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v) => v === null || typeof v !== 'object';

/** Whether a field holds nothing: the page puts those last, folded. */
export const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (plain(v) && !Object.keys(v).length);

const none = () => ['text', { look: 'muted' }, '—'];
/** Words on one line, the whole of them the tip. */
const line = (s, at = {}) => ['text', { tip: String(s).slice(0, 200), ...at }, String(s)];

/** The names of the items the fields name, by id, as the frame told them: an item is said by its name, never its id. */
let titled = {};

/** One value with no parts, by its shape: an item, a day, an address, a number, yes or no, words. */
export function one(v, { fold = 80 } = {}) {
  if (v === null || v === undefined || v === '') return none();
  if (typeof v === 'boolean') return ['text', {}, v ? 'yes' : 'no'];
  if (typeof v === 'number') return ['text', {}, v.toLocaleString()];
  const s = String(v);
  if (ID.test(s)) return ['text', { item: s, look: 'mark', tip: s }, titled[s] ?? 'an item'];
  if (DAY.test(s) && s.length <= 30) return ['text', { tip: s }, s.slice(0, 10)];
  if (WEB.test(s)) return ['text', { href: s, tip: s.slice(0, 200) }, s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')];
  return s.length > fold ? line(`${s.slice(0, fold)}…`, { tip: s.slice(0, 200) }) : line(s);
}

/** What a value with parts says, folded to one line. */
function summary(v) {
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'row' : 'rows'}`;
  return Object.keys(v).map(label).join(', ');
}

/** A value with parts, open: a list's entries side by side, rows one under another, names with their values. */
function opened(v) {
  if (Array.isArray(v) && v.every(scalar)) return ['box', { flow: 'row', gap: 2, wrap: true }, ...v.map((x) => one(x))];
  if (Array.isArray(v)) return ['list', { look: 'rows' }, ...v.map((row) => (plain(row) ? ['box', { flow: 'row', gap: 3 }, ...Object.entries(row).map(([k, x]) => ['text', { tip: label(k) }, scalar(x) ? String(x ?? '—') : JSON.stringify(x)])] : one(JSON.stringify(row))))];
  return ['list', {}, ...Object.entries(v).map(([k, x]) => ['box', { flow: 'row', gap: 3 }, ['text', { look: 'muted' }, label(k)], scalar(x) ? one(x) : ['text', { look: 'code' }, JSON.stringify(x)]])];
}

/** Code: its count of lines, a press away from the whole of it. */
function code(name, v, open) {
  const text = typeof v === 'string' ? v : Object.entries(v).map(([k, x]) => `// ${k}\n${x}`).join('\n\n');
  const lines = text.split('\n').length;
  return open
    ? ['box', { flow: 'column', gap: 1 }, ['button', { key: `field-fold:${name}`, look: 'quiet', tip: 'Fold it' }, `${lines.toLocaleString()} lines`], ['text', { look: 'code' }, text]]
    : ['button', { key: `field-fold:${name}`, look: 'quiet', tip: 'Open it' }, `${lines.toLocaleString()} lines`];
}

/** A field's value as it reads, by its declared kind, else its shape. `open`: what has parts is shown whole. */
export function valueMarks(name, v, field, { open = false, fold } = {}) {
  if (empty(v)) return none();
  if (field?.code && (typeof v === 'string' || (plain(v) && Object.values(v).every((x) => typeof x === 'string')))) return code(name, v, open);
  if (field?.type === 'enum' && typeof v === 'string') return ['text', { look: 'mark', ...(field.description && { tip: String(field.description).slice(0, 200) }) }, v.replaceAll('_', ' ')];
  if (field?.type === 'datetime' && typeof v === 'string') return ['text', { tip: v }, ago(v)];
  if (scalar(v)) return one(v, { fold });
  if (Array.isArray(v) && v.every(scalar) && v.length <= 6) return opened(v);
  return open ? ['box', { flow: 'column', gap: 1 }, ['button', { key: `field-fold:${name}`, look: 'quiet', tip: 'Fold it' }, summary(v)], opened(v)] : ['button', { key: `field-fold:${name}`, look: 'quiet', tip: 'Open it' }, summary(v)];
}

/** A field whose kind is a pick: its input, or null when its kind is not one. */
function picker(name, v, field) {
  const tip = field?.description ? String(field.description).slice(0, 200) : undefined;
  const at = { key: `field:${name}`, ...(tip && { tip }) };
  if (field?.type === 'enum') {
    const values = ['', ...(field.values ?? []).map(String)];
    return ['input', { ...at, kind: 'pick', values, names: values.map((x) => (x ? x.replaceAll('_', ' ') : '—')), value: typeof v === 'string' ? v : '' }];
  }
  if (field?.type === 'boolean') return ['input', { ...at, kind: 'check', value: v === true ? 'true' : 'false' }];
  if (field?.type === 'date') return ['input', { ...at, kind: 'date', value: typeof v === 'string' ? v.slice(0, 10) : '' }];
  if (field?.type === 'datetime') return ['input', { ...at, kind: 'time', value: typeof v === 'string' ? v.slice(0, 16) : '' }];
  return null;
}

/** What was typed, kept the kind it was: a number stays a number, yes or no stays so, nothing is no value. */
export function typed(text, was) {
  const s = String(text ?? '');
  if (s.trim() === '') return null;
  if (typeof was === 'number' && Number.isFinite(Number(s))) return Number(s);
  if (typeof was === 'boolean' && /^(true|false)$/.test(s.trim())) return s.trim() === 'true';
  return s;
}

/** Words to write, by the shape of what the field holds: a list an entry each, deeper a box of JSON, else one box. */
function writer(name, v, field, { fold = 80 } = {}) {
  if (Array.isArray(v) && v.every(scalar)) {
    return ['box', { flow: 'column', gap: 1 },
      ...v.map((x, i) => ['box', { flow: 'row', gap: 1 }, ['input', { key: `field:${name}:${i}`, kind: 'text', value: x === null ? '' : String(x), grow: true }], ['button', { key: `field-out:${name}:${i}`, look: 'quiet', tip: 'Take it out' }, '×']]),
      ['button', { key: `field-add:${name}`, look: 'quiet', tip: 'Add one' }, '+']];
  }
  if (!scalar(v) || field?.type === 'json') return ['input', { key: `field:${name}`, kind: 'text', lines: 4, value: v === undefined || v === null ? '' : JSON.stringify(v, null, 1), hint: 'JSON, like ["one", "two"]', grow: true }];
  const s = v === null || v === undefined ? '' : String(v);
  const long = s.length > fold || s.includes('\n') || field?.code;
  const kind = field?.type === 'number' ? 'number' : field?.type === 'url' ? 'url' : 'text';
  return ['input', { key: `field:${name}`, kind, value: s, grow: true, ...(long && { kind: 'text', lines: field?.code ? 12 : 4 }) }];
}

/**
 * Code to write, in the host's code editor: its text, or one module of its modules by name, picked (`code-file:<name>`;
 * each module's words go back by `code:<name>:<module>`). Code that is one JavaScript module whole, or files by path
 * where its field takes them (`files`), is tried as it is written (`preview`): the host sends each pause as a try,
 * drawn on the person's own canvas (task e_pbdxaxdy). For files, it is handed the others as written (`others`) to send
 * the field whole, and whether any of them differs from what is saved (`edited`).
 */
function coder(name, v, field, { item, file, saved } = {}) {
  const mods = modulesOf(v);
  if (typeof v !== 'string' && !mods) return null;
  if (typeof v === 'string' || v === undefined) return ['input', { key: `field:${name}`, kind: 'code', lang: langOf(field), value: v ?? '', ...(item && !field?.css && { preview: { item, field: name } }) }];
  const names = Object.keys(mods).sort();
  if (!names.length) return null;
  const at = names.includes(file) ? file : names.includes('index.js') ? 'index.js' : names[0];
  const others = Object.fromEntries(names.filter((n) => n !== at).map((n) => [n, mods[n]]));
  const was = modulesOf(saved) ?? {};
  const edited = names.some((n) => n !== at && mods[n] !== was[n]) || Object.keys(was).some((n) => !(n in mods));
  const tried = item && field?.files && { preview: { item, field: name, file: at, others, ...(edited && { edited }) } };
  return ['box', { flow: 'column', gap: 1 },
    ['input', { key: `code-file:${name}`, kind: 'pick', values: names, value: at, tip: 'Which module' }],
    ['input', { key: `code:${name}:${at}`, kind: 'code', lang: langOf(field, at), value: mods[at], ...tried }]];
}

/**
 * A field as it reads, changed where it stands. `writes`: the person may change it. `open`: its words are open to
 * write, or what has parts is shown whole. `kept`: what is written and not yet saved, which it shows in its place.
 */
export function fieldMarks(name, v, field, { writes = false, open = false, kept, fold, item, file } = {}) {
  if (!writes) return valueMarks(name, v, field, { open, fold });
  const pick = picker(name, v, field);
  if (pick) return pick;
  if (typeof v === 'string' && ID.test(v) && open) return ['input', { key: `field:${name}`, kind: 'item', hint: 'Find an item', focus: true }];
  if (typeof v === 'string' && ID.test(v)) return ['box', { flow: 'row', gap: 1 }, one(v), ['button', { key: `field-open:${name}`, look: 'quiet', tip: 'Name another item' }, '✎']];
  const code = field?.code && (open || kept !== undefined) && coder(name, kept === undefined ? v : kept, field, { item, file, saved: v });
  if (code) return ['box', { flow: 'column', gap: 1 }, ['box', { flow: 'row' }, ['button', { key: `field-fold:${name}`, look: 'quiet', tip: kept === undefined ? 'Fold it' : 'Fold it: what is written waits for Save' }, '▴']], code];
  if (open || kept !== undefined) return writer(name, kept === undefined ? v : kept, field, { fold });
  return ['box', { flow: 'row', gap: 1 }, valueMarks(name, v, field, { fold }), ['button', { key: `field-open:${name}`, look: 'quiet', tip: 'Change it' }, '✎']];
}

/**
 * The fields section: each field its type declares, empty or not, and any it holds its type no longer declares. What
 * holds something first; what holds nothing after, in one fold. `skip`: a field shown elsewhere (the choices).
 */
export function fieldsMarks(item, declared, { writes = false, open = new Set(), kept = {}, emptyOpen = false, skip = [], fold, titles = {}, files = {} } = {}) {
  titled = titles;
  const props = item?.props ?? {};
  const names = [...new Set([...Object.keys(declared), ...Object.keys(props)])].filter((k) => NAME.test(k) && !skip.includes(k));
  if (!names.length) return null;
  const row = (k) => {
    const f = declared[k];
    const may = writes && Boolean(f) && !f.system;
    // Code being written stands under its name, the width of the page.
    const writing = may && f.code && (open.has(k) || kept[k] !== undefined);
    return ['box', { flow: writing ? 'column' : 'row', gap: writing ? 1 : 3, key: `field-row:${k}` },
      ['text', { look: 'muted', tip: (f?.description ?? 'Not declared by its type').slice(0, 200) }, label(k)],
      fieldMarks(k, props[k], f, { writes: may, open: open.has(k), kept: kept[k], fold, item: item?.id, file: files[k] })];
  };
  const held = names.filter((k) => !empty(props[k]) || kept[k] !== undefined);
  const unheld = names.filter((k) => !held.includes(k));
  return ['box', { flow: 'column', gap: 2 },
    ...held.map(row),
    ...(unheld.length ? [['button', { key: 'fields-empty', look: 'quiet', tip: unheld.map(label).join(', ').slice(0, 200) }, emptyOpen ? `${unheld.length} empty ▴` : `${unheld.length} empty`]] : []),
    ...(emptyOpen ? unheld.map(row) : [])];
}

/**
 * What a gesture on the fields comes to: `{ pick: [name, value] }` a change at once, `{ keep: [name, value] }` words
 * held for Save, `{ open: name }`, `{ fold: name }`, `{ empty: true }`, or null when it is not the fields'. `was` is
 * what the field holds now, `kept` what is written of it.
 */
export function fieldEvent(event, item, declared, kept = {}) {
  const k = String(event?.key ?? '');
  if (k === 'fields-empty' && event.name === 'press') return { empty: true };
  let m = /^field-open:(.+)$/.exec(k);
  if (m && event.name === 'press') return { open: m[1] };
  if ((m = /^field-fold:(.+)$/.exec(k)) && event.name === 'press') return { fold: m[1] };
  if ((m = /^code-file:(.+)$/.exec(k)) && event.name === 'pick') return { file: [m[1], String(event.value ?? '')] };
  const props = item?.props ?? {};
  const now = (name) => (kept[name] !== undefined ? kept[name] : props[name]);
  // One module of code by name: the field's modules with that one as written.
  if ((m = /^code:([^:]+):(.+)$/.exec(k)) && event.name === 'edit' && declared[m[1]]?.code && !declared[m[1]].system) return { keep: [m[1], { ...(modulesOf(now(m[1])) ?? {}), [m[2]]: String(event.value ?? '') }] };
  if (m && event.name === 'submit') return { save: true };
  if ((m = /^field-add:(.+)$/.exec(k)) && event.name === 'press') return { keep: [m[1], [...(Array.isArray(now(m[1])) ? now(m[1]) : []), '']] };
  if ((m = /^field-out:(.+):(\d+)$/.exec(k)) && event.name === 'press') {
    const list = [...(Array.isArray(now(m[1])) ? now(m[1]) : [])];
    list.splice(Number(m[2]), 1);
    return { keep: [m[1], list] };
  }
  if ((m = /^field:(.+):(\d+)$/.exec(k)) && event.name === 'edit') {
    const was = Array.isArray(props[m[1]]) ? props[m[1]] : [];
    const list = [...(Array.isArray(now(m[1])) ? now(m[1]) : [])];
    list[Number(m[2])] = typed(event.value, was[Number(m[2])]) ?? '';
    return { keep: [m[1], list] };
  }
  if (!(m = /^field:([^:]+)$/.exec(k))) return null;
  const name = m[1], f = declared[name], was = props[name];
  if (!f || f.system) return null;
  if (event.name === 'pick') {
    if (f.type === 'boolean') return { pick: [name, event.value === true || event.value === 'true'] };
    if (f.type === 'datetime') return { pick: [name, event.value ? new Date(event.value).toISOString() : null] };
    const v = plain(event.value) ? event.value.id : event.value;
    return { pick: [name, v === '' || v === undefined ? null : v] };
  }
  if (event.name === 'edit') {
    if (!scalar(was) || f.type === 'json') {
      const s = String(event.value ?? '');
      if (!s.trim()) return { keep: [name, null] };
      try {
        return { keep: [name, JSON.parse(s)] };
      } catch {
        return { bad: [name, 'Not valid JSON'] };
      }
    }
    if (f.code) return { keep: [name, String(event.value ?? '')] };
    return { keep: [name, typed(event.value, f.type === 'number' ? 0 : was)] };
  }
  if (event.name === 'submit') return { save: true };
  return null;
}
