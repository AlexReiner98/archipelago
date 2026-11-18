// The band an item's page opens on, under its title: the point of the item before its head and its note (decision
// e_ktr4vbcd). What it holds is declared by its type, never named here: a question that settles opens on its choices,
// or on its answer once settled (capability settles); any other type says its lead (capability lead) in one of the
// forms below, and which of its fields and links fill it. A type that says "none", or holds nothing the title and its
// marks do not already say, opens with no band (decision e_65cnpc2b): a band is three lines at most, its status only
// in the marks, and only the press the person likely makes now in sight, at the end of the line it acts on.

import { isChosen } from './sections.js';
import { ago, label, typeOf } from './words.js';

/** Words cut to what a tip holds. */
const tip = (s) => String(s ?? '').slice(0, 200);
/** One line of the band: its words cut where they do not fit, a press at its end. */
const line = (...marks) => ['box', { flow: 'row', gap: 2 }, ...marks.filter(Boolean)];
/** The band: one, set apart from what follows by a line. */
const band = (...marks) => ['box', { key: 'lead', look: 'band', flow: 'column', gap: 2, pad: 2 }, ...marks.filter(Boolean)];

/**
 * A settled question's answer, or null: what was chosen (its type's settles.chosen, outcome in core) once it is closed,
 * whether or not it had choices to pick from, and why.
 */
export function answerOf(item, type) {
  const settles = type?.capabilities?.settles;
  const props = item?.props ?? {};
  const said = (f) => (f && typeof props[f] === 'string' ? props[f].trim() : '');
  if (!settles || item?.is_open !== false || !said(settles.chosen)) return null;
  return { chosen: settles.chosen, why: settles.why, picked: said(settles.chosen), reason: said(settles.why) };
}

/**
 * The lead an item opens on, or null: `{ form, ... }`. A question: `answer` once settled with its answer kept,
 * `choices` while it has choices; else what its type declares, when what it names is there to show.
 */
export function leadOf(item, type, c) {
  const props = item?.props ?? {};
  if (answerOf(item, type)) return { form: 'answer' };
  if (c) return { form: 'choices' };
  const lead = type?.capabilities?.lead;
  if (!lead?.form) return null;
  if (lead.form === 'measure') return props[lead.value] === undefined || props[lead.value] === null || props[lead.value] === '' ? null : lead;
  if (lead.form === 'alert') return props[lead.unless] !== true ? lead : null;
  if (lead.form === 'line') return lead.value ? (said(props[lead.value]) ? lead : null) : lead.link ? lead : null;
  if (lead.form === 'timeline') return Array.isArray(props[lead.beats]) && props[lead.beats].length ? lead : null;
  if (LINKED.includes(lead.form) || lead.form === 'occurrence') return lead;
  return null;
}

/** A field's value as words on one line: a list joined, a number as the reader writes it; '' when there is nothing. */
const said = (v) => (v === undefined || v === null || typeof v === 'boolean' ? '' : typeof v === 'string' ? v.trim()
  : typeof v === 'number' ? v.toLocaleString() : Array.isArray(v) ? v.map(said).filter(Boolean).join(', ') : JSON.stringify(v));

/** The forms that count what is linked into it, by the link types the lead names. */
const LINKED = ['aim', 'done', 'place', 'actor'];

/** Whether a choice is the one recommended: `recommended: true` on it, or its words say so. */
const recommended = (x, says) => (x && typeof x === 'object' && x.recommended === true) || /\brecommended\b/i.test(says ?? '');

/**
 * The choices of a question still open, one line each: its name, what it means in the tooltip, the recommended one
 * marked. As many as the band has room for are in sight, the recommended one always among them, the rest behind a
 * count at the end of the last line. A press on one asks to settle it by that one.
 */
function choices(c, item, { writes, asking }, room) {
  const kept = item?.props?.[c.field];
  const rec = c.list.map((_, i) => recommended(Array.isArray(kept) ? kept[i] : undefined, c.says[i]));
  let shown = c.list.map((_, i) => i);
  if (shown.length > room) {
    const r = rec.indexOf(true);
    shown = shown.slice(0, room);
    if (r >= room) shown[room - 1] = r;
  }
  const hidden = c.list.map((_, i) => i).filter((i) => !shown.includes(i));
  const what = (i) => tip(c.says[i] ? `${c.list[i]}: ${c.says[i]}` : c.list[i]);
  const name = (i) => (writes ? ['button', { key: `choice:${i}`, look: 'quiet', tip: what(i) }, c.list[i]] : ['text', { bold: true, tip: what(i) }, c.list[i]]);
  const more = hidden.length > 0 && (writes
    ? ['menu', { key: 'choices-more', label: `+${hidden.length}`, look: 'quiet' }, ...hidden.map(name)]
    : ['text', { look: 'muted', tip: tip(hidden.map((i) => c.list[i]).join(' · ')) }, `+${hidden.length}`]);
  const lines = shown.map((i, n) => line(rec[i] && ['text', { tone: 'ok', tip: 'Recommended' }, '★'],
    ['box', { flow: 'row', grow: true }, name(i)], n === shown.length - 1 && more));
  const ask = asking !== undefined && ['box', { flow: 'column', gap: 1, look: 'sunk', pad: 2 },
    ['text', {}, `Settle it: ${c.list[asking]}`],
    ...(c.why ? [['input', { key: 'choice-why', kind: 'text', hint: 'Why? (optional)', grow: true, focus: true }]] : []),
    ['box', { flow: 'row', gap: 2 }, ['button', { key: 'choice-settle', look: 'main' }, 'Settle it'], ['button', { key: 'choice-cancel', look: 'quiet' }, 'Cancel']]];
  return { lines, ask };
}

/**
 * A settled question, as the marks cannot say it: the answer, why in a line, and the choices not taken set aside in
 * one quiet line (the fields leave the choices out). Who settled it and when are its marks.
 */
function answer(a, c) {
  const others = c ? c.list.filter((x) => !isChosen(a.picked, x)) : [];
  const aside = others.length > 0 && others.length < c.list.length ? others.join(' · ') : '';
  return band(
    ['box', { flow: 'row', gap: 2 }, ['text', { tone: 'ok' }, '✓'], ['box', { flow: 'row', grow: true }, ['text', { bold: true, tip: tip(a.picked) }, a.picked]]],
    a.reason && ['text', { look: 'muted', tip: tip(a.reason) }, a.reason],
    aside && ['text', { tone: 'closed', tip: tip(aside) }, aside]);
}

/** Words that take the room left on their line, so what stands before and after them keeps its own. */
const rest = (words, look = {}) => ['box', { flow: 'row', grow: true }, ['text', { ...look, tip: tip(words) }, words]];
/** The number a band is about, large: drawn at the style's lead_figure (part-marks.css). */
const figure = (said, tone) => ['box', { key: 'lead-figure', flow: 'row' }, ['text', { look: 'title', ...(tone && { tone }), tip: tip(said) }, said]];
/** The most segments a bar is cut into: more parts than this share them. */
const SEGMENTS = 12;
/** How much of a whole is done, as a thin bar of segments, each as high as the style's lead_bar (part-marks.css). */
const bar = (done, all) => {
  const n = Math.min(all, SEGMENTS), lit = Math.round((done * n) / all);
  return ['box', { key: 'lead-bar', flow: 'row', gap: 1, grow: true }, ...Array.from({ length: n }, (_, i) => ['box', { tone: i < lit ? 'ok' : 'closed' }])];
};
/** "3 of 5 done" and its bar, or null with nothing to count. */
const progress = (ties) => {
  const done = ties.filter((t) => t.open === false).length;
  return ties.length ? line(['text', { look: 'muted' }, `${done} of ${ties.length} done`], bar(done, ties.length)) : null;
};

/** A measure: its number large with what it counts, and when it was true. */
function measure(item, lead) {
  const props = item.props ?? {};
  const v = props[lead.value];
  const said = typeof v === 'number' ? v.toLocaleString() : typeof v === 'string' ? v : JSON.stringify(v);
  const unit = lead.unit && typeof props[lead.unit] === 'string' ? props[lead.unit] : '';
  const asOf = lead.as_of && typeof props[lead.as_of] === 'string' ? props[lead.as_of].slice(0, 10) : '';
  return [line(figure(unit ? `${said} ${unit}` : said), asOf && ['text', { look: 'muted' }, `as of ${asOf}`])];
}

/**
 * An alert, while the field it reads is not true (false, or never said): one line, what is not yet so, what would make
 * it so, and the press that says it is.
 */
function alert(item, lead, { writes }) {
  const props = item.props ?? {};
  if (!lead.unless || props[lead.unless] === true) return [];
  const says = lead.says && typeof props[lead.says] === 'string' ? props[lead.says] : '';
  const what = label(lead.unless).toLowerCase();
  return [line(['text', { tone: 'warn' }, `◌ Not yet ${what}`], says ? rest(says, { look: 'muted' }) : ['box', { grow: true }],
    writes && ['button', { key: 'lead-yes', look: 'quiet', tip: tip(`Say it is ${what}`) }, label(lead.unless)])];
}

/** A beat's mark, when its type's lead marks beats (mark, marks, warn): its glyph, and whether it warns. */
function markOfBeat(b, lead) {
  const value = lead.mark ? b[lead.mark] : undefined;
  if (typeof value !== 'string' || !value) return null;
  return { glyph: lead.marks?.[value] ?? '·', warns: Boolean(lead.warn?.includes(value)), value };
}

/** A timeline: its latest beats, one line each with when; a marked beat with its glyph before it, as a warning when it warns. */
function timeline(item, lead, now, room) {
  const beats = item.props[lead.beats].filter((b) => b && typeof b.said === 'string');
  return beats.slice(-room).map((b) => {
    const m = markOfBeat(b, lead);
    const look = m?.warns ? { tone: 'bad' } : {};
    return line(m && ['text', { look: 'muted', ...look, tip: tip(`${m.value}${b.by ? `, told by ${b.by}` : ''}`) }, m.glyph],
      rest(b.said, look), b.at && ['text', { look: 'muted', size: 2, tip: String(b.at) }, ago(b.at, now)]);
  });
}

/** What is linked into it by a link type, read from its root as the page names it. */
const into = (links, type) => (Array.isArray(links) ? links.filter((t) => t && (t.root ?? t.type) === type) : []);

/** An aim: how much of what serves it is done, or that nothing does yet. */
const aim = (lead, links) => [progress(into(links, lead.link)) ?? line(['text', { look: 'muted' }, 'Nothing serves it yet'])];

/** Work's own: how many of its parts are done, then whether it is seen working. */
const done = (item, lead, links, opts) => [progress(into(links, lead.link)), ...alert(item, lead, opts)].filter(Boolean);

/** A place: who holds it, and how many need it while it is held. */
function place(lead, links) {
  const held = into(links, lead.link), wanting = lead.waits ? into(links, lead.waits).filter((t) => t.open !== false) : [];
  const names = held.map((t) => t.title).filter(Boolean).join(', ');
  return [names && line(['text', { look: 'muted' }, 'Held by'], rest(names)),
    held.length > 0 && wanting.length > 0 && line(['text', { look: 'muted' }, `${wanting.length} ${wanting.length === 1 ? 'needs' : 'need'} it`])].filter(Boolean);
}

/** An actor: how many open things wait on them, large; as a warning when it is the person looking. */
function actor(item, lead, links, me) {
  const n = into(links, lead.link).filter((t) => t.open !== false).length;
  const you = Boolean(me) && me === item.id;
  return n ? [line(figure(String(n), you ? 'warn' : undefined), ['text', { look: 'muted' }, `${n === 1 ? 'waits' : 'wait'} on ${you ? 'you' : 'them'}`])] : [];
}

/** A line: one field, or the far ends of a link into it, named and cut where it does not fit; nothing when empty. */
function oneLine(item, lead, links) {
  const words = lead.value ? said((item.props ?? {})[lead.value]) : into(links, lead.link).map((t) => t.title).filter(Boolean).join(', ');
  return words ? [line(['text', { look: 'muted' }, label(lead.value ?? lead.link)], rest(words))] : [];
}

/** When it happens, read from its type's when: the day large, its hour and how far off muted. */
function occurrence(item, type, now = Date.now()) {
  const when = type?.capabilities?.when;
  const at = when && (item.props ?? {})[when.at ?? when.start];
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return [];
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const hour = at.length > 10 ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  const off = Math.round((t - now) / 86400000);
  const far = off === 0 ? 'today' : off > 0 ? `in ${off} d` : `${-off} d ago`;
  return [line(figure(day), ['text', { look: 'muted', tip: at }, [hour, far].filter(Boolean).join(' · ')])];
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
  // What for takes the room left, so the words before it are never cut.
  ...(w.for ? [['box', { flow: 'row', grow: true }, ['text', { look: 'muted', tip: tip(w.for) }, w.for]]] : [])];

/** The most lines a band holds (decision e_65cnpc2b). */
const LINES = 3;

/**
 * The band an item's page opens on, as marks, or null when its type says none, it holds nothing the title and marks
 * do not already say, and nothing waits on the person looking. `links` are the ties into it ({ type, root, title, open }).
 */
export function leadMarks(item, type, c, { writes = false, asking, adding, now, waits, me, links, words } = {}) {
  const lead = leadOf(item, type, c);
  const mine = waitsOnMe(item, waits, me);
  const room = LINES - (mine ? 1 : 0);
  if (lead?.form === 'choices') {
    const { lines, ask } = choices(c, item, { writes: writes && item.is_open !== false, asking }, room);
    return band(mine && waitsLine(mine), ...lines, ask);
  }
  if (lead?.form === 'answer') {
    const body = answer(answerOf(item, type), c);
    return mine ? [body[0], body[1], waitsLine(mine), ...body.slice(2)] : body;
  }
  const lines = !lead ? []
    : lead.form === 'measure' ? measure(item, lead)
    : lead.form === 'alert' ? alert(item, lead, { writes })
    : lead.form === 'timeline' ? timeline(item, lead, now, room)
    : lead.form === 'aim' ? aim(lead, links)
    : lead.form === 'done' ? done(item, lead, links, { writes })
    : lead.form === 'place' ? place(lead, links)
    : lead.form === 'actor' ? actor(item, lead, links, me)
    : lead.form === 'occurrence' ? occurrence(item, type, now)
    : lead.form === 'line' ? oneLine(item, lead, links)
    : [];
  // The line that it waits on you stands first; the band is never more than its lines.
  const all = [mine && waitsLine(mine), ...pressed(lines, lead, item, { writes, links, words, adding })].filter(Boolean).slice(0, LINES);
  return all.length ? band(...all) : null;
}

/** What a press on the band comes to: the alert's field made true, as one change on the person's word; else null. */
export function leadEvent(event, item, type) {
  const lead = type?.capabilities?.lead;
  if (event?.key !== 'lead-yes' || event.name !== 'press' || !['alert', 'done'].includes(lead?.form)) return null;
  return { ops: [{ op: 'update', id: item.id, props: { [lead.unless]: true } }], reason: `${label(lead.unless)}, said in the UI` };
}

/** The fields the band shows, so the fields below do not say them again. */
export function leadFields(item, type, c) {
  const lead = leadOf(item, type, c);
  if (lead?.form === 'answer') { const a = answerOf(item, type); return [a.chosen, a.reason && a.why].filter(Boolean); }
  if (!lead || lead.form === 'choices') return [];
  // An alert's field is said only while it is not true; once true it stays among the fields.
  if ((lead.form === 'alert' || lead.form === 'done') && item?.props?.[lead.unless] === true) return [];
  return [lead.value, lead.unit, lead.as_of, lead.unless, lead.says, lead.beats].filter(Boolean);
}

/** The pack a type is named in: what comes before its last dot, none for core's. */
const packOf = (type) => (String(type ?? '').includes('.') ? String(type).slice(0, String(type).lastIndexOf('.')) : '');

/**
 * The type work added to an aim is, or null: a flavour of plannable work with an estimate from the aim's own pack, so
 * the island it is on speaks it (core's task for core's aim); else that pack's plannable starter.
 */
function workTypeOf(words, aimType) {
  const ids = Object.keys(words?.types ?? {}).filter((t) => packOf(t) === packOf(aimType) && !words.types[t].dormant);
  const plannable = (t) => Boolean(typeOf(words, t).capabilities.plannable);
  return ids.find((t) => words.types[t].of && plannable(t) && typeOf(words, t).fields.tokens_estimated) ?? ids.find((t) => !words.types[t].of && plannable(t)) ?? null;
}

/**
 * The band's one likely press, or null (task e_mgu5nw8b): on a person, Light them, what waits on them drawn on the
 * canvas and lit while pointed at; on an aim nothing serves, Add work, for one who may write. A settled choice and Seen
 * working are pressed where their forms draw them.
 */
function pressOf(item, lead, { writes, links, words }) {
  if (lead?.form === 'actor') {
    const ids = into(links, lead.link).filter((t) => t.open !== false && t.id).map((t) => t.id);
    return ids.length ? { key: 'lead-light', said: 'Light them', tip: 'Draw what waits on them on the canvas', lights: ids.slice(0, 500) } : null;
  }
  if (lead?.form === 'aim' && writes && !into(links, lead.link).length && workTypeOf(words, item.type)) return { key: 'lead-add', said: 'Add work', tip: 'Name work that serves it' };
  return null;
}

/** The press, at the end of the line it acts on: the band's first line, set apart at its end by the style (lead-press). */
const pressMark = (p) => ['box', { key: 'lead-press', flow: 'row' }, ['button', { key: p.key, look: 'quiet', tip: p.tip, ...(p.lights && { lights: p.lights }) }, p.said]];

/** Work being named for an aim, in place: its words, Add and Cancel, on one line under the line it acts on. */
const addingLine = (adding) => ['box', { flow: 'row', gap: 2, look: 'sunk', pad: 2 },
  ['input', { key: 'lead-add-title', kind: 'text', value: adding, hint: 'What work serves it?', grow: true, focus: true }],
  ['button', { key: 'lead-add-go', look: 'main' }, 'Add'], ['button', { key: 'lead-add-cancel', look: 'quiet' }, 'Cancel']];

/** A form's lines with its press at the end of the first, or, while work is being named, the words to name it under it. */
function pressed(lines, lead, item, opts) {
  const p = lines.length ? pressOf(item, lead, opts) : null;
  if (!p) return lines;
  if (p.key === 'lead-add' && typeof opts.adding === 'string') return [lines[0], addingLine(opts.adding), ...lines.slice(1)];
  return [[...lines[0], pressMark(p)], ...lines.slice(1)];
}

/**
 * What a press on the band comes to, or null: { go } a query that draws what waits on a person (moving the canvas
 * changes nothing on the map); { adding } the words of work being named for an aim (undefined once let go); or the work
 * made and serving the aim, as one change on the person's word.
 */
export function pressEvent(event, item, type, { links, words, adding } = {}) {
  const lead = type?.capabilities?.lead, k = event?.key, n = event?.name;
  if (lead?.form === 'actor' && k === 'lead-light' && n === 'press') return { go: { query: { filter: { find: [`id ${item.id}`, `${lead.link} ${item.id}`], not: ['done', 'kind system'] } } } };
  if (lead?.form !== 'aim' || !['lead-add', 'lead-add-title', 'lead-add-go', 'lead-add-cancel'].includes(k)) return null;
  if (k === 'lead-add' && n === 'press') return { adding: '' };
  if (k === 'lead-add-cancel' && n === 'press') return { adding: undefined };
  if (k === 'lead-add-title' && n === 'edit') return { adding: String(event.value ?? '') };
  if (!((k === 'lead-add-go' && n === 'press') || (k === 'lead-add-title' && n === 'submit'))) return null;
  const title = String((n === 'submit' ? event.value : adding) ?? '').trim();
  const kind = workTypeOf(words, item.type);
  if (!title || !kind) return { adding };
  const island = typeof item.props?.island === 'string' ? item.props.island : null;
  return { ops: [{ op: 'create', ref: 'work', type: kind, title, ...(island && { props: { island } }) }, { op: 'link', type: lead.link, from: 'work', to: item.id }], reason: `Work added in the UI to serve "${item.title ?? item.id}"` };
}
