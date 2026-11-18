// The band an item's page opens on, under its title: the point of the item before its head and its note (decision
// e_ktr4vbcd). What it holds is declared by its type, never named here: a question that settles opens on its choices,
// or on its answer once settled (capability settles); any other type says its lead (capability lead) in one of the
// forms below, and which of its fields fill it. A type that declares neither opens as before, with no band.

import { isChosen } from './sections.js';
import { ago, label } from './words.js';

/** Words cut to what a tip holds. */
const tip = (s) => String(s ?? '').slice(0, 200);
/** The band: one, set apart from what follows by a line. */
const band = (...marks) => ['box', { key: 'lead', look: 'band', flow: 'column', gap: 2, pad: 2 }, ...marks.filter(Boolean)];

/**
 * The lead an item opens on, or null: `{ form, ... }`. A question with choices: `choices` while it is open, `answer`
 * once settled by one; else what its type declares, when what it names is there to show.
 */
export function leadOf(item, type, c) {
  const props = item?.props ?? {};
  if (c) return item.is_open === false && typeof c.picked === 'string' && c.picked.trim() ? { form: 'answer' } : { form: 'choices' };
  const lead = type?.capabilities?.lead;
  if (!lead?.form) return null;
  if (lead.form === 'measure') return props[lead.value] === undefined || props[lead.value] === null || props[lead.value] === '' ? null : lead;
  if (lead.form === 'alert') return props[lead.unless] === false ? lead : null;
  if (lead.form === 'timeline') return Array.isArray(props[lead.beats]) && props[lead.beats].length ? lead : null;
  return null;
}

/** The choices of a question still open: each its name and what it means; a press asks to settle it by that one. */
function choices(c, { writes, asking }) {
  return band(
    ['list', { look: 'rows' }, ...c.list.map((x, i) => ['box', { flow: 'column', gap: 0 },
      ['box', { flow: 'row' }, writes ? ['button', { key: `choice:${i}`, look: 'quiet', tip: tip(`Settle it: ${x}`) }, x] : ['text', { bold: true, tip: tip(x) }, x]],
      ...(c.says[i] ? [['text', { look: 'muted', tip: tip(c.says[i]) }, c.says[i]]] : [])])],
    asking !== undefined && ['box', { flow: 'column', gap: 1, look: 'sunk', pad: 2 },
      ['text', {}, `Settle it: ${c.list[asking]}`],
      ...(c.why ? [['input', { key: 'choice-why', kind: 'text', hint: 'Why? (optional)', grow: true, focus: true }]] : []),
      ['box', { flow: 'row', gap: 2 }, ['button', { key: 'choice-settle', look: 'main' }, 'Settle it'], ['button', { key: 'choice-cancel', look: 'quiet' }, 'Cancel']]]);
}

/** A settled question: what was chosen, why, when; the choices not taken, set aside. */
function answer(item, c) {
  const props = item.props ?? {};
  const why = c.why && typeof props[c.why] === 'string' ? props[c.why] : '';
  const on = c.on && typeof props[c.on] === 'string' ? props[c.on] : '';
  const others = c.list.filter((x) => !isChosen(c.picked, x));
  return band(
    ['box', { flow: 'row', gap: 2 }, ['text', { tone: 'ok', size: 6 }, '✓'], ['text', { look: 'title', size: 6, tip: tip(c.picked) }, c.picked]],
    why && ['text', { look: 'muted', tip: tip(why) }, why],
    on && ['text', { look: 'muted', size: 2, tip: on }, on],
    others.length > 0 && others.length < c.list.length && ['list', { look: 'plain' }, ...others.map((x) => ['text', { tone: 'closed', tip: tip(x) }, x])]);
}

/** A measure: its number large, what it counts, and when it was true. */
function measure(item, lead) {
  const props = item.props ?? {};
  const v = props[lead.value];
  const said = typeof v === 'number' ? v.toLocaleString() : typeof v === 'string' ? v : JSON.stringify(v);
  const unit = lead.unit && typeof props[lead.unit] === 'string' ? props[lead.unit] : '';
  const asOf = lead.as_of && typeof props[lead.as_of] === 'string' ? props[lead.as_of].slice(0, 10) : '';
  return band(['box', { flow: 'row', gap: 6, align: 'end' },
    ['text', { look: 'title', size: typeof v === 'number' ? 9 : 6, tip: tip(said) }, said],
    unit && ['text', { look: 'muted', size: 5, tip: tip(unit) }, unit],
    asOf && ['text', { look: 'muted', size: 2, tip: asOf }, `as of ${asOf}`]].filter(Boolean));
}

/** An alert, while the field it reads is false: what is not yet so, what would make it so, and the press that says it is. */
function alert(item, lead, { writes }) {
  const says = lead.says && typeof item.props?.[lead.says] === 'string' ? item.props[lead.says] : '';
  return band(['box', { look: 'sunk', tone: 'warn', flow: 'row', gap: 2, pad: 2, align: 'between' },
    ['box', { flow: 'column', gap: 1, grow: true },
      ['text', { tone: 'warn', bold: true }, `Not yet ${label(lead.unless).toLowerCase()}`],
      ...(says ? [['text', { look: 'muted', tip: tip(says) }, says]] : [])],
    ...(writes ? [['button', { key: 'lead-yes', look: 'quiet', tip: tip(`Say it is ${label(lead.unless).toLowerCase()}`) }, label(lead.unless)]] : [])]);
}

/** How many beats a timeline shows: the latest; the rest are counted. */
const BEATS = 6;

/** A timeline: the beats its field keeps, numbered, each a line, with when. */
function timeline(item, lead, now) {
  const beats = item.props[lead.beats].filter((b) => b && typeof b.said === 'string');
  const shown = beats.slice(-BEATS);
  return band(
    beats.length > shown.length && ['text', { look: 'muted', size: 2 }, `${beats.length - shown.length} earlier`],
    ['list', { look: 'plain' }, ...shown.map((b, i) => ['box', { flow: 'row', gap: 2 },
      ['text', { look: 'muted', size: 2 }, String(b.n ?? beats.length - shown.length + i + 1)],
      // The words take what room is left, so the number and the time keep theirs.
      ['box', { flow: 'row', grow: true }, ['text', { tip: tip(b.said) }, b.said]],
      ...(b.at ? [['text', { look: 'muted', size: 2, tip: String(b.at) }, ago(b.at, now)]] : [])])]);
}

/**
 * Whether it waits on the person looking, and for what: a state of the item, said in one line (decision e_xj9cs33u).
 * Whom else it waits on is a wire on the canvas, never listed here.
 */
export function waitsOnMe(item, waits, me) {
  if (!me || item?.is_open === false || !Array.isArray(waits)) return null;
  return waits.find((w) => w?.id === me) ?? null;
}

const waitsLine = (w) => ['box', { flow: 'row', gap: 2 },
  ['text', { tone: 'warn', bold: true }, '↩ Waits on you'],
  ...(w.for ? [['text', { look: 'muted', tip: tip(w.for) }, w.for]] : [])];

/** The band an item's page opens on, as marks, or null when its type declares none, it holds nothing to show and nothing waits on the person looking. */
export function leadMarks(item, type, c, { writes = false, asking, now, waits, me } = {}) {
  const lead = leadOf(item, type, c);
  const mine = waitsOnMe(item, waits, me);
  const body = !lead ? null
    : lead.form === 'choices' ? choices(c, { writes: writes && item.is_open !== false, asking })
    : lead.form === 'answer' ? answer(item, c)
    : lead.form === 'measure' ? measure(item, lead)
    : lead.form === 'alert' ? alert(item, lead, { writes })
    : timeline(item, lead, now);
  if (!mine) return body;
  // The line stands first in the band; with no band of its own, it is the band.
  return body ? [body[0], body[1], waitsLine(mine), ...body.slice(2)] : band(waitsLine(mine));
}

/** What a press on the band comes to: the alert's field made true, as one change on the person's word; else null. */
export function leadEvent(event, item, type) {
  const lead = type?.capabilities?.lead;
  if (event?.key !== 'lead-yes' || event.name !== 'press' || lead?.form !== 'alert') return null;
  return { ops: [{ op: 'update', id: item.id, props: { [lead.unless]: true } }], reason: `${label(lead.unless)}, said in the UI` };
}

/** The fields the band shows, so the fields below do not say them again. */
export function leadFields(item, type, c) {
  const lead = leadOf(item, type, c);
  if (!lead || lead.form === 'choices' || lead.form === 'answer') return [];
  return [lead.value, lead.unit, lead.as_of, lead.unless, lead.says, lead.beats].filter(Boolean);
}
