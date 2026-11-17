// The island palette (Alex, 17 Nov 2026): Ctrl+K (⌘K) over the canvas, a line to type in and the islands it finds, best
// first, each a row with its pack's mark and its pack. Enter puts the one lit on; Shift+Enter shows it alone. It reads
// the side list's own search (./islands-list.js, rankIslands), handed what it acts with by ./island-picker.js.

import { h } from './base.js';
import { rankIslands } from './islands-list.js';

/** Start the palette: Ctrl+K or ⌘K opens it, Escape or a press outside shuts it. `with` is the picker's reads and acts. */
export function openPalette({ all, drawn, putOn, showOnly, mark }) {
  const input = h('input', { class: 'pal-find', type: 'search', placeholder: 'Put an island on', 'aria-label': 'Find an island to put on', autocomplete: 'off', role: 'combobox', 'aria-controls': 'pal-rows', 'aria-expanded': 'true' });
  const rows = h('div', { id: 'pal-rows', class: 'pal-rows', role: 'listbox', 'aria-label': 'Islands' });
  const box = h('div', { class: 'pal-box', role: 'dialog', 'aria-label': 'Islands' }, input, rows);
  const veil = h('div', { id: 'palette', hidden: true }, box);
  document.body.append(veil);
  let islands = [];
  let found = [];
  let lit = 0;

  const draw = () => {
    found = rankIslands(islands, input.value);
    lit = Math.min(lit, Math.max(0, found.length - 1));
    const on = drawn();
    rows.replaceChildren(
      ...found.map((i, n) =>
        h('div', { class: 'pal-row', role: 'option', id: `pal-${i.id}`, 'aria-selected': String(n === lit), title: on.includes(i.id) ? `${i.title}: on the canvas` : i.title, onpointerdown: (ev) => ev.preventDefault(), onclick: () => choose(i, false) },
          mark(i.pack),
          h('span', { class: 'pal-name' }, i.title),
          h('span', { class: 'pal-pack' }, on.includes(i.id) ? `on · ${i.pack.title || i.pack.id}` : i.pack.title || i.pack.id)),
      ),
    );
    if (found[lit]) input.setAttribute('aria-activedescendant', `pal-${found[lit].id}`);
    rows.children[lit]?.scrollIntoView({ block: 'nearest' });
  };
  const shut = () => ((veil.hidden = true), (input.value = ''));
  const open = async () => {
    veil.hidden = false;
    lit = 0;
    input.focus();
    islands = await all();
    draw();
  };
  const choose = (i, alone) => (shut(), alone ? showOnly(i) : putOn(i));

  input.addEventListener('input', () => ((lit = 0), draw()));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') return void (ev.preventDefault(), shut());
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') return void (ev.preventDefault(), (lit = Math.max(0, Math.min(found.length - 1, lit + (ev.key === 'ArrowDown' ? 1 : -1)))), draw());
    if (ev.key === 'Enter' && found[lit]) (ev.preventDefault(), choose(found[lit], ev.shiftKey));
  });
  veil.addEventListener('pointerdown', (ev) => ev.target === veil && shut());
  addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'k') (ev.preventDefault(), veil.hidden ? open() : shut());
  });
}
