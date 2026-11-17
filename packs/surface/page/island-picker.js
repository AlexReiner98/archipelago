// The island picker at the canvas's foot, in place of find (decision e_n42s8jvn): every island on the map in one line,
// by name, each a toggle (Alex, 17 Nov 2026: "just a simple list of islands"). The islands the canvas draws are lit; a
// press puts one on or takes it off, keeps that as the person's list and, where the canvas drew another (an agent's
// show, an item's page), brings it Home to draw it (./islands-list.js).

import { api, h } from './base.js';
import { islandsOn, keepList, onIslands } from './islands-on.js';
import { drawnAt, pressed } from './islands-list.js';
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
  let mine = [];
  /** A press: the list the canvas draws with this island on or off, kept as the person's; Home where it drew another. */
  const press = (id, title) => {
    const { list, home } = pressed(location.hash, mine, id);
    keepList(list, `${title} ${list.includes(id) ? 'put on' : 'taken off'} the canvas`).catch((err) => console.warn(err.message));
    if (home) location.hash = '#/';
  };
  // Those on first, each part by name; one put on moves to the front only when the page is drawn again, so a press never moves what is under it.
  let order = [];
  const draw = () => {
    const drawn = drawnAt(location.hash, mine);
    row.replaceChildren(
      ...order.map(({ id, title }) => {
        const on = drawn.includes(id);
        return h('button', { type: 'button', class: 'isl-name', 'aria-pressed': String(on), title: `${title}: ${on ? 'take off the canvas' : 'put on the canvas'}`, onclick: () => press(id, title) }, title);
      }),
    );
  };
  onIslands((now) => ((mine = now), draw()));
  addEventListener('hashchange', draw);
  Promise.all([islandsOn(), allIslands()]).then(([now, all]) => {
    mine = now;
    order = [...all.filter((i) => now.includes(i.id)), ...all.filter((i) => !now.includes(i.id))];
    draw();
  });
}
