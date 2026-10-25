// Find: a bar at the foot of the canvas. What is typed is looked for in titles and notes, the best first; what is
// found rises above the bar, one line each, and opens on the canvas where it stands. Enter adds the words to the
// canvas's lens instead (its filter's text, in the query bar), so all that matches is drawn. / puts the cursor in it;
// Esc takes what was found away. A type can be chosen, and anything can be looked for finished as well.

import { api, h, state } from './base.js';
import { goLens, home, lensNow } from './canvas.js';
import { chip, pill, typeChoice, workType } from './words.js';

const bar = document.getElementById('find');
const found = h('ul', { class: 'found', hidden: true, role: 'listbox' });
const input = h('input', { type: 'search', name: 'q', placeholder: 'Find on the map  /', autocomplete: 'off', 'aria-label': 'Find on the map' });
const kind = h('select', { title: 'Of one type', 'aria-label': 'Of one type' });
const finished = h('button', { type: 'button', class: 'quiet-button', title: 'Look among what is finished too' }, 'Finished');
let asked = 0;
/** The canvas's lens with these words as its filter's text. */
const withText = (q) => {
  const lens = lensNow() ?? home();
  return { ...lens, filter: { ...lens.filter, text: q } };
};
const drawText = (q) => (found.hidden = true, goLens(withText(q)));

/** Ask for what is typed, and show what comes back. */
async function look() {
  const q = input.value.trim(), type = kind.value || undefined;
  const mine = ++asked;
  if (!q && !type) return void (found.hidden = true);
  let rows;
  try {
    rows = await api('search', { q: q || undefined, type, open: finished.classList.contains('on') ? undefined : true, limit: 12 });
  } catch (err) {
    rows = [];
    found.replaceChildren(h('li', { class: 'error' }, err.message));
  }
  if (mine !== asked) return;
  // The app's own records are found from what they are about, unless their type is asked for.
  if (!type) rows = rows.filter((e) => !e.type.startsWith('sys.') || e.type === 'sys.connection');
  found.replaceChildren(
    q && h('li', { class: 'found-draw' }, h('a', { href: '#/', title: 'Add the words to the lens: everything that matches is drawn (Enter)', onclick: (ev) => (ev.preventDefault(), drawText(q)) }, 'Draw all', h('span', { class: 'muted' }, ` that matches "${q}"`))),
    ...(rows.length ? rows.map((e) => h('li', {}, h('a', { href: `#/e/${e.id}`, title: e.title, onclick: () => (found.hidden = true) }, chip(e.type), h('span', { class: 'gist grow' }, e.title), pill(e.type, e.status)))) : [h('li', { class: 'muted' }, 'Nothing matches.')]),
    h('li', { class: 'found-new' }, h('a', { href: `#/new/${type ?? workType()}${q ? `?title=${encodeURIComponent(q)}` : ''}`, onclick: () => (found.hidden = true) }, `New ${type ? '' : 'item'}`.trim(), q && h('span', { class: 'muted' }, ` named "${q}"`))),
  );
  found.hidden = false;
}

/** The bar, drawn once the types are known. */
export function drawFind() {
  if (bar.childElementCount) return;
  kind.replaceChildren(h('option', { value: '' }, 'Any type'), ...(state.schema?.types ?? []).filter((t) => !t.dormant).map((t) => h('option', { value: t.id }, typeChoice(t))));
  let wait;
  input.addEventListener('input', (ev) => {
    // Typing here is not an edit a redraw of the page would lose.
    ev.stopPropagation();
    clearTimeout(wait);
    wait = setTimeout(look, 160);
  });
  kind.addEventListener('change', look);
  finished.addEventListener('click', () => (finished.classList.toggle('on'), look()));
  bar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = input.value.trim();
    if (q) drawText(q);
  });
  bar.replaceChildren(found, h('div', { class: 'find-row' }, input, kind, finished));
}

addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
  if (ev.key === '/' && !typing) (ev.preventDefault(), input.focus());
  if (ev.key === 'Escape' && !found.hidden) (found.hidden = true, input.blur());
});
document.addEventListener('click', (ev) => !bar.contains(ev.target) && (found.hidden = true));
