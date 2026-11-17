// The island picker at the canvas's foot, in place of find (decision e_n42s8jvn): every island on the map in one line,
// by name, each a toggle (Alex, 17 Nov 2026: "just a simple list of islands"). The islands on are lit, and are what
// Home draws; a press puts one on or takes it off.

import { api, h } from './base.js';
import { islandsOn, onIslands, toggle } from './islands-on.js';
import { titles } from './words.js';

/** Every island on the map (the focus items), by name. */
const allIslands = () =>
  api('search', { islands: true, limit: 200 }).then(
    (found) => found.map((e) => (titles.set(e.id, e.title), { id: e.id, title: e.title })).sort((a, b) => a.title.localeCompare(b.title)),
    () => [],
  );

/** Draw the picker in #find, once a page. */
export function drawPicker() {
  const form = document.getElementById('find');
  if (!form || form.dataset.picker) return;
  form.dataset.picker = 'on';
  const row = h('div', { class: 'isl-on', role: 'group', 'aria-label': 'Islands' });
  form.replaceChildren(h('div', { class: 'find-row' }, row));
  form.addEventListener('submit', (ev) => ev.preventDefault());
  let list = [];
  // Those on first, each part by name; one put on moves to the front only when the page is drawn again, so a press never moves what is under it.
  let order = [];
  const draw = () =>
    row.replaceChildren(
      ...order.map(({ id, title }) => {
        const on = list.includes(id);
        return h('button', { type: 'button', class: 'isl-name', 'aria-pressed': String(on), title: `${title}: ${on ? 'take off the canvas' : 'put on the canvas'}`, onclick: () => toggle(id, title).catch((err) => console.warn(err.message)) }, title);
      }),
    );
  onIslands((now) => ((list = now), draw()));
  Promise.all([islandsOn(), allIslands()]).then(([now, all]) => {
    list = now;
    order = [...all.filter((i) => now.includes(i.id)), ...all.filter((i) => !now.includes(i.id))];
    draw();
  });
}
