// Find: a bar at the canvas's foot that sets the text of the canvas's lens (decision e_sdsaxxq4: search is the text
// term of the filter). What is found becomes seeds, the walk carries on from them, and it is drawn in place with what
// it is tied to; the query bar shows the term as a chip. Typing shows what the words would find, in one line above the
// bar (how many, the first few names); Enter draws it; clearing the bar takes the term out. / puts the cursor in it.
// The search is the flat lens's text term, the search read's own (src/lens-flat.ts): types and what is left out are
// the query bar's terms, so what it would find is read under the canvas's exclusions.

import { api, h, state } from './base.js';
import { goLens, home, lensNow } from './canvas.js';
import { numberOf } from './lens-base.js';
import { workType } from './words.js';

const bar = document.getElementById('find');
const peek = h('div', { class: 'find-peek', hidden: true, role: 'status' });
const input = h('input', { type: 'search', name: 'q', placeholder: 'Find on the map  /', autocomplete: 'off', 'aria-label': 'Find on the map', title: 'Words to find: Enter draws what they find on the canvas, with what it is tied to' });
let asked = 0;

const lensUp = () => lensNow() ?? home();
const includes = (f) => Boolean(f.text || f.types?.length || f.ids?.length || f.links?.length);
/** Draw the canvas's lens with these words as its filter's text. */
const drawText = (q) => (peek.hidden = true, goLens({ ...lensUp(), filter: { ...lensUp().filter, text: q } }));
/** Take the text out of the canvas's lens; a lens left including nothing is Home (or the open item's own canvas). */
function takeOut() {
  peek.hidden = true;
  const lens = lensNow();
  if (!lens?.filter.text) return;
  const { text, ...filter } = lens.filter;
  if (includes(filter)) return goLens({ ...lens, filter });
  const open = /^#\/e\/(e_[a-z0-9]{8})/.exec(location.hash)?.[1];
  location.hash = open ? `#/e/${open}` : '#/';
}

/** Ask what the words would find under the canvas's exclusions, and say it in one line. */
async function look() {
  const q = input.value.trim();
  const mine = ++asked;
  if (!q || q === lensNow()?.filter.text) return void (peek.hidden = true);
  let said;
  try {
    const exclude = lensUp().filter.exclude;
    const found = await api('view', { name: 'flat', params: { filter: { text: q, ...(exclude && { exclude }) }, limit: numberOf(state.style, 'find_peek_names') } });
    const names = found.items.map((i) => i.title);
    said = [
      h('span', { class: 'count', title: 'How many the words find' }, String(found.matched ?? names.length)),
      h('span', { class: 'gist grow', title: names.join('\n') }, names.length ? names.join(' · ') : 'Nothing matches.'),
      names.length > 0 && h('button', { type: 'button', class: 'quiet-button', title: 'Draw what the words find on the canvas (Enter)', onclick: () => drawText(q) }, 'Draw'),
      h('button', { type: 'button', class: 'quiet-button', title: `A new item named "${q}"`, onclick: () => ((peek.hidden = true), (location.hash = `#/new/${workType()}?title=${encodeURIComponent(q)}`)) }, 'New'),
    ];
  } catch (err) {
    said = [h('span', { class: 'gist grow error', title: err.message }, err.message)];
  }
  if (mine !== asked) return;
  peek.replaceChildren(...said);
  peek.hidden = false;
}

/** The bar shows the lens's text, unless it is being written. */
const keepUp = () => document.activeElement !== input && (input.value = lensNow()?.filter.text ?? '');

/** The bar, drawn once. */
export function drawFind() {
  if (bar.childElementCount) return;
  let wait;
  input.addEventListener('input', (ev) => {
    // Typing here is not an edit a redraw of the page would lose.
    ev.stopPropagation();
    clearTimeout(wait);
    wait = setTimeout(look, 160);
  });
  // The bar's own × (and Esc in it) empties it: the term goes out of the lens.
  input.addEventListener('search', () => !input.value.trim() && takeOut());
  bar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearTimeout(wait);
    const q = input.value.trim();
    q ? drawText(q) : takeOut();
  });
  bar.replaceChildren(peek, h('div', { class: 'find-row' }, input));
  addEventListener('hashchange', () => setTimeout(keepUp, 0));
  keepUp();
}

addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
  if (ev.key === '/' && !typing) (ev.preventDefault(), input.focus());
  if (ev.key === 'Escape' && !peek.hidden) (peek.hidden = true, input.blur());
});
document.addEventListener('click', (ev) => !bar.contains(ev.target) && (peek.hidden = true));
