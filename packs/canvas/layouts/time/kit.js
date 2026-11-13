// What the time drawing's two layouts share (./calendar.js, ./bars.js): its sizes, the blocks an answer places, what a
// block is called and says, the lanes, and a block drawn so it opens its item.

import { DAY, fmtDay, fmtTime } from './clock.js';
import { hueClass, hueRule } from './look.js';
import { HEX, m } from './marks.js';

/** Core's starter types a block takes its colour from, by the one its type is or is a flavour of; any other is the system's. */
const KINDS = ['actor', 'aim', 'work', 'question', 'record', 'occurrence', 'place'];

/** As many letters as fit a width, at about `letter` pixels a letter (the style's time_letter). */
const cutAt = (letter) => (text, width) => {
  const n = Math.max(0, Math.floor(width / letter));
  return text.length <= n ? text : n > 1 ? `${text.slice(0, n - 1)}…` : '';
};

/** Every block an answer places: one for each span of each item. */
export const blocks = (answer) =>
  answer.items.flatMap((item) =>
    (item.time ?? []).map((span) => ({ item, start: Date.parse(span.start), end: Math.max(Date.parse(span.end), Date.parse(span.start)), by: span.by, on: span.on_title, stream: span.stream !== undefined ? span.stream : item.stream })),
  );
/** Time set aside, not yet worked: a planned entry, or a day a routine falls on. Drawn hollow. */
export const planned = (b) => b.item.status === 'planned' || b.by === 'repeat';
const group = (b) => `t-block group-${[b.item.type, ...(Array.isArray(b.item.is) ? b.item.is : [])].find((t) => KINDS.includes(t)) ?? 'system'}${b.item.open ? '' : ' closed'}${planned(b) ? ' t-planned' : ''}`;
/** What a block is called: the work a session was on in that stretch, else the item itself. */
export const nameOf = (b) => b.on ?? b.item.title;
export const said = (b) => `${nameOf(b)}${b.on ? `\n${b.item.title}` : ''}\n${b.end - b.start >= DAY ? fmtDay(b.start) : `${fmtDay(b.start)}, ${fmtTime(b.start)}`}${b.end > b.start ? ` to ${b.end - b.start >= DAY ? fmtDay(b.end - 1) : fmtTime(b.end)}` : ''}${b.by === 'bound' ? ' (due)' : b.by === 'repeat' ? ' (repeats)' : b.item.status === 'planned' ? ' (planned)' : ''}${b.end === b.start && Number(b.item.fields?.hours) > 0 ? `, ${b.item.fields.hours} h` : ''}`;
/** The lanes of an answer, each with a name: lanes by person come named; any other lane is its value. A lane that is an item the answer holds is a session's. */
export const lanesOf = (answer) => {
  const ids = new Set(answer.items.map((i) => i.id));
  return (answer.lanes ?? []).map((lane) => (lane && typeof lane === 'object' ? { key: lane.key, title: lane.title } : { key: lane, title: String(lane) })).map((l) => ({ ...l, session: ids.has(l.key) }));
};

/** What every layout shares: its sizes, its marks so far, and a block drawn so it opens its item. */
export function canvas(answer, style, width, story, height) {
  const z = (name) => {
    const v = style.sizes?.[`time_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "time_${name}": the house style (packs/canvas/pack.json) names every one a drawing uses`);
    return v;
  };
  const rules = new Set(), opens = new Map(), shown = [];
  const cut = cutAt(z('letter'));
  const hued = (hex) => (typeof hex === 'string' && HEX.test(hex) ? (rules.add(hueRule(hex)), hueClass(hex)) : 't-h-none');
  // A block is its colour; what it is, is said on hover. In a story it waits hidden until a step brings its item.
  const block = (b, rect, colour) => {
    // Keyed by what it is and where it falls, not by its turn: drawn again with a block more, each keeps its own mark.
    const key = `b:${b.item.id}:${b.start}:${Math.round(rect.x)}`;
    opens.set(key, b.item.id);
    shown.push({ key, ids: [b.item.id] });
    return m('g', { key, item: b.item.id, on: ['click'], class: group(b), role: 'link', ...(story && { opacity: 0 }) }, m('title', {}, rect.title), m('rect', { class: `dot${colour ? ` t-hued ${colour}` : ''}`, x: rect.x, y: rect.y, width: rect.width, height: rect.height, rx: z('round') }), rect.label && m('text', { class: 't-label', x: rect.x + z('inset'), y: rect.y + z('label_line') }, cut(rect.label, rect.width - z('text_room'))));
  };
  return { z, cut, width: Math.max(width || z('least_width'), z('narrowest')), height: height || 0, rules, opens, shown, hued, block };
}
