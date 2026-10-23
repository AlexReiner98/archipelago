// A lens answer drawn on its time axis. Two layouts of the same answer: a calendar (a column for each day, hours
// running down, each item a block where it falls) and bars (each lane a row, each item a bar across the days it
// covers: a Gantt chart). Colour is what a block counts toward (the part of the item it is in), else its kind; a name
// too long for its block is cut, and is whole in its tooltip. A block opens its item's page. It is drawn as wide as
// the page gives it (`width`), and laid out by the page: the frame does not pan or zoom it. Its look is ./look.js. A
// lens with steps tells the plan as it comes together (./story.js), the conversation beside it.

import { css, hueClass, hueRule } from './look.js';
import { m } from './marks.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';

const DAY = 86_400_000;
const KINDS = ['actor', 'aim', 'work', 'question', 'record', 'occurrence', 'place'];
const HEX = /^#[0-9a-f]{3,8}$/i;

/** The start of a day in this browser's time, from a date or a date-time. */
const dayOf = (value) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** As many letters as fit a width, at about `letter` pixels a letter (the style's time_letter). */
const cutAt = (letter) => (text, width) => {
  const n = Math.max(0, Math.floor(width / letter));
  return text.length <= n ? text : n > 1 ? `${text.slice(0, n - 1)}…` : '';
};

/** Every block an answer places: one for each span of each item. */
const blocks = (answer) =>
  answer.items.flatMap((item) =>
    (item.time ?? []).map((span) => ({ item, start: Date.parse(span.start), end: Math.max(Date.parse(span.end), Date.parse(span.start)), by: span.by, on: span.on_title, stream: span.stream !== undefined ? span.stream : item.stream })),
  );
const group = (item) => `t-block group-${KINDS.includes(item.kind) ? item.kind : 'system'}${item.open ? '' : ' closed'}`;
/** What a block is called: the work a session was on in that stretch, else the item itself. */
const nameOf = (b) => b.on ?? b.item.title;
const said = (b) => `${nameOf(b)}${b.on ? `\n${b.item.title}` : ''}\n${b.end - b.start >= DAY ? fmtDay(b.start) : `${fmtDay(b.start)}, ${fmtTime(b.start)}`}${b.end > b.start ? ` to ${b.end - b.start >= DAY ? fmtDay(b.end - 1) : fmtTime(b.end)}` : ''}${b.by === 'bound' ? ' (due)' : ''}`;
/** The lanes of an answer, each with a name: lanes by person come named; any other lane is its value. */
const lanesOf = (answer) => (answer.lanes ?? []).map((lane) => (lane && typeof lane === 'object' ? { key: lane.key, title: lane.title } : { key: lane, title: String(lane) }));

/** What every layout shares: its sizes, its marks so far, and a block drawn so it opens its item. */
function canvas(answer, style, width, story) {
  const z = (name) => {
    const v = style.sizes?.[`time_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "time_${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const rules = new Set(), opens = new Map(), shown = [];
  const hued = (hex) => (typeof hex === 'string' && HEX.test(hex) ? (rules.add(hueRule(hex)), hueClass(hex)) : 't-h-none');
  // A block is its colour; what it is, is said on hover. In a story it waits hidden until a step brings its item.
  const block = (b, rect, colour) => {
    const key = `b:${opens.size}`;
    opens.set(key, b.item.id);
    shown.push({ key, ids: [b.item.id] });
    return m('g', { key, on: ['click'], class: group(b.item), role: 'link', ...(story && { opacity: 0 }) }, m('title', {}, rect.title), m('rect', { class: `dot${colour ? ` t-hued ${colour}` : ''}`, x: rect.x, y: rect.y, width: rect.width, height: rect.height, rx: 3 }));
  };
  return { z, cut: cutAt(z('letter')), width: Math.max(width || 800, 320), rules, opens, shown, hued, block };
}

/**
 * A column for each day, hours running down; within a day, a column for each lane (each person, and the sessions), so
 * what you did and what the agents did sit side by side. A lane is as wide as the most things it holds at once that
 * week, so a busy lane has room and an empty one is a sliver. Blocks that overlap in a lane sit side by side in it.
 * The hours shown are those things fall in, the working day at least, unless the style says (hours).
 */
function calendar(answer, style, c) {
  const { z, cut, width } = c;
  const MIN_BLOCK = z('least_block');
  const from = dayOf(answer.lens.time.from);
  const days = Math.max(1, Math.round((dayOf(answer.lens.time.to) - from) / DAY) + 1);
  const all = blocks(answer);
  // A whole day or more (a due date, a week away) is not hours: it goes in a strip along the top, as calendars do.
  const whole = (b) => b.end - b.start >= DAY || b.by === 'bound';
  const timed = all.filter((b) => !whole(b));
  const hourOf = (t) => (t - dayOf(t)) / 3_600_000;
  const [h0, h1] = Array.isArray(style.hours) && style.hours.length === 2
    ? style.hours.map(Number)
    : [Math.min(z('day_start'), ...timed.map((b) => Math.floor(hourOf(b.start)))), Math.max(z('day_end'), ...timed.map((b) => (dayOf(b.end) > dayOf(b.start) ? 24 : Math.ceil(hourOf(b.end)))))];
  const lanes = lanesOf(answer);
  const laneOf = (b) => Math.max(0, lanes.findIndex((l) => l.key === (b.item.lane ?? null)));
  const gutter = z('gutter');
  const hourPx = z('hour');
  const colW = (width - gutter) / days;
  // What falls on each day within the hours shown, lane by lane, packed: things at the same time in a lane sit side by side.
  const packed = [...Array(days).keys()].map((d) => {
    const dayStart = from + d * DAY;
    const today = timed
      .map((b) => ({ ...b, s: Math.max(b.start, dayStart + h0 * 3_600_000), e: Math.min(b.end, dayStart + h1 * 3_600_000) }))
      .filter((b) => b.end > dayStart && b.start < dayStart + DAY && (b.e > b.s || b.start === b.end))
      .sort((a, b) => a.s - b.s);
    return [...Array(Math.max(lanes.length, 1)).keys()].map((i) => {
      const mine = lanes.length ? today.filter((b) => laneOf(b) === i) : today;
      // Each thing keeps one strip all day (a session's stretches one under another), and two things share a strip
      // only when they do not meet as drawn: a short stretch is drawn taller than it lasted.
      const drawnEnd = (b) => Math.max(b.e, b.s + (MIN_BLOCK / hourPx) * 3_600_000);
      const units = new Map();
      for (const b of mine) {
        const u = units.get(b.item.id) ?? { s: b.s, e: drawnEnd(b), blocks: [] };
        u.s = Math.min(u.s, b.s);
        u.e = Math.max(u.e, drawnEnd(b));
        u.blocks.push(b);
        units.set(b.item.id, u);
      }
      const cols = [];
      for (const u of [...units.values()].sort((a, b) => a.s - b.s)) {
        const col = cols.findIndex((end) => end <= u.s);
        const at = col < 0 ? cols.push(u.e) - 1 : col;
        cols[at] = Math.max(cols[at], u.e);
        for (const b of u.blocks) b.col = at;
      }
      return { mine, cols: cols.length };
    });
  });
  // Each lane as wide as the most it holds at once that week; one with nothing in hours a sliver.
  const weight = lanes.map((_, i) => Math.max(...packed.map((day) => day[i].cols)) || 0.25);
  const total = weight.reduce((sum, w) => sum + w, 0) || 1;
  // Each lane's left edge and width within a day.
  const laneX = [];
  lanes.reduce((x, _, i) => (laneX.push([x, (weight[i] / total) * colW]), x + (weight[i] / total) * colW), 0);
  const named = lanes.length > 1 && Math.min(...laneX.filter((_, i) => weight[i] >= 1).map(([, w]) => w)) >= z('lane_named_from');
  const chip = z('chip');
  const daysOf = (b) => [...Array(days).keys()].filter((d) => b.end > from + d * DAY && b.start < from + (d + 1) * DAY);
  const tops = all.filter(whole);
  const strip = Math.max(0, ...[...Array(days).keys()].map((d) => tops.filter((b) => daysOf(b).includes(d)).length));
  const top = named ? z('head_named') : z('head');
  const head = top + strip * chip;
  const height = head + (h1 - h0) * hourPx;
  const marks = [];
  for (let d = 0; d < days; d++) {
    const x = gutter + d * colW;
    marks.push(m('line', { class: 't-rule', x1: x, x2: x, y1: 0, y2: height }), m('text', { class: 't-head', x: x + 4, y: 15 }, cut(fmtDay(from + d * DAY), colW - 6)));
    // The lanes, named under the day where there is room, and parted by a fainter rule.
    lanes.forEach((l, i) => {
      const [lx, lw] = laneX[i];
      if (i > 0) marks.push(m('line', { class: 't-lane', x1: x + lx, x2: x + lx, y1: top, y2: height }));
      if (named && laneX[i][1] >= z('lane_named_from')) marks.push(m('text', { class: 't-hour', x: x + lx + 3, y: 30 }, m('title', {}, l.title), cut(l.title, lw - 6)));
    });
  }
  for (let hr = h0; hr <= h1; hr++) {
    const y = head + (hr - h0) * hourPx;
    marks.push(m('line', { class: 't-rule', x1: gutter, x2: width, y1: y, y2: y }), hr < h1 && m('text', { class: 't-hour', x: 2, y: y + 11 }, `${String(hr).padStart(2, '0')}:00`));
  }
  // What each block counts toward, as a colour of its own (the Time screen's colours, by project); none, the kind's colour.
  const streams = answer.streams ?? [];
  const hueOf = new Map(streams.map((st, k) => [st.key, style.hues[k % style.hues.length]]));
  const streamTitle = new Map(streams.map((st) => [st.key, st.title]));
  const place = (b, x, y, w, hgt) => {
    const title = [said(b), b.stream && streamTitle.get(b.stream), lanes.length > 1 && lanes[laneOf(b)].title].filter(Boolean).join('\n');
    marks.push(c.block(b, { title, x, y, width: Math.max(w, 3), height: hgt }, streams.length ? c.hued(hueOf.get(b.stream)) : null));
  };
  // The strip: each whole-day thing a bar across the days it covers, on the first row free on all of them.
  const rows = [];
  for (const b of tops) {
    const covers = daysOf(b);
    let row = 0;
    while (covers.some((d) => rows[row]?.has(d))) row++;
    rows[row] ??= new Set();
    for (const d of covers) rows[row].add(d);
    place(b, gutter + covers[0] * colW + 2, top - 1 + row * chip, covers.length * colW - 4, chip - 3);
  }
  for (let d = 0; d < days; d++) {
    const dayStart = from + d * DAY;
    for (let i = 0; i < Math.max(lanes.length, 1); i++) {
      const { mine } = packed[d][i];
      const [lx, lw] = lanes.length ? laneX[i] : [0, colW];
      // The same width for a column all week, so one session reads the same on a quiet day as on a busy one.
      const w = (lw - 4) / Math.max(lanes.length ? weight[i] : packed[d][i].cols, 1);
      // Down each strip, a block ends where the next begins: back-to-back stretches touch, never lie on each other.
      const at = mine.map((b) => ({ b, y: head + ((b.s - dayStart) / 3_600_000 - h0) * hourPx, hgt: Math.max(((b.e - b.s) / 3_600_000) * hourPx, MIN_BLOCK) })).sort((p, q) => p.b.col - q.b.col || p.y - q.y);
      // One too short to draw apart from the next (a session's minute here and minute there) is folded into it.
      at.forEach((p, k) => {
        const next = at[k + 1];
        if (!next || next.b.col !== p.b.col || next.y >= p.y + p.hgt) return;
        if (next.y - p.y < MIN_BLOCK) (next.hgt += next.y - p.y, next.y = p.y, p.gone = true);
        else p.hgt = next.y - p.y - 1;
      });
      for (const { b, y, hgt, gone } of at) if (!gone) place(b, gutter + d * colW + lx + 2 + b.col * w, y, w - 2, hgt);
    }
  }
  // The key: what the colours count toward this week, each a link to its page.
  const used = streams.filter((st) => all.some((b) => b.stream === st.key));
  const key = used.length ? m('div', { class: 't-key' }, used.map((st) => m('a', { href: `#/e/${st.key}`, title: st.title, class: c.hued(hueOf.get(st.key)) }, st.title))) : null;
  return { svg: m('svg', { class: 'timeline', width, height, viewBox: `0 0 ${width} ${height}` }, marks), key };
}

/** Each lane a row (each item its own when there are no lanes), its spans as bars across the days. */
function bars(answer, style, c) {
  const { z, cut, width } = c;
  const from = dayOf(answer.lens.time.from);
  const to = dayOf(answer.lens.time.to) + DAY;
  const label = Math.min(z('bar_label_most'), width * style.numbers?.time_bar_label_share);
  const rowH = z('bar_row');
  const head = z('head');
  const all = blocks(answer);
  const rows = answer.lanes?.length ? lanesOf(answer) : answer.items.filter((i) => i.time?.length).map((i) => ({ key: i.id, title: i.title }));
  const rowOf = (b) => rows.findIndex((r) => r.key === (answer.lanes?.length ? (b.item.lane ?? null) : b.item.id));
  const height = head + rows.length * rowH + 4;
  const x = (t) => label + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * (width - label - 4);
  const marks = [];
  const days = Math.round((to - from) / DAY);
  const every = Math.max(1, Math.ceil(days / Math.floor((width - label) / z('bar_day_every'))));
  for (let d = 0; d <= days; d += every) marks.push(m('line', { class: 't-rule', x1: x(from + d * DAY), x2: x(from + d * DAY), y1: 0, y2: height }), d < days && m('text', { class: 't-head', x: x(from + d * DAY) + 3, y: 15 }, fmtDay(from + d * DAY)));
  // A row of its own item's waits hidden in a story, as its bar does.
  rows.forEach((r, i) => marks.push(m('text', { class: 't-row', x: 4, y: head + i * rowH + 16, ...(!answer.lanes?.length && c.story && { key: `r:${i}`, opacity: 0 }) }, m('title', {}, r.title), cut(r.title, label - 10))));
  if (!answer.lanes?.length && c.story) rows.forEach((r, i) => c.shown.push({ key: `r:${i}`, ids: [r.key] }));
  for (const b of all) {
    const i = rowOf(b);
    if (i < 0) continue;
    const x0 = x(b.start);
    marks.push(c.block(b, { title: said(b), x: x0, y: head + i * rowH + 4, width: Math.max(x(b.end) - x0, 6), height: rowH - 8 }, null));
  }
  return { svg: m('svg', { class: 'timeline', width, height, viewBox: `0 0 ${width} ${height}` }, marks), key: null };
}

/** Draw a lens's answer along its time axis, in the style's layout, as wide as the page gives it (`width`). */
export function picture({ answer, style, width, reduced }, tools) {
  if (!answer.lens.time) return { scene: { message: 'This view has no time axis.' } };
  // A story lays out what its steps bring in, all of it, each block hidden until a step shows it.
  const story = Array.isArray(answer.steps) && answer.steps.length > 0;
  if (story) {
    const named = everyNamed(answer.steps);
    answer = { ...answer, items: answer.items.filter((i) => named.has(i.id) || i.id === answer.lens.from) };
  }
  const c = { ...canvas(answer, style, width, story), story };
  const { svg, key } = (style.layout === 'bars' ? bars : calendar)(answer, style, c);
  let player = null;
  if (story) {
    const frames = statesOf(answer.steps);
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks: c.shown, ...ctx }) } });
  }
  return {
    scene: { css: [css, ...c.rules, story ? storyCss : ''].join('\n'), svg, legend: key, flat: true, ...(player && { before: player.before, aside: player.after }) },
    end: player?.end,
    on(event) {
      if (player && (event.key === 'play' || event.key === 'chat' || event.key.startsWith('c:'))) return player.on(event);
      if (event.name === 'click' && c.opens.has(event.key)) tools.open(c.opens.get(event.key));
      return [];
    },
    restyle: () => [],
  };
}
