// The island picker at the canvas's foot, in place of find (decision e_n42s8jvn, the owner, 17 Nov 2026): the islands
// a person has on, in one line, and a search that finds islands by their name or by anything on them. A row toggles
// its island on or off; the islands on are what Home draws. The live reads are toggled here too.

import { api, h } from './base.js';
import { READS, islandsOn, onIslands, toggle } from './islands-on.js';
import { titles } from './words.js';

/** What a live read is called in a row. */
const READ_NAMES = { frontier: 'Frontier', attention: 'Attention' };

/** The name of an island or a live read, read once where the page does not know it. */
async function nameOf(id) {
  if (READ_NAMES[id]) return READ_NAMES[id];
  if (!titles.has(id)) await api('get', { id }).then((got) => titles.set(id, got.entity.title), () => {});
  return titles.get(id) ?? id;
}

/** Each island a search finds, once: an island by its own name, or the island of an item found on it. */
async function found(q) {
  const hits = await api('search', { q, limit: 20 }).catch(() => []);
  const out = new Map();
  for (const e of hits) {
    const island = e.props?.island;
    if (!island || out.has(island)) continue;
    out.set(island, island === e.id ? null : e.title);
  }
  const rows = [...out];
  await Promise.all(rows.map(([id]) => nameOf(id)));
  return rows.map(([id, via]) => ({ id, via }));
}

/** Draw the picker in #find, once a page. */
export function drawPicker() {
  const form = document.getElementById('find');
  if (!form || form.dataset.picker) return;
  form.dataset.picker = 'on';
  const rows = h('div', { class: 'isl-rows', role: 'listbox', 'aria-label': 'Islands', hidden: true });
  const on = h('div', { class: 'isl-on', role: 'group', 'aria-label': 'On the canvas' });
  const input = h('input', { class: 'isl-find', type: 'search', placeholder: 'Islands', 'aria-label': 'Find an island', autocomplete: 'off' });
  const icon = form.querySelector('.find-icon');
  form.replaceChildren(rows, h('div', { class: 'find-row' }, icon ?? '', on, input));
  let list = [];
  let shown = [];
  let asked = 0;

  const row = ({ id, via }) =>
    h('button', { type: 'button', class: 'isl-row', role: 'option', 'aria-selected': String(list.includes(id)), title: list.includes(id) ? 'Take off the canvas' : 'Put on the canvas', onclick: () => flip(id) },
      h('span', { class: 'isl-mark', 'aria-hidden': 'true' }, list.includes(id) ? '✓' : ''),
      h('span', { class: 'isl-name' }, titles.get(id) ?? READ_NAMES[id] ?? id),
      via ? h('span', { class: 'isl-via' }, via) : '');
  const drawRows = () => {
    rows.replaceChildren(...shown.map(row));
    rows.hidden = !shown.length || document.activeElement !== input;
  };
  /** What the rows offer: with nothing typed, what is on and the live reads; else what the search finds. */
  const offer = async () => {
    const q = input.value.trim();
    const mine = ++asked;
    const next = q ? await found(q) : [...new Set([...list, ...READS])].map((id) => ({ id }));
    if (!q) await Promise.all(next.map((r) => nameOf(r.id)));
    if (mine !== asked) return;
    shown = next;
    drawRows();
  };
  const drawOn = async () => {
    await Promise.all(list.map(nameOf));
    on.replaceChildren(...list.map((id) => h('button', { type: 'button', class: 'isl-name', title: `${titles.get(id) ?? READ_NAMES[id]}: take off the canvas`, onclick: () => flip(id) }, titles.get(id) ?? READ_NAMES[id] ?? id)));
  };
  const flip = (id) => toggle(id, titles.get(id) ?? READ_NAMES[id]).catch((err) => console.warn(err.message));

  input.addEventListener('input', offer);
  input.addEventListener('focus', offer);
  input.addEventListener('blur', () => (rows.hidden = true));
  // A press on a row keeps the field's focus, so the rows stay up to toggle several.
  rows.addEventListener('pointerdown', (ev) => ev.preventDefault());
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') return void ((input.value = ''), input.blur());
    if (ev.key === 'Enter' && shown[0]) (ev.preventDefault(), flip(shown[0].id));
  });
  form.addEventListener('submit', (ev) => ev.preventDefault());
  const heard = (now) => ((list = now), drawOn(), drawRows());
  onIslands(heard);
  islandsOn().then(heard);
}
