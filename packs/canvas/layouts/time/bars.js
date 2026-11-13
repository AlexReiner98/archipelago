// Bars (style layout: bars): each lane a row (each item its own when there are no lanes), its spans as bars across
// the days: a Gantt chart.

import { DAY, dayAt, dayOf, fmtDay } from './clock.js';
import { m } from './marks.js';
import { blocks, lanesOf, said } from './kit.js';

export function bars(answer, style, c) {
  const { z, cut, width } = c;
  const from = dayOf(answer.lens.time.from);
  const to = dayAt(dayOf(answer.lens.time.to), 1);
  const label = Math.min(z('bar_label_most'), width * style.numbers?.time_bar_label_share);
  const rowH = z('bar_row');
  const head = z('head');
  const inset = z('inset');
  const all = blocks(answer);
  const rows = answer.lanes?.length ? lanesOf(answer) : answer.items.filter((i) => i.time?.length).map((i) => ({ key: i.id, title: i.title }));
  const rowOf = (b) => rows.findIndex((r) => r.key === (answer.lanes?.length ? (b.item.lane ?? null) : b.item.id));
  const height = head + rows.length * rowH + inset;
  const x = (t) => label + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * (width - label - inset);
  const marks = [];
  const days = Math.round((to - from) / DAY);
  const every = Math.max(1, Math.ceil(days / Math.floor((width - label) / z('bar_day_every'))));
  for (let d = 0; d <= days; d += every) marks.push(m('line', { class: 't-rule', x1: x(dayAt(from, d)), x2: x(dayAt(from, d)), y1: 0, y2: height }), d < days && m('text', { class: 't-head', x: x(dayAt(from, d)) + z('lane_inset'), y: z('head_line') }, fmtDay(dayAt(from, d))));
  // A row of its own item's waits hidden in a story, as its bar does.
  rows.forEach((r, i) => marks.push(m('text', { class: 't-row', x: inset, y: head + i * rowH + z('bar_text_line'), ...(!answer.lanes?.length && c.story && { key: `r:${i}`, opacity: 0 }) }, m('title', {}, r.title), cut(r.title, label - z('key_room')))));
  if (!answer.lanes?.length && c.story) rows.forEach((r, i) => c.shown.push({ key: `r:${i}`, ids: [r.key] }));
  for (const b of all) {
    const i = rowOf(b);
    if (i < 0) continue;
    const x0 = x(b.start);
    marks.push(c.block(b, { title: said(b), x: x0, y: head + i * rowH + inset, width: Math.max(x(b.end) - x0, z('text_room')), height: rowH - inset * 2 }, null));
  }
  return { svg: m('svg', { key: 'tl', class: 'timeline', width, height, viewBox: `0 0 ${width} ${height}` }, marks), key: null };
}
