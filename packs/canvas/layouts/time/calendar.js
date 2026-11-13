// The calendar: a column for each day, hours running down; within a day, a column for each lane (each person, and
// each session), so what you did and what the agents did sit side by side. A lane takes room on the days it holds
// something, as wide as the most it holds at once that day, and the first person's lane always (it is where time is
// added). Blocks that overlap in a lane sit side by side in it. The hours shown are those things fall in, the working
// day at least, unless the style says (hours), as tall as the page has room for. Today's column is marked, and each
// day's head says the hours worked in its people's lanes. Where the view sends `add`, each hour of the first person's
// lane is a mark to click, which adds a block there (index.js asks for it).

import { DAY, HOUR, dayAt, dayOf, fmtDay } from './clock.js';
import { m } from './marks.js';
import { blocks, lanesOf, nameOf, planned, said } from './kit.js';

/** Hours as words: 1.5 h. */
export const hoursText = (n) => `${Math.round(n * 100) / 100} h`;

export function calendar(answer, style, c, adds) {
  const { z, cut, width } = c;
  const MIN_BLOCK = z('least_block');
  const from = dayOf(answer.lens.time.from);
  const days = Math.max(1, Math.round((dayOf(answer.lens.time.to) - from) / DAY) + 1);
  // What falls on the days drawn: the rest of the window does not take a colour from what is in sight.
  const all = blocks(answer).filter((b) => b.end >= from && b.start < dayAt(from, days));
  // A whole day or more (a due date, a week away, hours logged with no time of day) is not hours: it goes in a strip along the top, as calendars do.
  const whole = (b) => b.end - b.start >= DAY || b.by === 'bound' || (b.end === b.start && b.start === dayOf(b.start));
  const timed = all.filter((b) => !whole(b));
  const hourOf = (t) => (t - dayOf(t)) / HOUR;
  const [h0, h1] = Array.isArray(style.hours) && style.hours.length === 2
    ? style.hours.map(Number)
    : [Math.min(z('day_start'), ...timed.map((b) => Math.floor(hourOf(b.start)))), Math.max(z('day_end'), ...timed.map((b) => (dayOf(b.end) > dayOf(b.start) ? DAY / HOUR : Math.ceil(hourOf(b.end)))))];
  const lanes = lanesOf(answer);
  const laneOf = (b) => Math.max(0, lanes.findIndex((l) => l.key === (b.item.lane ?? null)));
  // The first person's lane is where a block is added: kept open on every day when the view adds.
  const mine = adds ? Math.max(0, lanes.findIndex((l) => !l.session)) : -1;
  const gutter = z('gutter');
  const colW = (width - gutter) / days;
  const chip = z('chip');
  const daysOf = (b) => [...Array(days).keys()].filter((d) => (b.end > dayAt(from, d) || b.start === dayAt(from, d)) && b.start < dayAt(from, d + 1));
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
    const ours = own.filter((st) => here.has(st.key));
    return [...ours.map((st) => ({ key: st.key, title: st.title, hex: hueOf.get(st.key) })), ...([...here].some((k) => !hueOf.has(k)) ? [{ key: null, title: 'Other', hex: undefined }] : [])];
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
      .map((b) => ({ ...b, s: Math.max(b.start, dayStart + h0 * HOUR), e: Math.min(b.end, dayStart + h1 * HOUR) }))
      .filter((b) => b.end > dayStart && b.start < dayAt(from, d + 1) && (b.e > b.s || b.start === b.end))
      .sort((a, b) => a.s - b.s);
    return [...Array(Math.max(lanes.length, 1)).keys()].map((i) => {
      const held = lanes.length ? today.filter((b) => laneOf(b) === i) : today;
      // Each thing keeps one strip all day (a session's stretches one under another), and two things share a strip
      // only when they do not meet as drawn: a short stretch is drawn taller than it lasted.
      const drawnEnd = (b) => Math.max(b.e, b.s + (MIN_BLOCK / hourPx) * HOUR);
      const units = new Map();
      for (const b of held) {
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
      return { held, cols: Math.max(cols.length, i === mine ? 1 : 0) };
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
  const inset = z('inset');
  const marks = [];
  const now = Date.now();
  // Hours worked that day in its people's lanes: time set aside is not yet worked, and a session's is not yours.
  const worked = (d) =>
    timed.filter((b) => !planned(b) && !lanes[laneOf(b)]?.session && daysOf(b).includes(d)).reduce((n, b) => n + (Math.min(b.end, dayAt(from, d + 1)) - Math.max(b.start, dayAt(from, d))) / HOUR, 0) +
    tops.filter((b) => !planned(b) && !lanes[laneOf(b)]?.session && b.end === b.start && daysOf(b).includes(d)).reduce((n, b) => n + (Number(b.item.fields?.hours) || 0), 0);
  for (let d = 0; d < days; d++) {
    const x = gutter + d * colW;
    if (now >= dayAt(from, d) && now < dayAt(from, d + 1)) marks.push(m('rect', { class: 't-today', x, y: 0, width: colW, height }));
    const hrs = worked(d);
    const headText = hrs > 0 ? `${fmtDay(dayAt(from, d))} · ${hoursText(hrs)}` : fmtDay(dayAt(from, d));
    marks.push(m('line', { class: 't-rule', x1: x, x2: x, y1: 0, y2: height }), m('text', { class: 't-head', x: x + inset, y: z('head_line') }, m('title', {}, headText), cut(headText, colW - z('text_room'))));
    // The lanes that day, named under the day where there is room, and parted by a fainter rule.
    if (lanes.length > 1)
      lanes.forEach((l, i) => {
        const [lx, lw] = laneXs[d][i];
        if (!lw) return;
        // A rule beside a lane wide enough to name; sessions too narrow to name run on unparted.
        const before = laneXs[d].slice(0, i).findLast(([, w]) => w > 0);
        if (lx > 0 && (lw >= least || before?.[1] >= least)) marks.push(m('line', { class: 't-lane', x1: x + lx, x2: x + lx, y1: top, y2: height }));
        if (lw >= least) marks.push(m('text', { class: 't-hour', x: x + lx + z('lane_inset'), y: z('lane_line') }, m('title', {}, l.title), cut(l.title, lw - z('text_room'))));
      });
  }
  for (let hr = h0; hr <= h1; hr++) {
    const y = head + (hr - h0) * hourPx;
    marks.push(m('line', { class: 't-rule', x1: gutter, x2: width, y1: y, y2: y }), hr < h1 && m('text', { class: 't-hour', x: 2, y: y + z('hour_line') }, `${String(hr).padStart(2, '0')}:00`));
  }
  // An hour of the first person's lane, each day, is a mark to click: a block is added there.
  const slots = new Map();
  if (mine >= 0)
    for (let d = 0; d < days; d++) {
      const [lx, lw] = laneXs[d][mine];
      if (!lw) continue;
      for (let hr = h0; hr < h1; hr++) {
        const key = `slot:${d}:${hr}`;
        slots.set(key, { start: dayAt(from, d) + hr * HOUR, end: dayAt(from, d) + (hr + 1) * HOUR });
        marks.push(m('rect', { key, on: ['click'], class: 't-slot', x: gutter + d * colW + lx, y: head + (hr - h0) * hourPx, width: lw, height: hourPx }, m('title', {}, `Add a block at ${String(hr).padStart(2, '0')}:00, ${fmtDay(dayAt(from, d))}`)));
      }
    }
  // What each block counts toward, as its colour (Other muted); none, its type's colour.
  const streamTitle = new Map(streams.map((st) => [st.key, st.title]));
  const place = (b, x, y, w, hgt) => {
    const title = [said(b), b.stream && streamTitle.get(b.stream), lanes.length > 1 && lanes[laneOf(b)].title].filter(Boolean).join('\n');
    marks.push(c.block(b, { title, x, y, width: Math.max(w, 2), height: hgt, ...(hgt >= z('label_least') && { label: nameOf(b) }) }, b.stream ? c.hued(hueOf.get(b.stream)) : null));
  };
  // The strip: each whole-day thing a bar across the days it covers, on the first row free on all of them.
  const rows = [];
  for (const b of tops) {
    const covers = daysOf(b);
    let row = 0;
    while (covers.some((d) => rows[row]?.has(d))) row++;
    rows[row] ??= new Set();
    for (const d of covers) rows[row].add(d);
    place(b, gutter + covers[0] * colW + 2, top - 1 + row * chip, covers.length * colW - inset, chip - z('chip_room'));
  }
  for (let d = 0; d < days; d++) {
    const dayStart = dayAt(from, d);
    for (let i = 0; i < Math.max(lanes.length, 1); i++) {
      const { held } = packed[d][i];
      const [lx, lw, most] = laneXs[d][i];
      if (!lw) continue;
      const w = (lw - inset) / Math.max(most, 1);
      // Down each strip, a block ends where the next begins: back-to-back stretches touch, never lie on each other.
      const at = held.map((b) => ({ b, y: head + ((b.s - dayStart) / HOUR - h0) * hourPx, hgt: Math.max(((b.e - b.s) / HOUR) * hourPx, MIN_BLOCK) })).sort((p, q) => p.b.col - q.b.col || p.y - q.y);
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
      const x = gutter + d * colW + inset, y = height + z('day_key_gap') + k * z('day_key_row');
      const opens = e.key && `k:${d}:${e.key}`;
      if (opens) c.opens.set(opens, e.key);
      marks.push(m('g', { class: 't-day-key', ...(opens && { key: opens, on: ['click'], role: 'link' }) }, m('title', {}, e.title), m('rect', { class: c.hued(e.hex), x, y: y - keyChip, width: keyChip, height: keyChip, rx: 2 }), m('text', { class: 't-hour', x: x + keyChip + inset, y }, cut(e.title, colW - keyChip - z('key_room')))));
    }),
  );
  const tall = height + keyHeight;
  return { svg: m('svg', { key: 'tl', class: 'timeline', width, height: tall, viewBox: `0 0 ${width} ${tall}` }, marks), key: null, slots };
}
