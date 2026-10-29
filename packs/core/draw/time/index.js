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
/** The start of the day so many days after another: a day is not always 24 hours (the clocks change). */
const dayAt = (day, n) => {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
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
function canvas(answer, style, width, story, height) {
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
  return { z, cut: cutAt(z('letter')), width: Math.max(width || 800, 320), height: height || 0, rules, opens, shown, hued, block };
}

/**
 * A column for each day, hours running down; within a day, a column for each lane (each person, and each session), so
 * what you did and what the agents did sit side by side. A lane takes room on the days it holds something, as wide as
 * the most it holds at once that day. Blocks that overlap in a lane sit side by side in it. The hours shown are those
 * things fall in, the working day at least, unless the style says (hours), as tall as the page has room for.
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
  const colW = (width - gutter) / days;
  const chip = z('chip');
  const daysOf = (b) => [...Array(days).keys()].filter((d) => b.end > dayAt(from, d) && b.start < dayAt(from, d + 1));
  const tops = all.filter(whole);
  const strip = Math.max(0, ...[...Array(days).keys()].map((d) => tops.filter((b) => daysOf(b).includes(d)).length));
  // Lanes are named under the day, where there is room.
  const top = lanes.length > 1 ? z('head_named') : z('head');
  const head = top + strip * chip;
  // What each block counts toward, a colour each for as many as the style has colours: the most drawn first, and
  // past the last colour but one, the rest together as Other in the muted colour (each still named on its block).
  const streams = answer.streams ?? [];
  const drawnOf = new Map();
  for (const b of all) if (b.stream) drawnOf.set(b.stream, (drawnOf.get(b.stream) ?? 0) + 1);
  const ranked = streams.filter((st) => drawnOf.has(st.key)).sort((a, b) => drawnOf.get(b.key) - drawnOf.get(a.key) || a.title.localeCompare(b.title));
  const hues = style.hues ?? [];
  const own = ranked.length > hues.length ? ranked.slice(0, Math.max(hues.length - 1, 0)) : ranked;
  const hueOf = new Map(own.map((st, k) => [st.key, hues[k]]));
  // The key, a day at a time under its column: what that day's blocks count toward, the most drawn that week first,
  // then Other. A colour means the same all week.
  const dayKeys = [...Array(days).keys()].map((d) => {
    const here = new Set(all.filter((b) => b.stream && daysOf(b).includes(d)).map((b) => b.stream));
    const mine = own.filter((st) => here.has(st.key));
    return [...mine.map((st) => ({ key: st.key, title: st.title, hex: hueOf.get(st.key) })), ...([...here].some((k) => !hueOf.has(k)) ? [{ key: null, title: 'Other', hex: undefined }] : [])];
  });
  const keyRows = Math.max(0, ...dayKeys.map((k) => k.length));
  const keyHeight = keyRows ? z('day_key_gap') + keyRows * z('day_key_row') : 0;
  // The hours as tall as the room the page gives, each day's key below them, so a week is read without scrolling;
  // never shorter than the style's least, nor taller than its hour.
  const room = c.height - head - z('fit_room') - keyHeight;
  const hourPx = c.height > 0 ? Math.max(z('hour_least'), Math.min(z('hour'), room / (h1 - h0))) : z('hour');
  // What falls on each day within the hours shown, lane by lane, packed: things at the same time in a lane sit side by side.
  const packed = [...Array(days).keys()].map((d) => {
    const dayStart = dayAt(from, d);
    const today = timed
      .map((b) => ({ ...b, s: Math.max(b.start, dayStart + h0 * 3_600_000), e: Math.min(b.end, dayStart + h1 * 3_600_000) }))
      .filter((b) => b.end > dayStart && b.start < dayAt(from, d + 1) && (b.e > b.s || b.start === b.end))
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
  // Each day's lanes, those that hold something that day, each as wide as the most it holds at once; one that holds
  // something is at least wide enough to be named where the day has room, so a person's few blocks are not a sliver
  // beside many sessions. Each lane's left edge, width and how many it holds at once, within its day.
  const least = z('lane_named_from');
  const laneXs = packed.map((day) => {
    const weight = day.map((p) => p.cols);
    const total = weight.reduce((sum, w) => sum + w, 0);
    if (!total) return day.map(() => [0, 0, 0]);
    const lifted = weight.map((w) => w >= 1 && (w / total) * colW < least);
    const owed = lifted.filter(Boolean).length * least;
    const rest = weight.reduce((sum, w, i) => sum + (lifted[i] ? 0 : w), 0) || 1;
    const widths = owed && owed < colW / 2 ? weight.map((w, i) => (lifted[i] ? least : (w / rest) * (colW - owed))) : weight.map((w) => (w / total) * colW);
    let x = 0;
    return widths.map((w, i) => ((x += w), [x - w, w, weight[i]]));
  });
  const height = head + (h1 - h0) * hourPx;
  const marks = [];
  for (let d = 0; d < days; d++) {
    const x = gutter + d * colW;
    marks.push(m('line', { class: 't-rule', x1: x, x2: x, y1: 0, y2: height }), m('text', { class: 't-head', x: x + 4, y: 15 }, cut(fmtDay(dayAt(from, d)), colW - 6)));
    // The lanes that day, named under the day where there is room, and parted by a fainter rule.
    if (lanes.length > 1)
      lanes.forEach((l, i) => {
        const [lx, lw] = laneXs[d][i];
        if (!lw) return;
        // A rule beside a lane wide enough to name; sessions too narrow to name run on unparted.
        const before = laneXs[d].slice(0, i).findLast(([, w]) => w > 0);
        if (lx > 0 && (lw >= least || before?.[1] >= least)) marks.push(m('line', { class: 't-lane', x1: x + lx, x2: x + lx, y1: top, y2: height }));
        if (lw >= least) marks.push(m('text', { class: 't-hour', x: x + lx + 3, y: 30 }, m('title', {}, l.title), cut(l.title, lw - 6)));
      });
  }
  for (let hr = h0; hr <= h1; hr++) {
    const y = head + (hr - h0) * hourPx;
    marks.push(m('line', { class: 't-rule', x1: gutter, x2: width, y1: y, y2: y }), hr < h1 && m('text', { class: 't-hour', x: 2, y: y + 11 }, `${String(hr).padStart(2, '0')}:00`));
  }
  // What each block counts toward, as its colour (Other muted); none, the kind's colour.
  const streamTitle = new Map(streams.map((st) => [st.key, st.title]));
  const place = (b, x, y, w, hgt) => {
    const title = [said(b), b.stream && streamTitle.get(b.stream), lanes.length > 1 && lanes[laneOf(b)].title].filter(Boolean).join('\n');
    marks.push(c.block(b, { title, x, y, width: Math.max(w, 3), height: hgt }, b.stream ? c.hued(hueOf.get(b.stream)) : null));
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
    const dayStart = dayAt(from, d);
    for (let i = 0; i < Math.max(lanes.length, 1); i++) {
      const { mine } = packed[d][i];
      const [lx, lw, most] = laneXs[d][i];
      if (!lw) continue;
      const w = (lw - 4) / Math.max(most, 1);
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
  // Each day's key under its column: a chip and the name, cut to the column, whole on hover; a name opens its page.
  const keyChip = z('day_key_chip');
  dayKeys.forEach((entries, d) =>
    entries.forEach((e, k) => {
      const x = gutter + d * colW + 4, y = height + z('day_key_gap') + k * z('day_key_row');
      const opens = e.key && `k:${d}:${k}`;
      if (opens) c.opens.set(opens, e.key);
      marks.push(m('g', { class: 't-day-key', ...(opens && { key: opens, on: ['click'], role: 'link' }) }, m('title', {}, e.title), m('rect', { class: c.hued(e.hex), x, y: y - keyChip, width: keyChip, height: keyChip, rx: 2 }), m('text', { class: 't-hour', x: x + keyChip + 4, y }, cut(e.title, colW - keyChip - 12))));
    }),
  );
  const tall = height + keyHeight;
  return { svg: m('svg', { class: 'timeline', width, height: tall, viewBox: `0 0 ${width} ${tall}` }, marks), key: null };
}

/** Each lane a row (each item its own when there are no lanes), its spans as bars across the days. */
function bars(answer, style, c) {
  const { z, cut, width } = c;
  const from = dayOf(answer.lens.time.from);
  const to = dayAt(dayOf(answer.lens.time.to), 1);
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
  for (let d = 0; d <= days; d += every) marks.push(m('line', { class: 't-rule', x1: x(dayAt(from, d)), x2: x(dayAt(from, d)), y1: 0, y2: height }), d < days && m('text', { class: 't-head', x: x(dayAt(from, d)) + 3, y: 15 }, fmtDay(dayAt(from, d))));
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
export function picture({ answer, style, width, height, reduced }, tools) {
  if (!answer.lens.time) return { scene: { message: 'This view has no time axis.' } };
  // A story lays out what its steps bring in, all of it, each block hidden until a step shows it.
  const story = Array.isArray(answer.steps) && answer.steps.length > 0;
  if (story) {
    const named = everyNamed(answer.steps);
    answer = { ...answer, items: answer.items.filter((i) => named.has(i.id) || i.id === answer.lens.from) };
  }
  const c = { ...canvas(answer, style, width, story, height), story };
  const { svg, key } = (style.layout === 'bars' ? bars : calendar)(answer, style, c);
  let player = null;
  if (story) {
    const frames = statesOf(answer.steps);
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks: c.shown, ...ctx }) } });
  }
  // A calendar fits its hours to the height it is given: drawn again when that settles (`shaped`).
  return {
    scene: { css: [css, ...c.rules, story ? storyCss : ''].join('\n'), svg, key, flat: true, ...(style.layout !== 'bars' && { shaped: true }), ...(player && { before: player.before, aside: player.after }) },
    end: player?.end,
    on(event) {
      if (player && (event.key === 'play' || event.key === 'chat' || event.key.startsWith('c:'))) return player.on(event);
      if (event.name === 'click' && c.opens.has(event.key)) tools.open(c.opens.get(event.key));
      return [];
    },
    restyle: () => [],
  };
}
