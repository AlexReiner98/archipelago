// Beside the calendar, what the view's pack says of the days in sight (its `aside`, asked through the view's sends):
// bands of rows, each a band's title and its rows, one line each, with the one or two acts a row offers. The drawing
// names nothing of the pack: it draws what it is given, and a press asks the page for the act the row names
// (index.js), which the page calls as the person once it has asked them what the act asks.
//
// The answer it draws: { title, value, bands: [{ title, act, rows: [{ title, item, note, value, tone, acts }], empty }] },
// an act { label, act, params, asks, title }. Its look is ./look.js.

import { m } from './marks.js';

const TONES = new Set(['accent', 'muted', 'ok', 'warn', 'bad', 'closed']);
const text = (v, most) => String(v ?? '').slice(0, most);

/** The bands as marks, and each press's act by its mark's key. Nothing to draw: null. */
export function aside(said, z) {
  const [T, TIP, ROWS] = [z('aside_text_most'), z('aside_tip_most'), z('aside_rows_most')];
  const acts = new Map();
  if (!said || !Array.isArray(said.bands)) return { mark: null, acts };
  const press = (key, a) => {
    if (!a || typeof a.act !== 'string') return null;
    acts.set(key, a);
    return m('button', { key, on: ['click'], class: 'ta-act', title: text(a.title ?? a.label, TIP) }, text(a.label, T));
  };
  const row = (r, b, k) =>
    m(
      'li',
      { class: 'ta-row', ...(TONES.has(r.tone) && { 'aria-label': r.tone }) },
      /^e_[a-z\d]+$/.test(String(r.item)) ? m('a', { class: 'ta-name', href: `#/e/${r.item}`, title: text([r.title, r.note].filter(Boolean).join('\n'), TIP) }, text(r.title, T)) : m('span', { class: 'ta-name', title: text(r.title, TIP) }, text(r.title, T)),
      r.note && m('span', { class: 'ta-note', title: text(r.note, TIP) }, text(r.note, T)),
      r.value != null && m('span', { class: `ta-value${TONES.has(r.tone) ? ` tone-${r.tone}` : ''}` }, text(r.value, T)),
      ...(Array.isArray(r.acts) ? r.acts.slice(0, 2) : []).map((a, n) => press(`ta:${b}:${k}:${n}`, a)),
    );
  const bands = said.bands.slice(0, ROWS).map((band, b) =>
    m(
      'div',
      { class: 'ta-band' },
      m('div', { class: 'ta-head' }, m('span', { class: 'ta-title', title: text(band.title, TIP) }, text(band.title, T)), press(`ta:${b}:all`, band.act)),
      Array.isArray(band.rows) && band.rows.length ? m('ul', { class: 'ta-rows' }, ...band.rows.slice(0, ROWS).map((r, k) => row(r, b, k))) : m('div', { class: 'ta-empty' }, text(band.empty ?? 'Nothing.', T)),
    ),
  );
  const head = said.title && m('div', { class: 'ta-head ta-top' }, m('span', { class: 'ta-title' }, text(said.title, T)), said.value != null && m('strong', { class: 'ta-value' }, text(said.value, T)));
  return { mark: m('div', { key: 'ta', class: 't-aside' }, head, ...bands), acts };
}
