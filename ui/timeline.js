// The kernel's drawing of a lens on a time axis. Two layouts of the same answer: a calendar (a column for each day,
// hours running down, each item a block where it falls) and bars (each lane a row, each item a bar across the
// days it covers: a Gantt chart). Colour is what a block counts toward (the part of the item it is in), else its kind; a name too long for its block is cut, and is whole in
// its tooltip. Nothing is written here: an item opens on its own page.

import { GRID_HUES } from './grid.js';

const SVG = 'http://www.w3.org/2000/svg';
const DAY = 86_400_000;
/** The least height a block is drawn, in pixels: a stretch of minutes is still there to point at. */
const MIN_BLOCK = 6;
const KINDS = ['actor', 'aim', 'work', 'question', 'record', 'occurrence', 'place'];

/** How the drawing's parts look, set through the CSSOM (the page allows no inline style attributes). Colours are the page's. */
const LOOK = {
  't-rule': 'stroke: var(--line); stroke-width: 1',
  't-head': 'fill: var(--muted); font-size: 11px',
  't-hour': 'fill: var(--muted); font-size: 10px',
  't-row': 'fill: var(--text); font-size: 12px',
  't-lane': 'stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 3',
};

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  const look = LOOK[attrs.class] ?? (String(attrs.class).startsWith('t-block') ? 'cursor: pointer' : undefined);
  if (look) el.style.cssText = look;
  el.append(...kids.filter(Boolean));
  return el;
};
const tip = (text) => svg('title', {}, text);
/** The start of a day in this browser's time, from a date or a date-time. */
const dayOf = (value) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** As many letters as fit a width, at about 6.5 px a letter. */
const cut = (text, width) => {
  const n = Math.max(0, Math.floor(width / 6.5));
  return text.length <= n ? text : n > 1 ? `${text.slice(0, n - 1)}…` : '';
};

/** Every block an answer places: one for each span of each item. */
function blocks(answer) {
  return answer.items.flatMap((item) =>
    (item.time ?? []).map((span) => ({ item, start: Date.parse(span.start), end: Math.max(Date.parse(span.end), Date.parse(span.start)), by: span.by, on: span.on_title, stream: span.stream !== undefined ? span.stream : item.stream })),
  );
}

const group = (item) => `t-block group-${KINDS.includes(item.kind) ? item.kind : 'system'}${item.open ? '' : ' closed'}`;
const open = (item) => () => (location.hash = `#/e/${item.id}`);
/** What a block is called: the work a session was on in that stretch, else the item itself. */
const nameOf = (b) => b.on ?? b.item.title;
const said = (b) => `${nameOf(b)}${b.on ? `\n${b.item.title}` : ''}\n${b.end - b.start >= DAY ? fmtDay(b.start) : `${fmtDay(b.start)}, ${fmtTime(b.start)}`}${b.end > b.start ? ` to ${b.end - b.start >= DAY ? fmtDay(b.end - 1) : fmtTime(b.end)}` : ''}${b.by === 'bound' ? ' (due)' : ''}`;

/** The lanes of an answer, each with a name: lanes by person come named; any other lane is its value. */
const lanesOf = (answer) => (answer.lanes ?? []).map((lane) => (lane && typeof lane === 'object' ? { key: lane.key, title: lane.title } : { key: lane, title: String(lane) }));
/** The lane the sessions on the work are filed in: drawn narrow, as many columns as were at work at once. */
const SESSIONS = 'sessions';

/**
 * A column for each day, hours running down; within a day, a column for each lane (each person, and the sessions), so
 * what you did and what the agents did sit side by side. A lane is as wide as the most things it holds at once that
 * week, so a busy lane has room and an empty one is a sliver. Blocks that overlap in a lane sit side by side in it.
 * The hours shown are those things fall in, the working day at least, unless the style says (hours).
 */
function calendar(host, answer, style) {
  const from = dayOf(answer.lens.time.from);
  const days = Math.max(1, Math.round((dayOf(answer.lens.time.to) - from) / DAY) + 1);
  const all = blocks(answer);
  // A whole day or more (a due date, a week away) is not hours: it goes in a strip along the top, as calendars do.
  const whole = (b) => b.end - b.start >= DAY || b.by === 'bound';
  const timed = all.filter((b) => !whole(b));
  const hourOf = (t) => (t - dayOf(t)) / 3_600_000;
  const [h0, h1] = Array.isArray(style.hours) && style.hours.length === 2
    ? style.hours.map(Number)
    : [Math.min(8, ...timed.map((b) => Math.floor(hourOf(b.start)))), Math.max(18, ...timed.map((b) => (dayOf(b.end) > dayOf(b.start) ? 24 : Math.ceil(hourOf(b.end)))))];
  const lanes = lanesOf(answer);
  const laneOf = (b) => Math.max(0, lanes.findIndex((l) => l.key === (b.item.lane ?? null)));
  const width = Math.max(host.clientWidth || 800, 320);
  const gutter = 38;
  const hourPx = 34;
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
  const named = lanes.length > 1 && Math.min(...laneX.filter((_, i) => weight[i] >= 1).map(([, w]) => w)) >= 28;
  const chip = 18;
  const daysOf = (b) => [...Array(days).keys()].filter((d) => b.end > from + d * DAY && b.start < from + (d + 1) * DAY);
  const tops = all.filter(whole);
  const strip = Math.max(0, ...[...Array(days).keys()].map((d) => tops.filter((b) => daysOf(b).includes(d)).length));
  const top = named ? 36 : 22;
  const head = top + strip * chip;
  const height = head + (h1 - h0) * hourPx;
  const out = svg('svg', { class: 'timeline', width, height, viewBox: `0 0 ${width} ${height}` });
  for (let d = 0; d < days; d++) {
    const x = gutter + d * colW;
    out.append(svg('line', { class: 't-rule', x1: x, x2: x, y1: 0, y2: height }), svg('text', { class: 't-head', x: x + 4, y: 15 }, cut(fmtDay(from + d * DAY), colW - 6)));
    // The lanes, named under the day where there is room, and parted by a fainter rule.
    lanes.forEach((l, i) => {
      const [lx, lw] = laneX[i];
      if (i > 0) out.append(svg('line', { class: 't-lane', x1: x + lx, x2: x + lx, y1: top, y2: height }));
      if (named && laneX[i][1] >= 28) out.append(svg('text', { class: 't-hour', x: x + lx + 3, y: 30 }, tip(l.title), cut(l.title, lw - 6)));
    });
  }
  for (let hr = h0; hr <= h1; hr++) {
    const y = head + (hr - h0) * hourPx;
    out.append(svg('line', { class: 't-rule', x1: gutter, x2: width, y1: y, y2: y }), hr < h1 && svg('text', { class: 't-hour', x: 2, y: y + 11 }, `${String(hr).padStart(2, '0')}:00`));
  }
  // What each block counts toward, as a colour of its own (the Time screen's colours, by project); none, the kind's colour.
  const streams = answer.streams ?? [];
  const hueOf = new Map(streams.map((st, k) => [st.key, GRID_HUES[k % GRID_HUES.length]]));
  const streamTitle = new Map(streams.map((st) => [st.key, st.title]));
  const place = (b, x, y, w, hgt) => {
    const title = [said(b), b.stream && streamTitle.get(b.stream), lanes.length > 1 && lanes[laneOf(b)].title].filter(Boolean).join('\n');
    const box = svg('rect', { class: 'dot', x, y, width: Math.max(w, 3), height: hgt, rx: 3 });
    if (streams.length) box.style.fill = hueOf.get(b.stream) ?? 'var(--muted)';
    // A block is its colour; what it is, is said on hover.
    out.append(svg('g', { class: group(b.item), tabindex: 0, role: 'link' }, tip(title), box));
    out.lastChild.addEventListener('click', open(b.item));
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
      for (const b of mine) place(b, gutter + d * colW + lx + 2 + b.col * w, head + ((b.s - dayStart) / 3_600_000 - h0) * hourPx, w - 2, Math.max(((b.e - b.s) / 3_600_000) * hourPx, MIN_BLOCK));
    }
  }
  // The key: what the colours count toward this week, each a link to its page.
  const used = streams.filter((st) => all.some((b) => b.stream === st.key));
  const key = document.createElement('div');
  key.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 8px 12px; font-size: 12px; color: var(--muted)';
  for (const st of used) {
    const a = Object.assign(document.createElement('a'), { href: `#/e/${st.key}`, title: st.title, textContent: st.title });
    a.style.cssText = `color: inherit; text-decoration: none; white-space: nowrap; max-width: 28ch; overflow: hidden; text-overflow: ellipsis; border-left: 10px solid ${hueOf.get(st.key)}; padding-left: 6px`;
    key.append(a);
  }
  host.replaceChildren(out, ...(used.length ? [key] : []));
}

/** Each lane a row (each item its own when there are no lanes), its spans as bars across the days. */
function bars(host, answer) {
  const from = dayOf(answer.lens.time.from);
  const to = dayOf(answer.lens.time.to) + DAY;
  const width = Math.max(host.clientWidth || 800, 320);
  const label = Math.min(220, width * 0.3);
  const rowH = 24;
  const head = 22;
  const all = blocks(answer);
  const rows = answer.lanes?.length ? lanesOf(answer) : answer.items.filter((i) => i.time?.length).map((i) => ({ key: i.id, title: i.title }));
  const rowOf = (b) => rows.findIndex((r) => r.key === (answer.lanes?.length ? (b.item.lane ?? null) : b.item.id));
  const height = head + rows.length * rowH + 4;
  const x = (t) => label + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * (width - label - 4);
  const out = svg('svg', { class: 'timeline', width, height, viewBox: `0 0 ${width} ${height}` });
  const days = Math.round((to - from) / DAY);
  const every = Math.max(1, Math.ceil(days / Math.floor((width - label) / 70)));
  for (let d = 0; d <= days; d += every) out.append(svg('line', { class: 't-rule', x1: x(from + d * DAY), x2: x(from + d * DAY), y1: 0, y2: height }), d < days && svg('text', { class: 't-head', x: x(from + d * DAY) + 3, y: 15 }, fmtDay(from + d * DAY)));
  rows.forEach((r, i) => out.append(svg('text', { class: 't-row', x: 4, y: head + i * rowH + 16 }, tip(r.title), cut(r.title, label - 10))));
  for (const b of all) {
    const i = rowOf(b);
    if (i < 0) continue;
    const x0 = x(b.start);
    const w = Math.max(x(b.end) - x0, 6);
    out.append(svg('g', { class: group(b.item), tabindex: 0, role: 'link' }, tip(said(b)), svg('rect', { class: 'dot', x: x0, y: head + i * rowH + 4, width: w, height: rowH - 8, rx: 3 })));
    out.lastChild.addEventListener('click', open(b.item));
  }
  host.replaceChildren(out);
}

/** Draw a lens's answer along its time axis, in the style's layout. */
export function drawTime(host, answer, style) {
  if (!answer.lens.time) return host.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'This view has no time axis.' }));
  (style.layout === 'bars' ? bars : calendar)(host, answer, style);
}
